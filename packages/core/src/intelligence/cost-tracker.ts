/**
 * Cost Tracking & Budget Caps for LLM Usage
 *
 * Records every LLM call made by the Hipp0 platform (distillery extraction,
 * summarization, embeddings, etc.) along with token counts and a computed
 * USD cost estimate. Provides per-project usage queries and a budget-check
 * function that the distillery and other LLM-calling code can consult
 * *before* making an expensive call.
 *
 * All tracking operations are best-effort — callers should wrap invocations
 * in try/catch so that an instrumentation failure never breaks the
 * underlying feature (extraction, compile, etc.).
 *
 * Core operations:
 *   - recordLLMCall(projectId, { provider, model, input_tokens, output_tokens, operation })
 *   - getProjectUsage(projectId, options?)
 *   - getDailyUsage(projectId, date)
 *   - checkBudget(projectId)
 *   - estimateCostUsd({ provider, model, input_tokens, output_tokens })
 */

import { randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type LLMProvider = 'anthropic' | 'openai' | 'openrouter' | 'local';

export interface RecordLLMCallInput {
  provider: LLMProvider | string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  operation: string;
}

export interface LLMUsageRecord {
  id: string;
  project_id: string;
  provider: LLMProvider;
  model: string;
  operation: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  created_at: string;
}

export interface UsageSummary {
  total_cost_usd: number;
  total_input_tokens: number;
  total_output_tokens: number;
  call_count: number;
  by_operation: Record<string, { cost_usd: number; call_count: number }>;
  by_model: Record<string, { cost_usd: number; call_count: number }>;
}

export interface GetProjectUsageOptions {
  /** Time window to aggregate over. Defaults to 'daily'. */
  window?: 'daily' | 'weekly' | 'monthly' | 'all';
  /** Optional explicit ISO date (YYYY-MM-DD) — only used when window === 'daily'. */
  date?: string;
}

export interface BudgetStatus {
  allowed: boolean;
  reason?: string;
  remaining_usd: number;
  /** The daily cap that's currently in effect, or null if unlimited. */
  cap_usd: number | null;
  /** Spend today in USD (for convenience in UIs). */
  spent_today_usd: number;
  /** Source of the cap: 'project' (project metadata), 'env' (env var), or 'none'. */
  cap_source: 'project' | 'env' | 'none';
}

export interface ProjectBudgetConfig {
  /** Daily cap in USD, or null/undefined for unlimited. */
  daily_usd?: number | null;
  /** Optional per-operation caps. */
  per_operation?: Record<string, number>;
}

/* ------------------------------------------------------------------ */
/*  Pricing table (USD per 1M tokens; mid-2025 approximate rates)     */
/* ------------------------------------------------------------------ */

interface ModelPricing {
  /** USD per 1M input tokens. */
  input: number;
  /** USD per 1M output tokens. */
  output: number;
}

/**
 * Pricing lookup by normalized model name. Keys should be lowercased and
 * stripped of provider prefixes where possible (e.g. `openai/gpt-4o` ->
 * `gpt-4o`). Model matching is fuzzy: the lookup walks through this table
 * and picks the first entry whose key is a substring of the model name.
 */
const MODEL_PRICING: Array<[string, ModelPricing]> = [
  // Anthropic
  ['claude-3-5-sonnet', { input: 3.0, output: 15.0 }],
  ['claude-3.5-sonnet', { input: 3.0, output: 15.0 }],
  ['claude-3-5-haiku', { input: 0.8, output: 4.0 }],
  ['claude-3.5-haiku', { input: 0.8, output: 4.0 }],
  ['claude-3-opus', { input: 15.0, output: 75.0 }],
  ['claude-3-haiku', { input: 0.25, output: 1.25 }],
  ['claude-opus-4', { input: 15.0, output: 75.0 }],
  ['claude-sonnet-4', { input: 3.0, output: 15.0 }],

  // OpenAI
  ['gpt-4o-mini', { input: 0.15, output: 0.6 }],
  ['gpt-4o', { input: 2.5, output: 10.0 }],
  ['gpt-4-turbo', { input: 10.0, output: 30.0 }],
  ['gpt-4', { input: 30.0, output: 60.0 }],
  ['gpt-3.5-turbo', { input: 0.5, output: 1.5 }],

  // Embeddings (flat rate — counted against input_tokens, output is 0)
  ['text-embedding-3-small', { input: 0.02, output: 0.0 }],
  ['text-embedding-3-large', { input: 0.13, output: 0.0 }],
  ['text-embedding-ada-002', { input: 0.1, output: 0.0 }],
];

const VALID_PROVIDERS: LLMProvider[] = ['anthropic', 'openai', 'openrouter', 'local'];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function normalizeProvider(provider: string): LLMProvider {
  const lower = provider.toLowerCase();
  if (VALID_PROVIDERS.includes(lower as LLMProvider)) return lower as LLMProvider;
  if (lower.includes('anthropic') || lower.includes('claude')) return 'anthropic';
  if (lower.includes('openai') || lower.includes('gpt')) return 'openai';
  if (lower.includes('openrouter')) return 'openrouter';
  return 'local';
}

function normalizeModel(model: string): string {
  // Strip provider prefixes like "openai/gpt-4o" or "anthropic/claude-3-5-sonnet-20241022".
  const lower = model.toLowerCase();
  const slashIdx = lower.lastIndexOf('/');
  return slashIdx >= 0 ? lower.slice(slashIdx + 1) : lower;
}

function lookupPricing(model: string): ModelPricing | null {
  const normalized = normalizeModel(model);
  for (const [key, pricing] of MODEL_PRICING) {
    if (normalized.includes(key)) return pricing;
  }
  return null;
}

/**
 * Compute the USD cost for a single LLM call. Returns 0 when the model is
 * unknown — this is intentional so that unknown models don't block tracking
 * or budget checks. Callers that care should also check for a null pricing
 * lookup via `lookupPricing`.
 */
export function estimateCostUsd(input: {
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
}): number {
  const pricing = lookupPricing(input.model);
  if (!pricing) return 0;
  const inCost = (Math.max(0, input.input_tokens) / 1_000_000) * pricing.input;
  const outCost = (Math.max(0, input.output_tokens) / 1_000_000) * pricing.output;
  return inCost + outCost;
}

function toFloat(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function toInt(value: unknown): number {
  if (typeof value === 'number') return Math.floor(value);
  if (typeof value === 'string') {
    const n = parseInt(value, 10);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function rowToUsageRecord(row: Record<string, unknown>): LLMUsageRecord {
  return {
    id: String(row.id),
    project_id: String(row.project_id),
    provider: String(row.provider) as LLMProvider,
    model: String(row.model ?? ''),
    operation: String(row.operation ?? ''),
    input_tokens: toInt(row.input_tokens),
    output_tokens: toInt(row.output_tokens),
    cost_usd: toFloat(row.cost_usd),
    created_at: String(row.created_at ?? ''),
  };
}

function windowStartSql(window: 'daily' | 'weekly' | 'monthly' | 'all'): string {
  const db = getDb();
  if (window === 'all') return '';
  if (db.dialect === 'sqlite') {
    if (window === 'daily') return "datetime('now', '-1 day')";
    if (window === 'weekly') return "datetime('now', '-7 days')";
    return "datetime('now', '-30 days')";
  }
  // postgres
  if (window === 'daily') return "NOW() - INTERVAL '1 day'";
  if (window === 'weekly') return "NOW() - INTERVAL '7 days'";
  return "NOW() - INTERVAL '30 days'";
}

/* ------------------------------------------------------------------ */
/*  Record                                                             */
/* ------------------------------------------------------------------ */

/**
 * Record a single LLM call. All fields are best-effort: negative token
 * counts are coerced to 0, unknown models result in a cost of 0, and any
 * database error is caught and logged rather than thrown. This function
 * never throws — callers can invoke it without wrapping in try/catch.
 */
export async function recordLLMCall(
  projectId: string,
  input: RecordLLMCallInput,
): Promise<LLMUsageRecord | null> {
  try {
    if (!projectId || typeof projectId !== 'string') {
      console.warn('[hipp0:cost-tracker] recordLLMCall: missing projectId, skipping');
      return null;
    }

    const provider = normalizeProvider(input.provider);
    const model = String(input.model || 'unknown');
    const operation = String(input.operation || 'unknown');
    const inputTokens = Math.max(0, toInt(input.input_tokens));
    const outputTokens = Math.max(0, toInt(input.output_tokens));

    const costUsd = estimateCostUsd({
      provider,
      model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
    });

    const id = randomUUID();
    const db = getDb();
    await db.query(
      `INSERT INTO llm_usage
         (id, project_id, provider, model, operation, input_tokens, output_tokens, cost_usd)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, projectId, provider, model, operation, inputTokens, outputTokens, costUsd],
    );

    console.warn(
      `[hipp0:cost] ${provider}/${model} ${operation}: ${inputTokens}in + ${outputTokens}out = $${costUsd.toFixed(6)} (project=${projectId})`,
    );

    return {
      id,
      project_id: projectId,
      provider,
      model,
      operation,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost_usd: costUsd,
      created_at: new Date().toISOString(),
    };
  } catch (err) {
    console.error('[hipp0:cost-tracker] recordLLMCall failed:', (err as Error).message);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Query                                                              */
/* ------------------------------------------------------------------ */

async function aggregateUsage(
  projectId: string,
  windowClause: string,
  windowStart?: string,
): Promise<UsageSummary> {
  const db = getDb();
  const params: unknown[] = [projectId];
  let sql = `SELECT provider, model, operation, input_tokens, output_tokens, cost_usd
             FROM llm_usage
             WHERE project_id = ?`;
  if (windowClause && windowStart) {
    sql += ` AND created_at >= ${windowStart}`;
  }

  const result = await db.query<Record<string, unknown>>(sql, params);

  const summary: UsageSummary = {
    total_cost_usd: 0,
    total_input_tokens: 0,
    total_output_tokens: 0,
    call_count: 0,
    by_operation: {},
    by_model: {},
  };

  for (const raw of result.rows) {
    const row = rowToUsageRecord(raw);
    summary.total_cost_usd += row.cost_usd;
    summary.total_input_tokens += row.input_tokens;
    summary.total_output_tokens += row.output_tokens;
    summary.call_count += 1;

    const op = summary.by_operation[row.operation] ?? { cost_usd: 0, call_count: 0 };
    op.cost_usd += row.cost_usd;
    op.call_count += 1;
    summary.by_operation[row.operation] = op;

    const m = summary.by_model[row.model] ?? { cost_usd: 0, call_count: 0 };
    m.cost_usd += row.cost_usd;
    m.call_count += 1;
    summary.by_model[row.model] = m;
  }

  // Round to 6 decimals to keep the JSON clean.
  summary.total_cost_usd = Math.round(summary.total_cost_usd * 1e6) / 1e6;
  return summary;
}

export async function getProjectUsage(
  projectId: string,
  options: GetProjectUsageOptions = {},
): Promise<UsageSummary> {
  const window = options.window ?? 'daily';
  if (window === 'daily' && options.date) {
    return getDailyUsage(projectId, options.date);
  }
  const windowStart = windowStartSql(window);
  return aggregateUsage(projectId, window, windowStart);
}

/**
 * Usage for a specific calendar day (YYYY-MM-DD), project's local timezone
 * being the database server timezone. For most deployments this will be UTC.
 */
export async function getDailyUsage(
  projectId: string,
  date: string,
): Promise<UsageSummary> {
  const db = getDb();
  const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? date
    : new Date().toISOString().slice(0, 10);

  let sql: string;
  if (db.dialect === 'sqlite') {
    sql = `SELECT provider, model, operation, input_tokens, output_tokens, cost_usd
           FROM llm_usage
           WHERE project_id = ? AND date(created_at) = date(?)`;
  } else {
    sql = `SELECT provider, model, operation, input_tokens, output_tokens, cost_usd
           FROM llm_usage
           WHERE project_id = ? AND date_trunc('day', created_at) = date_trunc('day', ?::timestamptz)`;
  }

  const result = await db.query<Record<string, unknown>>(sql, [projectId, safeDate]);

  const summary: UsageSummary = {
    total_cost_usd: 0,
    total_input_tokens: 0,
    total_output_tokens: 0,
    call_count: 0,
    by_operation: {},
    by_model: {},
  };
  for (const raw of result.rows) {
    const row = rowToUsageRecord(raw);
    summary.total_cost_usd += row.cost_usd;
    summary.total_input_tokens += row.input_tokens;
    summary.total_output_tokens += row.output_tokens;
    summary.call_count += 1;
    const op = summary.by_operation[row.operation] ?? { cost_usd: 0, call_count: 0 };
    op.cost_usd += row.cost_usd;
    op.call_count += 1;
    summary.by_operation[row.operation] = op;
    const m = summary.by_model[row.model] ?? { cost_usd: 0, call_count: 0 };
    m.cost_usd += row.cost_usd;
    m.call_count += 1;
    summary.by_model[row.model] = m;
  }
  summary.total_cost_usd = Math.round(summary.total_cost_usd * 1e6) / 1e6;
  return summary;
}

/**
 * Time-series usage for charts. Returns per-day cost + token counts for
 * the last `days` calendar days, most-recent first. Days with no usage
 * are returned with zero values so clients don't have to gap-fill.
 */
export async function getUsageHistory(
  projectId: string,
  days = 30,
): Promise<Array<{ date: string; cost_usd: number; call_count: number; input_tokens: number; output_tokens: number }>> {
  const safeDays = Math.max(1, Math.min(365, Math.floor(days)));
  const db = getDb();

  let sql: string;
  if (db.dialect === 'sqlite') {
    sql = `SELECT date(created_at) as day,
                  SUM(cost_usd) as cost_usd,
                  COUNT(*) as call_count,
                  SUM(input_tokens) as input_tokens,
                  SUM(output_tokens) as output_tokens
           FROM llm_usage
           WHERE project_id = ? AND created_at >= datetime('now', '-' || ? || ' days')
           GROUP BY date(created_at)
           ORDER BY day DESC`;
  } else {
    sql = `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as day,
                  SUM(cost_usd) as cost_usd,
                  COUNT(*) as call_count,
                  SUM(input_tokens) as input_tokens,
                  SUM(output_tokens) as output_tokens
           FROM llm_usage
           WHERE project_id = ? AND created_at >= NOW() - (? || ' days')::interval
           GROUP BY date_trunc('day', created_at)
           ORDER BY day DESC`;
  }

  const result = await db.query<Record<string, unknown>>(sql, [projectId, safeDays]);
  const byDay = new Map<string, { cost_usd: number; call_count: number; input_tokens: number; output_tokens: number }>();
  for (const row of result.rows) {
    byDay.set(String(row.day), {
      cost_usd: Math.round(toFloat(row.cost_usd) * 1e6) / 1e6,
      call_count: toInt(row.call_count),
      input_tokens: toInt(row.input_tokens),
      output_tokens: toInt(row.output_tokens),
    });
  }

  // Gap-fill the requested range so charts have a point per day.
  const series: Array<{ date: string; cost_usd: number; call_count: number; input_tokens: number; output_tokens: number }> = [];
  for (let i = 0; i < safeDays; i++) {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    const entry = byDay.get(key) ?? {
      cost_usd: 0,
      call_count: 0,
      input_tokens: 0,
      output_tokens: 0,
    };
    series.push({ date: key, ...entry });
  }
  return series;
}

/* ------------------------------------------------------------------ */
/*  Budget                                                             */
/* ------------------------------------------------------------------ */

function parseProjectBudgetConfig(metadataRaw: unknown): ProjectBudgetConfig | null {
  let meta: Record<string, unknown> | null = null;
  if (!metadataRaw) return null;
  if (typeof metadataRaw === 'string') {
    try {
      meta = JSON.parse(metadataRaw) as Record<string, unknown>;
    } catch {
      return null;
    }
  } else if (typeof metadataRaw === 'object') {
    meta = metadataRaw as Record<string, unknown>;
  }
  if (!meta || typeof meta !== 'object') return null;
  const budget = meta.budget_config;
  if (!budget || typeof budget !== 'object') return null;
  const b = budget as Record<string, unknown>;
  const daily = b.daily_usd;
  const dailyUsd =
    typeof daily === 'number' && Number.isFinite(daily)
      ? daily
      : typeof daily === 'string' && daily.length > 0 && Number.isFinite(parseFloat(daily))
        ? parseFloat(daily)
        : null;
  const perOp: Record<string, number> = {};
  const rawPerOp = b.per_operation;
  if (rawPerOp && typeof rawPerOp === 'object') {
    for (const [k, v] of Object.entries(rawPerOp as Record<string, unknown>)) {
      const n = typeof v === 'number' ? v : parseFloat(String(v));
      if (Number.isFinite(n)) perOp[k] = n;
    }
  }
  return { daily_usd: dailyUsd, per_operation: perOp };
}

async function loadProjectBudget(projectId: string): Promise<ProjectBudgetConfig | null> {
  try {
    const db = getDb();
    const result = await db.query<Record<string, unknown>>(
      `SELECT metadata FROM projects WHERE id = ?`,
      [projectId],
    );
    if (result.rows.length === 0) return null;
    return parseProjectBudgetConfig(result.rows[0].metadata);
  } catch (err) {
    console.warn('[hipp0:cost-tracker] loadProjectBudget failed:', (err as Error).message);
    return null;
  }
}

/**
 * Check whether the given project is allowed to make another LLM call
 * based on its daily spend so far. Returns `allowed: true` (with
 * `cap_usd: null`) when no cap is configured. Never throws — on error,
 * fails open (`allowed: true`) so that tracking outages don't take the
 * distillery down.
 */
export async function checkBudget(projectId: string): Promise<BudgetStatus> {
  try {
    // Load project-specific cap first (takes precedence).
    const projectBudget = await loadProjectBudget(projectId);
    let capUsd: number | null = null;
    let capSource: 'project' | 'env' | 'none' = 'none';
    if (projectBudget && typeof projectBudget.daily_usd === 'number' && projectBudget.daily_usd >= 0) {
      capUsd = projectBudget.daily_usd;
      capSource = 'project';
    } else {
      const envCap = process.env.HIPP0_DAILY_BUDGET_USD;
      if (envCap && envCap.trim().length > 0) {
        const parsed = parseFloat(envCap);
        if (Number.isFinite(parsed) && parsed >= 0) {
          capUsd = parsed;
          capSource = 'env';
        }
      }
    }

    if (capUsd === null) {
      return {
        allowed: true,
        remaining_usd: Infinity,
        cap_usd: null,
        spent_today_usd: 0,
        cap_source: 'none',
      };
    }

    const today = new Date().toISOString().slice(0, 10);
    const dailyUsage = await getDailyUsage(projectId, today);
    const spent = dailyUsage.total_cost_usd;
    const remaining = Math.max(0, capUsd - spent);
    const allowed = spent < capUsd;
    return {
      allowed,
      reason: allowed
        ? undefined
        : `Daily budget of $${capUsd.toFixed(2)} reached ($${spent.toFixed(4)} spent today)`,
      remaining_usd: Math.round(remaining * 1e6) / 1e6,
      cap_usd: capUsd,
      spent_today_usd: Math.round(spent * 1e6) / 1e6,
      cap_source: capSource,
    };
  } catch (err) {
    console.error('[hipp0:cost-tracker] checkBudget failed, failing open:', (err as Error).message);
    return {
      allowed: true,
      remaining_usd: Infinity,
      cap_usd: null,
      spent_today_usd: 0,
      cap_source: 'none',
    };
  }
}

/**
 * Update (or clear) a project's budget_config in its metadata column.
 * Pass `null` to clear the project-specific cap.
 */
export async function setProjectBudget(
  projectId: string,
  config: ProjectBudgetConfig | null,
): Promise<ProjectBudgetConfig | null> {
  const db = getDb();
  const result = await db.query<Record<string, unknown>>(
    `SELECT metadata FROM projects WHERE id = ?`,
    [projectId],
  );
  if (result.rows.length === 0) {
    throw new Error(`Project ${projectId} not found`);
  }

  const raw = result.rows[0].metadata;
  let meta: Record<string, unknown> = {};
  if (typeof raw === 'string') {
    try {
      meta = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      meta = {};
    }
  } else if (raw && typeof raw === 'object') {
    meta = { ...(raw as Record<string, unknown>) };
  }

  if (config === null) {
    delete meta.budget_config;
  } else {
    meta.budget_config = {
      ...(config.daily_usd !== undefined ? { daily_usd: config.daily_usd } : {}),
      ...(config.per_operation ? { per_operation: config.per_operation } : {}),
    };
  }

  const nextMeta = db.dialect === 'sqlite' ? JSON.stringify(meta) : meta;
  // Postgres JSONB expects the object passed through with the proper cast.
  if (db.dialect === 'postgres') {
    await db.query(`UPDATE projects SET metadata = ?::jsonb WHERE id = ?`, [
      JSON.stringify(meta),
      projectId,
    ]);
  } else {
    await db.query(`UPDATE projects SET metadata = ? WHERE id = ?`, [nextMeta, projectId]);
  }

  return config;
}
