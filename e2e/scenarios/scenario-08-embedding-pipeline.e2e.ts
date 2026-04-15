/**
 * Scenario 08: Write → embed → retrieve.
 *
 * The orchestrator (e2e/run-e2e.sh + docker-compose.yml) is responsible for
 * wiring HIPP0_EMBEDDING_PROVIDER=openai and OPENAI_BASE_URL=
 * http://fake-llm:4001/v1. This scenario only exercises the public
 * round-trip: create a decision with a distinctive title, then search for
 * it and expect it in the results.
 *
 * If no embedding provider is wired the server still indexes via BM25 over
 * the decision title, which is enough for the distinctive term to rank
 * highly.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { fetchJson, requireSeed, serverReachable, sleep } from './_helpers.js';

interface SearchResponse {
  results: Array<{ id?: string; title?: string; kind?: string; score?: number }>;
  query: string;
  intent?: string;
}

describe('scenario-08: embedding pipeline', () => {
  const seed = requireSeed();

  beforeAll(async () => {
    await serverReachable();
  });

  it('writes a decision, then retrieves it via /api/search', async () => {
    const distinctiveTerm = `elasticsearchE2E${Date.now()}`;
    const title = `Use ${distinctiveTerm} for full-text search`;

    const created = await fetchJson<{ id: string; title: string }>(
      `/api/projects/${seed.project_id}/decisions`,
      {
        method: 'POST',
        body: JSON.stringify({
          title,
          description:
            'Elasticsearch chosen over Postgres tsvector for phrase search and faceted queries over 100M+ documents.',
          made_by: 'architect',
          tags: ['search', 'elasticsearch'],
          confidence: 'high',
          source: 'manual',
        }),
      },
    );
    expect(created.id).toBeDefined();

    // Fire-and-forget embed window.
    await sleep(1500);

    const res = await fetchJson<SearchResponse>(
      `/api/search?project_id=${seed.project_id}&q=${encodeURIComponent(distinctiveTerm)}&limit=5`,
    );
    expect(res.intent).toBeDefined();
    expect(res.results.length).toBeGreaterThanOrEqual(1);

    const top = res.results[0];
    // The distinctive term is in the title -- either an id match or title
    // match is acceptable.
    const matches =
      top.id === created.id ||
      (top.title ?? '').includes(distinctiveTerm);
    expect(matches).toBe(true);
  });
});
