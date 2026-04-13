#!/usr/bin/env node
/**
 * Live HIPP0 server smoke test for the Hermes contract.
 *
 * Drives the real HTTP server (spawned via `node dist/index.js`) over a
 * real TCP socket. Distinct from the vitest hermes-e2e suite, which calls
 * app.fetch in-process — here every request goes through the Node HTTP
 * stack and Hono's router, so it catches anything the in-process test
 * cannot (headers surviving real wire serialization, body shapes, etc.).
 *
 * The Hermes Hipp0MemoryProvider (Python/aiohttp) hits this exact set of
 * endpoints with the exact same shapes at H6 time, so this script is both
 * a smoke test for HIPP0 itself AND a reference implementation of what the
 * Python provider must do on its side of the wire.
 *
 * Usage (default — assumes fresh server on :3199 with seeded demo project):
 *   # Terminal 1:
 *   cd packages/server
 *   DATABASE_URL=/tmp/hipp0-smoke.db PORT=3199 HIPP0_AUTH_REQUIRED=false \
 *     HIPP0_TELEMETRY_ENABLED=false node dist/index.js
 *
 *   # Terminal 2:
 *   node scripts/hermes-live-smoke.mjs
 *
 * Custom targets:
 *   HIPP0_URL=http://staging.example.com \
 *   HIPP0_PROJECT_ID=<uuid> \
 *   HIPP0_AGENT_NAME=bob-prod \
 *     node scripts/hermes-live-smoke.mjs
 *
 * Exit codes: 0 = all green, 1 = assertion failure, 2 = thrown error.
 */
const BASE = process.env.HIPP0_URL ?? 'http://127.0.0.1:3199';
// Default project ID is the UUID seeded by seedDemoProject() on a fresh
// SQLite boot — see packages/server/src/seed-demo-project.ts.
const PROJECT_ID = process.env.HIPP0_PROJECT_ID ?? 'de000000-0000-4000-8000-000000000001';
const AGENT_NAME = process.env.HIPP0_AGENT_NAME ?? 'alice-live';
const EXTERNAL_USER_ID = process.env.HIPP0_EXTERNAL_USER_ID ?? 'tg:live-42';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    console.log(`  ok  ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL ${msg}`);
    failed++;
  }
}

async function req(method, path, body, headers = {}) {
  const init = { method, headers: { ...headers } };
  if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(BASE + path, init);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, headers: res.headers, body: json };
}

