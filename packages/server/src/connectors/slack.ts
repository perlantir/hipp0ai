/**
 * Slack Webhook Connector for Decision Ingestion.
 *
 * Provides:
 * - POST /api/webhooks/slack/events — Slack Events API endpoint
 * - URL verification challenge response
 * - Slack signing secret verification
 * - Message events + lock reaction capture
 * - Slash commands: /hipp0-decision, /hipp0-ask, /hipp0-status
 * - Idempotency by event_id/message_ts
 */
import type { Hono } from 'hono';
import crypto from 'node:crypto';
import { submitForExtraction } from '../queue/index.js';
import { getDb } from '@hipp0/core/db/index.js';
import { callLLM } from '@hipp0/core/distillery/index.js';
import { logAudit } from '../routes/validation.js';
import {
  insertImportedDecision,
  type ExtractedDecision,
  type SyncOptions,
  type SyncResult,
} from './notion.js';

  // Decision pattern matching
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

  // State
let _connected = false;
const _processedEvents = new Set<string>();

// Prune processed events cache every 5 minutes
setInterval(() => {
  if (_processedEvents.size > 10000) _processedEvents.clear();
}, 5 * 60_000).unref();

  // Public API
export function isSlackConnected(): boolean {
  return _connected;
}

export function getSlackStatus(): Record<string, unknown> {
  return {
    connected: _connected,
    events_processed: _processedEvents.size,
  };
}

  // Signing secret verification
function verifySlackSignature(
  signingSecret: string,
  signature: string | undefined,
  timestamp: string | undefined,
  body: string,
): boolean {
  if (!signature || !timestamp) return false;

  // Check timestamp freshness (5 min window)
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp, 10)) > 60 * 5) return false;

  const sigBasestring = `v0:${timestamp}:${body}`;
  const mySignature = 'v0=' + crypto.createHmac('sha256', signingSecret).update(sigBasestring).digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(mySignature), Buffer.from(signature));
  } catch {
    return false;
  }
}

  // Slack event types
interface SlackEvent {
  type: string;
  challenge?: string;
  event_id?: string;
  event?: {
    type: string;
    text?: string;
    user?: string;
    channel?: string;
    ts?: string;
    thread_ts?: string;
    bot_id?: string;
    reaction?: string;
    item?: {
      type: string;
      channel: string;
      ts: string;
    };
  };
}

/**
 * Register Slack webhook routes on the Hono app.
 */
