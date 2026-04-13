/**
 * Knowledge Insights Routes (Tier 3 of the Three-Tier Knowledge Pipeline)
 *
 * GET   /api/projects/:id/insights                — list insights with filters
 * POST  /api/projects/:id/insights/generate       — trigger pipeline run
 * PATCH /api/projects/:id/insights/:insightId     — update status (e.g. dismiss)
 */
import type { Hono } from 'hono';
import { ValidationError, NotFoundError } from '@hipp0/core/types.js';
import {
  getInsights,
  runFullPipeline,
  updateInsightStatus,
} from '@hipp0/core/intelligence/knowledge-pipeline.js';
import type {
  InsightType,
  InsightStatus,
} from '@hipp0/core/intelligence/knowledge-pipeline.js';
import { requireUUID, logAudit } from './validation.js';
import { requireProjectAccess } from './_helpers.js';

const VALID_TYPES: InsightType[] = [
  'procedure',
  'policy',
  'anti_pattern',
  'domain_rule',
];
const VALID_STATUSES: InsightStatus[] = [
  'active',
  'superseded',
  'dismissed',
];

export function registerInsightRoutes(app: Hono): void {
  // GET /api/projects/:id/insights
  app.get('/api/projects/:id/insights', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);

    const typeParam = c.req.query('type');
    if (typeParam && !VALID_TYPES.includes(typeParam as InsightType)) {
      throw new ValidationError(
        `type must be one of: ${VALID_TYPES.join(', ')}`,
      );
    }

    const statusParam = c.req.query('status');
    if (statusParam && !VALID_STATUSES.includes(statusParam as InsightStatus)) {
      throw new ValidationError(
        `status must be one of: ${VALID_STATUSES.join(', ')}`,
      );
    }

    const domain = c.req.query('domain');

    const minConfidenceRaw = c.req.query('min_confidence');
    let minConfidence: number | undefined;
    if (minConfidenceRaw !== undefined) {
      const parsed = parseFloat(minConfidenceRaw);
      if (isNaN(parsed) || parsed < 0 || parsed > 1) {
        throw new ValidationError('min_confidence must be a number between 0 and 1');
      }
      minConfidence = parsed;
    }

    const limitRaw = c.req.query('limit');
    let limit: number | undefined;
    if (limitRaw !== undefined) {
      const parsed = parseInt(limitRaw, 10);
      if (isNaN(parsed) || parsed < 1) {
        throw new ValidationError('limit must be a positive integer');
      }
      limit = Math.min(parsed, 500);
    }

    const tagsParam = c.req.query('tags');
    const tags = tagsParam
      ? tagsParam.split(',').map((t) => t.trim()).filter(Boolean)
      : undefined;

    const insights = await getInsights(projectId, {
      type: typeParam as InsightType | undefined,
      status: statusParam as InsightStatus | undefined,
      domain: domain ?? undefined,
      min_confidence: minConfidence,
      limit,
      tags,
    });

    return c.json({
      insights,
      count: insights.length,
    });
  });

  // POST /api/projects/:id/insights/generate
  app.post('/api/projects/:id/insights/generate', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);

    const summary = await runFullPipeline(projectId);

    logAudit('knowledge_pipeline_run', projectId, {
      duration_ms: summary.duration_ms,
      facts_extracted: summary.tier1_to_tier2.facts_extracted,
      insights_created: summary.tier2_to_tier3.total_created,
    });

    return c.json(summary);
  });

  // PATCH /api/projects/:id/insights/:insightId
  app.patch('/api/projects/:id/insights/:insightId', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);
    const insightId = requireUUID(c.req.param('insightId'), 'insightId');

    const body = await c.req.json<Record<string, unknown>>();
    const status = body.status;

    if (typeof status !== 'string' || !VALID_STATUSES.includes(status as InsightStatus)) {
      throw new ValidationError(
        `status must be one of: ${VALID_STATUSES.join(', ')}`,
      );
    }

    const updated = await updateInsightStatus(
      projectId,
      insightId,
      status as InsightStatus,
    );
    if (!updated) {
      throw new NotFoundError('Insight', insightId);
    }

    logAudit('knowledge_insight_updated', projectId, {
      insight_id: insightId,
      status,
    });

    return c.json(updated);
  });
}
