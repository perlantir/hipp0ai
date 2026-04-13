import { describe, it, expect } from 'vitest';
import { encodeH0C } from '../src/compression/h0c-encoder.js';
import { decodeH0C } from '../src/compression/h0c-decoder.js';
import type { ScoredDecision } from '../src/types.js';
import type { H0CEncodeOptions, DecodedDecision } from '../src/compression/h0c-encoder.js';

/* ------------------------------------------------------------------ */
/*  Test fixtures                                                      */
/* ------------------------------------------------------------------ */

function makeScoredDecision(overrides: Partial<ScoredDecision> = {}): ScoredDecision {
  return {
    id: overrides.id ?? 'dec-001',
    project_id: 'proj-1',
    title: overrides.title ?? 'Use JWT with 15-min expiry',
    description: overrides.description ?? 'Auth tokens with short-lived access for stateless API',
    reasoning: overrides.reasoning ?? 'Session cookies require sticky sessions or shared Redis. JWT is self-contained.',
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
  };
}

function makeDecisions(count: number): ScoredDecision[] {
  const titles = [
    'Use JWT with 15-min expiry',
    'Hono middleware for JWT verification',
    'Rate limit auth endpoints 100/min',
    'PostgreSQL with pgvector for embeddings',
    'pnpm workspaces for monorepo management',
    'Redis for caching and rate limiting',
    'WebSocket for real-time notifications',
    'Vitest for unit and integration testing',
    'Docker Compose for local development',
    'Semantic search with cosine similarity',
    'Graph expansion for related decisions',
    'Token budget packing algorithm',
    'Confidence decay over time model',
    'Auto-distillation from conversations',
    'Contradiction detection via embeddings',
    'Session-based multi-step workflows',
    'Agent relevance profiling system',
    'Policy enforcement overlay mechanism',
    'Smart orchestrator for agent routing',
    'Relevance feedback learning loop',
  ];

  const allTags = [
    ['auth', 'security', 'jwt'],
    ['auth', 'api', 'middleware'],
    ['auth', 'api', 'rate-limiting'],
    ['database', 'embeddings', 'pgvector'],
    ['infrastructure', 'monorepo', 'tooling'],
    ['caching', 'redis', 'performance'],
    ['websocket', 'real-time', 'notifications'],
    ['testing', 'vitest', 'quality'],
    ['docker', 'infrastructure', 'development'],
    ['search', 'embeddings', 'similarity'],
    ['graph', 'decisions', 'expansion'],
    ['tokens', 'budget', 'optimization'],
    ['temporal', 'confidence', 'decay'],
    ['distillery', 'extraction', 'automation'],
    ['contradiction', 'detection', 'embeddings'],
    ['sessions', 'workflow', 'multi-step'],
    ['agents', 'relevance', 'profiling'],
    ['policy', 'enforcement', 'governance'],
    ['orchestrator', 'routing', 'agents'],
    ['feedback', 'learning', 'evolution'],
  ];

  const agents = ['architect', 'backend', 'security', 'frontend', 'devops'];
  const confs: Array<'high' | 'medium' | 'low'> = ['high', 'high', 'medium', 'high', 'low'];

  const descriptions = [
    'Auth tokens use short-lived JWTs with 15-minute expiry. Access tokens are stateless and scale horizontally without server-side session storage.',
    'All protected API routes pass through Hono middleware that verifies JWT signatures before forwarding to handlers. Invalid tokens return 401.',
    'Auth endpoints like login and token refresh are rate-limited to 100 requests per minute per IP to prevent brute-force credential stuffing attacks.',
    'Vector embeddings stored in PostgreSQL using pgvector extension for efficient nearest-neighbor search across decision corpus.',
    'Monorepo managed with pnpm workspaces. Shared packages publish to workspace protocol for zero-config cross-package imports.',
    'Redis used for compile response caching with 1-hour TTL and rate limiting with sliding window counters per agent per endpoint.',
    'WebSocket server broadcasts compile completions and decision changes to connected dashboard clients for real-time UI updates.',
    'Vitest configured for unit and integration tests with coverage thresholds. Tests run in parallel across workspace packages.',
    'Local development uses Docker Compose with PostgreSQL, Redis, and the app server. Volumes persist data across restarts.',
    'Semantic search uses cosine similarity between task embedding and decision embeddings to find contextually relevant decisions.',
    'Related decisions discovered via graph expansion traverse dependency and supersession edges to surface connected context.',
    'Token budget packing fits highest-scored decisions into the context window using a greedy knapsack approach.',
    'Decision confidence decays over time based on temporal scope. Sprint-scoped decisions lose confidence after 14 days.',
    'Conversations are auto-distilled into structured decisions by an LLM pipeline that extracts, deduplicates, and classifies.',
    'Contradictions detected via embedding similarity between decisions in the same domain with opposing conclusions.',
    'Multi-step task sessions track agent handoffs with per-step outputs, enabling context continuity across agent boundaries.',
    'Agent relevance profiles define tag weights and domain preferences used by the 5-signal scoring pipeline.',
    'Governance policies enforce approved decisions as hard constraints or soft advisories during context compilation.',
    'Smart orchestrator suggests next agent based on task requirements, session history, and team relevance scores.',
    'Relevance feedback from agents adjusts scoring weights over time, improving retrieval quality through passive learning.',
  ];

  return Array.from({ length: count }, (_, i) => makeScoredDecision({
    id: `dec-${String(i + 1).padStart(3, '0')}`,
    title: titles[i % titles.length]!,
    description: descriptions[i % descriptions.length]!,
    reasoning: `Reasoning for decision ${i + 1}: chose this approach because it best fits the architecture and scales well for our use case.`,
    combined_score: 0.95 - (i * 0.01),
    tags: allTags[i % allTags.length]!,
    made_by: agents[i % agents.length]!,
    confidence: confs[i % confs.length]!,
    created_at: new Date(Date.now() - i * 86400000).toISOString(),
  }));
}

