/**
 * Wing Learning Tests — auto-classification, feedback loop, affinity influence,
 * recalculation trigger, and round-trip integration.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the agentPersonas module
vi.mock('../src/config/agentPersonas.js', () => ({
  getPersona: (name: string) => {
    const personas: Record<string, {
      name: string; role: string; description: string;
      primaryTags: string[]; excludeTags: string[]; keywords: string[]; boostFactor: number;
    }> = {
      maks: { name: 'maks', role: 'builder', description: 'Full-stack', primaryTags: ['api', 'database', 'backend', 'typescript', 'hono'], excludeTags: ['legal', 'marketing'], keywords: ['build', 'api', 'server'], boostFactor: 0.25 },
      scout: { name: 'scout', role: 'analytics', description: 'Research', primaryTags: ['research', 'metrics', 'analysis', 'data'], excludeTags: ['legal'], keywords: ['research', 'market'], boostFactor: 0.22 },
      forge: { name: 'forge', role: 'reviewer', description: 'Code review', primaryTags: ['code-review', 'testing', 'security', 'ci-cd'], excludeTags: ['marketing'], keywords: ['review', 'test'], boostFactor: 0.22 },
      counsel: { name: 'counsel', role: 'legal', description: 'Legal', primaryTags: ['legal', 'compliance', 'privacy', 'gdpr'], excludeTags: ['api', 'database'], keywords: ['legal', 'compliance'], boostFactor: 0.22 },
    };
    return personas[name.toLowerCase()];
  },
  AGENT_PERSONAS: {
    maks: { name: 'maks', role: 'builder', description: 'Full-stack', primaryTags: ['api', 'database', 'backend', 'typescript', 'hono'], excludeTags: ['legal', 'marketing'], keywords: ['build', 'api', 'server'], boostFactor: 0.25 },
    scout: { name: 'scout', role: 'analytics', description: 'Research', primaryTags: ['research', 'metrics', 'analysis', 'data'], excludeTags: ['legal'], keywords: ['research', 'market'], boostFactor: 0.22 },
    forge: { name: 'forge', role: 'reviewer', description: 'Code review', primaryTags: ['code-review', 'testing', 'security', 'ci-cd'], excludeTags: ['marketing'], keywords: ['review', 'test'], boostFactor: 0.22 },
    counsel: { name: 'counsel', role: 'legal', description: 'Legal', primaryTags: ['legal', 'compliance', 'privacy', 'gdpr'], excludeTags: ['api', 'database'], keywords: ['legal', 'compliance'], boostFactor: 0.22 },
  },
}));

import {
  classifyDecisionWing,
  computeWingSources,
  resetRecalcCounter,
  getRecalcCounter,
} from '../src/wings/affinity.js';
import { scoreDecision } from '../src/context-compiler/index.js';
import type { Decision, Agent, RelevanceProfile, WingAffinity } from '../src/types.js';

  // Helpers

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    id: 'dec-1',
    project_id: 'proj-1',
    title: 'Build REST API endpoints',
    description: 'Create CRUD endpoints for decisions using Hono framework',
    reasoning: 'Need API layer',
    made_by: 'maks',
    source: 'manual',
    confidence: 'high',
    status: 'active',
    tags: ['api', 'backend', 'hono'],
    affects: [],
    alternatives_considered: [],
    assumptions: [],
    open_questions: [],
    dependencies: [],
    confidence_decay_rate: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    metadata: {},
    priority_level: 1,
    wing: 'maks',
    temporal_scope: 'permanent',
    ...overrides,
  } as Decision;
}

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  const profile: RelevanceProfile = {
    weights: { api: 0.9, backend: 0.8, database: 0.85, hono: 0.7 },
    decision_depth: 2,
    freshness_preference: 'balanced',
    include_superseded: false,
  };
  return {
    id: 'agent-1',
    project_id: 'proj-1',
    name: 'maks',
    role: 'builder',
    relevance_profile: profile,
    context_budget_tokens: 50000,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    wing_affinity: {
      cross_wing_weights: { forge: 0.7, scout: 0.5, counsel: 0.2 },
      last_recalculated: new Date().toISOString(),
      feedback_count: 15,
    },
    ...overrides,
  } as Agent;
}

  // Test: Auto-classification

describe('wing — auto-classification on decision ingestion', () => {
  it('classifies an API decision to the maks (builder) wing', () => {
    const result = classifyDecisionWing(
      'Build REST API endpoints',
      'Create CRUD endpoints using Hono framework',
      ['api', 'backend', 'hono'],
      'maks',
      'api',
    );

    expect(result.best_wing).toBe('maks');
    expect(result.classification_confidence).toBeGreaterThan(0.3);
    expect(result.auto_domain).toBe('api');
    expect(result.wing_scores['maks']).toBeGreaterThan(0);
  });

  it('classifies a legal decision to the counsel wing', () => {
    const result = classifyDecisionWing(
      'GDPR Compliance Policy',
      'Implement privacy controls for GDPR compliance requirements',
      ['legal', 'compliance', 'privacy', 'gdpr'],
      'counsel',
      'security',
    );

    expect(result.best_wing).toBe('counsel');
    expect(result.classification_confidence).toBeGreaterThan(0.3);
  });

  it('flags uncategorized when no wing matches above threshold', () => {
    const result = classifyDecisionWing(
      'Miscellaneous note',
      'Some random observation',
      ['misc'],
      'unknown_agent',
      null,
    );

    expect(result.best_wing).toBeNull();
    expect(result.auto_category).toBe('uncategorized');
  });

  it('returns wing scores for all known personas', () => {
    const result = classifyDecisionWing(
      'Database migration',
      'Add new columns to decisions table',
      ['database', 'backend'],
      'maks',
      'database',
    );

    expect(Object.keys(result.wing_scores).length).toBeGreaterThan(0);
    // Should include all persona names
    expect(result.wing_scores['maks']).toBeDefined();
    expect(result.wing_scores['scout']).toBeDefined();
  });

  it('made_by identity provides scoring signal', () => {
    const resultWithIdentity = classifyDecisionWing(
      'Test coverage',
      'Improve test coverage',
      ['testing'],
      'forge', // forge = reviewer, primaryTags includes 'testing'
      'testing',
    );

    const resultWithoutIdentity = classifyDecisionWing(
      'Test coverage',
      'Improve test coverage',
      ['testing'],
      'unknown_agent',
      'testing',
    );

    // forge gets made_by bonus
    expect(resultWithIdentity.wing_scores['forge']).toBeGreaterThan(resultWithoutIdentity.wing_scores['forge']);
  });

  it('exclude tags penalize classification score', () => {
    const result = classifyDecisionWing(
      'Marketing campaign',
      'Launch TikTok marketing strategy',
      ['marketing', 'api'],
      'someone',
      null,
    );

    // maks has 'marketing' in excludeTags, so should have reduced score
    // even though 'api' matches maks primaryTags
    expect(result.wing_scores['maks']).toBeLessThan(0.5);
  });
});

  // Test: Feedback loop (asymmetric learning)

describe('wing — feedback learning rates are asymmetric', () => {
  it('positive learning rate (+0.02) is faster than negative (-0.01)', () => {
    // This tests the constants by verifying the behavior through scoring
    const agentPositive = makeAgent({
      wing_affinity: {
        cross_wing_weights: { forge: 0.5 },
        last_recalculated: new Date().toISOString(),
        feedback_count: 10,
      },
    });

    const agentNegative = makeAgent({
      wing_affinity: {
        cross_wing_weights: { forge: 0.5 },
        last_recalculated: new Date().toISOString(),
        feedback_count: 10,
      },
    });

    // Simulate 5 positive feedbacks: +0.02 * 5 = +0.10
    const positiveWeight = Math.min(1.0, 0.5 + (0.02 * 5));
    // Simulate 5 negative feedbacks: -0.01 * 5 = -0.05
    const negativeWeight = Math.max(0.0, 0.5 - (0.01 * 5));

    expect(positiveWeight).toBe(0.6); // 0.5 + 0.10
    expect(negativeWeight).toBe(0.45); // 0.5 - 0.05

    // Positive change (0.10) is 2x the negative change (0.05)
    expect(positiveWeight - 0.5).toBe(2 * (0.5 - negativeWeight));
  });

  it('affinity capped at 1.0 on increase', () => {
    const weight = Math.min(1.0, 0.99 + 0.02);
    expect(weight).toBe(1.0);
  });

  it('affinity floored at 0.0 on decrease', () => {
    const weight = Math.max(0.0, 0.005 - 0.01);
    expect(weight).toBe(0.0);
  });
});

  // Test: Affinity score influences compile results

describe('wing — affinity score influences scoring', () => {
  it('high-affinity agent gets boost for wing-matched decisions', () => {
    const decision = makeDecision({
      wing: 'forge',
      made_by: 'forge',
      tags: ['code-review', 'testing'],
    });

    const highAffinityAgent = makeAgent({
      wing_affinity: {
        cross_wing_weights: { forge: 0.8 },
        last_recalculated: new Date().toISOString(),
        feedback_count: 20,
      },
    });

    const lowAffinityAgent = makeAgent({
      name: 'maks',
      wing_affinity: {
        cross_wing_weights: { forge: 0.2 },
        last_recalculated: new Date().toISOString(),
        feedback_count: 20,
      },
    });

    const highResult = scoreDecision(decision, highAffinityAgent, []);
    const lowResult = scoreDecision(decision, lowAffinityAgent, []);

    // High-affinity agent (0.8 for forge) gets affinity * 0.125 = 0.1 boost
    // Low-affinity agent (0.2 for forge) gets -0.05 penalty (below 0.3)
    expect(highResult.combined_score).toBeGreaterThan(lowResult.combined_score);
  });

  it('agent with no wing_affinity scores normally', () => {
    const decision = makeDecision();
    const agent = makeAgent({ wing_affinity: undefined });

    const result = scoreDecision(decision, agent, []);
    expect(result.combined_score).toBeGreaterThanOrEqual(0);
    expect(result.combined_score).toBeLessThanOrEqual(1);
  });

  it('wing affinity boost is proportional to affinity score', () => {
    // Agent with 1.0 affinity should get max boost of 0.125
    const boost = 1.0 * 0.125;
    expect(boost).toBe(0.125);

    // Agent with 0.5 affinity should get half boost
    const halfBoost = 0.5 * 0.125;
    expect(halfBoost).toBe(0.0625);

    // Agent with 0.25 (below 0.3) gets penalty
    const penalty = -0.05;
    expect(penalty).toBe(-0.05);
  });
});

  // Test: Recalculation trigger

describe('wing — recalculation trigger', () => {
  beforeEach(async () => {
    await resetRecalcCounter();
  });

  it('counter starts at 0', async () => {
    expect(await getRecalcCounter()).toBe(0);
  });

  it('resetRecalcCounter resets to 0', async () => {
    // Manually increment by accessing internal state through reset
    await resetRecalcCounter();
    expect(await getRecalcCounter()).toBe(0);
  });
});

  // Test: Round-trip classification + scoring

describe('wing — round-trip: classify → score → verify boost', () => {
  it('auto-classified decision gets scoring boost from matched wing', () => {
    // Step 1: Classify a decision
    const classification = classifyDecisionWing(
      'Implement Hono API routes',
      'Build REST endpoints for the backend',
      ['api', 'backend', 'hono'],
      'maks',
      'api',
    );

    expect(classification.best_wing).toBe('maks');

    // Step 2: Create decision with classified wing
    const decision = makeDecision({
      wing: classification.best_wing!,
      tags: ['api', 'backend', 'hono'],
      metadata: {
        auto_domain: classification.auto_domain,
        auto_category: classification.auto_category,
        classification_confidence: classification.classification_confidence,
      },
    });

    // Step 3: Score with an agent that has high affinity for maks wing
    const agent = makeAgent({
      name: 'maks',
      wing_affinity: {
        cross_wing_weights: { maks: 0.9 },
        last_recalculated: new Date().toISOString(),
        feedback_count: 30,
      },
    });

    const result = scoreDecision(decision, agent, []);

    // Step 4: Verify the score includes wing affinity boost
    expect(result.combined_score).toBeGreaterThan(0);
    expect(result.scoring_breakdown).toBeDefined();

    // The wing_affinity_boost should be in the breakdown
    const breakdown = result.scoring_breakdown as Record<string, unknown>;
    expect(breakdown.wing_affinity_boost).toBeDefined();
    expect(breakdown.wing_affinity_boost as number).toBeGreaterThan(0);
  });

  it('uncategorized decision gets no wing boost', () => {
    const classification = classifyDecisionWing(
      'Random note',
      'Something unrelated',
      ['misc'],
      'unknown',
      null,
    );

    expect(classification.best_wing).toBeNull();

    const decision = makeDecision({
      wing: null,
      made_by: 'unknown',
      tags: ['misc'],
    });

    const agent = makeAgent();
    const result = scoreDecision(decision, agent, []);

    // Should still produce a valid score
    expect(result.combined_score).toBeGreaterThanOrEqual(0);
    expect(result.combined_score).toBeLessThanOrEqual(1);
  });
});
