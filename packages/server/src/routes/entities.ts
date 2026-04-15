import type { Hono } from 'hono';
import { requireProjectAccess } from './_helpers.js';
import { requireUUID } from './validation.js';
import {
  upsertEntityPage,
  getEntityPage,
  searchEntityPages,
  type EntityType,
} from '@hipp0/core/intelligence/entity-enricher.js';
import { hybridSearch } from '@hipp0/core/search/hybrid.js';

export function registerEntityRoutes(app: Hono): void {
  // GET /api/entities?project_id=&q=&type=&limit=
  app.get('/api/entities', async (c) => {
    const project_id = requireUUID(c.req.query('project_id'), 'project_id');
    await requireProjectAccess(c, project_id);
    const q = c.req.query('q') ?? '';
    const type = c.req.query('type') as EntityType | undefined;
    const limit = Math.min(50, Number(c.req.query('limit') ?? '20'));
    const results = await searchEntityPages(project_id, q, type, limit);
    return c.json({ entities: results, total: results.length });
  });

  // GET /api/entities/:slug?project_id=
  app.get('/api/entities/:slug{.+}', async (c) => {
    const project_id = requireUUID(c.req.query('project_id'), 'project_id');
    await requireProjectAccess(c, project_id);
    const slug = decodeURIComponent(c.req.param('slug'));
    const entity = await getEntityPage(project_id, slug);
    if (!entity) return c.json({ error: { code: 'NOT_FOUND' } }, 404);
    return c.json(entity);
  });

  // POST /api/entities - upsert an entity page
  app.post('/api/entities', async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const project_id = requireUUID(body.project_id, 'project_id');
    await requireProjectAccess(c, project_id);
    const title = body.title as string;
    const type = (body.type as EntityType) ?? 'concept';
    const source = (body.source as string | undefined) ?? 'manual';
    const summary = (body.summary as string | undefined) ?? '';
    const result = await upsertEntityPage(project_id, title, type, source, summary, {
      decisionId: typeof body.decision_id === 'string' ? body.decision_id : undefined,
      linkType: (body.link_type as any) ?? 'references',
      compiledTruth: typeof body.compiled_truth === 'string' ? body.compiled_truth : undefined,
    });
    return c.json(result, result.action === 'created' ? 201 : 200);
  });

  // GET /api/search?project_id=&q=&limit=&kind=
  app.get('/api/search', async (c) => {
    const project_id = requireUUID(c.req.query('project_id'), 'project_id');
    await requireProjectAccess(c, project_id);
    const q = c.req.query('q') ?? '';
    const limit = Math.min(20, Number(c.req.query('limit') ?? '10'));
    const kind = c.req.query('kind') ?? 'all';

    const results = await hybridSearch(project_id, q, limit);
    const filtered = kind === 'all' ? results : results.filter((r) => r.kind === kind);

    return c.json({ results: filtered, query: q, intent: results[0]?.intent ?? 'general' });
  });

  // POST /api/entities/enrich - run enrichment job for the project
  // Body: { project_id, max_entities?: number, min_tier?: 1|2|3, stale_days?: number }
  app.post('/api/entities/enrich', async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const project_id = requireUUID(body.project_id, 'project_id');
    await requireProjectAccess(c, project_id);

    const maxEntities = Math.min(20, Math.max(1, Number(body.max_entities ?? 5)));
    const minTier = Number(body.min_tier ?? 2);
    const staleDays = Math.max(1, Number(body.stale_days ?? 7));
    if (![1, 2, 3].includes(minTier)) {
      return c.json({ error: { code: 'BAD_REQUEST', message: 'min_tier must be 1, 2, or 3' } }, 400);
    }

    const { enrichStaleEntities } = await import('@hipp0/core/cron/enrich-entities.js');
    const result = await enrichStaleEntities(project_id, {
      maxEntities,
      minTier: minTier as 1 | 2 | 3,
      staleDays,
    });

    return c.json(result);
  });

  // POST /api/ingest/pdf - accept plain text content, return extracted entity mentions
  app.post('/api/ingest/pdf', async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const project_id = requireUUID(body.project_id, 'project_id');
    await requireProjectAccess(c, project_id);
    const text = body.text as string | undefined;
    if (!text || typeof text !== 'string') {
      return c.json({ error: { code: 'BAD_REQUEST', message: 'text is required' } }, 400);
    }
    const { extractEntityMentions } = await import('@hipp0/core/intelligence/pdf-ingest.js');
    const entities = extractEntityMentions(text);
    return c.json({ text_length: text.length, entity_count: entities.length, entities });
  });
}
