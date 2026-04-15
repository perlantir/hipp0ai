import type { Hono } from 'hono';
import { getDb } from '@hipp0/core/db/index.js';
import { distill } from '@hipp0/core/distillery/index.js';
import { scanProjectContradictions } from '@hipp0/core/contradiction-detector/index.js';
import { dispatchWebhooks } from '@hipp0/core/webhooks/index.js';
import {
  requireUUID,
  requireString,
  mapDbError,
  logAudit,
} from './validation.js';
import { requireProjectAccess } from './_helpers.js';

import crypto from 'node:crypto';

function getHipp0ApiKey(): string | undefined {
  return process.env.HIPP0_API_KEY;
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  const len = Math.max(bufA.length, bufB.length);
  const paddedA = Buffer.concat([bufA, Buffer.alloc(Math.max(0, len - bufA.length))]);
  const paddedB = Buffer.concat([bufB, Buffer.alloc(Math.max(0, len - bufB.length))]);
  return crypto.timingSafeEqual(paddedA, paddedB) && bufA.length === bufB.length;
}

export function registerDiscoveryRoutes(app: Hono): void {
  // POST /api/projects/:id/import — Bulk import conversation transcripts
  app.post('/api/projects/:id/import', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);

    const body = await c.req.json<{
      conversations?: unknown;
    }>();

    if (!Array.isArray(body.conversations)) {
      return c.json({ error: 'conversations must be an array' }, 400);
    }

    const conversations = body.conversations as Array<{
      text?: unknown;
      agent_name?: unknown;
      source_id?: unknown;
    }>;

    let processed = 0;
    let decisions_extracted = 0;
    let errors = 0;
    const results: Array<{
      source_id: string;
      decisions_extracted: number;
      error?: string;
    }> = [];

    for (let i = 0; i < conversations.length; i++) {
      const conv = conversations[i];
      const sourceId =
        typeof conv.source_id === 'string' && conv.source_id.trim()
          ? conv.source_id.trim()
          : `import-${i}`;

      let text: string;
      try {
        text = requireString(conv.text, `conversations[${i}].text`, 200000);
      } catch (err) {
        errors++;
        results.push({
          source_id: sourceId,
          decisions_extracted: 0,
          error: 'Invalid discovery request',
        });
        continue;
      }

      const agentName =
        typeof conv.agent_name === 'string' && conv.agent_name.trim()
          ? conv.agent_name.trim()
          : 'import';

      try {
        const result = await distill(projectId, text, agentName);
        processed++;
        decisions_extracted += result.decisions_extracted;
        results.push({
          source_id: sourceId,
          decisions_extracted: result.decisions_extracted,
        });
      } catch (err) {
        errors++;
        results.push({
          source_id: sourceId,
          decisions_extracted: 0,
          error: 'Discovery operation failed',
        });
      }
    }

    logAudit('bulk_import_completed', projectId, {
      processed,
      decisions_extracted,
      errors,
      total: conversations.length,
    });

    return c.json({ processed, decisions_extracted, errors, results });
  });

  // POST /api/ingest/webhook — Webhook receiver
  app.post('/api/ingest/webhook', async (c) => {
    const body = await c.req.json<{
      text?: unknown;
      content?: unknown;
      conversation?: unknown;
      agent_name?: unknown;
      source_id?: unknown;
      project_id?: unknown;
      metadata?: Record<string, unknown>;
    }>();

    let text: string;
    let sourceId: string;
    let projectId: string;

    // Validate required body fields BEFORE auth so missing-field requests get 400
    // (not 401) regardless of whether the caller supplied a Bearer token.
    try {
      const rawText = body.text ?? body.content ?? body.conversation;
      text = requireString(rawText, 'text', 200000);
      sourceId = typeof body.source_id === 'string' && body.source_id.trim() ? body.source_id.trim() : `webhook-${Date.now()}`;
      projectId = requireUUID(body.project_id, 'project_id');
    } catch (err) {
      return c.json({ error: 'Invalid discovery request' }, 400);
    }

    // Bearer token auth (independent of session auth)
    const apiKey = getHipp0ApiKey();
    if (apiKey) {
      const authHeader = c.req.header('Authorization') ?? '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
      if (!safeEqual(token, apiKey)) {
        return c.json({ error: 'Unauthorized' }, 401);
      }
    }

    const agentName =
      typeof body.agent_name === 'string' && body.agent_name.trim()
        ? body.agent_name.trim()
        : 'webhook';

    await requireProjectAccess(c, projectId);

    // Fire-and-forget: process via distill (acts as processChunk)
    distill(projectId, text, agentName)
      .then((result) => {
        logAudit('webhook_processed', projectId, {
          source_id: sourceId,
          decisions_extracted: result.decisions_extracted,
          agent_name: agentName,
        });
      })
      .catch((err: unknown) => {
        console.error('[hipp0] Webhook processing failed:', (err as Error).message);
      });

    return c.json({ queued: true, source_id: sourceId });
  });

  // GET /api/projects/:id/connectors — List configured connectors
  app.get('/api/projects/:id/connectors', async (c) => {
    const db = getDb();
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);

    const result = await db.query(
      `SELECT * FROM connector_configs WHERE project_id = ? ORDER BY created_at ASC`,
      [projectId],
    );

    return c.json(result.rows);
  });

  // POST /api/projects/:id/connectors — Add/update connector config
  app.post('/api/projects/:id/connectors', async (c) => {
    const db = getDb();
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);

    const body = await c.req.json<{
      connector_name?: unknown;
      enabled?: unknown;
      config?: unknown;
    }>();

    let connectorName: string;
    try {
      connectorName = requireString(body.connector_name, 'connector_name', 200);
    } catch (err) {
      return c.json({ error: 'Invalid discovery request' }, 400);
    }

    const enabled = body.enabled !== false; // default true
    const config =
      body.config !== null && typeof body.config === 'object' && !Array.isArray(body.config)
        ? (body.config as Record<string, unknown>)
        : {};

    try {
      const result = await db.query(
        `INSERT INTO connector_configs (project_id, connector_name, enabled, config)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (project_id, connector_name) DO UPDATE
           SET enabled = EXCLUDED.enabled,
               config = EXCLUDED.config,
               updated_at = NOW()
         RETURNING *`,
        [projectId, connectorName, enabled, JSON.stringify(config)],
      );

      logAudit('connector_upserted', projectId, {
        connector_name: connectorName,
        enabled,
      });

      return c.json(result.rows[0], 201);
    } catch (err) {
      mapDbError(err);
    }
  });

  // DELETE /api/projects/:id/connectors/:name — Remove connector
  app.delete('/api/projects/:id/connectors/:name', async (c) => {
    const db = getDb();
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);
    const connectorName = c.req.param('name');

    if (!connectorName || connectorName.trim().length === 0) {
      return c.json({ error: 'connector name is required' }, 400);
    }

    const result = await db.query(
      `DELETE FROM connector_configs WHERE project_id = ? AND connector_name = ? RETURNING id`,
      [projectId, connectorName],
    );

    if (result.rows.length === 0) {
      return c.json({ error: 'Connector not found' }, 404);
    }

    logAudit('connector_deleted', projectId, { connector_name: connectorName });

    return c.json({ deleted: true, connector_name: connectorName });
  });

  // GET /api/projects/:id/discovery/status — Auto-discovery health/stats
  app.get('/api/projects/:id/discovery/status', async (c) => {
    const db = getDb();
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);

    const [connectorsResult, countResult, recentResult] = await Promise.all([
      db.query(
        `SELECT connector_name, enabled, last_poll_at
         FROM connector_configs
         WHERE project_id = ?
         ORDER BY connector_name ASC`,
        [projectId],
      ),
      db.query(
        `SELECT COUNT(*) AS count FROM processed_sources WHERE project_id = ?`,
        [projectId],
      ),
      db.query(
        `SELECT * FROM processed_sources
         WHERE project_id = ?
         ORDER BY processed_at DESC
         LIMIT 20`,
        [projectId],
      ),
    ]);

    const processed_count = parseInt(
      (connectorsResult.rows.length >= 0
        ? (countResult.rows[0] as Record<string, unknown>)?.count
        : '0') as string,
      10,
    );

    return c.json({
      connectors: connectorsResult.rows.map((r) => {
        const row = r as Record<string, unknown>;
        return {
          name: row.connector_name,
          enabled: row.enabled,
          last_poll_at: row.last_poll_at ?? null,
        };
      }),
      processed_count,
      recent_sources: recentResult.rows,
    });
  });

  // POST /api/projects/:id/scan-contradictions — One-time contradiction scan
  app.post('/api/projects/:id/scan-contradictions', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);

    try {
      const result = await scanProjectContradictions(projectId);

      logAudit('contradiction_scan_completed', projectId, {
        pairs_checked: result.pairs_checked,
        contradictions_found: result.contradictions_found,
      });

      dispatchWebhooks(projectId, 'scan_completed', {
        pairs_checked: result.pairs_checked,
        contradictions_found: result.contradictions_found,
      }).catch((err) => console.warn('[hipp0:webhook]', (err as Error).message));

      return c.json(result);
    } catch (err) {
      console.error('[hipp0] Contradiction scan failed:', (err as Error).message);
      return c.json({ error: 'Discovery operation failed' }, 500);
    }
  });
}
