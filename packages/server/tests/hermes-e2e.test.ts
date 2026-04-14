// -----------------------------------------------------------------------------
// Real end-to-end integration test for the Hermes contract.
//
// Unlike hermes-routes.test.ts (which mocks @hipp0/core/db), this file runs
// against a REAL in-memory SQLite database with REAL migrations applied,
// driving the Hono app via app.fetch() the exact way a real HTTP client
// would. Only the distillery LLM stage is mocked (no API keys in CI).
//
// This is the closest we can get to H6 from inside the HIPP0 sandbox: it
// catches every contract bug except "the Python provider's aiohttp request
// serialises wrong" — which is the only thing left for a real H6 manual run.
//
// Setup notes:
//  - Uses the full initDb() entry point (not a hand-rolled createAdapter
//    call) so this test ALSO validates the dist/ packaging path that
//    `pnpm start` uses in production. The Phase 10 fix in
//    packages/core/package.json copies src/db/migrations → dist/db/migrations
//    as part of `pnpm build`; if that copy regresses, this test catches it.
//  - Uses withDbOverride() to bind the real adapter to every getDb() call
//    inside the route handlers via AsyncLocalStorage. This is the sanctioned
//    injection point for per-request / per-test DB overrides.
//
// The flow walked here mirrors what the Hermes `Hipp0MemoryProvider` does
// at runtime, in order:
//
//   1. register persistent agent
//   2. list agents (dashboard read)
//   3. start a session
//   4. append user + assistant messages
//   5. read message log back
//   6. submit conversation for async capture/distillation
//   7. upsert user-facts + verify ETag round-trip (header ↔ body)
//   8. stale If-Match → 409 Conflict
//   9. correct If-Match using the ETag header → 200 + new version
//  10. end the session (+ idempotent double-close)
//  11. pulse home-page aggregate reflects the new activity
//  12. direct DB inspection to prove writes landed through the HTTP layer
//
// See HIPP0_REQUESTS.md in perlantir/hermulti for the remaining live H6
// manual plan that requires the Python provider + Telegram.
// -----------------------------------------------------------------------------

import crypto from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// Mock ONLY the distillery pipeline (LLM-bound). Everything else — DB, HTTP,
// routing, validation, audit, telemetry — runs for real.
vi.mock('@hipp0/core/distillery/index.js', async () => {
  const actual = await vi.importActual<typeof import('@hipp0/core/distillery/index.js')>(
    '@hipp0/core/distillery/index.js',
  );
  return {
    ...actual,
    distill: vi.fn(async () => ({
      decisions_extracted: 0,
      contradictions_found: 0,
      decisions: [],
      session_summary: undefined,
    })),
  };
});

vi.stubEnv('NODE_ENV', 'development');
vi.stubEnv('HIPP0_AUTH_REQUIRED', 'false');
vi.stubEnv('DATABASE_URL', '');

import { initDb, closeDb, getDb } from '@hipp0/core/db/index.js';
import type { DatabaseAdapter } from '@hipp0/core/db/adapter.js';
import { createApp } from '../src/app.js';

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

const AGENT_NAME = 'alice-e2e';
const EXTERNAL_USER_ID = 'tg:42';

let app: ReturnType<typeof createApp>;
let db: DatabaseAdapter;
let projectId: string;
let sessionId: string;

// -----------------------------------------------------------------------------
// Lifecycle
// -----------------------------------------------------------------------------

beforeAll(async () => {
  // Full initDb() flow — validates the Phase 10 dist-packaging fix
  // (src/db/migrations is copied to dist/db/migrations on build so the
  // production SQLite path actually works, not just the test fixture path).
  db = await initDb({ dialect: 'sqlite', sqlitePath: ':memory:' });
  app = createApp();

  // Create the test project directly on the adapter — /api/projects has its
  // own coverage and is orthogonal to the Hermes contract.
  projectId = crypto.randomUUID();
  await db.query(
    `INSERT INTO projects (id, name, description) VALUES (?, ?, ?)`,
    [projectId, 'hermes-e2e', 'end-to-end smoke test for the Hermes contract'],
  );
});

