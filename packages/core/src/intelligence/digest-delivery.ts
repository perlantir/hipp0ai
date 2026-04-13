/**
 * Digest Delivery
 *
 * Transport layer for delivering weekly memory digests to external
 * destinations — email (SMTP via nodemailer), Slack (incoming webhooks with
 * block kit), and generic HTTP webhooks (optionally HMAC-signed).
 *
 * The digest payload itself is generated upstream by
 * `generateWeeklyDigest` (exported as `generateMemoryWeeklyDigest` from the
 * package index) and formatted to markdown by `exportDigestMarkdown`. This
 * module is transport only — it never touches the database, never regenerates
 * the digest, and never throws. Every delivery function wraps all IO in
 * try/catch and returns `{ success, error? }` so callers (jobs, routes) can
 * record the outcome without having to defensively wrap the call.
 */
import { createHmac } from 'node:crypto';
import nodemailer from 'nodemailer';
import { exportDigestMarkdown } from './memory-analytics.js';
import type { WeeklyDigest } from './memory-analytics.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DeliveryResult {
  success: boolean;
  error?: string;
}

export interface SmtpConfig {
  host: string;
  port: number;
  user?: string;
  pass?: string;
  from: string;
  /** Optional project name for subject line. */
  project_name?: string;
  /** Force TLS regardless of port (default: port === 465). */
  secure?: boolean;
}

export interface EmailDeliveryConfig {
  recipients: string[];
  smtp: SmtpConfig;
}

export interface SlackDeliveryConfig {
  webhook_url: string;
  /** Optional project name for header block. */
  project_name?: string;
}

export interface WebhookDeliveryConfig {
  url: string;
  secret?: string;
}

export interface DeliveryConfig {
  email?: EmailDeliveryConfig;
  slack?: SlackDeliveryConfig;
  webhook?: WebhookDeliveryConfig;
}

export interface DeliveryDispatchResult {
  email?: DeliveryResult;
  slack?: DeliveryResult;
  webhook?: DeliveryResult;
  /** True iff every attempted channel succeeded. */
  success: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return String(err);
  } catch {
    return 'unknown error';
  }
}

function formatWeekOf(digest: WeeklyDigest): string {
  // period.start is an ISO string — slice to `YYYY-MM-DD` so it renders the
  // same across locales.
  const start = digest.period?.start ?? '';
  return start.slice(0, 10);
}

/**
 * Convert the exported markdown into very simple HTML. We purposefully avoid
 * pulling in a full markdown parser — the digest output has a known, small
 * set of primitives (headings, list items, bold) which we can translate with
 * a handful of regexes. This keeps the dependency footprint minimal and is
 * good enough for an email client renderer.
 */
export function markdownToSimpleHtml(md: string): string {
  const esc = (s: string): string =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

  const lines = md.split('\n');
  const out: string[] = [];
  let inList = false;

  const flushList = () => {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  };

  const inlineFormat = (text: string): string => {
    let t = esc(text);
    // Bold: **text**
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // Emphasis: *text* (not inside **)
    t = t.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>');
    // Code: `text`
    t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
    return t;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.length === 0) {
      flushList();
      continue;
    }

    if (line.startsWith('# ')) {
      flushList();
      out.push(`<h1 style="font-family:system-ui,sans-serif;color:#111;">${inlineFormat(line.slice(2))}</h1>`);
      continue;
    }
    if (line.startsWith('## ')) {
      flushList();
      out.push(`<h2 style="font-family:system-ui,sans-serif;color:#222;margin-top:24px;">${inlineFormat(line.slice(3))}</h2>`);
      continue;
    }
    if (line.startsWith('### ')) {
      flushList();
      out.push(`<h3 style="font-family:system-ui,sans-serif;color:#333;margin-top:16px;">${inlineFormat(line.slice(4))}</h3>`);
      continue;
    }
    if (line.startsWith('- ')) {
      if (!inList) {
        out.push('<ul style="font-family:system-ui,sans-serif;line-height:1.6;color:#333;">');
        inList = true;
      }
      out.push(`  <li>${inlineFormat(line.slice(2))}</li>`);
      continue;
    }
    flushList();
    out.push(`<p style="font-family:system-ui,sans-serif;line-height:1.5;color:#333;">${inlineFormat(line)}</p>`);
  }
  flushList();

  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f6f7f9;">
    <div style="max-width:640px;margin:0 auto;background:#ffffff;padding:24px 32px;border-radius:8px;border:1px solid #e5e7eb;">
      ${out.join('\n      ')}
    </div>
  </body>
