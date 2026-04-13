/**
 * Relevance Learner Tests
 *
 * Tests the weight evolution algorithm: signal computation, clamping,
 * minimum feedback thresholds, learning rate, and batch feedback.
 */

import { describe, it, expect } from 'vitest';
import {
  computeWeightUpdates,
  LEARNING_RATE,
  MIN_FEEDBACK_PER_TAG,
  RATING_SIGNALS,
} from '../src/relevance-learner/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build N feedback entries of a single rating for a tag. */
function makeFeedback(rating: string, count: number): Array<{ rating: string }> {
  return Array.from({ length: count }, () => ({ rating }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Relevance Learner — computeWeightUpdates', () => {
  it('positive adjustment for "useful" feedback', () => {
    const weights = { auth: 0.5 };
    const feedback = { auth: makeFeedback('useful', 10) };
    const updates = computeWeightUpdates(weights, feedback);

    expect(updates.length).toBe(1);
    expect(updates[0].tag).toBe('auth');
    expect(updates[0].adjustment).toBeGreaterThan(0);
    expect(updates[0].new_weight).toBeGreaterThan(0.5);
  });

  it('positive adjustment for "critical" feedback', () => {
    const weights = { scoring: 0.5 };
    const feedback = { scoring: makeFeedback('critical', 10) };
    const updates = computeWeightUpdates(weights, feedback);

    expect(updates.length).toBe(1);
    expect(updates[0].adjustment).toBeGreaterThan(0);
    // Critical has the highest signal (0.10), so adjustment should be larger than useful
    const usefulUpdates = computeWeightUpdates({ scoring: 0.5 }, { scoring: makeFeedback('useful', 10) });
    expect(updates[0].adjustment).toBeGreaterThan(usefulUpdates[0].adjustment);
  });

  it('negative adjustment for "irrelevant" feedback', () => {
    const weights = { docs: 0.7 };
    const feedback = { docs: makeFeedback('irrelevant', 10) };
    const updates = computeWeightUpdates(weights, feedback);

    expect(updates.length).toBe(1);
    expect(updates[0].adjustment).toBeLessThan(0);
    expect(updates[0].new_weight).toBeLessThan(0.7);
  });

  it('positive adjustment for "missing" feedback', () => {
    const weights = { testing: 0.3 };
    const feedback = { testing: makeFeedback('missing', 10) };
    const updates = computeWeightUpdates(weights, feedback);

    expect(updates.length).toBe(1);
    expect(updates[0].adjustment).toBeGreaterThan(0);
    expect(updates[0].new_weight).toBeGreaterThan(0.3);
  });

  it('weights clamped between 0.0 and 1.0', () => {
    // Weight at 0.99 with critical feedback should not exceed 1.0
    const weightsHigh = { infra: 0.99 };
    const feedbackHigh = { infra: makeFeedback('critical', 20) };
    const updatesHigh = computeWeightUpdates(weightsHigh, feedbackHigh);
    expect(updatesHigh[0].new_weight).toBeLessThanOrEqual(1.0);

    // Weight at 0.01 with irrelevant feedback should not go below 0.0
    const weightsLow = { infra: 0.01 };
    const feedbackLow = { infra: makeFeedback('irrelevant', 20) };
    const updatesLow = computeWeightUpdates(weightsLow, feedbackLow);
    expect(updatesLow[0].new_weight).toBeGreaterThanOrEqual(0.0);
  });

  it('no adjustment when fewer than MIN_FEEDBACK_PER_TAG entries', () => {
    const weights = { auth: 0.5 };
    // Only 3 entries — below the MIN_FEEDBACK_PER_TAG threshold (5)
    const feedback = { auth: makeFeedback('critical', 3) };
    const updates = computeWeightUpdates(weights, feedback);

    expect(updates.length).toBe(0);
  });

  it('learning rate 0.05 produces gradual changes (never > 0.1 per cycle)', () => {
    const weights = { api: 0.5 };
    // Even with all-critical feedback (max signal = 0.10), adjustment should be bounded
    const feedback = { api: makeFeedback('critical', 100) };
    const updates = computeWeightUpdates(weights, feedback);

    expect(updates.length).toBe(1);
    // Max adjustment = LEARNING_RATE * max_signal = 0.05 * 0.10 = 0.005
    expect(Math.abs(updates[0].adjustment)).toBeLessThanOrEqual(0.1);
    // Specifically, with all critical: adjustment = 0.05 * 0.10 = 0.005
    expect(updates[0].adjustment).toBeCloseTo(LEARNING_RATE * RATING_SIGNALS.critical, 4);
  });

  it('handles mixed feedback correctly', () => {
    const weights = { auth: 0.5 };
    // 7 useful + 3 irrelevant
    const feedback = {
      auth: [
        ...makeFeedback('useful', 7),
        ...makeFeedback('irrelevant', 3),
      ],
    };
    const updates = computeWeightUpdates(weights, feedback);

    expect(updates.length).toBe(1);
    // Average signal: (7 * 0.03 + 3 * -0.05) / 10 = (0.21 - 0.15) / 10 = 0.006
    // Adjustment: 0.05 * 0.006 = 0.0003 (positive but tiny)
    expect(updates[0].adjustment).toBeGreaterThan(0);
  });

  it('processes multiple tags independently', () => {
    const weights = { auth: 0.5, database: 0.5 };
    const feedback = {
      auth: makeFeedback('critical', 10),
      database: makeFeedback('irrelevant', 10),
    };
    const updates = computeWeightUpdates(weights, feedback);

    expect(updates.length).toBe(2);
    const authUpdate = updates.find((u) => u.tag === 'auth');
    const dbUpdate = updates.find((u) => u.tag === 'database');
    expect(authUpdate!.adjustment).toBeGreaterThan(0);
    expect(dbUpdate!.adjustment).toBeLessThan(0);
  });

  it('creates new weight for tags not yet in profile', () => {
    const weights = {}; // no existing weights
    const feedback = { newTag: makeFeedback('useful', 10) };
    const updates = computeWeightUpdates(weights, feedback);

    expect(updates.length).toBe(1);
    expect(updates[0].tag).toBe('newTag');
    // Default weight is 0.5 when not in profile
    expect(updates[0].current_weight).toBe(0.5);
    expect(updates[0].new_weight).toBeGreaterThan(0.5);
  });

  it('signal values match expected constants', () => {
    expect(RATING_SIGNALS.critical).toBe(0.10);
    expect(RATING_SIGNALS.useful).toBe(0.03);
    expect(RATING_SIGNALS.irrelevant).toBe(-0.05);
    expect(RATING_SIGNALS.missing).toBe(0.08);
  });

  it('learning rate is 0.05', () => {
    expect(LEARNING_RATE).toBe(0.05);
  });

  it('minimum feedback threshold is 5', () => {
    expect(MIN_FEEDBACK_PER_TAG).toBe(5);
  });
});
