// Temporal Engine Unit Tests
// These tests require no DB — all tested functions are pure
// or accept a `now` parameter for deterministic behavior.

import { describe, it, expect } from 'vitest';
import {
  computeFreshness,
  computeEffectiveConfidence,
  confidenceToScore,
  getTemporalFlags,
  blendScores,
} from '../src/temporal/index.js';
import type { Decision } from '../src/types.js';

  // Helpers

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  const now = new Date().toISOString();
  return {
    id: 'dec-jwt-auth',
    project_id: 'proj-auth-service',
    title: 'Use JWT for API authentication',
    description: 'Stateless token-based auth for horizontal scaling',
    reasoning: 'Eliminates server-side session storage; tokens are self-contained',
    made_by: 'alice-architect',
    source: 'manual',
    confidence: 'high',
    status: 'active',
    alternatives_considered: [],
    affects: [],
    tags: [],
    assumptions: [],
    open_questions: [],
    dependencies: [],
    confidence_decay_rate: 0,
    created_at: now,
    updated_at: now,
    metadata: {},
    ...overrides,
  };
}

/** Return an ISO string that is `days` days in the past from `now`. */
function daysAgo(days: number, from: Date = new Date()): string {
  return new Date(from.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

  // computeFreshness

describe('computeFreshness', () => {
  it('returns ~1.0 for a decision created right now (unvalidated)', () => {
    const now = new Date();
    const decision = makeDecision({ created_at: now.toISOString() });
    const score = computeFreshness(decision, now);
    expect(score).toBeCloseTo(1.0, 4);
  });

  it('returns ~0.5 for a 7-day-old unvalidated decision (half-life = 7d)', () => {
    const now = new Date('2026-01-08T00:00:00Z');
    const decision = makeDecision({
      created_at: new Date('2026-01-01T00:00:00Z').toISOString(),
      // No validated_at → half-life is 7 days
    });
    const score = computeFreshness(decision, now);
    // 2^(-7/7) = 0.5
    expect(score).toBeCloseTo(0.5, 4);
  });

  it('returns ~0.5 for a 30-day-old validated decision (half-life = 30d)', () => {
    const now = new Date('2026-02-01T00:00:00Z');
    const validatedAt = new Date('2026-01-02T00:00:00Z').toISOString(); // 30 days ago
    const decision = makeDecision({
      created_at: new Date('2025-12-01T00:00:00Z').toISOString(),
      validated_at: validatedAt,
    });
    const score = computeFreshness(decision, now);
    // reference point is validated_at, 30 days elapsed → 2^(-30/30) = 0.5
    expect(score).toBeCloseTo(0.5, 4);
  });

  it('returns very low score for 30-day-old unvalidated decision', () => {
    const now = new Date('2026-02-01T00:00:00Z');
    const decision = makeDecision({
      created_at: new Date('2026-01-02T00:00:00Z').toISOString(), // 30 days ago
      // unvalidated → half-life is 7 days
    });
    const score = computeFreshness(decision, now);
    // 2^(-30/7) ≈ 0.0466
    expect(score).toBeCloseTo(Math.pow(2, -30 / 7), 4);
    expect(score).toBeLessThan(0.1);
  });

  it('uses validated_at as reference point when present', () => {
    const now = new Date('2026-03-01T00:00:00Z');
    const createdAt = new Date('2026-01-01T00:00:00Z').toISOString(); // 59 days ago
    const validatedAt = new Date('2026-02-22T00:00:00Z').toISOString(); // 7 days ago

    const validatedDecision = makeDecision({ created_at: createdAt, validated_at: validatedAt });
    const unvalidatedDecision = makeDecision({ created_at: createdAt });

    const validatedScore = computeFreshness(validatedDecision, now);
    const unvalidatedScore = computeFreshness(unvalidatedDecision, now);

    // Validated decision uses validated_at (7 days ago, half-life 30d) → higher than
    // unvalidated (59 days ago, half-life 7d).
    expect(validatedScore).toBeGreaterThan(unvalidatedScore);
  });

  it('never returns a negative score', () => {
    // Simulating a decision with created_at in the future (edge case)
    const now = new Date('2020-01-01T00:00:00Z');
    const decision = makeDecision({ created_at: new Date('2025-01-01T00:00:00Z').toISOString() });
    const score = computeFreshness(decision, now);
    // elapsed = max(0, ...) = 0 → 2^0 = 1
    expect(score).toBe(1.0);
  });
});

  // computeEffectiveConfidence

describe('computeEffectiveConfidence', () => {
  it('returns nominal score when decay_rate is 0 (no decay)', () => {
    const decision = makeDecision({ confidence: 'high', confidence_decay_rate: 0 });
    const score = computeEffectiveConfidence(decision);
    expect(score).toBe(1.0);
  });

  it('applies decay for positive decay_rate', () => {
    const now = new Date('2026-02-01T00:00:00Z');
    const decision = makeDecision({
      confidence: 'high',
      confidence_decay_rate: 0.05,
      created_at: new Date('2026-01-01T00:00:00Z').toISOString(), // 31 days ago
    });
    const score = computeEffectiveConfidence(decision, now);
    // effectiveConf = 1.0 * e^(-0.05 * 31) ≈ 0.213
    const expected = 1.0 * Math.exp(-0.05 * 31);
    expect(score).toBeCloseTo(expected, 4);
    expect(score).toBeLessThan(1.0);
  });

  it('returns 1.0 for medium confidence with no decay', () => {
    // medium → 0.7; decay_rate 0 → no change
    const decision = makeDecision({ confidence: 'medium', confidence_decay_rate: 0 });
    expect(computeEffectiveConfidence(decision)).toBe(0.7);
  });

  it('clamps result to [0, 1] for extreme decay rates', () => {
    const now = new Date();
    const decision = makeDecision({
      confidence: 'high',
      confidence_decay_rate: 100, // extreme decay
      created_at: daysAgo(365, now),
    });
    const score = computeEffectiveConfidence(decision, now);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
    expect(score).toBe(0); // effectively 0 after clamping
  });

  it('fresh decision with high decay rate is still close to nominal', () => {
    const now = new Date();
    const decision = makeDecision({
      confidence: 'high',
      confidence_decay_rate: 0.5,
      created_at: now.toISOString(), // created just now → age ≈ 0
    });
    const score = computeEffectiveConfidence(decision, now);
    expect(score).toBeCloseTo(1.0, 2);
  });
});

  // confidenceToScore

describe('confidenceToScore', () => {
  it('maps high → 1.0', () => {
    expect(confidenceToScore('high')).toBe(1.0);
  });

  it('maps medium → 0.7', () => {
    expect(confidenceToScore('medium')).toBe(0.7);
  });

  it('maps low → 0.4', () => {
    expect(confidenceToScore('low')).toBe(0.4);
  });
});

  // getTemporalFlags

describe('getTemporalFlags', () => {
  it('returns no flags for a fresh, active, validated decision', () => {
    const now = new Date('2026-02-01T00:00:00Z');
    const decision = makeDecision({
      status: 'active',
      created_at: now.toISOString(),
      validated_at: now.toISOString(),
      confidence_decay_rate: 0,
      open_questions: [],
    });
    const flags = getTemporalFlags(decision, now);
    expect(flags).toHaveLength(0);
  });

  it('flags old unvalidated decision (>= 14 days)', () => {
    const now = new Date('2026-02-15T00:00:00Z');
    const decision = makeDecision({
      status: 'active',
      created_at: new Date('2026-01-25T00:00:00Z').toISOString(), // 21 days ago
      confidence_decay_rate: 0,
    });
    const flags = getTemporalFlags(decision, now);
    const unvalidatedFlag = flags.find((f) => f.includes('UNVALIDATED'));
    expect(unvalidatedFlag).toBeDefined();
    expect(unvalidatedFlag).toContain('21 days old');
  });

  it('does not flag unvalidated decision younger than 14 days', () => {
    const now = new Date('2026-02-10T00:00:00Z');
    const decision = makeDecision({
      status: 'active',
      created_at: new Date('2026-02-01T00:00:00Z').toISOString(), // 9 days ago
    });
    const flags = getTemporalFlags(decision, now);
    expect(flags.find((f) => f.includes('UNVALIDATED'))).toBeUndefined();
  });

  it('flags superseded decision', () => {
    const decision = makeDecision({ status: 'superseded' });
    const flags = getTemporalFlags(decision);
    expect(flags).toContain('⚠️ SUPERSEDED');
  });

  it('returns only SUPERSEDED flag for superseded decision (no pile-on)', () => {
    const now = new Date();
    const decision = makeDecision({
      status: 'superseded',
      created_at: daysAgo(60, now),
      open_questions: ['Is this still relevant?'],
    });
    const flags = getTemporalFlags(decision, now);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toBe('⚠️ SUPERSEDED');
  });

  it('flags reverted decision', () => {
    const decision = makeDecision({ status: 'reverted' });
    const flags = getTemporalFlags(decision);
    expect(flags).toContain('⚠️ REVERTED');
  });

  it('flags pending decision', () => {
    const decision = makeDecision({ status: 'pending' });
    const flags = getTemporalFlags(decision);
    expect(flags.find((f) => f.includes('PENDING'))).toBeDefined();
  });

  it('flags open questions', () => {
    const decision = makeDecision({
      open_questions: ['Why is this?', 'How do we do that?'],
    });
    const flags = getTemporalFlags(decision);
    const oqFlag = flags.find((f) => f.includes('OPEN QUESTION'));
    expect(oqFlag).toBeDefined();
    expect(oqFlag).toContain('2');
  });

  it('does not flag open questions for fresh decision with none', () => {
    const decision = makeDecision({ open_questions: [] });
    const flags = getTemporalFlags(decision);
    expect(flags.find((f) => f.includes('OPEN QUESTION'))).toBeUndefined();
  });

  it('flags stale validated decision (>= 60 days since validation)', () => {
    const now = new Date('2026-04-01T00:00:00Z');
    const decision = makeDecision({
      status: 'active',
      created_at: new Date('2025-11-01T00:00:00Z').toISOString(),
      validated_at: new Date('2026-01-01T00:00:00Z').toISOString(), // 90 days ago
      confidence_decay_rate: 0,
    });
    const flags = getTemporalFlags(decision, now);
    const staleFlag = flags.find((f) => f.includes('STALE'));
    expect(staleFlag).toBeDefined();
    expect(staleFlag).toContain('90 days since validation');
  });

  it('flags low effective confidence', () => {
    const now = new Date('2026-04-01T00:00:00Z');
    const decision = makeDecision({
      status: 'active',
      confidence: 'low',
      confidence_decay_rate: 0.2,
      created_at: new Date('2025-11-01T00:00:00Z').toISOString(), // ~150 days ago
    });
    // effectiveConf = 0.4 * e^(-0.2 * 150) → essentially 0 → below 0.25 threshold
    const flags = getTemporalFlags(decision, now);
    const confFlag = flags.find((f) => f.includes('LOW CONFIDENCE'));
    expect(confFlag).toBeDefined();
  });
});

  // blendScores

describe('blendScores', () => {
  it('recent_first: 55% relevance + 45% freshness', () => {
    const result = blendScores(0.8, 0.6, 'recent_first');
    expect(result).toBeCloseTo(0.55 * 0.8 + 0.45 * 0.6, 6);
    expect(result).toBeCloseTo(0.71, 2);
  });

  it('validated_first: 85% relevance + 15% freshness', () => {
    const result = blendScores(0.8, 0.6, 'validated_first');
    expect(result).toBeCloseTo(0.85 * 0.8 + 0.15 * 0.6, 6);
    expect(result).toBeCloseTo(0.77, 2);
  });

  it('balanced: 70% relevance + 30% freshness', () => {
    const result = blendScores(0.8, 0.6, 'balanced');
    expect(result).toBeCloseTo(0.7 * 0.8 + 0.3 * 0.6, 6);
    expect(result).toBeCloseTo(0.74, 2);
  });

  it('recent_first weights freshness more heavily than validated_first', () => {
    const relevance = 0.5;
    const freshness = 1.0;
    const recentFirst = blendScores(relevance, freshness, 'recent_first');
    const validatedFirst = blendScores(relevance, freshness, 'validated_first');
    // High freshness should produce higher score under recent_first
    expect(recentFirst).toBeGreaterThan(validatedFirst);
  });

  it('with equal relevance and freshness all modes return the same result', () => {
    const score = 0.7;
    const r = blendScores(score, score, 'recent_first');
    const v = blendScores(score, score, 'validated_first');
    const b = blendScores(score, score, 'balanced');
    // All modes collapse to same value when relevance === freshness
    expect(r).toBeCloseTo(score, 6);
    expect(v).toBeCloseTo(score, 6);
    expect(b).toBeCloseTo(score, 6);
  });
});
