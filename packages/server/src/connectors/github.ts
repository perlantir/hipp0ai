/**
 * GitHub PR Decision Ingestion Connector — Enhanced with Deep Integration.
 *
 * Webhook endpoint: POST /api/webhooks/github
 * Extracts decisions from merged pull request bodies + comments.
 * Deep integration: PR reference scanning, comment posting, merge status, supersede notify.
 *
 * Flow:
 * 1. GitHub sends pull_request webhook (opened, edited, closed)
 * 2. Verify webhook signature (HMAC SHA-256)
 * 3. On opened/edited: scan for H0-uuid / "Implements:" references, post relevant-decisions comment
 * 4. On closed+merged: update link statuses, run existing distillery extraction
 */
import type { Hono } from 'hono';
import crypto from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { submitForExtraction } from '../queue/index.js';
import { getDb } from '@hipp0/core/db/index.js';
import { getGitHubClient } from './github-client.js';

// Decision patterns (same as OpenClaw watcher)
const DECISION_PATTERNS: RegExp[] = [
  /\bdecision\s*:/i,
  /\bwe decided\b/i,
  /\bgoing with\b/i,
  /\bapproved\s*:/i,
  /\bchose\b.*\bover\b/i,
  /\bwill use\b.*\binstead\b/i,
  /\bfinal call\s*:/i,
  /\bagreed to\b/i,
  /\baction item\s*:/i,
  /\blet'?s go with\b/i,
  /\bconfirmed\s*:/i,
];

function matchesDecisionPattern(text: string): boolean {
  return DECISION_PATTERNS.some((p) => p.test(text));
}

const MAX_EXTRACTION_LENGTH = 2000;

  // Deep integration patterns

/** Matches H0-<uuid> (also accepts legacy DG-) */
const REF_PATTERN = /\b(?:H0|DG)[-:]([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/gi;

/** Matches Implements: "title" or Refs: "title" */
const TITLE_REF_PATTERN = /\b(?:Implements|Refs)\s*:\s*"([^"]+)"/gi;

  // Signature verification

