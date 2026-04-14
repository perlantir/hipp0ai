/**
 * Decision Impact Predictor
 *
 * Forward-looking system that predicts the expected impact of a decision
 * before it is implemented. Uses pure statistics (no LLM) based on historical
 * outcome data from similar decisions in the same project.
 */
import { getDb } from '../db/index.js';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface DecisionInput {
  title: string;
  description?: string;
  tags?: string[];
  confidence?: string;
  made_by?: string;
  affects?: string[];
  domain?: string | null;
}

export interface RiskFactor {
  code: string;
  message: string;
  severity: 'low' | 'medium' | 'high';
}

export interface ImpactPrediction {
  predicted_success_rate: number;
  confidence_interval: [number, number];
  similar_decisions_count: number;
  risk_factors: RiskFactor[];
  affected_agents: string[];
  estimated_reach: number;
  weighted_avg_outcome_score: number;
  domain_contradiction_rate: number;
}

export interface BatchImpactResult {
  predictions: Array<{
    decision: DecisionInput;
    prediction: ImpactPrediction;
  }>;
  total: number;
}

/* ------------------------------------------------------------------ */
/*  Internal helpers                                                    */
/* ------------------------------------------------------------------ */

interface SimilarDecisionRow {
  id: string;
  tags: unknown;
  domain: string | null;
  confidence: string | null;
  affects: unknown;
  outcome_success_rate: number | null;
  outcome_count: number;
  made_by: string | null;
}

