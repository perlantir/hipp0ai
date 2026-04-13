/**
 * Digest Routes — Weekly intelligence digest generation and retrieval.
 *
 * POST /api/projects/:id/digest/generate — Trigger manually
 * GET  /api/projects/:id/digest          — Get latest digest
 * GET  /api/projects/:id/digests         — List all digests
 */

import type { Hono } from 'hono';
import { getDb } from '@hipp0/core/db/index.js';
import { generateDigest } from '@hipp0/core/intelligence/weekly-digest.js';

export function registerDigestRoutes(app: Hono): void {
  // Trigger digest generation manually
  app.post('/api/projects/:id/digest/generate', async (c) => {
    const projectId = c.req.param('id');

    try {
      const result = await generateDigest(projectId);
      return c.json(result, 201);
    } catch (err) {
      console.error('[hipp0:digest] Generation failed:', (err as Error).message);
      return c.json({ error: 'Digest generation failed' }, 500);
    }
  });

  // Get latest digest for a project
  app.get('/api/projects/:id/digest', async (c) => {
    const db = getDb();
    const projectId = c.req.param('id');

    const result = await db.query(
      `SELECT * FROM digests
       WHERE project_id = ?
       ORDER BY generated_at DESC LIMIT 1`,
      [projectId],
    );

    if (result.rows.length === 0) {
      return c.json({ error: 'No digest found. Generate one first.' }, 404);
    }

    const row = result.rows[0] as Record<string, unknown>;
    return c.json({
      id: row.id,
      project_id: row.project_id,
      period_start: row.period_start,
      period_end: row.period_end,
      findings: typeof row.findings === 'string' ? JSON.parse(row.findings as string) : row.findings,
      summary: typeof row.summary === 'string' ? JSON.parse(row.summary as string) : row.summary,
      generated_at: row.generated_at,
    });
  });

  // List all digests for a project
  app.get('/api/projects/:id/digests', async (c) => {
    const db = getDb();
    const projectId = c.req.param('id');
    const limit = parseInt(c.req.query('limit') || '10', 10);

    const result = await db.query(
      `SELECT id, project_id, period_start, period_end, summary, generated_at
       FROM digests
       WHERE project_id = ?
       ORDER BY generated_at DESC
       LIMIT ?`,
      [projectId, Math.min(limit, 50)],
    );

    return c.json(result.rows.map((row: Record<string, unknown>) => ({
      id: row.id,
      period_start: row.period_start,
      period_end: row.period_end,
      summary: typeof row.summary === 'string' ? JSON.parse(row.summary as string) : row.summary,
      generated_at: row.generated_at,
    })));
  });
}
