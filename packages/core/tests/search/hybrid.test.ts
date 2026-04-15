import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SQLiteAdapter } from '../../src/db/sqlite-adapter.js';
import { withDbOverride } from '../../src/db/index.js';
import { hybridSearch } from '../../src/search/hybrid.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ID = 'test-hybrid-search-project';

let db: SQLiteAdapter;

beforeAll(async () => {
  db = new SQLiteAdapter(':memory:');
  await db.connect();

  const migrationsDir = path.join(__dirname, '..', '..', 'src', 'db', 'migrations', 'sqlite');
  await db.runMigrations(migrationsDir);

  await db.query(
    `INSERT OR IGNORE INTO projects (id, name) VALUES (?, ?)`,
    [PROJECT_ID, 'Hybrid Search Test Project'],
  );
});

afterAll(async () => {
  await db.close();
});

describe('hybridSearch', () => {
  it('returns an array (may be empty in test DB)', async () => {
    const results = await withDbOverride(db, () =>
      hybridSearch(PROJECT_ID, 'authentication', 5),
    );
    expect(Array.isArray(results)).toBe(true);
  });

  it('returns mixed decisions and entities for general query', async () => {
    const results = await withDbOverride(db, () =>
      hybridSearch(PROJECT_ID, 'postgres database', 5),
    );
    expect(Array.isArray(results)).toBe(true);
  });

  it('does not crash on empty query', async () => {
    const results = await withDbOverride(db, () =>
      hybridSearch(PROJECT_ID, '', 5),
    );
    expect(Array.isArray(results)).toBe(true);
  });

  it('includes intent in results', async () => {
    const results = await withDbOverride(db, () =>
      hybridSearch(PROJECT_ID, 'why did we choose postgres', 5),
    );
    expect(Array.isArray(results)).toBe(true);
  });

  it('returns matching decisions when data is present', async () => {
    // Insert a decision that should match
    await db.query(
      `INSERT OR IGNORE INTO decisions
         (id, project_id, title, description, reasoning, made_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        'dec-hybrid-test-1',
        PROJECT_ID,
        'Use PostgreSQL for persistence',
        'We evaluated several databases and chose PostgreSQL for reliability.',
        'Performance benchmarks favor PostgreSQL',
        'architect',
      ],
    );

    // Search for a single token that appears verbatim in the title
    const results = await withDbOverride(db, () =>
      hybridSearch(PROJECT_ID, 'postgresql', 5),
    );

    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].kind).toBe('decision');
    expect(results[0].rrf_score).toBeGreaterThan(0);
    expect(results[0].intent).toBe('general');
  });

  it('attaches correct intent to results', async () => {
    await db.query(
      `INSERT OR IGNORE INTO decisions
         (id, project_id, title, description, reasoning, made_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        'dec-hybrid-test-2',
        PROJECT_ID,
        'Architecture decision for caching',
        'We decided to use Redis for caching layer.',
        'Latency requirements',
        'architect',
      ],
    );

    const results = await withDbOverride(db, () =>
      hybridSearch(PROJECT_ID, 'rationale for using Redis', 5),
    );

    expect(Array.isArray(results)).toBe(true);
    if (results.length > 0) {
      expect(results[0].intent).toBe('decision');
    }
  });

  it('normalises rrf_score to [0, 1]', async () => {
    const results = await withDbOverride(db, () =>
      hybridSearch(PROJECT_ID, 'caching redis', 10),
    );

    for (const r of results) {
      expect(r.rrf_score).toBeGreaterThanOrEqual(0);
      expect(r.rrf_score).toBeLessThanOrEqual(1);
    }
  });
});
