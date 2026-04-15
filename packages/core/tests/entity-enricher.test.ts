/**
 * Entity Enricher Tests
 *
 * Uses a real in-memory SQLite database (same pattern as sqlite-integration.test.ts)
 * with withDbOverride so getDb() inside entity-enricher.ts returns the test adapter.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SQLiteAdapter } from '../src/db/sqlite-adapter.js';
import { withDbOverride } from '../src/db/index.js';
import {
  upsertEntityPage,
  propagateOutcomeToEntities,
  getEntityPage,
  searchEntityPages,
} from '../src/intelligence/entity-enricher.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let db: SQLiteAdapter;

beforeAll(async () => {
  db = new SQLiteAdapter(':memory:');
  await db.connect();

  const migrationsDir = path.join(__dirname, '..', 'src', 'db', 'migrations', 'sqlite');
  await db.runMigrations(migrationsDir);

  // Insert placeholder project rows so FK constraints are satisfied
  for (const [id, name] of [
    ['test-project-entity-1', 'EP Test 1'],
    ['test-project-entity-2', 'EP Test 2'],
    ['test-project-entity-3', 'EP Test 3'],
    ['test-project-entity-4', 'EP Test 4'],
    ['test-project-entity-5', 'EP Test 5'],
  ]) {
    await db.query(
      `INSERT OR IGNORE INTO projects (id, name) VALUES (?, ?)`,
      [id, name],
    );
  }

  // Insert placeholder decisions so entity_decision_links FK is satisfied
  for (const [id, pid] of [
    ['decision-entity-test-1', 'test-project-entity-4'],
    ['decision-entity-test-2', 'test-project-entity-4'],
    ['fake-decision-id-react', 'test-project-entity-1'],
  ]) {
    await db.query(
      `INSERT OR IGNORE INTO decisions
         (id, project_id, title, description, reasoning, made_by)
       VALUES (?, ?, 'Test Decision', 'desc', 'reason', 'tester')`,
      [id, pid],
    );
  }
});

afterAll(async () => {
  await db.close();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Run fn inside the test DB override so getDb() resolves to our adapter. */
function withDb<T>(fn: () => Promise<T>): Promise<T> {
  return withDbOverride(db, fn);
}

// ---------------------------------------------------------------------------
// upsertEntityPage
// ---------------------------------------------------------------------------

describe('upsertEntityPage', () => {
  it('creates a new entity page on first encounter', async () => {
    const result = await withDb(() =>
      upsertEntityPage(
        'test-project-entity-1',
        'Jane Doe',
        'person',
        'decision',
        'Mentioned in architecture decision about auth',
      ),
    );
    expect(result.action).toBe('created');
    expect(result.entity.title).toBe('Jane Doe');
    expect(result.entity.tier).toBe(3);
    expect(result.entity.mention_count).toBe(1);
    expect(result.tier_changed).toBe(false);
  });

  it('generates a slug in the form <type>s/<normalized-title>', async () => {
    const result = await withDb(() =>
      upsertEntityPage(
        'test-project-entity-1',
        'Alice Smith!',
        'person',
        'decision',
        'Another person',
      ),
    );
    expect(result.entity.slug).toBe('persons/alice-smith');
  });

  it('updates mention count on subsequent encounters', async () => {
    const projectId = 'test-project-entity-2';
    await withDb(() =>
      upsertEntityPage(projectId, 'OpenAI', 'company', 'decision', 'First mention'),
    );
    const result = await withDb(() =>
      upsertEntityPage(projectId, 'OpenAI', 'company', 'decision', 'Second mention'),
    );
    expect(result.action).toBe('updated');
    expect(result.entity.mention_count).toBe(2);
  });

  it('promotes to Tier 1 after 8 mentions', async () => {
    const projectId = 'test-project-entity-3';
    for (let i = 0; i < 8; i++) {
      await withDb(() =>
        upsertEntityPage(projectId, 'PostgreSQL', 'tool', 'decision', `Mention ${i}`),
      );
    }
    const entity = await withDb(() => getEntityPage(projectId, 'tools/postgresql'));
    expect(entity?.tier).toBe(1);
  });

  it('promotes to Tier 1 on meeting source', async () => {
    const projectId = 'test-project-entity-1';
    const result = await withDb(() =>
      upsertEntityPage(
        projectId,
        'VoiceBot',
        'tool',
        'meeting',
        'Discussed in meeting',
      ),
    );
    expect(result.entity.tier).toBe(1);
  });

  it('records a decision link when decisionId is provided', async () => {
    const projectId = 'test-project-entity-1';
    // 'fake-decision-id-react' was pre-inserted in beforeAll to satisfy FK
    await withDb(() =>
      upsertEntityPage(projectId, 'React', 'tool', 'decision', 'UI framework', {
        decisionId: 'fake-decision-id-react',
        linkType: 'affects',
      }),
    );
    const rows = await db.query(
      `SELECT * FROM entity_decision_links WHERE decision_id = ?`,
      ['fake-decision-id-react'],
    );
    expect(rows.rows.length).toBeGreaterThan(0);
    expect((rows.rows[0] as any).link_type).toBe('affects');
  });
});

