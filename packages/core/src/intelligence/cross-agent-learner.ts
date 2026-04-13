import { getDb } from '../db/index.js';
import type { AgentPerformanceStats, CrossAgentSignal } from '../types.js';
import { increaseWingAffinity, decreaseWingAffinity } from '../wings/affinity.js';

const MIN_OUTCOMES_FOR_SIGNAL = 3;
const MIN_TRANSFER_EVIDENCE = 5;
const CROSS_AGENT_LEARNING_RATE = 0.015;

/**
 * Compute per-agent performance stats from decision outcomes.
 * Uses trust_score as a quality weight when available.
 */
export async function computeAgentPerformance(
  projectId: string,
): Promise<AgentPerformanceStats[]> {
  const db = getDb();

  const result = await db.query<Record<string, unknown>>(
    `SELECT
       d.made_by as agent_name,
       a.id as agent_id,
       COUNT(DISTINCT d.id) as total_decisions,
       COUNT(do2.id) as total_outcomes,
       AVG(do2.outcome_score) as avg_score,
       SUM(CASE WHEN do2.outcome_type = 'success' THEN 1 ELSE 0 END) as successes,
       SUM(CASE WHEN do2.outcome_type = 'failure' THEN 1 ELSE 0 END) as failures,
       SUM(CASE WHEN do2.outcome_type = 'regression' THEN 1 ELSE 0 END) as regressions,
       SUM(CASE WHEN do2.reversal = ${db.dialect === 'sqlite' ? '1' : 'true'} THEN 1 ELSE 0 END) as reversals,
       AVG(COALESCE(d.trust_score, 0.5) * do2.outcome_score) as trust_weighted
     FROM decisions d
     LEFT JOIN agents a ON a.project_id = d.project_id AND a.name = d.made_by
     LEFT JOIN decision_outcomes do2 ON do2.decision_id = d.id
     WHERE d.project_id = ?
     GROUP BY d.made_by, a.id
     HAVING COUNT(DISTINCT d.id) > 0`,
    [projectId],
  );

  return result.rows.map((row) => {
    const total = Number(row.total_outcomes ?? 0);
    return {
      agent_id: (row.agent_id as string) ?? '',
      agent_name: row.agent_name as string,
      total_decisions: Number(row.total_decisions ?? 0),
      total_linked_outcomes: total,
      success_rate: total > 0 ? Number(row.successes ?? 0) / total : 0,
      failure_rate: total > 0 ? Number(row.failures ?? 0) / total : 0,
      regression_rate: total > 0 ? Number(row.regressions ?? 0) / total : 0,
      reversal_rate: total > 0 ? Number(row.reversals ?? 0) / total : 0,
      avg_outcome_score: Number(row.avg_score ?? 0.5),
      trust_weighted_score: Number(row.trust_weighted ?? 0.5),
      top_domains: [],
      last_updated_at: new Date().toISOString(),
    };
  });
}

/**
 * Compute domain strengths per agent from decision outcomes.
 */
export async function computeDomainStrengths(
  projectId: string,
): Promise<Record<string, string[]>> {
  const db = getDb();

  const result = await db.query<Record<string, unknown>>(
    `SELECT
       d.made_by as agent_name,
       d.domain,
       COUNT(do2.id) as outcome_count,
       AVG(do2.outcome_score) as avg_score
     FROM decisions d
     JOIN decision_outcomes do2 ON do2.decision_id = d.id
     WHERE d.project_id = ? AND d.domain IS NOT NULL
     GROUP BY d.made_by, d.domain
     HAVING COUNT(do2.id) >= ?
     ORDER BY d.made_by, avg_score DESC`,
    [projectId, MIN_OUTCOMES_FOR_SIGNAL],
  );

  const strengths: Record<string, string[]> = {};
  for (const row of result.rows) {
    const agent = row.agent_name as string;
    const domain = row.domain as string;
    const score = Number(row.avg_score ?? 0);
    if (score >= 0.6) {
      if (!strengths[agent]) strengths[agent] = [];
      strengths[agent].push(domain);
    }
  }
  return strengths;
}

/**
 * Compute cross-agent transfer signals.
 * When agent X compiles decisions authored by agent Y and the outcome is positive,
 * that's a positive transfer signal from Y to X.
 */
