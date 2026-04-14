import { getDb } from '../db/index.js';
import type { DecisionOutcome, OutcomeStats } from '../types.js';
import { parseDecisionOutcome } from '../db/parsers.js';

// Outcome multiplier bounds: 0.85 (poor track record) to 1.10 (strong track record)
const OUTCOME_FLOOR = 0.85;
const OUTCOME_CEILING = 1.10;
// Minimum outcomes before the multiplier has meaningful effect
const MIN_OUTCOMES_FOR_EFFECT = 1;

/**
 * Record a decision-level outcome.
 */
export async function recordDecisionOutcome(params: {
  decision_id: string;
  project_id: string;
  agent_id?: string;
  compile_history_id?: string;
  task_session_id?: string;
  outcome_type: DecisionOutcome['outcome_type'];
  outcome_score: number;
  reversal?: boolean;
  reversal_reason?: string;
  notes?: string;
}): Promise<DecisionOutcome> {
  const db = getDb();
  const id = (await import('node:crypto')).randomUUID();
  const score = Math.max(0, Math.min(1, params.outcome_score));

  await db.query(
    `INSERT INTO decision_outcomes
     (id, decision_id, project_id, agent_id, compile_history_id, task_session_id,
      outcome_type, outcome_score, reversal, reversal_reason, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      params.decision_id,
      params.project_id,
      params.agent_id ?? null,
      params.compile_history_id ?? null,
      params.task_session_id ?? null,
      params.outcome_type,
      score,
      params.reversal ?? false,
      params.reversal_reason ?? null,
      params.notes ?? null,
    ],
  );

  // Recompute cached aggregates on the decision
  await recomputeOutcomeAggregates(params.decision_id);

  const result = await db.query<Record<string, unknown>>(
    'SELECT * FROM decision_outcomes WHERE id = ?',
    [id],
  );

  return parseDecisionOutcome(result.rows[0]);
}

/**
 * Fetch outcome history for a single decision.
 */
export async function getDecisionOutcomes(
  decisionId: string,
  limit = 50,
): Promise<DecisionOutcome[]> {
  const db = getDb();
  const result = await db.query<Record<string, unknown>>(
    'SELECT * FROM decision_outcomes WHERE decision_id = ? ORDER BY created_at DESC LIMIT ?',
    [decisionId, limit],
  );
  return result.rows.map(parseDecisionOutcome);
}

/**
 * Compute aggregate outcome stats for a decision.
 */
export async function getOutcomeStats(decisionId: string): Promise<OutcomeStats> {
  const db = getDb();
  const result = await db.query<Record<string, unknown>>(
    `SELECT
       COUNT(*) as total,
       AVG(outcome_score) as avg_score,
       SUM(CASE WHEN outcome_type = 'success' THEN 1 ELSE 0 END) as successes,
       SUM(CASE WHEN outcome_type = 'failure' THEN 1 ELSE 0 END) as failures,
       SUM(CASE WHEN outcome_type = 'regression' THEN 1 ELSE 0 END) as regressions,
       SUM(CASE WHEN reversal = ${getDb().dialect === 'sqlite' ? '1' : 'true'} THEN 1 ELSE 0 END) as reversals,
       MAX(created_at) as last_at
     FROM decision_outcomes
     WHERE decision_id = ?`,
    [decisionId],
  );

  const row = result.rows[0] ?? {};
  const total = Number(row.total ?? 0);

  return {
    decision_id: decisionId,
    total_outcomes: total,
    success_rate: total > 0 ? Number(row.successes ?? 0) / total : 0,
    failure_rate: total > 0 ? Number(row.failures ?? 0) / total : 0,
    regression_rate: total > 0 ? Number(row.regressions ?? 0) / total : 0,
    reversal_rate: total > 0 ? Number(row.reversals ?? 0) / total : 0,
    avg_outcome_score: total > 0 ? Number(row.avg_score ?? 0.5) : 0.5,
    last_outcome_at: row.last_at ? String(row.last_at) : undefined,
  };
}

/**
 * Recompute and persist cached outcome aggregates on the decision row.
 * Called after every new outcome is recorded.
 */
export async function recomputeOutcomeAggregates(decisionId: string): Promise<void> {
  const db = getDb();
  const stats = await getOutcomeStats(decisionId);

  await db.query(
    `UPDATE decisions
     SET outcome_success_rate = ?,
         outcome_count = ?,
         updated_at = ${db.dialect === 'sqlite' ? "datetime('now')" : 'NOW()'}
     WHERE id = ?`,
    [stats.success_rate, stats.total_outcomes, decisionId],
  );
}

/**
 * Compute a bounded outcome multiplier for use in the compiler.
 *
 * Returns a multiplier in [OUTCOME_FLOOR, OUTCOME_CEILING]:
 * - Decisions with no outcomes get 1.0 (neutral)
 * - Decisions with strong success records get up to 1.10
 * - Decisions with poor track records get down to 0.85
 * - Small sample sizes are dampened toward neutral
 */
export function outcomeMultiplier(
  outcomeSuccessRate: number | null | undefined,
  outcomeCount: number | undefined,
): number {
  if (outcomeSuccessRate == null || !outcomeCount || outcomeCount < MIN_OUTCOMES_FOR_EFFECT) {
    return 1.0; // neutral — not enough data
  }

  // Dampening factor: ramp from 0 to 1 as outcomes increase
  // At MIN_OUTCOMES_FOR_EFFECT (3): factor = 0.33
  // At 10: factor = 0.7
  // At 20+: factor ≈ 1.0
  const dampening = Math.min(1.0, outcomeCount / 20);

  // Center the rate around 0.5 (neutral)
  // success_rate 1.0 → adjustment = +0.5
  // success_rate 0.0 → adjustment = -0.5
  const adjustment = (outcomeSuccessRate - 0.5) * 2;

  // Apply dampening and bound
  const range = OUTCOME_CEILING - OUTCOME_FLOOR;
  const midpoint = (OUTCOME_CEILING + OUTCOME_FLOOR) / 2;
  const multiplier = midpoint + (adjustment * range / 2) * dampening;

  return Math.max(OUTCOME_FLOOR, Math.min(OUTCOME_CEILING, multiplier));
}

/**
 * Attribute outcomes from a compile result to the decisions that were used.
 * Called when an outcome is reported for a compile_history entry.
 */
export async function attributeOutcomeToDecisions(params: {
  compile_history_id: string;
  project_id: string;
  agent_id?: string;
  outcome_type: DecisionOutcome['outcome_type'];
  outcome_score: number;
  task_session_id?: string;
  notes?: string;
}): Promise<number> {
  const db = getDb();

  // Fetch the decisions that were part of this compile
  const historyResult = await db.query<Record<string, unknown>>(
    'SELECT decision_ids, decision_scores FROM compile_history WHERE id = ?',
    [params.compile_history_id],
  );

  if (historyResult.rows.length === 0) return 0;

  let decisionIds: string[] = [];
  const raw = historyResult.rows[0].decision_ids;
  if (typeof raw === 'string') {
    try { decisionIds = JSON.parse(raw); } catch { /* skip */ }
  } else if (Array.isArray(raw)) {
    decisionIds = raw as string[];
  }

  if (decisionIds.length === 0) return 0;

  // Parse decision_scores to get per-decision relevance
  let decisionScores: Record<string, number> = {};
  const rawScores = historyResult.rows[0].decision_scores;
  if (typeof rawScores === 'string') {
    try {
      const parsed = JSON.parse(rawScores);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item.id && item.combined_score != null) {
            decisionScores[item.id] = item.combined_score;
          }
        }
      }
    } catch {}
  } else if (Array.isArray(rawScores)) {
    for (const item of rawScores as any[]) {
      if (item.id && item.combined_score != null) {
        decisionScores[item.id] = item.combined_score;
      }
    }
  }

  // Create outcome records for each referenced decision
  let count = 0;
  for (const decisionId of decisionIds) {
    const relevance = decisionScores[decisionId] ?? 0.5;
    // Weight attribution: strongly relevant decisions get full attribution,
    // weakly relevant decisions get dampened attribution
    const attributionWeight = Math.max(0.3, Math.min(1.0, relevance));
    const weightedScore = params.outcome_score * attributionWeight + (1 - attributionWeight) * 0.5;

    try {
      await recordDecisionOutcome({
        ...params,
        decision_id: decisionId,
        outcome_score: weightedScore,
      });
      count++;
    } catch {
      // Decision may have been deleted — skip
    }
  }

  return count;
}
