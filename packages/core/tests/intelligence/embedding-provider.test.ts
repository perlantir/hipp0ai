import { describe, it, expect } from 'vitest';
import { cosineSim, getEmbeddingProvider } from '../../src/intelligence/embedding-provider.js';

describe('cosineSim', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSim([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 5);
  });
  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSim([1, 0], [0, 1])).toBeCloseTo(0, 5);
  });
  it('returns -1 for opposite vectors', () => {
    expect(cosineSim([1, 2], [-1, -2])).toBeCloseTo(-1, 5);
  });
  it('returns 0 for mismatched lengths', () => {
    expect(cosineSim([1, 2], [1, 2, 3])).toBe(0);
  });
  it('returns 0 for empty vectors', () => {
    expect(cosineSim([], [])).toBe(0);
  });
});

describe('getEmbeddingProvider', () => {
  it('returns null when HIPP0_EMBEDDING_PROVIDER is off', () => {
    const prev = process.env.HIPP0_EMBEDDING_PROVIDER;
    process.env.HIPP0_EMBEDDING_PROVIDER = 'off';
    expect(getEmbeddingProvider()).toBeNull();
    if (prev !== undefined) process.env.HIPP0_EMBEDDING_PROVIDER = prev;
    else delete process.env.HIPP0_EMBEDDING_PROVIDER;
  });
  it('returns null when env unset', () => {
    const prev = process.env.HIPP0_EMBEDDING_PROVIDER;
    delete process.env.HIPP0_EMBEDDING_PROVIDER;
    expect(getEmbeddingProvider()).toBeNull();
    if (prev !== undefined) process.env.HIPP0_EMBEDDING_PROVIDER = prev;
  });
});
