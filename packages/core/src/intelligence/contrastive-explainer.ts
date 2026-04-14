/**
 * Contrastive Explainer — generates "why this, not that?" explanations
 * for ranked decisions in the compile pipeline.
 *
 * Pure deterministic logic — NO LLM calls.
 */

import type { ScoredDecision, ScoringBreakdown } from '../types.js';

/** Human-readable labels for scoring breakdown signals */
const SIGNAL_LABELS: Record<string, string> = {
  direct_affect: 'Direct Affect',
  tag_matching: 'Tag Match',
  role_relevance: 'Role Relevance',
  semantic_similarity: 'Semantic Similarity',
  status_penalty: 'Status Penalty',
  freshness: 'Freshness',
  domain_boost: 'Domain Boost',
  trust_multiplier: 'Trust Multiplier',
  outcome_multiplier: 'Outcome Multiplier',
};

/** Signals to compare (excludes `combined` which is the aggregate) */
type NumericBreakdownKey = Exclude<
  {
    [K in keyof ScoringBreakdown]: ScoringBreakdown[K] extends number | undefined ? K : never;
  }[keyof ScoringBreakdown],
  undefined
>;

const COMPARABLE_SIGNALS: NumericBreakdownKey[] = [
  'direct_affect',
  'tag_matching',
  'role_relevance',
  'semantic_similarity',
  'status_penalty',
  'freshness',
  'domain_boost',
  'trust_multiplier',
  'outcome_multiplier',
];

/** Minimum absolute difference to include a signal in the explanation */
const SIGNIFICANCE_THRESHOLD = 0.1;

export interface ContrastiveExplanation {
  higher: { id: string; title: string; score: number };
  lower: { id: string; title: string; score: number };
  explanation: string;
}

/**
 * Generates a contrastive explanation for why `topDecision` ranked higher
 * than `comparedDecision` by comparing their scoring breakdowns signal
 * by signal.
 */
export function generateContrastiveExplanation(
  topDecision: ScoredDecision,
  comparedDecision: ScoredDecision,
): ContrastiveExplanation {
  const topBreakdown = topDecision.scoring_breakdown;
  const comparedBreakdown = comparedDecision.scoring_breakdown;

  const reasons: string[] = [];

  for (const signal of COMPARABLE_SIGNALS) {
    const topVal = topBreakdown[signal] ?? 0;
    const comparedVal = comparedBreakdown[signal] ?? 0;
    const diff = topVal - comparedVal;

    if (Math.abs(diff) >= SIGNIFICANCE_THRESHOLD) {
      const label = SIGNAL_LABELS[signal] ?? signal;
      const topStr = topVal.toFixed(2);
      const comparedStr = comparedVal.toFixed(2);

      if (diff > 0) {
        reasons.push(`${label} (${topStr} vs ${comparedStr})`);
      } else {
        // The compared decision was better on this signal, note it as a counter-point
        reasons.push(`${label} (${topStr} vs ${comparedStr} - lower scored higher here)`);
      }
    }
  }

  let explanation: string;
  if (reasons.length === 0) {
    const scoreDiff = (topDecision.combined_score - comparedDecision.combined_score).toFixed(3);
    explanation = `Ranked higher by a narrow margin (${scoreDiff}) with no single dominant signal`;
  } else {
    explanation = `Ranked higher because: ${reasons.join(', ')}`;
  }

  return {
    higher: {
      id: topDecision.id,
      title: topDecision.title,
      score: topDecision.combined_score,
    },
    lower: {
      id: comparedDecision.id,
      title: comparedDecision.title,
      score: comparedDecision.combined_score,
    },
    explanation,
  };
}

/**
 * Given sorted decisions (highest score first), generates contrastive
 * explanations for key boundary pairs:
 *  - Why #1 beat #2
 *  - Why the last included beat the first excluded (the cutoff boundary)
 *  - Additional pairs at even intervals if `count` allows
 *
 * @param decisions - Sorted array of scored decisions (descending by combined_score)
 * @param count - Maximum number of contrast pairs to generate
 */
export function generateTopContrastPairs(
  decisions: ScoredDecision[],
  count: number = 3,
): ContrastiveExplanation[] {
  if (decisions.length < 2) return [];

  const pairs: ContrastiveExplanation[] = [];
  const maxPairs = Math.min(count, decisions.length - 1);

  // Always include #1 vs #2
  pairs.push(generateContrastiveExplanation(decisions[0], decisions[1]));

  if (maxPairs <= 1) return pairs;

  // Spread remaining pairs evenly across the ranking
  const step = Math.max(1, Math.floor((decisions.length - 1) / maxPairs));
  for (let i = step; i < decisions.length - 1 && pairs.length < maxPairs; i += step) {
    pairs.push(generateContrastiveExplanation(decisions[i], decisions[i + 1]));
  }

  // If we haven't reached count yet and the last pair isn't at the end, add the tail pair
  if (pairs.length < maxPairs && decisions.length >= 2) {
    const lastIdx = decisions.length - 2;
    const alreadyIncluded = pairs.some(
      (p) => p.higher.id === decisions[lastIdx].id && p.lower.id === decisions[lastIdx + 1].id,
    );
    if (!alreadyIncluded) {
      pairs.push(
        generateContrastiveExplanation(decisions[lastIdx], decisions[lastIdx + 1]),
      );
    }
  }

  return pairs.slice(0, count);
}

/**
 * Generates boundary-specific contrastive explanations for the compile response:
 *  - Why the top-ranked beat the lowest-ranked included decision
 *  - Why the last included beat the first excluded decision
 *
 * @param includedDecisions - Decisions that made the cut (sorted descending)
 * @param excludedDecisions - Decisions below the threshold (sorted descending)
 */
export function generateBoundaryExplanations(
  includedDecisions: ScoredDecision[],
  excludedDecisions: ScoredDecision[],
): ContrastiveExplanation[] {
  const explanations: ContrastiveExplanation[] = [];

  // Why #1 beat the lowest included
  if (includedDecisions.length >= 2) {
    explanations.push(
      generateContrastiveExplanation(
        includedDecisions[0],
        includedDecisions[includedDecisions.length - 1],
      ),
    );
  }

  // Why the last included beat the first excluded
  if (includedDecisions.length >= 1 && excludedDecisions.length >= 1) {
    explanations.push(
      generateContrastiveExplanation(
        includedDecisions[includedDecisions.length - 1],
        excludedDecisions[0],
      ),
    );
  }

  return explanations;
}