function parseTags(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function parseAffects(raw: unknown): string[] {
  return parseTags(raw);
}

/**
 * Compute the number of overlapping tags between two tag arrays.
 */
function tagOverlap(a: string[], b: string[]): number {
  const setB = new Set(b.map((t) => t.toLowerCase()));
  return a.filter((t) => setB.has(t.toLowerCase())).length;
}

/**
 * Compute similarity weight between proposed decision and an existing decision.
 * Returns 0 if not sufficiently similar.
 */
function computeSimilarityWeight(
  proposed: DecisionInput,
  existing: SimilarDecisionRow,
): number {
  const proposedTags = proposed.tags ?? [];
  const existingTags = parseTags(existing.tags);
  const overlap = tagOverlap(proposedTags, existingTags);

  const sameDomain =
    proposed.domain != null &&
    existing.domain != null &&
    proposed.domain === existing.domain;

  // Must have 2+ shared tags OR same domain to be considered similar
  if (overlap < 2 && !sameDomain) return 0;

  // Base weight from tag overlap (0.2 per shared tag, up to 1.0)
  let weight = Math.min(1.0, overlap * 0.2);

  // Domain match bonus
  if (sameDomain) {
    weight += 0.3;
  }

  // Same confidence level bonus
  if (
    proposed.confidence &&
    existing.confidence &&
    proposed.confidence === existing.confidence
  ) {
    weight += 0.1;
  }

  // Same author bonus (smaller)
  if (
    proposed.made_by &&
    existing.made_by &&
    proposed.made_by === existing.made_by
  ) {
    weight += 0.05;
  }

  return Math.min(1.0, weight);
}

/**
 * Compute confidence interval based on sample size and variance.
 * Wider with fewer samples, narrower with more.
 */
function computeConfidenceInterval(
  mean: number,
  sampleSize: number,
  scores: number[],
): [number, number] {
  if (sampleSize === 0) return [0, 1];

  // Compute standard deviation
  const variance =
    scores.length > 1
      ? scores.reduce((sum, s) => sum + (s - mean) ** 2, 0) / (scores.length - 1)
      : 0.25; // default high variance with 1 sample
  const stdDev = Math.sqrt(variance);

  // Use t-distribution approximation for small samples
  // t-value for 95% CI with small sample sizes
  const tValues: Record<number, number> = {
    1: 12.706,
    2: 4.303,
    3: 3.182,
    4: 2.776,
    5: 2.571,
    6: 2.447,
    7: 2.365,
    8: 2.306,
    9: 2.262,
    10: 2.228,
  };
  const tVal = sampleSize <= 10 ? (tValues[sampleSize] ?? 2.228) : 1.96;

  const marginOfError = tVal * (stdDev / Math.sqrt(sampleSize));

  return [
    Math.max(0, mean - marginOfError),
    Math.min(1, mean + marginOfError),
  ];
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Predict the impact of a proposed decision based on historical outcomes
 * of similar decisions in the same project.
 */
export async function predictDecisionImpact(
  projectId: string,
  decision: DecisionInput,
): Promise<ImpactPrediction> {
  const db = getDb();

  // 1. Fetch all decisions in the project that have outcome data.
  // Sourced from decision_outcome_stats (Phase 14, migration 062/sqlite-040)
  // — the legacy decisions.outcome_success_rate/outcome_count columns are
  // being removed via migration 060. Use view values aliased to the
  // historical column names so downstream scoring code doesn't change.
  const result = await db.query<Record<string, unknown>>(
    `SELECT d.id, d.tags, d.domain, d.confidence, d.affects, d.made_by,
            v.success_rate AS outcome_success_rate,
            v.total_count  AS outcome_count
     FROM decisions d
     JOIN decision_outcome_stats v
       ON v.decision_id = d.id AND v.project_id = d.project_id
     WHERE d.project_id = ?
       AND v.total_count > 0
       AND d.status = 'active'`,
    [projectId],
  );

  const candidates = result.rows as unknown as SimilarDecisionRow[];

  // 2. Score similarity and filter
  const scored: Array<{ row: SimilarDecisionRow; weight: number }> = [];
  for (const row of candidates) {
    const weight = computeSimilarityWeight(decision, row);
    if (weight > 0) {
      scored.push({ row, weight });
    }
  }

  // Sort by weight descending
  scored.sort((a, b) => b.weight - a.weight);

  // 3. Compute weighted success rate
  let weightedSuccessSum = 0;
  let weightedOutcomeScoreSum = 0;
  let totalWeight = 0;
  const successRates: number[] = [];

  for (const { row, weight } of scored) {
    const rate = row.outcome_success_rate ?? 0.5;
    weightedSuccessSum += rate * weight;
    // Use outcome_success_rate as proxy for outcome score when we don't have granular data
    weightedOutcomeScoreSum += rate * weight;
    totalWeight += weight;
    successRates.push(rate);
  }

  const predictedSuccessRate =
    totalWeight > 0 ? weightedSuccessSum / totalWeight : 0.5;

  const weightedAvgOutcomeScore =
    totalWeight > 0 ? weightedOutcomeScoreSum / totalWeight : 0.5;

  // 4. Confidence interval
  const confidenceInterval = computeConfidenceInterval(
    predictedSuccessRate,
    scored.length,
    successRates,
  );

  // 5. Risk factors
  const riskFactors: RiskFactor[] = [];

  if (scored.length < 5) {
    riskFactors.push({
      code: 'low_sample_size',
      message: `Low sample size: only ${scored.length} similar decision(s) found with outcome data`,
      severity: scored.length === 0 ? 'high' : 'medium',
    });
  }

  // Check domain contradiction rate
  let domainContradictionRate = 0;
  if (decision.domain) {
    const contradictionResult = await db.query<Record<string, unknown>>(
      `SELECT COUNT(*) as total,
              SUM(CASE WHEN outcome_type IN ('failure', 'regression') THEN 1 ELSE 0 END) as bad
       FROM decision_outcomes do2
       JOIN decisions d2 ON d2.id = do2.decision_id
       WHERE d2.project_id = ? AND d2.domain = ?`,
      [projectId, decision.domain],
    );

    const total = Number(contradictionResult.rows[0]?.total ?? 0);
    const bad = Number(contradictionResult.rows[0]?.bad ?? 0);
    domainContradictionRate = total > 0 ? bad / total : 0;

    if (domainContradictionRate > 0.3) {
      riskFactors.push({
        code: 'high_contradiction_rate',
        message: `High contradiction rate in domain "${decision.domain}": ${(domainContradictionRate * 100).toFixed(0)}% of outcomes are failures/regressions`,
        severity: domainContradictionRate > 0.5 ? 'high' : 'medium',
      });
    }
  }

  // Check if no validations exist for similar decisions
  if (scored.length > 0) {
    const decisionIds = scored.map((s) => s.row.id);
    const placeholders = decisionIds.map(() => '?').join(',');
    const validationResult = await db.query<Record<string, unknown>>(
      `SELECT COUNT(*) as c FROM decisions
       WHERE id IN (${placeholders}) AND validated_at IS NOT NULL`,
      decisionIds,
    );
    const validatedCount = Number(validationResult.rows[0]?.c ?? 0);
    if (validatedCount === 0) {
      riskFactors.push({
        code: 'no_validation_history',
        message: 'None of the similar decisions have been validated',
        severity: 'medium',
      });
    }
  }

  // Check affected agents count
  const proposedAffects = decision.affects ?? [];
  if (proposedAffects.length > 5) {
    riskFactors.push({
      code: 'high_agent_reach',
      message: `Decision affects ${proposedAffects.length} agents, which increases coordination risk`,
      severity: proposedAffects.length > 10 ? 'high' : 'medium',
    });
  }

  // 6. Identify affected agents from the project
  let affectedAgents: string[] = [];
  if (proposedAffects.length > 0) {
    const agentPlaceholders = proposedAffects.map(() => '?').join(',');
    const agentResult = await db.query<Record<string, unknown>>(
      `SELECT name FROM agents WHERE project_id = ? AND name IN (${agentPlaceholders})`,
      [projectId, ...proposedAffects],
    );
    affectedAgents = agentResult.rows.map((r) => String(r.name));
  }

  // Also count agents that were affected by similar decisions
  const reachSet = new Set<string>(affectedAgents);
  for (const { row } of scored) {
    const existingAffects = parseAffects(row.affects);
    for (const a of existingAffects) {
      reachSet.add(a);
    }
  }

  return {
    predicted_success_rate: Math.round(predictedSuccessRate * 1000) / 1000,
    confidence_interval: [
      Math.round(confidenceInterval[0] * 1000) / 1000,
      Math.round(confidenceInterval[1] * 1000) / 1000,
    ],
    similar_decisions_count: scored.length,
    risk_factors: riskFactors,
    affected_agents: affectedAgents,
    estimated_reach: reachSet.size,
    weighted_avg_outcome_score:
      Math.round(weightedAvgOutcomeScore * 1000) / 1000,
    domain_contradiction_rate:
      Math.round(domainContradictionRate * 1000) / 1000,
  };
}

/**
 * Predict impact for multiple decisions at once (for what-if / batch scenarios).
 */
export async function predictBatchImpact(
  projectId: string,
  decisions: DecisionInput[],
): Promise<BatchImpactResult> {
  const predictions = await Promise.all(
    decisions.map(async (decision) => ({
      decision,
      prediction: await predictDecisionImpact(projectId, decision),
    })),
  );

  return {
    predictions,
    total: predictions.length,
  };
}
