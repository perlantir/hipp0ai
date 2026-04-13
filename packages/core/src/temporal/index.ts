import { getDb } from '../db/index.js';
import { parseDecision } from '../db/parsers.js';
import type { Decision, FreshnessPreference } from '../types.js';
import { NotFoundError } from '../types.js';

/** Half-life in milliseconds for a validated decision (30 days). */
const HALF_LIFE_VALIDATED_MS = 30 * 24 * 60 * 60 * 1000;

/** Half-life in milliseconds for an unvalidated decision (7 days). */
const HALF_LIFE_UNVALIDATED_MS = 7 * 24 * 60 * 60 * 1000;

/** Days threshold before showing an unvalidated age warning. */
const UNVALIDATED_WARNING_DAYS = 14;

/** Days threshold before showing a stale validated-decision warning. */
const STALE_WARNING_DAYS = 60;

/** Days threshold before showing a superseded warning. */
const SUPERSEDED_WARNING_DAYS = 0; // Always warn for superseded

/**
 * Compute exponential-decay freshness score ∈ [0, 1].
 *
 * Half-life is 30 days for validated decisions, 7 days for unvalidated.
 * The reference point is validated_at if present, otherwise created_at.
 */
export function computeFreshness(decision: Decision, now?: Date): number {
  const nowMs = (now ?? new Date()).getTime();
  const referenceMs = decision.validated_at
    ? new Date(decision.validated_at).getTime()
    : new Date(decision.created_at).getTime();

  const elapsedMs = Math.max(0, nowMs - referenceMs);
  const halfLife = decision.validated_at ? HALF_LIFE_VALIDATED_MS : HALF_LIFE_UNVALIDATED_MS;

  // f(t) = 2^(-t / half_life)
  return Math.pow(2, -elapsedMs / halfLife);
}

/**
 * Apply confidence_decay_rate to the nominal confidence score.
 *
 * effectiveConfidence = nominalScore * e^(-decay_rate * age_in_days)
 * Result is clamped to [0, 1].
 */
export function computeEffectiveConfidence(decision: Decision, now?: Date): number {
  const nominalScore = confidenceToScore(decision.confidence);

  if (decision.confidence_decay_rate <= 0) {
    return nominalScore;
  }

  const nowMs = (now ?? new Date()).getTime();
  const createdMs = new Date(decision.created_at).getTime();
  const ageInDays = Math.max(0, (nowMs - createdMs) / (24 * 60 * 60 * 1000));

  const decayed = nominalScore * Math.exp(-decision.confidence_decay_rate * ageInDays);
  return Math.max(0, Math.min(1, decayed));
}

/**
 * Convert a confidence level label to a numeric score.
 *
 * high   → 1.0
 * medium → 0.7
 * low    → 0.4
 */
export function confidenceToScore(confidence: 'high' | 'medium' | 'low'): number {
  switch (confidence) {
    case 'high':
      return 1.0;
    case 'medium':
      return 0.7;
    case 'low':
      return 0.4;
  }
}

/**
 * Return an array of human-readable warning strings for a decision's temporal state.
 *
 * Examples:
 *   "⚠️ UNVALIDATED (38 days old)"
 *   "⚠️ STALE (65 days since validation)"
 *   "⚠️ SUPERSEDED"
 *   "⚠️ LOW CONFIDENCE (0.12)"
 */
export function getTemporalFlags(decision: Decision, now?: Date): string[] {
  const flags: string[] = [];
  const nowMs = (now ?? new Date()).getTime();

  const ageMs = nowMs - new Date(decision.created_at).getTime();
  const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));

  if (decision.status === 'superseded') {
    flags.push('⚠️ SUPERSEDED');
    return flags; // No point piling on more warnings
  }

  if (decision.status === 'reverted') {
    flags.push('⚠️ REVERTED');
    return flags;
  }

  if (decision.status === 'pending') {
    flags.push('ℹ️ PENDING');
  }

  if (!decision.validated_at && ageDays >= UNVALIDATED_WARNING_DAYS) {
    flags.push(`⚠️ UNVALIDATED (${ageDays} days old)`);
  }

  if (decision.validated_at) {
    const validatedMs = new Date(decision.validated_at).getTime();
    const daysSinceValidation = Math.floor((nowMs - validatedMs) / (24 * 60 * 60 * 1000));
    if (daysSinceValidation >= STALE_WARNING_DAYS) {
      flags.push(`⚠️ STALE (${daysSinceValidation} days since validation)`);
    }
  }

  // Low effective confidence warning (below 0.25 after decay)
  const effectiveConf = computeEffectiveConfidence(decision, now);
  if (effectiveConf < 0.25) {
    flags.push(`⚠️ LOW CONFIDENCE (${effectiveConf.toFixed(2)})`);
  }

  if (decision.open_questions.length > 0) {
    flags.push(`ℹ️ ${decision.open_questions.length} OPEN QUESTION(S)`);
  }

  return flags;
}

/**
 * Mark a decision as validated in the database.
 *
 * Sets validated_at = NOW() and validation_source = source.
 */
export async function validateDecision(decisionId: string, source: string): Promise<Decision> {
  const db = getDb();
  const result = await db.query<Record<string, unknown>>(
    `UPDATE decisions
     SET validated_at = ${db.dialect === 'sqlite' ? "datetime('now')" : 'NOW()'},
         validation_source = ?,
         updated_at = ${db.dialect === 'sqlite' ? "datetime('now')" : 'NOW()'}
     WHERE id = ?
     RETURNING *`,
    [source, decisionId],
  );

  if (result.rowCount === 0 || result.rows.length === 0) {
    throw new NotFoundError('Decision', decisionId);
  }

  return parseDecision(result.rows[0]);
}

/**
 * Blend a relevance score and freshness score into a combined score
 * according to the agent's freshness preference.
 *
 * recent_first:    55% relevance / 45% freshness
 * validated_first: 85% relevance / 15% freshness
 * balanced:        70% relevance / 30% freshness
 */
export function blendScores(
  relevance: number,
  freshness: number,
  preference: FreshnessPreference,
): number {
  switch (preference) {
    case 'recent_first':
      return 0.55 * relevance + 0.45 * freshness;
    case 'validated_first':
      return 0.85 * relevance + 0.15 * freshness;
    case 'balanced':
      return 0.7 * relevance + 0.3 * freshness;
  }
}
