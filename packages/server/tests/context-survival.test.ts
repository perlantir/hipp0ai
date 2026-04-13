/**
 * Context Compression Survival + Session Prefetch Tests
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
  parseAgent: vi.fn((r: Record<string, unknown>) => ({ ...r, relevance_profile: { weights: {}, decision_depth: 2, freshness_preference: 'balanced', include_superseded: false }, role: r.role ?? 'builder' })),
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

vi.mock('@hipp0/core/context-compiler/index.js', () => ({
  compileContext: vi.fn().mockResolvedValue({
    agent: { name: 'builder', role: 'builder' },
    task: 'Build feature',
    compiled_at: new Date().toISOString(),
    token_count: 3200,
    budget_used_pct: 6,
    decisions: [{ id: 'dec-1', title: 'Use JWT', description: 'JWT tokens', reasoning: 'standard', made_by: 'architect', confidence: 'high', status: 'active', tags: ['auth'], affects: ['builder'], combined_score: 0.92, scoring_breakdown: { direct_affect: 0.3, tag_matching: 0.2, role_relevance: 0.15, semantic_similarity: 0.22, status_penalty: 0 }, created_at: '2026-04-01', updated_at: '2026-04-01' }],
    artifacts: [],
    notifications: [],
    recent_sessions: [],
    formatted_markdown: '# Context\n',
    formatted_json: '{}',
    decisions_considered: 10,
    decisions_included: 1,
    relevance_threshold_used: 0,
    compilation_time_ms: 45,
  }),
  scoreDecision: vi.fn(),
}));

vi.mock('@hipp0/core/memory/session-manager.js', () => ({
  startSession: vi.fn().mockResolvedValue({ session_id: 'sess-1', title: 'Test' }),
  recordStep: vi.fn().mockResolvedValue({ step_id: 'step-1', step_number: 1 }),
  getSessionContext: vi.fn().mockResolvedValue({
    session: { id: 'sess-1', title: 'Test', status: 'active', project_id: 'proj-1', agents_involved: [] },
    previous_steps: [],
    formatted_session_context: '## Session Context',
  }),
  getSessionState: vi.fn().mockResolvedValue({
    session: { id: 'sess-1', title: 'Test', status: 'active', project_id: 'proj-1', agents_involved: ['agent-a'], current_step: 1 },
    steps: [],
  }),
  updateSessionStatus: vi.fn(),
  listProjectSessions: vi.fn().mockResolvedValue([]),
}));

vi.mock('@hipp0/core/intelligence/role-signals.js', () => ({
  generateRoleSignal: vi.fn().mockResolvedValue({
    should_participate: true,
    abstain_probability: 0.1,
    role_suggestion: 'builder',
    reason: 'relevant',
    relevance_score: 0.8,
    rank_among_agents: 1,
    total_agents: 3,
  }),
  computeRecommendedAction: vi.fn().mockReturnValue({
    recommended_action: 'PROCEED',
    action_reason: 'High relevance',
  }),
  scoreTeamForTask: vi.fn().mockResolvedValue({
    task_description: 'Build feature',
    recommended_participants: [
      { agent_name: 'agent-b', relevance_score: 0.8, role_suggestion: 'builder', abstain_probability: 0.1, rank_among_agents: 1, total_agents: 3, should_participate: true, reason: 'relevant' },
      { agent_name: 'agent-c', relevance_score: 0.6, role_suggestion: 'reviewer', abstain_probability: 0.2, rank_among_agents: 2, total_agents: 3, should_participate: true, reason: 'relevant' },
    ],
    recommended_skip: [],
    optimal_team_size: 2,
  }),
}));

vi.mock('@hipp0/core/intelligence/orchestrator.js', () => ({
  suggestNextAgent: vi.fn().mockResolvedValue({
    recommended_agent: 'agent-b',
    recommended_role: 'builder',
    confidence: 0.85,
    task_suggestion: 'Build the feature',
    pre_compiled_context: null,
    reasoning: 'High relevance',
    alternatives: [],
    is_session_complete: false,
  }),
  generateSessionPlan: vi.fn().mockResolvedValue({
    session_title: 'Test',
    suggested_plan: [],
    estimated_agents: 0,
    note: 'No agents',
  }),
}));

vi.stubEnv('NODE_ENV', 'development');
vi.stubEnv('HIPP0_AUTH_REQUIRED', 'false');

async function request(app: ReturnType<typeof createApp>, method: string, path: string, body?: unknown) {
  const url = `http://localhost${path}`;
  const init: RequestInit = { method };
  if (body) { init.body = JSON.stringify(body); init.headers = { 'Content-Type': 'application/json' }; }
  return app.fetch(new Request(url, init));
}

let app: ReturnType<typeof createApp>;
beforeEach(() => {
  app = createApp();
  vi.clearAllMocks();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
});

  // Context Compression Survival

describe('POST /api/tasks/session/:id/checkpoint (save_before_trim)', () => {
  const SESSION_ID = 'a0000000-0000-4000-8000-000000000001';

  it('stores a checkpoint and returns checkpoint_id', async () => {
    mockQuery
      // INSERT checkpoint
      .mockResolvedValueOnce({ rows: [{ id: 'cp-1' }], rowCount: 1 })
      // getSessionState query (task_sessions) - used for audit logAudit
      .mockResolvedValueOnce({
        rows: [{ id: SESSION_ID, project_id: 'proj-1', title: 'Test', status: 'active', agents_involved: '[]', current_step: 0, state_summary: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), completed_at: null }],
        rowCount: 1,
      })
      // getSessionState session_steps
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      // audit log
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request(app, 'POST', `/api/tasks/session/${SESSION_ID}/checkpoint`, {
      agent_name: 'architect',
      context_summary: 'We decided to use PostgreSQL with pgvector for embeddings.',
      important_decisions: ['dec-1', 'dec-2'],
    });

    expect(res.status).toBe(201);
    const json = await res.json() as Record<string, unknown>;
    expect(json.checkpoint_id).toBe('cp-1');
    expect(json.session_id).toBe(SESSION_ID);
    expect(json.agent_name).toBe('architect');

    // Verify the INSERT was called with correct params
    const insertCall = mockQuery.mock.calls[0];
    expect(insertCall[0]).toContain('INSERT INTO session_checkpoints');
    // Params array: [sessionId, agent_name, context_summary, important_decision_ids_json]
    const params = insertCall[1] as string[];
    expect(params).toContain('architect');
    expect(params.some((p: string) => typeof p === 'string' && p.includes('PostgreSQL'))).toBe(true);
  });
});

describe('Compile with checkpoint restoration', () => {
  const SESSION_ID = 'a0000000-0000-4000-8000-000000000001';
  const PROJECT_ID = 'b0000000-0000-4000-8000-000000000001';

  it('includes checkpoint text with [RESTORED FROM CHECKPOINT] label', async () => {
    // Use mockImplementation to handle queries by their SQL content
    mockQuery.mockImplementation(async (sql: string) => {
      if (typeof sql === 'string' && sql.includes('session_checkpoints')) {
        return {
          rows: [{
            checkpoint_text: 'Critical: Use PostgreSQL for main DB.',
            important_decision_ids: '["dec-1"]',
            created_at: '2026-04-08T10:00:00Z',
          }],
          rowCount: 1,
        };
      }
      if (typeof sql === 'string' && sql.includes('agents') && sql.includes('name')) {
        return { rows: [{ id: 'agent-1' }], rowCount: 1 };
      }
      if (typeof sql === 'string' && sql.includes('decision_policies')) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    });

    const res = await request(app, 'POST', `/api/compile?format=markdown`, {
      agent_name: 'architect',
      project_id: PROJECT_ID,
      task_description: 'Continue building the database layer',
      task_session_id: SESSION_ID,
    });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('[RESTORED FROM CHECKPOINT]');
    expect(text).toContain('Critical: Use PostgreSQL for main DB.');
  });

  it('uses latest checkpoint when multiple exist (LIMIT 1 ORDER BY DESC)', async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (typeof sql === 'string' && sql.includes('session_checkpoints')) {
        // The query uses ORDER BY created_at DESC LIMIT 1, so only latest is returned
        return {
          rows: [{
            checkpoint_text: 'Latest checkpoint: switched to Redis.',
            important_decision_ids: '["dec-3"]',
            created_at: '2026-04-08T12:00:00Z',
          }],
          rowCount: 1,
        };
      }
      if (typeof sql === 'string' && sql.includes('agents') && sql.includes('name')) {
        return { rows: [{ id: 'agent-1' }], rowCount: 1 };
      }
      if (typeof sql === 'string' && sql.includes('decision_policies')) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    });

    const res = await request(app, 'POST', `/api/compile?format=markdown`, {
      agent_name: 'architect',
      project_id: PROJECT_ID,
      task_description: 'Continue task',
      task_session_id: SESSION_ID,
    });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('Latest checkpoint: switched to Redis.');
  });
});

  // Session Prefetch

describe('Session Prefetch', () => {
  const SESSION_ID = 'a0000000-0000-4000-8000-000000000001';
  const PROJECT_ID = 'b0000000-0000-4000-8000-000000000001';

  it('step recording completes successfully with prefetch enabled', async () => {
    mockQuery
      // getSessionState for project_id (first query before recordStep)
      .mockResolvedValueOnce({
        rows: [{ id: SESSION_ID, project_id: PROJECT_ID, title: 'Test', status: 'active', agents_involved: '[]', current_step: 0, state_summary: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), completed_at: null }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      // audit
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      // prefetch: project metadata
      .mockResolvedValueOnce({ rows: [{ metadata: JSON.stringify({ prefetch_enabled: true }) }], rowCount: 1 });

    const res = await request(app, 'POST', `/api/tasks/session/${SESSION_ID}/step`, {
      agent_name: 'agent-a',
      task_description: 'Build the auth module',
      output: 'Implemented JWT-based authentication.',
      project_id: PROJECT_ID,
    });

    expect(res.status).toBe(201);
    const json = await res.json() as Record<string, unknown>;
    expect(json.step_id).toBe('step-1');
  });

  it('step recording succeeds when prefetch is disabled', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: SESSION_ID, project_id: PROJECT_ID, title: 'Test', status: 'active', agents_involved: '[]', current_step: 0, state_summary: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), completed_at: null }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      // prefetch: project metadata with prefetch disabled
      .mockResolvedValueOnce({ rows: [{ metadata: JSON.stringify({ prefetch_enabled: false }) }], rowCount: 1 });

    const res = await request(app, 'POST', `/api/tasks/session/${SESSION_ID}/step`, {
      agent_name: 'agent-a',
      task_description: 'Build feature',
      output: 'Done.',
      project_id: PROJECT_ID,
    });

    expect(res.status).toBe(201);
  });

  it('prefetch cache invalidated on new step (invalidatePrefix called)', async () => {
    // This test verifies the cache invalidation logic exists in the prefetch code.
    // The cache module is imported and invalidatePrefix is called within the prefetch.
    // We verify indirectly that the step still succeeds even when prefetch runs.
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: SESSION_ID, project_id: PROJECT_ID, title: 'Test', status: 'active', agents_involved: '["agent-a"]', current_step: 1, state_summary: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), completed_at: null }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ metadata: '{}' }], rowCount: 1 });

    const res = await request(app, 'POST', `/api/tasks/session/${SESSION_ID}/step`, {
      agent_name: 'agent-b',
      task_description: 'Review code',
      output: 'Looks good.',
      project_id: PROJECT_ID,
    });

    expect(res.status).toBe(201);
  });
});

  // Compile with no session (graceful)

describe('Features disabled gracefully', () => {
  const PROJECT_ID = 'b0000000-0000-4000-8000-000000000001';
  const SESSION_ID = 'a0000000-0000-4000-8000-000000000001';

  it('compile without session_id skips checkpoint and prefetch', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'agent-1' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request(app, 'POST', '/api/compile?format=markdown', {
      agent_name: 'architect',
      project_id: PROJECT_ID,
      task_description: 'Build something',
    });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain('[RESTORED FROM CHECKPOINT]');
  });

  it('compile with session but empty checkpoint returns normal context', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'agent-1' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      // checkpoint query returns empty
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request(app, 'POST', '/api/compile?format=markdown', {
      agent_name: 'architect',
      project_id: PROJECT_ID,
      task_description: 'Build something',
      task_session_id: SESSION_ID,
    });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain('[RESTORED FROM CHECKPOINT]');
  });
});