async function main() {
  console.log(`\n=== HIPP0 live smoke test (${BASE}) ===\n`);

  // 1. /api/status
  {
    console.log('1. GET /api/status');
    const r = await req('GET', '/api/status');
    assert(r.status === 200, `status 200 (got ${r.status})`);
    assert(r.body.status === 'ok', `body.status === "ok"`);
  }

  // 2. Register persistent agent
  {
    console.log(`\n2. POST /api/hermes/register (${AGENT_NAME})`);
    const r = await req('POST', '/api/hermes/register', {
      project_id: PROJECT_ID,
      agent_name: AGENT_NAME,
      soul: '# Alice (live smoke)\n\nA smoke-test agent.',
      config: { model: 'claude-3-5-sonnet', toolset: 'default', platform_access: ['telegram'] },
    });
    // 201 on first run, 200 on re-run — accept either
    assert(r.status === 201 || r.status === 200, `status 201|200 (got ${r.status})`);
    assert(r.body.agent_name === AGENT_NAME, `body.agent_name matches`);
    assert(/^[0-9a-f-]{36}$/.test(r.body.agent_id), `body.agent_id is a UUID`);
  }

  // 3. List agents
  {
    console.log('\n3. GET /api/hermes/agents');
    const r = await req('GET', `/api/hermes/agents?project_id=${PROJECT_ID}`);
    assert(r.status === 200, `status 200 (got ${r.status})`);
    assert(Array.isArray(r.body), 'body is an array');
    const alice = r.body.find((a) => a.agent_name === AGENT_NAME);
    assert(alice !== undefined, `alice-live is in the list`);
  }

  // 4. Start session
  let sessionId;
  {
    console.log('\n4. POST /api/hermes/session/start');
    const r = await req('POST', '/api/hermes/session/start', {
      project_id: PROJECT_ID,
      agent_name: AGENT_NAME,
      platform: 'telegram',
      external_user_id: EXTERNAL_USER_ID,
      external_chat_id: 'chat-live-1',
    });
    assert(r.status === 201, `status 201 (got ${r.status})`);
    assert(/^[0-9a-f-]{36}$/.test(r.body.session_id), `body.session_id is a UUID`);
    sessionId = r.body.session_id;
  }

  // 5. Append user + assistant messages
  {
    console.log('\n5. POST /api/hermes/conversations/:session/messages × 2');
    const user = await req('POST', `/api/hermes/conversations/${sessionId}/messages`, {
      role: 'user',
      content: 'Please call me on my phone.',
      tokens_in: 8,
      tokens_out: 0,
    });
    assert(user.status === 201, `user 201 (got ${user.status})`);

    const asst = await req('POST', `/api/hermes/conversations/${sessionId}/messages`, {
      role: 'assistant',
      content: 'Got it — phone it is.',
      tokens_in: 0,
      tokens_out: 10,
    });
    assert(asst.status === 201, `assistant 201 (got ${asst.status})`);
  }

  // 6. Read messages back
  {
    console.log('\n6. GET /api/hermes/conversations/:session/messages');
    const r = await req('GET', `/api/hermes/conversations/${sessionId}/messages`);
    assert(r.status === 200, `status 200 (got ${r.status})`);
    assert(r.body.messages.length === 2, `2 messages (got ${r.body.messages?.length})`);
    assert(r.body.messages[0].role === 'user', 'first message is user');
    assert(r.body.messages[1].role === 'assistant', 'second message is assistant');
  }

  // 7. Submit capture — must return 202 + Retry-After: 1
  {
    console.log('\n7. POST /api/capture (source=hermes)');
    const r = await req('POST', '/api/capture', {
      agent_name: AGENT_NAME,
      project_id: PROJECT_ID,
      conversation: 'User: call me?\nAssistant: sure',
      source: 'hermes',
      session_id: sessionId,
    });
    assert(r.status === 202, `status 202 (got ${r.status})`);
    const retryAfter = r.headers.get('retry-after');
    assert(retryAfter === '1', `Retry-After header is "1" (got "${retryAfter}") — Phase 8 fix`);
    assert(r.body.status === 'processing', 'body.status === "processing"');
  }

  // 8. Upsert user-facts + verify ETag round-trip
  let firstEtag;
  {
    console.log('\n8. POST /api/hermes/user-facts (insert)');
    const r = await req('POST', '/api/hermes/user-facts', {
      project_id: PROJECT_ID,
      external_user_id: EXTERNAL_USER_ID,
      facts: [{ key: 'preferred_contact_live', value: 'phone', source: AGENT_NAME }],
    });
    assert(r.status === 200, `status 200 (got ${r.status})`);
    const etag = r.headers.get('etag');
    assert(/^[0-9a-f-]{36}$/.test(etag ?? ''), `ETag header is a UUID (got "${etag}") — Phase 8 fix`);
    assert(r.body.version === etag, `body.version matches ETag header`);
    firstEtag = etag;
  }

  // 9. Read user-facts back + verify ETag header stays consistent
  {
    console.log('\n9. GET /api/hermes/user-facts');
    const r = await req('GET', `/api/hermes/user-facts?project_id=${PROJECT_ID}&external_user_id=${encodeURIComponent(EXTERNAL_USER_ID)}`);
    assert(r.status === 200, `status 200 (got ${r.status})`);
    const etag = r.headers.get('etag');
    assert(etag === firstEtag, `GET ETag matches POST ETag (${etag} vs ${firstEtag})`);
    assert(r.body.version === firstEtag, `body.version matches`);
    assert(r.body.facts.some((f) => f.value === 'phone'), 'phone preference present');
  }

  // 10. Stale If-Match → 409
  {
    console.log('\n10. POST /api/hermes/user-facts with stale If-Match');
    const r = await req(
      'POST',
      '/api/hermes/user-facts',
      {
        project_id: PROJECT_ID,
        external_user_id: EXTERNAL_USER_ID,
        facts: [{ key: 'preferred_contact_live', value: 'email' }],
      },
      { 'If-Match': '00000000-0000-0000-0000-000000000000' },
    );
    assert(r.status === 409, `status 409 (got ${r.status})`);
  }

  // 11. Correct If-Match from ETag → 200 + version rotates
  {
    console.log('\n11. POST /api/hermes/user-facts with correct If-Match');
    const r = await req(
      'POST',
      '/api/hermes/user-facts',
      {
        project_id: PROJECT_ID,
        external_user_id: EXTERNAL_USER_ID,
        facts: [{ key: 'preferred_contact_live', value: 'email' }],
      },
      { 'If-Match': firstEtag },
    );
    assert(r.status === 200, `status 200 (got ${r.status})`);
    const newEtag = r.headers.get('etag');
    assert(newEtag !== firstEtag, `version rotated`);
    assert(newEtag === r.body.version, `new ETag matches body.version`);
  }

  // 12. Session end
  {
    console.log('\n12. POST /api/hermes/session/end');
    const r = await req('POST', '/api/hermes/session/end', {
      session_id: sessionId,
      outcome: { rating: 'positive', signal_source: 'telegram_reaction' },
    });
    assert(r.status === 200, `status 200 (got ${r.status})`);
    assert(r.body.ended_at, 'body.ended_at is set');
  }

  // 13. Pulse reflects activity
  {
    console.log('\n13. GET /api/hermes/pulse');
    const r = await req('GET', `/api/hermes/pulse?project_id=${PROJECT_ID}`);
    assert(r.status === 200, `status 200 (got ${r.status})`);
    assert(r.body.agent_count >= 1, `agent_count >= 1 (got ${r.body.agent_count})`);
    const ours = r.body.recent_sessions.find((s) => s.session_id === sessionId);
    assert(ours !== undefined, 'our session appears in recent_sessions');
    assert(ours?.ended_at, 'our session has ended_at set');
  }

  // Summary
  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Smoke test threw:', err);
  process.exit(2);
});
