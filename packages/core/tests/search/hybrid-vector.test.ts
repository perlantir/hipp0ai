import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Mock the embedding provider module BEFORE importing hybridSearch, so that
// hybrid.ts's import of getEmbeddingProvider resolves to our stub.
vi.mock('../../src/intelligence/embedding-provider.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/intelligence/embedding-provider.js')>();
  return {
    ...actual,
    getEmbeddingProvider: () => ({
      dimensions: 3,
      model: 'mock-embed',
      embed: async (texts: string[]): Promise<number[][]> => {
        return texts.map((text) => {
          const t = text.toLowerCase();
          if (t.includes('alpha')) return [1, 0, 0];
          if (t.includes('beta')) return [0, 1, 0];
          if (t.includes('gamma')) return [0, 0, 1];
          return [0.5, 0.5, 0.5];
        });
      },
    }),
  };
});

import { SQLiteAdapter } from '../../src/db/sqlite-adapter.js';
import { withDbOverride } from '../../src/db/index.js';
import { hybridSearch } from '../../src/search/hybrid.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ID = 'p-vec-1';
let db: SQLiteAdapter;

beforeAll(async () => {
  db = new SQLiteAdapter(':memory:');
  await db.connect();
  const migrationsDir = path.join(__dirname, '..', '..', 'src', 'db', 'migrations', 'sqlite');
  await db.runMigrations(migrationsDir);

  await db.query(
    `INSERT OR IGNORE INTO projects (id, name) VALUES (?, ?)`,
    [PROJECT_ID, 'Vector Search Test Project'],
  );

  const rows = [
    { id: 'd-alpha', title: 'Alpha decision', description: 'Use Alpha framework', emb: [1, 0, 0] },
    { id: 'd-beta', title: 'Beta decision', description: 'Use Beta framework', emb: [0, 1, 0] },
    { id: 'd-gamma', title: 'Gamma decision', description: 'Use Gamma framework', emb: [0, 0, 1] },
  ];
  for (const r of rows) {
    await db.query(
      `INSERT OR IGNORE INTO decisions
         (id, project_id, title, description, reasoning, made_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [r.id, PROJECT_ID, r.title, r.description, 'test reasoning', 'architect'],
    );
    // hybrid.ts vectorStage parses embeddings via JSON.parse; "[1,0,0]" is valid JSON
    // and also matches the pgvector literal format written by decision-embedder.
    await db.query(
      `INSERT OR REPLACE INTO decision_embeddings (decision_id, embedding)
       VALUES (?, ?)`,
      [r.id, JSON.stringify(r.emb)],
    );
  }
});

afterAll(async () => {
  await db.close();
});

describe('hybridSearch vector stage with mocked provider', () => {
  it('ranks decisions by cosine similarity to the query embedding', async () => {
    // Query contains "alpha" but not as a verbatim token likely to match other
    // titles via FTS LIKE ('Alpha decision' contains 'alpha'). We still expect
    // d-alpha to rank ahead of d-beta/d-gamma regardless of FTS contribution,
    // since the vector stage scores cosine(query=[1,0,0], d-alpha=[1,0,0])=1.0
    // vs. cosine(query, d-beta|d-gamma)=0.
    const results = await withDbOverride(db, () =>
      hybridSearch(PROJECT_ID, 'alpha', 10),
    );
    expect(results.length).toBeGreaterThan(0);

    const alphaIdx = results.findIndex((r) => r.id === 'd-alpha');
    const betaIdx = results.findIndex((r) => r.id === 'd-beta');
    const gammaIdx = results.findIndex((r) => r.id === 'd-gamma');

    expect(alphaIdx).toBeGreaterThanOrEqual(0);
    if (betaIdx >= 0) expect(alphaIdx).toBeLessThan(betaIdx);
    if (gammaIdx >= 0) expect(alphaIdx).toBeLessThan(gammaIdx);
  });

  it('vector stage ranks a vector-only match ahead of unrelated decisions', async () => {
    // Query "beta" -> embeds to [0,1,0]; d-beta has cosine 1.0, d-alpha/d-gamma 0.
    const results = await withDbOverride(db, () =>
      hybridSearch(PROJECT_ID, 'beta', 10),
    );
    expect(results.length).toBeGreaterThan(0);
    const betaIdx = results.findIndex((r) => r.id === 'd-beta');
    expect(betaIdx).toBeGreaterThanOrEqual(0);
    const alphaIdx = results.findIndex((r) => r.id === 'd-alpha');
    const gammaIdx = results.findIndex((r) => r.id === 'd-gamma');
    if (alphaIdx >= 0) expect(betaIdx).toBeLessThan(alphaIdx);
    if (gammaIdx >= 0) expect(betaIdx).toBeLessThan(gammaIdx);
  });

  it('returns an array when query is empty (vector stage is a no-op)', async () => {
    const results = await withDbOverride(db, () =>
      hybridSearch(PROJECT_ID, '', 10),
    );
    expect(Array.isArray(results)).toBe(true);
  });
});
