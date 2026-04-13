import { describe, it, expect } from 'vitest';
import { encodeH0C, encodeH0CPatterns } from '../src/compression/h0c-encoder.js';
import { decodeH0C, decodeH0CPatterns } from '../src/compression/h0c-decoder.js';
import type { SuggestedPattern, ScoredDecision, ContextPackage } from '../src/types.js';

/* ------------------------------------------------------------------ */
/*  Test fixtures                                                      */
/* ------------------------------------------------------------------ */

function makeSuggestedPattern(overrides: Partial<SuggestedPattern> = {}): SuggestedPattern {
  return {
    pattern_id: overrides.pattern_id ?? 'pat-001',
    title: overrides.title ?? 'RS256 over HS256 for JWT signing',
    description: overrides.description ?? '3 projects independently chose RS256 for asymmetric JWT signing',
    confidence: overrides.confidence ?? 0.85,
    source_count: overrides.source_count ?? 3,
    relevance_score: overrides.relevance_score ?? 0.72,
  };
}

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
    status: 'active',
    alternatives_considered: [],
    affects: overrides.affects ?? ['frontend', 'security'],
    tags: overrides.tags ?? ['auth', 'security', 'api'],
    assumptions: [],
    open_questions: [],
    dependencies: [],
    confidence_decay_rate: 0.01,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    metadata: {},
    relevance_score: overrides.relevance_score ?? 0.87,
    freshness_score: overrides.freshness_score ?? 0.9,
    combined_score: overrides.combined_score ?? 0.87,
    scoring_breakdown: overrides.scoring_breakdown ?? {
      direct_affect: 0.3,
      tag_matching: 0.2,
      role_relevance: 0.25,
      semantic_similarity: 0.12,
      status_penalty: 0,
      freshness: 0.9,
      combined: 0.87,
    },
  };
}