</html>`;
}

// ---------------------------------------------------------------------------
// Email delivery
// ---------------------------------------------------------------------------

/**
 * Send the digest as an HTML email via SMTP (nodemailer).
 *
 * Never throws — all failures are captured and returned in the result.
 */
export async function sendDigestEmail(
  digest: WeeklyDigest,
  recipients: string[],
  smtpConfig: SmtpConfig,
): Promise<DeliveryResult> {
  try {
    if (!Array.isArray(recipients) || recipients.length === 0) {
      return { success: false, error: 'no recipients configured' };
    }
    if (!smtpConfig?.host) {
      return { success: false, error: 'smtp.host is required' };
    }
    if (!smtpConfig.from) {
      return { success: false, error: 'smtp.from is required' };
    }

    const md = exportDigestMarkdown(digest);
    const html = markdownToSimpleHtml(md);
    const projectName = smtpConfig.project_name?.trim() || 'Project';
    const weekOf = formatWeekOf(digest);
    const subject = `Hipp0 Weekly Digest: ${projectName} (Week of ${weekOf})`;

    const port = Number(smtpConfig.port) || 587;
    const transporter = nodemailer.createTransport({
      host: smtpConfig.host,
      port,
      secure: smtpConfig.secure ?? port === 465,
      auth:
        smtpConfig.user && smtpConfig.pass
          ? { user: smtpConfig.user, pass: smtpConfig.pass }
          : undefined,
    });

    await transporter.sendMail({
      from: smtpConfig.from,
      to: recipients.join(', '),
      subject,
      text: md,
      html,
    });

    return { success: true };
  } catch (err) {
    return { success: false, error: toErrorMessage(err) };
  }
}

// ---------------------------------------------------------------------------
// Slack delivery
// ---------------------------------------------------------------------------

interface SlackBlock {
  type: string;
  [key: string]: unknown;
}

/** Build Slack block-kit blocks from a digest. Exported for testing. */
export function buildSlackBlocks(
  digest: WeeklyDigest,
  projectName?: string,
): SlackBlock[] {
  const weekOf = formatWeekOf(digest);
  const name = projectName?.trim() || 'Hipp0 Project';
  const blocks: SlackBlock[] = [];

  blocks.push({
    type: 'header',
    text: {
      type: 'plain_text',
      text: `Hipp0 Weekly Digest — ${name} (Week of ${weekOf})`,
      emoji: true,
    },
  });

  blocks.push({
    type: 'section',
    fields: [
      {
        type: 'mrkdwn',
        text: `*Decisions made*\n${digest.highlights.decisions_made}`,
      },
      {
        type: 'mrkdwn',
        text: `*Outcomes recorded*\n${digest.highlights.outcomes_recorded}`,
      },
      {
        type: 'mrkdwn',
        text: `*Contradictions found*\n${digest.highlights.contradictions_found}`,
      },
      {
        type: 'mrkdwn',
        text: `*Contradictions resolved*\n${digest.highlights.contradictions_resolved}`,
      },
    ],
  });

  if (digest.highlights.skill_changes.length > 0) {
    const lines = digest.highlights.skill_changes
      .slice(0, 5)
      .map((c) => {
        const arrow = c.delta >= 0 ? ':arrow_up:' : ':arrow_down:';
        const pct = Math.round(Math.abs(c.delta) * 100);
        return `${arrow} ${c.agent} / ${c.domain}: ${pct}%`;
      })
      .join('\n');
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Skill changes*\n${lines}` },
    });
  }

  if (digest.top_decisions.length > 0) {
    const lines = digest.top_decisions
      .slice(0, 5)
      .map((d) => {
        const rate = Math.round(d.success_rate * 100);
        return `• *${d.title}* — ${d.compile_count} compiles, ${rate}% success`;
      })
      .join('\n');
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Top decisions*\n${lines}` },
    });
  }

  if (digest.emerging_patterns.length > 0) {
    const lines = digest.emerging_patterns
      .slice(0, 5)
      .map((p) => `• ${p.pattern} (${p.evidence_count} evidence points)`)
      .join('\n');
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Emerging patterns*\n${lines}` },
    });
  }

  if (digest.alerts.length > 0) {
    const lines = digest.alerts.slice(0, 5).map((a) => `:warning: ${a}`).join('\n');
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Alerts*\n${lines}` },
    });
  }

  if (digest.recommendations.length > 0) {
    const lines = digest.recommendations
      .slice(0, 5)
      .map((r) => `• ${r}`)
      .join('\n');
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Recommendations*\n${lines}` },
    });
  }

  return blocks;
}

