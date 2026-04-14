/**
 * Webhook Dispatcher — sends event notifications to configured
 * Slack, Discord, Telegram, and generic webhook endpoints.
 *
 * All delivery is fire-and-forget: callers should `.catch()` errors
 * and never await the returned promise in a request-critical path.
 */

import { createHmac } from 'node:crypto';
import * as dnsPromises from 'node:dns/promises';
import { getDb } from '../db/index.js';

/**
 * Check whether an IPv4 or IPv6 address points at a private, loopback,
 * link-local, or CGNAT range. Used as defense-in-depth against DNS
 * rebinding: the create-time URL allowlist only sees the hostname; by
 * the time we dispatch, a malicious DNS server can answer with an
 * internal IP. Resolving immediately before fetch and re-checking
 * defeats that trick.
 *
 * Also handles IPv4-mapped IPv6 ("::ffff:10.0.0.1") which would otherwise
 * reach e.g. 10.0.0.1 via a v6 socket.
 */
function isPrivateIp(addr: string, family: number): boolean {
  if (family === 4) return isPrivateIpv4(addr);
  if (family === 6) {
    const lower = addr.toLowerCase();
    // IPv4-mapped: ::ffff:a.b.c.d
    const mapped = lower.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (mapped) return isPrivateIpv4(mapped[1]);
    // Loopback ::1
    if (lower === '::1' || lower === '0:0:0:0:0:0:0:1') return true;
    // Unspecified ::
    if (lower === '::' || lower === '0:0:0:0:0:0:0:0') return true;
    // Unique local fc00::/7 (fc.. or fd..)
    if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true;
    // Link-local fe80::/10
    if (/^fe[89ab][0-9a-f]:/.test(lower)) return true;
    return false;
  }
  return false;
}

function isPrivateIpv4(addr: string): boolean {
  const parts = addr.split('.').map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    // Anything unparseable is suspect — reject.
    return true;
  }
  const [a, b] = parts;
  // 10.0.0.0/8
  if (a === 10) return true;
  // 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16
  if (a === 192 && b === 168) return true;
  // 127.0.0.0/8 loopback
  if (a === 127) return true;
  // 169.254.0.0/16 link-local
  if (a === 169 && b === 254) return true;
  // 100.64.0.0/10 CGNAT
  if (a === 100 && b >= 64 && b <= 127) return true;
  // 0.0.0.0/8
  if (a === 0) return true;
  return false;
}

/**
 * Resolve a hostname and reject if ANY returned A/AAAA record points at
 * a private, loopback, link-local, or CGNAT address. Throws on failure.
 */
async function assertPublicHostname(hostname: string): Promise<void> {
  // Bare IP literals — classify directly without DNS.
  // IPv4 literal
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
    if (isPrivateIp(hostname, 4)) throw new Error(`Refusing webhook to private IP ${hostname}`);
    return;
  }
  // IPv6 literal (possibly bracketed)
  if (hostname.includes(':') || hostname.startsWith('[')) {
    const stripped = hostname.replace(/^\[|\]$/g, '');
    if (isPrivateIp(stripped, 6)) throw new Error(`Refusing webhook to private IP ${hostname}`);
    return;
  }
  const records = await dnsPromises.lookup(hostname, { all: true, verbatim: true });
  if (!records || records.length === 0) {
    throw new Error(`DNS lookup for ${hostname} returned no records`);
  }
  for (const r of records) {
    if (isPrivateIp(r.address, r.family)) {
      throw new Error(`Refusing webhook: ${hostname} resolves to private IP ${r.address}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WebhookPayload {
  event: string;
  project_id: string;
  timestamp: string;
  data: Record<string, unknown>;
}

interface WebhookConfig {
  id: string;
  project_id: string;
  name: string;
  url: string;
  platform: string;
  events: string[] | string;
  enabled: boolean | number;
  secret: string | null;
  metadata: Record<string, unknown> | string;
}

// ---------------------------------------------------------------------------
// Event title / emoji map
// ---------------------------------------------------------------------------

const EVENT_META: Record<string, { emoji: string; title: string; color: number }> = {
  decision_created:       { emoji: '🟢', title: 'New Decision',          color: 3447003  },  // blue
  decision_superseded:    { emoji: '🟡', title: 'Decision Superseded',   color: 16776960 },  // yellow
  decision_reverted:      { emoji: '↩️',  title: 'Decision Reverted',    color: 10070709 },  // grey
  contradiction_detected: { emoji: '⚠️', title: 'Contradiction Detected', color: 15158332 },  // red
  distillery_completed:   { emoji: '🧪', title: 'Distillery Completed',  color: 10181046 },  // purple
  scan_completed:         { emoji: '🔍', title: 'Scan Completed',        color: 3066993  },  // green
};

function meta(event: string) {
  return EVENT_META[event] ?? { emoji: '📌', title: event, color: 0 };
}

// ---------------------------------------------------------------------------
// Platform formatters
// ---------------------------------------------------------------------------

function formatSlack(payload: WebhookPayload): Record<string, unknown> {
  const m = meta(payload.event);
  const desc = descriptionLine(payload);
  return {
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: `${m.emoji} ${m.title}` },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: desc },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Project: ${(payload.data.project_name as string) ?? payload.project_id} | Hipp0 Decision Memory`,
          },
        ],
      },
    ],
  };
}

