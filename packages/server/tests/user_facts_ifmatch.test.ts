// Race test for POST /api/hermes/user-facts atomic If-Match UPDATE.
//
// Simulates 2 concurrent writers that both read version=v0 and send
// If-Match: v0. Exactly one must win (200) and the other must lose (409
// with body.error === 'version_conflict').
//
// The DB mock serialises UPDATEs by inspecting the SQL and mutating a
// shared {version} slot — so the CAS `UPDATE ... WHERE version=?` affects
// zero rows on the second writer, exactly as a real DB would.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createApp } from '../src/app.js';

const { mockQuery } = vi.hoisted(() => {
  const mockQuery = vi.fn();
  return { mockQuery };
});

vi.mock('@hipp0/core/db/index.js', () => ({
  getDb: () => ({
    query: mockQuery,
    transaction: vi.fn().mockImplementation(async (fn: Function) => fn(mockQuery)),
    arrayParam: (v: unknown[]) => JSON.stringify(v),
    healthCheck: vi.fn().mockResolvedValue(true),
    dialect: 'sqlite' as const,
  }),
  initDb: vi.fn().mockResolvedValue({}),
  closeDb: vi.fn().mockResolvedValue(undefined),
  withDbOverride: vi.fn().mockImplementation(async (_adapter: unknown, fn: () => unknown) => fn()),
}));

vi.mock('@hipp0/core/db/pool.js', () => ({
  query: mockQuery,
  getPool: vi.fn(),
  closePool: vi.fn(),
  healthCheck: vi.fn().mockResolvedValue(true),
  transaction: vi.fn().mockImplementation(async (fn: Function) => fn({ query: mockQuery })),
}));

vi.mock('@hipp0/core/db/parsers.js', () => ({
  parseProject: vi.fn((row: Record<string, unknown>) => row),
  parseAgent: vi.fn((row: Record<string, unknown>) => row),
  parseDecision: vi.fn((row: Record<string, unknown>) => row),
  parseEdge: vi.fn((row: Record<string, unknown>) => row),
  parseArtifact: vi.fn((row: Record<string, unknown>) => row),
  parseSession: vi.fn((row: Record<string, unknown>) => row),
  parseSubscription: vi.fn((row: Record<string, unknown>) => row),
  parseNotification: vi.fn((row: Record<string, unknown>) => row),
  parseContradiction: vi.fn((row: Record<string, unknown>) => row),
  parseFeedback: vi.fn((row: Record<string, unknown>) => row),
  parseAuditEntry: vi.fn((row: Record<string, unknown>) => row),
}));

vi.stubEnv('NODE_ENV', 'development');
vi.stubEnv('HIPP0_AUTH_REQUIRED', 'false');

const PROJECT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

async function post(
  app: ReturnType<typeof createApp>,
  path: string,
  body: unknown,
  headers?: Record<string, string>,
): Promise<Response> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (headers) Object.assign(h, headers);
  return app.fetch(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: h,
    }),
  );
}

let app: ReturnType<typeof createApp>;

beforeEach(() => {
  app = createApp();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/hermes/user-facts — atomic If-Match CAS', () => {
  it('two concurrent writers with same If-Match: one 200, one 409', async () => {
    const V0 = 'v0-initial';
    // Shared mutable state that simulates the DB row's version.
    const store = { version: V0 as string };

    mockQuery.mockImplementation(async (sql: string, params: unknown[]) => {
      const s = sql.replace(/\s+/g, ' ').trim();

      // 1. Initial SELECT version (each request reads the current version)
      if (s.startsWith('SELECT version FROM hermes_user_facts')) {
        return { rows: [{ version: store.version }], rowCount: 1, command: '', oid: 0, fields: [] };
      }

      // 2. CAS UPDATE: UPDATE ... SET version = ?, updated_at = ? WHERE ... AND version = ?
      if (s.startsWith('UPDATE hermes_user_facts SET version = ?, updated_at = ? WHERE project_id = ?')) {
        const [newVersion, , , , expectedVersion] = params as [string, string, string, string, string];
        if (store.version === expectedVersion) {
          store.version = newVersion;
          return { rows: [], rowCount: 1, command: '', oid: 0, fields: [] };
        }
        return { rows: [], rowCount: 0, command: '', oid: 0, fields: [] };
      }

      // 3. Per-fact SELECT id (existence check) — return the "existing" row
      //    so the winning request goes through the UPDATE-existing branch.
      if (s.startsWith('SELECT id FROM hermes_user_facts')) {
        return {
          rows: [{ id: 'row-1' }],
          rowCount: 1,
          command: '',
          oid: 0,
          fields: [],
        };
      }

      // 4. Per-fact UPDATE value: UPDATE ... SET value = ?, source = ?, version = ?, updated_at = ? WHERE id = ?
      if (s.startsWith('UPDATE hermes_user_facts SET value = ?, source = ?, version = ?, updated_at = ? WHERE id = ?')) {
        return { rows: [], rowCount: 1, command: '', oid: 0, fields: [] };
      }

      // 5. Snapshot SELECT (final read)
      if (s.startsWith('SELECT key, value, source, updated_at FROM hermes_user_facts')) {
        return {
          rows: [{ key: 'pref', value: 'v', source: null, updated_at: '2026-04-14T00:00:00Z' }],
          rowCount: 1,
          command: '',
          oid: 0,
          fields: [],
        };
      }

      // Default: empty
      return { rows: [], rowCount: 0, command: '', oid: 0, fields: [] };
    });

    const body = {
      project_id: PROJECT_ID,
      external_user_id: 'tg:race',
      facts: [{ key: 'pref', value: 'v' }],
    };

    // Fire two requests "concurrently". Promise.all schedules them on the
    // same tick; since each request's first SELECT runs before either CAS,
    // both read V0 — exactly the race we want to test.
    const [r1, r2] = await Promise.all([
      post(app, '/api/hermes/user-facts', body, { 'If-Match': V0 }),
      post(app, '/api/hermes/user-facts', body, { 'If-Match': V0 }),
    ]);

    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 409]);

    const loser = r1.status === 409 ? r1 : r2;
    const loserBody = (await loser.json()) as { error: string; current_version: string };
    expect(loserBody.error).toBe('version_conflict');
    expect(loserBody.current_version).toBeTruthy();
    // Winner's new version — not V0.
    expect(loserBody.current_version).not.toBe(V0);
  });

  it('returns 409 with current_version when If-Match is stale', async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      const s = sql.replace(/\s+/g, ' ').trim();
      if (s.startsWith('SELECT version FROM hermes_user_facts')) {
        return { rows: [{ version: 'server-v1' }], rowCount: 1, command: '', oid: 0, fields: [] };
      }
      return { rows: [], rowCount: 0, command: '', oid: 0, fields: [] };
    });

    const res = await post(
      app,
      '/api/hermes/user-facts',
      {
        project_id: PROJECT_ID,
        external_user_id: 'tg:stale',
        facts: [{ key: 'pref', value: 'v' }],
      },
      { 'If-Match': 'client-v0' },
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; current_version: string };
    expect(body.error).toBe('version_conflict');
    expect(body.current_version).toBe('server-v1');
  });
});
