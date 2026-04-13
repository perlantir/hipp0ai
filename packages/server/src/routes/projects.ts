import type { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { getDb } from '@hipp0/core/db/index.js';
import { parseProject } from '@hipp0/core/db/parsers.js';
import { NotFoundError } from '@hipp0/core/types.js';
import { requireUUID, requireString, optionalString, mapDbError } from './validation.js';
import { generateApiKey } from '../bootstrap-keys.js';
import { isAuthRequired, getTenantId } from '../auth/middleware.js';
import { DEFAULT_TENANT_ID, DEFAULT_USER_ID } from '../constants.js';

export function registerProjectRoutes(app: Hono): void {
  app.post('/api/projects', async (c) => {
    const db = getDb();
    const body = await c.req.json<{
      name?: unknown;
      description?: unknown;
      metadata?: Record<string, unknown>;
    }>();

    const name = requireString(body.name, 'name', 500);
    const description = optionalString(body.description, 'description', 10000);

    const tenantId = isAuthRequired() ? getTenantId(c) : 'a0000000-0000-4000-8000-000000000001';

    try {
      // Client-generate the project id so the INSERT works on SQLite. The
      // Postgres schema has DEFAULT uuid_generate_v4() on projects.id, but
      // the SQLite schema has no default — omitting id crashed with
      // `NOT NULL constraint failed: projects.id` on every dashboard
      // "create project" call on SQLite. See 1a46f21 for the same pattern
      // applied to decisions.id and session_summaries.id.
      const projectId = randomUUID();
      const result = await db.query(
        `INSERT INTO projects (id, name, description, metadata, tenant_id)
         VALUES (?, ?, ?, ?, ?)
         RETURNING *`,
        [projectId, name, description ?? null, JSON.stringify(body.metadata ?? {}), tenantId],
      );
      const project = parseProject(result.rows[0] as Record<string, unknown>);

      // Auto-generate a default API key for the new project
      let apiKey: string | undefined;
      try {
        const { key, prefix, hash } = generateApiKey();
        // Same pattern: api_keys.id has no default on SQLite.
        const apiKeyId = randomUUID();
        await db.query(
          `INSERT INTO api_keys (id, tenant_id, project_id, name, key_hash, key_prefix, permissions, rate_limit, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [apiKeyId, DEFAULT_TENANT_ID, project.id, 'Default (auto-generated)', hash, prefix, 'admin', 1000, DEFAULT_USER_ID],
        );
        apiKey = key;

        const masked = key.slice(0, 16) + '...';
        console.warn(`[hipp0] API key generated for project "${name}": ${masked}`);
        // Tagged full-key emission for audit + deploy capture parity with
        // bootstrap-keys.ts. The HTTP response already returns the key to
        // the caller, so this is purely for journal-grep flows; the line
        // shape matches BOOTSTRAP_API_KEY for the deploy script's regex.
        console.warn(
          `[hipp0:BOOTSTRAP_API_KEY] project_id=${project.id} project_name="${name}" key=${key}`,
        );
      } catch {
        // api_keys table may not exist yet — project still created successfully
      }

      return c.json({
        ...project,
        ...(apiKey ? { api_key: apiKey, api_key_warning: 'Save this key now. It cannot be retrieved again.' } : {}),
      }, 201);
    } catch (err) {
      mapDbError(err);
    }
  });


  app.get('/api/projects', async (c) => {
    const db = getDb();
    let result;
    if (isAuthRequired()) {
      const tenantId = getTenantId(c);
      result = await db.query('SELECT * FROM projects WHERE tenant_id = ? ORDER BY created_at DESC', [tenantId]);
    } else {
      result = await db.query('SELECT * FROM projects ORDER BY created_at DESC', []);
    }
    return c.json(result.rows.map((r: Record<string, unknown>) => parseProject(r)));
  });

  app.get('/api/projects/:id', async (c) => {
    const db = getDb();
    const id = requireUUID(c.req.param('id'), 'id');
    const tenantId = isAuthRequired() ? getTenantId(c) : '';
    let result;
    if (tenantId) {
      result = await db.query('SELECT * FROM projects WHERE id = ? AND tenant_id = ?', [id, tenantId]);
    } else {
      result = await db.query('SELECT * FROM projects WHERE id = ?', [id]);
    }
    if (result.rows.length === 0) throw new NotFoundError('Project', id);
    return c.json(parseProject(result.rows[0] as Record<string, unknown>));
  });
}
