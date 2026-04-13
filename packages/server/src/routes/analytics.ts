/**
 * Analytics Routes — Memory Analytics & Weekly Digest endpoints.
 *
 * GET    /api/projects/:id/analytics/health               — current team memory health
 * GET    /api/projects/:id/analytics/trends?days=30       — time-series data for charts
 * GET    /api/projects/:id/analytics/digest/latest        — most recent stored digest
 * POST   /api/projects/:id/analytics/digest/generate      — generate a new digest now
 * GET    /api/projects/:id/analytics/digests              — list historical digests
 *
 * Digest delivery configuration + manual dispatch:
 * POST   /api/projects/:id/digest/delivery                — create a delivery config
 * GET    /api/projects/:id/digest/delivery                — list delivery configs
 * DELETE /api/projects/:id/digest/delivery/:configId      — remove a delivery config
 * POST   /api/projects/:id/digest/send                    — dispatch the latest digest now
 */

import crypto from 'node:crypto';
import type { Hono } from 'hono';
import { getDb } from '@hipp0/core/db/index.js';
import {
  computeTeamHealth,
  getMemoryTrends,
  generateWeeklyDigest,
} from '@hipp0/core/intelligence/memory-analytics.js';
import type { WeeklyDigest } from '@hipp0/core/intelligence/memory-analytics.js';
import {
  deliverDigest,
} from '@hipp0/core/intelligence/digest-delivery.js';
import type {
  DeliveryConfig,
  SmtpConfig,
} from '@hipp0/core/intelligence/digest-delivery.js';
import { ValidationError } from '@hipp0/core/types.js';
import { requireUUID } from './validation.js';
import { requireProjectAccess } from './_helpers.js';

type DeliveryType = 'email' | 'slack' | 'webhook';
const VALID_DELIVERY_TYPES: DeliveryType[] = ['email', 'slack', 'webhook'];

/**
 * Read the most recent stored weekly digest for a project, or generate
 * and persist one if none exists yet.
 */