export async function computeCrossAgentTransfer(
  projectId: string,
): Promise<CrossAgentSignal[]> {
  const db = getDb();

  // Get compile outcomes linked to specific decisions and their authors
  const result = await db.query<Record<string, unknown>>(
    `SELECT
       ch.agent_name as target_agent,
       d.made_by as source_agent,
       COUNT(do2.id) as sample_size,
       AVG(do2.outcome_score) as avg_score,
       SUM(CASE WHEN do2.outcome_type = 'success' THEN 1 ELSE 0 END) as successes,
       SUM(CASE WHEN do2.outcome_type IN ('failure', 'regression') THEN 1 ELSE 0 END) as failures
     FROM decision_outcomes do2
     JOIN decisions d ON d.id = do2.decision_id
     JOIN compile_history ch ON ch.id = do2.compile_history_id
     WHERE do2.project_id = ?
       AND ch.agent_name IS NOT NULL
       AND d.made_by IS NOT NULL
       AND ch.agent_name != d.made_by
     GROUP BY ch.agent_name, d.made_by
     HAVING COUNT(do2.id) >= ?`,
    [projectId, MIN_TRANSFER_EVIDENCE],
  );

  const signals: CrossAgentSignal[] = [];
  for (const row of result.rows) {
    const sampleSize = Number(row.sample_size ?? 0);
    const avgScore = Number(row.avg_score ?? 0.5);
    const successes = Number(row.successes ?? 0);

    // Dampening: confidence scales with evidence
    const confidence = Math.min(1.0, sampleSize / 20);

    // Determine signal type
    const successRate = sampleSize > 0 ? successes / sampleSize : 0.5;
    const signalType = successRate >= 0.6 ? 'positive_transfer' as const : successRate <= 0.35 ? 'negative_transfer' as const : 'positive_transfer' as const;

    signals.push({
      source_agent: row.source_agent as string,
      target_agent: row.target_agent as string,
      signal_type: signalType,
      sample_size: sampleSize,
      score: avgScore,
      confidence,
      last_updated_at: new Date().toISOString(),
    });
  }

  return signals;
}

/**
 * Apply cross-agent learning to wing affinity.
 * Positive transfer → increase wing affinity for source agent's wing.
 * Negative transfer → decrease wing affinity.
 * Bounded by CROSS_AGENT_LEARNING_RATE and dampened by confidence.
 */
export async function applyCrossAgentLearning(
  projectId: string,
): Promise<{ agents_updated: number; signals_applied: number }> {
  const db = getDb();
  const signals = await computeCrossAgentTransfer(projectId);

  let agentsUpdated = 0;
  let signalsApplied = 0;
  const updatedAgents = new Set<string>();

  for (const signal of signals) {
    // Resolve target agent ID
    const agentResult = await db.query<Record<string, unknown>>(
      'SELECT id FROM agents WHERE project_id = ? AND name = ?',
      [projectId, signal.target_agent],
    );
    if (agentResult.rows.length === 0) continue;
    const targetAgentId = agentResult.rows[0].id as string;

    // Wing = source agent name (decisions are grouped by maker)
    const wing = signal.source_agent;
    const adjustment = CROSS_AGENT_LEARNING_RATE * signal.confidence;

    if (signal.signal_type === 'positive_transfer' && signal.score >= 0.55) {
      await increaseWingAffinity(targetAgentId, wing, adjustment);
      signalsApplied++;
      updatedAgents.add(targetAgentId);
    } else if (signal.signal_type === 'negative_transfer' && signal.score < 0.4) {
      await decreaseWingAffinity(targetAgentId, wing, adjustment * 0.5);
      signalsApplied++;
      updatedAgents.add(targetAgentId);
    }
  }

  agentsUpdated = updatedAgents.size;

  console.warn(`[hipp0/cross-agent] Applied ${signalsApplied} signals across ${agentsUpdated} agents for project ${projectId.slice(0, 8)}..`);

  return { agents_updated: agentsUpdated, signals_applied: signalsApplied };
}

/**
 * Get a full cross-agent learning summary for a project.
 * Combines performance stats, domain strengths, and transfer signals.
 */
export async function getCrossAgentSummary(projectId: string): Promise<{
  agent_performance: AgentPerformanceStats[];
  cross_agent_signals: CrossAgentSignal[];
  domain_strengths: Record<string, string[]>;
}> {
  const [performance, signals, domains] = await Promise.all([
    computeAgentPerformance(projectId),
    computeCrossAgentTransfer(projectId),
    computeDomainStrengths(projectId),
  ]);

  // Merge domain strengths into performance stats
  for (const agent of performance) {
    agent.top_domains = domains[agent.agent_name] ?? [];
  }

  return {
    agent_performance: performance,
    cross_agent_signals: signals,
    domain_strengths: domains,
  };
}