function formatDiscord(payload: WebhookPayload): Record<string, unknown> {
  const m = meta(payload.event);
  const desc = descriptionLine(payload);
  return {
    embeds: [
      {
        title: `${m.emoji} ${m.title}`,
        description: desc,
        color: m.color,
        fields: [
          { name: 'Event', value: payload.event, inline: true },
          {
            name: 'Project',
            value: (payload.data.project_name as string) ?? payload.project_id,
            inline: true,
          },
        ],
        footer: { text: 'Hipp0 Decision Memory' },
      },
    ],
  };
}

function formatTelegram(
  payload: WebhookPayload,
  metadata: Record<string, unknown>,
): { url: string; body: Record<string, unknown> } | null {
  const botToken = metadata.bot_token as string | undefined;
  const chatId = metadata.chat_id as string | undefined;
  if (!botToken || !chatId) return null;

  const m = meta(payload.event);
  const desc = descriptionLine(payload);
  return {
    url: `https://api.telegram.org/bot${botToken}/sendMessage`,
    body: {
      chat_id: chatId,
      parse_mode: 'Markdown',
      text: `${m.emoji} *${m.title}*\n\n${desc}`,
    },
  };
}

/** Build a human-readable description string from payload data. */
function descriptionLine(payload: WebhookPayload): string {
  const d = payload.data;

  if (payload.event === 'contradiction_detected') {
    const a = (d.decision_a_title as string) ?? 'Decision A';
    const b = (d.decision_b_title as string) ?? 'Decision B';
    return `"${a}" conflicts with "${b}"`;
  }

  if (payload.event.startsWith('decision_')) {
    const title = (d.title as string) ?? (d.decision_title as string) ?? 'Untitled';
    return `Decision: "${title}"`;
  }

  if (payload.event === 'distillery_completed') {
    const count = d.decisions_extracted ?? 0;
    return `Extracted ${count} decision(s) from conversation`;
  }

  if (payload.event === 'scan_completed') {
    const found = d.contradictions_found ?? 0;
    return `Scan complete — ${found} contradiction(s) found`;
  }

  return JSON.stringify(d).slice(0, 200);
}

// ---------------------------------------------------------------------------
// HMAC signing
// ---------------------------------------------------------------------------

