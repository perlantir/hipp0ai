/**
 * /api/hermes/* — runtime integration endpoints for a Hermes fork acting
 * as the `Hipp0MemoryProvider`.
 *
 * Wire contract: packages/core/src/types/hermes-contract.ts
 *
 * Endpoints:
 *
 *   POST   /api/hermes/register         — upsert persistent agent profile
 *   GET    /api/hermes/agents           — list registered agents (dashboard)
 *   GET    /api/hermes/agents/:name     — fetch a single agent profile
 *   POST   /api/hermes/session/start    — begin a new session, get session_id
 *   POST   /api/hermes/session/end      — close session + optional outcome
 *   POST   /api/hermes/user-facts       — upsert facts (If-Match optimistic lock)
 *   GET    /api/hermes/user-facts       — read current facts for a user
 *   POST   /api/hermes/outcomes         — per-turn snippet reinforcement signal
 *
 * Capture / compile are intentionally NOT duplicated here — the Hermes
 * provider calls the existing /api/capture and /api/compile with
 * `source: "hermes"`. The sibling /api/outcomes path is the compile-request
 * / alignment-analysis flow and is a different concern from
 * /api/hermes/outcomes (the snippet-level per-turn signal from the brief).
 */

import crypto from 'node:crypto';
import type { Hono } from 'hono';
import { getDb } from '@hipp0/core/db/index.js';
import { attributeOutcomeToDecisions } from '@hipp0/core/intelligence/outcome-memory.js';
import { propagateOutcomeToEntities } from '@hipp0/core/intelligence/entity-enricher.js';
import { requireUUID, requireString, optionalString, logAudit, mapDbError } from './validation.js';
import { requireProjectAccess } from './_helpers.js';
import { broadcast } from '../websocket.js';
import { invalidateDecisionCaches } from '../cache/redis.js';
import {
  HERMES_AGENT_NAME_RE,
  type HermesPlatform,
  type HermesAgentConfig,
  type HermesUserFact,
} from '@hipp0/core/types/hermes-contract.js';

const VALID_PLATFORMS: readonly HermesPlatform[] = ['telegram', 'discord', 'slack', 'whatsapp', 'signal', 'web', 'cli'];

function requireAgentName(val: unknown, field = 'agent_name'): string {
  const name = requireString(val, field, 64);
  if (!HERMES_AGENT_NAME_RE.test(name)) {
    throw new Error(`${field} must match ${HERMES_AGENT_NAME_RE}`);
  }
  return name;
}

function requirePlatform(val: unknown, field = 'platform'): HermesPlatform {
  const raw = requireString(val, field, 32);
  if (!(VALID_PLATFORMS as readonly string[]).includes(raw)) {
    throw new Error(`${field} must be one of: ${VALID_PLATFORMS.join(', ')}`);
  }
  return raw as HermesPlatform;
}

function parseAgentConfig(val: unknown): HermesAgentConfig {
  if (typeof val !== 'object' || val === null) {
    throw new Error('config must be an object');
  }
  const obj = val as Record<string, unknown>;
  const model = requireString(obj.model, 'config.model', 200);
  const toolset = optionalString(obj.toolset, 'config.toolset', 200);
  let platform_access: HermesPlatform[] | undefined;
  if (Array.isArray(obj.platform_access)) {
    platform_access = obj.platform_access.map((p) => requirePlatform(p, 'config.platform_access[]'));
  }
  const metadata = (typeof obj.metadata === 'object' && obj.metadata !== null)
    ? (obj.metadata as Record<string, unknown>)
    : undefined;
  return { model, toolset, platform_access, metadata };
}

