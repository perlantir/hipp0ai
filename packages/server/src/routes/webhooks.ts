import type { Hono } from 'hono';
import { getDb } from '@hipp0/core/db/index.js';
import { NotFoundError, ValidationError } from '@hipp0/core/types.js';
import { testWebhook } from '@hipp0/core/webhooks/index.js';
import { requireUUID, requireString, mapDbError, logAudit } from './validation.js';
import { requireProjectAccess } from './_helpers.js';
import { randomUUID, randomBytes } from 'node:crypto';

/** Validate a webhook URL to prevent SSRF */
function validateWebhookUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ValidationError('Invalid webhook URL');
  }

  // In production, require HTTPS
  if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
    throw new ValidationError('Webhook URL must use HTTPS in production');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new ValidationError('Webhook URL must use HTTP or HTTPS');
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block localhost and loopback
  const blocked = [
    'localhost', '127.0.0.1', '0.0.0.0', '[::1]', '::1',
    '169.254.169.254', 'metadata.google.internal',
  ];
  if (blocked.includes(hostname)) {
    throw new ValidationError('Webhook URL must not target localhost or metadata services');
  }

  // Block private IP ranges
  const parts = hostname.split('.');
  if (parts.length === 4) {
    const first = parseInt(parts[0], 10);
    const second = parseInt(parts[1], 10);
    if (first === 10) throw new ValidationError('Webhook URL must not target private IPs');
    if (first === 172 && second >= 16 && second <= 31) throw new ValidationError('Webhook URL must not target private IPs');
    if (first === 192 && second === 168) throw new ValidationError('Webhook URL must not target private IPs');
    if (first === 127) throw new ValidationError('Webhook URL must not target loopback IPs');
    if (first === 169 && second === 254) throw new ValidationError('Webhook URL must not target link-local IPs');
  }

  // Block IPv6 private ranges
  if (hostname.startsWith('[fd') || hostname.startsWith('fd')) {
    throw new ValidationError('Webhook URL must not target private IPs');
  }
}

const VALID_PLATFORMS = ['generic', 'slack', 'discord', 'telegram'] as const;
const VALID_EVENTS = [
  'decision_created',
  'decision_superseded',
  'decision_reverted',
  'contradiction_detected',
  'distillery_completed',
  'scan_completed',
] as const;

function validatePlatform(val: unknown): string {
  if (typeof val !== 'string' || !(VALID_PLATFORMS as readonly string[]).includes(val)) {
    throw new ValidationError(
      `platform must be one of: ${VALID_PLATFORMS.join(', ')}`,
    );
  }
  return val;
}

function validateEvents(val: unknown): string[] {
  if (!Array.isArray(val)) throw new ValidationError('events must be an array');
  for (const e of val) {
    if (typeof e !== 'string' || !(VALID_EVENTS as readonly string[]).includes(e)) {
      throw new ValidationError(
        `Invalid event "${e}". Valid events: ${VALID_EVENTS.join(', ')}`,
      );
    }
  }
  return val as string[];
}

