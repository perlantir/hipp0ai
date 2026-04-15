/**
 * Tests for enrichStaleEntities with a mocked enrichment provider.
 * Uses an in-memory SQLite DB and withDbOverride, mirroring the pattern in
 * search/hybrid-vector.test.ts and entity-enricher.test.ts.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Mock the enrichment provider BEFORE importing enrich-entities so that
// its import of getEnrichmentProvider resolves to our stub.
vi.mock('../../src/intelligence/entity-enrichment-provider.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/intelligence/entity-enrichment-provider.js')>();
  return {
    ...actual,
    getEnrichmentProvider: () => ({
      name: 'mock',
      enrich: async (title: string, type: string, _ctx: string) => ({
        compiledTruth: `**${title}** is a ${type}.\n\nState: enriched.\nTrajectory: improving.\nBeliefs: data-driven.`,
        factsJson: { mock: true, title, type },
        costUsd: 0.001,
        source: 'mock',
      }),
    }),
  };
});

import { SQLiteAdapter } from '../../src/db/sqlite-adapter.js';
import { withDbOverride } from '../../src/db/index.js';
import { enrichStaleEntities } from '../../src/cron/enrich-entities.js';
import { upsertEntityPage } from '../../src/intelligence/entity-enricher.js';
import * as providerMod from '../../src/intelligence/entity-enrichment-provider.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let db: SQLiteAdapter;

const PROJECT_ID = 'p-enrich-1';
const EMPTY_PROJECT_ID = 'p-enrich-empty';

function withDb<T>(fn: () => Promise<T>): Promise<T> {
  return withDbOverride(db, fn);
}

beforeAll(async () => {
  db = new SQLiteAdapter(':memory:');
  await db.connect();
  const migrationsDir = path.join(__dirname, '..', '..', 'src', 'db', 'migrations', 'sqlite');
  await db.runMigrations(migrationsDir);

  for (const [id, name] of [
    [PROJECT_ID, 'enrich-test'],
    [EMPTY_PROJECT_ID, 'enrich-empty'],
  ]) {
    await db.query(`INSERT OR IGNORE INTO projects (id, name) VALUES (?, ?)`, [id, name]);
  }
});

afterAll(async () => {
  await db.close();
});

describe('enrichStaleEntities', () => {
  it('enriches Tier <=2 entities with empty compiled_truth', async () => {
    await withDb(async () => {
      // 'meeting' source triggers tier 1 per computeTier.
      await upsertEntityPage(PROJECT_ID, 'Anthropic', 'company', 'meeting', 'AI safety company');
    });

    const result = await withDb(() =>
      enrichStaleEntities(PROJECT_ID, { maxEntities: 5, minTier: 2 }),
    );

    expect(result.attempted).toBeGreaterThanOrEqual(1);
    expect(result.succeeded).toBeGreaterThanOrEqual(1);
    // totalCostUsd includes spentBefore (today's prior spend) + new spend.
    expect(result.totalCostUsd).toBeGreaterThan(0);
    expect(result.failed).toBe(0);

    // Verify compiled_truth was actually written.
    const row = await withDb(async () => {
      const res = await db.query<Record<string, unknown>>(
        `SELECT compiled_truth FROM entity_pages WHERE project_id = ? AND slug = ?`,
        [PROJECT_ID, 'companies/anthropic'],
      );
      return res.rows[0];
    });
    expect(String(row?.compiled_truth ?? '')).toContain('Anthropic');
  });

  it('does not fail when tier-3 entities exist but do not match the filter', async () => {
    await withDb(async () => {
      // 'decision' source + single mention -> tier 3.
      await upsertEntityPage(PROJECT_ID, 'ObscureCo', 'company', 'decision', 'Brief mention');
    });

    const result = await withDb(() =>
      enrichStaleEntities(PROJECT_ID, { maxEntities: 5, minTier: 2 }),
    );

    // ObscureCo is tier 3 and must be skipped. The Anthropic row from the
    // previous test now has a non-empty compiled_truth but its updated_at is
    // very recent, so (compiled_truth IS NULL OR '' OR stale) is false and it
    // is also excluded. No failures expected.
    expect(result.failed).toBe(0);

    // Confirm ObscureCo was not enriched.
    const row = await withDb(async () => {
      const res = await db.query<Record<string, unknown>>(
        `SELECT compiled_truth FROM entity_pages WHERE project_id = ? AND slug = ?`,
        [PROJECT_ID, 'companies/obscureco'],
      );
      return res.rows[0];
    });
    expect(row?.compiled_truth == null || row?.compiled_truth === '').toBe(true);
  });

  it('returns early when no provider is configured', async () => {
    const spy = vi.spyOn(providerMod, 'getEnrichmentProvider').mockReturnValue(null);
    try {
      const result = await withDb(() =>
        enrichStaleEntities(PROJECT_ID, { maxEntities: 5 }),
      );
      expect(result.attempted).toBe(0);
      expect(result.succeeded).toBe(0);
      expect(result.skipped.length).toBeGreaterThan(0);
      expect(result.skipped[0]).toMatch(/no enrichment provider/i);
    } finally {
      spy.mockRestore();
    }
  });

  it('does nothing when no stale entities exist', async () => {
    const result = await withDb(() =>
      enrichStaleEntities(EMPTY_PROJECT_ID, { maxEntities: 5 }),
    );
    expect(result.attempted).toBe(0);
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(0);
  });
});
