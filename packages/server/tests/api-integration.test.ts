/**
 * Integration tests for all major API routes.
 *
 * Uses Hono test client with mocked DB — no real database required.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createApp } from '../src/app.js';

  // DB Mock

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
}));

vi.mock('@hipp0/core/db/parsers.js', () => ({
  parseProject: vi.fn((row: Record<string, unknown>) => row),
  parseAgent: vi.fn((row: Record<string, unknown>) => row),
  parseDecision: vi.fn((row: Record<string, unknown>) => ({
    ...row,
    tags: Array.isArray(row.tags) ? row.tags : [],
    affects: Array.isArray(row.affects) ? row.affects : [],
  })),
  parseEdge: vi.fn((row: Record<string, unknown>) => row),
  parseArtifact: vi.fn((row: Record<string, unknown>) => row),
  parseSession: vi.fn((row: Record<string, unknown>) => row),
  parseSubscription: vi.fn((row: Record<string, unknown>) => row),
  parseNotification: vi.fn((row: Record<string, unknown>) => row),
  parseContradiction: vi.fn((row: Record<string, unknown>) => row),
  parseFeedback: vi.fn((row: Record<string, unknown>) => row),
  parseAuditEntry: vi.fn((row: Record<string, unknown>) => row),
}));

// Mock cache
vi.mock('../src/cache/redis.js', () => ({
  cache: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    del: vi.fn().mockResolvedValue(undefined),
    invalidatePrefix: vi.fn().mockResolvedValue(0),
    close: vi.fn().mockResolvedValue(undefined),
  },
  invalidateDecisionCaches: vi.fn().mockResolvedValue(undefined),
  compileKey: vi.fn().mockReturnValue('compile:test'),
  projectStatsKey: vi.fn().mockReturnValue('stats:test'),
  agentListKey: vi.fn().mockReturnValue('agents:test'),
  CACHE_TTL: { COMPILE: 300, PROJECT_STATS: 60, AGENT_LIST: 300 },
}));

// Mock external modules
vi.mock('@hipp0/core/context-compiler/index.js', () => ({
  compileContext: vi.fn().mockResolvedValue({
    decisions: [],
    decisions_included: 0,
    decisions_considered: 0,
    compilation_time_ms: 42,
    formatted_markdown: '# Context\nNo decisions.',
    token_count: 10,
  }),
}));

vi.mock('@hipp0/core/change-propagator/index.js', () => ({
  propagateChange: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@hipp0/core/contradiction-detector/index.js', () => ({
  checkForContradictions: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@hipp0/core/webhooks/index.js', () => ({
  dispatchWebhooks: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@hipp0/core/dependency-cascade/index.js', () => ({
  findCascadeImpact: vi.fn().mockResolvedValue({ total_affected: 0, impacts: [], changed_decision_title: '' }),
  notifyCascade: vi.fn().mockResolvedValue(undefined),
}));

vi.stubEnv('NODE_ENV', 'development');
vi.stubEnv('HIPP0_AUTH_REQUIRED', 'false');

  // Helpers

async function request(
  app: ReturnType<typeof createApp>,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  const url = `http://localhost${path}`;
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json' };
  }
  return app.fetch(new Request(url, init));
}

const PROJECT_ID = '44c6cebd-b6ff-47b7-ad93-52925bf26eb0';

  // Tests

describe('API Integration Tests', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    mockQuery.mockReset();
    app = createApp();
  });

    // Health
  describe('Health Endpoints', () => {
    it('GET /api/health returns ok with enhanced fields', async () => {
      mockQuery.mockResolvedValue({ rows: [{ '?column?': 1 }] });
      const res = await request(app, 'GET', '/api/health');
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBe('ok');
      expect(data).toHaveProperty('db_latency_ms');
      expect(data).toHaveProperty('uptime_seconds');
      expect(data).toHaveProperty('node_env');
      expect(data).toHaveProperty('version');
    });

    it('GET /api/health/live always returns 200', async () => {
      const res = await request(app, 'GET', '/api/health/live');
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBe('ok');
    });

    it('GET /api/health/ready checks DB', async () => {
      mockQuery.mockResolvedValue({ rows: [{ '?column?': 1 }] });
      const res = await request(app, 'GET', '/api/health/ready');
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBe('ready');
    });
  });

    // Projects
  describe('Projects', () => {
    it('GET /api/projects returns list', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ id: PROJECT_ID, name: 'Test', description: 'desc', created_at: new Date().toISOString() }],
      });
      const res = await request(app, 'GET', '/api/projects');
      expect(res.status).toBe(200);
    });

    it('POST /api/projects creates a project', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ id: PROJECT_ID, name: 'New', description: 'test', created_at: new Date().toISOString() }],
      });
      const res = await request(app, 'POST', '/api/projects', {
        name: 'New',
        description: 'test',
      });
      expect(res.status).toBe(201);
    });
  });

    // Decisions CRUD
  describe('Decisions', () => {
    it('GET /api/projects/:id/decisions returns list', async () => {
      // First call = count, second call = list
      mockQuery
        .mockResolvedValueOnce({ rows: [{ total: '0' }] })
        .mockResolvedValueOnce({ rows: [] });
      const res = await request(app, 'GET', `/api/projects/${PROJECT_ID}/decisions`);
      expect(res.status).toBe(200);
    });

    it('POST /api/projects/:id/decisions creates a decision', async () => {
      mockQuery.mockResolvedValue({
        rows: [{
          id: crypto.randomUUID(),
          project_id: PROJECT_ID,
          title: 'Test Decision',
          description: 'Test',
          reasoning: 'Test',
          made_by: 'human',
          status: 'active',
          tags: ['test'],
          affects: ['agent1'],
          created_at: new Date().toISOString(),
        }],
      });
      const res = await request(app, 'POST', `/api/projects/${PROJECT_ID}/decisions`, {
        title: 'Test Decision',
        description: 'Test',
        made_by: 'human',
        tags: ['test'],
        affects: ['agent1'],
      });
      expect([200, 201]).toContain(res.status);
    });
  });

    // Compile
  describe('Compile', () => {
    it('POST /api/compile returns compiled context', async () => {
      mockQuery.mockResolvedValue({ rows: [{ id: 'agent1' }], rowCount: 0 });
      const res = await request(app, 'POST', '/api/compile?format=json', {
        agent_name: 'backend-engineer',
        project_id: PROJECT_ID,
        task_description: 'implement auth',
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveProperty('compile_request_id');
    });
  });

    // Metrics
  describe('Metrics', () => {
    it('GET /api/metrics returns operational counters', async () => {
      mockQuery.mockResolvedValue({ rows: [{ c: '5', avg_ms: '42.5' }] });
      const res = await request(app, 'GET', '/api/metrics');
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveProperty('decisions_today');
      expect(data).toHaveProperty('compiles_today');
      expect(data).toHaveProperty('avg_compile_ms');
    });
  });

    // Request ID
  describe('Request ID', () => {
    it('adds X-Request-Id header to responses', async () => {
      mockQuery.mockResolvedValue({ rows: [{ '?column?': 1 }] });
      const res = await request(app, 'GET', '/api/health');
      const requestId = res.headers.get('X-Request-Id');
      expect(requestId).toBeTruthy();
      // Should be a valid UUID format
      expect(requestId).toMatch(/^[0-9a-f-]{36}$/i);
    });

    it('propagates provided X-Request-Id', async () => {
      mockQuery.mockResolvedValue({ rows: [{ '?column?': 1 }] });
      const customId = '12345678-1234-1234-1234-123456789abc';
      const res = await app.fetch(
        new Request('http://localhost/api/health', {
          headers: { 'X-Request-Id': customId },
        }),
      );
      expect(res.headers.get('X-Request-Id')).toBe(customId);
    });
  });
});