async function loadOrGenerateLatestDigest(
  projectId: string,
): Promise<WeeklyDigest> {
  const db = getDb();
  try {
    const result = await db.query<Record<string, unknown>>(
      `SELECT digest_data FROM weekly_digests
       WHERE project_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      [projectId],
    );
    if (result.rows.length > 0) {
      const raw = result.rows[0].digest_data;
      const parsed =
        typeof raw === 'string' ? JSON.parse(raw) : (raw as unknown);
      if (parsed && typeof parsed === 'object') {
        return parsed as WeeklyDigest;
      }
    }
  } catch {
    /* fall through and generate */
  }
  return generateWeeklyDigest(projectId);
}

async function loadProjectName(projectId: string): Promise<string> {
  const db = getDb();
  try {
    const result = await db.query<Record<string, unknown>>(
      'SELECT name FROM projects WHERE id = ?',
      [projectId],
    );
    const row = result.rows[0];
    if (row && typeof row.name === 'string') return row.name;
  } catch {
    /* ignore */
  }
  return 'Hipp0 Project';
}

/**
 * Translate a stored delivery row into the shape expected by `deliverDigest`.
 * Returns null if the row is malformed or the type is unknown.
 */
function buildDispatchConfig(
  deliveryType: string,
  raw: unknown,
  projectName: string,
): DeliveryConfig | null {
  const cfg =
    typeof raw === 'string'
      ? safeParseJson(raw)
      : (raw as Record<string, unknown> | null);
  if (!cfg || typeof cfg !== 'object') return null;

  if (deliveryType === 'email') {
    const recipients = Array.isArray((cfg as { recipients?: unknown }).recipients)
      ? ((cfg as { recipients: unknown[] }).recipients.filter(
          (r) => typeof r === 'string' && r.includes('@'),
        ) as string[])
      : [];
    const smtpRaw = (cfg as { smtp?: unknown }).smtp;
    const smtp = buildSmtp(smtpRaw, projectName);
    if (!smtp || recipients.length === 0) return null;
    return { email: { recipients, smtp } };
  }

  if (deliveryType === 'slack') {
    const url = (cfg as { webhook_url?: unknown }).webhook_url;
    if (typeof url !== 'string' || url.length === 0) return null;
    return { slack: { webhook_url: url, project_name: projectName } };
  }

  if (deliveryType === 'webhook') {
    const url = (cfg as { url?: unknown }).url;
    if (typeof url !== 'string' || url.length === 0) return null;
    const secret = (cfg as { secret?: unknown }).secret;
    return {
      webhook: {
        url,
        secret: typeof secret === 'string' ? secret : undefined,
      },
    };
  }

  return null;
}

function buildSmtp(raw: unknown, projectName: string): SmtpConfig | null {
  // Prefer per-config SMTP but fall back to environment defaults so operators
  // can keep credentials out of the database entirely.
  const envHost = process.env.HIPP0_SMTP_HOST;
  const envPort = process.env.HIPP0_SMTP_PORT;
  const envUser = process.env.HIPP0_SMTP_USER;
  const envPass = process.env.HIPP0_SMTP_PASS;
  const envFrom = process.env.HIPP0_SMTP_FROM;

  const cfg = (raw && typeof raw === 'object' ? raw : {}) as Record<
    string,
    unknown
  >;

  const host =
    typeof cfg.host === 'string' && cfg.host.length > 0 ? cfg.host : envHost;
  if (!host) return null;

  const portValue = cfg.port ?? envPort ?? 587;
  const port =
    typeof portValue === 'number'
      ? portValue
      : parseInt(String(portValue), 10) || 587;

  const user =
    typeof cfg.user === 'string' ? cfg.user : envUser ?? undefined;
  const pass =
    typeof cfg.pass === 'string' ? cfg.pass : envPass ?? undefined;
  const from =
    typeof cfg.from === 'string' && cfg.from.length > 0
      ? cfg.from
      : envFrom ?? 'noreply@hipp0.ai';

  return { host, port, user, pass, from, project_name: projectName };
}

function safeParseJson(raw: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Update `last_sent_at`, `last_status`, and `last_error` on a delivery
 * config row. Failures are swallowed — delivery tracking is best-effort and
 * must never mask the dispatch outcome returned to callers.
 */
async function recordDeliveryOutcome(
  configId: string,
  success: boolean,
  error?: string,
): Promise<void> {
  const db = getDb();
  try {
    const nowExpr =
      db.dialect === 'sqlite' ? "datetime('now')" : 'NOW()';
    await db.query(
      `UPDATE digest_delivery_config
         SET last_sent_at = ${nowExpr},
             last_status = ?,
             last_error = ?
       WHERE id = ?`,
      [success ? 'success' : 'error', error ?? null, configId],
    );
  } catch (err) {
    console.warn(
      '[hipp0:analytics] Failed to update delivery outcome:',
      (err as Error).message,
    );
  }
}

export function registerAnalyticsRoutes(app: Hono): void {
  // Team health snapshot
  app.get('/api/projects/:id/analytics/health', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);

    try {
      const health = await computeTeamHealth(projectId);
      return c.json(health);
    } catch (err) {
      console.error(
        '[hipp0:analytics] Health computation failed:',
        (err as Error).message,
      );
      return c.json({ error: 'Health computation failed' }, 500);
    }
  });

  // Time-series trends
  app.get('/api/projects/:id/analytics/trends', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);

    const daysRaw = c.req.query('days');
    let days = 30;
    if (daysRaw !== undefined) {
      const parsed = parseInt(daysRaw, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        days = Math.min(parsed, 365);
      }
    }

    try {
      const trends = await getMemoryTrends(projectId, days);
      return c.json(trends);
    } catch (err) {
      console.error(
        '[hipp0:analytics] Trends computation failed:',
        (err as Error).message,
      );
      return c.json({ error: 'Trends computation failed' }, 500);
    }
  });

  // Latest stored weekly digest
  app.get('/api/projects/:id/analytics/digest/latest', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);

    const db = getDb();

    try {
      const result = await db.query<Record<string, unknown>>(
        `SELECT id, project_id, period_start, period_end, digest_data, created_at
         FROM weekly_digests
         WHERE project_id = ?
         ORDER BY created_at DESC
         LIMIT 1`,
        [projectId],
      );

      if (result.rows.length === 0) {
        return c.json(
          { error: 'No digest found. Generate one first.' },
          404,
        );
      }

      const row = result.rows[0];
      const digestData =
        typeof row.digest_data === 'string'
          ? JSON.parse(row.digest_data as string)
          : row.digest_data;

      return c.json({
        id: row.id,
        project_id: row.project_id,
        period_start: row.period_start,
        period_end: row.period_end,
        digest: digestData,
        created_at: row.created_at,
      });
    } catch (err) {
      console.error(
        '[hipp0:analytics] Fetch latest digest failed:',
        (err as Error).message,
      );
      return c.json({ error: 'Failed to fetch latest digest' }, 500);
    }
  });

  // Generate a new weekly digest now
  app.post('/api/projects/:id/analytics/digest/generate', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);

    try {
      const digest = await generateWeeklyDigest(projectId);
      return c.json(digest, 201);
    } catch (err) {
      console.error(
        '[hipp0:analytics] Digest generation failed:',
        (err as Error).message,
      );
      return c.json({ error: 'Digest generation failed' }, 500);
    }
  });

  // -------------------------------------------------------------------
  // Digest delivery configuration
  // -------------------------------------------------------------------

  // Create a new delivery config
  app.post('/api/projects/:id/digest/delivery', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);

    const body = await c
      .req
      .json<Record<string, unknown>>()
      .catch(() => ({} as Record<string, unknown>));

    const deliveryType = body.delivery_type;
    if (
      typeof deliveryType !== 'string' ||
      !VALID_DELIVERY_TYPES.includes(deliveryType as DeliveryType)
    ) {
      throw new ValidationError(
        `delivery_type must be one of: ${VALID_DELIVERY_TYPES.join(', ')}`,
      );
    }

    const cfg =
      body.config && typeof body.config === 'object' && !Array.isArray(body.config)
        ? (body.config as Record<string, unknown>)
        : {};

    const enabled = body.enabled === undefined ? true : Boolean(body.enabled);
    const id = crypto.randomUUID();
    const db = getDb();

    try {
      await db.query(
        `INSERT INTO digest_delivery_config (id, project_id, delivery_type, config, enabled)
         VALUES (?, ?, ?, ?, ?)`,
        [
          id,
          projectId,
          deliveryType,
          JSON.stringify(cfg),
          db.dialect === 'sqlite' ? (enabled ? 1 : 0) : enabled,
        ],
      );
    } catch (err) {
      console.error(
        '[hipp0:analytics] Create delivery config failed:',
        (err as Error).message,
      );
      return c.json({ error: 'Failed to create delivery config' }, 500);
    }

    return c.json(
      {
        id,
        project_id: projectId,
        delivery_type: deliveryType,
        config: cfg,
        enabled,
      },
      201,
    );
  });

  // List delivery configs for a project
  app.get('/api/projects/:id/digest/delivery', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);

    const db = getDb();
    try {
      const result = await db.query<Record<string, unknown>>(
        `SELECT id, project_id, delivery_type, config, enabled,
                last_sent_at, last_status, last_error, created_at
         FROM digest_delivery_config
         WHERE project_id = ?
         ORDER BY created_at DESC`,
        [projectId],
      );

      const configs = result.rows.map((row) => ({
        id: row.id,
        project_id: row.project_id,
        delivery_type: row.delivery_type,
        config:
          typeof row.config === 'string'
            ? safeParseJson(row.config as string) ?? {}
            : row.config ?? {},
        enabled:
          row.enabled === 1 || row.enabled === true || row.enabled === '1',
        last_sent_at: row.last_sent_at ?? null,
        last_status: row.last_status ?? null,
        last_error: row.last_error ?? null,
        created_at: row.created_at ?? null,
      }));

      return c.json({ configs });
    } catch (err) {
      console.error(
        '[hipp0:analytics] List delivery configs failed:',
        (err as Error).message,
      );
      return c.json({ configs: [] });
    }
  });

  // Delete a delivery config
  app.delete('/api/projects/:id/digest/delivery/:configId', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    const configId = requireUUID(c.req.param('configId'), 'configId');
    await requireProjectAccess(c, projectId);

    const db = getDb();
    try {
      await db.query(
        `DELETE FROM digest_delivery_config WHERE id = ? AND project_id = ?`,
        [configId, projectId],
      );
    } catch (err) {
      console.error(
        '[hipp0:analytics] Delete delivery config failed:',
        (err as Error).message,
      );
      return c.json({ error: 'Failed to delete delivery config' }, 500);
    }
    return c.json({ deleted: true });
  });

  // Manually dispatch the latest digest via every enabled channel
  app.post('/api/projects/:id/digest/send', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);

    let digest: WeeklyDigest;
    try {
      digest = await loadOrGenerateLatestDigest(projectId);
    } catch (err) {
      console.error(
        '[hipp0:analytics] Could not load/generate digest for send:',
        (err as Error).message,
      );
      return c.json({ error: 'Failed to load digest' }, 500);
    }

    const projectName = await loadProjectName(projectId);
    const db = getDb();

    let rows: Array<Record<string, unknown>> = [];
    try {
      const result = await db.query<Record<string, unknown>>(
        `SELECT id, delivery_type, config, enabled
         FROM digest_delivery_config
         WHERE project_id = ?`,
        [projectId],
      );
      rows = result.rows;
    } catch (err) {
      console.error(
        '[hipp0:analytics] Failed to load delivery configs:',
        (err as Error).message,
      );
      return c.json({ error: 'Failed to load delivery configs' }, 500);
    }

    const outcomes: Array<{
      config_id: string;
      delivery_type: string;
      success: boolean;
      error?: string;
    }> = [];

    for (const row of rows) {
      const enabled =
        row.enabled === 1 || row.enabled === true || row.enabled === '1';
      if (!enabled) continue;

      const deliveryType = String(row.delivery_type ?? '');
      const dispatchCfg = buildDispatchConfig(
        deliveryType,
        row.config,
        projectName,
      );

      if (!dispatchCfg) {
        const err = `invalid or empty config for ${deliveryType}`;
        await recordDeliveryOutcome(String(row.id), false, err);
        outcomes.push({
          config_id: String(row.id),
          delivery_type: deliveryType,
          success: false,
          error: err,
        });
        continue;
      }

      const dispatch = await deliverDigest(digest, dispatchCfg);
      const channel =
        dispatch.email ?? dispatch.slack ?? dispatch.webhook ?? {
          success: false,
          error: 'no channel attempted',
        };
      await recordDeliveryOutcome(
        String(row.id),
        channel.success,
        channel.error,
      );
      outcomes.push({
        config_id: String(row.id),
        delivery_type: deliveryType,
        success: channel.success,
        error: channel.error,
      });
    }

    return c.json({ dispatched: outcomes.length, results: outcomes });
  });

  // List historical digests
  app.get('/api/projects/:id/analytics/digests', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);

    const limitRaw = c.req.query('limit');
    let limit = 20;
    if (limitRaw !== undefined) {
      const parsed = parseInt(limitRaw, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        limit = Math.min(parsed, 100);
      }
    }

    const db = getDb();
    try {
      const result = await db.query<Record<string, unknown>>(
        `SELECT id, project_id, period_start, period_end, digest_data, created_at
         FROM weekly_digests
         WHERE project_id = ?
         ORDER BY created_at DESC
         LIMIT ?`,
        [projectId, limit],
      );

      const digests = result.rows.map((row) => ({
        id: row.id,
        project_id: row.project_id,
        period_start: row.period_start,
        period_end: row.period_end,
        digest:
          typeof row.digest_data === 'string'
            ? JSON.parse(row.digest_data as string)
            : row.digest_data,
        created_at: row.created_at,
      }));

      return c.json({ digests });
    } catch (err) {
      console.error(
        '[hipp0:analytics] List digests failed:',
        (err as Error).message,
      );
      return c.json({ digests: [] });
    }
  });
}
