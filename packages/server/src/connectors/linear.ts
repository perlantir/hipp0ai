/**
 * Linear Integration Connector.
 *
 * OAuth routes: install, callback, teams, projects, connect
 * Webhook handler: issue state changes → validate decisions / create notifications
 * Auto-create: decisions with action-required tags → Linear issues
 */
import type { Hono } from 'hono';
import crypto from 'node:crypto';
import { getDb } from '@hipp0/core/db/index.js';
import { logAudit } from '../routes/validation.js';
import {
  insertImportedDecision,
  type ExtractedDecision,
  type SyncOptions,
  type SyncResult,
} from './notion.js';

/* ------------------------------------------------------------------ */
/*  Config                                                             */
/* ------------------------------------------------------------------ */

const LINEAR_API = 'https://api.linear.app';
const LINEAR_GQL = 'https://api.linear.app/graphql';
const LINEAR_OAUTH_URL = 'https://linear.app/oauth/authorize';
const LINEAR_TOKEN_URL = 'https://api.linear.app/oauth/token';

function getLinearConfig() {
  return {
    clientId: process.env.LINEAR_CLIENT_ID ?? '',
    clientSecret: process.env.LINEAR_CLIENT_SECRET ?? '',
    webhookSecret: process.env.LINEAR_WEBHOOK_SECRET ?? '',
    redirectUri: process.env.LINEAR_REDIRECT_URI ?? `${process.env.DASHBOARD_URL ?? 'http://localhost:3200'}/api/linear/callback`,
  };
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function verifyWebhookSignature(body: string, signature: string | undefined, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

async function linearGraphQL(token: string, query: string, variables?: Record<string, unknown>) {
  const res = await fetch(LINEAR_GQL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Linear API error ${res.status}: ${text}`);
  }

  const json = await res.json() as { data?: Record<string, unknown>; errors?: Array<{ message: string }> };
  if (json.errors?.length) {
    throw new Error(`Linear GraphQL error: ${json.errors[0].message}`);
  }
  return json.data;
}

/* ------------------------------------------------------------------ */
/*  Auto-create Linear issue from decision                             */
/* ------------------------------------------------------------------ */

export async function createLinearIssueForDecision(
  decision: { id: string; title: string; description: string; reasoning: string; tags: string[]; project_id: string },
) {
  const db = getDb();

  // Get project's Linear settings
  const project = await db.query('SELECT metadata FROM projects WHERE id = ?', [decision.project_id]);
  if (project.rows.length === 0) return;

  let metadata: Record<string, unknown> = {};
  try {
    const raw = (project.rows[0] as Record<string, unknown>).metadata;
    metadata = typeof raw === 'string' ? JSON.parse(raw) : (raw as Record<string, unknown>) ?? {};
  } catch { /* keep empty */ }

  const token = metadata.linear_access_token as string;
  const teamId = metadata.linear_team_id as string;
  const autoCreate = metadata.linear_auto_create as boolean;

  if (!token || !teamId || !autoCreate) return;

  // Check if tags match auto-create trigger
  const triggerTags = (metadata.linear_trigger_tags as string[]) ?? ['action-required', 'implementation'];
  const autoCreateAll = metadata.linear_auto_create_all as boolean;
  const hasTriggerTag = autoCreateAll || decision.tags.some((t) => triggerTags.includes(t));
  if (!hasTriggerTag) return;

  try {
    const description = [
      `**Decision:** ${decision.title}`,
      '',
      decision.description,
      '',
      `**Reasoning:** ${decision.reasoning}`,
      '',
      `---`,
      `_Created automatically by Hipp0_`,
    ].join('\n');

    const data = await linearGraphQL(token,
      `mutation IssueCreate($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue { id identifier url title }
        }
      }`,
      {
        input: {
          teamId,
          title: `Implement: ${decision.title}`,
          description,
        },
      },
    );

    const issueCreate = (data as Record<string, unknown>).issueCreate as {
      success: boolean;
      issue: { id: string; identifier: string; url: string; title: string };
    };

    if (issueCreate?.success && issueCreate.issue) {
      const issue = issueCreate.issue;
      const linkId = crypto.randomUUID();

      await db.query(
        `INSERT INTO decision_links (id, decision_id, project_id, platform, external_id, external_url, link_type, title, status)
         VALUES (?, ?, ?, 'linear', ?, ?, 'implements', ?, 'open')`,
        [linkId, decision.id, decision.project_id, issue.identifier, issue.url, issue.title],
      );

      logAudit('linear_issue_created', decision.project_id, {
        decision_id: decision.id,
        issue_identifier: issue.identifier,
        issue_url: issue.url,
      });
    }
  } catch (err) {
    console.error('[hipp0/linear] Failed to create issue:', (err as Error).message);
  }
}

/* ================================================================== */
/*  IMPORT FLOW — scrape decisions from existing Linear issues          */
/* ================================================================== */

/* ---- Rate limit (60 req/min sliding window) ---- */
const _linearRequestTimestamps: number[] = [];
async function linearRateLimit(): Promise<void> {
  const now = Date.now();
  const oneMinuteAgo = now - 60_000;
  while (_linearRequestTimestamps.length && _linearRequestTimestamps[0] < oneMinuteAgo) {
    _linearRequestTimestamps.shift();
  }
  if (_linearRequestTimestamps.length >= 60) {
    const waitMs = _linearRequestTimestamps[0] + 60_000 - now + 50;
    await new Promise((r) => setTimeout(r, waitMs));
    return linearRateLimit();
  }
  _linearRequestTimestamps.push(now);
}

async function linearGraphQLSafe(
  token: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  await linearRateLimit();
  const res = await fetch(LINEAR_GQL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token.startsWith('lin_') || token.includes(' ') ? token : `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get('Retry-After') ?? '5', 10);
    await new Promise((r) => setTimeout(r, retryAfter * 1000));
    return linearGraphQLSafe(token, query, variables);
  }
  if (res.status === 401) {
    throw new Error('Linear token invalid or expired');
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Linear API ${res.status}: ${text.slice(0, 300)}`);
  }

  const json = (await res.json()) as {
    data?: Record<string, unknown>;
    errors?: Array<{ message: string }>;
  };
  if (json.errors?.length) {
    throw new Error(`Linear GraphQL error: ${json.errors[0].message}`);
  }
  return json.data ?? {};
}

/* ------------------------------------------------------------------ */
/*  Public: List issues                                                */
/* ------------------------------------------------------------------ */

export interface LinearIssueSummary {
  id: string;
  identifier: string;
  title: string;
  url: string;
  state: string;
  stateType: string;
  updatedAt: string;
  assignee?: string;
  labels: string[];
}

export interface LinearIssueFilter {
  teamId?: string;
  stateType?: 'completed' | 'started' | 'unstarted' | 'backlog' | 'cancelled' | 'triage';
  first?: number;
}

export async function listLinearIssues(
  token: string,
  filter: LinearIssueFilter = {},
): Promise<LinearIssueSummary[]> {
  const first = Math.min(filter.first ?? 50, 100);
  const filterParts: string[] = [];
  if (filter.teamId) filterParts.push(`team: { id: { eq: "${filter.teamId}" } }`);
  if (filter.stateType) filterParts.push(`state: { type: { eq: "${filter.stateType}" } }`);
  const filterArg = filterParts.length > 0 ? `filter: { ${filterParts.join(', ')} },` : '';

  const query = `
    query ListIssues {
      issues(${filterArg} first: ${first}, orderBy: updatedAt) {
        nodes {
          id
          identifier
          title
          url
          updatedAt
          state { name type }
          assignee { name displayName }
          labels { nodes { name } }
        }
      }
    }
  `;

  const data = await linearGraphQLSafe(token, query);
  const issues = (data.issues as { nodes: Array<Record<string, unknown>> })?.nodes ?? [];

  return issues.map((i) => {
    const state = i.state as { name?: string; type?: string } | undefined;
    const assignee = i.assignee as { displayName?: string; name?: string } | undefined;
    const labelsNodes = (i.labels as { nodes: Array<{ name: string }> })?.nodes ?? [];
    return {
      id: i.id as string,
      identifier: i.identifier as string,
      title: (i.title as string) ?? '',
      url: (i.url as string) ?? '',
      state: state?.name ?? '',
      stateType: state?.type ?? '',
      updatedAt: (i.updatedAt as string) ?? '',
      assignee: assignee?.displayName ?? assignee?.name,
      labels: labelsNodes.map((l) => (l.name ?? '').toLowerCase()).filter(Boolean),
    };
  });
}

/* ------------------------------------------------------------------ */
/*  Public: Fetch a single issue with comments                         */
/* ------------------------------------------------------------------ */

export interface LinearIssueFull extends LinearIssueSummary {
  description: string;
  comments: Array<{ body: string; user?: string; createdAt: string }>;
}

export async function fetchLinearIssue(
  token: string,
  issueId: string,
): Promise<LinearIssueFull> {
  const query = `
    query IssueDetail($id: String!) {
      issue(id: $id) {
        id
        identifier
        title
        description
        url
        updatedAt
        state { name type }
        assignee { name displayName }
        labels { nodes { name } }
        comments(first: 50) {
          nodes {
            body
            createdAt
            user { name displayName }
          }
        }
      }
    }
  `;

  const data = await linearGraphQLSafe(token, query, { id: issueId });
  const issue = data.issue as Record<string, unknown> | null;
  if (!issue) throw new Error(`Linear issue not found: ${issueId}`);

  const state = issue.state as { name?: string; type?: string } | undefined;
  const assignee = issue.assignee as { displayName?: string; name?: string } | undefined;
  const labelsNodes = (issue.labels as { nodes: Array<{ name: string }> })?.nodes ?? [];
  const commentsNodes =
    (issue.comments as { nodes: Array<Record<string, unknown>> })?.nodes ?? [];

  return {
    id: issue.id as string,
    identifier: issue.identifier as string,
    title: (issue.title as string) ?? '',
    description: (issue.description as string) ?? '',
    url: (issue.url as string) ?? '',
    state: state?.name ?? '',
    stateType: state?.type ?? '',
    updatedAt: (issue.updatedAt as string) ?? '',
    assignee: assignee?.displayName ?? assignee?.name,
    labels: labelsNodes.map((l) => (l.name ?? '').toLowerCase()).filter(Boolean),
    comments: commentsNodes.map((c) => {
      const user = c.user as { displayName?: string; name?: string } | undefined;
      return {
        body: (c.body as string) ?? '',
        user: user?.displayName ?? user?.name,
        createdAt: (c.createdAt as string) ?? '',
      };
    }),
  };
}

/* ------------------------------------------------------------------ */
/*  Public: Extract decisions from an issue                            */
/* ------------------------------------------------------------------ */

const LINEAR_COMMENT_PREFIXES =
  /^(?:DECISION|RESOLVED|RESOLUTION|DECIDED)\s*:\s*/i;

const LINEAR_HEADING_PATTERN = /(?:^|\n)##\s*(?:Decision|Resolution|Outcome)\s*\n([\s\S]*?)(?=\n##|\n#\s|$)/i;

export function extractDecisionsFromIssue(issue: LinearIssueFull): ExtractedDecision[] {
  const results: ExtractedDecision[] = [];

  // 1. Completed issues are candidate decisions (the issue itself)
  if (issue.stateType === 'completed') {
    results.push({
      title: `${issue.identifier}: ${issue.title}`.slice(0, 500),
      description: (issue.description || issue.title).slice(0, 10000),
      reasoning: (issue.description || issue.title).slice(0, 10000),
      made_by: issue.assignee || 'linear',
      tags: [...issue.labels, 'linear', 'resolved'],
      source_url: issue.url,
      source_ref: `linear:issue:${issue.identifier}`,
    });
  }

  // 2. "## Decision" or "## Resolution" heading in description
  if (issue.description) {
    const match = issue.description.match(LINEAR_HEADING_PATTERN);
    if (match && match[1]) {
      const body = match[1].trim();
      if (body.length > 10) {
        results.push({
          title: `${issue.identifier}: ${issue.title}`.slice(0, 500),
          description: body.slice(0, 10000),
          reasoning: body.slice(0, 10000),
          made_by: issue.assignee || 'linear',
          tags: [...issue.labels, 'linear'],
          source_url: issue.url,
          source_ref: `linear:issue:${issue.identifier}`,
        });
      }
    }
  }

  // 3. Comments starting with "DECISION:" or "RESOLVED:"
  for (const comment of issue.comments) {
    if (!comment.body) continue;
    if (!LINEAR_COMMENT_PREFIXES.test(comment.body)) continue;
    const body = comment.body.replace(LINEAR_COMMENT_PREFIXES, '').trim();
    if (body.length < 10) continue;

    const firstSentence = body.split(/[.!?]\s/)[0].slice(0, 500);
    results.push({
      title: firstSentence || `${issue.identifier}: decision`,
      description: body.slice(0, 10000),
      reasoning: body.slice(0, 10000),
      made_by: comment.user || issue.assignee || 'linear',
      tags: [...issue.labels, 'linear'],
      source_url: issue.url,
      source_ref: `linear:issue:${issue.identifier}:comment`,
    });
  }

  // Dedupe by normalized title
  const seen = new Set<string>();
  return results.filter((d) => {
    const key = d.title.toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/* ------------------------------------------------------------------ */
/*  Public: Full sync flow                                             */
/* ------------------------------------------------------------------ */

export async function syncLinearToHipp0(
  projectId: string,
  token: string,
  options: (SyncOptions & { teamId?: string; stateType?: LinearIssueFilter['stateType'] }) = {},
): Promise<SyncResult & { issues_scanned: number }> {
  const errors: string[] = [];
  const preview: ExtractedDecision[] = [];
  let issuesScanned = 0;
  let decisionsFound = 0;
  let decisionsImported = 0;

  console.warn(
    `[hipp0/linear] Sync starting project=${projectId} team=${options.teamId ?? '(all)'}`,
  );

  let issues: LinearIssueSummary[];
  try {
    issues = await listLinearIssues(token, {
      teamId: options.teamId,
      stateType: options.stateType,
      first: options.limit ?? 50,
    });
  } catch (err) {
    const msg = (err as Error).message;
    console.error(`[hipp0/linear] Failed to list issues: ${msg}`);
    return {
      pages_scanned: 0,
      issues_scanned: 0,
      decisions_found: 0,
      decisions_imported: 0,
      errors: [msg],
    };
  }

  const limit = options.limit ?? 50;
  const target = issues.slice(0, limit);

  for (const summary of target) {
    issuesScanned++;
    try {
      const full = await fetchLinearIssue(token, summary.id);
      const extracted = extractDecisionsFromIssue(full);
      decisionsFound += extracted.length;

      if (extracted.length === 0) continue;

      console.warn(
        `[hipp0/linear] Issue ${full.identifier} → ${extracted.length} decision(s)`,
      );

      if (options.dryRun) {
        preview.push(...extracted);
        continue;
      }

      for (const d of extracted) {
        try {
          await insertImportedDecision(projectId, d);
          decisionsImported++;
        } catch (err) {
          errors.push(`insert "${d.title}": ${(err as Error).message}`);
        }
      }
    } catch (err) {
      errors.push(`issue ${summary.identifier}: ${(err as Error).message}`);
    }
  }

  logAudit('linear_sync', projectId, {
    team_id: options.teamId ?? null,
    issues_scanned: issuesScanned,
    decisions_found: decisionsFound,
    decisions_imported: decisionsImported,
    dry_run: options.dryRun ?? false,
  });

  console.warn(
    `[hipp0/linear] Sync complete: ${issuesScanned} issues, ${decisionsFound} found, ${decisionsImported} imported`,
  );

  return {
    pages_scanned: 0,
    issues_scanned: issuesScanned,
    decisions_found: decisionsFound,
    decisions_imported: decisionsImported,
    errors,
    preview: options.dryRun ? preview : undefined,
  };
}

/* ------------------------------------------------------------------ */
/*  Register routes                                                    */
/* ------------------------------------------------------------------ */

export function registerLinearConnector(app: Hono): void {
  const config = getLinearConfig();
  const defaultProjectId = process.env.HIPP0_DEFAULT_PROJECT_ID ?? '';

    // OAuth: Install (redirect to Linear)
  app.get('/api/linear/install', (c) => {
    if (!config.clientId) {
      return c.json({ error: 'LINEAR_CLIENT_ID not configured' }, 500);
    }

    const state = crypto.randomUUID();
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: 'code',
      scope: 'read,write,issues:create',
      state,
    });

    return c.redirect(`${LINEAR_OAUTH_URL}?${params.toString()}`);
  });

    // OAuth: Callback
  app.get('/api/linear/callback', async (c) => {
    const code = c.req.query('code');
    if (!code) {
      return c.json({ error: 'Missing authorization code' }, 400);
    }

    try {
      const tokenRes = await fetch(LINEAR_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id: config.clientId,
          client_secret: config.clientSecret,
          redirect_uri: config.redirectUri,
        }),
      });

      if (!tokenRes.ok) {
        const text = await tokenRes.text();
        return c.json({ error: 'Token exchange failed', details: text }, 400);
      }

      const tokens = await tokenRes.json() as { access_token: string; token_type: string };
      const accessToken = tokens.access_token;

      // Store token temporarily — will be associated with project on /connect
      return c.redirect(`${process.env.DASHBOARD_URL ?? 'http://localhost:3200'}/#connectors?linear_token=${accessToken}`);
    } catch (err) {
      return c.json({ error: 'OAuth callback failed', details: (err as Error).message }, 500);
    }
  });

    // List Teams
  app.get('/api/linear/teams', async (c) => {
    const token = c.req.header('Authorization') ?? c.req.query('token') ?? '';
    if (!token) return c.json({ error: 'Missing access token' }, 401);

    const data = await linearGraphQL(token,
      `query { teams { nodes { id name key } } }`,
    );

    const teams = (data as Record<string, unknown>).teams as { nodes: Array<{ id: string; name: string; key: string }> };
    return c.json(teams?.nodes ?? []);
  });

    // List Projects
  app.get('/api/linear/projects', async (c) => {
    const token = c.req.header('Authorization') ?? c.req.query('token') ?? '';
    const teamId = c.req.query('teamId') ?? '';
    if (!token) return c.json({ error: 'Missing access token' }, 401);

    const filter = teamId
      ? `query { projects(filter: { accessibleTeams: { id: { eq: "${teamId}" } } }) { nodes { id name } } }`
      : `query { projects { nodes { id name } } }`;

    const data = await linearGraphQL(token, filter);
    const projects = (data as Record<string, unknown>).projects as { nodes: Array<{ id: string; name: string }> };
    return c.json(projects?.nodes ?? []);
  });

    // Connect (store settings)
  app.post('/api/linear/connect', async (c) => {
    const db = getDb();
    const body = await c.req.json() as {
      project_id: string;
      access_token: string;
      team_id: string;
      team_name?: string;
      auto_create?: boolean;
      auto_create_all?: boolean;
      auto_validate?: boolean;
      notify_on_cancel?: boolean;
      trigger_tags?: string[];
    };

    if (!body.project_id || !body.access_token || !body.team_id) {
      return c.json({ error: 'project_id, access_token, and team_id are required' }, 400);
    }

    // Get existing metadata
    const project = await db.query('SELECT metadata FROM projects WHERE id = ?', [body.project_id]);
    if (project.rows.length === 0) {
      return c.json({ error: 'Project not found' }, 404);
    }

    let metadata: Record<string, unknown> = {};
    try {
      const raw = (project.rows[0] as Record<string, unknown>).metadata;
      metadata = typeof raw === 'string' ? JSON.parse(raw) : (raw as Record<string, unknown>) ?? {};
    } catch { /* keep empty */ }

    // Merge Linear settings
    metadata.linear_access_token = body.access_token;
    metadata.linear_team_id = body.team_id;
    metadata.linear_team_name = body.team_name ?? '';
    metadata.linear_auto_create = body.auto_create ?? false;
    metadata.linear_auto_create_all = body.auto_create_all ?? false;
    metadata.linear_auto_validate = body.auto_validate ?? true;
    metadata.linear_notify_on_cancel = body.notify_on_cancel ?? true;
    metadata.linear_trigger_tags = body.trigger_tags ?? ['action-required', 'implementation'];
    metadata.linear_connected_at = new Date().toISOString();

    await db.query('UPDATE projects SET metadata = ? WHERE id = ?', [
      JSON.stringify(metadata),
      body.project_id,
    ]);

    logAudit('linear_connected', body.project_id, {
      team_id: body.team_id,
      team_name: body.team_name,
    });

    return c.json({ status: 'connected', team_id: body.team_id, team_name: body.team_name });
  });

    // Disconnect
  app.post('/api/linear/disconnect', async (c) => {
    const db = getDb();
    const body = await c.req.json() as { project_id: string };
    if (!body.project_id) return c.json({ error: 'project_id is required' }, 400);

    const project = await db.query('SELECT metadata FROM projects WHERE id = ?', [body.project_id]);
    if (project.rows.length === 0) return c.json({ error: 'Project not found' }, 404);

    let metadata: Record<string, unknown> = {};
    try {
      const raw = (project.rows[0] as Record<string, unknown>).metadata;
      metadata = typeof raw === 'string' ? JSON.parse(raw) : (raw as Record<string, unknown>) ?? {};
    } catch { /* keep empty */ }

    // Remove Linear settings
    delete metadata.linear_access_token;
    delete metadata.linear_team_id;
    delete metadata.linear_team_name;
    delete metadata.linear_auto_create;
    delete metadata.linear_auto_create_all;
    delete metadata.linear_auto_validate;
    delete metadata.linear_notify_on_cancel;
    delete metadata.linear_trigger_tags;
    delete metadata.linear_connected_at;

    await db.query('UPDATE projects SET metadata = ? WHERE id = ?', [
      JSON.stringify(metadata),
      body.project_id,
    ]);

    logAudit('linear_disconnected', body.project_id, {});
    return c.json({ status: 'disconnected' });
  });

    // Get Linear status for project
  app.get('/api/linear/status/:projectId', async (c) => {
    const db = getDb();
    const projectId = c.req.param('projectId');

    const project = await db.query('SELECT metadata FROM projects WHERE id = ?', [projectId]);
    if (project.rows.length === 0) return c.json({ error: 'Project not found' }, 404);

    let metadata: Record<string, unknown> = {};
    try {
      const raw = (project.rows[0] as Record<string, unknown>).metadata;
      metadata = typeof raw === 'string' ? JSON.parse(raw) : (raw as Record<string, unknown>) ?? {};
    } catch { /* keep empty */ }

    return c.json({
      connected: !!metadata.linear_access_token,
      team_id: metadata.linear_team_id ?? null,
      team_name: metadata.linear_team_name ?? null,
      auto_create: metadata.linear_auto_create ?? false,
      auto_create_all: metadata.linear_auto_create_all ?? false,
      auto_validate: metadata.linear_auto_validate ?? true,
      notify_on_cancel: metadata.linear_notify_on_cancel ?? true,
      trigger_tags: metadata.linear_trigger_tags ?? ['action-required', 'implementation'],
      connected_at: metadata.linear_connected_at ?? null,
    });
  });

    // Get linked issues for a decision
  app.get('/api/decisions/:id/links', async (c) => {
    const db = getDb();
    const decisionId = c.req.param('id');

    const result = await db.query(
      `SELECT * FROM decision_links WHERE decision_id = ? ORDER BY created_at DESC`,
      [decisionId],
    );

    return c.json(result.rows);
  });

    // Create manual link
  app.post('/api/decisions/:id/links', async (c) => {
    const db = getDb();
    const decisionId = c.req.param('id');
    const body = await c.req.json() as {
      platform: string;
      external_id: string;
      external_url?: string;
      link_type?: string;
      title?: string;
    };

    if (!body.platform || !body.external_id) {
      return c.json({ error: 'platform and external_id are required' }, 400);
    }

    // Get project_id from decision
    const decision = await db.query('SELECT project_id FROM decisions WHERE id = ?', [decisionId]);
    if (decision.rows.length === 0) return c.json({ error: 'Decision not found' }, 404);
    const projectId = (decision.rows[0] as Record<string, unknown>).project_id as string;

    const linkId = crypto.randomUUID();
    await db.query(
      `INSERT INTO decision_links (id, decision_id, project_id, platform, external_id, external_url, link_type, title)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [linkId, decisionId, projectId, body.platform, body.external_id, body.external_url ?? '', body.link_type ?? 'implements', body.title ?? ''],
    );

    const result = await db.query('SELECT * FROM decision_links WHERE id = ?', [linkId]);
    return c.json(result.rows[0], 201);
  });

    // Webhook
  app.post('/api/linear/webhook', async (c) => {
    const rawBody = await c.req.text();
    const signature = c.req.header('linear-signature') ?? c.req.header('Linear-Signature');

    // Verify HMAC-SHA256 signature — required when LINEAR_WEBHOOK_SECRET is configured
    if (!config.webhookSecret) {
      console.error('[hipp0/linear] LINEAR_WEBHOOK_SECRET not configured — rejecting webhook');
      return c.json({ error: 'Webhook not configured' }, 500);
    }
    if (!verifyWebhookSignature(rawBody, signature, config.webhookSecret)) {
      console.warn('[hipp0/linear] Webhook signature verification failed');
      return c.json({ error: 'Invalid signature' }, 401);
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400);
    }

    const action = payload.action as string;
    const type = payload.type as string;

    // Only handle Issue events
    if (type !== 'Issue') {
      return c.json({ status: 'ignored', reason: 'Not an issue event' });
    }

    const issueData = payload.data as Record<string, unknown> | undefined;
    if (!issueData) return c.json({ status: 'ignored', reason: 'No issue data' });

    const identifier = issueData.identifier as string;
    const stateType = (issueData.state as Record<string, unknown>)?.type as string;
    const issueTitle = issueData.title as string;

    const db = getDb();

    // Find linked decisions
    const links = await db.query(
      `SELECT dl.*, d.title as decision_title, d.project_id
       FROM decision_links dl
       JOIN decisions d ON d.id = dl.decision_id
       WHERE dl.platform = 'linear' AND dl.external_id = ?`,
      [identifier],
    );

    if (links.rows.length === 0) {
      return c.json({ status: 'ignored', reason: 'No linked decisions found' });
    }

    // Issue completed → auto-validate decision
    if (action === 'update' && stateType === 'completed') {
      for (const link of links.rows) {
        const row = link as Record<string, unknown>;
        const decisionId = row.decision_id as string;
        const projectId = row.project_id as string;

        // Check project settings for auto-validate
        const project = await db.query('SELECT metadata FROM projects WHERE id = ?', [projectId]);
        let metadata: Record<string, unknown> = {};
        try {
          const raw = (project.rows[0] as Record<string, unknown>).metadata;
          metadata = typeof raw === 'string' ? JSON.parse(raw) : (raw as Record<string, unknown>) ?? {};
        } catch { /* keep empty */ }

        if (metadata.linear_auto_validate !== false) {
          // Auto-validate the decision
          await db.query(
            `UPDATE decisions SET validated_at = ?, validation_source = 'linear_issue' WHERE id = ? AND validated_at IS NULL`,
            [new Date().toISOString(), decisionId],
          );
        }

        // Update link status
        await db.query(
          `UPDATE decision_links SET status = 'completed', updated_at = ? WHERE id = ?`,
          [new Date().toISOString(), row.id as string],
        );

        logAudit('linear_issue_completed', projectId, {
          decision_id: decisionId,
          issue_identifier: identifier,
        });
      }

      return c.json({ status: 'processed', action: 'completed', links: links.rows.length });
    }

    // Issue cancelled → create notification (do NOT auto-invalidate)
    if (action === 'update' && stateType === 'cancelled') {
      for (const link of links.rows) {
        const row = link as Record<string, unknown>;
        const projectId = row.project_id as string;
        const decisionTitle = row.decision_title as string;

        const project = await db.query('SELECT metadata FROM projects WHERE id = ?', [projectId]);
        let metadata: Record<string, unknown> = {};
        try {
          const raw = (project.rows[0] as Record<string, unknown>).metadata;
          metadata = typeof raw === 'string' ? JSON.parse(raw) : (raw as Record<string, unknown>) ?? {};
        } catch { /* keep empty */ }

        if (metadata.linear_notify_on_cancel !== false) {
          const notifId = crypto.randomUUID();
          await db.query(
            `INSERT INTO notifications (id, project_id, type, title, message, metadata)
             VALUES (?, ?, 'warning', ?, ?, ?)`,
            [
              notifId,
              projectId,
              `Linear issue ${identifier} cancelled`,
              `Linear issue ${identifier} was cancelled. Decision "${decisionTitle}" may need review.`,
              JSON.stringify({ decision_id: row.decision_id, issue_identifier: identifier }),
            ],
          );
        }

        // Update link status
        await db.query(
          `UPDATE decision_links SET status = 'cancelled', updated_at = ? WHERE id = ?`,
          [new Date().toISOString(), row.id as string],
        );

        logAudit('linear_issue_cancelled', projectId, {
          decision_id: row.decision_id,
          issue_identifier: identifier,
        });
      }

      return c.json({ status: 'processed', action: 'cancelled', links: links.rows.length });
    }

    return c.json({ status: 'ignored', reason: `Unhandled action: ${action} / state: ${stateType}` });
  });
}
