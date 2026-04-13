/**
 * Passive Decision Capture Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
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
}));

vi.mock('@hipp0/core/db/pool.js', () => ({
  query: mockQuery, getPool: vi.fn(), getClient: vi.fn(), closePool: vi.fn(),
  healthCheck: vi.fn().mockResolvedValue(true),
  transaction: vi.fn().mockImplementation(async (fn: Function) => fn({ query: mockQuery })),
}));

vi.mock('@hipp0/core/db/parsers.js', () => ({
  parseProject: vi.fn((r: Record<string, unknown>) => r),
  parseAgent: vi.fn((r: Record<string, unknown>) => r),
  parseDecision: vi.fn((r: Record<string, unknown>) => r),
  parseEdge: vi.fn((r: Record<string, unknown>) => r),
  parseArtifact: vi.fn((r: Record<string, unknown>) => r),
  parseSession: vi.fn((r: Record<string, unknown>) => r),
  parseSubscription: vi.fn((r: Record<string, unknown>) => r),
  parseNotification: vi.fn((r: Record<string, unknown>) => r),
  parseContradiction: vi.fn((r: Record<string, unknown>) => r),
  parseFeedback: vi.fn((r: Record<string, unknown>) => r),
  parseAuditEntry: vi.fn((r: Record<string, unknown>) => r),
}));

const mockDistill = vi.fn();
vi.mock('@hipp0/core/distillery/index.js', () => ({
  distill: (...args: unknown[]) => mockDistill(...args),
  extractDecisions: vi.fn().mockResolvedValue([]),
  deduplicateDecisions: vi.fn().mockResolvedValue([]),
  detectContradictions: vi.fn().mockResolvedValue([]),
  integrateDecisions: vi.fn().mockResolvedValue([]),
  createSessionSummary: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@hipp0/core/webhooks/index.js', () => ({
  dispatchWebhooks: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@hipp0/core/context-compiler/index.js', () => ({
  compileContext: vi.fn().mockResolvedValue({
    agent: { name: 'builder', role: 'builder' },
    task: 'test',
    compiled_at: new Date().toISOString(),
    token_count: 100,
    budget_used_pct: 1,
    decisions: [],
    artifacts: [],
    notifications: [],
    recent_sessions: [],
    formatted_markdown: '',
    formatted_json: '{}',
    decisions_considered: 0,
    decisions_included: 0,
    relevance_threshold_used: 0,
    compilation_time_ms: 5,
  }),
}));

vi.mock('@hipp0/core/decision-graph/embeddings.js', () => ({
  generateEmbedding: vi.fn().mockResolvedValue(null),
}));

vi.mock('@hipp0/core/change-propagator/index.js', () => ({
  propagateChange: vi.fn().mockResolvedValue(undefined),
  invalidateCache: vi.fn().mockResolvedValue(undefined),
  matchSubscriptions: vi.fn().mockResolvedValue([]),
  createSubscription: vi.fn().mockResolvedValue({}),
  getSubscriptions: vi.fn().mockResolvedValue([]),
  deleteSubscription: vi.fn().mockResolvedValue(true),
  getNotifications: vi.fn().mockResolvedValue([]),
  markNotificationRead: vi.fn().mockResolvedValue({}),
}));

vi.mock('@hipp0/core/contradiction-detector/index.js', () => ({
  checkForContradictions: vi.fn().mockResolvedValue([]),
}));

vi.mock('@hipp0/core/memory/session-manager.js', () => ({
  startSession: vi.fn().mockResolvedValue({ session_id: 'test-session-id', title: 'test' }),
  recordStep: vi.fn().mockResolvedValue({ step_id: 'step-1', step_number: 1 }),
  getSessionContext: vi.fn().mockResolvedValue({}),
  getSessionState: vi.fn().mockResolvedValue({ session: { project_id: 'proj-1', agents_involved: [], current_step: 0 }, steps: [] }),
  updateSessionStatus: vi.fn().mockResolvedValue({ project_id: 'proj-1' }),
  listProjectSessions: vi.fn().mockResolvedValue([]),
}));

vi.mock('@hipp0/core/intelligence/role-signals.js', () => ({
  generateRoleSignal: vi.fn().mockResolvedValue({}),
  generateRoleSuggestion: vi.fn().mockResolvedValue({}),
  scoreTeamForTask: vi.fn().mockResolvedValue({ recommended_participants: [], recommended_skip: [], optimal_team_size: 1, task_description: '' }),
}));

vi.mock('@hipp0/core/intelligence/orchestrator.js', () => ({
  suggestNextAgent: vi.fn().mockResolvedValue({}),
  generateSessionPlan: vi.fn().mockResolvedValue({}),
  generateTaskSuggestion: vi.fn().mockResolvedValue(''),
  buildReasoningExplanation: vi.fn().mockReturnValue(''),
}));

vi.stubEnv('NODE_ENV', 'development');
vi.stubEnv('HIPP0_AUTH_REQUIRED', 'false');

vi.mock('../src/cache/redis.js', () => ({
  cache: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    invalidatePrefix: vi.fn().mockResolvedValue(undefined),
  },
  CACHE_TTL: { COMPILE: 300 },
}));

//
// Helpers
//

const PROJECT_ID = '550e8400-e29b-41d4-a716-446655440000';
const CAPTURE_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

function jsonReq(path: string, body: unknown, method = 'POST') {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function getReq(path: string) {
  return new Request(`http://localhost${path}`, { method: 'GET' });
}

//
// Tests
//

describe('Passive Decision Capture', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockReset();
    mockDistill.mockReset();
    // Default: all queries return empty results (safe fallback for logAudit, middleware, etc.)
    mockQuery.mockResolvedValue({ rows: [] });
    mockDistill.mockResolvedValue({ decisions_extracted: 0, contradictions_found: 0, decisions: [], session_summary: undefined });
    app = createApp();
  });

  describe('POST /api/capture', () => {
    it('returns immediately with capture_id and processing status', async () => {
      // Ordered mocks for specific queries (beforeEach sets default { rows: [] })
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: PROJECT_ID, metadata: '{}' }] }) // SELECT id, metadata FROM projects
        .mockResolvedValueOnce({ rows: [] }) // checkExactDuplicate (no dup found)
        .mockResolvedValueOnce({ rows: [{ id: CAPTURE_ID }] }); // INSERT INTO captures RETURNING id

      // Mock distill (background, may fire after response)
      mockDistill.mockResolvedValue({
        decisions_extracted: 2,
        contradictions_found: 0,
        decisions: [
          { id: 'dec-1', title: 'Use React', source: 'auto_capture' },
          { id: 'dec-2', title: 'Use TypeScript', source: 'auto_capture' },
        ],
        session_summary: undefined,
      });

      const res = await app.fetch(
        jsonReq('/api/capture', {
          agent_name: 'maks',
          project_id: PROJECT_ID,
          conversation: 'We decided to use React for the frontend and TypeScript for type safety.',
          source: 'api',
        }),
      );

      expect(res.status).toBe(202);
      // Retry-After signals the recommended initial poll cadence for the
      // Hermes provider (and any other client) polling GET /api/capture/:id.
      expect(res.headers.get('Retry-After')).toBe('1');
      const body = await res.json();
      expect(body.capture_id).toBe(CAPTURE_ID);
      expect(body.status).toBe('processing');
    });

    it('rejects invalid source', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ id: PROJECT_ID, metadata: '{}' }] });

      const res = await app.fetch(
        jsonReq('/api/capture', {
          agent_name: 'maks',
          project_id: PROJECT_ID,
          conversation: 'test',
          source: 'invalid_source',
        }),
      );

      expect(res.status).toBe(400);
    });

    it('rejects missing required fields', async () => {
      const res = await app.fetch(
        jsonReq('/api/capture', {
          project_id: PROJECT_ID,
          conversation: 'test',
          // missing agent_name
        }),
      );

      expect(res.status).toBe(400);
    });

    it('returns 404 when project not found', async () => {
      // Project does not exist - query returns empty
      mockQuery.mockReset();
      mockQuery.mockResolvedValue({ rows: [] });

      const res = await app.fetch(
        jsonReq('/api/capture', {
          agent_name: 'maks',
          project_id: PROJECT_ID,
          conversation: 'test conversation',
          source: 'api',
        }),
      );

      // Should be 404 since project doesn't exist
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/capture/:id', () => {
    it('returns capture status with decision count', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: CAPTURE_ID,
          project_id: PROJECT_ID,
          agent_name: 'maks',
          session_id: null,
          source: 'api',
          status: 'completed',
          extracted_decision_ids: '["dec-1","dec-2"]',
          error_message: null,
          created_at: '2026-04-08T10:00:00.000Z',
          completed_at: '2026-04-08T10:00:05.000Z',
        }],
      });

      const res = await app.fetch(getReq(`/api/capture/${CAPTURE_ID}`));
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.id).toBe(CAPTURE_ID);
      expect(body.status).toBe('completed');
      expect(body.extracted_decision_count).toBe(2);
      expect(body.extracted_decision_ids).toEqual(['dec-1', 'dec-2']);
      expect(body.completed_at).toBeTruthy();
    });

    it('returns 404 for unknown capture', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const res = await app.fetch(getReq(`/api/capture/${CAPTURE_ID}`));
      expect(res.status).toBe(404);
    });

    it('handles processing status', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: CAPTURE_ID,
          project_id: PROJECT_ID,
          agent_name: 'maks',
          session_id: null,
          source: 'slack',
          status: 'processing',
          extracted_decision_ids: '[]',
          error_message: null,
          created_at: '2026-04-08T10:00:00.000Z',
          completed_at: null,
        }],
      });

      const res = await app.fetch(getReq(`/api/capture/${CAPTURE_ID}`));
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.status).toBe('processing');
      expect(body.extracted_decision_count).toBe(0);
      expect(body.completed_at).toBeNull();
    });
  });

  describe('GET /api/projects/:id/captures', () => {
    it('returns list of captures for a project', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: CAPTURE_ID,
            project_id: PROJECT_ID,
            agent_name: 'maks',
            session_id: null,
            source: 'api',
            status: 'completed',
            extracted_decision_ids: '["dec-1"]',
            error_message: null,
            created_at: '2026-04-08T10:00:00.000Z',
            completed_at: '2026-04-08T10:00:05.000Z',
          },
        ],
      });

      const res = await app.fetch(getReq(`/api/projects/${PROJECT_ID}/captures`));
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBe(1);
      expect(body[0].id).toBe(CAPTURE_ID);
      expect(body[0].extracted_decision_count).toBe(1);
    });
  });

  describe('Project settings', () => {
    it('returns auto_capture setting with default false', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ metadata: '{}' }],
      });

      const res = await app.fetch(getReq(`/api/projects/${PROJECT_ID}/settings`));
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.auto_capture).toBe(false);
    });

    it('updates auto_capture setting', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ metadata: '{}' }] }) // read current
        .mockResolvedValueOnce({ rows: [] }); // update

      const res = await app.fetch(
        jsonReq(`/api/projects/${PROJECT_ID}/settings`, { auto_capture: true }, 'PATCH'),
      );
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.auto_capture).toBe(true);
    });
  });
});