export function registerSlackConnector(app: Hono): void {
  const signingSecret = process.env.HIPP0_SLACK_SIGNING_SECRET ?? '';
  const projectId = process.env.HIPP0_SLACK_PROJECT_ID
    ?? process.env.HIPP0_DEFAULT_PROJECT_ID
    ?? '';
  const allowedChannels = new Set(
    (process.env.HIPP0_SLACK_CHANNEL_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  );

  if (!signingSecret) {
    console.warn('[hipp0/slack] No HIPP0_SLACK_SIGNING_SECRET — Slack disabled');
    return;
  }

  if (!projectId) {
    console.error('[hipp0/slack] HIPP0_SLACK_PROJECT_ID required when Slack is enabled');
    return;
  }

  _connected = true;

  // Events endpoint
  app.post('/api/webhooks/slack/events', async (c) => {
    const rawBody = await c.req.text();
    const slackSignature = c.req.header('X-Slack-Signature') ?? c.req.header('x-slack-signature');
    const slackTimestamp = c.req.header('X-Slack-Request-Timestamp') ?? c.req.header('x-slack-request-timestamp');

    // Verify signature
    if (!verifySlackSignature(signingSecret, slackSignature, slackTimestamp, rawBody)) {
      console.warn('[hipp0/slack] Signature verification failed');
      return c.json({ error: 'Invalid signature' }, 401);
    }

    let payload: SlackEvent;
    try {
      payload = JSON.parse(rawBody) as SlackEvent;
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400);
    }

    // URL verification challenge
    if (payload.type === 'url_verification' && payload.challenge) {
      return c.json({ challenge: payload.challenge });
    }

    // Idempotency check
    if (payload.event_id) {
      if (_processedEvents.has(payload.event_id)) {
        return c.json({ status: 'already_processed' });
      }
      _processedEvents.add(payload.event_id);
    }

    const event = payload.event;
    if (!event) return c.json({ status: 'no_event' });

    // Skip bot messages
    if (event.bot_id) return c.json({ status: 'ignored', reason: 'bot_message' });

    // Channel filter
    const channel = event.channel ?? event.item?.channel ?? '';
    if (allowedChannels.size > 0 && channel && !allowedChannels.has(channel)) {
      return c.json({ status: 'ignored', reason: 'channel_not_allowed' });
    }

    // Handle message events
    if (event.type === 'message' && event.text) {
      const text = event.text;
      const ts = event.ts ?? '';
      const threadTs = event.thread_ts ?? '';

      // Idempotency by message_ts
      const msgKey = `msg:${channel}:${ts}`;
      if (_processedEvents.has(msgKey)) {
        return c.json({ status: 'already_processed' });
      }
      _processedEvents.add(msgKey);

      // Short messages ignored
      if (text.length < 50) {
        return c.json({ status: 'ignored', reason: 'too_short' });
      }

      // Check for decision patterns
      if (!matchesDecisionPattern(text)) {
        return c.json({ status: 'ignored', reason: 'no_decision_pattern' });
      }

      await submitForExtraction({
        raw_text: text,
        source: 'slack',
        source_session_id: `slack:${channel}:${ts}${threadTs ? ':' + threadTs : ''}`,
        made_by: event.user ?? 'slack-user',
        project_id: projectId,
      });

      console.warn(`[hipp0/slack] Decision detected in channel ${channel} — queued for extraction`);
      return c.json({ status: 'processing' });
    }

    // Handle lock reaction (decision capture)
    if (event.type === 'reaction_added' && event.reaction === 'lock') {
      console.warn(`[hipp0/slack] Lock reaction in channel ${event.item?.channel} — could fetch message for extraction`);
      return c.json({ status: 'reaction_noted' });
    }

    return c.json({ status: 'ignored', reason: 'unhandled_event_type' });
  });

  // Slash commands endpoint
  app.post('/api/webhooks/slack/commands', async (c) => {
    const rawBody = await c.req.text();
    const slackSignature = c.req.header('X-Slack-Signature') ?? c.req.header('x-slack-signature');
    const slackTimestamp = c.req.header('X-Slack-Request-Timestamp') ?? c.req.header('x-slack-request-timestamp');

    if (!verifySlackSignature(signingSecret, slackSignature, slackTimestamp, rawBody)) {
      return c.json({ error: 'Invalid signature' }, 401);
    }

    // Parse URL-encoded form data
    const params = new URLSearchParams(rawBody);
    const command = params.get('command') ?? '';
    const text = params.get('text') ?? '';
    const userId = params.get('user_id') ?? 'slack-user';

    switch (command) {
      case '/hipp0-decision': {
        if (text.length < 10) {
          return c.json({ response_type: 'ephemeral', text: 'Decision text must be at least 10 characters.' });
        }

        await submitForExtraction({
          raw_text: text,
          source: 'slack',
          source_session_id: `slack:cmd:${Date.now()}:${userId}`,
          made_by: userId,
          project_id: projectId,
        });

        return c.json({ response_type: 'in_channel', text: 'Processing decision...' });
      }

      case '/hipp0-ask': {
        if (!text) {
          return c.json({ response_type: 'ephemeral', text: 'Please provide a question.' });
        }

        try {
          const db = getDb();
          const result = await db.query(
            "SELECT title, description, made_by FROM decisions WHERE project_id = ? AND status != 'superseded' ORDER BY created_at DESC LIMIT 20",
            [projectId],
          );
          const decisions = result.rows as Array<Record<string, unknown>>;
          const decisionContext = decisions.map((d, i) =>
            `${i + 1}. "${d.title}" - ${d.description ?? ''} (by ${d.made_by ?? 'unknown'})`,
          ).join('\n');

          const answer = await callLLM(
            'You are a decision memory assistant. Answer the question using only the provided decisions. Be concise (2-4 sentences). No markdown.',
            `Question: ${text}\n\nDecisions:\n${decisionContext}`,
          );

          return c.json({ response_type: 'in_channel', text: answer || 'No relevant decisions found.' });
        } catch (err) {
          console.error('[hipp0/slack] /hipp0-ask error:', (err as Error).message);
          return c.json({ response_type: 'ephemeral', text: 'Failed to process question.' });
        }
      }

      case '/hipp0-status': {
        try {
          const db = getDb();
          const [decResult, agentResult] = await Promise.all([
            db.query('SELECT count(*) as c FROM decisions WHERE project_id = ?', [projectId]),
            db.query('SELECT count(*) as c FROM agents WHERE project_id = ?', [projectId]),
          ]);
          const decCount = parseInt((decResult.rows[0] as Record<string, unknown>)?.c as string ?? '0', 10);
          const agentCount = parseInt((agentResult.rows[0] as Record<string, unknown>)?.c as string ?? '0', 10);

          return c.json({ response_type: 'in_channel', text: `Hipp0: ${decCount} decisions, ${agentCount} agents` });
        } catch (err) {
          console.error('[hipp0/slack] /hipp0-status error:', (err as Error).message);
          return c.json({ response_type: 'ephemeral', text: 'Failed to get status.' });
        }
      }

      default:
        return c.json({ response_type: 'ephemeral', text: 'Unknown command.' });
    }
  });

  console.warn('[hipp0/slack] Webhook connector registered');
}

