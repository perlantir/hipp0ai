/**
 * Unified connector import routes — Notion, Linear, Slack.
 *
 * Routes:
 *   POST /api/projects/:id/connectors/notion/sync
 *   POST /api/projects/:id/connectors/linear/sync
 *   POST /api/projects/:id/connectors/slack/sync
 *   POST /api/projects/:id/connectors/:source/preview
 *   GET  /api/projects/:id/connectors/notion/pages
 *   GET  /api/projects/:id/connectors/linear/issues
 *   GET  /api/projects/:id/connectors/slack/channels
 *
 * Tokens are accepted per-request in the body/headers and never persisted
 * as plaintext by these routes.
 */
import type { Hono, Context } from 'hono';
import { requireUUID, logAudit } from './validation.js';
import { requireProjectAccess } from './_helpers.js';
import {
  listNotionPages,
  syncNotionToHipp0,
  type ExtractedDecision,
} from '../connectors/notion.js';
import {
  listLinearIssues,
  syncLinearToHipp0,
  type LinearIssueFilter,
} from '../connectors/linear.js';
import {
  listSlackChannels,
  syncSlackToHipp0,
} from '../connectors/slack.js';

type ConnectorSource = 'notion' | 'linear' | 'slack';

function getToken(c: Context, bodyToken?: unknown): string {
  if (typeof bodyToken === 'string' && bodyToken.trim()) return bodyToken.trim();
  const header = c.req.header('X-Connector-Token') ?? c.req.header('x-connector-token');
  if (header && header.trim()) return header.trim();
  const auth = c.req.header('Authorization') ?? c.req.header('authorization');
  if (auth && auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return '';
}

export function registerConnectorRoutes(app: Hono): void {
  /* ============================== NOTION ============================== */

  app.get('/api/projects/:id/connectors/notion/pages', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);

    const token = getToken(c);
    const databaseId = c.req.query('database_id');
    if (!token) return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Notion token required' } }, 400);

    try {
      const pages = await listNotionPages(token, databaseId);
      return c.json({ pages });
    } catch (err) {
      return c.json({ error: { code: 'CONNECTOR_ERROR', message: (err as Error).message } }, 502);
    }
  });

  app.post('/api/projects/:id/connectors/notion/sync', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);
    const body = (await c.req.json().catch(() => ({}))) as {
      token?: string;
      database_id?: string;
      limit?: number;
    };

    const token = getToken(c, body.token);
    if (!token) return c.json({ error: { code: 'VALIDATION_ERROR', message: 'token is required' } }, 400);

    try {
      const result = await syncNotionToHipp0(projectId, token, body.database_id, {
        limit: body.limit,
      });
      return c.json({ status: 'ok', ...result });
    } catch (err) {
      return c.json({ error: { code: 'CONNECTOR_ERROR', message: (err as Error).message } }, 502);
    }
  });

  /* ============================== LINEAR ============================== */

  app.get('/api/projects/:id/connectors/linear/issues', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);

    const token = getToken(c);
    if (!token) return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Linear token required' } }, 400);

    const teamId = c.req.query('team_id') ?? undefined;
    const stateType = c.req.query('state_type') as LinearIssueFilter['stateType'] | undefined;

    try {
      const issues = await listLinearIssues(token, { teamId, stateType });
      return c.json({ issues });
    } catch (err) {
      return c.json({ error: { code: 'CONNECTOR_ERROR', message: (err as Error).message } }, 502);
    }
  });

  app.post('/api/projects/:id/connectors/linear/sync', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);
    const body = (await c.req.json().catch(() => ({}))) as {
      token?: string;
      team_id?: string;
      state_type?: LinearIssueFilter['stateType'];
      limit?: number;
    };

    const token = getToken(c, body.token);
    if (!token) return c.json({ error: { code: 'VALIDATION_ERROR', message: 'token is required' } }, 400);

    try {
      const result = await syncLinearToHipp0(projectId, token, {
        teamId: body.team_id,
        stateType: body.state_type,
        limit: body.limit,
      });
      return c.json({ status: 'ok', ...result });
    } catch (err) {
      return c.json({ error: { code: 'CONNECTOR_ERROR', message: (err as Error).message } }, 502);
    }
  });

  /* ============================== SLACK =============================== */

  app.get('/api/projects/:id/connectors/slack/channels', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);

    const token = getToken(c);
    if (!token) return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Slack token required' } }, 400);

    try {
      const channels = await listSlackChannels(token);
      return c.json({ channels });
    } catch (err) {
      return c.json({ error: { code: 'CONNECTOR_ERROR', message: (err as Error).message } }, 502);
    }
  });

  app.post('/api/projects/:id/connectors/slack/sync', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);
    const body = (await c.req.json().catch(() => ({}))) as {
      token?: string;
      channel_id?: string;
      since?: string;
      limit?: number;
    };

    const token = getToken(c, body.token);
    if (!token) return c.json({ error: { code: 'VALIDATION_ERROR', message: 'token is required' } }, 400);
    if (!body.channel_id) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'channel_id is required' } }, 400);
    }

    try {
      const result = await syncSlackToHipp0(projectId, token, body.channel_id, {
        since: body.since,
        limit: body.limit,
      });
      return c.json({ status: 'ok', ...result });
    } catch (err) {
      return c.json({ error: { code: 'CONNECTOR_ERROR', message: (err as Error).message } }, 502);
    }
  });

  /* ============================ UNIFIED PREVIEW ============================ */

  app.post('/api/projects/:id/connectors/:source/preview', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);
    const source = c.req.param('source') as ConnectorSource;
    const body = (await c.req.json().catch(() => ({}))) as {
      token?: string;
      database_id?: string;
      team_id?: string;
      channel_id?: string;
      since?: string;
      limit?: number;
    };

    const token = getToken(c, body.token);
    if (!token) return c.json({ error: { code: 'VALIDATION_ERROR', message: 'token is required' } }, 400);

    let preview: ExtractedDecision[] = [];
    let stats: Record<string, unknown> = {};

    try {
      if (source === 'notion') {
        const result = await syncNotionToHipp0(projectId, token, body.database_id, {
          dryRun: true,
          limit: body.limit ?? 10,
        });
        preview = result.preview ?? [];
        stats = {
          pages_scanned: result.pages_scanned,
          decisions_found: result.decisions_found,
        };
      } else if (source === 'linear') {
        const result = await syncLinearToHipp0(projectId, token, {
          teamId: body.team_id,
          dryRun: true,
          limit: body.limit ?? 25,
        });
        preview = result.preview ?? [];
        stats = {
          issues_scanned: result.issues_scanned,
          decisions_found: result.decisions_found,
        };
      } else if (source === 'slack') {
        if (!body.channel_id) {
          return c.json({ error: { code: 'VALIDATION_ERROR', message: 'channel_id is required' } }, 400);
        }
        const result = await syncSlackToHipp0(projectId, token, body.channel_id, {
          since: body.since,
          dryRun: true,
          limit: body.limit,
        });
        preview = result.preview ?? [];
        stats = {
          messages_scanned: result.messages_scanned,
          decisions_found: result.decisions_found,
        };
      } else {
        return c.json({ error: { code: 'VALIDATION_ERROR', message: `Unknown source: ${source}` } }, 400);
      }

      logAudit(`connector_preview_${source}`, projectId, {
        count: preview.length,
        ...stats,
      });

      return c.json({ source, preview, stats });
    } catch (err) {
      return c.json({ error: { code: 'CONNECTOR_ERROR', message: (err as Error).message } }, 502);
    }
  });
}
