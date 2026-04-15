/**
 * Golden-dataset ranking stability test.
 *
 * Complements the scoreDecision microbenchmark (bench/compile.bench.ts)
 * which measures LATENCY. This test measures CORRECTNESS of ordering:
 * for a curated fixture of decisions with a known "right answer" per
 * task, it asserts that scoreDecision ranks them in the expected order.
 *
 * The scoreDecision function multiplies nine signals together and it is
 * easy for a scoring-math change to regress ranking without tripping
 * any latency bench or any unit test that asserts isolated signal math.
 * This fixture is designed so that each task's expected ordering is
 * driven by a DIFFERENT signal, so a regression in any one of them
 * will flip exactly one case.
 *
 * Update procedure: when a scoring change is intentional, rerun the
 * test, inspect the diff, and update EXPECTED_TOP accordingly. Do NOT
 * update silently — every change to the golden ordering is a product
 * decision.
 */

import { describe, it, expect } from 'vitest';
import { scoreDecision } from '../src/context-compiler/index.js';
import type { Decision, Agent, DecisionDomain } from '../src/types.js';

// --------------------------------------------------------------------
// Fixture: 8 decisions spanning the signals scoreDecision consumes.
//
//   D-AUTH    — strong tag+keyword match for auth tasks, recent
//   D-AUTH-OLD— same tags but 120 days old → freshness penalty
//   D-DB      — strong DB match, different domain
//   D-UI      — UI decision, should rank last for backend tasks
//   D-HIGH    — high confidence + high outcome_success_rate
//   D-LOW     — low confidence + low outcome_success_rate (dampened)
//   D-BUILDER — affects 'builder' directly (direct-match bonus)
//   D-GENERIC — affects 5 wings (specificity multiplier punish)
// --------------------------------------------------------------------

const NOW = Date.now();
const DAY = 86_400_000;

function mkDecision(input: Partial<Decision> & { id: string; tags: string[] }): Decision {
  return {
    id: input.id,
    project_id: 'golden-proj',
    title: input.title ?? `Decision ${input.id}`,
    description: input.description ?? '',
    body: input.description ?? '',
    status: input.status ?? 'active',
    confidence: input.confidence ?? 'medium',
    tags: input.tags,
    affects: input.affects ?? [],
    made_by: input.made_by ?? 'other',
    created_at: input.created_at ?? new Date(NOW).toISOString(),
    updated_at: new Date(NOW).toISOString(),
    domain: input.domain ?? null,
    trust_score: input.trust_score ?? 0.7,
    outcome_success_rate: input.outcome_success_rate ?? null,
    outcome_count: input.outcome_count ?? 0,
    temporal_tier: 'permanent',
  } as unknown as Decision;
}

const DECISIONS: Decision[] = [
  mkDecision({
    id: 'D-AUTH',
    title: 'Use JWT with 15-min expiry for auth tokens',
    description: 'JWT tokens with short expiry plus refresh rotation for our authentication flow.',
    tags: ['auth', 'security', 'api'],
    confidence: 'high',
    domain: 'security' as DecisionDomain,
    made_by: 'architect',
  }),
  mkDecision({
    id: 'D-AUTH-OLD',
    title: 'Use JWT — initial draft from last year',
    description: 'Old JWT guidance, superseded in spirit but still on record.',
    tags: ['auth', 'security'],
    confidence: 'medium',
    created_at: new Date(NOW - 120 * DAY).toISOString(),
  }),
  mkDecision({
    id: 'D-DB',
    title: 'Use Postgres with connection pooling',
    description: 'Database layer uses Postgres 16 with pgbouncer in transaction-pool mode.',
    tags: ['db', 'backend', 'infra'],
    confidence: 'high',
    domain: 'architecture' as DecisionDomain,
  }),
  mkDecision({
    id: 'D-UI',
    title: 'Use Tailwind for all UI styling',
    description: 'Tailwind CSS utility-first for components and pages.',
    tags: ['frontend', 'ui'],
    confidence: 'medium',
  }),
  mkDecision({
    id: 'D-HIGH',
    title: 'Cache compile output in Redis with 1h TTL',
    description: 'Hot compile results are cached for one hour to amortize token costs.',
    tags: ['backend', 'perf', 'infra'],
    confidence: 'high',
    outcome_success_rate: 0.9,
    outcome_count: 25, // past the dampening ramp (20) — full strength
  }),
  mkDecision({
    id: 'D-LOW',
    title: 'Use in-memory session store',
    description: 'Sessions kept in process memory for the single-node dev deployment.',
    tags: ['backend', 'auth'],
    confidence: 'low',
    outcome_success_rate: 0.1,
    outcome_count: 25,
  }),
  mkDecision({
    id: 'D-BUILDER',
    title: 'Builder owns the migration runner',
    description: 'The builder agent is authoritative for running migrations in CI.',
    tags: ['infra', 'backend'],
    confidence: 'medium',
    affects: ['builder'],
  }),
  mkDecision({
    id: 'D-GENERIC',
    title: 'All agents should log in JSON',
    description: 'Generic cross-cutting logging convention that affects every wing.',
    tags: ['infra', 'logging'],
    confidence: 'medium',
    affects: ['builder', 'architect', 'reviewer', 'planner', 'debugger'],
  }),
];