// ---------------------------------------------------------------------------
// propagateOutcomeToEntities
// ---------------------------------------------------------------------------

describe('propagateOutcomeToEntities', () => {
  it('decreases trust_score after multiple negative outcomes', async () => {
    const projectId = 'test-project-entity-4';

    // Create entity linked to a pre-existing decision (inserted in beforeAll)
    await withDb(() =>
      upsertEntityPage(
        projectId,
        'BadVendor',
        'company',
        'decision',
        'Used this vendor',
        {
          decisionId: 'decision-entity-test-1',
          linkType: 'affects',
        },
      ),
    );

    // 3 negative outcomes
    for (let i = 0; i < 3; i++) {
      await withDb(() =>
        propagateOutcomeToEntities(
          projectId,
          'decision-entity-test-1',
          'negative',
          'hermes_outcome',
        ),
      );
    }

    const updated = await withDb(() =>
      getEntityPage(projectId, 'companies/badvendor'),
    );
    expect(updated?.trust_score).toBeLessThan(0.5);
  });

  it('increases trust_score after positive outcomes', async () => {
    const projectId = 'test-project-entity-4';

    await withDb(() =>
      upsertEntityPage(
        projectId,
        'GoodLib',
        'tool',
        'decision',
        'Great library',
        {
          decisionId: 'decision-entity-test-2',
          linkType: 'affects',
        },
      ),
    );

    for (let i = 0; i < 3; i++) {
      await withDb(() =>
        propagateOutcomeToEntities(
          projectId,
          'decision-entity-test-2',
          'positive',
          'hermes_outcome',
        ),
      );
    }

    const updated = await withDb(() =>
      getEntityPage(projectId, 'tools/goodlib'),
    );
    expect(updated?.trust_score).toBeGreaterThan(0.5);
  });
});

// ---------------------------------------------------------------------------
// searchEntityPages
// ---------------------------------------------------------------------------

describe('searchEntityPages', () => {
  it('finds entities by title substring', async () => {
    const projectId = 'test-project-entity-5';
    await withDb(() =>
      upsertEntityPage(projectId, 'Anthropic', 'company', 'decision', 'AI company'),
    );
    const results = await withDb(() => searchEntityPages(projectId, 'anthropic'));
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].title).toBe('Anthropic');
  });

  it('filters by type when specified', async () => {
    const projectId = 'test-project-entity-5';
    await withDb(() =>
      upsertEntityPage(projectId, 'OpenAI Corp', 'company', 'decision', 'Another AI company'),
    );
    await withDb(() =>
      upsertEntityPage(projectId, 'OpenRouter', 'tool', 'decision', 'Router tool'),
    );
    const companies = await withDb(() =>
      searchEntityPages(projectId, 'open', 'company'),
    );
    expect(companies.every((e) => e.type === 'company')).toBe(true);
  });

  it('returns empty array when no match', async () => {
    const projectId = 'test-project-entity-5';
    const results = await withDb(() =>
      searchEntityPages(projectId, 'xyznonexistent99'),
    );
    expect(results).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getEntityPage
// ---------------------------------------------------------------------------

describe('getEntityPage', () => {
  it('returns null for unknown slug', async () => {
    const result = await withDb(() =>
      getEntityPage('test-project-entity-1', 'persons/nobody-ever'),
    );
    expect(result).toBeNull();
  });
});
