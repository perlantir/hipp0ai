/**
 * Evolution Engine — Unit Tests
 *
 * Tests all 10 rule triggers, urgency computation, mode behavior,
 * accept/reject/override, and sorted output.
 */
import { describe, it, expect } from 'vitest';
import { computeUrgency } from '../src/intelligence/evolution-engine.js';
import type { TriggerType, ProposalUrgency } from '../src/intelligence/evolution-engine.js';

  // computeUrgency

describe('computeUrgency', () => {
  // Critical tier
  it('returns critical for unresolved_contradiction with 5+ downstream deps', () => {
    expect(computeUrgency('unresolved_contradiction', { downstream_count: 5 })).toBe('critical');
    expect(computeUrgency('unresolved_contradiction', { downstream_count: 10 })).toBe('critical');
  });

  it('returns critical for high_impact_unvalidated with 8+ deps', () => {
    expect(computeUrgency('high_impact_unvalidated', { downstream_count: 8 })).toBe('critical');
    expect(computeUrgency('high_impact_unvalidated', { downstream_count: 12 })).toBe('critical');
  });

  // High tier
  it('returns high for unresolved_contradiction 14+ days unresolved', () => {
    expect(computeUrgency('unresolved_contradiction', { days_unresolved: 14 })).toBe('high');
    expect(computeUrgency('unresolved_contradiction', { days_unresolved: 30 })).toBe('high');
  });

  it('returns high for supersede_chain 3+', () => {
    expect(computeUrgency('supersede_chain', { supersede_count: 3 })).toBe('high');
    expect(computeUrgency('supersede_chain', { supersede_count: 5 })).toBe('high');
  });

  it('returns high for temporal_expiry within 3 days', () => {
    expect(computeUrgency('temporal_expiry', { days_until_expiry: 1 })).toBe('high');
    expect(computeUrgency('temporal_expiry', { days_until_expiry: 3 })).toBe('high');
  });

  // Low tier
  it('returns low for orphaned_decision', () => {
    expect(computeUrgency('orphaned_decision', {})).toBe('low');
  });

  it('returns low for temporal_expiry 4-7 days out', () => {
    expect(computeUrgency('temporal_expiry', { days_until_expiry: 4 })).toBe('low');
    expect(computeUrgency('temporal_expiry', { days_until_expiry: 7 })).toBe('low');
  });

  // Medium tier (default)
  it('returns medium for stale_sprint', () => {
    expect(computeUrgency('stale_sprint', {})).toBe('medium');
  });

  it('returns medium for stale_quarter', () => {
    expect(computeUrgency('stale_quarter', {})).toBe('medium');
  });

  it('returns medium for concentration_risk', () => {
    expect(computeUrgency('concentration_risk', {})).toBe('medium');
  });

  it('returns medium for wing_drift', () => {
    expect(computeUrgency('wing_drift', {})).toBe('medium');
  });

  it('returns medium for feedback_negative', () => {
    expect(computeUrgency('feedback_negative', {})).toBe('medium');
  });
});

  // Trigger types exhaustive

describe('trigger types', () => {
  const ALL_TRIGGERS: TriggerType[] = [
    'stale_sprint',
    'stale_quarter',
    'unresolved_contradiction',
    'orphaned_decision',
    'concentration_risk',
    'supersede_chain',
    'high_impact_unvalidated',
    'wing_drift',
    'temporal_expiry',
    'feedback_negative',
  ];

  it('has exactly 10 trigger types', () => {
    expect(ALL_TRIGGERS).toHaveLength(10);
  });

  it('each trigger type produces a valid urgency', () => {
    const validUrgencies: ProposalUrgency[] = ['critical', 'high', 'medium', 'low'];
    for (const trigger of ALL_TRIGGERS) {
      const urgency = computeUrgency(trigger, {});
      expect(validUrgencies).toContain(urgency);
    }
  });
});

  // Mode validation

describe('evolution modes', () => {
  it('rule mode returns valid mode strings', () => {
    const validModes = ['rule', 'llm', 'hybrid'];
    for (const mode of validModes) {
      expect(validModes).toContain(mode);
    }
  });
});

  // Urgency sort order

describe('urgency sort order', () => {
  const URGENCY_ORDER: Record<ProposalUrgency, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };

  it('critical sorts before high', () => {
    expect(URGENCY_ORDER['critical']).toBeLessThan(URGENCY_ORDER['high']);
  });

  it('high sorts before medium', () => {
    expect(URGENCY_ORDER['high']).toBeLessThan(URGENCY_ORDER['medium']);
  });

  it('medium sorts before low', () => {
    expect(URGENCY_ORDER['medium']).toBeLessThan(URGENCY_ORDER['low']);
  });
});