export function registerWebhookRoutes(app: Hono): void {
    // LIST
  app.get('/api/projects/:id/webhooks', async (c) => {
    const db = getDb();
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);

    const result = await db.query(
      'SELECT * FROM webhook_configs WHERE project_id = ? ORDER BY created_at DESC',
      [projectId],
    );

    const rows = result.rows.map((row) => {
      const w = { ...(row as Record<string, unknown>) };
      delete w.secret;
      (w as any).has_secret = true;
      return w;
    });

    return c.json(rows);
  });

    // CREATE
  app.post('/api/projects/:id/webhooks', async (c) => {
    const db = getDb();
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);
    const body = await c.req.json<{
      name?: unknown;
      url?: unknown;
      platform?: unknown;
      events?: unknown;
      secret?: unknown;
      metadata?: unknown;
    }>();

    const name = requireString(body.name, 'name', 200);
    const url = requireString(body.url, 'url', 2000);
    validateWebhookUrl(url);
    const platform = body.platform != null ? validatePlatform(body.platform) : 'generic';
    const events = body.events != null ? validateEvents(body.events) : [];
    // Secret is required — generate one if not provided
    const secret = body.secret != null ? requireString(body.secret, 'secret', 500) : randomBytes(32).toString('hex');
    const metadata = body.metadata ?? {};

    const id = randomUUID();

    try {
      const result = await db.query(
        `INSERT INTO webhook_configs (id, project_id, name, url, platform, events, enabled, secret, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING *`,
        [
          id,
          projectId,
          name,
          url,
          platform,
          db.arrayParam(events),
          db.dialect === 'sqlite' ? 1 : true,
          secret,
          JSON.stringify(metadata),
        ],
      );

      logAudit('webhook_created', projectId, { webhook_id: id, name, platform });

      return c.json(result.rows[0], 201);
    } catch (err) {
      mapDbError(err);
    }
  });

    // UPDATE
  app.patch('/api/projects/:id/webhooks/:whId', async (c) => {
    const db = getDb();
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);
    const whId = requireUUID(c.req.param('whId'), 'webhookId');
    const body = await c.req.json<{
      name?: unknown;
      url?: unknown;
      platform?: unknown;
      events?: unknown;
      enabled?: unknown;
      secret?: unknown;
      metadata?: unknown;
    }>();

    // Build dynamic SET clause
    const sets: string[] = [];
    const params: unknown[] = [];

    if (body.name != null) {
      sets.push('name = ?');
      params.push(requireString(body.name, 'name', 200));
    }
    if (body.url != null) {
      const newUrl = requireString(body.url, 'url', 2000);
      validateWebhookUrl(newUrl);
      sets.push('url = ?');
      params.push(newUrl);
    }
    if (body.platform != null) {
      sets.push('platform = ?');
      params.push(validatePlatform(body.platform));
    }
    if (body.events != null) {
      sets.push('events = ?');
      params.push(db.arrayParam(validateEvents(body.events)));
    }
    if (body.enabled != null) {
      sets.push('enabled = ?');
      const enabled = body.enabled;
      params.push(db.dialect === 'sqlite' ? (enabled ? 1 : 0) : enabled);
    }
    if (body.secret !== undefined) {
      sets.push('secret = ?');
      params.push(body.secret != null ? requireString(body.secret, 'secret', 500) : null);
    }
    if (body.metadata != null) {
      sets.push('metadata = ?');
      params.push(JSON.stringify(body.metadata));
    }

    if (sets.length === 0) {
      throw new ValidationError('No fields to update');
    }

    params.push(whId, projectId);
    const result = await db.query(
      `UPDATE webhook_configs SET ${sets.join(', ')} WHERE id = ? AND project_id = ? RETURNING *`,
      params,
    );

    if (result.rows.length === 0) throw new NotFoundError('Webhook', whId);

    logAudit('webhook_updated', projectId, { webhook_id: whId });

    const webhook = { ...(result.rows[0] as Record<string, unknown>) };
    delete webhook.secret;
    (webhook as any).has_secret = true;
    return c.json(webhook);
  });

    // DELETE
  app.delete('/api/projects/:id/webhooks/:whId', async (c) => {
    const db = getDb();
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);
    const whId = requireUUID(c.req.param('whId'), 'webhookId');

    const result = await db.query(
      'DELETE FROM webhook_configs WHERE id = ? AND project_id = ? RETURNING *',
      [whId, projectId],
    );

    if (result.rows.length === 0) throw new NotFoundError('Webhook', whId);

    logAudit('webhook_deleted', projectId, { webhook_id: whId });

    return c.json({ deleted: true });
  });

    // TEST
  app.post('/api/projects/:id/webhooks/:whId/test', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);
    const whId = requireUUID(c.req.param('whId'), 'webhookId');

    const result = await testWebhook(whId, projectId);
    return c.json(result);
  });
}
