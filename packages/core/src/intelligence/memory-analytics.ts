/**
 * Memory Analytics & Weekly Digest
 *
 * Pure-SQL reporting layer that computes team-memory health metrics,
 * generates weekly digest snapshots, and exposes time-series data for
 * dashboards. No LLM calls are made here — all outputs are derived
 * from aggregate queries against the existing tables (decisions,
 * decision_outcomes, contradictions, agents, compile_history, …).
 *
 * Every sub-query is wrapped in a try/catch so an empty project (or
 * a missing optional table) degrades gracefully to zero-valued
 * placeholders instead of raising.
 */

import { randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface TopAgent {
  name: string;
  success_rate: number;
}

export interface WeakestDomain {
  domain: string;
  success_rate: number;
}

export interface TeamHealth {
  total_decisions: number;
  active_decisions: number;
  decisions_this_week: number;
  contradictions_unresolved: number;
  avg_success_rate: number;
  agent_count: number;
  top_performing_agent: TopAgent;
  weakest_domain: WeakestDomain;
  decision_velocity: number; // decisions per week trend (current − previous)
  memory_growth_rate: number; // % growth week-over-week
}

export interface SkillChange {
  agent: string;
  domain: string;
  delta: number;
}

export interface TopDecisionRef {
  id: string;
  title: string;
  compile_count: number;
  success_rate: number;
}

export interface EmergingPattern {
  pattern: string;
  evidence_count: number;
}

export interface WeeklyDigest {
  period: { start: string; end: string };
  highlights: {
    decisions_made: number;
    contradictions_found: number;
    contradictions_resolved: number;
    outcomes_recorded: number;
    skill_changes: SkillChange[];
  };
  top_decisions: TopDecisionRef[];
  emerging_patterns: EmergingPattern[];
  alerts: string[];
  recommendations: string[];
}

export interface DailyCount {
  date: string;
  count: number;
}

export interface DailyOutcomeCount {
  date: string;
  success: number;
  failure: number;
  partial: number;
}

export interface DailyContradictionCount {
  date: string;
  detected: number;
  resolved: number;
}

export interface MemoryTrends {
  decisions_per_day: DailyCount[];
  outcomes_per_day: DailyOutcomeCount[];
  contradictions_per_day: DailyContradictionCount[];
  active_agents_per_day: DailyCount[];
}

export interface ComputeTeamHealthOptions {
  /** Optional window end (defaults to now). */
  asOf?: Date;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toInt(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return Number.isFinite(n) ? n : 0;
}

function toFloat(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Convert a JS Date to a timestamp literal that compares correctly against
 * both SQLite and PostgreSQL `created_at` columns.
 *
 * SQLite `datetime('now')` stores as `'YYYY-MM-DD HH:MM:SS'` (space
 * separator), so an ISO-8601 string with a `T` separator does NOT compare
 * correctly against stored rows — ` ` < `T` lexically, which breaks
 * same-day range queries. We emit the space-separator form;
 * Postgres TIMESTAMPTZ accepts it as a valid timestamp literal.
 */
function toSqlTimestamp(d: Date): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const Y = d.getUTCFullYear();
  const M = pad(d.getUTCMonth() + 1);
  const D = pad(d.getUTCDate());
  const h = pad(d.getUTCHours());
  const m = pad(d.getUTCMinutes());
  const s = pad(d.getUTCSeconds());
  return `${Y}-${M}-${D} ${h}:${m}:${s}`;
}

/**
 * Build a contiguous array of YYYY-MM-DD buckets over the last `days`
 * days, inclusive of today. Used to fill gaps so dashboards never see
 * missing dates.
 */
function buildDateBuckets(days: number, end: Date = new Date()): string[] {
  const out: string[] = [];
  const MS_DAY = 24 * 60 * 60 * 1000;
  const endDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  for (let i = days - 1; i >= 0; i--) {
    out.push(isoDate(new Date(endDay.getTime() - i * MS_DAY)));
  }
  return out;
}

function normalizeDateKey(raw: unknown): string {
  if (!raw) return '';
  const s = String(raw);
  // Handles both "YYYY-MM-DD" (SQLite DATE) and "YYYY-MM-DDTHH:MM:SS…" (PG).
  return s.slice(0, 10);
}

// ---------------------------------------------------------------------------
// computeTeamHealth
// ---------------------------------------------------------------------------

export async function computeTeamHealth(
  projectId: string,
  options: ComputeTeamHealthOptions = {},
): Promise<TeamHealth> {
  const db = getDb();
  const asOf = options.asOf ?? new Date();
  const weekAgo = toSqlTimestamp(new Date(asOf.getTime() - 7 * 24 * 60 * 60 * 1000));
  const twoWeeksAgo = toSqlTimestamp(new Date(asOf.getTime() - 14 * 24 * 60 * 60 * 1000));

  const empty: TeamHealth = {
    total_decisions: 0,
    active_decisions: 0,
    decisions_this_week: 0,
    contradictions_unresolved: 0,
    avg_success_rate: 0,
    agent_count: 0,
    top_performing_agent: { name: '', success_rate: 0 },
    weakest_domain: { domain: '', success_rate: 0 },
    decision_velocity: 0,
    memory_growth_rate: 0,
  };

  // Decision counts
  let totalDecisions = 0;
  let activeDecisions = 0;
  try {
    const r = await db.query<Record<string, unknown>>(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active
       FROM decisions
       WHERE project_id = ?`,
      [projectId],
    );
    const row = r.rows[0] ?? {};
    totalDecisions = toInt(row.total);
    activeDecisions = toInt(row.active);
  } catch {
    /* table may be empty or unavailable */
  }

  // Decisions this week + previous week (for velocity + growth rate)
  let decisionsThisWeek = 0;
  let decisionsPrevWeek = 0;
  try {
    const r = await db.query<Record<string, unknown>>(
      `SELECT
         SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS this_week,
         SUM(CASE WHEN created_at >= ? AND created_at < ? THEN 1 ELSE 0 END) AS prev_week
       FROM decisions
       WHERE project_id = ?`,
      [weekAgo, twoWeeksAgo, weekAgo, projectId],
    );
    const row = r.rows[0] ?? {};
    decisionsThisWeek = toInt(row.this_week);
    decisionsPrevWeek = toInt(row.prev_week);
  } catch {
    /* ignore */
  }

  // Unresolved contradictions
  let contradictionsUnresolved = 0;
  try {
    const r = await db.query<Record<string, unknown>>(
      `SELECT COUNT(*) AS count
       FROM contradictions
       WHERE project_id = ? AND status = 'unresolved'`,
      [projectId],
    );
    contradictionsUnresolved = toInt(r.rows[0]?.count);
  } catch {
    /* ignore */
  }

  // Overall average success rate across all outcomes for this project
  let avgSuccessRate = 0;
  try {
    const r = await db.query<Record<string, unknown>>(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN outcome_type = 'success' THEN 1 ELSE 0 END) AS successes,
         SUM(CASE WHEN outcome_type = 'partial' THEN 1 ELSE 0 END) AS partials
       FROM decision_outcomes
       WHERE project_id = ?`,
      [projectId],
    );
    const row = r.rows[0] ?? {};
    const total = toInt(row.total);
    const successes = toInt(row.successes);
    const partials = toInt(row.partials);
    avgSuccessRate = total > 0 ? (successes + partials * 0.5) / total : 0;
  } catch {
    /* ignore */
  }

  // Agent count
  let agentCount = 0;
  try {
    const r = await db.query<Record<string, unknown>>(
      `SELECT COUNT(*) AS count FROM agents WHERE project_id = ?`,
      [projectId],
    );
    agentCount = toInt(r.rows[0]?.count);
  } catch {
    /* ignore */
  }

  // Top performing agent (by success rate, min 3 outcomes)
  let topAgent: TopAgent = { name: '', success_rate: 0 };
  try {
    const r = await db.query<Record<string, unknown>>(
      `SELECT
         d.made_by AS agent,
         COUNT(do2.id) AS total,
         SUM(CASE WHEN do2.outcome_type = 'success' THEN 1 ELSE 0 END) AS successes,
         SUM(CASE WHEN do2.outcome_type = 'partial' THEN 1 ELSE 0 END) AS partials
       FROM decisions d
       JOIN decision_outcomes do2 ON do2.decision_id = d.id
       WHERE d.project_id = ? AND d.made_by IS NOT NULL
       GROUP BY d.made_by
       HAVING COUNT(do2.id) >= 3
       ORDER BY (
         (SUM(CASE WHEN do2.outcome_type = 'success' THEN 1 ELSE 0 END) * 1.0
          + SUM(CASE WHEN do2.outcome_type = 'partial' THEN 1 ELSE 0 END) * 0.5)
         / COUNT(do2.id)
       ) DESC
       LIMIT 1`,
      [projectId],
    );
    const row = r.rows[0];
    if (row) {
      const total = toInt(row.total);
      const successes = toInt(row.successes);
      const partials = toInt(row.partials);
      const rate = total > 0 ? (successes + partials * 0.5) / total : 0;
      topAgent = {
        name: String(row.agent ?? ''),
        success_rate: round4(rate),
      };
    }
  } catch {
    /* ignore */
  }

  // Weakest domain (min 3 outcomes)
  let weakestDomain: WeakestDomain = { domain: '', success_rate: 0 };
  try {
    const r = await db.query<Record<string, unknown>>(
      `SELECT
         d.domain AS domain,
         COUNT(do2.id) AS total,
         SUM(CASE WHEN do2.outcome_type = 'success' THEN 1 ELSE 0 END) AS successes,
         SUM(CASE WHEN do2.outcome_type = 'partial' THEN 1 ELSE 0 END) AS partials
       FROM decisions d
       JOIN decision_outcomes do2 ON do2.decision_id = d.id
       WHERE d.project_id = ? AND d.domain IS NOT NULL
       GROUP BY d.domain
       HAVING COUNT(do2.id) >= 3
       ORDER BY (
         (SUM(CASE WHEN do2.outcome_type = 'success' THEN 1 ELSE 0 END) * 1.0
          + SUM(CASE WHEN do2.outcome_type = 'partial' THEN 1 ELSE 0 END) * 0.5)
         / COUNT(do2.id)
       ) ASC
       LIMIT 1`,
      [projectId],
    );
    const row = r.rows[0];
    if (row) {
      const total = toInt(row.total);
      const successes = toInt(row.successes);
      const partials = toInt(row.partials);
      const rate = total > 0 ? (successes + partials * 0.5) / total : 0;
      weakestDomain = {
        domain: String(row.domain ?? ''),
        success_rate: round4(rate),
      };
    }
  } catch {
    /* ignore */
  }

  // Decision velocity: delta between current week and previous week
  const decisionVelocity = decisionsThisWeek - decisionsPrevWeek;

  // Memory growth rate: week-over-week % growth of active decisions
  let memoryGrowthRate = 0;
  if (decisionsPrevWeek > 0) {
    memoryGrowthRate = ((decisionsThisWeek - decisionsPrevWeek) / decisionsPrevWeek) * 100;
  } else if (decisionsThisWeek > 0) {
    memoryGrowthRate = 100;
  }

  return {
    ...empty,
    total_decisions: totalDecisions,
    active_decisions: activeDecisions,
    decisions_this_week: decisionsThisWeek,
    contradictions_unresolved: contradictionsUnresolved,
    avg_success_rate: round4(avgSuccessRate),
    agent_count: agentCount,
    top_performing_agent: topAgent,
    weakest_domain: weakestDomain,
    decision_velocity: decisionVelocity,
    memory_growth_rate: round2(memoryGrowthRate),
  };
}

// ---------------------------------------------------------------------------
// getMemoryTrends
// ---------------------------------------------------------------------------

export async function getMemoryTrends(
  projectId: string,
  days = 30,
): Promise<MemoryTrends> {
  const db = getDb();
  const windowDays = Math.max(1, Math.min(365, Math.floor(days)));
  const sinceIso = toSqlTimestamp(
    new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000),
  );
  const buckets = buildDateBuckets(windowDays);

  // Decisions per day
  const decisionMap = new Map<string, number>();
  try {
    const r = await db.query<Record<string, unknown>>(
      `SELECT DATE(created_at) AS d, COUNT(*) AS c
       FROM decisions
       WHERE project_id = ? AND created_at >= ?
       GROUP BY DATE(created_at)`,
      [projectId, sinceIso],
    );
    for (const row of r.rows) {
      decisionMap.set(normalizeDateKey(row.d), toInt(row.c));
    }
  } catch {
    /* ignore */
  }

  // Outcomes per day, split by type
  const outcomeMap = new Map<string, DailyOutcomeCount>();
  try {
    const r = await db.query<Record<string, unknown>>(
      `SELECT
         DATE(created_at) AS d,
         SUM(CASE WHEN outcome_type = 'success' THEN 1 ELSE 0 END) AS success,
         SUM(CASE WHEN outcome_type IN ('failure', 'regression') THEN 1 ELSE 0 END) AS failure,
         SUM(CASE WHEN outcome_type = 'partial' THEN 1 ELSE 0 END) AS partial
       FROM decision_outcomes
       WHERE project_id = ? AND created_at >= ?
       GROUP BY DATE(created_at)`,
      [projectId, sinceIso],
    );
    for (const row of r.rows) {
      const key = normalizeDateKey(row.d);
      outcomeMap.set(key, {
        date: key,
        success: toInt(row.success),
        failure: toInt(row.failure),
        partial: toInt(row.partial),
      });
    }
  } catch {
    /* ignore */
  }

  // Contradictions: detected per day and resolved per day
  const detectedMap = new Map<string, number>();
  const resolvedMap = new Map<string, number>();
  try {
    const r = await db.query<Record<string, unknown>>(
      `SELECT DATE(detected_at) AS d, COUNT(*) AS c
       FROM contradictions
       WHERE project_id = ? AND detected_at >= ?
       GROUP BY DATE(detected_at)`,
      [projectId, sinceIso],
    );
    for (const row of r.rows) {
      detectedMap.set(normalizeDateKey(row.d), toInt(row.c));
    }
  } catch {
    /* ignore */
  }
  try {
    const r = await db.query<Record<string, unknown>>(
      `SELECT DATE(resolved_at) AS d, COUNT(*) AS c
       FROM contradictions
       WHERE project_id = ? AND resolved_at IS NOT NULL AND resolved_at >= ?
       GROUP BY DATE(resolved_at)`,
      [projectId, sinceIso],
    );
    for (const row of r.rows) {
      resolvedMap.set(normalizeDateKey(row.d), toInt(row.c));
    }
  } catch {
    /* ignore */
  }

  // Active agents per day — distinct agent authors of compile_history per day,
  // falling back to distinct decision made_by if compile_history is empty.
  const activeAgentsMap = new Map<string, number>();
  try {
    const r = await db.query<Record<string, unknown>>(
      `SELECT DATE(compiled_at) AS d, COUNT(DISTINCT agent_name) AS c
       FROM compile_history
       WHERE project_id = ? AND compiled_at >= ?
       GROUP BY DATE(compiled_at)`,
      [projectId, sinceIso],
    );
    for (const row of r.rows) {
      activeAgentsMap.set(normalizeDateKey(row.d), toInt(row.c));
    }
  } catch {
    /* ignore */
  }
  if (activeAgentsMap.size === 0) {
    try {
      const r = await db.query<Record<string, unknown>>(
        `SELECT DATE(created_at) AS d, COUNT(DISTINCT made_by) AS c
         FROM decisions
         WHERE project_id = ? AND created_at >= ? AND made_by IS NOT NULL
         GROUP BY DATE(created_at)`,
        [projectId, sinceIso],
      );
      for (const row of r.rows) {
        activeAgentsMap.set(normalizeDateKey(row.d), toInt(row.c));
      }
    } catch {
      /* ignore */
    }
  }

  return {
    decisions_per_day: buckets.map((date) => ({
      date,
      count: decisionMap.get(date) ?? 0,
    })),
    outcomes_per_day: buckets.map(
      (date) =>
        outcomeMap.get(date) ?? { date, success: 0, failure: 0, partial: 0 },
    ),
    contradictions_per_day: buckets.map((date) => ({
      date,
      detected: detectedMap.get(date) ?? 0,
      resolved: resolvedMap.get(date) ?? 0,
    })),
    active_agents_per_day: buckets.map((date) => ({
      date,
      count: activeAgentsMap.get(date) ?? 0,
    })),
  };
}

// ---------------------------------------------------------------------------
// generateWeeklyDigest
// ---------------------------------------------------------------------------

export async function generateWeeklyDigest(projectId: string): Promise<WeeklyDigest> {
  const db = getDb();
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  // ISO strings for the JSON payload (and for persistence columns);
  // SQL-safe strings for comparisons against `created_at`-style columns
  // which in SQLite use the `'YYYY-MM-DD HH:MM:SS'` format.
  const periodStart = weekAgo.toISOString();
  const periodEnd = now.toISOString();
  const sqlStart = toSqlTimestamp(weekAgo);
  const sqlEnd = toSqlTimestamp(now);
  const sqlStartPrev = toSqlTimestamp(twoWeeksAgo);

  // --- Highlights: decisions_made --------------------------------------------
  let decisionsMade = 0;
  try {
    const r = await db.query<Record<string, unknown>>(
      `SELECT COUNT(*) AS c FROM decisions
       WHERE project_id = ? AND created_at >= ? AND created_at < ?`,
      [projectId, sqlStart, sqlEnd],
    );
    decisionsMade = toInt(r.rows[0]?.c);
  } catch {
    /* ignore */
  }

  // --- Highlights: contradictions_found + resolved ---------------------------
  let contradictionsFound = 0;
  let contradictionsResolved = 0;
  try {
    const r = await db.query<Record<string, unknown>>(
      `SELECT COUNT(*) AS c FROM contradictions
       WHERE project_id = ? AND detected_at >= ? AND detected_at < ?`,
      [projectId, sqlStart, sqlEnd],
    );
    contradictionsFound = toInt(r.rows[0]?.c);
  } catch {
    /* ignore */
  }
  try {
    const r = await db.query<Record<string, unknown>>(
      `SELECT COUNT(*) AS c FROM contradictions
       WHERE project_id = ? AND resolved_at IS NOT NULL
         AND resolved_at >= ? AND resolved_at < ?`,
      [projectId, sqlStart, sqlEnd],
    );
    contradictionsResolved = toInt(r.rows[0]?.c);
  } catch {
    /* ignore */
  }

  // --- Highlights: outcomes_recorded -----------------------------------------
  let outcomesRecorded = 0;
  try {
    const r = await db.query<Record<string, unknown>>(
      `SELECT COUNT(*) AS c FROM decision_outcomes
       WHERE project_id = ? AND created_at >= ? AND created_at < ?`,
      [projectId, sqlStart, sqlEnd],
    );
    outcomesRecorded = toInt(r.rows[0]?.c);
  } catch {
    /* ignore */
  }

  // --- Highlights: skill_changes (per agent+domain week-over-week delta) -----
  const skillChanges: SkillChange[] = [];
  try {
    const r = await db.query<Record<string, unknown>>(
      `SELECT
         d.made_by AS agent,
         d.domain AS domain,
         SUM(CASE
               WHEN do2.created_at >= ? AND do2.created_at < ? THEN
                 (CASE WHEN do2.outcome_type = 'success' THEN 1.0
                       WHEN do2.outcome_type = 'partial' THEN 0.5
                       ELSE 0.0 END)
               ELSE 0.0
             END) AS cur_score,
         SUM(CASE
               WHEN do2.created_at >= ? AND do2.created_at < ? THEN 1 ELSE 0
             END) AS cur_total,
         SUM(CASE
               WHEN do2.created_at >= ? AND do2.created_at < ? THEN
                 (CASE WHEN do2.outcome_type = 'success' THEN 1.0
                       WHEN do2.outcome_type = 'partial' THEN 0.5
                       ELSE 0.0 END)
               ELSE 0.0
             END) AS prev_score,
         SUM(CASE
               WHEN do2.created_at >= ? AND do2.created_at < ? THEN 1 ELSE 0
             END) AS prev_total
       FROM decisions d
       JOIN decision_outcomes do2 ON do2.decision_id = d.id
       WHERE d.project_id = ?
         AND d.made_by IS NOT NULL
         AND d.domain IS NOT NULL
         AND do2.created_at >= ?
       GROUP BY d.made_by, d.domain`,
      [
        sqlStart, sqlEnd,       // cur_score
        sqlStart, sqlEnd,       // cur_total
        sqlStartPrev, sqlStart, // prev_score
        sqlStartPrev, sqlStart, // prev_total
        projectId,
        sqlStartPrev,           // outer window
      ],
    );
    for (const row of r.rows) {
      const curTotal = toInt(row.cur_total);
      const prevTotal = toInt(row.prev_total);
      if (curTotal === 0 && prevTotal === 0) continue;
      const curRate = curTotal > 0 ? toFloat(row.cur_score) / curTotal : 0;
      const prevRate = prevTotal > 0 ? toFloat(row.prev_score) / prevTotal : 0;
      const delta = curRate - prevRate;
      if (Math.abs(delta) < 0.01) continue;
      skillChanges.push({
        agent: String(row.agent ?? ''),
        domain: String(row.domain ?? ''),
        delta: round4(delta),
      });
    }
    skillChanges.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  } catch {
    /* ignore */
  }

  // --- Top decisions (by compile count + success rate) -----------------------
  const topDecisions: TopDecisionRef[] = [];
  try {
    // Success rate sourced from decision_outcome_stats (Phase 14, migration
    // 062/sqlite-040) — the legacy decisions.outcome_success_rate column is
    // being removed via migration 060. LEFT JOIN so decisions with no
    // recorded outcomes still appear, defaulted to 0.
    const r = await db.query<Record<string, unknown>>(
      `SELECT
         d.id AS id,
         d.title AS title,
         (SELECT COUNT(*) FROM compile_history ch
           WHERE ch.project_id = d.project_id
             AND ch.decision_ids LIKE '%' || d.id || '%') AS compile_count,
         COALESCE(v.success_rate, 0) AS success_rate
       FROM decisions d
       LEFT JOIN decision_outcome_stats v
         ON v.decision_id = d.id AND v.project_id = d.project_id
       WHERE d.project_id = ? AND d.status = 'active'
       ORDER BY compile_count DESC, success_rate DESC
       LIMIT 5`,
      [projectId],
    );
    for (const row of r.rows) {
      topDecisions.push({
        id: String(row.id ?? ''),
        title: String(row.title ?? ''),
        compile_count: toInt(row.compile_count),
        success_rate: round4(toFloat(row.success_rate)),
      });
    }
  } catch {
    /* ignore */
  }

  // --- Emerging patterns (most-used tags among decisions made this week) ----
  const emergingPatterns: EmergingPattern[] = [];
  try {
    const r = await db.query<Record<string, unknown>>(
      `SELECT domain, COUNT(*) AS c
       FROM decisions
       WHERE project_id = ?
         AND created_at >= ? AND created_at < ?
         AND domain IS NOT NULL
       GROUP BY domain
       ORDER BY c DESC
       LIMIT 5`,
      [projectId, sqlStart, sqlEnd],
    );
    for (const row of r.rows) {
      const count = toInt(row.c);
      if (count < 2) continue;
      emergingPatterns.push({
        pattern: String(row.domain ?? ''),
        evidence_count: count,
      });
    }
  } catch {
    /* ignore */
  }

  // --- Alerts ---------------------------------------------------------------
  const alerts: string[] = [];
  for (const change of skillChanges) {
    if (change.delta <= -0.15) {
      alerts.push(
        `${change.agent} skill in ${change.domain} dropped ${Math.round(
          Math.abs(change.delta) * 100,
        )}%`,
      );
    }
  }
  try {
    const r = await db.query<Record<string, unknown>>(
      `SELECT COUNT(*) AS c FROM contradictions
       WHERE project_id = ? AND status = 'unresolved'`,
      [projectId],
    );
    const n = toInt(r.rows[0]?.c);
    if (n >= 5) {
      alerts.push(`${n} unresolved contradictions — review queue is backing up`);
    }
  } catch {
    /* ignore */
  }
  try {
    const r = await db.query<Record<string, unknown>>(
      `SELECT COUNT(*) AS c FROM decisions
       WHERE project_id = ? AND status = 'active' AND stale = 1`,
      [projectId],
    );
    const n = toInt(r.rows[0]?.c);
    if (n >= 10) {
      alerts.push(`${n} active decisions marked stale — consider validation sweep`);
    }
  } catch {
    // Postgres uses boolean — retry with true
    try {
      const r = await db.query<Record<string, unknown>>(
        `SELECT COUNT(*) AS c FROM decisions
         WHERE project_id = ? AND status = 'active' AND stale = true`,
        [projectId],
      );
      const n = toInt(r.rows[0]?.c);
      if (n >= 10) {
        alerts.push(`${n} active decisions marked stale — consider validation sweep`);
      }
    } catch {
      /* ignore */
    }
  }

  // --- Recommendations ------------------------------------------------------
  const recommendations: string[] = [];
  if (contradictionsFound > contradictionsResolved) {
    recommendations.push(
      `Resolve the ${contradictionsFound - contradictionsResolved} new contradiction(s) detected this week.`,
    );
  }
  if (outcomesRecorded === 0 && decisionsMade > 0) {
    recommendations.push(
      'No outcomes were recorded this week — hook up outcome tracking so skill profiles stay accurate.',
    );
  }
  if (decisionsMade === 0) {
    recommendations.push(
      'No new decisions were captured this week — encourage passive capture or run a distillation pass.',
    );
  }
  const worstSkill = skillChanges.find((c) => c.delta < 0);
  if (worstSkill) {
    recommendations.push(
      `Pair review on ${worstSkill.agent} / ${worstSkill.domain} to recover lost skill score.`,
    );
  }
  if (emergingPatterns.length > 0) {
    recommendations.push(
      `Emerging activity in: ${emergingPatterns.map((p) => p.pattern).join(', ')}. Consider seeding relevant templates.`,
    );
  }

  const digest: WeeklyDigest = {
    period: { start: periodStart, end: periodEnd },
    highlights: {
      decisions_made: decisionsMade,
      contradictions_found: contradictionsFound,
      contradictions_resolved: contradictionsResolved,
      outcomes_recorded: outcomesRecorded,
      skill_changes: skillChanges.slice(0, 10),
    },
    top_decisions: topDecisions,
    emerging_patterns: emergingPatterns,
    alerts,
    recommendations,
  };

  // Persist to weekly_digests if the table exists. Failures are swallowed —
  // the digest is still returned to the caller so the dashboard keeps working.
  try {
    const id = randomUUID();
    await db.query(
      `INSERT INTO weekly_digests (id, project_id, period_start, period_end, digest_data)
       VALUES (?, ?, ?, ?, ?)`,
      [id, projectId, periodStart, periodEnd, JSON.stringify(digest)],
    );
  } catch (err) {
    console.warn(
      '[hipp0/analytics] Failed to persist weekly digest:',
      (err as Error).message,
    );
  }

  return digest;
}

// ---------------------------------------------------------------------------
// exportDigestMarkdown
// ---------------------------------------------------------------------------

export function exportDigestMarkdown(digest: WeeklyDigest): string {
  const startDay = digest.period.start.slice(0, 10);
  const endDay = digest.period.end.slice(0, 10);
  const lines: string[] = [];

  lines.push(`# Hipp0 Weekly Digest`);
  lines.push(`**${startDay} → ${endDay}**`);
  lines.push('');
  lines.push('## Highlights');
  lines.push(`- Decisions made: **${digest.highlights.decisions_made}**`);
  lines.push(`- Contradictions found: **${digest.highlights.contradictions_found}**`);
  lines.push(`- Contradictions resolved: **${digest.highlights.contradictions_resolved}**`);
  lines.push(`- Outcomes recorded: **${digest.highlights.outcomes_recorded}**`);

  if (digest.highlights.skill_changes.length > 0) {
    lines.push('');
    lines.push('### Skill changes');
    for (const change of digest.highlights.skill_changes) {
      const arrow = change.delta >= 0 ? 'up' : 'down';
      const pct = Math.round(Math.abs(change.delta) * 100);
      lines.push(`- ${change.agent} / ${change.domain}: ${arrow} ${pct}%`);
    }
  }

  if (digest.top_decisions.length > 0) {
    lines.push('');
    lines.push('## Top decisions');
    for (const d of digest.top_decisions) {
      const rate = Math.round(d.success_rate * 100);
      lines.push(
        `- **${d.title}** — ${d.compile_count} compiles, ${rate}% success (id: ${d.id.slice(0, 8)})`,
      );
    }
  }

  if (digest.emerging_patterns.length > 0) {
    lines.push('');
    lines.push('## Emerging patterns');
    for (const p of digest.emerging_patterns) {
      lines.push(`- ${p.pattern} (${p.evidence_count} evidence points)`);
    }
  }

  if (digest.alerts.length > 0) {
    lines.push('');
    lines.push('## Alerts');
    for (const alert of digest.alerts) {
      lines.push(`- ${alert}`);
    }
  }

  if (digest.recommendations.length > 0) {
    lines.push('');
    lines.push('## Recommendations');
    for (const rec of digest.recommendations) {
      lines.push(`- ${rec}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}
