/**
 * Scenario 06: Session-end outcome → attribution → trust update.
 *
 * 1. Register a hermes agent and open a session.
 * 2. Compile a context to produce a compile_history row under that agent.
 * 3. End the session with outcome.rating = 'positive'.
 * 4. Assert session/end returned cleanly.
 * 5. Repeat with rating = 'negative' and assert same.
 *
 * We don't reach into the DB -- trust-score updates happen in-band on the
 * server side; this scenario verifies the public API contract and that the
 * attribution path does not throw.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { fetchJson, requireSeed, serverReachable } from './_helpers.js';

async function runSessionWithOutcome(
  projectId: string,
  rating: 'positive' | 'negative',
): Promise<void> {
  const agentName = `e2e-hermes-${rating}-${Date.now()}`;

  // Register a hermes agent for this project.
  await fetchJson('/api/hermes/register', {
    method: 'POST',
    body: JSON.stringify({
      project_id: projectId,
      agent_name: agentName,
      soul: '# Soul\nE2E scenario hermes agent.',
      config: { model: 'gpt-4o-mini', platform_access: ['web'] },
    }),
  });

  // Also register a compile-side agent with the same name so the compile
  // route can resolve an agent_id for compile_history.
  await fetchJson(`/api/projects/${projectId}/agents`, {
    method: 'POST',
    body: JSON.stringify({ name: agentName, role: 'hermes' }),
  }).catch(() => {
    /* tolerate pre-existing agent */
  });

  // Start a session.
  const start = await fetchJson<{ session_id: string }>(
    '/api/hermes/session/start',
    {
      method: 'POST',
      body: JSON.stringify({
        project_id: projectId,
        agent_name: agentName,
        platform: 'web',
      }),
    },
  );
  expect(start.session_id).toMatch(/^[0-9a-f-]{36}$/i);

  // Generate a compile_history row so attribution has something to bind to.
  await fetchJson('/api/compile', {
    method: 'POST',
    headers: { Accept: 'application/json' },
    body: JSON.stringify({
      agent_name: agentName,
      project_id: projectId,
      task_description:
        'Summarise the current caching and authentication strategy for the platform.',
    }),
  });

  // End the session with an outcome.
  const endRes = await fetchJson<{ session_id: string; ended_at: string }>(
    '/api/hermes/session/end',
    {
      method: 'POST',
      body: JSON.stringify({
        session_id: start.session_id,
        outcome: {
          rating,
          signal_source: 'user_feedback',
          snippet_ids: [],
        },
      }),
    },
  );
  expect(endRes.session_id).toEqual(start.session_id);
  expect(typeof endRes.ended_at).toEqual('string');
}

describe('scenario-06: outcome attribution', () => {
  const seed = requireSeed();

  beforeAll(async () => {
    await serverReachable();
  });

  it('records a positive session outcome', async () => {
    await runSessionWithOutcome(seed.project_id, 'positive');
  });

  it('records a negative session outcome', async () => {
    await runSessionWithOutcome(seed.project_id, 'negative');
  });
});
