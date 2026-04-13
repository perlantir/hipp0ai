/**
 * Demo API Routes — public (no auth), registered BEFORE auth middleware.
 *
 * GET  /api/demo/agents    — list 6 demo agents
 * POST /api/demo/compile   — run compile on demo project (rate limited)
 * GET  /api/demo/stats     — decision/agent/edge/contradiction counts
 * GET  /api/demo/decisions  — all demo decisions (title, tags, affects, confidence)
 */

import type { Hono } from 'hono';
import { getDb } from '@hipp0/core/db/index.js';
import { compileContext } from '@hipp0/core/context-compiler/index.js';
import type { CompileRequest } from '@hipp0/core/types.js';

const DEMO_PROJECT_ID = 'de000000-0000-4000-8000-000000000001';

/** Simple IP-based rate limiter for the demo compile endpoint. */
const ipHits = new Map<string, { count: number; resetAt: number }>();
const DEMO_RATE_LIMIT = 20; // requests per minute
const DEMO_WINDOW_MS = 60_000;

function isDemoRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = ipHits.get(ip);
  if (!entry || now > entry.resetAt) {
    ipHits.set(ip, { count: 1, resetAt: now + DEMO_WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > DEMO_RATE_LIMIT;
}

export function registerDemoRoutes(app: Hono): void {
    // GET /api/demo/agents
  app.get('/api/demo/agents', async (c) => {
    const db = getDb();
    try {
      const result = await db.query(
        `SELECT name, role, relevance_profile FROM agents
         WHERE project_id = ? ORDER BY created_at ASC`,
        [DEMO_PROJECT_ID],
      );
      const agents = result.rows.map((r: Record<string, unknown>) => ({
        name: r.name as string,
        role: r.role as string,
        description: getAgentDescription(r.name as string),
      }));
      return c.json(agents);
    } catch (err) {
      return c.json({ error: 'Demo data not available' }, 503);
    }
  });

    // POST /api/demo/compile
  app.post('/api/demo/compile', async (c) => {
    const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';
    if (isDemoRateLimited(ip)) {
      return c.json(
        { error: 'Rate limited. Sign up for unlimited access.' },
        429,
      );
    }

    let body: { agent_name?: string; task_description?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const agentName = body.agent_name?.trim();
    const taskDescription = body.task_description?.trim();

    if (!agentName || !taskDescription) {
      return c.json({ error: 'agent_name and task_description are required' }, 400);
    }

    if (taskDescription.length > 2000) {
      return c.json({ error: 'task_description must be 2000 characters or fewer' }, 400);
    }

    try {
      const request: CompileRequest = {
        agent_name: agentName,
        project_id: DEMO_PROJECT_ID,
        task_description: taskDescription,
      };

      const result = await compileContext(request);
      return c.json({
        agent_name: agentName,
        decisions_included: result.decisions_included,
        decisions_considered: result.decisions_considered,
        compilation_time_ms: result.compilation_time_ms,
        decisions: result.decisions.slice(0, 15).map((d) => ({
          title: d.title,
          score: d.combined_score,
          tags: d.tags,
          affects: d.affects,
          confidence: d.confidence,
        })),
      });
    } catch (err) {
      console.error('[hipp0/demo] Compile error:', (err as Error).message);
      return c.json({ error: 'Demo compile failed. Please try again.' }, 500);
    }
  });

    // GET /api/demo/stats
  app.get('/api/demo/stats', async (c) => {
    const db = getDb();
    try {
      const [decisions, agents, edges, contradictions] = await Promise.all([
        db.query('SELECT COUNT(*) as c FROM decisions WHERE project_id = ?', [DEMO_PROJECT_ID]),
        db.query('SELECT COUNT(*) as c FROM agents WHERE project_id = ?', [DEMO_PROJECT_ID]),
        db.query(
          `SELECT COUNT(*) as c FROM decision_edges
           WHERE source_id IN (SELECT id FROM decisions WHERE project_id = ?)`,
          [DEMO_PROJECT_ID],
        ).catch(() => ({ rows: [{ c: 0 }] })),
        db.query(
          'SELECT COUNT(*) as c FROM contradictions WHERE project_id = ?',
          [DEMO_PROJECT_ID],
        ).catch(() => ({ rows: [{ c: 0 }] })),
      ]);

      return c.json({
        decisions: parseInt((decisions.rows[0] as Record<string, unknown>).c as string ?? '0', 10),
        agents: parseInt((agents.rows[0] as Record<string, unknown>).c as string ?? '0', 10),
        edges: parseInt((edges.rows[0] as Record<string, unknown>).c as string ?? '0', 10),
        contradictions: parseInt((contradictions.rows[0] as Record<string, unknown>).c as string ?? '0', 10),
      });
    } catch {
      return c.json({ error: 'Demo data not available' }, 503);
    }
  });

    // GET /api/demo/decisions
  app.get('/api/demo/decisions', async (c) => {
    const db = getDb();
    try {
      const result = await db.query(
        `SELECT title, tags, affects, confidence, created_at
         FROM decisions WHERE project_id = ?
         ORDER BY created_at DESC`,
        [DEMO_PROJECT_ID],
      );

      const decisions = result.rows.map((r: Record<string, unknown>) => {
        let tags: string[] = [];
        if (Array.isArray(r.tags)) {
          tags = r.tags as string[];
        } else if (typeof r.tags === 'string') {
          try { tags = JSON.parse(r.tags as string); } catch { tags = []; }
        }

        let affects: string[] = [];
        if (Array.isArray(r.affects)) {
          affects = r.affects as string[];
        } else if (typeof r.affects === 'string') {
          try { affects = JSON.parse(r.affects as string); } catch { affects = []; }
        }

        return {
          title: r.title as string,
          tags,
          affects,
          confidence: r.confidence as string,
        };
      });

      return c.json(decisions);
    } catch {
      return c.json({ error: 'Demo data not available' }, 503);
    }
  });
}

/** Human-readable agent descriptions for the playground UI. */
function getAgentDescription(name: string): string {
  const descriptions: Record<string, string> = {
    architect: 'System design, scalability, infrastructure, database choices',
    frontend: 'UI, React, CSS, components, user experience, accessibility',
    backend: 'API, database, auth, server, performance, caching',
    security: 'Auth, encryption, OWASP, vulnerabilities, access control, secrets',
    marketer: 'Positioning, launch, pricing, landing page, SEO, messaging',
    devops: 'Deployment, CI/CD, Docker, monitoring, infrastructure, scaling',
  };
  return descriptions[name] || name;
}