/* ------------------------------------------------------------------ */
/*  Encode tests                                                       */
/* ------------------------------------------------------------------ */

describe('encodeH0C', () => {
  it('returns header + empty marker for empty array', () => {
    const result = encodeH0C([]);
    expect(result).toContain('#H0C v2');
    expect(result).toContain('(empty)');
  });

  it('produces one line per decision', () => {
    const decisions = makeDecisions(5);
    const encoded = encodeH0C(decisions);
    const lines = encoded.split('\n').filter(l => l.startsWith('['));
    expect(lines.length).toBe(5);
  });

  it('builds tag index in header', () => {
    const decisions = makeDecisions(3);
    const encoded = encodeH0C(decisions);
    expect(encoded).toContain('#TAGS:');
    expect(encoded).toContain('auth');
    expect(encoded).toContain('security');
  });

  it('references tags by index in decision lines', () => {
    const decisions = [makeScoredDecision({ tags: ['auth', 'security'] })];
    const encoded = encodeH0C(decisions);
    // Tags should be referenced as g:0,1 or similar
    expect(encoded).toMatch(/g:\d+(,\d+)*/);
  });

  it('uses confidence shorthand H/M/L', () => {
    const decisions = [
      makeScoredDecision({ id: 'd1', confidence: 'high' }),
      makeScoredDecision({ id: 'd2', confidence: 'medium' }),
      makeScoredDecision({ id: 'd3', confidence: 'low' }),
    ];
    const encoded = encodeH0C(decisions);
    expect(encoded).toContain('|H|');
    expect(encoded).toContain('|M|');
    expect(encoded).toContain('|L|');
  });

  it('uses integer scores (e.g., 92 not 0.92)', () => {
    const decisions = [makeScoredDecision({ combined_score: 0.92 })];
    const encoded = encodeH0C(decisions);
    expect(encoded).toContain('[92|');
  });

  it('uses compact date format (e.g., Apr8)', () => {
    const decisions = [makeScoredDecision({ created_at: '2026-04-08T01:29:38.121Z' })];
    const encoded = encodeH0C(decisions);
    expect(encoded).toContain('Apr8');
  });

  it('includes reasoning when option is set', () => {
    const decisions = [makeScoredDecision()];
    const opts: H0CEncodeOptions = { includeReasoning: true };
    const encoded = encodeH0C(decisions, opts);
    expect(encoded).toContain('r:');
  });

  it('omits reasoning by default', () => {
    const decisions = [makeScoredDecision()];
    const encoded = encodeH0C(decisions);
    // Should not have r: segments
    const lines = encoded.split('\n').filter(l => l.startsWith('['));
    for (const line of lines) {
      expect(line).not.toMatch(/\|r:/);
    }
  });

  it('respects maxDescriptionWords', () => {
    const decisions = [makeScoredDecision({
      description: 'one two three four five six seven eight nine ten eleven twelve',
    })];
    const encoded3 = encodeH0C(decisions, { maxDescriptionWords: 3 });
    const encoded10 = encodeH0C(decisions, { maxDescriptionWords: 10 });
    // The 3-word version should be shorter
    expect(encoded3.length).toBeLessThan(encoded10.length);
  });

  it('handles decisions with no tags', () => {
    const decisions = [makeScoredDecision({ tags: [] })];
    const encoded = encodeH0C(decisions);
    expect(encoded).not.toContain('#TAGS:');
    expect(encoded).not.toContain('g:');
  });

  it('handles empty description', () => {
    const decisions = [makeScoredDecision({ description: '' })];
    const encoded = encodeH0C(decisions);
    expect(encoded).toContain('[');
    // Should still have title and meta
    expect(encoded).toContain('Use JWT');
  });

  it('handles special characters in titles', () => {
    const decisions = [makeScoredDecision({ title: 'Use "pipes" | and & special chars' })];
    const encoded = encodeH0C(decisions);
    // Pipes should be escaped to /
    expect(encoded).not.toMatch(/\| and &/);
    expect(encoded).toContain('/ and & special chars');
  });
});

