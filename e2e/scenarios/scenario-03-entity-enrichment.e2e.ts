/**
 * Scenario 03: Entity enrichment.
 *
 * 1. Upsert an entity with an empty compiled_truth.
 * 2. Trigger POST /api/entities/enrich.
 * 3. Read it back via GET /api/entities and verify it is still present.
 *
 * Note: this scenario DOES NOT flip OPENAI_BASE_URL at runtime -- the server
 * reads env at startup. The e2e orchestrator is responsible for wiring the
 * fake LLM server via env vars. When no enrichment provider is wired the
 * enrichStaleEntities() call still runs but is a no-op; we assert only that
 * the request succeeds and the entity round-trips.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { fetchJson, requireSeed, serverReachable } from './_helpers.js';

interface EntityUpsertResponse {
  action: string;
  entity?: { id: string; title: string; slug?: string; tier?: number };
  tier_changed?: boolean;
}

describe('scenario-03: entity enrichment', () => {
  const seed = requireSeed();

  beforeAll(async () => {
    await serverReachable();
  });

  it('upserts an entity and runs the enrichment job', async () => {
    const suffix = Date.now();
    const title = `Anthropic-E2E-${suffix}`;

    const up = await fetchJson<EntityUpsertResponse>('/api/entities', {
      method: 'POST',
      body: JSON.stringify({
        project_id: seed.project_id,
        title,
        type: 'company',
        source: 'e2e',
        summary: '',
      }),
    });
    const entity = up.entity ?? (up as unknown as { id: string; title: string });
    expect(entity.title).toEqual(title);

    // Trigger the enrichment job. Constrained to 1 entity, tier 2+, so even
    // if no provider is wired the call must succeed.
    const enrichResult = await fetchJson<Record<string, unknown>>(
      '/api/entities/enrich',
      {
        method: 'POST',
        body: JSON.stringify({
          project_id: seed.project_id,
          max_entities: 1,
          min_tier: 2,
          stale_days: 0,
        }),
      },
    );
    expect(enrichResult).toBeDefined();

    // Round-trip: search finds the entity we just wrote.
    const search = await fetchJson<{ entities: Array<{ title: string }> }>(
      `/api/entities?project_id=${seed.project_id}&q=${encodeURIComponent(title)}&limit=5`,
    );
    expect(search.entities.some((e) => e.title === title)).toBe(true);
  });
});
