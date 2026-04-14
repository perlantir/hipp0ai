import type { Hono } from 'hono';
import { getDb } from '@hipp0/core/db/index.js';
import { parseAuditEntry } from '@hipp0/core/db/parsers.js';
import { requireUUID } from './validation.js';
import { requireProjectAccess } from './_helpers.js';

export function registerAuditRoutes(app: Hono): void {
  app.get('/api/projects/:id/audit', async (c) => {
    const db = getDb();
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);
    const eventType = c.req.query('event_type');
    const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 500);

    const conditions = ['project_id = ?'];
    const params: unknown[] = [projectId];

    if (eventType) {
      conditions.push(`event_type = ?`);
      params.push(eventType);
    }

    params.push(limit);

    const result = await db.query(
      `SELECT * FROM audit_log
       WHERE ${conditions.join(' AND ')}
       ORDER BY created_at DESC
       LIMIT ?`,
      params,
    );

    return c.json(result.rows.map((r) => parseAuditEntry(r as Record<string, unknown>)));
  });
}
