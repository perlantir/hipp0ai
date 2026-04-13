/**
 * Cross-Project Pattern Sharing Routes
 *
 * GET  /api/shared-patterns                              — list community patterns (paginated)
 * GET  /api/shared-patterns/community-stats              — global community stats
 * GET  /api/projects/:id/suggested-patterns              — relevant community patterns for a project
 * POST /api/projects/:id/patterns/:patternId/adopt       — record pattern adoption
 * POST /api/projects/:id/patterns/share                  — opt-in: share a pattern with the community
 */

import type { Hono } from 'hono';
import {
  extractSharedPattern,
  getRelevantSharedPatterns,
  recordPatternAdoption,
  getCommunityStats,
  listSharedPatterns,
  type AdoptionOutcome,
  type SharedPatternInput,
} from '@hipp0/core/intelligence/cross-project-patterns.js';
import { ValidationError } from '@hipp0/core/types.js';
import { requireUUID, requireString } from './validation.js';
import { requireProjectAccess } from './_helpers.js';

function parseIntParam(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw == null) return fallback;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function parseTagsQuery(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

export function registerSharedPatternRoutes(app: Hono): void {
  // GET /api/shared-patterns — paginated list of community patterns
  app.get('/api/shared-patterns', async (c) => {
    const limit = parseIntParam(c.req.query('limit'), 20, 1, 100);
    const offset = parseIntParam(c.req.query('offset'), 0, 0, 10_000);
    const domain = c.req.query('domain') || undefined;

    try {
      const result = await listSharedPatterns({ limit, offset, domain });
      return c.json({
        patterns: result.patterns,
        total: result.total,
        limit,
        offset,
      });
    } catch (err) {
      console.warn(
        '[hipp0:shared-patterns] list failed:',
        (err as Error).message,
      );
      return c.json({ patterns: [], total: 0, limit, offset });
    }
  });

  // GET /api/shared-patterns/community-stats — global stats
  app.get('/api/shared-patterns/community-stats', async (c) => {
    try {
      const stats = await getCommunityStats();
      return c.json(stats);
    } catch (err) {
      console.warn(
        '[hipp0:shared-patterns] community-stats failed:',
        (err as Error).message,
      );
      return c.json({
        total_shared_patterns: 0,
        total_contributing_projects: 0,
        most_adopted: [],
        domain_coverage: [],
      });
    }
  });

  // GET /api/projects/:id/suggested-patterns?task=...&tags=a,b,c
  app.get('/api/projects/:id/suggested-patterns', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);

    const task = c.req.query('task') ?? '';
    const tags = parseTagsQuery(c.req.query('tags'));

    try {
      const patterns = await getRelevantSharedPatterns(projectId, task, tags);
      return c.json({ patterns });
    } catch (err) {
      console.warn(
        '[hipp0:shared-patterns] suggested-patterns failed:',
        (err as Error).message,
      );
      return c.json({ patterns: [] });
    }
  });

  // POST /api/projects/:id/patterns/:patternId/adopt
  app.post('/api/projects/:id/patterns/:patternId/adopt', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);
    const patternId = requireUUID(c.req.param('patternId'), 'patternId');

    let body: Record<string, unknown> = {};
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }

    const rawOutcome = body.outcome;
    let outcome: AdoptionOutcome | undefined;
    if (rawOutcome != null) {
      if (
        rawOutcome !== 'success' &&
        rawOutcome !== 'failure' &&
        rawOutcome !== 'partial'
      ) {
        throw new ValidationError(
          "outcome must be one of: 'success', 'failure', 'partial'",
        );
      }
      outcome = rawOutcome;
    }

    try {
      await recordPatternAdoption(projectId, patternId, outcome ?? null);
      return c.json({ ok: true, adopted: true, outcome: outcome ?? null });
    } catch (err) {
      console.warn(
        '[hipp0:shared-patterns] adopt failed:',
        (err as Error).message,
      );
      return c.json({ error: 'Failed to record adoption' }, 500);
    }
  });

  // POST /api/projects/:id/patterns/share — opt-in: publish a pattern
  app.post('/api/projects/:id/patterns/share', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);

    let body: Record<string, unknown> = {};
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      throw new ValidationError('Request body must be valid JSON');
    }

    const title = requireString(body.title, 'title', 300);
    const description = requireString(body.description, 'description', 2000);

    const input: SharedPatternInput = {
      title,
      description,
      pattern_type:
        typeof body.pattern_type === 'string' ? body.pattern_type : 'community',
      confidence:
        typeof body.confidence === 'number' ? body.confidence : 0.5,
      domain: typeof body.domain === 'string' ? body.domain : null,
      tags: Array.isArray(body.tags)
        ? (body.tags as unknown[]).filter(
            (t): t is string => typeof t === 'string',
          )
        : [],
      project_id: projectId,
      agent_name:
        typeof body.agent_name === 'string' ? body.agent_name : undefined,
    };

    try {
      const result = await extractSharedPattern(projectId, input);
      return c.json(result, 201);
    } catch (err) {
      console.warn(
        '[hipp0:shared-patterns] share failed:',
        (err as Error).message,
      );
      return c.json({ error: 'Failed to share pattern' }, 500);
    }
  });
}
