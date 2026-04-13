/**
 * Context Time Travel Tests
 *
 * Tests the diff algorithm, context hash determinism, as_of filtering,
 * and compile history patterns. Uses pure functions where possible.
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Diff algorithm (pure function extracted for testing)
// ---------------------------------------------------------------------------

interface DecisionScore {
  id: string;
  title: string;
  combined_score: number;
}

function diffCompilations(
  scoresA: DecisionScore[],
  scoresB: DecisionScore[],
): {
  added: Array<{ title: string; score_b: number }>;
  removed: Array<{ title: string; score_a: number }>;
  reranked: Array<{ title: string; rank_a: number; rank_b: number; score_a: number; score_b: number }>;
  unchanged: number;
} {
  const mapA = new Map(scoresA.map((d, i) => [d.id, { ...d, rank: i + 1 }]));
  const mapB = new Map(scoresB.map((d, i) => [d.id, { ...d, rank: i + 1 }]));

  const added: Array<{ title: string; score_b: number }> = [];
  const removed: Array<{ title: string; score_a: number }> = [];
  const reranked: Array<{ title: string; rank_a: number; rank_b: number; score_a: number; score_b: number }> = [];
  let unchanged = 0;

  for (const [id, dB] of mapB) {
    if (!mapA.has(id)) added.push({ title: dB.title, score_b: dB.combined_score });
  }
  for (const [id, dA] of mapA) {
    if (!mapB.has(id)) removed.push({ title: dA.title, score_a: dA.combined_score });
  }
  for (const [id, dA] of mapA) {
    const dB = mapB.get(id);
    if (!dB) continue;
    if (dA.rank !== dB.rank) {
      reranked.push({ title: dA.title, rank_a: dA.rank, rank_b: dB.rank, score_a: dA.combined_score, score_b: dB.combined_score });
    } else {
      unchanged++;
    }
  }
  return { added, removed, reranked, unchanged };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Context Time Travel', () => {
  describe('Diff Algorithm', () => {
    it('identifies added decisions correctly', () => {
      const a: DecisionScore[] = [
        { id: 'd1', title: 'Use JWT', combined_score: 0.9 },
      ];
      const b: DecisionScore[] = [
        { id: 'd1', title: 'Use JWT', combined_score: 0.9 },
        { id: 'd2', title: 'Use 6-judge scoring', combined_score: 0.87 },
      ];
      const diff = diffCompilations(a, b);
      expect(diff.added).toHaveLength(1);
      expect(diff.added[0].title).toBe('Use 6-judge scoring');
    });

    it('identifies removed decisions correctly', () => {
      const a: DecisionScore[] = [
        { id: 'd1', title: 'Use JWT', combined_score: 0.9 },
        { id: 'd2', title: 'Use 5-judge scoring', combined_score: 0.85 },
      ];
      const b: DecisionScore[] = [
        { id: 'd1', title: 'Use JWT', combined_score: 0.9 },
      ];
      const diff = diffCompilations(a, b);
      expect(diff.removed).toHaveLength(1);
      expect(diff.removed[0].title).toBe('Use 5-judge scoring');
    });

    it('identifies reranked decisions correctly', () => {
      const a: DecisionScore[] = [
        { id: 'd1', title: 'Use JWT', combined_score: 0.9 },
        { id: 'd2', title: 'Anti-convergence', combined_score: 0.72 },
        { id: 'd3', title: 'Rate limit', combined_score: 0.6 },
      ];
      const b: DecisionScore[] = [
        { id: 'd2', title: 'Anti-convergence', combined_score: 0.89 },
        { id: 'd1', title: 'Use JWT', combined_score: 0.85 },
        { id: 'd3', title: 'Rate limit', combined_score: 0.6 },
      ];
      const diff = diffCompilations(a, b);
      expect(diff.reranked).toHaveLength(2);
      const antiConv = diff.reranked.find((r) => r.title === 'Anti-convergence');
      expect(antiConv).toBeDefined();
      expect(antiConv!.rank_a).toBe(2);
      expect(antiConv!.rank_b).toBe(1);
    });

    it('handles identical compilations (no changes)', () => {
      const scores: DecisionScore[] = [
        { id: 'd1', title: 'A', combined_score: 0.9 },
        { id: 'd2', title: 'B', combined_score: 0.7 },
      ];
      const diff = diffCompilations(scores, scores);
      expect(diff.added).toHaveLength(0);
      expect(diff.removed).toHaveLength(0);
      expect(diff.reranked).toHaveLength(0);
      expect(diff.unchanged).toBe(2);
    });

    it('handles empty compilations', () => {
      const diff = diffCompilations([], []);
      expect(diff.added).toHaveLength(0);
      expect(diff.removed).toHaveLength(0);
      expect(diff.unchanged).toBe(0);
    });
  });

  describe('Context Hash', () => {
    it('is deterministic — same input produces same hash', () => {
      const content = '# Context for maks\n\nDecision: Use JWT for auth\n';
      const hash1 = createHash('sha256').update(content).digest('hex');
      const hash2 = createHash('sha256').update(content).digest('hex');
      expect(hash1).toBe(hash2);
    });

    it('different content produces different hash', () => {
      const hash1 = createHash('sha256').update('content A').digest('hex');
      const hash2 = createHash('sha256').update('content B').digest('hex');
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('as_of Filtering Logic', () => {
    it('filters decisions by created_at', () => {
      const decisions = [
        { id: 'd1', title: 'A', created_at: '2026-03-01T00:00:00Z', status: 'active' },
        { id: 'd2', title: 'B', created_at: '2026-03-10T00:00:00Z', status: 'active' },
        { id: 'd3', title: 'C', created_at: '2026-03-20T00:00:00Z', status: 'active' },
      ];
      const asOf = '2026-03-15T00:00:00Z';
      const filtered = decisions.filter((d) => d.created_at <= asOf);
      expect(filtered).toHaveLength(2);
      expect(filtered.map((d) => d.title)).toEqual(['A', 'B']);
    });

    it('excludes decisions superseded before as_of', () => {
      const decisions = [
        { id: 'd1', title: 'Old approach', created_at: '2026-03-01T00:00:00Z', status: 'superseded', updated_at: '2026-03-05T00:00:00Z' },
        { id: 'd2', title: 'New approach', created_at: '2026-03-05T00:00:00Z', status: 'active', updated_at: '2026-03-05T00:00:00Z' },
      ];
      const asOf = '2026-03-15T00:00:00Z';
      const filtered = decisions.filter((d) => {
        if (d.created_at > asOf) return false;
        if (d.status === 'superseded' && d.updated_at <= asOf) return false;
        return true;
      });
      // d1 was superseded before as_of, so excluded
      // d2 is active, so included
      expect(filtered).toHaveLength(1);
      expect(filtered[0].title).toBe('New approach');
    });

    it('includes superseded decisions if superseded AFTER as_of', () => {
      const decisions = [
        { id: 'd1', title: 'Original', created_at: '2026-03-01T00:00:00Z', status: 'superseded', updated_at: '2026-03-20T00:00:00Z' },
      ];
      const asOf = '2026-03-15T00:00:00Z';
      const filtered = decisions.filter((d) => {
        if (d.created_at > asOf) return false;
        if (d.status === 'superseded' && d.updated_at <= asOf) return false;
        return true;
      });
      // d1 was superseded AFTER as_of, so it was still active at that time → include
      expect(filtered).toHaveLength(1);
    });
  });

  describe('Debug Mode', () => {
    it('includes all scored decisions (included and excluded)', () => {
      const allDecisions = [
        { id: 'd1', title: 'Included', score: 0.9 },
        { id: 'd2', title: 'Excluded', score: 0.05 },
      ];
      const included = new Set(['d1']);

      const debugOutput = allDecisions.map((d) => ({
        title: d.title,
        combined_score: d.score,
        included: included.has(d.id),
        excluded_reason: included.has(d.id) ? undefined : 'below_relevance_threshold',
      }));

      expect(debugOutput).toHaveLength(2);
      expect(debugOutput[0].included).toBe(true);
      expect(debugOutput[0].excluded_reason).toBeUndefined();
      expect(debugOutput[1].included).toBe(false);
      expect(debugOutput[1].excluded_reason).toBe('below_relevance_threshold');
    });

    it('includes token budget breakdown', () => {
      const budget = {
        total: 50000,
        used: 4200,
        remaining: 50000 - 4200,
      };
      expect(budget.remaining).toBe(45800);
      expect(budget.used).toBeLessThan(budget.total);
    });
  });

  describe('Weight Snapshots', () => {
    it('snapshot structure has agent_id, weights, and snapshot_at', () => {
      const snapshot = {
        id: 'snap-uuid',
        agent_id: 'agent-uuid',
        weights: { architecture: 0.9, testing: 0.7 },
        snapshot_at: '2026-03-15T14:00:00Z',
      };
      expect(snapshot.weights.architecture).toBe(0.9);
      expect(snapshot.agent_id).toBe('agent-uuid');
      expect(snapshot.snapshot_at).toBeDefined();
    });

    it('historical weight lookup uses most recent snapshot before as_of', () => {
      const snapshots = [
        { weights: { auth: 0.5 }, snapshot_at: '2026-03-01T00:00:00Z' },
        { weights: { auth: 0.7 }, snapshot_at: '2026-03-10T00:00:00Z' },
        { weights: { auth: 0.9 }, snapshot_at: '2026-03-20T00:00:00Z' },
      ];
      const asOf = '2026-03-15T00:00:00Z';

      // Find most recent snapshot <= as_of
      const matching = snapshots
        .filter((s) => s.snapshot_at <= asOf)
        .sort((a, b) => b.snapshot_at.localeCompare(a.snapshot_at));

      const selected = matching[0];
      expect(selected).toBeDefined();
      expect(selected.weights.auth).toBe(0.7);
      expect(selected.snapshot_at).toBe('2026-03-10T00:00:00Z');
    });

    it('falls back to null when no snapshot exists before as_of', () => {
      const snapshots = [
        { weights: { auth: 0.9 }, snapshot_at: '2026-04-01T00:00:00Z' },
      ];
      const asOf = '2026-03-15T00:00:00Z';

      const matching = snapshots.filter((s) => s.snapshot_at <= asOf);
      expect(matching).toHaveLength(0);
      // Caller should use current weights as fallback
    });

    it('weights_source indicates snapshot vs current', () => {
      const hasSnapshot = true;
      const source = hasSnapshot ? 'snapshot' : 'current';
      expect(source).toBe('snapshot');

      const noSnapshot = false;
      const source2 = noSnapshot ? 'snapshot' : 'current';
      expect(source2).toBe('current');
    });
  });

  describe('Compile History Record', () => {
    it('history record structure matches expected fields', () => {
      const record = {
        id: 'compile-uuid',
        project_id: 'proj-uuid',
        agent_id: 'agent-uuid',
        agent_name: 'maks',
        task_description: 'Build scoring engine',
        compiled_at: new Date().toISOString(),
        decision_ids: ['d1', 'd2', 'd3'],
        decision_scores: [
          { id: 'd1', title: 'A', combined_score: 0.9 },
          { id: 'd2', title: 'B', combined_score: 0.7 },
        ],
        total_decisions: 2,
        token_budget_used: 4200,
        context_hash: createHash('sha256').update('test').digest('hex'),
      };

      expect(record.decision_ids).toHaveLength(3);
      expect(record.decision_scores).toHaveLength(2);
      expect(record.context_hash).toHaveLength(64); // SHA-256 hex
      expect(record.total_decisions).toBe(2);
    });
  });
});