/* ================================================================== */
/*  IMPORT FLOW — scrape decisions from Slack channels                  */
/* ================================================================== */

const SLACK_API = 'https://slack.com/api';

/* ---- Rate limit (60 req/min sliding window) ---- */
const _slackRequestTimestamps: number[] = [];
async function slackRateLimit(): Promise<void> {
  const now = Date.now();
  const oneMinuteAgo = now - 60_000;
  while (_slackRequestTimestamps.length && _slackRequestTimestamps[0] < oneMinuteAgo) {
    _slackRequestTimestamps.shift();
  }
  if (_slackRequestTimestamps.length >= 60) {
    const waitMs = _slackRequestTimestamps[0] + 60_000 - now + 50;
    await new Promise((r) => setTimeout(r, waitMs));
    return slackRateLimit();
  }
  _slackRequestTimestamps.push(now);
}

async function slackFetch<T = Record<string, unknown>>(
  token: string,
  path: string,
  params?: Record<string, string>,
): Promise<T> {
  await slackRateLimit();
  const url = new URL(`${SLACK_API}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });

  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get('Retry-After') ?? '5', 10);
    await new Promise((r) => setTimeout(r, retryAfter * 1000));
    return slackFetch(token, path, params);
  }
  if (!res.ok) {
    throw new Error(`Slack API ${res.status}: ${res.statusText}`);
  }
  const json = (await res.json()) as { ok: boolean; error?: string } & T;
  if (!json.ok) {
    if (json.error === 'invalid_auth' || json.error === 'token_expired') {
      throw new Error('Slack token invalid or expired');
    }
    if (json.error === 'ratelimited') {
      await new Promise((r) => setTimeout(r, 5000));
      return slackFetch(token, path, params);
    }
    throw new Error(`Slack API error: ${json.error ?? 'unknown'}`);
  }
  return json;
}

/* ------------------------------------------------------------------ */
/*  Public: List channels                                              */
/* ------------------------------------------------------------------ */

export interface SlackChannelSummary {
  id: string;
  name: string;
  is_private: boolean;
  is_member: boolean;
  num_members?: number;
  topic?: string;
}

export async function listSlackChannels(token: string): Promise<SlackChannelSummary[]> {
  const data = await slackFetch<{ channels: Array<Record<string, unknown>> }>(
    token,
    '/conversations.list',
    { types: 'public_channel,private_channel', limit: '200', exclude_archived: 'true' },
  );

  return data.channels.map((ch) => ({
    id: ch.id as string,
    name: (ch.name as string) ?? '',
    is_private: Boolean(ch.is_private),
    is_member: Boolean(ch.is_member),
    num_members: (ch.num_members as number) ?? undefined,
    topic: ((ch.topic as Record<string, unknown>)?.value as string) ?? undefined,
  }));
}

/* ------------------------------------------------------------------ */
/*  Public: Fetch messages                                             */
/* ------------------------------------------------------------------ */

export interface SlackMessage {
  ts: string;
  user?: string;
  userName?: string;
  text: string;
  thread_ts?: string;
  reactions?: Array<{ name: string; count: number; users?: string[] }>;
  replies?: SlackMessage[];
  channel: string;
  channelName: string;
}

async function getUserName(
  token: string,
  userId: string,
  cache: Map<string, string>,
): Promise<string> {
  if (cache.has(userId)) return cache.get(userId)!;
  try {
    const data = await slackFetch<{ user: Record<string, unknown> }>(
      token,
      '/users.info',
      { user: userId },
    );
    const profile = data.user.profile as Record<string, unknown> | undefined;
    const name =
      (profile?.display_name as string) ||
      (profile?.real_name as string) ||
      (data.user.name as string) ||
      userId;
    cache.set(userId, name);
    return name;
  } catch {
    cache.set(userId, userId);
    return userId;
  }
}

export async function fetchSlackMessages(
  token: string,
  channelId: string,
  since?: string,
): Promise<SlackMessage[]> {
  // Resolve channel name
  let channelName = channelId;
  try {
    const chData = await slackFetch<{ channel: Record<string, unknown> }>(
      token,
      '/conversations.info',
      { channel: channelId },
    );
    channelName = (chData.channel.name as string) ?? channelId;
  } catch { /* non-fatal */ }

  const params: Record<string, string> = { channel: channelId, limit: '100' };
  if (since) params.oldest = since;

  const data = await slackFetch<{ messages: Array<Record<string, unknown>> }>(
    token,
    '/conversations.history',
    params,
  );

  const userCache = new Map<string, string>();
  const messages: SlackMessage[] = [];

  for (const m of data.messages ?? []) {
    if (m.subtype) continue; // skip join/leave/etc.
    const userId = (m.user as string) ?? '';
    const userName = userId ? await getUserName(token, userId, userCache) : 'slack';

    const msg: SlackMessage = {
      ts: (m.ts as string) ?? '',
      user: userId,
      userName,
      text: (m.text as string) ?? '',
      thread_ts: (m.thread_ts as string) ?? undefined,
      reactions: (m.reactions as SlackMessage['reactions']) ?? [],
      channel: channelId,
      channelName,
    };

    // If this message has a thread, fetch replies
    if ((m.reply_count as number) > 0 && m.thread_ts === m.ts) {
      try {
        const repliesData = await slackFetch<{ messages: Array<Record<string, unknown>> }>(
          token,
          '/conversations.replies',
          { channel: channelId, ts: msg.ts, limit: '50' },
        );
        msg.replies = [];
        for (const r of (repliesData.messages ?? []).slice(1)) {
          const rUserId = (r.user as string) ?? '';
          const rUserName = rUserId ? await getUserName(token, rUserId, userCache) : 'slack';
          msg.replies.push({
            ts: (r.ts as string) ?? '',
            user: rUserId,
            userName: rUserName,
            text: (r.text as string) ?? '',
            reactions: (r.reactions as SlackMessage['reactions']) ?? [],
            channel: channelId,
            channelName,
          });
        }
      } catch { /* non-fatal */ }
    }

    messages.push(msg);
  }

  return messages;
}

/* ------------------------------------------------------------------ */
/*  Public: Extract decisions from messages                            */
/* ------------------------------------------------------------------ */

const SLACK_DECIDED_PREFIX = /^(?:DECIDED|DECISION|RESOLVED)\s*:\s*/i;
const SLACK_PHRASES: RegExp[] = [
  /\bwe(?:'re| are) going with\b/i,
  /\bwe decided\b/i,
  /\bwe chose\b/i,
  /\blet'?s go with\b/i,
  /\bagreed to\b/i,
];

function hasCheckmarkReaction(msg: SlackMessage): boolean {
  return (msg.reactions ?? []).some(
    (r) => r.name === 'white_check_mark' || r.name === 'heavy_check_mark',
  );
}

function hasThumbsUpReaction(msg: SlackMessage): boolean {
  return (msg.reactions ?? []).some(
    (r) => (r.name === '+1' || r.name === 'thumbsup') && r.count > 0,
  );
}

export function extractDecisionsFromMessages(
  messages: SlackMessage[],
): ExtractedDecision[] {
  const results: ExtractedDecision[] = [];

  for (const msg of messages) {
    if (!msg.text || msg.text.length < 10) continue;

    let matched = false;
    let decisionText = msg.text;

    // 1. Explicit "DECIDED:" prefix
    if (SLACK_DECIDED_PREFIX.test(msg.text)) {
      matched = true;
      decisionText = msg.text.replace(SLACK_DECIDED_PREFIX, '').trim();
    }

    // 2. :white_check_mark: reaction on parent message
    if (!matched && hasCheckmarkReaction(msg)) {
      matched = true;
    }

    // 3. Decision phrases in text
    if (!matched && SLACK_PHRASES.some((p) => p.test(msg.text))) {
      matched = true;
    }

    // 4. Thread resolution: parent + :thumbsup: on a reply
    if (!matched && msg.replies && msg.replies.length > 0) {
      const resolvingReply = msg.replies.find((r) => hasThumbsUpReaction(r));
      if (resolvingReply) {
        matched = true;
        decisionText = `${msg.text}\n\nResolved by @${resolvingReply.userName}: ${resolvingReply.text}`;
      }
    }

    if (!matched) continue;

    const firstSentence =
      decisionText.split(/[.!?\n]/)[0].slice(0, 500) || decisionText.slice(0, 100);

    results.push({
      title: firstSentence,
      description: decisionText.slice(0, 10000),
      reasoning: decisionText.slice(0, 10000),
      made_by: msg.userName || 'slack',
      tags: [`slack`, `#${msg.channelName}`],
      source_url: `https://slack.com/archives/${msg.channel}/p${msg.ts.replace('.', '')}`,
      source_ref: `slack:${msg.channel}:${msg.ts}`,
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

export async function syncSlackToHipp0(
  projectId: string,
  token: string,
  channelId: string,
  options: (SyncOptions & { since?: string }) = {},
): Promise<SyncResult & { messages_scanned: number }> {
  const errors: string[] = [];
  const preview: ExtractedDecision[] = [];
  let messagesScanned = 0;
  let decisionsFound = 0;
  let decisionsImported = 0;

  console.warn(
    `[hipp0/slack] Sync starting project=${projectId} channel=${channelId} since=${options.since ?? '(none)'}`,
  );

  let messages: SlackMessage[];
  try {
    messages = await fetchSlackMessages(token, channelId, options.since);
    messagesScanned = messages.length;
  } catch (err) {
    const msg = (err as Error).message;
    console.error(`[hipp0/slack] Failed to fetch messages: ${msg}`);
    return {
      pages_scanned: 0,
      messages_scanned: 0,
      decisions_found: 0,
      decisions_imported: 0,
      errors: [msg],
    };
  }

  const extracted = extractDecisionsFromMessages(messages);
  decisionsFound = extracted.length;

  console.warn(
    `[hipp0/slack] Scanned ${messagesScanned} messages → ${decisionsFound} decision(s)`,
  );

  if (options.dryRun) {
    preview.push(...extracted);
  } else {
    for (const d of extracted) {
      try {
        await insertImportedDecision(projectId, d);
        decisionsImported++;
      } catch (err) {
        errors.push(`insert "${d.title}": ${(err as Error).message}`);
      }
    }
  }

  logAudit('slack_sync', projectId, {
    channel_id: channelId,
    messages_scanned: messagesScanned,
    decisions_found: decisionsFound,
    decisions_imported: decisionsImported,
    dry_run: options.dryRun ?? false,
  });

  console.warn(
    `[hipp0/slack] Sync complete: ${messagesScanned} messages, ${decisionsFound} found, ${decisionsImported} imported`,
  );

  return {
    pages_scanned: 0,
    messages_scanned: messagesScanned,
    decisions_found: decisionsFound,
    decisions_imported: decisionsImported,
    errors,
    preview: options.dryRun ? preview : undefined,
  };
}
