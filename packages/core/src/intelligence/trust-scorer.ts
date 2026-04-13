import type { Decision, ProvenanceRecord, TrustComponents } from '../types.js';

// Trust multiplier bounds: 0.70 (lowest trust) to 1.15 (highest trust)
const TRUST_FLOOR = 0.70;
const TRUST_CEILING = 1.15;

// Source type weights — how trustworthy is the origin?
const SOURCE_WEIGHTS: Record<string, number> = {
  manual: 0.90,
  github_pr: 0.85,
  github_commit: 0.80,
  imported: 0.75,
  transcript: 0.70,
  connector: 0.65,
  auto_distilled: 0.55,
  auto_capture: 0.50,
  system_inferred: 0.45,
};

// Verification status weights
const VERIFICATION_WEIGHTS: Record<string, number> = {
  validated: 1.0,
  unverified: 0.6,
  pending_review: 0.5,
  disputed: 0.3,
};

// Confidence mapping
const CONFIDENCE_WEIGHTS: Record<string, number> = {
  high: 0.95,
  medium: 0.70,
  low: 0.45,
};

/**
 * Compute trust score for a decision based on its provenance,
 * validation state, confidence, and contradiction history.
 *
 * Trust is epistemic quality — "should we believe this is still true?"
 * Not the same as relevance — "is this useful for this agent's task?"
 *
 * Returns a trust score in [0, 1] and its component breakdown.
 */
export function computeTrust(
  decision: Decision,
  options?: { contradictionCount?: number },
): { trust_score: number; trust_components: TrustComponents } {
  const chain = decision.provenance_chain ?? [];
  const latestProvenance = chain.length > 0 ? chain[chain.length - 1] : null;

  // Component 1: Source weight (from provenance or decision.source)
  const sourceType = latestProvenance?.source_type ?? decision.source ?? 'manual';
  const source_weight = SOURCE_WEIGHTS[sourceType] ?? 0.60;

  // Component 2: Validation weight
  let validation_weight: number;
  if (decision.validated_at) {
    validation_weight = 1.0;
  } else if (latestProvenance?.verification_status) {
    validation_weight = VERIFICATION_WEIGHTS[latestProvenance.verification_status] ?? 0.5;
  } else {
    validation_weight = 0.5;
  }

  // Component 3: Recency weight (light influence)
  const ageMs = Date.now() - new Date(decision.created_at).getTime();
  const ageDays = ageMs / 86400000;
  const recency_weight =
    ageDays <= 7 ? 1.0 :
    ageDays <= 30 ? 0.90 :
    ageDays <= 90 ? 0.80 :
    ageDays <= 365 ? 0.70 :
    0.60;

  // Component 4: Contradiction penalty
  const contradictions = options?.contradictionCount ?? 0;
  const contradiction_penalty = Math.min(contradictions * 0.15, 0.50);

  // Component 5: Confidence weight
  const confidence_weight = CONFIDENCE_WEIGHTS[decision.confidence] ?? 0.60;

  const components: TrustComponents = {
    source_weight,
    validation_weight,
    recency_weight,
    contradiction_penalty,
    confidence_weight,
  };

  // Weighted combination
  const raw =
    0.25 * source_weight +
    0.30 * validation_weight +
    0.10 * recency_weight +
    0.20 * confidence_weight -
    contradiction_penalty;

  // Clamp to [0, 1]
  const trust_score = Math.max(0, Math.min(1, raw));

  return { trust_score, trust_components: components };
}

/**
 * Convert a trust score [0, 1] into a compile multiplier [TRUST_FLOOR, TRUST_CEILING].
 * Low-trust decisions lose up to 30% of relevance score.
 * High-trust decisions gain up to 15%.
 */
export function trustMultiplier(trustScore: number | null | undefined): number {
  if (trustScore == null) return 1.0; // no trust data = neutral
  const clamped = Math.max(0, Math.min(1, trustScore));
  return TRUST_FLOOR + clamped * (TRUST_CEILING - TRUST_FLOOR);
}

/**
 * Generate default provenance for a newly created decision.
 */
export function defaultProvenance(
  source: string,
  actorId?: string,
): ProvenanceRecord {
  let source_type: ProvenanceRecord['source_type'] = 'manual';
  let actor_type: ProvenanceRecord['actor_type'] = 'human';
  let method: ProvenanceRecord['method'] = 'direct_entry';
  let verification_status: ProvenanceRecord['verification_status'] = 'unverified';

  switch (source) {
    case 'auto_distilled':
      source_type = 'auto_distilled';
      actor_type = 'system';
      method = 'llm_extraction';
      verification_status = 'pending_review';
      break;
    case 'auto_capture':
      source_type = 'auto_capture';
      actor_type = 'system';
      method = 'capture_pipeline';
      verification_status = 'unverified';
      break;
    case 'imported':
      source_type = 'imported';
      actor_type = 'system';
      method = 'import_sync';
      verification_status = 'unverified';
      break;
    default:
      source_type = 'manual';
      actor_type = 'human';
      method = 'direct_entry';
      verification_status = 'unverified';
  }

  return {
    source_type,
    actor_type,
    actor_id: actorId,
    method,
    timestamp: new Date().toISOString(),
    verification_status,
  };
}

/**
 * Create a validation provenance record to append when a decision is reviewed/validated.
 */
export function validationProvenance(validatedBy: string): ProvenanceRecord {
  return {
    source_type: 'manual',
    actor_type: 'human',
    actor_id: validatedBy,
    method: 'review_approval',
    timestamp: new Date().toISOString(),
    verification_status: 'validated',
  };
}