/* ------------------------------------------------------------------ */
/*  Decode tests                                                       */
/* ------------------------------------------------------------------ */

describe('decodeH0C', () => {
  it('returns empty array for empty string', () => {
    expect(decodeH0C('')).toEqual([]);
  });

  it('returns empty array for empty marker', () => {
    expect(decodeH0C('#H0C v2\n---\n(empty)')).toEqual([]);
  });

  it('decodes a single decision correctly', () => {
    const decisions = [makeScoredDecision()];
    const encoded = encodeH0C(decisions);
    const decoded = decodeH0C(encoded);

    expect(decoded.length).toBe(1);
    expect(decoded[0]!.confidence).toBe('high');
    expect(decoded[0]!.made_by).toBe('architect');
    expect(decoded[0]!.score).toBe(0.92);
    expect(decoded[0]!.tags).toContain('auth');
    expect(decoded[0]!.tags).toContain('security');
    expect(decoded[0]!.tags).toContain('jwt');
  });

  it('decodes multiple decisions preserving order', () => {
    const decisions = makeDecisions(5);
    const encoded = encodeH0C(decisions);
    const decoded = decodeH0C(encoded);

    expect(decoded.length).toBe(5);
    // Check scores are in decreasing order (same as input)
    for (let i = 1; i < decoded.length; i++) {
      expect(decoded[i]!.score).toBeLessThanOrEqual(decoded[i - 1]!.score);
    }
  });

  it('expands confidence shorthand correctly', () => {
    const decisions = [
      makeScoredDecision({ id: 'd1', confidence: 'high', combined_score: 0.9 }),
      makeScoredDecision({ id: 'd2', confidence: 'medium', combined_score: 0.7 }),
      makeScoredDecision({ id: 'd3', confidence: 'low', combined_score: 0.5 }),
    ];
    const encoded = encodeH0C(decisions);
    const decoded = decodeH0C(encoded);

    expect(decoded[0]!.confidence).toBe('high');
    expect(decoded[1]!.confidence).toBe('medium');
    expect(decoded[2]!.confidence).toBe('low');
  });

  it('resolves tag indices back to tag names', () => {
    const decisions = [makeScoredDecision({ tags: ['auth', 'security', 'jwt'] })];
    const encoded = encodeH0C(decisions);
    const decoded = decodeH0C(encoded);

    expect(decoded[0]!.tags).toEqual(['auth', 'security', 'jwt']);
  });

  it('includes reasoning when encoded with reasoning', () => {
    const decisions = [makeScoredDecision()];
    const encoded = encodeH0C(decisions, { includeReasoning: true });
    const decoded = decodeH0C(encoded);

    expect(decoded[0]!.reasoning).toBeDefined();
    expect(decoded[0]!.reasoning!.length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */
/*  Round-trip tests                                                   */
/* ------------------------------------------------------------------ */

describe('encode → decode round-trip', () => {
  it('preserves all key fields for 1 decision', () => {
    const original = [makeScoredDecision()];
    const decoded = decodeH0C(encodeH0C(original));

    expect(decoded.length).toBe(1);
    expect(decoded[0]!.score).toBe(0.92);
    expect(decoded[0]!.confidence).toBe('high');
    expect(decoded[0]!.made_by).toBe('architect');
    expect(decoded[0]!.tags).toEqual(['auth', 'security', 'jwt']);
  });

  it('preserves fields for 10 decisions', () => {
    const original = makeDecisions(10);
    const decoded = decodeH0C(encodeH0C(original));

    expect(decoded.length).toBe(10);
    for (let i = 0; i < 10; i++) {
      const d = decoded[i]!;
      const o = original[i]!;
      // Score (rounded to int then back): within 0.01
      expect(Math.abs(d.score - o.combined_score)).toBeLessThan(0.01);
      expect(d.confidence).toBe(o.confidence);
      expect(d.made_by).toBe(o.made_by);
      expect(d.tags).toEqual(o.tags);
    }
  });

  it('preserves fields for 50 decisions', () => {
    const original = makeDecisions(50);
    const decoded = decodeH0C(encodeH0C(original));
    expect(decoded.length).toBe(50);
  });

  it('preserves fields for 100 decisions', () => {
    const original = makeDecisions(100);
    const decoded = decodeH0C(encodeH0C(original));
    expect(decoded.length).toBe(100);
  });
});

/* ------------------------------------------------------------------ */
/*  Compression ratio tests                                            */
/* ------------------------------------------------------------------ */

describe('compression ratio', () => {
  function compressionRatio(count: number): number {
    const decisions = makeDecisions(count);
    const fullJson = JSON.stringify(decisions, null, 2);
    const h0c = encodeH0C(decisions);
    return fullJson.length / h0c.length;
  }

  it('achieves > 6x compression for 1 decision', () => {
    expect(compressionRatio(1)).toBeGreaterThan(6);
  });

  it('achieves > 9x compression for 5 decisions', () => {
    expect(compressionRatio(5)).toBeGreaterThan(9);
  });

  it('achieves > 9x compression for 10 decisions', () => {
    // Note: 12-18x target is measured against full ContextPackage JSON (not bare Decision[])
    expect(compressionRatio(10)).toBeGreaterThan(9);
  });

  it('achieves > 10x compression for 50 decisions', () => {
    expect(compressionRatio(50)).toBeGreaterThan(10);
  });

  it('achieves > 10x compression for 100 decisions', () => {
    expect(compressionRatio(100)).toBeGreaterThan(10);
  });
});

/* ------------------------------------------------------------------ */
/*  Edge case tests                                                    */
/* ------------------------------------------------------------------ */

describe('edge cases', () => {
  it('handles decision with all empty fields', () => {
    const d = makeScoredDecision({
      title: '',
      description: '',
      reasoning: '',
      tags: [],
      made_by: '',
      created_at: '',
    });
    const encoded = encodeH0C([d]);
    const decoded = decodeH0C(encoded);
    expect(decoded.length).toBe(1);
  });

  it('handles very long title (truncated to 8 words)', () => {
    const longTitle = Array.from({ length: 30 }, (_, i) => `word${i}`).join(' ');
    const d = makeScoredDecision({ title: longTitle });
    const encoded = encodeH0C([d]);
    // Title should contain at most 8 word tokens
    const decisionLine = encoded.split('\n').find(l => l.startsWith('['))!;
    const titlePart = decisionLine.split(']')[1]!.split('|')[0]!;
    expect(titlePart.trim().split(/\s+/).length).toBeLessThanOrEqual(8);
  });

  it('handles pipe characters in title/description', () => {
    const d = makeScoredDecision({
      title: 'Use A | B pattern',
      description: 'Choose between X | Y | Z options',
    });
    const encoded = encodeH0C([d]);
    const decoded = decodeH0C(encoded);
    expect(decoded.length).toBe(1);
    // Pipes in title should be escaped to /
    expect(decoded[0]!.title).toContain('A / B');
  });

  it('handles newlines in description', () => {
    const d = makeScoredDecision({
      description: 'Line one\nLine two\nLine three',
    });
    const encoded = encodeH0C([d]);
    // No newlines should appear within a decision line
    const decisionLines = encoded.split('\n').filter(l => l.startsWith('['));
    expect(decisionLines.length).toBe(1);
  });

  it('various date formats produce compact dates', () => {
    const dates = [
      { input: '2026-01-15T00:00:00Z', expected: 'Jan15' },
      { input: '2026-12-31T23:59:59Z', expected: 'Dec31' },
      { input: '2026-07-04T12:00:00Z', expected: 'Jul4' },
    ];
    for (const { input, expected } of dates) {
      const d = makeScoredDecision({ created_at: input });
      const encoded = encodeH0C([d]);
      expect(encoded).toContain(expected);
    }
  });
});
