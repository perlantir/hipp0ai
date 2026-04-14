/**
 * Session Memory API routes — multi-step task sessions.
 */

import type { Hono } from 'hono';
import { requireUUID, requireString, optionalString, logAudit, mapDbError } from './validation.js';
import {
  startSession,
  recordStep,
  getSessionContext,
  getSessionState,
  updateSessionStatus,
  listProjectSessions,
} from '@hipp0/core/memory/session-manager.js';
import { scoreTeamForTask } from '@hipp0/core/intelligence/role-signals.js';
import { suggestNextAgent, generateSessionPlan } from '@hipp0/core/intelligence/orchestrator.js';
import { getDb } from '@hipp0/core/db/index.js';
import { compileContext } from '@hipp0/core/context-compiler/index.js';
import type { CompileRequest } from '@hipp0/core/types.js';
import { cache, CACHE_TTL } from '../cache/redis.js';
import { requireProjectAccess } from './_helpers.js';

export function registerSessionRoutes(app: Hono): void {
    // Start a new task session
  app.post('/api/tasks/session/start', async (c) => {
    const body = await c.req.json<{
      project_id?: unknown;
      title?: unknown;
      description?: unknown;
    }>();

    const project_id = requireUUID(body.project_id, 'project_id');
    await requireProjectAccess(c, project_id);
    const title = requireString(body.title, 'title', 500);
    const description = optionalString(body.description, 'description', 5000);

    // Verify project exists before creating session
    const db = getDb();
    const projCheck = await db.query('SELECT id FROM projects WHERE id = ?', [project_id]);
    if (projCheck.rows.length === 0) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404);
    }

    try {
      const result = await startSession({ project_id, title, description });

      logAudit('session_started', project_id, {
        session_id: result.session_id,
        title,
      });

      return c.json(result, 201);
    } catch (err) {
      mapDbError(err);
    }
  });

    // Record a step in a session
  app.post('/api/tasks/session/:id/step', async (c) => {
    const sessionId = requireUUID(c.req.param('id'), 'session_id');
    const body = await c.req.json<{
      agent_name?: unknown;
      agent_role?: unknown;
      task_description?: unknown;
      output?: unknown;
      artifacts?: unknown[];
      duration_ms?: number;
      decisions_created?: string[];
      project_id?: unknown;
    }>();

    const agent_name = requireString(body.agent_name, 'agent_name', 200);
    const task_description = requireString(body.task_description, 'task_description', 100000);
    const output = requireString(body.output, 'output', 500000);
    const agent_role = optionalString(body.agent_role, 'agent_role', 200);

    // Resolve project_id from the session — the authoritative tenancy
    // boundary — and enforce tenant access before any write. Any
    // client-supplied project_id is ignored to avoid cross-tenant writes.
    const state = await getSessionState(sessionId);
    const project_id = state.session.project_id;
    await requireProjectAccess(c, project_id);

    try {
      const result = await recordStep({
        session_id: sessionId,
        project_id,
        agent_name,
        agent_role,
        task_description,
        output,
        artifacts: body.artifacts,
        duration_ms: body.duration_ms,
        decisions_created: body.decisions_created,
      });

      logAudit('session_step_recorded', project_id, {
        session_id: sessionId,
        step_number: result.step_number,
        agent_name,
      });

        // Session Prefetch: fire-and-forget compile for likely next agents
      void (async () => {
        try {
          // Check project settings for prefetch config
          const prefetchDb = getDb();
          const projResult = await prefetchDb.query('SELECT metadata FROM projects WHERE id = ?', [project_id]);
          let prefetchEnabled = true;
          let prefetchAgentCount = 3;
          if (projResult.rows.length > 0) {
            let meta: Record<string, unknown> = {};
            const rawMeta = (projResult.rows[0] as Record<string, unknown>).metadata;
            if (typeof rawMeta === 'string') {
              try { meta = JSON.parse(rawMeta); } catch { /* empty */ }
            } else if (typeof rawMeta === 'object' && rawMeta !== null) {
              meta = rawMeta as Record<string, unknown>;
            }
            if (meta.prefetch_enabled === false) prefetchEnabled = false;
            if (typeof meta.prefetch_agent_count === 'number') prefetchAgentCount = meta.prefetch_agent_count;
          }

          if (!prefetchEnabled) return;

          // Get top-ranked agents who haven't participated
          const teamResult = await scoreTeamForTask(project_id, task_description, sessionId);
          const sessionState = await getSessionState(sessionId);
          const participatedAgents = new Set(sessionState.session.agents_involved);

          const candidateAgents = teamResult.recommended_participants
            .filter((p) => !participatedAgents.has(p.agent_name))
            .slice(0, prefetchAgentCount);

          // Invalidate existing prefetch cache for this session
          await cache.invalidatePrefix(`prefetch:${sessionId}`);

          // Pre-compile context for each candidate agent
          for (const candidate of candidateAgents) {
            try {
              const request: CompileRequest = {
                agent_name: candidate.agent_name,
                project_id,
                task_description,
              };
              const compiled = await compileContext(request);
              const cacheKey = `prefetch:${sessionId}:${candidate.agent_name}`;
              await cache.set(cacheKey, JSON.stringify(compiled), CACHE_TTL.COMPILE);
            } catch {
              // Non-fatal — prefetch is best-effort
            }
          }
        } catch {
          // Non-fatal — prefetch failure should never affect step recording
        }
      })();

      return c.json(result, 201);
    } catch (err) {
      mapDbError(err);
    }
  });

    // Get full session state
  app.get('/api/tasks/session/:id/state', async (c) => {
    const sessionId = requireUUID(c.req.param('id'), 'session_id');
    try {
      const state = await getSessionState(sessionId);
      await requireProjectAccess(c, state.session.project_id);
      return c.json(state);
    } catch (err) {
      if ((err as Error).message?.includes('not found')) {
        return c.json({ error: { code: 'NOT_FOUND', message: 'Session not found' } }, 404);
      }
      throw err;
    }
  });

    // Get session context for an agent
  app.get('/api/tasks/session/:id/context/:agentName', async (c) => {
    const sessionId = requireUUID(c.req.param('id'), 'session_id');
    const agentName = c.req.param('agentName');
    const task = c.req.query('task') ?? '';

    // Get project_id from session
    const state = await getSessionState(sessionId);
    await requireProjectAccess(c, state.session.project_id);
    const ctx = await getSessionContext(sessionId, agentName, task, state.session.project_id);
    return c.json(ctx);
  });

    // Pause session
  app.post('/api/tasks/session/:id/pause', async (c) => {
    const sessionId = requireUUID(c.req.param('id'), 'session_id');
    const pre = await getSessionState(sessionId);
    await requireProjectAccess(c, pre.session.project_id);
    const session = await updateSessionStatus(sessionId, 'paused');
    logAudit('session_paused', session.project_id, { session_id: sessionId });
    return c.json(session);
  });

    // Resume session
  app.post('/api/tasks/session/:id/resume', async (c) => {
    const sessionId = requireUUID(c.req.param('id'), 'session_id');
    const pre = await getSessionState(sessionId);
    await requireProjectAccess(c, pre.session.project_id);
    const session = await updateSessionStatus(sessionId, 'active');
    logAudit('session_resumed', session.project_id, { session_id: sessionId });
    return c.json(session);
  });

    // Complete session
  app.post('/api/tasks/session/:id/complete', async (c) => {
    const sessionId = requireUUID(c.req.param('id'), 'session_id');
    const pre = await getSessionState(sessionId);
    await requireProjectAccess(c, pre.session.project_id);
    const session = await updateSessionStatus(sessionId, 'completed');
    logAudit('session_completed', session.project_id, { session_id: sessionId });
    return c.json(session);
  });

    // List sessions for a project
  app.get('/api/projects/:id/sessions-live', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'project_id');
    await requireProjectAccess(c, projectId);
    const status = c.req.query('status') ?? undefined;
    const sessions = await listProjectSessions(projectId, status);
    return c.json(sessions);
  });

    // Suggest next agent (Super Brain Phase 3)
  app.post('/api/tasks/session/:id/suggest-next', async (c) => {
    const sessionId = requireUUID(c.req.param('id'), 'session_id');

    // Get project_id from session
    const state = await getSessionState(sessionId);
    const projectId = state.session.project_id;
    await requireProjectAccess(c, projectId);

    try {
      const suggestion = await suggestNextAgent(sessionId, projectId);

      logAudit('orchestrator_suggest', projectId, {
        session_id: sessionId,
        recommended_agent: suggestion.recommended_agent,
        confidence: suggestion.confidence,
        is_session_complete: suggestion.is_session_complete,
      });

      return c.json(suggestion);
    } catch (err) {
      if ((err as Error).message?.includes('not found')) {
        return c.json({ error: { code: 'NOT_FOUND', message: 'Session not found' } }, 404);
      }
      mapDbError(err);
    }
  });

    // Generate session plan (Super Brain Phase 3)
  app.post('/api/tasks/session/:id/plan', async (c) => {
    const sessionId = requireUUID(c.req.param('id'), 'session_id');

    const state = await getSessionState(sessionId);
    const projectId = state.session.project_id;
    await requireProjectAccess(c, projectId);

    try {
      const plan = await generateSessionPlan(sessionId, projectId);

      logAudit('orchestrator_plan', projectId, {
        session_id: sessionId,
        estimated_agents: plan.estimated_agents,
      });

      return c.json(plan);
    } catch (err) {
      if ((err as Error).message?.includes('not found')) {
        return c.json({ error: { code: 'NOT_FOUND', message: 'Session not found' } }, 404);
      }
      mapDbError(err);
    }
  });

    // Accept/override suggestion (Super Brain Phase 3)
  app.post('/api/tasks/session/:id/accept-suggestion', async (c) => {
    const sessionId = requireUUID(c.req.param('id'), 'session_id');
    const body = await c.req.json<{
      accepted_agent?: unknown;
      override?: unknown;
      override_reason?: unknown;
    }>();

    const acceptedAgent = requireString(body.accepted_agent, 'accepted_agent', 200);
    const isOverride = body.override === true;
    const overrideReason = isOverride
      ? optionalString(body.override_reason, 'override_reason', 5000)
      : undefined;

    const state = await getSessionState(sessionId);
    const projectId = state.session.project_id;
    await requireProjectAccess(c, projectId);

    // Get the current suggestion to record what was suggested
    let suggestedAgent = acceptedAgent;
    let confidence: number | null = null;
    try {
      const suggestion = await suggestNextAgent(sessionId, projectId);
      suggestedAgent = suggestion.recommended_agent || acceptedAgent;
      confidence = suggestion.confidence;
    } catch {
      // Non-fatal — record anyway
    }

    const db = getDb();
    try {
      await db.query(
        `INSERT INTO orchestration_decisions
           (session_id, step_number, suggested_agent, actual_agent, was_override, override_reason, suggestion_confidence)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          sessionId,
          state.session.current_step + 1,
          suggestedAgent,
          acceptedAgent,
          isOverride,
          overrideReason ?? null,
          confidence,
        ],
      );

      logAudit('orchestrator_accept', projectId, {
        session_id: sessionId,
        accepted_agent: acceptedAgent,
        was_override: isOverride,
      });

      return c.json({
        accepted: true,
        agent: acceptedAgent,
        was_override: isOverride,
      }, 201);
    } catch (err) {
      mapDbError(err);
    }
  });

    // Save checkpoint (Context Compression Survival)
  app.post('/api/tasks/session/:id/checkpoint', async (c) => {
    const sessionId = requireUUID(c.req.param('id'), 'session_id');
    const body = await c.req.json<{
      agent_name?: unknown;
      context_summary?: unknown;
      important_decisions?: string[];
    }>();

    const agent_name = requireString(body.agent_name, 'agent_name', 200);
    const context_summary = requireString(body.context_summary, 'context_summary', 100000);
    const importantDecisions = body.important_decisions ?? [];

    const pre = await getSessionState(sessionId);
    await requireProjectAccess(c, pre.session.project_id);

    const db = getDb();

    try {
      const result = await db.query(
        `INSERT INTO session_checkpoints (session_id, agent_name, checkpoint_text, important_decision_ids)
         VALUES (?, ?, ?, ?)
         RETURNING id`,
        [sessionId, agent_name, context_summary, JSON.stringify(importantDecisions)],
      );

      const checkpointId = (result.rows[0] as Record<string, unknown>).id as string;

      // Get project_id for audit
      const state = await getSessionState(sessionId);
      logAudit('checkpoint_saved', state.session.project_id, {
        session_id: sessionId,
        agent_name,
        checkpoint_id: checkpointId,
      });

      return c.json({
        checkpoint_id: checkpointId,
        session_id: sessionId,
        agent_name,
      }, 201);
    } catch (err) {
      mapDbError(err);
    }
  });

    // Project settings (prefetch config)
  app.get('/api/projects/:id/settings', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'project_id');
    await requireProjectAccess(c, projectId);
    const db = getDb();

    const result = await db.query('SELECT metadata FROM projects WHERE id = ?', [projectId]);
    if (result.rows.length === 0) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404);
    }

    let metadata: Record<string, unknown> = {};
    const raw = (result.rows[0] as Record<string, unknown>).metadata;
    if (typeof raw === 'string') {
      try { metadata = JSON.parse(raw); } catch { /* empty */ }
    } else if (typeof raw === 'object' && raw !== null) {
      metadata = raw as Record<string, unknown>;
    }

    // Return settings with defaults
    return c.json({
      prefetch_enabled: metadata.prefetch_enabled ?? true,
      prefetch_agent_count: metadata.prefetch_agent_count ?? 3,
      auto_capture: metadata.auto_capture ?? false,
      ...metadata,
    });
  });

  app.patch('/api/projects/:id/settings', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'project_id');
    await requireProjectAccess(c, projectId);
    const body = await c.req.json<Record<string, unknown>>();
    const db = getDb();

    // Read current metadata
    const result = await db.query('SELECT metadata FROM projects WHERE id = ?', [projectId]);
    if (result.rows.length === 0) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404);
    }

    let metadata: Record<string, unknown> = {};
    const raw = (result.rows[0] as Record<string, unknown>).metadata;
    if (typeof raw === 'string') {
      try { metadata = JSON.parse(raw); } catch { /* empty */ }
    } else if (typeof raw === 'object' && raw !== null) {
      metadata = raw as Record<string, unknown>;
    }

    // Merge new settings — whitelist the keys that clients are allowed to
    // write. Blindly spreading `body` on top of `metadata` would let a caller
    // overwrite any metadata key (including ones set server-side), and opens
    // a __proto__ pollution pathway via JSON input.
    const ALLOWED_SETTINGS_KEYS = new Set([
      'prefetch_enabled',
      'prefetch_agent_count',
      'auto_capture',
      'share_anonymous_patterns',
    ]);
    const updated: Record<string, unknown> = { ...metadata };
    for (const [k, v] of Object.entries(body)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      if (!ALLOWED_SETTINGS_KEYS.has(k)) continue;
      updated[k] = v;
    }
    await db.query(
      'UPDATE projects SET metadata = ?, updated_at = NOW() WHERE id = ?',
      [JSON.stringify(updated), projectId],
    );

    return c.json({
      prefetch_enabled: updated.prefetch_enabled ?? true,
      prefetch_agent_count: updated.prefetch_agent_count ?? 3,
      auto_capture: updated.auto_capture ?? false,
      ...updated,
    });
  });

    // Score team for a task (Super Brain Phase 2)
  app.post('/api/projects/:id/team-score', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'project_id');
    await requireProjectAccess(c, projectId);
    const body = await c.req.json<{
      task_description?: unknown;
      session_id?: unknown;
    }>();

    const taskDescription = requireString(body.task_description, 'task_description', 100000);
    const sessionId = body.session_id ? requireUUID(body.session_id, 'session_id') : undefined;

    try {
      const result = await scoreTeamForTask(projectId, taskDescription, sessionId);

      logAudit('team_score', projectId, {
        task_description_length: taskDescription.length,
        recommended_participants: result.recommended_participants.length,
        recommended_skip: result.recommended_skip.length,
        optimal_team_size: result.optimal_team_size,
      });

      return c.json(result);
    } catch (err) {
      mapDbError(err);
    }
  });
}
