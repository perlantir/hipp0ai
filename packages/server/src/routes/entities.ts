import type { Hono } from 'hono';
import { requireProjectAccess } from './_helpers.js';
import { requireUUID } from './validation.js';
import {
  upsertEntityPage,
  getEntityPage,
  searchEntityPages,
  type EntityType,
} from '@hipp0/core/intelligence/entity-enricher.js';

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
}
