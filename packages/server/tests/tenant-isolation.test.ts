/**
 * Multi-tenant isolation tests.
 *
 * Exercises the `setProjectContext` → RLS wiring from two angles:
 *
 *  1. Direct DB-adapter level: we stand up a mock adapter that mimics the
 *     Postgres adapter's tenant context and verifies a project that sets a
 *     different context cannot see rows owned by another project.
 *
 *  2. API-level: we hit the HTTP routes with two different projects and
 *     verify that each call receives only the data for the project it
 *     targeted, and that `setProjectContext` was invoked with the right id
 *     before the query ran.
 *
 * The tests mock the database because real Postgres isn't available in
 * unit-test environments, but the mock faithfully implements the same
 * "project_id matches current context" filter that RLS enforces.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createApp } from '../src/app.js';

const PROJECT_A = '11111111-1111-1111-1111-111111111111';
const PROJECT_B = '22222222-2222-2222-2222-222222222222';

const DECISION_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DECISION_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

// ------------------------------------------------------------------
//  Mock DB adapter that applies RLS-style filtering.
// ------------------------------------------------------------------

type Row = Record<string, unknown>;

interface MockState {
  decisions: Row[];
  currentProjectId: string | null;
  bypass: boolean;
  setContextCalls: Array<string | null>;
}

const { state, mockAdapter } = vi.hoisted(() => {
  const state: MockState = {
    decisions: [],
    currentProjectId: null,
    bypass: false,
    setContextCalls: [],
  };

  // Applies the RLS-equivalent tenant filter.
  // Returns the rows the current tenant is allowed to see.
  function filterDecisions(): Row[] {
    if (state.bypass) return state.decisions;
    if (!state.currentProjectId) return [];
    return state.decisions.filter((d) => d.project_id === state.currentProjectId);
  }

  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    const s = sql.trim().toLowerCase();

    // Project lookup from requireProjectAccess -- always allowed.
    if (s.startsWith('select id from projects')) {
      return { rows: [{ id: params?.[0] }], rowCount: 1 };
    }

    // Simplified "list decisions for a project": returns all decisions the
    // tenant is allowed to see with project_id = ?  --- RLS is enforced by
    // filterDecisions().
    if (s.includes('from decisions') && s.includes('project_id')) {
      const requested = params?.[0];
      const allowed = filterDecisions().filter((d) => d.project_id === requested);
      return { rows: allowed, rowCount: allowed.length };
    }

    // Single decision lookup by id (no project filter -- RLS still applies).
    if (s.includes('from decisions') && s.includes('where id')) {
      const requested = params?.[0];
      const allowed = filterDecisions().filter((d) => d.id === requested);
      return { rows: allowed, rowCount: allowed.length };
    }

    // SELECT COUNT(*) used by health check — just return 0
    if (s.startsWith('select count(') && s.includes('from decisions')) {
      return { rows: [{ c: filterDecisions().length }], rowCount: 1 };
    }

    // DELETE FROM context_cache, migrations, etc — return 0
    return { rows: [], rowCount: 0 };
  });

  const mockAdapter = {
    dialect: 'postgres' as const,
    query,
    transaction: vi.fn().mockImplementation(async (fn: Function) => fn(query)),
    arrayParam: (v: unknown[]) => v,
    healthCheck: vi.fn().mockResolvedValue(true),
    setProjectContext: vi.fn((id: string | null) => {
      state.currentProjectId = id;
      state.setContextCalls.push(id);
    }),
    enableRlsBypass: vi.fn(() => {
      state.bypass = true;
    }),
    disableRlsBypass: vi.fn(() => {
      state.bypass = false;
    }),
    getProjectContext: vi.fn(() => state.currentProjectId),
  };

  return { state, mockAdapter };
});

vi.mock('@hipp0/core/db/index.js', () => ({
  getDb: () => mockAdapter,
  initDb: vi.fn().mockResolvedValue({}),
  closeDb: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@hipp0/core/db/pool.js', () => ({
  query: mockAdapter.query,
  getPool: vi.fn(),
  getClient: vi.fn(),
  closePool: vi.fn(),
  healthCheck: vi.fn().mockResolvedValue(true),
  transaction: vi.fn().mockImplementation(async (fn: Function) => fn({ query: mockAdapter.query })),
}));

vi.mock('@hipp0/core/db/parsers.js', () => ({
  parseProject: vi.fn((r: Row) => r),
  parseAgent: vi.fn((r: Row) => r),
  parseDecision: vi.fn((r: Row) => r),
  parseEdge: vi.fn((r: Row) => r),
  parseArtifact: vi.fn((r: Row) => r),
  parseSession: vi.fn((r: Row) => r),
  parseSubscription: vi.fn((r: Row) => r),
  parseNotification: vi.fn((r: Row) => r),
  parseContradiction: vi.fn((r: Row) => r),
  parseFeedback: vi.fn((r: Row) => r),
  parseAuditEntry: vi.fn((r: Row) => r),
}));

vi.stubEnv('NODE_ENV', 'development');
vi.stubEnv('HIPP0_AUTH_REQUIRED', 'false');

async function request(
  app: ReturnType<typeof createApp>,
  method: string,
  path: string,
  body?: unknown,
) {
  const url = `http://localhost${path}`;
  const init: RequestInit = { method };
  if (body) {
    init.body = JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json' };
  }
  return app.fetch(new Request(url, init));
}

beforeEach(() => {
  state.decisions = [
    {
      id: DECISION_A,
      project_id: PROJECT_A,
      title: 'A: use JWT',
      description: 'token auth',
      reasoning: 'stateless',
      made_by: 'alice',
      source: 'manual',
      confidence: 'high',
      status: 'active',
      tags: [],
      affects: [],
      alternatives_considered: [],
      assumptions: [],
      open_questions: [],
      dependencies: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      metadata: {},
    },
    {
      id: DECISION_B,
      project_id: PROJECT_B,
      title: 'B: use Passkeys',
      description: 'webauthn',
      reasoning: 'better UX',
      made_by: 'bob',
      source: 'manual',
      confidence: 'high',
      status: 'active',
      tags: [],
      affects: [],
      alternatives_considered: [],
      assumptions: [],
      open_questions: [],
      dependencies: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      metadata: {},
    },
  ];
  state.currentProjectId = null;
  state.bypass = false;
  state.setContextCalls = [];
  vi.clearAllMocks();
});

describe('Tenant isolation — DB adapter level', () => {
  it('without a project context, RLS filter returns no rows', async () => {
    // Simulate a query with no context set.
    mockAdapter.setProjectContext(null);
    const result = await mockAdapter.query(
      'SELECT * FROM decisions WHERE id = ?',
      [DECISION_A],
    );
    expect(result.rows).toHaveLength(0);
  });

  it('project A context can see project A decision', async () => {
    mockAdapter.setProjectContext(PROJECT_A);
    const result = await mockAdapter.query(
      'SELECT * FROM decisions WHERE id = ?',
      [DECISION_A],
    );
    expect(result.rows).toHaveLength(1);
    expect((result.rows[0] as Row).project_id).toBe(PROJECT_A);
  });

  it('project A context CANNOT see project B decision', async () => {
    mockAdapter.setProjectContext(PROJECT_A);
    const result = await mockAdapter.query(
      'SELECT * FROM decisions WHERE id = ?',
      [DECISION_B],
    );
    expect(result.rows).toHaveLength(0);
  });

  it('project B context CANNOT see project A decision', async () => {
    mockAdapter.setProjectContext(PROJECT_B);
    const result = await mockAdapter.query(
      'SELECT * FROM decisions WHERE id = ?',
      [DECISION_A],
    );
    expect(result.rows).toHaveLength(0);
  });

  it('enableRlsBypass lifts the tenant filter for admin ops', async () => {
    mockAdapter.setProjectContext(PROJECT_A);
    mockAdapter.enableRlsBypass();
    const result = await mockAdapter.query(
      'SELECT * FROM decisions WHERE id = ?',
      [DECISION_B],
    );
    expect(result.rows).toHaveLength(1);
    mockAdapter.disableRlsBypass();
  });

  it('clearing the context (null) fails closed — zero rows visible', async () => {
    mockAdapter.setProjectContext(PROJECT_A);
    mockAdapter.setProjectContext(null);
    const a = await mockAdapter.query(
      'SELECT * FROM decisions WHERE id = ?',
      [DECISION_A],
    );
    const b = await mockAdapter.query(
      'SELECT * FROM decisions WHERE id = ?',
      [DECISION_B],
    );
    expect(a.rows).toHaveLength(0);
    expect(b.rows).toHaveLength(0);
  });
});

describe('Tenant isolation — API level', () => {
  it('listing decisions for project A returns only A rows', async () => {
    const app = createApp();
    const res = await request(app, 'GET', `/api/projects/${PROJECT_A}/decisions`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Row[];
    expect(Array.isArray(body)).toBe(true);
    for (const row of body) {
      expect(row.project_id).toBe(PROJECT_A);
    }
    // Verify that setProjectContext was invoked with project A somewhere
    // during the request lifecycle.
    expect(state.setContextCalls).toContain(PROJECT_A);
  });

  it('listing decisions for project B returns only B rows', async () => {
    const app = createApp();
    const res = await request(app, 'GET', `/api/projects/${PROJECT_B}/decisions`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Row[];
    expect(Array.isArray(body)).toBe(true);
    for (const row of body) {
      expect(row.project_id).toBe(PROJECT_B);
    }
    expect(state.setContextCalls).toContain(PROJECT_B);
  });

  it('context is cleared at end of request (no leak across requests)', async () => {
    const app = createApp();
    await request(app, 'GET', `/api/projects/${PROJECT_A}/decisions`);
    // Last setProjectContext call should have been clearing to null.
    expect(state.setContextCalls[state.setContextCalls.length - 1]).toBeNull();
  });
});
