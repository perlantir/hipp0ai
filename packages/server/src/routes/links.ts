/**
 * Decision Links — CRUD routes for bidirectional PR↔decision linking.
 */
import type { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { getDb } from '@hipp0/core/db/index.js';
import { NotFoundError } from '@hipp0/core/types.js';
import { requireUUID, requireString, optionalString, mapDbError } from './validation.js';
import { getGitHubClient } from '../connectors/github-client.js';

const VALID_LINK_TYPES = ['implements', 'references', 'created_by', 'validates', 'affects'];
const VALID_PLATFORMS = ['github', 'gitlab', 'jira', 'linear'];

export function registerLinkRoutes(app: Hono): void {

  // GET /api/decisions/:id/links — All links for a decision
  app.get('/api/decisions/:id/links', async (c) => {
    const db = getDb();
    const decisionId = requireUUID(c.req.param('id'), 'id');

    const result = await db.query(
      `SELECT * FROM decision_links WHERE decision_id = ? ORDER BY created_at DESC`,
      [decisionId],
    );

    return c.json(result.rows);
  });

  // GET /api/projects/:id/links — All links for a project (optionally filter by platform)
  app.get('/api/projects/:id/links', async (c) => {
    const db = getDb();
    const projectId = requireUUID(c.req.param('id'), 'id');
    const platform = c.req.query('platform');

    if (platform) {
      const result = await db.query(
        `SELECT * FROM decision_links WHERE project_id = ? AND platform = ? ORDER BY created_at DESC`,
        [projectId, platform],
      );
      return c.json(result.rows);
    }

    const result = await db.query(
      `SELECT * FROM decision_links WHERE project_id = ? ORDER BY created_at DESC`,
      [projectId],
    );
    return c.json(result.rows);
  });

  // POST /api/decisions/:id/links — Manually create a link
  app.post('/api/decisions/:id/links', async (c) => {
    const db = getDb();
    const decisionId = requireUUID(c.req.param('id'), 'id');

    const body = await c.req.json<{
      platform?: unknown;
      external_id?: unknown;
      external_url?: unknown;
      link_type?: unknown;
      title?: unknown;
    }>();

    const platform = requireString(body.platform, 'platform', 50);
    const externalId = requireString(body.external_id, 'external_id', 500);
    const externalUrl = optionalString(body.external_url, 'external_url', 2000);
    const linkType = requireString(body.link_type, 'link_type', 50);
    const title = optionalString(body.title, 'title', 500);

    if (!VALID_LINK_TYPES.includes(linkType)) {
      return c.json({ error: `link_type must be one of: ${VALID_LINK_TYPES.join(', ')}` }, 400);
    }
    if (!VALID_PLATFORMS.includes(platform)) {
      return c.json({ error: `platform must be one of: ${VALID_PLATFORMS.join(', ')}` }, 400);
    }

    // Verify decision exists and get project_id
    const decision = await db.query('SELECT project_id FROM decisions WHERE id = ?', [decisionId]);
    if (decision.rows.length === 0) throw new NotFoundError('Decision', decisionId);
    const projectId = (decision.rows[0] as Record<string, unknown>).project_id as string;

    try {
      const result = await db.query(
        `INSERT INTO decision_links
         (id, decision_id, project_id, platform, external_id, external_url,
          link_type, title, status, linked_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', 'manual')
         RETURNING *`,
        [randomUUID(), decisionId, projectId, platform, externalId, externalUrl ?? null, linkType, title ?? null],
      );
      return c.json(result.rows[0], 201);
    } catch (err) {
      mapDbError(err);
    }
  });

  // DELETE /api/links/:id — Remove a link
  app.delete('/api/links/:id', async (c) => {
    const db = getDb();
    const linkId = requireUUID(c.req.param('id'), 'id');
    const projectId = c.req.query('project_id');
    if (!projectId) {
      return c.json({ error: 'project_id query parameter is required' }, 400);
    }

    const result = await db.query('DELETE FROM decision_links WHERE id = ? AND project_id = ? RETURNING id', [linkId, projectId]);
    if (result.rows.length === 0) throw new NotFoundError('Link', linkId);

    return c.json({ deleted: true, id: linkId });
  });

  // GET /api/projects/:id/github/status — GitHub connection status
  app.get('/api/projects/:id/github/status', async (c) => {
    const db = getDb();
    const projectId = requireUUID(c.req.param('id'), 'id');

    const client = getGitHubClient();
    const connected = client !== null;

    const stats = await db.query(
      `SELECT
         COUNT(*) as total_links,
         SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open_pr_links,
         SUM(CASE WHEN status = 'merged' THEN 1 ELSE 0 END) as merged_pr_links
       FROM decision_links
       WHERE project_id = ? AND platform = 'github'`,
      [projectId],
    );

    const row = (stats.rows[0] ?? {}) as Record<string, unknown>;

    return c.json({
      connected,
      app_id: process.env.HIPP0_GITHUB_APP_ID ?? null,
      installation_id: process.env.HIPP0_GITHUB_APP_INSTALLATION_ID ?? null,
      total_links: parseInt(String(row.total_links ?? '0'), 10),
      open_pr_links: parseInt(String(row.open_pr_links ?? '0'), 10),
      merged_pr_links: parseInt(String(row.merged_pr_links ?? '0'), 10),
    });
  });
}