afterAll(async () => {
  await closeDb();
});

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/**
 * Issue an HTTP request against the app. `getDb()` inside the route handlers
 * returns the singleton set by `initDb()` in beforeAll — no override needed.
 */
async function req(
  method: string,
  pathStr: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<Response> {
  const init: RequestInit = { method };
  const h: Record<string, string> = {};
  if (body !== undefined) {
    h['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  if (headers) Object.assign(h, headers);
  if (Object.keys(h).length > 0) init.headers = h;
  return app.fetch(new Request(`http://localhost${pathStr}`, init));
}

// -----------------------------------------------------------------------------
// The Flow
// -----------------------------------------------------------------------------

describe('Hermes E2E (real SQLite, real HTTP round-trip)', () => {
  it('1. POST /api/hermes/register creates the agent row', async () => {
    const res = await req('POST', '/api/hermes/register', {
      project_id: projectId,
      agent_name: AGENT_NAME,
      soul: '# Alice\n\nA helpful assistant who prefers pragmatism over cleverness.',
      config: {
        // Contract: toolset is a named string (the Hermes-side toolset bundle
        // name), not an array of individual tools — see HermesAgentConfig in
        // @hipp0/core/types/hermes-contract.ts.
        model: 'claude-3-5-sonnet',
        toolset: 'default',
        platform_access: ['telegram'],
      },
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { agent_id: string; agent_name: string; created: boolean };
    expect(body.agent_name).toBe(AGENT_NAME);
    expect(body.created).toBe(true);
    expect(body.agent_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('2. GET /api/hermes/agents lists the just-registered agent', async () => {
    const res = await req('GET', `/api/hermes/agents?project_id=${projectId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ agent_name: string; config: unknown }>;
    const alice = body.find((a) => a.agent_name === AGENT_NAME);
    expect(alice).toBeDefined();
    expect(alice!.config).toMatchObject({ model: 'claude-3-5-sonnet' });
  });

  it('3. POST /api/hermes/session/start opens a session', async () => {
    const res = await req('POST', '/api/hermes/session/start', {
      project_id: projectId,
      agent_name: AGENT_NAME,
      platform: 'telegram',
      external_user_id: EXTERNAL_USER_ID,
      external_chat_id: 'chat-1',
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      session_id: string;
      conversation_id: string;
      started_at: string;
    };
    expect(body.session_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.conversation_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.started_at).toBeTruthy();
    sessionId = body.session_id;
  });

  it('4. POST /api/hermes/conversations/:session_id/messages appends user + assistant', async () => {
    const userRes = await req('POST', `/api/hermes/conversations/${sessionId}/messages`, {
      role: 'user',
      content: 'Can you call me on my phone this afternoon?',
      tokens_in: 12,
      tokens_out: 0,
    });
    expect(userRes.status).toBe(201);
    const userBody = (await userRes.json()) as { message_id: string };
    expect(userBody.message_id).toMatch(/^[0-9a-f-]{36}$/);

    const asstRes = await req('POST', `/api/hermes/conversations/${sessionId}/messages`, {
      role: 'assistant',
      content: 'Sure — I noted that you prefer phone over email.',
      tokens_in: 0,
      tokens_out: 18,
    });
    expect(asstRes.status).toBe(201);
  });

  it('5. GET /api/hermes/conversations/:session_id/messages reads them back in order', async () => {
    const res = await req('GET', `/api/hermes/conversations/${sessionId}/messages`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      session_id: string;
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.session_id).toBe(sessionId);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe('user');
    expect(body.messages[1].role).toBe('assistant');
  });

  it('6. POST /api/capture returns 202 + Retry-After: 1 header for polling', async () => {
    const res = await req('POST', '/api/capture', {
      agent_name: AGENT_NAME,
      project_id: projectId,
      conversation: 'User: Can you call me?\nAssistant: Sure, phone it is.',
      source: 'hermes',
      session_id: sessionId,
    });
    expect(res.status).toBe(202);
    // Phase 8 fix — Retry-After header documents the initial poll cadence.
    expect(res.headers.get('Retry-After')).toBe('1');
    const body = (await res.json()) as { capture_id: string; status: string };
    expect(body.status).toBe('processing');
    expect(body.capture_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  let firstVersion: string;

  it('7. POST /api/hermes/user-facts inserts a fact + exposes ETag in both locations', async () => {
    const res = await req('POST', '/api/hermes/user-facts', {
      project_id: projectId,
      external_user_id: EXTERNAL_USER_ID,
      facts: [{ key: 'preferred_contact', value: 'phone', source: AGENT_NAME }],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      version: string;
      facts: Array<{ key: string; value: string }>;
    };
    // Phase 8 fix — ETag header mirrors body.version
    expect(body.version).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers.get('ETag')).toBe(body.version);
    expect(body.facts).toHaveLength(1);
    expect(body.facts[0].value).toBe('phone');
    firstVersion = body.version;
  });

  it('8. GET /api/hermes/user-facts reads it back + ETag still matches body.version', async () => {
    const res = await req(
      'GET',
      `/api/hermes/user-facts?project_id=${projectId}&external_user_id=${encodeURIComponent(EXTERNAL_USER_ID)}`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      version: string;
      facts: Array<{ key: string; value: string }>;
    };
    expect(body.version).toBe(firstVersion);
    expect(res.headers.get('ETag')).toBe(firstVersion);
    expect(body.facts).toHaveLength(1);
    expect(body.facts[0].value).toBe('phone');
  });

  it('9. POST /api/hermes/user-facts with stale If-Match returns 409 Conflict', async () => {
    const res = await req(
      'POST',
      '/api/hermes/user-facts',
      {
        project_id: projectId,
        external_user_id: EXTERNAL_USER_ID,
        facts: [{ key: 'preferred_contact', value: 'email' }],
      },
      { 'If-Match': '00000000-0000-0000-0000-000000000000' },
    );
    expect(res.status).toBe(409);
  });

  it('10. POST /api/hermes/user-facts with the current ETag succeeds + version rotates', async () => {
    // Read the current version from the header (not the body) — this proves the
    // Phase 8 ETag addition is fully round-trippable.
    const getRes = await req(
      'GET',
      `/api/hermes/user-facts?project_id=${projectId}&external_user_id=${encodeURIComponent(EXTERNAL_USER_ID)}`,
    );
    const currentEtag = getRes.headers.get('ETag');
    expect(currentEtag).toBeTruthy();

    const res = await req(
      'POST',
      '/api/hermes/user-facts',
      {
        project_id: projectId,
        external_user_id: EXTERNAL_USER_ID,
        facts: [{ key: 'preferred_contact', value: 'email' }],
      },
      { 'If-Match': currentEtag! },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { version: string; facts: Array<{ key: string; value: string }> };
    expect(body.version).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.version).not.toBe(currentEtag);
    expect(res.headers.get('ETag')).toBe(body.version);
    const pref = body.facts.find((f) => f.key === 'preferred_contact');
    expect(pref?.value).toBe('email');
  });

  it('11. POST /api/hermes/session/end closes the session with optional outcome', async () => {
    const res = await req('POST', '/api/hermes/session/end', {
      session_id: sessionId,
      outcome: {
        rating: 'positive',
        signal_source: 'telegram_reaction',
        snippet_ids: [],
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      session_id: string;
      ended_at: string;
      summary_snippet_ids: unknown[];
    };
    expect(body.session_id).toBe(sessionId);
    expect(body.ended_at).toBeTruthy();
    expect(Array.isArray(body.summary_snippet_ids)).toBe(true);
  });

  it('12. POST /api/hermes/session/end is idempotent on double-close', async () => {
    const res = await req('POST', '/api/hermes/session/end', { session_id: sessionId });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ended_at: string };
    expect(body.ended_at).toBeTruthy();
  });

  it('13. GET /api/hermes/pulse reflects the new agent + session in counts', async () => {
    const res = await req('GET', `/api/hermes/pulse?project_id=${projectId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      agent_count: number;
      active_session_count: number;
      recent_sessions: Array<{ agent_name: string; session_id: string; ended_at: string | null }>;
    };
    expect(body.agent_count).toBeGreaterThanOrEqual(1);
    // Session was ended in step 11, so active count should be 0.
    expect(body.active_session_count).toBe(0);
    // But it should still show up in recent_sessions.
    const ours = body.recent_sessions.find((s) => s.session_id === sessionId);
    expect(ours).toBeDefined();
    expect(ours!.agent_name).toBe(AGENT_NAME);
    expect(ours!.ended_at).toBeTruthy();
  });

  it('14. Real DB state — hermes_messages has 2 rows for our session', async () => {
    const convResult = await db.query(
      'SELECT id FROM hermes_conversations WHERE session_id = ?',
      [sessionId],
    );
    expect(convResult.rows.length).toBe(1);
    const conversationId = (convResult.rows[0] as Record<string, unknown>).id as string;

    const msgResult = await db.query(
      'SELECT role, content FROM hermes_messages WHERE conversation_id = ? ORDER BY created_at ASC',
      [conversationId],
    );
    expect(msgResult.rows.length).toBe(2);
    expect((msgResult.rows[0] as Record<string, unknown>).role).toBe('user');
    expect((msgResult.rows[1] as Record<string, unknown>).role).toBe('assistant');
  });

  it('15. Real DB state — hermes_user_facts reflects the replacement (additive=false default)', async () => {
    const result = await db.query(
      'SELECT key, value FROM hermes_user_facts WHERE project_id = ? AND external_user_id = ?',
      [projectId, EXTERNAL_USER_ID],
    );
    expect(result.rows.length).toBe(1);
    const r = result.rows[0] as Record<string, unknown>;
    expect(r.key).toBe('preferred_contact');
    expect(r.value).toBe('email');
  });

  // ---------------------------------------------------------------------
  // /api/hermes/outcomes (added in response to HIPP0_REQUESTS.md §6)
  // ---------------------------------------------------------------------
  //
  // Snippet-level reinforcement signal. Written against the same session
  // that was closed in step 11 — session_id is opaque on this endpoint.

  it('16. POST /api/hermes/outcomes records a positive reinforcement signal', async () => {
    const SNIP_A = '11111111-1111-4111-8111-11111111aaaa';
    const SNIP_B = '22222222-2222-4222-8222-22222222bbbb';
    const res = await req('POST', '/api/hermes/outcomes', {
      project_id: projectId,
      session_id: sessionId,
      outcome: 'positive',
      snippet_ids: [SNIP_A, SNIP_B],
      signal_source: 'telegram_reaction',
      note: 'user 👍',
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { outcome_id: string; recorded_at: string };
    expect(body.outcome_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.recorded_at).toBeTruthy();
  });

  it('17. POST /api/hermes/outcomes rejects an invalid outcome enum with 400', async () => {
    const res = await req('POST', '/api/hermes/outcomes', {
      project_id: projectId,
      session_id: sessionId,
      outcome: 'maybe',
      snippet_ids: [],
      signal_source: 'manual',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('18. Real DB state — hermes_outcomes row landed for our session', async () => {
    const result = await db.query(
      `SELECT session_id, outcome, snippet_ids_json, signal_source, note
         FROM hermes_outcomes
        WHERE project_id = ?
        ORDER BY created_at DESC`,
      [projectId],
    );
    expect(result.rows.length).toBe(1);
    const r = result.rows[0] as Record<string, unknown>;
    expect(r.session_id).toBe(sessionId);
    expect(r.outcome).toBe('positive');
    expect(r.signal_source).toBe('telegram_reaction');
    expect(r.note).toBe('user 👍');
    // snippet_ids_json is stored as a JSON string on SQLite; parse + compare.
    const snippetIds = JSON.parse(r.snippet_ids_json as string);
    expect(snippetIds).toHaveLength(2);
    expect(snippetIds[0]).toBe('11111111-1111-4111-8111-11111111aaaa');
  });
});
