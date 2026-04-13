// Hermes Route Integration Tests (Hono test client — mocked DB)
//
// Covers:
//   POST /api/hermes/register        — create + update
//   GET  /api/hermes/agents          — list
//   GET  /api/hermes/agents/:name    — fetch single
//   POST /api/hermes/session/start   — 404 on missing agent, 201 on success
//   POST /api/hermes/session/end     — normal + idempotent double-close
//   POST /api/hermes/user-facts      — upsert + ETag mismatch (409)
//   GET  /api/hermes/user-facts      — read back

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createApp } from '../src/app.js';

// ---------------------------------------------------------------------------
// DB mock — hoisted so vi.mock factories can reach it
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function request(
  app: ReturnType<typeof createApp>,
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<Response> {
  const url = `http://localhost${path}`;
  const init: RequestInit = { method };
  const allHeaders: Record<string, string> = {};
  if (body !== undefined) {
    allHeaders['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  if (headers) Object.assign(allHeaders, headers);
  if (Object.keys(allHeaders).length > 0) init.headers = allHeaders;
  return app.fetch(new Request(url, init));
}

function emptyResult() {
  return { rows: [], rowCount: 0, command: '', oid: 0, fields: [] };
}

function rowsResult<T extends Record<string, unknown>>(rows: T[]) {
  return { rows, rowCount: rows.length, command: '', oid: 0, fields: [] };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

vi.stubEnv('NODE_ENV', 'development');
vi.stubEnv('HIPP0_AUTH_REQUIRED', 'false');

const PROJECT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const AGENT_ID = 'b1c2d3e4-f5a6-7890-bcde-f12345678901';
const SESSION_ID = 'c1d2e3f4-a5b6-7890-cdef-123456789012';
const CONVERSATION_ID = 'd1e2f3a4-b5c6-7890-def1-234567890123';

let app: ReturnType<typeof createApp>;

beforeEach(() => {
  app = createApp();
  vi.clearAllMocks();
  mockQuery.mockResolvedValue(emptyResult());
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// POST /api/hermes/register
// ---------------------------------------------------------------------------

describe('POST /api/hermes/register', () => {
  it('creates a new agent on first register (201)', async () => {
    // Sequence: SELECT (empty) → INSERT (empty) → INSERT audit_log (empty)
    mockQuery
      .mockResolvedValueOnce(emptyResult()) // SELECT existing
      .mockResolvedValueOnce(emptyResult()); // INSERT agent

    const res = await request(app, 'POST', '/api/hermes/register', {
      project_id: PROJECT_ID,
      agent_name: 'alice',
      soul: '# Alice\nYou are alice, a sales agent.',
      config: { model: 'anthropic/claude-sonnet-4-6', toolset: 'sales' },
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { agent_id: string; agent_name: string; created: boolean };
    expect(body.agent_name).toBe('alice');
    expect(body.created).toBe(true);
    expect(body.agent_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('updates an existing agent on re-register (200)', async () => {
    mockQuery
      .mockResolvedValueOnce(rowsResult([{ id: AGENT_ID }])) // SELECT existing
      .mockResolvedValueOnce(emptyResult()); // UPDATE agent

    const res = await request(app, 'POST', '/api/hermes/register', {
      project_id: PROJECT_ID,
      agent_name: 'alice',
      soul: '# Alice v2',
      config: { model: 'anthropic/claude-opus-4-6' },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { agent_id: string; created: boolean };
    expect(body.agent_id).toBe(AGENT_ID);
    expect(body.created).toBe(false);
  });

  it('rejects invalid agent_name with 500', async () => {
    const res = await request(app, 'POST', '/api/hermes/register', {
      project_id: PROJECT_ID,
      agent_name: 'Alice With Spaces!',
      soul: 'x',
      config: { model: 'x' },
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('rejects missing project_id with 400', async () => {
    const res = await request(app, 'POST', '/api/hermes/register', {
      agent_name: 'alice',
      soul: 'x',
      config: { model: 'x' },
    });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /api/hermes/agents
// ---------------------------------------------------------------------------

describe('GET /api/hermes/agents', () => {
  it('returns empty list when no agents registered', async () => {
    mockQuery.mockResolvedValueOnce(emptyResult());
    const res = await request(app, 'GET', `/api/hermes/agents?project_id=${PROJECT_ID}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(body).toEqual([]);
  });

  it('returns registered agents with parsed config', async () => {
    mockQuery.mockResolvedValueOnce(
      rowsResult([
        {
          id: AGENT_ID,
          agent_name: 'alice',
          config_json: '{"model":"anthropic/claude-sonnet-4-6","toolset":"sales"}',
          created_at: '2026-04-11T00:00:00Z',
          updated_at: '2026-04-11T00:00:00Z',
        },
      ]),
    );
    const res = await request(app, 'GET', `/api/hermes/agents?project_id=${PROJECT_ID}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ agent_id: string; agent_name: string; config: { model: string } }>;
    expect(body).toHaveLength(1);
    expect(body[0].agent_name).toBe('alice');
    expect(body[0].config.model).toBe('anthropic/claude-sonnet-4-6');
  });
});

// ---------------------------------------------------------------------------
// GET /api/hermes/agents/:name
// ---------------------------------------------------------------------------

describe('GET /api/hermes/agents/:name', () => {
  it('returns 404 for unknown agent', async () => {
    mockQuery.mockResolvedValueOnce(emptyResult());
    const res = await request(app, 'GET', `/api/hermes/agents/alice?project_id=${PROJECT_ID}`);
    expect(res.status).toBe(404);
  });

  it('returns the agent with SOUL.md included', async () => {
    mockQuery.mockResolvedValueOnce(
      rowsResult([
        {
          id: AGENT_ID,
          agent_name: 'alice',
          soul_md: '# Alice persona',
          config_json: '{"model":"anthropic/claude-sonnet-4-6"}',
          created_at: '2026-04-11T00:00:00Z',
          updated_at: '2026-04-11T00:00:00Z',
        },
      ]),
    );
    const res = await request(app, 'GET', `/api/hermes/agents/alice?project_id=${PROJECT_ID}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { soul: string; agent_name: string };
    expect(body.soul).toBe('# Alice persona');
    expect(body.agent_name).toBe('alice');
  });
});

// ---------------------------------------------------------------------------
// GET /api/hermes/agents/:name/conversations
// ---------------------------------------------------------------------------

describe('GET /api/hermes/agents/:name/conversations', () => {
  it('returns 404 when agent does not exist', async () => {
    mockQuery.mockResolvedValueOnce(emptyResult()); // SELECT agent
    const res = await request(
      app,
      'GET',
      `/api/hermes/agents/alice/conversations?project_id=${PROJECT_ID}`,
    );
    expect(res.status).toBe(404);
  });

  it('returns conversation list with parsed fields', async () => {
    mockQuery
      .mockResolvedValueOnce(rowsResult([{ id: AGENT_ID }])) // SELECT agent
      .mockResolvedValueOnce(
        rowsResult([
          {
            id: CONVERSATION_ID,
            session_id: SESSION_ID,
            platform: 'telegram',
            external_user_id: '12345',
            external_chat_id: '-100200',
            started_at: '2026-04-11T12:00:00Z',
            ended_at: '2026-04-11T12:30:00Z',
            summary_md: null,
          },
        ]),
      );

    const res = await request(
      app,
      'GET',
      `/api/hermes/agents/alice/conversations?project_id=${PROJECT_ID}`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{
      conversation_id: string;
      session_id: string;
      platform: string;
      started_at: string;
      ended_at: string | null;
    }>;
    expect(body).toHaveLength(1);
    expect(body[0].session_id).toBe(SESSION_ID);
    expect(body[0].platform).toBe('telegram');
    expect(body[0].ended_at).toBe('2026-04-11T12:30:00Z');
  });

  it('returns empty list when agent exists but has no sessions', async () => {
    mockQuery
      .mockResolvedValueOnce(rowsResult([{ id: AGENT_ID }]))
      .mockResolvedValueOnce(emptyResult());
    const res = await request(
      app,
      'GET',
      `/api/hermes/agents/alice/conversations?project_id=${PROJECT_ID}`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(body).toEqual([]);
  });

  it('honors limit query parameter', async () => {
    mockQuery
      .mockResolvedValueOnce(rowsResult([{ id: AGENT_ID }]))
      .mockResolvedValueOnce(emptyResult());
    await request(
      app,
      'GET',
      `/api/hermes/agents/alice/conversations?project_id=${PROJECT_ID}&limit=10`,
    );
    // Third call is the conversations SELECT; assert LIMIT = 10 was used
    const call = mockQuery.mock.calls.find((args) =>
      typeof args[0] === 'string' && (args[0] as string).includes('FROM hermes_conversations'),
    );
    expect(call).toBeTruthy();
    // params: [agent_id, limit, offset]
    expect((call as unknown[])[1]).toEqual([AGENT_ID, 10, 0]);
  });
});

// ---------------------------------------------------------------------------
// POST /api/hermes/conversations/:session_id/messages — append message
// ---------------------------------------------------------------------------

describe('POST /api/hermes/conversations/:session_id/messages', () => {
  it('returns 404 when session does not exist', async () => {
    mockQuery.mockResolvedValueOnce(emptyResult()); // SELECT conversation
    const res = await request(
      app,
      'POST',
      `/api/hermes/conversations/${SESSION_ID}/messages`,
      { role: 'user', content: 'hello' },
    );
    expect(res.status).toBe(404);
  });

  it('rejects invalid role with 400', async () => {
    const res = await request(
      app,
      'POST',
      `/api/hermes/conversations/${SESSION_ID}/messages`,
      { role: 'narrator', content: 'hello' },
    );
    expect(res.status).toBe(400);
  });

  it('inserts a user message and returns 201 with the generated id', async () => {
    mockQuery
      .mockResolvedValueOnce(
        rowsResult([{ id: CONVERSATION_ID, project_id: PROJECT_ID }]),
      ) // SELECT conversation
      .mockResolvedValueOnce(emptyResult()); // INSERT message

    const res = await request(
      app,
      'POST',
      `/api/hermes/conversations/${SESSION_ID}/messages`,
      { role: 'user', content: 'hi alice', tokens_in: 2 },
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      message_id: string;
      session_id: string;
      conversation_id: string;
      created_at: string;
    };
    expect(body.message_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.session_id).toBe(SESSION_ID);
    expect(body.conversation_id).toBe(CONVERSATION_ID);
    expect(body.created_at).toBeTruthy();
  });

  it('persists tool_calls and tool_results as JSON in the assistant message', async () => {
    mockQuery
      .mockResolvedValueOnce(
        rowsResult([{ id: CONVERSATION_ID, project_id: PROJECT_ID }]),
      )
      .mockResolvedValueOnce(emptyResult());

    const res = await request(
      app,
      'POST',
      `/api/hermes/conversations/${SESSION_ID}/messages`,
      {
        role: 'assistant',
        content: 'calling lookup_memory',
        tool_calls: [{ name: 'lookup_memory', args: { q: 'prefs' } }],
        tool_results: [{ result: 'found 3' }],
        tokens_in: 12,
        tokens_out: 8,
      },
    );
    expect(res.status).toBe(201);

    // Find the INSERT call and inspect its parameters
    const insertCall = mockQuery.mock.calls.find(
      (args) => typeof args[0] === 'string' && (args[0] as string).includes('INSERT INTO hermes_messages'),
    );
    expect(insertCall).toBeTruthy();
    const params = (insertCall as unknown[])[1] as unknown[];
    // [id, conversation_id, role, content, tool_calls_json, tool_results_json, tokens_in, tokens_out, created_at]
    expect(params[2]).toBe('assistant');
    expect(params[3]).toBe('calling lookup_memory');
    expect(params[4]).toBe(JSON.stringify([{ name: 'lookup_memory', args: { q: 'prefs' } }]));
    expect(params[5]).toBe(JSON.stringify([{ result: 'found 3' }]));
    expect(params[6]).toBe(12);
    expect(params[7]).toBe(8);
  });

  it('rejects empty content with 400', async () => {
    const res = await request(
      app,
      'POST',
      `/api/hermes/conversations/${SESSION_ID}/messages`,
      { role: 'user', content: '' },
    );
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /api/hermes/conversations/:session_id/messages
// ---------------------------------------------------------------------------

describe('GET /api/hermes/conversations/:session_id/messages', () => {
  it('returns 404 when the session does not exist', async () => {
    mockQuery.mockResolvedValueOnce(emptyResult()); // SELECT conversation
    const res = await request(
      app,
      'GET',
      `/api/hermes/conversations/${SESSION_ID}/messages`,
    );
    expect(res.status).toBe(404);
  });

  it('returns messages for a session', async () => {
    mockQuery
      .mockResolvedValueOnce(
        rowsResult([
          {
            id: CONVERSATION_ID,
            project_id: PROJECT_ID,
            agent_id: AGENT_ID,
            platform: 'telegram',
            started_at: '2026-04-11T12:00:00Z',
            ended_at: null,
          },
        ]),
      )
      .mockResolvedValueOnce(
        rowsResult([
          {
            id: 'msg-1',
            role: 'user',
            content: 'Hi alice',
            tool_calls_json: null,
            tool_results_json: null,
            tokens_in: 2,
            tokens_out: 0,
            created_at: '2026-04-11T12:00:01Z',
          },
          {
            id: 'msg-2',
            role: 'assistant',
            content: 'Hello — how can I help?',
            tool_calls_json: '[{"name":"lookup_memory","args":{}}]',
            tool_results_json: '[{"result":"none"}]',
            tokens_in: 8,
            tokens_out: 12,
            created_at: '2026-04-11T12:00:03Z',
          },
        ]),
      );

    const res = await request(
      app,
      'GET',
      `/api/hermes/conversations/${SESSION_ID}/messages`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      session_id: string;
      platform: string;
      messages: Array<{
        id: string;
        role: string;
        content: string;
        tool_calls: unknown;
        tool_results: unknown;
      }>;
    };
    expect(body.session_id).toBe(SESSION_ID);
    expect(body.platform).toBe('telegram');
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe('user');
    expect(body.messages[0].content).toBe('Hi alice');
    expect(body.messages[1].role).toBe('assistant');
    expect(body.messages[1].tool_calls).toEqual([{ name: 'lookup_memory', args: {} }]);
    expect(body.messages[1].tool_results).toEqual([{ result: 'none' }]);
  });

  it('returns empty messages array when session has no messages', async () => {
    mockQuery
      .mockResolvedValueOnce(
        rowsResult([
          {
            id: CONVERSATION_ID,
            project_id: PROJECT_ID,
            agent_id: AGENT_ID,
            platform: 'telegram',
            started_at: '2026-04-11T12:00:00Z',
            ended_at: null,
          },
        ]),
      )
      .mockResolvedValueOnce(emptyResult());
    const res = await request(
      app,
      'GET',
      `/api/hermes/conversations/${SESSION_ID}/messages`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { messages: unknown[] };
    expect(body.messages).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// GET /api/hermes/pulse
// ---------------------------------------------------------------------------

describe('GET /api/hermes/pulse', () => {
  it('returns empty counts + empty sessions when project has no data', async () => {
    mockQuery
      .mockResolvedValueOnce(rowsResult([{ count: 0 }])) // agent count
      .mockResolvedValueOnce(rowsResult([{ count: 0 }])) // active count
      .mockResolvedValueOnce(emptyResult()); // recent sessions

    const res = await request(app, 'GET', `/api/hermes/pulse?project_id=${PROJECT_ID}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      agent_count: number;
      active_session_count: number;
      recent_sessions: unknown[];
    };
    expect(body.agent_count).toBe(0);
    expect(body.active_session_count).toBe(0);
    expect(body.recent_sessions).toEqual([]);
  });

  it('returns populated aggregate with recent sessions joined to agent names', async () => {
    mockQuery
      .mockResolvedValueOnce(rowsResult([{ count: 3 }])) // agents
      .mockResolvedValueOnce(rowsResult([{ count: 2 }])) // active
      .mockResolvedValueOnce(
        rowsResult([
          {
            conversation_id: CONVERSATION_ID,
            session_id: SESSION_ID,
            platform: 'telegram',
            external_user_id: '12345',
            external_chat_id: '-100200',
            started_at: '2026-04-11T12:00:00Z',
            ended_at: null,
            agent_name: 'alice',
          },
          {
            conversation_id: 'd2e3f4a5-b6c7-8901-ef12-345678901234',
            session_id: 'e3f4a5b6-c7d8-9012-f123-456789012345',
            platform: 'web',
            external_user_id: null,
            external_chat_id: null,
            started_at: '2026-04-11T11:00:00Z',
            ended_at: '2026-04-11T11:15:00Z',
            agent_name: 'bob',
          },
        ]),
      );

    const res = await request(app, 'GET', `/api/hermes/pulse?project_id=${PROJECT_ID}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      agent_count: number;
      active_session_count: number;
      recent_sessions: Array<{ agent_name: string; platform: string; ended_at: string | null }>;
    };
    expect(body.agent_count).toBe(3);
    expect(body.active_session_count).toBe(2);
    expect(body.recent_sessions).toHaveLength(2);
    expect(body.recent_sessions[0].agent_name).toBe('alice');
    expect(body.recent_sessions[0].ended_at).toBeNull();
    expect(body.recent_sessions[1].agent_name).toBe('bob');
  });

  it('rejects missing project_id with 400', async () => {
    const res = await request(app, 'GET', '/api/hermes/pulse');
    expect(res.status).toBe(400);
  });

  it('honors the limit query parameter', async () => {
    mockQuery
      .mockResolvedValueOnce(rowsResult([{ count: 0 }]))
      .mockResolvedValueOnce(rowsResult([{ count: 0 }]))
      .mockResolvedValueOnce(emptyResult());

    await request(app, 'GET', `/api/hermes/pulse?project_id=${PROJECT_ID}&limit=5`);
    // Last call should be recent sessions query with limit=5 as 2nd param
    const lastCall = mockQuery.mock.calls[mockQuery.mock.calls.length - 1];
    const params = lastCall[1] as unknown[];
    expect(params[0]).toBe(PROJECT_ID);
    expect(params[1]).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// POST /api/hermes/session/start
// ---------------------------------------------------------------------------

describe('POST /api/hermes/session/start', () => {
  it('returns 404 if agent is not registered', async () => {
    mockQuery.mockResolvedValueOnce(emptyResult()); // SELECT hermes_agents
    const res = await request(app, 'POST', '/api/hermes/session/start', {
      project_id: PROJECT_ID,
      agent_name: 'ghost',
      platform: 'telegram',
    });
    expect(res.status).toBe(404);
  });

  it('creates a new session and returns session_id', async () => {
    mockQuery
      .mockResolvedValueOnce(rowsResult([{ id: AGENT_ID }])) // SELECT agent
      .mockResolvedValueOnce(emptyResult()); // INSERT conversation

    const res = await request(app, 'POST', '/api/hermes/session/start', {
      project_id: PROJECT_ID,
      agent_name: 'alice',
      platform: 'telegram',
      external_user_id: '12345',
      external_chat_id: '-100200',
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { session_id: string; conversation_id: string; started_at: string };
    expect(body.session_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.conversation_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.started_at).toBeTruthy();
  });

  it('rejects invalid platform with 400', async () => {
    mockQuery.mockResolvedValueOnce(rowsResult([{ id: AGENT_ID }]));
    const res = await request(app, 'POST', '/api/hermes/session/start', {
      project_id: PROJECT_ID,
      agent_name: 'alice',
      platform: 'smoke-signals',
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

// ---------------------------------------------------------------------------
// POST /api/hermes/session/end
// ---------------------------------------------------------------------------

describe('POST /api/hermes/session/end', () => {
  it('closes an open session', async () => {
    mockQuery
      .mockResolvedValueOnce(rowsResult([{ id: CONVERSATION_ID, project_id: PROJECT_ID, ended_at: null }]))
      .mockResolvedValueOnce(emptyResult()); // UPDATE

    const res = await request(app, 'POST', '/api/hermes/session/end', {
      session_id: SESSION_ID,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { session_id: string; ended_at: string; summary_snippet_ids: string[] };
    expect(body.session_id).toBe(SESSION_ID);
    expect(body.ended_at).toBeTruthy();
    expect(body.summary_snippet_ids).toEqual([]);
  });

  it('is idempotent on a double close', async () => {
    mockQuery.mockResolvedValueOnce(
      rowsResult([{ id: CONVERSATION_ID, project_id: PROJECT_ID, ended_at: '2026-04-11T12:00:00Z' }]),
    );
    const res = await request(app, 'POST', '/api/hermes/session/end', {
      session_id: SESSION_ID,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ended_at: string };
    expect(body.ended_at).toBe('2026-04-11T12:00:00Z');
  });

  it('returns 404 for unknown session', async () => {
    mockQuery.mockResolvedValueOnce(emptyResult());
    const res = await request(app, 'POST', '/api/hermes/session/end', {
      session_id: SESSION_ID,
    });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /api/hermes/user-facts
// ---------------------------------------------------------------------------

describe('POST /api/hermes/user-facts', () => {
  it('inserts new facts on first write', async () => {
    mockQuery
      .mockResolvedValueOnce(emptyResult()) // SELECT current version (none)
      .mockResolvedValueOnce(emptyResult()) // SELECT existing for preferred_contact
      .mockResolvedValueOnce(emptyResult()) // INSERT preferred_contact
      .mockResolvedValueOnce(
        rowsResult([
          { key: 'preferred_contact', value: 'phone', source: 'alice', updated_at: '2026-04-11T00:00:00Z' },
        ]),
      ); // SELECT snapshot

    const res = await request(app, 'POST', '/api/hermes/user-facts', {
      project_id: PROJECT_ID,
      external_user_id: 'tg:12345',
      facts: [{ key: 'preferred_contact', value: 'phone', source: 'alice' }],
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { version: string; facts: Array<{ key: string; value: string }> };
    expect(body.version).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.facts).toHaveLength(1);
    expect(body.facts[0].key).toBe('preferred_contact');
    // ETag header mirrors body.version so clients can use either location
    // for optimistic locking via the If-Match header on subsequent writes.
    expect(res.headers.get('ETag')).toBe(body.version);
  });

  it('rejects on ETag mismatch with 409', async () => {
    mockQuery.mockResolvedValueOnce(rowsResult([{ version: 'current-version-abc' }]));
    const res = await request(
      app,
      'POST',
      '/api/hermes/user-facts',
      {
        project_id: PROJECT_ID,
        external_user_id: 'tg:12345',
        facts: [{ key: 'x', value: 'y' }],
      },
      { 'If-Match': 'stale-version' },
    );
    expect(res.status).toBe(409);
  });

  it('rejects empty facts array with 400', async () => {
    const res = await request(app, 'POST', '/api/hermes/user-facts', {
      project_id: PROJECT_ID,
      external_user_id: 'tg:12345',
      facts: [],
    });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /api/hermes/user-facts
// ---------------------------------------------------------------------------

describe('GET /api/hermes/user-facts', () => {
  it('returns empty facts when none exist', async () => {
    mockQuery.mockResolvedValueOnce(emptyResult());
    const res = await request(
      app,
      'GET',
      `/api/hermes/user-facts?project_id=${PROJECT_ID}&external_user_id=tg:12345`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { version: string | null; facts: unknown[] };
    expect(body.version).toBeNull();
    expect(body.facts).toEqual([]);
  });

  it('returns current facts with version', async () => {
    mockQuery.mockResolvedValueOnce(
      rowsResult([
        {
          key: 'preferred_contact',
          value: 'phone',
          source: 'alice',
          version: 'v-abc-123',
          updated_at: '2026-04-11T00:00:00Z',
        },
      ]),
    );
    const res = await request(
      app,
      'GET',
      `/api/hermes/user-facts?project_id=${PROJECT_ID}&external_user_id=tg:12345`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { version: string; facts: Array<{ key: string; value: string }> };
    expect(body.version).toBe('v-abc-123');
    expect(body.facts[0].value).toBe('phone');
    // ETag header mirrors body.version on the GET side too.
    expect(res.headers.get('ETag')).toBe('v-abc-123');
  });
});

// ---------------------------------------------------------------------------
// POST /api/hermes/outcomes
// ---------------------------------------------------------------------------

describe('POST /api/hermes/outcomes', () => {
  const SNIP_A = '11111111-1111-4111-8111-111111111111';
  const SNIP_B = '22222222-2222-4222-8222-222222222222';

  it('records a positive outcome and returns 201 with id + timestamp', async () => {
    mockQuery.mockResolvedValueOnce(emptyResult()); // INSERT hermes_outcomes

    const res = await request(app, 'POST', '/api/hermes/outcomes', {
      project_id: PROJECT_ID,
      session_id: SESSION_ID,
      outcome: 'positive',
      snippet_ids: [SNIP_A, SNIP_B],
      signal_source: 'telegram_reaction',
      note: '👍 reaction on last turn',
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { outcome_id: string; recorded_at: string };
    expect(body.outcome_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.recorded_at).toBeTruthy();

    // Verify the INSERT was called with the JSON-serialized snippet list
    // and the expected column order.
    const insertCall = mockQuery.mock.calls.find(
      (call) => typeof call[0] === 'string' && call[0].includes('INSERT INTO hermes_outcomes'),
    );
    expect(insertCall).toBeDefined();
    const params = insertCall![1] as unknown[];
    expect(params[1]).toBe(PROJECT_ID);
    expect(params[2]).toBe(SESSION_ID);
    expect(params[3]).toBe('positive');
    expect(params[4]).toBe(JSON.stringify([SNIP_A, SNIP_B]));
    expect(params[5]).toBe('telegram_reaction');
    expect(params[6]).toBe('👍 reaction on last turn');
  });

  it('accepts an empty snippet_ids array', async () => {
    mockQuery.mockResolvedValueOnce(emptyResult()); // INSERT
    const res = await request(app, 'POST', '/api/hermes/outcomes', {
      project_id: PROJECT_ID,
      session_id: SESSION_ID,
      outcome: 'neutral',
      snippet_ids: [],
      signal_source: 'auto_detect',
    });
    expect(res.status).toBe(201);
  });

  it('rejects a missing session_id with 500 (validation error bubbles)', async () => {
    const res = await request(app, 'POST', '/api/hermes/outcomes', {
      project_id: PROJECT_ID,
      outcome: 'positive',
      snippet_ids: [SNIP_A],
      signal_source: 'telegram_reaction',
    });
    // requireUUID throws → app.onError wraps as 500 with the error shape
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('rejects an invalid outcome enum with 400', async () => {
    const res = await request(app, 'POST', '/api/hermes/outcomes', {
      project_id: PROJECT_ID,
      session_id: SESSION_ID,
      outcome: 'maybe',
      snippet_ids: [SNIP_A],
      signal_source: 'telegram_reaction',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toContain('outcome must be one of');
  });

  it('rejects a non-array snippet_ids with 400', async () => {
    const res = await request(app, 'POST', '/api/hermes/outcomes', {
      project_id: PROJECT_ID,
      session_id: SESSION_ID,
      outcome: 'positive',
      snippet_ids: 'not-an-array',
      signal_source: 'telegram_reaction',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toContain('snippet_ids must be an array');
  });

  it('rejects a non-UUID snippet_ids entry', async () => {
    const res = await request(app, 'POST', '/api/hermes/outcomes', {
      project_id: PROJECT_ID,
      session_id: SESSION_ID,
      outcome: 'positive',
      snippet_ids: ['not-a-uuid'],
      signal_source: 'telegram_reaction',
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