function signPayload(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

// ---------------------------------------------------------------------------
// Dispatcher (main entry point)
// ---------------------------------------------------------------------------

/**
 * Dispatch webhook notifications for a project event.
 *
 * Call this fire-and-forget:
 * ```
 * dispatchWebhooks(projectId, 'decision_created', { ... }).catch(…);
 * ```
 */
export async function dispatchWebhooks(
  projectId: string,
  event: string,
  data: Record<string, unknown>,
): Promise<void> {
  const db = getDb();

  // Fetch enabled webhooks that subscribe to this event
  const result = await db.query<Record<string, unknown>>(
    'SELECT * FROM webhook_configs WHERE project_id = ? AND enabled = ?',
    [projectId, db.dialect === 'sqlite' ? 1 : true],
  );

  const configs = result.rows as unknown as WebhookConfig[];

  const payload: WebhookPayload = {
    event,
    project_id: projectId,
    timestamp: new Date().toISOString(),
    data,
  };

  const promises: Promise<void>[] = [];

  for (const cfg of configs) {
    // Parse events — handle both PG text[] and SQLite JSON string
    const events: string[] =
      typeof cfg.events === 'string' ? JSON.parse(cfg.events) : cfg.events;

    if (!events.includes(event)) continue;

    promises.push(deliverWebhook(cfg, payload));
  }

  await Promise.allSettled(promises);
}

async function deliverWebhook(cfg: WebhookConfig, payload: WebhookPayload): Promise<void> {
  try {
    const metadata: Record<string, unknown> =
      typeof cfg.metadata === 'string' ? JSON.parse(cfg.metadata as string) : cfg.metadata;

    let url = cfg.url;
    let body: string;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    switch (cfg.platform) {
      case 'slack':
        body = JSON.stringify(formatSlack(payload));
        break;
      case 'discord':
        body = JSON.stringify(formatDiscord(payload));
        break;
      case 'telegram': {
        const tg = formatTelegram(payload, metadata);
        if (!tg) {
          console.warn(`[hipp0:webhook] Telegram webhook "${cfg.name}" missing bot_token or chat_id`);
          return;
        }
        url = tg.url;
        body = JSON.stringify(tg.body);
        break;
      }
      default:
        body = JSON.stringify(payload);
    }

    if (cfg.secret) {
      headers['X-Hipp0-Signature'] = signPayload(body, cfg.secret);
    }

    // SSRF defense-in-depth: resolve the destination hostname and bail
    // out if any resolved address is private / loopback / link-local / CGNAT.
    // The URL allowlist at create time only inspects hostnames, which a
    // malicious DNS server can rebind to internal IPs.
    const parsedUrl = new URL(url);
    await assertPublicHostname(parsedUrl.hostname);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });

      if (!res.ok) {
        console.warn(
          `[hipp0:webhook] "${cfg.name}" responded ${res.status} ${res.statusText}`,
        );
      }
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[hipp0:webhook] Failed to deliver to "${cfg.name}": ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// Test helper — send a sample payload to verify connectivity
// ---------------------------------------------------------------------------

export async function testWebhook(
  webhookId: string,
  projectId: string,
): Promise<{ success: boolean; status_code?: number; error?: string }> {
  const db = getDb();
  const result = await db.query<Record<string, unknown>>(
    'SELECT * FROM webhook_configs WHERE id = ? AND project_id = ?',
    [webhookId, projectId],
  );

  if (result.rows.length === 0) {
    return { success: false, error: 'Webhook not found' };
  }

  const cfg = result.rows[0] as unknown as WebhookConfig;
  const metadata: Record<string, unknown> =
    typeof cfg.metadata === 'string' ? JSON.parse(cfg.metadata as string) : cfg.metadata;

  const payload: WebhookPayload = {
    event: 'test',
    project_id: projectId,
    timestamp: new Date().toISOString(),
    data: { message: 'This is a test webhook from Hipp0' },
  };

  try {
    let url = cfg.url;
    let body: string;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    switch (cfg.platform) {
      case 'slack':
        body = JSON.stringify(formatSlack(payload));
        break;
      case 'discord':
        body = JSON.stringify(formatDiscord(payload));
        break;
      case 'telegram': {
        const tg = formatTelegram(payload, metadata);
        if (!tg) return { success: false, error: 'Missing bot_token or chat_id in metadata' };
        url = tg.url;
        body = JSON.stringify(tg.body);
        break;
      }
      default:
        body = JSON.stringify(payload);
    }

    if (cfg.secret) {
      headers['X-Hipp0-Signature'] = signPayload(body, cfg.secret);
    }

    // SSRF defense-in-depth (see deliverWebhook).
    const parsedUrl = new URL(url);
    await assertPublicHostname(parsedUrl.hostname);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });

      return { success: res.ok, status_code: res.status };
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

// Re-export formatters for testing
export { formatSlack, formatDiscord, formatTelegram, signPayload, descriptionLine };
