import { describe, it, expect } from 'vitest';
import { encodeH0C } from '../src/compression/h0c-encoder.js';
import { decodeH0C } from '../src/compression/h0c-decoder.js';
import type { ScoredDecision } from '../src/types.js';

/* ------------------------------------------------------------------ */
/*  Test fixtures                                                      */
/* ------------------------------------------------------------------ */

function makeScoredDecision(overrides: Partial<ScoredDecision> = {}): ScoredDecision {
  return {
    id: overrides.id ?? 'dec-001',
    project_id: 'proj-1',
    title: overrides.title ?? 'Use JWT with 15-min expiry',
    description: overrides.description ?? 'Auth tokens with short-lived access for stateless API',
    reasoning: overrides.reasoning ?? 'Session cookies require sticky sessions.',
    made_by: overrides.made_by ?? 'architect',
    source: 'manual',
    confidence: overrides.confidence ?? 'high',
    status: 'active',
    alternatives_considered: [],
    affects: overrides.affects ?? ['frontend', 'security'],
    tags: overrides.tags ?? ['auth', 'security', 'jwt'],
    assumptions: [],
    open_questions: [],
    dependencies: [],
    confidence_decay_rate: 0.01,
    created_at: overrides.created_at ?? '2026-04-08T01:29:38.121Z',
    updated_at: '2026-04-08T01:29:38.121Z',
    metadata: {},
    relevance_score: overrides.relevance_score ?? 0.92,
    freshness_score: overrides.freshness_score ?? 0.9,
    combined_score: overrides.combined_score ?? 0.92,
    scoring_breakdown: overrides.scoring_breakdown ?? {
      direct_affect: 0.3,
      tag_matching: 0.2,
      role_relevance: 0.25,
      semantic_similarity: 0.12,
      status_penalty: 0,
      freshness: 0.9,
      combined: 0.92,
    },
    priority_level: 0,
    temporal_scope: 'permanent',
    namespace: overrides.namespace ?? null,
  };
}

/* ------------------------------------------------------------------ */
/*  H0C encoder namespace tests                                        */
/* ------------------------------------------------------------------ */

describe('H0C namespace encoding', () => {
  it('includes ns: indicator when decision has a namespace', () => {
    const decisions = [makeScoredDecision({ namespace: 'auth' })];
    const encoded = encodeH0C(decisions);
    expect(encoded).toContain('ns:auth');
  });

  it('omits ns: indicator when namespace is null', () => {
    const decisions = [makeScoredDecision({ namespace: null })];
    const encoded = encodeH0C(decisions);
    expect(encoded).not.toContain('ns:');
  });

  it('omits ns: indicator when namespace is undefined', () => {
    const decisions = [makeScoredDecision({ namespace: undefined })];
    const encoded = encodeH0C(decisions);
    expect(encoded).not.toContain('ns:');
  });

  it('formats namespace inside metadata bracket', () => {
    const decisions = [makeScoredDecision({ namespace: 'infra' })];
    const encoded = encodeH0C(decisions);
    // Should be inside brackets: [92|H|architect|Apr8|ns:infra]
    const bracketContent = encoded.match(/\[([^\]]+)\]/);
    expect(bracketContent).not.toBeNull();
    expect(bracketContent![1]).toContain('ns:infra');
  });

  it('handles multiple decisions with different namespaces', () => {
    const decisions = [
      makeScoredDecision({ id: 'd1', namespace: 'auth', combined_score: 0.9 }),
      makeScoredDecision({ id: 'd2', namespace: 'infra', combined_score: 0.8 }),
      makeScoredDecision({ id: 'd3', namespace: null, combined_score: 0.7 }),
    ];
    const encoded = encodeH0C(decisions);
    expect(encoded).toContain('ns:auth');
    expect(encoded).toContain('ns:infra');
    // The third decision (null ns) should not have ns:
    const lines = encoded.split('\n').filter(l => l.startsWith('['));
    expect(lines[2]).not.toContain('ns:');
  });
});

