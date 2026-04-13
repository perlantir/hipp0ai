/**
 * Playground API routes - lets the public website try Hipp0 without signup.
 *
 * Each visitor gets an ephemeral SQLite-backed session (see session-manager.ts)
 * seeded with a realistic SaaS Platform demo project.
 */

import type { Hono } from 'hono';
import {
  createPlaygroundSession,
  getSession,
  getSessionDb,
  touchSession,
  getSessionStats,
} from '../playground/session-manager.js';
import { SCENARIOS, getScenario } from '../playground/scenarios.js';
import { compileContext } from '@hipp0/core/context-compiler/index.js';
import { withDbOverride } from '@hipp0/core/db/index.js';

// In-memory rate limiter: 100 req/min per IP
const rateLimits = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 100;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimits.get(ip);
  if (!entry || entry.resetAt < now) {
    rateLimits.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

function getClientIp(c: { req: { header: (key: string) => string | undefined } }): string {
  return (
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    'unknown'
  );
}

export function registerPlaygroundRoutes(app: Hono): void {
  // Create a new playground session
  app.post('/api/playground/sessions', async (c) => {
    const ip = getClientIp(c);
    if (!checkRateLimit(ip)) {
      return c.json({ error: 'Rate limit exceeded' }, 429);
    }

    try {
      const session = await createPlaygroundSession();
      return c.json(session, 201);
    } catch (err) {
      console.error('[playground] session creation failed:', (err as Error).message);
      return c.json({ error: 'Failed to create session' }, 500);
    }
  });

  // Get session info
  app.get('/api/playground/sessions/:sessionId', async (c) => {
    const sessionId = c.req.param('sessionId');
    const session = getSession(sessionId);
    if (!session) {
      return c.json({ error: 'Session not found or expired' }, 404);
    }
    return c.json({
      session_id: session.id,
      project_id: session.projectId,
      expires_at: session.expiresAt.toISOString(),
      last_activity_at: session.lastActivityAt.toISOString(),
    });
  });

  // List all scenarios
  app.get('/api/playground/scenarios', async (c) => {
    return c.json({ scenarios: SCENARIOS });
  });

  // Run a scenario or a custom task
  app.post('/api/playground/:sessionId/compile', async (c) => {
    const ip = getClientIp(c);
    if (!checkRateLimit(ip)) {
      return c.json({ error: 'Rate limit exceeded' }, 429);
    }

    const sessionId = c.req.param('sessionId');
    const session = getSession(sessionId);
    if (!session) {
      return c.json({ error: 'Session not found or expired' }, 404);
    }

    const db = getSessionDb(sessionId);
    if (!db) {
      return c.json({ error: 'Session DB not available' }, 500);
    }

    const body = await c.req.json<{
      agent_name?: string;
      task_description?: string;
      scenario_id?: string;
    }>();

    let agentName = body.agent_name || 'architect';
    let taskDescription = body.task_description || '';

    // If scenario_id provided, use the scenario's task
    if (body.scenario_id) {
      const scenario = getScenario(body.scenario_id);
      if (scenario) {
        taskDescription = scenario.task;
        if (scenario.agents[0]) agentName = scenario.agents[0];
      }
    }

    if (!taskDescription) {
      return c.json({ error: 'task_description or scenario_id required' }, 400);
    }

    touchSession(sessionId);

    try {
      // Use the session's isolated DB for this compile
      const result = await withDbOverride(db, () =>
        compileContext({
          project_id: session.projectId,
          agent_name: agentName,
          task_description: taskDescription,
        }),
      );

      return c.json({
        session_id: sessionId,
        project_id: session.projectId,
        agent_name: agentName,
        task_description: taskDescription,
        decisions: result.decisions.slice(0, 10),
        decisions_included: result.decisions_included,
        decisions_considered: result.decisions_considered,
        token_count: result.token_count,
        formatted_markdown: result.formatted_markdown,
      });
    } catch (err) {
      console.error('[playground] compile failed:', (err as Error).message);
      return c.json({ error: 'Compile failed', detail: (err as Error).message }, 500);
    }
  });

  // Compare two agents on the same task (split view)
  app.post('/api/playground/:sessionId/compare', async (c) => {
    const sessionId = c.req.param('sessionId');
    const session = getSession(sessionId);
    if (!session) return c.json({ error: 'Session not found or expired' }, 404);

    const db = getSessionDb(sessionId);
    if (!db) return c.json({ error: 'Session DB not available' }, 500);

    const body = await c.req.json<{
      task_description?: string;
      agent_a?: string;
      agent_b?: string;
    }>();
    const task = body.task_description || '';
    const agentA = body.agent_a || 'backend';
    const agentB = body.agent_b || 'frontend';

    if (!task) return c.json({ error: 'task_description required' }, 400);

    touchSession(sessionId);

    try {
      const [resultA, resultB] = await Promise.all([
        withDbOverride(db, () =>
          compileContext({
            project_id: session.projectId,
            agent_name: agentA,
            task_description: task,
          }),
        ),
        withDbOverride(db, () =>
          compileContext({
            project_id: session.projectId,
            agent_name: agentB,
            task_description: task,
          }),
        ),
      ]);

      return c.json({
        session_id: sessionId,
        task_description: task,
        agent_a: { name: agentA, decisions: resultA.decisions.slice(0, 5) },
        agent_b: { name: agentB, decisions: resultB.decisions.slice(0, 5) },
      });
    } catch (err) {
      console.error('[playground] compare failed:', (err as Error).message);
      return c.json({ error: 'Compare failed', detail: (err as Error).message }, 500);
    }
  });

  // Stats endpoint for monitoring
  app.get('/api/playground/stats', async (c) => {
    return c.json(getSessionStats());
  });
}
