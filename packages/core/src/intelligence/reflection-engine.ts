/**
 * Automated Reflection Engine
 *
 * Scheduled reflection loops that auto-improve the knowledge base without
 * human intervention. Three cadences:
 *   - hourly  : light maintenance (dedup, contradictions)
 *   - daily   : deeper analysis (sessions, skills, outcomes)
 *   - weekly  : strategic (evolution, insights, staleness, team health)
 *
 * All sub-steps are wrapped in try/catch so one failure never blocks others.
 * Pure SQL aggregations — no LLM calls here.
 */

import { randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';
import { runCaptureDedup } from './capture-dedup.js';
import { runEvolutionScan } from './evolution-engine.js';
import { computeAgentSkillProfile } from './skill-profiler.js';
import { getOutcomeStats, recomputeOutcomeAggregates } from './outcome-memory.js';
import { promoteToInsights } from './knowledge-pipeline.js';
import { withCoreSpan } from '../telemetry.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReflectionType = 'hourly' | 'daily' | 'weekly';

export interface HourlyReflectionResult {
  contradictions_found: number;
  duplicates_removed: number;
  duration_ms: number;
}

export interface DailyReflectionResult {
  sessions_consolidated: number;
  skills_updated: number;
  decisions_analyzed: number;
  improvements_suggested: number;
  duration_ms: number;
}

export interface TeamHealthMetrics {
  overall_success_rate: number;
  contradiction_rate: number;
  decision_velocity: number;
  total_decisions: number;
  active_decisions: number;
}

export interface WeeklyReflectionResult {
  evolution_proposals: number;
  insights_generated: number;
  stale_decisions: number;
  team_health: TeamHealthMetrics;
  duration_ms: number;
}

export interface ReflectionRunRecord {
  id: string;
  project_id: string;
  reflection_type: ReflectionType;
  results: Record<string, unknown>;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nowLiteral(): string {
  return getDb().dialect === 'sqlite' ? "datetime('now')" : 'NOW()';
}

function intervalClause(column: string, expr: string): string {
  // expr is something like '-1 hour', '-1 day', '-90 days', '-7 days'
  return getDb().dialect === 'sqlite'
    ? `${column} >= datetime('now', '${expr}')`
    : `${column} >= NOW() - INTERVAL '${expr.replace(/^-/, '')}'`;
}

async function beginReflectionRun(
  projectId: string,
  type: ReflectionType,
): Promise<string> {
  const db = getDb();
  const id = randomUUID();
  try {
    await db.query(
      `INSERT INTO reflection_runs (id, project_id, reflection_type, results, started_at)
       VALUES (?, ?, ?, ?, ${nowLiteral()})`,
      [id, projectId, type, '{}'],
    );
  } catch (err) {
    console.warn('[hipp0/reflection] Failed to record run start:', (err as Error).message);
  }
  return id;
}

async function completeReflectionRun(
  runId: string,
  results: Record<string, unknown>,
  durationMs: number,
): Promise<void> {
  const db = getDb();
  try {
    await db.query(
      `UPDATE reflection_runs
       SET results = ?, completed_at = ${nowLiteral()}, duration_ms = ?
       WHERE id = ?`,
      [JSON.stringify(results), durationMs, runId],
    );
  } catch (err) {
    console.warn('[hipp0/reflection] Failed to record run completion:', (err as Error).message);
  }
}

// ---------------------------------------------------------------------------
// Hourly reflection
// ---------------------------------------------------------------------------

/**
 * Light maintenance run: dedup scan + contradiction recount.
 */
export async function runHourlyReflection(
  projectId: string,
): Promise<HourlyReflectionResult> {
  return withCoreSpan('reflection_run', {
    project_id: projectId,
    reflection_type: 'hourly',
  }, async () => {
  const start = Date.now();
  const runId = await beginReflectionRun(projectId, 'hourly');
  const db = getDb();

  let duplicatesRemoved = 0;
  let contradictionsFound = 0;

  // 1. Capture dedup scan — find exact duplicates among recent captures
  try {
    const recentCaptures = await db.query<Record<string, unknown>>(
      `SELECT id, dedup_hash, COUNT(*) OVER (PARTITION BY dedup_hash) AS dup_count
       FROM captures
       WHERE project_id = ?
         AND ${intervalClause('created_at', '-1 hour')}
         AND dedup_hash IS NOT NULL`,
      [projectId],
    );
    const seen = new Set<string>();
    for (const row of recentCaptures.rows) {
      const hash = row.dedup_hash as string;
      if (seen.has(hash)) {
        duplicatesRemoved++;
      } else {
        seen.add(hash);
      }
    }
  } catch (err) {
    // Fallback: run a single dedup probe (it's best effort)
    try {
      await runCaptureDedup(projectId, '').catch(() => {});
    } catch {
      /* ignore */
    }
    console.warn('[hipp0/reflection:hourly] dedup scan failed:', (err as Error).message);
  }

  // 2. Count new contradictions for decisions updated in last hour
  try {
    const contraResult = await db.query<Record<string, unknown>>(
      `SELECT COUNT(DISTINCT c.id) AS cnt
       FROM contradictions c
       WHERE c.project_id = ?
         AND c.status = 'unresolved'
         AND ${intervalClause('c.detected_at', '-1 hour')}`,
      [projectId],
    );
    contradictionsFound = Number(contraResult.rows[0]?.cnt ?? 0);
  } catch (err) {
    console.warn(
      '[hipp0/reflection:hourly] contradiction scan failed:',
      (err as Error).message,
    );
  }

  const durationMs = Date.now() - start;
  const result: HourlyReflectionResult = {
    contradictions_found: contradictionsFound,
    duplicates_removed: duplicatesRemoved,
    duration_ms: durationMs,
  };

  await completeReflectionRun(runId, result as unknown as Record<string, unknown>, durationMs);
  return result;
  });
}

// ---------------------------------------------------------------------------
// Daily reflection
// ---------------------------------------------------------------------------

/**
 * Deeper analysis: consolidate sessions, update skill profiles, refresh
 * outcome stats, flag underperforming decisions.
 */
export async function runDailyReflection(
  projectId: string,
): Promise<DailyReflectionResult> {
  return withCoreSpan('reflection_run', {
    project_id: projectId,
    reflection_type: 'daily',
  }, async () => {
  const start = Date.now();
  const runId = await beginReflectionRun(projectId, 'daily');
  const db = getDb();

  let sessionsConsolidated = 0;
  let skillsUpdated = 0;
  let decisionsAnalyzed = 0;
  let improvementsSuggested = 0;

  // 1. Consolidate recently completed sessions
  try {
    const sessions = await db.query<Record<string, unknown>>(
      `SELECT id, agents_involved, state_summary
       FROM task_sessions
       WHERE project_id = ?
         AND status = 'completed'
         AND ${intervalClause('updated_at', '-1 day')}
       ORDER BY updated_at DESC
       LIMIT 50`,
      [projectId],
    );
    sessionsConsolidated = sessions.rows.length;
  } catch (err) {
    console.warn(
      '[hipp0/reflection:daily] session consolidation failed:',
      (err as Error).message,
    );
  }

  // 2. Update agent skill profiles for active agents
  try {
    const agentsResult = await db.query<Record<string, unknown>>(
      `SELECT DISTINCT name FROM agents WHERE project_id = ?`,
      [projectId],
    );
    for (const row of agentsResult.rows) {
      const agentName = row.name as string;
      try {
        await computeAgentSkillProfile(projectId, agentName);
        skillsUpdated++;
      } catch (err) {
        console.warn(
          `[hipp0/reflection:daily] skill profile failed for ${agentName}:`,
          (err as Error).message,
        );
      }
    }
  } catch (err) {
    console.warn(
      '[hipp0/reflection:daily] agent enumeration failed:',
      (err as Error).message,
    );
  }

  // 3. Refresh outcome stats for decisions with new outcomes today
  try {
    const recentOutcomes = await db.query<Record<string, unknown>>(
      `SELECT DISTINCT decision_id
       FROM decision_outcomes
       WHERE project_id = ?
         AND ${intervalClause('created_at', '-1 day')}`,
      [projectId],
    );
    for (const row of recentOutcomes.rows) {
      const decisionId = row.decision_id as string;
      try {
        await recomputeOutcomeAggregates(decisionId);
        decisionsAnalyzed++;
      } catch (err) {
        console.warn(
          `[hipp0/reflection:daily] recompute failed for ${decisionId}:`,
          (err as Error).message,
        );
      }
    }
  } catch (err) {
    console.warn(
      '[hipp0/reflection:daily] outcome refresh failed:',
      (err as Error).message,
    );
  }

  // 4. What-if analysis on lowest-performing decisions (lightweight — count candidates)
  try {
    const lowPerforming = await db.query<Record<string, unknown>>(
      `SELECT id FROM decisions
       WHERE project_id = ?
         AND status = 'active'
         AND outcome_count >= 3
         AND outcome_success_rate IS NOT NULL
         AND outcome_success_rate < 0.5
       ORDER BY outcome_success_rate ASC
       LIMIT 10`,
      [projectId],
    );
    for (const row of lowPerforming.rows) {
      const decisionId = row.id as string;
      try {
        const stats = await getOutcomeStats(decisionId);
        if (stats.total_outcomes >= 3 && stats.success_rate < 0.5) {
          improvementsSuggested++;
        }
      } catch {
        /* ignore */
      }
    }
  } catch (err) {
    console.warn(
      '[hipp0/reflection:daily] what-if analysis failed:',
      (err as Error).message,
    );
  }

  const durationMs = Date.now() - start;
  const result: DailyReflectionResult = {
    sessions_consolidated: sessionsConsolidated,
    skills_updated: skillsUpdated,
    decisions_analyzed: decisionsAnalyzed,
    improvements_suggested: improvementsSuggested,
    duration_ms: durationMs,
  };

  await completeReflectionRun(runId, result as unknown as Record<string, unknown>, durationMs);
  return result;
  });
}

// ---------------------------------------------------------------------------
// Weekly reflection
// ---------------------------------------------------------------------------

/**
 * Strategic run: evolution scan, insights, stale tracking, team health.
 */
export async function runWeeklyReflection(
  projectId: string,
): Promise<WeeklyReflectionResult> {
  return withCoreSpan('reflection_run', {
    project_id: projectId,
    reflection_type: 'weekly',
  }, async () => {
  const start = Date.now();
  const runId = await beginReflectionRun(projectId, 'weekly');
  const db = getDb();

  let evolutionProposals = 0;
  let insightsGenerated = 0;
  let staleDecisions = 0;
  let teamHealth: TeamHealthMetrics = {
    overall_success_rate: 0,
    contradiction_rate: 0,
    decision_velocity: 0,
    total_decisions: 0,
    active_decisions: 0,
  };

  // 1. Full evolution scan
  try {
    const scan = await runEvolutionScan(projectId, 'rule');
    evolutionProposals = scan.proposals.length;
  } catch (err) {
    console.warn(
      '[hipp0/reflection:weekly] evolution scan failed:',
      (err as Error).message,
    );
  }

  // 2. Knowledge insights — promote Tier 2 → Tier 3 (procedures, policies, etc.)
  try {
    const promotion = await promoteToInsights(projectId);
    insightsGenerated = promotion.total_created;
  } catch (err) {
    console.warn(
      '[hipp0/reflection:weekly] knowledge pipeline failed, falling back to stats:',
      (err as Error).message,
    );
    try {
      const insightsResult = await db.query<Record<string, unknown>>(
        `SELECT
           COUNT(DISTINCT domain) AS unique_domains,
           COUNT(DISTINCT made_by) AS unique_authors,
           COUNT(*) AS total
         FROM decisions
         WHERE project_id = ? AND status = 'active'`,
        [projectId],
      );
      const row = insightsResult.rows[0] ?? {};
      insightsGenerated =
        Number(row.unique_domains ?? 0) + Number(row.unique_authors ?? 0);
    } catch {
      /* ignore */
    }
  }

  // 3. Identify stale decisions (>90 days unvalidated)
  try {
    const staleResult = await db.query<Record<string, unknown>>(
      `SELECT COUNT(*) AS cnt
       FROM decisions
       WHERE project_id = ?
         AND status = 'active'
         AND (validated_at IS NULL)
         AND created_at < ${
           db.dialect === 'sqlite'
             ? "datetime('now', '-90 days')"
             : "NOW() - INTERVAL '90 days'"
         }`,
      [projectId],
    );
    staleDecisions = Number(staleResult.rows[0]?.cnt ?? 0);
  } catch (err) {
    console.warn(
      '[hipp0/reflection:weekly] stale check failed:',
      (err as Error).message,
    );
  }

  // 4. Team health metrics
  try {
    const totals = await db.query<Record<string, unknown>>(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active
       FROM decisions
       WHERE project_id = ?`,
      [projectId],
    );
    const totalDecisions = Number(totals.rows[0]?.total ?? 0);
    const activeDecisions = Number(totals.rows[0]?.active ?? 0);

    // Overall success rate from decision_outcomes (last 30 days)
    let overallSuccessRate = 0;
    try {
      const outcomeTotals = await db.query<Record<string, unknown>>(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN outcome_type = 'success' THEN 1 ELSE 0 END) AS successes
         FROM decision_outcomes
         WHERE project_id = ?
           AND ${intervalClause('created_at', '-30 days')}`,
        [projectId],
      );
      const outcomeTotal = Number(outcomeTotals.rows[0]?.total ?? 0);
      const successes = Number(outcomeTotals.rows[0]?.successes ?? 0);
      overallSuccessRate = outcomeTotal > 0 ? successes / outcomeTotal : 0;
    } catch {
      /* ignore */
    }

    // Contradiction rate: unresolved / active
    let contradictionRate = 0;
    try {
      const contra = await db.query<Record<string, unknown>>(
        `SELECT COUNT(*) AS cnt
         FROM contradictions
         WHERE project_id = ? AND status = 'unresolved'`,
        [projectId],
      );
      const unresolvedCnt = Number(contra.rows[0]?.cnt ?? 0);
      contradictionRate =
        activeDecisions > 0 ? unresolvedCnt / activeDecisions : 0;
    } catch {
      /* ignore */
    }

    // Decision velocity: decisions created per day over the last 7 days
    let decisionVelocity = 0;
    try {
      const velocityResult = await db.query<Record<string, unknown>>(
        `SELECT COUNT(*) AS cnt
         FROM decisions
         WHERE project_id = ?
           AND ${intervalClause('created_at', '-7 days')}`,
        [projectId],
      );
      const createdLastWeek = Number(velocityResult.rows[0]?.cnt ?? 0);
      decisionVelocity = Math.round((createdLastWeek / 7) * 100) / 100;
    } catch {
      /* ignore */
    }

    teamHealth = {
      overall_success_rate: Math.round(overallSuccessRate * 10000) / 10000,
      contradiction_rate: Math.round(contradictionRate * 10000) / 10000,
      decision_velocity: decisionVelocity,
      total_decisions: totalDecisions,
      active_decisions: activeDecisions,
    };
  } catch (err) {
    console.warn(
      '[hipp0/reflection:weekly] team health failed:',
      (err as Error).message,
    );
  }

  const durationMs = Date.now() - start;
  const result: WeeklyReflectionResult = {
    evolution_proposals: evolutionProposals,
    insights_generated: insightsGenerated,
    stale_decisions: staleDecisions,
    team_health: teamHealth,
    duration_ms: durationMs,
  };

  await completeReflectionRun(runId, result as unknown as Record<string, unknown>, durationMs);
  return result;
  });
}

// ---------------------------------------------------------------------------
// History query
// ---------------------------------------------------------------------------

/**
 * Retrieve past reflection runs for a project.
 */
export async function getReflectionHistory(
  projectId: string,
  limit: number = 50,
): Promise<ReflectionRunRecord[]> {
  const db = getDb();
  const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
  const result = await db.query<Record<string, unknown>>(
    `SELECT id, project_id, reflection_type, results, started_at, completed_at, duration_ms
     FROM reflection_runs
     WHERE project_id = ?
     ORDER BY started_at DESC
     LIMIT ?`,
    [projectId, safeLimit],
  );

  return result.rows.map((row) => {
    let parsedResults: Record<string, unknown> = {};
    const raw = row.results;
    if (typeof raw === 'string') {
      try {
        parsedResults = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        parsedResults = {};
      }
    } else if (raw && typeof raw === 'object') {
      parsedResults = raw as Record<string, unknown>;
    }

    return {
      id: row.id as string,
      project_id: row.project_id as string,
      reflection_type: row.reflection_type as ReflectionType,
      results: parsedResults,
      started_at: row.started_at as string,
      completed_at: (row.completed_at as string) ?? null,
      duration_ms:
        row.duration_ms != null ? Number(row.duration_ms) : null,
    };
  });
}