/**
 * POST the digest to a Slack incoming webhook as block-kit content.
 *
 * Never throws — all failures are captured and returned in the result.
 */
export async function sendDigestSlack(
  digest: WeeklyDigest,
  webhookUrl: string,
  projectName?: string,
): Promise<DeliveryResult> {
  try {
    if (!webhookUrl || typeof webhookUrl !== 'string') {
      return { success: false, error: 'slack webhook_url is required' };
    }

    const blocks = buildSlackBlocks(digest, projectName);
    const weekOf = formatWeekOf(digest);
    const name = projectName?.trim() || 'Hipp0 Project';
    const body = JSON.stringify({
      text: `Hipp0 Weekly Digest — ${name} (Week of ${weekOf})`,
      blocks,
    });

    const resp = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      return {
        success: false,
        error: `slack returned ${resp.status}: ${txt.slice(0, 200)}`,
      };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: toErrorMessage(err) };
  }
}

// ---------------------------------------------------------------------------
// Generic webhook delivery
// ---------------------------------------------------------------------------

/**
 * POST the digest as raw JSON to an arbitrary HTTP endpoint. If a shared
 * secret is provided, the request is signed with an HMAC-SHA256 signature
 * over the raw request body, passed in `X-Hipp0-Signature`.
 *
 * Never throws — all failures are captured and returned in the result.
 */
export async function sendDigestWebhook(
  digest: WeeklyDigest,
  webhookUrl: string,
  secret?: string,
): Promise<DeliveryResult> {
  try {
    if (!webhookUrl || typeof webhookUrl !== 'string') {
      return { success: false, error: 'webhook url is required' };
    }

    const payload = {
      event: 'weekly_digest',
      delivered_at: new Date().toISOString(),
      digest,
    };
    const body = JSON.stringify(payload);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'Hipp0-Digest-Delivery/1.0',
    };

    if (secret && typeof secret === 'string' && secret.length > 0) {
      const signature = createHmac('sha256', secret).update(body).digest('hex');
      headers['X-Hipp0-Signature'] = `sha256=${signature}`;
    }

    const resp = await fetch(webhookUrl, {
      method: 'POST',
      headers,
      body,
    });

    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      return {
        success: false,
        error: `webhook returned ${resp.status}: ${txt.slice(0, 200)}`,
      };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: toErrorMessage(err) };
  }
}

// ---------------------------------------------------------------------------
// Unified dispatcher
// ---------------------------------------------------------------------------

/**
 * Dispatch a digest across every channel configured in `config`. Each
 * channel runs independently and failures do not affect other channels.
 * Returns a combined result with per-channel status.
 */
export async function deliverDigest(
  digest: WeeklyDigest,
  config: DeliveryConfig,
): Promise<DeliveryDispatchResult> {
  const tasks: Array<Promise<void>> = [];
  const result: DeliveryDispatchResult = { success: true };

  if (config.email) {
    tasks.push(
      (async () => {
        result.email = await sendDigestEmail(
          digest,
          config.email!.recipients,
          config.email!.smtp,
        );
      })(),
    );
  }

  if (config.slack) {
    tasks.push(
      (async () => {
        result.slack = await sendDigestSlack(
          digest,
          config.slack!.webhook_url,
          config.slack!.project_name,
        );
      })(),
    );
  }

  if (config.webhook) {
    tasks.push(
      (async () => {
        result.webhook = await sendDigestWebhook(
          digest,
          config.webhook!.url,
          config.webhook!.secret,
        );
      })(),
    );
  }

  await Promise.all(tasks);

  const attempted = [result.email, result.slack, result.webhook].filter(
    (r): r is DeliveryResult => r !== undefined,
  );
  result.success =
    attempted.length > 0 && attempted.every((r) => r.success);

  return result;
}