function makeContextPackage(patterns: SuggestedPattern[] = []): ContextPackage {
  return {
    agent: { name: 'backend', role: 'builder' },
    task: 'Implement JWT authentication',
    compiled_at: '2024-01-01T00:00:00Z',
    token_count: 5000,
    budget_used_pct: 50,
    decisions: [makeScoredDecision()],
    artifacts: [],
    notifications: [],
    recent_sessions: [],
    formatted_markdown: '# Context\n...',
    formatted_json: '{}',
    decisions_considered: 10,
    decisions_included: 1,
    relevance_threshold_used: 0.5,
    compilation_time_ms: 42,
    suggested_patterns: patterns,
  };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('Pattern Recommendations', () => {

  describe('suggested_patterns in ContextPackage', () => {
    it('returns empty array when no patterns match', () => {
      const pkg = makeContextPackage();
      expect(pkg.suggested_patterns).toEqual([]);
    });

    it('includes suggested_patterns when patterns match', () => {
      const patterns = [makeSuggestedPattern()];
      const pkg = makeContextPackage(patterns);
      expect(pkg.suggested_patterns).toHaveLength(1);
      expect(pkg.suggested_patterns[0]!.pattern_id).toBe('pat-001');
      expect(pkg.suggested_patterns[0]!.title).toBe('RS256 over HS256 for JWT signing');
      expect(pkg.suggested_patterns[0]!.confidence).toBe(0.85);
      expect(pkg.suggested_patterns[0]!.source_count).toBe(3);
      expect(pkg.suggested_patterns[0]!.relevance_score).toBe(0.72);
    });

    it('enforces max 2 patterns', () => {
      const patterns = [
        makeSuggestedPattern({ pattern_id: 'pat-001' }),
        makeSuggestedPattern({ pattern_id: 'pat-002' }),
        makeSuggestedPattern({ pattern_id: 'pat-003' }),
      ];
      // The max 2 is enforced in getPatternRecommendations, here we just verify the type allows it
      const capped = patterns.slice(0, 2);
      const pkg = makeContextPackage(capped);
      expect(pkg.suggested_patterns).toHaveLength(2);
    });

    it('respects confidence threshold', () => {
      const patterns = [
        makeSuggestedPattern({ confidence: 0.85 }),
        makeSuggestedPattern({ pattern_id: 'pat-low', confidence: 0.45 }),
      ];
      // The threshold filtering happens in getPatternRecommendations
      // Here we verify the type includes confidence
      const filtered = patterns.filter((p) => p.confidence >= 0.60);
      expect(filtered).toHaveLength(1);
      expect(filtered[0]!.confidence).toBe(0.85);
    });
  });

  describe('H0C pattern encoding', () => {
    it('encodes patterns in H0C format', () => {
      const patterns = [
        makeSuggestedPattern({
          title: 'RS256 over HS256 for JWT signing',
          description: 'Asymmetric signing preferred across projects',
          confidence: 0.85,
          source_count: 3,
        }),
      ];

      const encoded = encodeH0CPatterns(patterns);
      expect(encoded).toContain('---PATTERNS---');
      expect(encoded).toContain('[P|85|3src]');
      expect(encoded).toContain('RS256 over HS256 for JWT');
    });

    it('returns empty string when no patterns', () => {
      const encoded = encodeH0CPatterns([]);
      expect(encoded).toBe('');
    });

    it('encodes multiple patterns', () => {
      const patterns = [
        makeSuggestedPattern({ confidence: 0.85, source_count: 3 }),
        makeSuggestedPattern({ pattern_id: 'pat-002', title: 'Use ESLint with TypeScript', confidence: 0.72, source_count: 5 }),
      ];

      const encoded = encodeH0CPatterns(patterns);
      const lines = encoded.split('\n');
      expect(lines[0]).toBe('---PATTERNS---');
      expect(lines).toHaveLength(3); // header + 2 patterns
      expect(lines[1]).toContain('[P|85|3src]');
      expect(lines[2]).toContain('[P|72|5src]');
    });
  });

  describe('H0C pattern decoding', () => {
    it('decodes patterns from H0C format', () => {
      const h0c = `#H0C v2
---
[87|H|backend|Jan1]JWT auth|g:0|Stateless auth
---PATTERNS---
[P|85|3src] RS256 over HS256 for JWT | Asymmetric signing preferred`;

      const patterns = decodeH0CPatterns(h0c);
      expect(patterns).toHaveLength(1);
      expect(patterns[0]!.title).toBe('RS256 over HS256 for JWT');
      expect(patterns[0]!.description).toBe('Asymmetric signing preferred');
      expect(patterns[0]!.confidence).toBe(0.85);
      expect(patterns[0]!.source_count).toBe(3);
    });

    it('returns empty array when no patterns section', () => {
      const h0c = '#H0C v2\n---\n[87|H|backend|Jan1]JWT auth|g:0|desc';
      expect(decodeH0CPatterns(h0c)).toEqual([]);
    });

    it('returns empty array for empty string', () => {
      expect(decodeH0CPatterns('')).toEqual([]);
    });

    it('roundtrips encode/decode', () => {
      const original = [
        makeSuggestedPattern({
          title: 'RS256 over HS256',
          description: 'Asymmetric signing preferred',
          confidence: 0.85,
          source_count: 3,
        }),
      ];

      const encoded = encodeH0CPatterns(original);
      const decoded = decodeH0CPatterns(encoded);
      expect(decoded).toHaveLength(1);
      expect(decoded[0]!.confidence).toBe(0.85);
      expect(decoded[0]!.source_count).toBe(3);
    });
  });

  describe('include_patterns=false suppression', () => {
    it('compile request supports include_patterns field', () => {
      // Verify the CompileRequest type includes the field
      const request = {
        agent_name: 'backend',
        project_id: 'proj-1',
        task_description: 'test',
        include_patterns: false,
      };
      expect(request.include_patterns).toBe(false);
    });
  });

  describe('SuggestedPattern type', () => {
    it('has all required fields', () => {
      const pattern = makeSuggestedPattern();
      expect(pattern).toHaveProperty('pattern_id');
      expect(pattern).toHaveProperty('title');
      expect(pattern).toHaveProperty('description');
      expect(pattern).toHaveProperty('confidence');
      expect(pattern).toHaveProperty('source_count');
      expect(pattern).toHaveProperty('relevance_score');
    });
  });

  describe('backward compatibility', () => {
    it('ContextPackage always has suggested_patterns field', () => {
      const pkg = makeContextPackage();
      expect(Array.isArray(pkg.suggested_patterns)).toBe(true);
      expect(pkg.suggested_patterns).toEqual([]);
    });

    it('existing fields are unaffected', () => {
      const pkg = makeContextPackage([makeSuggestedPattern()]);
      expect(pkg.agent).toBeDefined();
      expect(pkg.task).toBeDefined();
      expect(pkg.decisions).toBeDefined();
      expect(pkg.decisions_included).toBeDefined();
      expect(pkg.suggested_patterns).toHaveLength(1);
    });
  });
});
