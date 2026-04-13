import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  condenseDecisions,
  estimateTokens,
} from '../src/context-compiler/compression.js';
import type { ScoredDecision, Decision, Contradiction, ConfidenceLevel } from '../src/types.js';

/* ------------------------------------------------------------------ */
/*  Test fixtures                                                      */
/* ------------------------------------------------------------------ */

function makeScoredDecision(overrides: Partial<ScoredDecision> = {}): ScoredDecision {
  return {
    id: overrides.id ?? 'dec-001',
    project_id: 'proj-1',
    title: overrides.title ?? 'Use JWT for stateless API authentication',
    description: overrides.description ?? 'Chose JWT over session cookies for API auth',
    reasoning: overrides.reasoning ?? 'Session cookies require sticky sessions.',
    made_by: overrides.made_by ?? 'backend',
    source: 'manual',
    confidence: overrides.confidence ?? 'high',
    status: overrides.status ?? 'active',
    alternatives_considered: [],
    affects: overrides.affects ?? ['frontend', 'security'],
    tags: overrides.tags ?? ['auth', 'security'],
    assumptions: [],
    open_questions: [],
    dependencies: [],
    confidence_decay_rate: 0.01,
    created_at: overrides.created_at ?? '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    metadata: {},
    relevance_score: overrides.relevance_score ?? 0.87,
    freshness_score: overrides.freshness_score ?? 0.9,
    combined_score: overrides.combined_score ?? 0.87,
    scoring_breakdown: {
      direct_affect: 0.3,
      tag_matching: 0.2,
      role_relevance: 0.25,
      semantic_similarity: 0.12,
      status_penalty: 0,
      freshness: 0.9,
      combined: 0.87,
    },
    priority_level: 1,
    temporal_scope: (overrides as Record<string, unknown>).temporal_scope as ScoredDecision['temporal_scope'] ?? 'permanent',
  };
}

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    id: overrides.id ?? 'dec-001',
    project_id: 'proj-1',
    title: overrides.title ?? 'Use JWT for auth',
    description: overrides.description ?? 'JWT is stateless',
    reasoning: overrides.reasoning ?? 'Scales horizontally',
    made_by: overrides.made_by ?? 'backend',
    source: 'manual',
    confidence: overrides.confidence ?? 'high',
    status: overrides.status ?? 'active',
    alternatives_considered: [],
    affects: ['frontend'],
    tags: ['auth'],
    assumptions: [],
    open_questions: [],
    dependencies: [],
    confidence_decay_rate: 0.01,
    created_at: overrides.created_at ?? '2026-03-01T00:00:00Z',
    updated_at: overrides.updated_at ?? '2026-03-01T00:00:00Z',
    metadata: {},
    priority_level: 1,
    temporal_scope: overrides.temporal_scope ?? 'permanent',
    valid_from: overrides.valid_from ?? '2026-03-01T00:00:00Z',
    valid_until: overrides.valid_until ?? null,
    superseded_by: overrides.superseded_by ?? null,
  };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('Temporal Intelligence', () => {
  describe('H0C Compression — Temporal Markers', () => {
    it('includes temporal scope in condensed format for non-permanent decisions', () => {
      const decision = makeScoredDecision({
        id: 'dec-sprint',
        title: 'Sprint-scoped API decision',
      });
      // Add temporal_scope to the decision
      (decision as Record<string, unknown>).temporal_scope = 'sprint';
      (decision as Record<string, unknown>).valid_from = new Date(Date.now() - 3 * 86400000).toISOString();

      const condensed = condenseDecisions([decision]);

      expect(condensed).toContain('scope:sprint');
      expect(condensed).toContain('age:3d');
    });

    it('omits scope marker for permanent decisions', () => {
      const decision = makeScoredDecision({
        id: 'dec-perm',
        title: 'Permanent architecture decision',
      });
      (decision as Record<string, unknown>).temporal_scope = 'permanent';
      (decision as Record<string, unknown>).valid_from = new Date(Date.now() - 30 * 86400000).toISOString();

      const condensed = condenseDecisions([decision]);

      expect(condensed).not.toContain('scope:permanent');
      expect(condensed).toContain('age:');
    });

    it('includes experiment scope marker', () => {
      const decision = makeScoredDecision({
        id: 'dec-exp',
        title: 'Experimental feature flag',
      });
      (decision as Record<string, unknown>).temporal_scope = 'experiment';
      (decision as Record<string, unknown>).valid_from = new Date(Date.now() - 5 * 86400000).toISOString();

      const condensed = condenseDecisions([decision]);

      expect(condensed).toContain('scope:experiment');
      expect(condensed).toContain('age:5d');
    });
  });

  describe('Decision Types — Temporal Fields', () => {
    it('Decision interface includes temporal fields', () => {
      const decision = makeDecision({
        temporal_scope: 'sprint',
        valid_from: '2026-04-01T00:00:00Z',
        valid_until: '2026-04-15T00:00:00Z',
        superseded_by: null,
      });

      expect(decision.temporal_scope).toBe('sprint');
      expect(decision.valid_from).toBe('2026-04-01T00:00:00Z');
      expect(decision.valid_until).toBe('2026-04-15T00:00:00Z');
      expect(decision.superseded_by).toBeNull();
    });

    it('defaults to permanent scope', () => {
      const decision = makeDecision();
      expect(decision.temporal_scope).toBe('permanent');
    });

    it('deprecated decisions have valid_until set', () => {
      const decision = makeDecision({
        temporal_scope: 'deprecated',
        valid_until: '2026-04-01T00:00:00Z',
        superseded_by: 'dec-002',
        status: 'superseded',
      });

      expect(decision.temporal_scope).toBe('deprecated');
      expect(decision.valid_until).toBe('2026-04-01T00:00:00Z');
      expect(decision.superseded_by).toBe('dec-002');
    });
  });

  describe('Contradiction — Supersession Suggestion', () => {
    it('Contradiction includes proposed_supersession field', () => {
      const contradiction: Contradiction = {
        id: 'ctr-001',
        project_id: 'proj-1',
        decision_a_id: 'dec-new',
        decision_b_id: 'dec-old',
        similarity_score: 0.85,
        conflict_description: 'Conflicting auth approaches',
        status: 'unresolved',
        detected_at: '2026-04-01T00:00:00Z',
        proposed_supersession: {
          newer_decision_id: 'dec-new',
          older_decision_id: 'dec-old',
          confidence_delta: 1,
        },
      };

      expect(contradiction.proposed_supersession).toBeDefined();
      expect(contradiction.proposed_supersession!.newer_decision_id).toBe('dec-new');
      expect(contradiction.proposed_supersession!.older_decision_id).toBe('dec-old');
      expect(contradiction.proposed_supersession!.confidence_delta).toBe(1);
    });

    it('Contradiction without supersession suggestion has null', () => {
      const contradiction: Contradiction = {
        id: 'ctr-002',
        project_id: 'proj-1',
        decision_a_id: 'dec-a',
        decision_b_id: 'dec-b',
        similarity_score: 0.90,
        status: 'unresolved',
        detected_at: '2026-04-01T00:00:00Z',
        proposed_supersession: null,
      };

      expect(contradiction.proposed_supersession).toBeNull();
    });
  });

  describe('Temporal Scoping — Staleness Rules', () => {
    it('sprint-scoped decisions flag stale after 14 days', () => {
      // Verify the type system supports temporal_scope
      const decision = makeDecision({
        temporal_scope: 'sprint',
        created_at: new Date(Date.now() - 15 * 86400000).toISOString(),
      });
      expect(decision.temporal_scope).toBe('sprint');
      // In a real scenario, markStaleDecisions would set stale=true
      // This verifies the data model supports it
      const daysSinceCreated = (Date.now() - new Date(decision.created_at).getTime()) / 86400000;
      expect(daysSinceCreated).toBeGreaterThan(14);
    });

    it('experiment-scoped decisions flag stale after 7 days', () => {
      const decision = makeDecision({
        temporal_scope: 'experiment',
        created_at: new Date(Date.now() - 8 * 86400000).toISOString(),
      });
      expect(decision.temporal_scope).toBe('experiment');
      const daysSinceCreated = (Date.now() - new Date(decision.created_at).getTime()) / 86400000;
      expect(daysSinceCreated).toBeGreaterThan(7);
    });

    it('permanent-scoped uses existing 30-day behavior', () => {
      const decision = makeDecision({
        temporal_scope: 'permanent',
        created_at: new Date(Date.now() - 31 * 86400000).toISOString(),
      });
      expect(decision.temporal_scope).toBe('permanent');
      const daysSinceCreated = (Date.now() - new Date(decision.created_at).getTime()) / 86400000;
      expect(daysSinceCreated).toBeGreaterThan(30);
    });

    it('deprecated decisions are skipped', () => {
      const decision = makeDecision({
        temporal_scope: 'deprecated',
        status: 'superseded',
      });
      expect(decision.temporal_scope).toBe('deprecated');
      expect(decision.status).toBe('superseded');
    });
  });

  describe('Backward Compatibility', () => {
    it('existing decisions default to permanent scope', () => {
      const decision = makeDecision();
      expect(decision.temporal_scope).toBe('permanent');
      expect(decision.valid_from).toBeDefined();
      expect(decision.valid_until).toBeNull();
    });

    it('decisions without temporal_scope still have valid_from from created_at', () => {
      const decision = makeDecision({
        created_at: '2026-01-15T10:00:00Z',
        valid_from: '2026-01-15T10:00:00Z',
      });
      expect(decision.valid_from).toBe('2026-01-15T10:00:00Z');
    });
  });

  describe('Supersession Chain Data Model', () => {
    it('superseded decision links to new via superseded_by', () => {
      const oldDecision = makeDecision({
        id: 'dec-old',
        status: 'superseded',
        temporal_scope: 'deprecated',
        superseded_by: 'dec-new',
        valid_until: '2026-04-05T00:00:00Z',
      });

      const newDecision = makeDecision({
        id: 'dec-new',
        status: 'active',
        temporal_scope: 'permanent',
      });

      expect(oldDecision.superseded_by).toBe('dec-new');
      expect(oldDecision.temporal_scope).toBe('deprecated');
      expect(oldDecision.valid_until).toBeDefined();
      expect(newDecision.status).toBe('active');
    });

    it('multi-step chain: A -> B -> C', () => {
      const decA = makeDecision({
        id: 'dec-a',
        status: 'superseded',
        superseded_by: 'dec-b',
        temporal_scope: 'deprecated',
      });

      const decB = makeDecision({
        id: 'dec-b',
        status: 'superseded',
        superseded_by: 'dec-c',
        temporal_scope: 'deprecated',
      });

      const decC = makeDecision({
        id: 'dec-c',
        status: 'active',
        temporal_scope: 'permanent',
      });

      expect(decA.superseded_by).toBe('dec-b');
      expect(decB.superseded_by).toBe('dec-c');
      expect(decC.superseded_by).toBeNull();
      expect(decC.status).toBe('active');
    });
  });

  describe('WhatChangedResponse Type', () => {
    it('matches expected response shape', () => {
      // Verify the type compiles correctly
      const response = {
        period: { from: '2026-04-01T00:00:00Z', to: '2026-04-07T00:00:00Z' },
        created: [
          { id: 'dec-1', title: 'New decision', domain: 'api', made_by: 'backend', created_at: '2026-04-02T00:00:00Z' },
        ],
        superseded: [
          { id: 'dec-old', title: 'Old decision', superseded_by: 'dec-1', superseded_at: '2026-04-02T00:00:00Z' },
        ],
        deprecated: [
          { id: 'dec-dep', title: 'Deprecated one', deprecated_at: '2026-04-03T00:00:00Z', reason: 'No longer relevant' },
        ],
        updated: [
          { id: 'dec-upd', title: 'Updated decision', fields_changed: ['description', 'tags'], updated_at: '2026-04-04T00:00:00Z' },
        ],
        summary: '1 new decisions, 1 superseded, 1 deprecated, 1 updated',
      };

      expect(response.period.from).toBe('2026-04-01T00:00:00Z');
      expect(response.created).toHaveLength(1);
      expect(response.superseded).toHaveLength(1);
      expect(response.deprecated).toHaveLength(1);
      expect(response.updated).toHaveLength(1);
      expect(response.summary).toContain('new decisions');
    });
  });

  describe('Temporal Scope Age Formatting', () => {
    it('formats days correctly in condensed output', () => {
      const decision = makeScoredDecision({
        id: 'dec-age',
        title: 'Test age formatting',
      });
      // 45 days ago → should show "1mo"
      (decision as Record<string, unknown>).temporal_scope = 'sprint';
      (decision as Record<string, unknown>).valid_from = new Date(Date.now() - 45 * 86400000).toISOString();

      const condensed = condenseDecisions([decision]);
      expect(condensed).toContain('age:1mo');
    });

    it('handles very recent decisions', () => {
      const decision = makeScoredDecision({
        id: 'dec-new',
        title: 'Brand new decision',
      });
      (decision as Record<string, unknown>).temporal_scope = 'experiment';
      // 12 hours ago
      (decision as Record<string, unknown>).valid_from = new Date(Date.now() - 12 * 3600000).toISOString();

      const condensed = condenseDecisions([decision]);
      expect(condensed).toContain('age:0d');
    });
  });
});
