/**
 * Unit test for the Phase 14 unified outcome view helper.
 *
 * The production path targets a Postgres view created in migration 058.
 * Here we stub the DB layer so the helper's contract (SQLite → null,
 * missing row → null, parsed row → {rate, total}, thrown error → null)
 * is pinned without needing a live Postgres.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockQuery = vi.fn();
const mockDialect = { dialect: 'postgres' as 'postgres' | 'sqlite' };

vi.mock('../src/db/index.js', () => ({
  getDb: () => ({
    dialect: mockDialect.dialect,
    query: mockQuery,
  }),
}));

import { getUnifiedOutcomeStats } from '../src/intelligence/outcome-memory.js';

beforeEach(() => {
  mockQuery.mockReset();
  mockDialect.dialect = 'postgres';
});

describe('getUnifiedOutcomeStats', () => {
  it('returns null when dialect is sqlite (view is pg-only)', async () => {
    mockDialect.dialect = 'sqlite';
    const result = await getUnifiedOutcomeStats('dec-1');
    expect(result).toBeNull();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('returns null when the view has no row for the decision', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const result = await getUnifiedOutcomeStats('dec-missing');
    expect(result).toBeNull();
  });

  it('parses numeric columns from Postgres string form', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ success_rate: '0.75', total_count: '4' }],
    });
    const result = await getUnifiedOutcomeStats('dec-1');
    expect(result).toEqual({ success_rate: 0.75, total_count: 4 });
  });

  it('passes native numeric columns through unchanged', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ success_rate: 0.9, total_count: 10 }],
    });
    const result = await getUnifiedOutcomeStats('dec-2');
    expect(result).toEqual({ success_rate: 0.9, total_count: 10 });
  });

  it('returns null on query error (e.g. view missing)', async () => {
    mockQuery.mockRejectedValueOnce(new Error('relation "decision_outcome_stats" does not exist'));
    const result = await getUnifiedOutcomeStats('dec-3');
    expect(result).toBeNull();
  });

  it('returns null when parsed values are not finite', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ success_rate: 'NaN', total_count: 'not-a-number' }],
    });
    const result = await getUnifiedOutcomeStats('dec-4');
    expect(result).toBeNull();
  });
});