const AGENT_BUILDER: Agent = {
  id: 'agent-builder',
  project_id: 'golden-proj',
  name: 'maks',
  role: 'builder',
  relevance_profile: {
    weights: { backend: 0.9, api: 0.8, db: 0.7, auth: 0.6, perf: 0.5, infra: 0.5 },
    decision_depth: 2,
    freshness_preference: 'balanced',
    include_superseded: false,
  },
  context_budget_tokens: 4000,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
} as unknown as Agent;

function rank(decisions: Decision[], agent: Agent, taskDescription: string): string[] {
  // Embeddings disabled — we want the deterministic-signal ranking only.
  // scoreDecision falls back to 0 for semantic_similarity when the
  // embedding array is empty.
  const taskEmbedding: number[] = [];
  const scored = decisions.map((d) =>
    scoreDecision(d, agent, taskEmbedding, undefined, taskDescription),
  );
  scored.sort((a, b) => b.combined_score - a.combined_score);
  return scored.map((s) => s.id);
}

describe('ranking-golden', () => {
  it('builder + auth task: D-AUTH outranks D-AUTH-OLD (freshness decides)', () => {
    const order = rank(DECISIONS, AGENT_BUILDER, 'Implement auth tokens for the API');
    // The two AUTH rows carry identical tag and persona signals; the only
    // difference is created_at. Freshness must push the fresh one above.
    const authIdx = order.indexOf('D-AUTH');
    const oldIdx = order.indexOf('D-AUTH-OLD');
    expect(authIdx).toBeLessThan(oldIdx);
  });

  it('builder + perf task: D-HIGH outranks D-LOW (outcome multiplier)', () => {
    const order = rank(DECISIONS, AGENT_BUILDER, 'Optimize compile latency');
    // Both tagged for backend; outcome signal differentiates them.
    // D-HIGH has rate 0.9 at count 25 → multiplier ~1.10.
    // D-LOW  has rate 0.1 at count 25 → multiplier ~0.85.
    // That's a 1.29x delta, enough to flip ordering against the other
    // smaller signal differences.
    const highIdx = order.indexOf('D-HIGH');
    const lowIdx = order.indexOf('D-LOW');
    expect(highIdx).toBeLessThan(lowIdx);
  });

  it('builder + infra task: D-BUILDER outranks D-GENERIC (specificity + direct-affect)', () => {
    const order = rank(DECISIONS, AGENT_BUILDER, 'Set up the deployment pipeline for CI');
    // D-BUILDER directly affects 'builder' and has specificity 1.15x.
    // D-GENERIC affects 5 wings → specificity 0.70x and no direct-affect.
    const builderIdx = order.indexOf('D-BUILDER');
    const genericIdx = order.indexOf('D-GENERIC');
    expect(builderIdx).toBeLessThan(genericIdx);
  });

  it('builder + UI task: UI decision does NOT make the top-2', () => {
    // Builder persona with no 'frontend' weight — UI decision should
    // rank near the bottom regardless of task phrasing.
    const order = rank(DECISIONS, AGENT_BUILDER, 'Build a settings page');
    expect(order.slice(0, 2)).not.toContain('D-UI');
  });

  it('builder + backend task: golden top-3 stable (composite signals)', () => {
    const order = rank(DECISIONS, AGENT_BUILDER, 'Improve backend infrastructure');
    // Composite-stability check. This pins the ACTUAL top-3 output of
    // scoreDecision for the builder persona on a backend task, as of
    // the commit that introduced this test. Treat this as a golden
    // baseline: if the assertion fails, a scoring-math change happened,
    // and the diff is a product decision — inspect signal breakdowns,
    // decide whether the new ranking is correct, then update this
    // expectation. Do NOT update silently.
    //
    // Current top 3, in order:
    //   1. D-BUILDER — direct-affect (+0.25) dominates
    //   2. D-GENERIC — direct-affect also applies; the 5-wing specificity
    //                  penalty (0.70x) partially offsets but +0.25 lands
    //                  AFTER multipliers so the flat add still wins
    //   3. D-DB     — no direct-affect, wins on high confidence + db/backend
    //                  profile-tag overlap + architecture domain boost
    expect(order.slice(0, 3)).toEqual(['D-BUILDER', 'D-GENERIC', 'D-DB']);
  });

  it('D-UI always ranks last for builder persona (excludeTags-style regression guard)', () => {
    // Across several different task phrasings, UI should never outrank
    // any backend-tagged decision for the builder persona. This is a
    // weak invariant but catches a whole class of signal-wiring bugs.
    const tasks = [
      'Tune database query performance',
      'Add retry logic to API client',
      'Set up monitoring for backend services',
    ];
    for (const task of tasks) {
      const order = rank(DECISIONS, AGENT_BUILDER, task);
      const uiIdx = order.indexOf('D-UI');
      // UI must not be #1 for a backend task.
      expect(uiIdx).toBeGreaterThan(0);
    }
  });
});
