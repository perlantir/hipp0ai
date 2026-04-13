/**
 * Per-Agent API Keys — CRUD routes.
 *
 *   POST   /api/projects/:id/agents/:agentId/keys        — create a fresh key
 *   GET    /api/projects/:id/agents/:agentId/keys        — list keys for agent
 *   DELETE /api/projects/:id/agents/:agentId/keys/:keyId — revoke a key
 *
 * Keys are minted as `h0_agent_<32 hex>` and only hashed before storage.
 * The raw key is returned exactly once at creation time; after that, the
 * UI can only see its hash prefix, last_used_at, and metadata.
 */
import type { Hono } from 'hono';
import { z } from 'zod';
import {
  createAgentApiKey,
  listAgentKeys,
  revokeAgentKey,
} from '@hipp0/core/intelligence/agent-keys.js';
import { getDb } from '@hipp0/core/db/index.js';
import { requireUUID, logAudit } from './validation.js';
import { requireProjectAccess } from './_helpers.js';

/** Validation schema for key creation request body. */
const createKeyBodySchema = z.object({
  name: z.string().min(1).max(200),
  scopes: z.array(z.string().min(1).max(50)).max(16).optional(),
});

export function registerAgentKeyRoutes(app: Hono): void {
  // ------------------------------------------------------------------
  // POST /api/projects/:id/agents/:agentId/keys
  // ------------------------------------------------------------------
  app.post('/api/projects/:id/agents/:agentId/keys', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    const agentId = requireUUID(c.req.param('agentId'), 'agentId');
    await requireProjectAccess(c, projectId);

    const body = await c.req.json().catch(() => ({}));
    const parsed = createKeyBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message:
              parsed.error.errors[0]?.message ?? 'Invalid request body',
          },
        },
        400,
      );
    }

    // Verify the agent exists and belongs to the project.
    const db = getDb();
    const agentRes = await db.query(
      'SELECT id, name FROM agents WHERE id = ? AND project_id = ? LIMIT 1',
      [agentId, projectId],
    );
    if (agentRes.rows.length === 0) {
      return c.json(
        { error: { code: 'NOT_FOUND', message: 'Agent not found in project' } },
        404,
      );
    }

    try {
      const { key, key_id } = await createAgentApiKey(
        projectId,
        agentId,
        parsed.data.name,
        parsed.data.scopes,
      );

      logAudit('agent_api_key_created', projectId, {
        agent_id: agentId,
        key_id,
        name: parsed.data.name,
      });

      return c.json(
        {
          id: key_id,
          key, // Raw key returned exactly ONCE
          name: parsed.data.name,
          agent_id: agentId,
          project_id: projectId,
          scopes: parsed.data.scopes ?? ['read', 'write'],
          warning:
            'Store this key securely. It will not be shown again.',
        },
        201,
      );
    } catch (err) {
      return c.json(
        {
          error: {
            code: 'INTERNAL_ERROR',
            message: (err as Error).message ?? 'Failed to create key',
          },
        },
        500,
      );
    }
  });

  // ------------------------------------------------------------------
  // GET /api/projects/:id/agents/:agentId/keys
  // ------------------------------------------------------------------
  app.get('/api/projects/:id/agents/:agentId/keys', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    const agentId = requireUUID(c.req.param('agentId'), 'agentId');
    await requireProjectAccess(c, projectId);

    try {
      const keys = await listAgentKeys(projectId, agentId);
      return c.json({ keys });
    } catch (err) {
      return c.json(
        {
          error: {
            code: 'INTERNAL_ERROR',
            message: (err as Error).message ?? 'Failed to list keys',
          },
        },
        500,
      );
    }
  });

  // ------------------------------------------------------------------
  // DELETE /api/projects/:id/agents/:agentId/keys/:keyId
  // ------------------------------------------------------------------
  app.delete('/api/projects/:id/agents/:agentId/keys/:keyId', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    const agentId = requireUUID(c.req.param('agentId'), 'agentId');
    const keyId = requireUUID(c.req.param('keyId'), 'keyId');
    await requireProjectAccess(c, projectId);

    // Confirm the key exists and is scoped to this project + agent
    // before calling revoke, so we return a 404 instead of a silent 200
    // when the caller is pointing at someone else's key.
    const db = getDb();
    const exists = await db.query(
      'SELECT id FROM api_keys WHERE id = ? AND project_id = ? AND agent_id = ? LIMIT 1',
      [keyId, projectId, agentId],
    );
    if (exists.rows.length === 0) {
      return c.json(
        { error: { code: 'NOT_FOUND', message: 'Key not found' } },
        404,
      );
    }

    try {
      await revokeAgentKey(keyId);
      logAudit('agent_api_key_revoked', projectId, {
        agent_id: agentId,
        key_id: keyId,
      });
      return c.json({ revoked: true, id: keyId });
    } catch (err) {
      return c.json(
        {
          error: {
            code: 'INTERNAL_ERROR',
            message: (err as Error).message ?? 'Failed to revoke key',
          },
        },
        500,
      );
    }
  });
}