export function registerHermesRoutes(app: Hono): void {
  // -----------------------------------------------------------------------
  // POST /api/hermes/register — upsert persistent agent profile
  // -----------------------------------------------------------------------
  app.post('/api/hermes/register', async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const project_id = requireUUID(body.project_id, 'project_id');
    await requireProjectAccess(c, project_id);
    const agent_name = requireAgentName(body.agent_name);
    const soul = requireString(body.soul, 'soul', 100_000);
    const config = parseAgentConfig(body.config);

    const db = getDb();

    // Check if agent already exists
    const existing = await db.query(
      'SELECT id FROM hermes_agents WHERE project_id = ? AND agent_name = ?',
      [project_id, agent_name],
    );

    let agent_id: string;
    let created = false;
    try {
      if (existing.rows.length > 0) {
        agent_id = (existing.rows[0] as Record<string, unknown>).id as string;
        await db.query(
          `UPDATE hermes_agents
             SET soul_md = ?, config_json = ?, updated_at = ?
           WHERE id = ?`,
          [soul, JSON.stringify(config), new Date().toISOString(), agent_id],
        );
      } else {
        agent_id = crypto.randomUUID();
        created = true;
        await db.query(
          `INSERT INTO hermes_agents (id, project_id, agent_name, soul_md, config_json)
           VALUES (?, ?, ?, ?, ?)`,
          [agent_id, project_id, agent_name, soul, JSON.stringify(config)],
        );
      }
    } catch (err) {
      mapDbError(err);
      return; // unreachable, mapDbError always throws
    }

    logAudit('hermes_agent_registered', project_id, {
      agent_id,
      agent_name,
      created,
    });

    broadcast('hermes.agent.registered', {
      project_id,
      agent_id,
      agent_name,
      created,
    });

    return c.json({ agent_id, agent_name, created }, created ? 201 : 200);
  });

  // -----------------------------------------------------------------------
  // GET /api/hermes/agents — list registered agents for a project
  // -----------------------------------------------------------------------
  app.get('/api/hermes/agents', async (c) => {
    const project_id = requireUUID(c.req.query('project_id'), 'project_id');
    await requireProjectAccess(c, project_id);
    const db = getDb();
    const result = await db.query(
      `SELECT id, agent_name, config_json, created_at, updated_at
         FROM hermes_agents
        WHERE project_id = ?
        ORDER BY agent_name ASC`,
      [project_id],
    );
    const agents = result.rows.map((row) => {
      const r = row as Record<string, unknown>;
      let config: unknown = null;
      if (typeof r.config_json === 'string') {
        try { config = JSON.parse(r.config_json); } catch { /* keep null */ }
      } else if (typeof r.config_json === 'object' && r.config_json !== null) {
        config = r.config_json;
      }
      return {
        agent_id: r.id,
        agent_name: r.agent_name,
        config,
        created_at: r.created_at,
        updated_at: r.updated_at,
      };
    });
    return c.json(agents);
  });

  // -----------------------------------------------------------------------
  // GET /api/hermes/agents/:name — fetch single agent (includes SOUL.md)
  // -----------------------------------------------------------------------
  app.get('/api/hermes/agents/:name', async (c) => {
    const project_id = requireUUID(c.req.query('project_id'), 'project_id');
    await requireProjectAccess(c, project_id);
    const agent_name = requireAgentName(c.req.param('name'));
    const db = getDb();
    const result = await db.query(
      `SELECT id, agent_name, soul_md, config_json, created_at, updated_at
         FROM hermes_agents
        WHERE project_id = ? AND agent_name = ?`,
      [project_id, agent_name],
    );
    if (result.rows.length === 0) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Agent not found' } }, 404);
    }
    const r = result.rows[0] as Record<string, unknown>;
    let config: unknown = null;
    if (typeof r.config_json === 'string') {
      try { config = JSON.parse(r.config_json); } catch { /* keep null */ }
    } else if (typeof r.config_json === 'object' && r.config_json !== null) {
      config = r.config_json;
    }
    return c.json({
      agent_id: r.id,
      agent_name: r.agent_name,
      soul: r.soul_md,
      config,
      created_at: r.created_at,
      updated_at: r.updated_at,
    });
  });

  // -----------------------------------------------------------------------
  // GET /api/hermes/agents/:name/conversations — list recent sessions for
  // a named agent. Paginated, newest first. Defaults to the last 50.
  // -----------------------------------------------------------------------
  app.get('/api/hermes/agents/:name/conversations', async (c) => {
    const project_id = requireUUID(c.req.query('project_id'), 'project_id');
    await requireProjectAccess(c, project_id);
    const agent_name = requireAgentName(c.req.param('name'));
    const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10) || 50, 200);
    const offset = parseInt(c.req.query('offset') ?? '0', 10) || 0;

    const db = getDb();

    // Resolve agent_id from name (so path + query stay stable even if we
    // expose agent_id in the future).
    const agentResult = await db.query(
      'SELECT id FROM hermes_agents WHERE project_id = ? AND agent_name = ?',
      [project_id, agent_name],
    );
    if (agentResult.rows.length === 0) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Agent not found' } }, 404);
    }
    const agent_id = (agentResult.rows[0] as Record<string, unknown>).id as string;

    const result = await db.query(
      `SELECT id, session_id, platform, external_user_id, external_chat_id,
              started_at, ended_at, summary_md
         FROM hermes_conversations
        WHERE agent_id = ?
        ORDER BY started_at DESC
        LIMIT ? OFFSET ?`,
      [agent_id, limit, offset],
    );

    const conversations = result.rows.map((row) => {
      const r = row as Record<string, unknown>;
      return {
        conversation_id: r.id as string,
        session_id: r.session_id as string,
        platform: r.platform as string,
        external_user_id: (r.external_user_id as string | null) ?? null,
        external_chat_id: (r.external_chat_id as string | null) ?? null,
        started_at: r.started_at as string,
        ended_at: (r.ended_at as string | null) ?? null,
        summary: (r.summary_md as string | null) ?? null,
      };
    });

    return c.json(conversations);
  });

  // -----------------------------------------------------------------------
  // POST /api/hermes/conversations/:session_id/messages — append a message
  //
  // The Hermes runtime calls this once per message (user / assistant / tool)
  // during a live session so the dashboard's message log stays current.
  // Separate from POST /api/capture, which is bulk / retrospective and goes
  // through async distillation.
  // -----------------------------------------------------------------------
  app.post('/api/hermes/conversations/:session_id/messages', async (c) => {
    const session_id = requireUUID(c.req.param('session_id'), 'session_id');
    const body = await c.req.json<Record<string, unknown>>();

    // Validate role — matches the CHECK constraint on hermes_messages.role
    const role = requireString(body.role, 'role', 32);
    const validRoles = ['user', 'assistant', 'system', 'tool'];
    if (!validRoles.includes(role)) {
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: `role must be one of: ${validRoles.join(', ')}` } },
        400,
      );
    }

    const content = requireString(body.content, 'content', 500_000);
    const tool_calls_json = body.tool_calls !== undefined && body.tool_calls !== null
      ? JSON.stringify(body.tool_calls)
      : null;
    const tool_results_json = body.tool_results !== undefined && body.tool_results !== null
      ? JSON.stringify(body.tool_results)
      : null;
    const tokens_in = typeof body.tokens_in === 'number' ? Math.max(0, Math.floor(body.tokens_in)) : null;
    const tokens_out = typeof body.tokens_out === 'number' ? Math.max(0, Math.floor(body.tokens_out)) : null;

    const db = getDb();

    // Resolve conversation_id + project_id from session_id
    const convResult = await db.query(
      'SELECT id, project_id FROM hermes_conversations WHERE session_id = ?',
      [session_id],
    );
    if (convResult.rows.length === 0) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Session not found' } }, 404);
    }
    const convRow = convResult.rows[0] as Record<string, unknown>;
    const project_id = convRow.project_id as string;
    await requireProjectAccess(c, project_id);
    const conversation_id = convRow.id as string;

    const message_id = crypto.randomUUID();
    const created_at = new Date().toISOString();

    try {
      await db.query(
        `INSERT INTO hermes_messages
           (id, conversation_id, role, content, tool_calls_json, tool_results_json, tokens_in, tokens_out, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          message_id,
          conversation_id,
          role,
          content,
          tool_calls_json,
          tool_results_json,
          tokens_in,
          tokens_out,
          created_at,
        ],
      );
    } catch (err) {
      mapDbError(err);
      return;
    }

    logAudit('hermes_message_appended', project_id, {
      message_id,
      session_id,
      role,
      tokens_in,
      tokens_out,
    });

    broadcast('hermes.message.added', {
      project_id,
      session_id,
      conversation_id,
      message_id,
      role,
      created_at,
    });

    return c.json(
      {
        message_id,
        session_id,
        conversation_id,
        created_at,
      },
      201,
    );
  });

  // -----------------------------------------------------------------------
  // GET /api/hermes/conversations/:session_id/messages — message log for a
  // specific session. The web Chat view paginates over this; Phase 2 uses
  // it for the agent-detail conversation drill-down.
  // -----------------------------------------------------------------------
  app.get('/api/hermes/conversations/:session_id/messages', async (c) => {
    const session_id = requireUUID(c.req.param('session_id'), 'session_id');
    const limit = Math.min(parseInt(c.req.query('limit') ?? '100', 10) || 100, 1000);
    const offset = parseInt(c.req.query('offset') ?? '0', 10) || 0;

    const db = getDb();

    // Resolve conversation_id + project_id from session_id
    const convResult = await db.query(
      `SELECT id, project_id, agent_id, platform, started_at, ended_at
         FROM hermes_conversations
        WHERE session_id = ?`,
      [session_id],
    );
    if (convResult.rows.length === 0) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Session not found' } }, 404);
    }
    const convRow = convResult.rows[0] as Record<string, unknown>;
    const project_id = convRow.project_id as string;
    await requireProjectAccess(c, project_id);

    const conversation_id = convRow.id as string;

    // Peek one extra row to derive has_more without a separate COUNT(*).
    const msgResult = await db.query(
      `SELECT id, role, content, tool_calls_json, tool_results_json,
              tokens_in, tokens_out, created_at
         FROM hermes_messages
        WHERE conversation_id = ?
        ORDER BY created_at ASC
        LIMIT ? OFFSET ?`,
      [conversation_id, limit + 1, offset],
    );

    const has_more = msgResult.rows.length > limit;
    const pageRows = has_more ? msgResult.rows.slice(0, limit) : msgResult.rows;

    const messages = pageRows.map((row) => {
      const r = row as Record<string, unknown>;
      let tool_calls: unknown = null;
      let tool_results: unknown = null;
      if (typeof r.tool_calls_json === 'string') {
        try { tool_calls = JSON.parse(r.tool_calls_json); } catch { /* keep null */ }
      } else if (r.tool_calls_json) {
        tool_calls = r.tool_calls_json;
      }
      if (typeof r.tool_results_json === 'string') {
        try { tool_results = JSON.parse(r.tool_results_json); } catch { /* keep null */ }
      } else if (r.tool_results_json) {
        tool_results = r.tool_results_json;
      }
      return {
        id: r.id as string,
        role: r.role as string,
        content: r.content as string,
        tool_calls,
        tool_results,
        tokens_in: (r.tokens_in as number | null) ?? null,
        tokens_out: (r.tokens_out as number | null) ?? null,
        created_at: r.created_at as string,
      };
    });

    return c.json({
      session_id,
      conversation_id,
      started_at: convRow.started_at as string,
      ended_at: (convRow.ended_at as string | null) ?? null,
      platform: convRow.platform as string,
      messages,
      limit,
      offset,
      has_more,
    });
  });

  // -----------------------------------------------------------------------
  // GET /api/hermes/pulse — single-call dashboard home aggregate
  //
  // Returns counts + the most recent sessions across ALL agents in a
  // project, so the Pulse view can hydrate a home page with one request.
  // -----------------------------------------------------------------------
  app.get('/api/hermes/pulse', async (c) => {
    const project_id = requireUUID(c.req.query('project_id'), 'project_id');
    await requireProjectAccess(c, project_id);
    const limit = Math.min(parseInt(c.req.query('limit') ?? '20', 10) || 20, 100);

    const db = getDb();

    // 1. Agent count
    const agentCountResult = await db.query(
      'SELECT COUNT(*) AS count FROM hermes_agents WHERE project_id = ?',
      [project_id],
    );
    const agentCount = Number(
      ((agentCountResult.rows[0] ?? {}) as Record<string, unknown>).count ?? 0,
    );

    // 2. Active session count (ended_at IS NULL)
    const activeCountResult = await db.query(
      `SELECT COUNT(*) AS count FROM hermes_conversations
        WHERE project_id = ? AND ended_at IS NULL`,
      [project_id],
    );
    const activeSessionCount = Number(
      ((activeCountResult.rows[0] ?? {}) as Record<string, unknown>).count ?? 0,
    );

    // 3. Recent sessions (joined to agent_name)
    const recentResult = await db.query(
      `SELECT c.id              AS conversation_id,
              c.session_id,
              c.platform,
              c.external_user_id,
              c.external_chat_id,
              c.started_at,
              c.ended_at,
              a.agent_name
         FROM hermes_conversations c
         JOIN hermes_agents a ON a.id = c.agent_id
        WHERE c.project_id = ?
        ORDER BY c.started_at DESC
        LIMIT ?`,
      [project_id, limit],
    );

    const recent_sessions = recentResult.rows.map((row) => {
      const r = row as Record<string, unknown>;
      return {
        conversation_id: r.conversation_id as string,
        session_id: r.session_id as string,
        agent_name: r.agent_name as string,
        platform: r.platform as string,
        external_user_id: (r.external_user_id as string | null) ?? null,
        external_chat_id: (r.external_chat_id as string | null) ?? null,
        started_at: r.started_at as string,
        ended_at: (r.ended_at as string | null) ?? null,
      };
    });

    return c.json({
      agent_count: agentCount,
      active_session_count: activeSessionCount,
      recent_sessions,
    });
  });

  // -----------------------------------------------------------------------
  // POST /api/hermes/session/start — create a hermes_conversations row
  // -----------------------------------------------------------------------
  app.post('/api/hermes/session/start', async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const project_id = requireUUID(body.project_id, 'project_id');
    await requireProjectAccess(c, project_id);
    const agent_name = requireAgentName(body.agent_name);
    const platform = requirePlatform(body.platform);
    const external_user_id = optionalString(body.external_user_id, 'external_user_id', 200) ?? null;
    const external_chat_id = optionalString(body.external_chat_id, 'external_chat_id', 200) ?? null;
    const metadata = (typeof body.metadata === 'object' && body.metadata !== null)
      ? JSON.stringify(body.metadata)
      : null;

    const db = getDb();

    // Look up agent_id for the name
    const agentResult = await db.query(
      'SELECT id FROM hermes_agents WHERE project_id = ? AND agent_name = ?',
      [project_id, agent_name],
    );
    if (agentResult.rows.length === 0) {
      return c.json({ error: { code: 'NOT_FOUND', message: `Agent ${agent_name} not registered` } }, 404);
    }
    const agent_id = (agentResult.rows[0] as Record<string, unknown>).id as string;

    const conversation_id = crypto.randomUUID();
    const session_id = crypto.randomUUID();
    const started_at = new Date().toISOString();

    try {
      await db.query(
        `INSERT INTO hermes_conversations
           (id, session_id, project_id, agent_id, platform, external_user_id, external_chat_id, metadata_json, started_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [conversation_id, session_id, project_id, agent_id, platform, external_user_id, external_chat_id, metadata, started_at],
      );
    } catch (err) {
      mapDbError(err);
      return;
    }

    logAudit('hermes_session_start', project_id, {
      conversation_id,
      session_id,
      agent_name,
      platform,
    });

    broadcast('hermes.session.started', {
      project_id,
      session_id,
      conversation_id,
      agent_name,
      platform,
      external_chat_id,
      started_at,
    });

    return c.json({ session_id, conversation_id, started_at }, 201);
  });

  // -----------------------------------------------------------------------
  // POST /api/hermes/session/end — close session + optional outcome
  // -----------------------------------------------------------------------
  app.post('/api/hermes/session/end', async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const session_id = requireUUID(body.session_id, 'session_id');

    const db = getDb();

    const convResult = await db.query(
      'SELECT id, project_id, ended_at FROM hermes_conversations WHERE session_id = ?',
      [session_id],
    );
    if (convResult.rows.length === 0) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Session not found' } }, 404);
    }
    const convRow = convResult.rows[0] as Record<string, unknown>;
    const project_id = convRow.project_id as string;
    await requireProjectAccess(c, project_id);

    if (convRow.ended_at) {
      // Idempotent close — return existing end state
      return c.json({
        session_id,
        ended_at: convRow.ended_at,
        summary_snippet_ids: [],
      });
    }

    const ended_at = new Date().toISOString();
    await db.query(
      'UPDATE hermes_conversations SET ended_at = ? WHERE session_id = ?',
      [ended_at, session_id],
    );

    // Optional outcome bundled with session/end — wire through the full
    // attribution pipeline (same path as /api/hermes/outcomes).
    const outcome = body.outcome as Record<string, unknown> | undefined;
    if (outcome) {
      const rating = outcome.rating as string | undefined;
      const snippet_ids: string[] = Array.isArray(outcome.snippet_ids)
        ? (outcome.snippet_ids as unknown[]).filter((x): x is string => typeof x === 'string')
        : [];
      const signal_source = (outcome.signal_source as string | undefined) ?? 'session_end';

      // Normalise to the same 3-value scale used by /api/hermes/outcomes
      const outcomeLabel = rating === 'positive' ? 'positive'
        : rating === 'negative' ? 'negative'
        : 'neutral';

      try {
        // Find the agent for this session
        const agentRes = await db.query<Record<string, unknown>>(
          `SELECT hc.agent_id FROM hermes_conversations hc WHERE hc.session_id = ?`,
          [session_id],
        );
        const agent_id = agentRes.rows[0]?.agent_id as string | undefined;

        if (agent_id && outcomeLabel !== 'neutral') {
          const chResult = await db.query<Record<string, unknown>>(
            `SELECT id FROM compile_history
             WHERE project_id = ? AND agent_id = ? AND compiled_at <= ?
             ORDER BY compiled_at DESC LIMIT 1`,
            [project_id, agent_id, ended_at],
          );
          const compile_history_id = chResult.rows[0]?.id as string | undefined;

          if (compile_history_id) {
            const outcome_type = outcomeLabel === 'positive' ? 'success' : 'failure';
            const outcome_score = outcomeLabel === 'positive' ? 0.9 : 0.1;
            await attributeOutcomeToDecisions({
              compile_history_id,
              project_id,
              agent_id,
              outcome_type,
              outcome_score,
              notes: `session_end signal: ${signal_source}`,
              snippet_ids,
            });
            // Invalidate caches so next compile reflects the updated scores
            invalidateDecisionCaches(project_id).catch(() => {});
          }
        }
      } catch (err) {
        console.warn('[hipp0:session-end] Outcome attribution failed:', (err as Error).message);
      }

      logAudit('hermes_session_outcome', project_id, {
        session_id,
        rating: outcomeLabel,
        signal_source,
        snippet_count: snippet_ids.length,
      });
    }

    logAudit('hermes_session_end', project_id, { session_id });

    broadcast('hermes.session.ended', {
      project_id,
      session_id,
      ended_at,
    });

    // Rolling summary is a later-phase feature — return empty list for now.
    return c.json({
      session_id,
      ended_at,
      summary_snippet_ids: [],
    });
  });

  // -----------------------------------------------------------------------
  // POST /api/hermes/user-facts — upsert facts with ETag optimistic lock
  // -----------------------------------------------------------------------
  app.post('/api/hermes/user-facts', async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const project_id = requireUUID(body.project_id, 'project_id');
    await requireProjectAccess(c, project_id);
    const external_user_id = requireString(body.external_user_id, 'external_user_id', 200);

    if (!Array.isArray(body.facts) || body.facts.length === 0) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'facts must be a non-empty array' } }, 400);
    }
    // Cap payload size: each fact does N DB round-trips, so an unbounded
    // array is a cheap DOS vector. 100 matches the snippet_ids cap below.
    if (body.facts.length > 100) {
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: 'facts must contain at most 100 entries' } },
        400,
      );
    }
    const facts: HermesUserFact[] = body.facts.map((f, i) => {
      if (typeof f !== 'object' || f === null) {
        throw new Error(`facts[${i}] must be an object`);
      }
      const obj = f as Record<string, unknown>;
      return {
        key: requireString(obj.key, `facts[${i}].key`, 200),
        value: requireString(obj.value, `facts[${i}].value`, 10_000),
        additive: obj.additive === true,
        source: optionalString(obj.source, `facts[${i}].source`, 200),
      };
    });

    const db = getDb();

    // Compute current version (max version across existing rows for this user)
    const versionResult = await db.query(
      `SELECT version FROM hermes_user_facts
        WHERE project_id = ? AND external_user_id = ?
        ORDER BY updated_at DESC
        LIMIT 1`,
      [project_id, external_user_id],
    );
    const currentVersion = versionResult.rows.length > 0
      ? (versionResult.rows[0] as Record<string, unknown>).version as string
      : null;

    const ifMatch = c.req.header('If-Match');
    if (ifMatch && currentVersion && ifMatch !== currentVersion) {
      return c.json(
        { error: 'version_conflict', current_version: currentVersion },
        409,
      );
    }

    const newVersion = crypto.randomUUID();
    const now = new Date().toISOString();

    // Atomic compare-and-swap: when the caller supplied If-Match AND rows
    // already exist, claim them in a single UPDATE guarded by
    // `version = ifMatch`. If two concurrent requests share the same
    // If-Match, only the first bumps `version`; the second's UPDATE affects
    // zero rows and we return 409 `version_conflict`. This is the
    // serialization point that makes the write race-safe.
    if (ifMatch && currentVersion) {
      const claim = await db.query(
        `UPDATE hermes_user_facts
            SET version = ?, updated_at = ?
          WHERE project_id = ? AND external_user_id = ? AND version = ?`,
        [newVersion, now, project_id, external_user_id, ifMatch],
      );
      if ((claim.rowCount ?? 0) === 0) {
        // Someone else won the race — re-read current version for the body.
        const reread = await db.query(
          `SELECT version FROM hermes_user_facts
            WHERE project_id = ? AND external_user_id = ?
            ORDER BY updated_at DESC
            LIMIT 1`,
          [project_id, external_user_id],
        );
        const latest = reread.rows.length > 0
          ? (reread.rows[0] as Record<string, unknown>).version as string
          : currentVersion;
        return c.json({ error: 'version_conflict', current_version: latest }, 409);
      }
    }

    for (const fact of facts) {
      if (fact.additive) {
        // Append-style upsert: store as a separate row with a suffix key.
        // Simpler semantics: create a new row with a unique derived key so
        // the unique index on (project_id, external_user_id, key) holds.
        const suffix = crypto.randomUUID().slice(0, 8);
        const derivedKey = `${fact.key}:${suffix}`;
        const rowId = crypto.randomUUID();
        await db.query(
          `INSERT INTO hermes_user_facts
             (id, project_id, external_user_id, key, value, source, version, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [rowId, project_id, external_user_id, derivedKey, fact.value, fact.source ?? null, newVersion, now],
        );
      } else {
        // Replace-style upsert on (project_id, external_user_id, key).
        // When If-Match was provided, the CAS above already bumped existing
        // rows to `newVersion`; this UPDATE is the per-key value rewrite.
        const existing = await db.query(
          `SELECT id FROM hermes_user_facts
            WHERE project_id = ? AND external_user_id = ? AND key = ?`,
          [project_id, external_user_id, fact.key],
        );
        if (existing.rows.length > 0) {
          const id = (existing.rows[0] as Record<string, unknown>).id as string;
          await db.query(
            `UPDATE hermes_user_facts
                SET value = ?, source = ?, version = ?, updated_at = ?
              WHERE id = ?`,
            [fact.value, fact.source ?? null, newVersion, now, id],
          );
        } else {
          const rowId = crypto.randomUUID();
          await db.query(
            `INSERT INTO hermes_user_facts
               (id, project_id, external_user_id, key, value, source, version, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [rowId, project_id, external_user_id, fact.key, fact.value, fact.source ?? null, newVersion, now],
          );
        }
      }
    }

    // Re-read the current snapshot
    const snapshotResult = await db.query(
      `SELECT key, value, source, updated_at FROM hermes_user_facts
        WHERE project_id = ? AND external_user_id = ?
        ORDER BY key ASC`,
      [project_id, external_user_id],
    );
    const factRecords = snapshotResult.rows.map((row) => {
      const r = row as Record<string, unknown>;
      return {
        key: r.key as string,
        value: r.value as string,
        source: (r.source as string | null) ?? null,
        updated_at: r.updated_at as string,
      };
    });

    logAudit('hermes_user_facts_upsert', project_id, {
      external_user_id,
      fact_count: facts.length,
      version: newVersion,
    });

    // Publish the new version in BOTH locations so clients can use whichever
    // they prefer: body.version (the canonical field) and the ETag header
    // (standard HTTP optimistic-lock convention). Clients should send it back
    // in the If-Match header on subsequent POSTs.
    c.header('ETag', newVersion);
    return c.json({
      external_user_id,
      version: newVersion,
      facts: factRecords,
    });
  });

  // -----------------------------------------------------------------------
  // GET /api/hermes/user-facts — read current facts snapshot
  // -----------------------------------------------------------------------
  app.get('/api/hermes/user-facts', async (c) => {
    const project_id = requireUUID(c.req.query('project_id'), 'project_id');
    await requireProjectAccess(c, project_id);
    const external_user_id = requireString(c.req.query('external_user_id'), 'external_user_id', 200);

    // Pagination: `limit` clamped to [1, 500], default 100. `offset` >= 0,
    // default 0. We fetch `limit + 1` and derive `has_more` from whether
    // the extra row came back — avoids a second COUNT(*) query.
    const rawLimit = parseInt(c.req.query('limit') ?? '100', 10);
    const limit = Math.min(Math.max(Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 100, 1), 500);
    const rawOffset = parseInt(c.req.query('offset') ?? '0', 10);
    const offset = Math.max(Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0, 0);

    const db = getDb();
    const result = await db.query(
      `SELECT key, value, source, version, updated_at FROM hermes_user_facts
        WHERE project_id = ? AND external_user_id = ?
        ORDER BY updated_at DESC, key ASC
        LIMIT ? OFFSET ?`,
      [project_id, external_user_id, limit + 1, offset],
    );

    const hasMore = result.rows.length > limit;
    const pageRows = hasMore ? result.rows.slice(0, limit) : result.rows;

    if (pageRows.length === 0) {
      return c.json({
        external_user_id,
        version: null,
        facts: [],
        offset,
        limit,
        has_more: false,
      });
    }

    const version = (pageRows[0] as Record<string, unknown>).version as string;
    const facts = pageRows.map((row) => {
      const r = row as Record<string, unknown>;
      return {
        key: r.key as string,
        value: r.value as string,
        source: (r.source as string | null) ?? null,
        updated_at: r.updated_at as string,
      };
    });

    // Mirror the version in the ETag header so clients can use either
    // body.version or HTTP If-None-Match / If-Match semantics.
    c.header('ETag', version);
    return c.json({
      external_user_id,
      version,
      facts,
      offset,
      limit,
      has_more: hasMore,
    });
  });

  // -----------------------------------------------------------------------
  // GET /api/hermes/captures — recent captures with conversation_text
  //
  // Used by the Hermes REPL to inject raw conversation transcripts into
  // the system prompt as a cross-session memory fallback when the
  // distillery / compile pipeline hasn't extracted structured facts yet.
  // -----------------------------------------------------------------------
  app.get('/api/hermes/captures', async (c) => {
    const project_id = requireUUID(c.req.query('project_id'), 'project_id');
    await requireProjectAccess(c, project_id);
    const agent_name = optionalString(c.req.query('agent_name'), 'agent_name', 64) ?? null;
    const limit = Math.min(parseInt(c.req.query('limit') ?? '10', 10) || 10, 50);

    const db = getDb();

    let sql = `SELECT id, project_id, agent_name, session_id, source, conversation_text, status, created_at
       FROM captures
       WHERE project_id = ?`;
    const params: unknown[] = [project_id];

    if (agent_name) {
      sql += ' AND agent_name = ?';
      params.push(agent_name);
    }

    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const result = await db.query(sql, params);

    const captures = result.rows.map((row) => {
      const r = row as Record<string, unknown>;
      return {
        id: r.id as string,
        project_id: r.project_id as string,
        agent_name: r.agent_name as string,
        session_id: (r.session_id as string | null) ?? null,
        source: r.source as string,
        conversation_text: r.conversation_text as string,
        status: r.status as string,
        created_at: r.created_at as string,
      };
    });

    return c.json(captures);
  });

  // -----------------------------------------------------------------------
  // GET /api/hermes/extracted-facts — lightweight query for distillery-
  // extracted user_facts (from the user_facts table, NOT hermes_user_facts).
  // Used by the Hermes REPL for USER.md sync without pulling the full
  // 1MB+ compile response.
  // -----------------------------------------------------------------------
  app.get('/api/hermes/extracted-facts', async (c) => {
    const project_id = requireUUID(c.req.query('project_id'), 'project_id');
    await requireProjectAccess(c, project_id);
    const agent_name = optionalString(c.req.query('agent_name'), 'agent_name', 64) ?? null;

    const db = getDb();

    let sql = `SELECT fact_key, fact_value, confidence, source, created_at, updated_at
       FROM user_facts WHERE project_id = ? AND is_active = true`;
    const params: unknown[] = [project_id];

    if (agent_name) {
      sql += ' AND (agent_name = ? OR agent_name IS NULL)';
      params.push(agent_name);
    }

    sql += ' ORDER BY updated_at DESC LIMIT 50';

    const result = await db.query(sql, params);

    const facts = result.rows.map((row) => {
      const r = row as Record<string, unknown>;
      return {
        key: r.fact_key as string,
        value: r.fact_value as string,
        confidence: (r.confidence as number) ?? 1.0,
        source: (r.source as string | null) ?? null,
        created_at: r.created_at as string,
        updated_at: r.updated_at as string,
      };
    });

    return c.json({ project_id, agent_name, facts });
  });

  // -----------------------------------------------------------------------
  // POST /api/hermes/outcomes — snippet-level reinforcement signal
  // -----------------------------------------------------------------------
  //
  // The per-turn outcome signal from the Hermes persistent-agents brief.
  // Distinct from POST /api/outcomes, which is the compile-request /
  // alignment-analysis flow (see routes/outcomes.ts). Added in response to
  // HIPP0_REQUESTS.md §6 during the H6 Tier 2 live-smoke run — the Python
  // Hipp0MemoryProvider.record_outcome() targets this path.
  //
  // Schema lives in migration 037 (SQLite) / 055 (Postgres).
  app.post('/api/hermes/outcomes', async (c) => {
    const body = await c.req.json<Record<string, unknown>>();

    const project_id = requireUUID(body.project_id, 'project_id');
    await requireProjectAccess(c, project_id);
    // session_id is opaque TEXT in the DB but must still be a UUID on the
    // wire — the Python provider gets one from /api/hermes/session/start.
    const session_id = requireUUID(body.session_id, 'session_id');

    const outcome_raw = requireString(body.outcome, 'outcome', 50);
    const VALID_OUTCOMES = ['positive', 'neutral', 'negative'] as const;
    if (!(VALID_OUTCOMES as readonly string[]).includes(outcome_raw)) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: `outcome must be one of: ${VALID_OUTCOMES.join(', ')}`,
          },
        },
        400,
      );
    }
    const outcome = outcome_raw as (typeof VALID_OUTCOMES)[number];

    const signal_source = requireString(body.signal_source, 'signal_source', 200);
    const note = optionalString(body.note, 'note', 10_000) ?? null;

    if (!Array.isArray(body.snippet_ids)) {
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: 'snippet_ids must be an array' } },
        400,
      );
    }
    if (body.snippet_ids.length > 100) {
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: 'snippet_ids must contain at most 100 entries' } },
        400,
      );
    }
    const snippet_ids: string[] = body.snippet_ids.map((v, i) =>
      requireUUID(v, `snippet_ids[${i}]`),
    );

    const db = getDb();
    const outcome_id = crypto.randomUUID();
    const recorded_at = new Date().toISOString();

    try {
      await db.query(
        `INSERT INTO hermes_outcomes
           (id, project_id, session_id, outcome, snippet_ids_json,
            signal_source, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          outcome_id,
          project_id,
          session_id,
          outcome,
          JSON.stringify(snippet_ids),
          signal_source,
          note,
          recorded_at,
        ],
      );
    } catch (err) {
      mapDbError(err);
      return; // unreachable — mapDbError always throws
    }

    // Close the outcome→learning loop: attribute this reinforcement signal
    // to the decisions used in the most recent compile_history for the
    // session's agent+project. hermes_outcomes carries an opaque session_id
    // and snippet_ids, neither of which directly identify decisions, so we
    // look up the agent from hermes_conversations and pick the latest
    // compile_history row for that agent+project at or before the outcome
    // time. Failure here must not break the outcome write.
    try {
      const convResult = await db.query<Record<string, unknown>>(
        'SELECT agent_id FROM hermes_conversations WHERE session_id = ?',
        [session_id],
      );
      const agent_id = convResult.rows[0]?.agent_id as string | undefined;
      if (agent_id) {
        const chResult = await db.query<Record<string, unknown>>(
          `SELECT id FROM compile_history
           WHERE project_id = ? AND agent_id = ? AND compiled_at <= ?
           ORDER BY compiled_at DESC LIMIT 1`,
          [project_id, agent_id, recorded_at],
        );
        const compile_history_id = chResult.rows[0]?.id as string | undefined;
        if (compile_history_id) {
          const outcome_type =
            outcome === 'positive' ? 'success' : outcome === 'negative' ? 'failure' : 'partial';
          const outcome_score =
            outcome === 'positive' ? 0.9 : outcome === 'negative' ? 0.1 : 0.5;
          await attributeOutcomeToDecisions({
            compile_history_id,
            project_id,
            agent_id,
            outcome_type,
            outcome_score,
            notes: note ?? undefined,
            // Restrict attribution to the snippets the client actually
            // reacted to. Without this, a reaction on one snippet would
            // spread to every decision in the brief — or a buggy client
            // could stuff arbitrary ids and skew scoring project-wide.
            snippet_ids,
          });
          // Propagate outcome signal to entities linked to attributed decisions
          try {
            const decisionIdsRes = await db.query<Record<string, unknown>>(
              'SELECT decision_ids FROM compile_history WHERE id = ?',
              [compile_history_id],
            );
            const decisionIds: string[] = (() => {
              const raw = decisionIdsRes.rows[0]?.decision_ids;
              if (typeof raw === 'string') {
                try { return JSON.parse(raw); } catch { return []; }
              }
              return Array.isArray(raw) ? raw as string[] : [];
            })();
            const entityOutcome =
              outcome === 'positive' ? 'positive' : outcome === 'negative' ? 'negative' : 'partial';
            for (const did of decisionIds.slice(0, 10)) {
              propagateOutcomeToEntities(project_id, did, entityOutcome, 'hermes_outcome').catch(() => {});
            }
          } catch {
            // Non-fatal: entity propagation must not block the outcome response
          }
        }
      }
    } catch (err) {
      console.warn('[hipp0:hermes-outcomes] Decision attribution failed:', (err as Error).message);
    }

    logAudit('hermes_outcome_recorded', project_id, {
      outcome_id,
      session_id,
      outcome,
      snippet_count: snippet_ids.length,
      signal_source,
    });

    // Invalidate compile caches BEFORE the websocket broadcast. A client that
    // reacts to the broadcast by immediately calling /api/compile must see
    // the refreshed ranking — if broadcast fires first, a fast client races
    // the eviction and reads the stale context_cache row that was supposed
    // to be evicted by this very reaction. Ordering matters: evict, then
    // announce. We await here so the 201 response is the commitment that
    // subsequent compiles will re-score.
    try {
      await invalidateDecisionCaches(project_id);
    } catch (err) {
      console.warn('[hipp0:hermes-outcomes] cache invalidation failed:', (err as Error).message);
    }

    broadcast('hermes.outcome.recorded', {
      project_id,
      outcome_id,
      session_id,
      outcome,
      signal_source,
      recorded_at,
    });

    return c.json({ outcome_id, recorded_at }, 201);
  });
}