/* ------------------------------------------------------------------ */
/*  H0C decoder namespace tests                                        */
/* ------------------------------------------------------------------ */

describe('H0C namespace decoding', () => {
  it('decodes namespace from encoded decision', () => {
    const decisions = [makeScoredDecision({ namespace: 'auth' })];
    const encoded = encodeH0C(decisions);
    const decoded = decodeH0C(encoded);

    expect(decoded.length).toBe(1);
    expect(decoded[0]!.namespace).toBe('auth');
  });

  it('returns no namespace for global decisions', () => {
    const decisions = [makeScoredDecision({ namespace: null })];
    const encoded = encodeH0C(decisions);
    const decoded = decodeH0C(encoded);

    expect(decoded.length).toBe(1);
    expect(decoded[0]!.namespace).toBeUndefined();
  });

  it('round-trips namespace correctly', () => {
    const decisions = [
      makeScoredDecision({ id: 'd1', namespace: 'auth', combined_score: 0.9 }),
      makeScoredDecision({ id: 'd2', namespace: 'frontend', combined_score: 0.8 }),
      makeScoredDecision({ id: 'd3', namespace: null, combined_score: 0.7 }),
    ];
    const encoded = encodeH0C(decisions);
    const decoded = decodeH0C(encoded);

    expect(decoded.length).toBe(3);
    expect(decoded[0]!.namespace).toBe('auth');
    expect(decoded[1]!.namespace).toBe('frontend');
    expect(decoded[2]!.namespace).toBeUndefined();
  });

  it('decodes hand-crafted H0C with namespace', () => {
    const h0c = `#H0C v2
#TAGS: 0=auth 1=security
---
[92|H|architect|Apr8|ns:auth]Use JWT|g:0,1|Short-lived tokens`;

    const decoded = decodeH0C(h0c);
    expect(decoded.length).toBe(1);
    expect(decoded[0]!.namespace).toBe('auth');
    expect(decoded[0]!.tags).toEqual(['auth', 'security']);
    expect(decoded[0]!.score).toBe(0.92);
  });
});

/* ------------------------------------------------------------------ */
/*  Backward compatibility tests                                       */
/* ------------------------------------------------------------------ */

describe('namespace backward compatibility', () => {
  it('existing H0C without namespace still decodes correctly', () => {
    const h0c = `#H0C v2
#TAGS: 0=auth 1=security
---
[92|H|architect|Apr8]Use JWT|g:0,1|Short-lived tokens`;

    const decoded = decodeH0C(h0c);
    expect(decoded.length).toBe(1);
    expect(decoded[0]!.namespace).toBeUndefined();
    expect(decoded[0]!.score).toBe(0.92);
    expect(decoded[0]!.confidence).toBe('high');
  });

  it('decisions without namespace encode the same as before', () => {
    const decisions = [makeScoredDecision({ namespace: null, tags: ['auth'] })];
    const encoded = encodeH0C(decisions);
    // Should not contain ns:
    expect(encoded).not.toContain('ns:');
    // Should still be valid H0C
    const decoded = decodeH0C(encoded);
    expect(decoded.length).toBe(1);
    expect(decoded[0]!.title).toContain('Use JWT');
  });
});

/* ------------------------------------------------------------------ */
/*  Decision type tests                                                */
/* ------------------------------------------------------------------ */

describe('Decision type with namespace', () => {
  it('Decision type accepts namespace field', () => {
    const decision: Partial<ScoredDecision> = {
      id: 'test',
      namespace: 'auth',
    };
    expect(decision.namespace).toBe('auth');
  });

  it('Decision type accepts null namespace', () => {
    const decision: Partial<ScoredDecision> = {
      id: 'test',
      namespace: null,
    };
    expect(decision.namespace).toBeNull();
  });

  it('Decision type accepts undefined namespace', () => {
    const decision: Partial<ScoredDecision> = {
      id: 'test',
    };
    expect(decision.namespace).toBeUndefined();
  });
});