function verifySignature(payload: string, signature: string | undefined, secret: string): boolean {
  if (!signature) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

  // Types

interface PRPayload {
  action: string;
  pull_request?: {
    merged: boolean;
    body?: string;
    title?: string;
    number?: number;
    html_url?: string;
    user?: { login?: string };
    labels?: Array<{ name: string }>;
    requested_reviewers?: Array<{ login?: string }>;
    base?: { repo?: { full_name?: string } };
  };
}

  // Link upsert helper

export async function upsertLink(params: {
  decisionId: string;
  projectId: string;
  platform: string;
  externalId: string;
  externalUrl?: string;
  linkType: string;
  title?: string;
  status?: string;
  author?: string;
  linkedBy?: string;
}): Promise<void> {
  const db = getDb();
  const existing = await db.query(
    `SELECT id FROM decision_links
     WHERE decision_id = ? AND platform = ? AND external_id = ? AND link_type = ?`,
    [params.decisionId, params.platform, params.externalId, params.linkType],
  );

  if (existing.rows.length > 0) {
    await db.query(
      `UPDATE decision_links SET status = ?, updated_at = NOW() WHERE id = ?`,
      [params.status ?? 'open', (existing.rows[0] as Record<string, unknown>).id],
    );
  } else {
    await db.query(
      `INSERT INTO decision_links
       (id, decision_id, project_id, platform, external_id, external_url,
        link_type, title, status, author, linked_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        params.decisionId,
        params.projectId,
        params.platform,
        params.externalId,
        params.externalUrl ?? null,
        params.linkType,
        params.title ?? null,
        params.status ?? 'open',
        params.author ?? null,
        params.linkedBy ?? 'auto',
      ],
    );
  }
}

  // A: Scan PR body for decision references

async function scanForReferences(
  prBody: string,
  prTitle: string,
  prNumber: number,
  prUrl: string,
  prAuthor: string,
  repoFullName: string,
  projectId: string,
): Promise<number> {
  const db = getDb();
  const externalId = `${repoFullName}#${prNumber}`;
  let linkCount = 0;

  // Pattern 1: H0-<uuid> or H0:<uuid> (also accepts legacy DG-)
  const uuidMatches = [...prBody.matchAll(REF_PATTERN)];
  for (const match of uuidMatches) {
    const decisionId = match[1];
    const check = await db.query('SELECT id, project_id FROM decisions WHERE id = ?', [decisionId]);
    if (check.rows.length > 0) {
      const row = check.rows[0] as Record<string, unknown>;
      await upsertLink({
        decisionId,
        projectId: (row.project_id as string) || projectId,
        platform: 'github',
        externalId,
        externalUrl: prUrl,
        linkType: 'references',
        title: prTitle,
        author: prAuthor,
        linkedBy: 'auto',
      });
      linkCount++;
    }
  }

  // Pattern 2: Implements: "title" / Refs: "title"
  const titleMatches = [...prBody.matchAll(TITLE_REF_PATTERN)];
  for (const match of titleMatches) {
    const searchTitle = match[1];
    const linkType = match[0].toLowerCase().startsWith('implements') ? 'implements' : 'references';
    const decisions = await db.query(
      `SELECT id, project_id FROM decisions
       WHERE LOWER(title) = LOWER(?) AND status = 'active'
       LIMIT 1`,
      [searchTitle],
    );
    if (decisions.rows.length > 0) {
      const row = decisions.rows[0] as Record<string, unknown>;
      await upsertLink({
        decisionId: row.id as string,
        projectId: (row.project_id as string) || projectId,
        platform: 'github',
        externalId,
        externalUrl: prUrl,
        linkType,
        title: prTitle,
        author: prAuthor,
        linkedBy: 'auto',
      });
      linkCount++;
    }
  }

  return linkCount;
}

  // B: Post comment with relevant decisions

async function postRelevantDecisionsComment(
  repoFullName: string,
  prNumber: number,
  prUrl: string,
  prTitle: string,
  prAuthor: string,
  projectId: string,
): Promise<void> {
  const octokit = getGitHubClient();
  if (!octokit) return;

  const db = getDb();
  const [owner, repo] = repoFullName.split('/');

  // Get changed files
  let changedFiles: string[] = [];
  try {
    const filesResp = await octokit.pulls.listFiles({ owner, repo, pull_number: prNumber, per_page: 100 });
    changedFiles = filesResp.data.map((f) => f.filename);
  } catch (err) {
    console.warn('[hipp0/github] Failed to list PR files:', (err as Error).message);
    return;
  }

  // Extract keywords from filenames
  const keywords = new Set<string>();
  for (const file of changedFiles) {
    const parts = file.replace(/\.[^.]+$/, '').split(/[\/_-]/);
    for (const part of parts) {
      if (part.length > 2) keywords.add(part.toLowerCase());
    }
  }

  // Score active decisions by keyword overlap
  const decisions = await db.query(
    `SELECT id, title, status, tags, project_id FROM decisions
     WHERE project_id = ? AND status = 'active'
     ORDER BY created_at DESC LIMIT 200`,
    [projectId],
  );

  const scored: Array<{ id: string; title: string; status: string; score: number }> = [];
  for (const row of decisions.rows as Record<string, unknown>[]) {
    const titleWords = (row.title as string).toLowerCase().split(/\s+/);
    let rawTags: string[] = [];
    try {
      rawTags = typeof row.tags === 'string' ? JSON.parse(row.tags) : (row.tags as string[]) ?? [];
    } catch { /* skip */ }
    const tagWords = rawTags.map((t) => t.toLowerCase());
    const allWords = [...titleWords, ...tagWords];

    let matchCount = 0;
    for (const w of allWords) {
      if (keywords.has(w)) matchCount++;
    }
    if (matchCount > 0) {
      scored.push({
        id: row.id as string,
        title: row.title as string,
        status: row.status as string,
        score: matchCount,
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 5);
  if (top.length === 0) return;

  // Build comment body
  const dashboardUrl = process.env.HIPP0_DASHBOARD_URL ?? 'http://localhost:3200';
  const lines = [
    '### Hipp0 — Relevant Decisions\n',
    '| Decision | Status | Relevance |',
    '|----------|--------|-----------|',
  ];
  for (const d of top) {
    const stars = d.score >= 3 ? 'High' : d.score >= 2 ? 'Medium' : 'Low';
    lines.push(`| [${d.title}](${dashboardUrl}/#graph?d=${d.id}) | ${d.status} | ${stars} |`);
  }
  lines.push('\n*Auto-generated by Hipp0*');

  const commentBody = lines.join('\n');

  // Check for existing Hipp0 comment (update, don't duplicate)
  try {
    const comments = await octokit.issues.listComments({ owner, repo, issue_number: prNumber, per_page: 100 });
    const existing = comments.data.find((c) =>
      c.body?.includes('### Hipp0 — Relevant Decisions'),
    );

    if (existing) {
      await octokit.issues.updateComment({ owner, repo, comment_id: existing.id, body: commentBody });
    } else {
      await octokit.issues.createComment({ owner, repo, issue_number: prNumber, body: commentBody });
    }
  } catch (err) {
    console.warn('[hipp0/github] Failed to post comment:', (err as Error).message);
  }

  // Auto-create 'affects' links for high-relevance matches
  const externalId = `${repoFullName}#${prNumber}`;
  for (const d of top) {
    if (d.score >= 2) {
      await upsertLink({
        decisionId: d.id,
        projectId,
        platform: 'github',
        externalId,
        externalUrl: prUrl,
        linkType: 'affects',
        title: prTitle,
        author: prAuthor,
        linkedBy: 'auto',
      });
    }
  }
}

  // C: On PR merged — update link status

async function updateLinksOnMerge(repoFullName: string, prNumber: number): Promise<void> {
  const db = getDb();
  const externalId = `${repoFullName}#${prNumber}`;
  await db.query(
    `UPDATE decision_links SET status = 'merged', updated_at = NOW()
     WHERE platform = 'github' AND external_id = ?`,
    [externalId],
  );
}

  // D: Notify linked open PRs when decision superseded

export async function notifySupersededDecision(
  oldDecisionId: string,
  newDecisionId: string,
  newDecisionTitle: string,
): Promise<void> {
  const octokit = getGitHubClient();
  if (!octokit) return;

  const db = getDb();
  const links = await db.query(
    `SELECT external_id, external_url FROM decision_links
     WHERE decision_id = ? AND platform = 'github' AND status = 'open'`,
    [oldDecisionId],
  );

  for (const row of links.rows as Record<string, unknown>[]) {
    const externalId = row.external_id as string;
    // Parse owner/repo#number
    const match = externalId.match(/^(.+)#(\d+)$/);
    if (!match) continue;

    const [owner, repo] = match[1].split('/');
    const prNumber = parseInt(match[2], 10);

    const dashboardUrl = process.env.HIPP0_DASHBOARD_URL ?? 'http://localhost:3200';
    const body = [
      '### Hipp0 — Decision Superseded\n',
      `> **Warning:** A decision linked to this PR has been superseded.\n`,
      `| | |`,
      `|---|---|`,
      `| **Old decision** | [View](${dashboardUrl}/#graph?d=${oldDecisionId}) |`,
      `| **New decision** | [${newDecisionTitle}](${dashboardUrl}/#graph?d=${newDecisionId}) |`,
      `\nThis PR may need updates to align with the new decision.\n`,
      '*Auto-generated by Hipp0*',
    ].join('\n');

    try {
      await octokit.issues.createComment({ owner, repo, issue_number: prNumber, body });
    } catch (err) {
      console.warn(`[hipp0/github] Failed to notify PR ${externalId}:`, (err as Error).message);
    }
  }
}

  // Register webhook

export function registerGitHubWebhook(app: Hono): void {
  const webhookSecret = process.env.HIPP0_GITHUB_WEBHOOK_SECRET ?? '';
  const projectId = process.env.HIPP0_GITHUB_PROJECT_ID
    ?? process.env.HIPP0_DEFAULT_PROJECT_ID
    ?? '';

  app.post('/api/webhooks/github', async (c) => {
    // Get raw body for signature verification
    const rawBody = await c.req.text();
    const signature = c.req.header('X-Hub-Signature-256') ?? c.req.header('x-hub-signature-256');

    // Verify signature if secret is configured
    if (webhookSecret) {
      if (!verifySignature(rawBody, signature, webhookSecret)) {
        console.warn('[hipp0/github] Webhook signature verification failed');
        return c.json({ error: 'Invalid signature' }, 401);
      }
    }

    let payload: PRPayload;
    try {
      payload = JSON.parse(rawBody) as PRPayload;
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400);
    }

    const pr = payload.pull_request;
    if (!pr) {
      return c.json({ status: 'ignored', reason: 'No pull_request in payload' });
    }

    const body = pr.body ?? '';
    const prNumber = pr.number ?? 0;
    const prUrl = pr.html_url ?? '';
    const prTitle = pr.title ?? '';
    const prAuthor = pr.user?.login ?? 'github';
    const repoFullName = pr.base?.repo?.full_name ?? '';

      // A+B: On PR opened or edited — scan references + post comment

    if (payload.action === 'opened' || payload.action === 'edited') {
      if (!projectId) {
        return c.json({ status: 'ignored', reason: 'No project ID configured' });
      }

      let linkCount = 0;
      if (body.length > 0) {
        linkCount = await scanForReferences(body, prTitle, prNumber, prUrl, prAuthor, repoFullName, projectId);
      }

      // Post relevant decisions comment (fire-and-forget)
      postRelevantDecisionsComment(repoFullName, prNumber, prUrl, prTitle, prAuthor, projectId).catch(
        (err) => console.warn('[hipp0/github] Comment posting failed:', (err as Error).message),
      );

      console.warn(`[hipp0/github] PR #${prNumber} ${payload.action} — ${linkCount} reference(s) linked`);
      return c.json({ status: 'processed', action: payload.action, links_created: linkCount });
    }

      // C: On PR closed+merged — update links + existing extraction

    if (payload.action === 'closed' && pr.merged) {
      // Update link statuses to 'merged'
      if (repoFullName && prNumber) {
        await updateLinksOnMerge(repoFullName, prNumber);
      }

      // Existing distillery extraction logic
      if (body.length < 20) {
        return c.json({ status: 'ignored', reason: 'PR body too short' });
      }

      if (!matchesDecisionPattern(body)) {
        return c.json({ status: 'links_updated', reason: 'No decision language — links updated only' });
      }

      if (!projectId) {
        console.error('[hipp0/github] No project ID configured');
        return c.json({ error: 'No project ID configured' }, 500);
      }

      const madeBy = prAuthor;
      const tags = (pr.labels ?? []).map((l) => l.name.toLowerCase());
      const affects = (pr.requested_reviewers ?? [])
        .map((r) => r.login)
        .filter(Boolean) as string[];

      const truncatedBody = body.slice(0, MAX_EXTRACTION_LENGTH);
      const rawText = `PR #${prNumber}: ${prTitle}\n\n${truncatedBody}`;

      await submitForExtraction({
        raw_text: rawText,
        source: 'github',
        source_session_id: `github:pr:${prNumber}`,
        made_by: madeBy,
        project_id: projectId,
      });

      console.warn(`[hipp0/github] PR #${prNumber} merged — decision extraction queued (by ${madeBy})`);

      return c.json({
        status: 'processing',
        pr_number: prNumber,
        made_by: madeBy,
        tags,
        affects,
        links_updated: true,
      });
    }

      // On PR closed without merge — update links to 'closed'

    if (payload.action === 'closed' && !pr.merged) {
      if (repoFullName && prNumber) {
        const db = getDb();
        const externalId = `${repoFullName}#${prNumber}`;
        await db.query(
          `UPDATE decision_links SET status = 'closed', updated_at = NOW()
           WHERE platform = 'github' AND external_id = ?`,
          [externalId],
        );
      }
      return c.json({ status: 'links_updated', action: 'closed' });
    }

    return c.json({ status: 'ignored', reason: `Unhandled action: ${payload.action}` });
  });
}
