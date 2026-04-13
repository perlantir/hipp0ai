import type { Hono } from 'hono';
import { getDb } from '@hipp0/core/db/index.js';
import { parseFeedback } from '@hipp0/core/db/parsers.js';
import { ValidationError } from '@hipp0/core/types.js';
import {
  recordFeedback,
  recordBatchFeedback,
  getFeedbackForAgent,
  computeAndApplyWeightUpdates,
  getWeightSuggestions,
  resetWeights,
  getWeightHistory,
} from '@hipp0/core/relevance-learner/index.js';
import { processWingFeedback, processWingFeedbackBatch } from '@hipp0/core';
import { requireUUID, requireString, optionalString, mapDbError, logAudit } from './validation.js';
import { requireProjectAccess } from './_helpers.js';
import { invalidateDecisionCaches } from '../cache/redis.js';
import { randomUUID } from 'node:crypto';

const VALID_RATINGS = ['useful', 'irrelevant', 'critical', 'missing'] as const;

export function registerFeedbackRoutes(app: Hono): void {
    // Single feedback
  app.post('/api/feedback', async (c) => {
    const body = await c.req.json<{
      agent_id?: unknown;
      decision_id?: unknown;
      compile_request_id?: unknown;
      rating?: unknown;
      was_useful?: boolean;
      usage_signal?: unknown;
      task_description?: unknown;
      notes?: unknown;
    }>();

    const agent_id = requireUUID(body.agent_id, 'agent_id');
    const decision_id = requireUUID(body.decision_id, 'decision_id');

    // Support both new rating system and old was_useful boolean
    const rating = body.rating as string | undefined;
    if (rating && !(VALID_RATINGS as readonly string[]).includes(rating)) {
      throw new ValidationError(`rating must be one of: ${VALID_RATINGS.join(', ')}`);
    }

    const wasUseful = rating
      ? (rating === 'useful' || rating === 'critical')
      : body.was_useful;
    if (wasUseful === undefined && !rating) {
      throw new ValidationError('Either rating or was_useful is required');
    }

    const compile_request_id =
      body.compile_request_id != null
        ? requireUUID(body.compile_request_id, 'compile_request_id')
        : null;

    try {
      const result = await recordFeedback({
        agent_id,
        decision_id,
        compile_request_id: compile_request_id ?? undefined,
        was_useful: wasUseful ?? true,
        usage_signal: optionalString(body.usage_signal, 'usage_signal', 100),
        rating,
        task_description: optionalString(body.task_description, 'task_description', 1000),
        notes: optionalString(body.notes, 'notes', 5000),
      } as Record<string, unknown> as any);

      // Wing affinity learning
      if (rating) {
        processWingFeedback(agent_id, decision_id, rating)
          .then(() => {
            // Invalidate caches after wing affinity changes
            const db = getDb();
            return db.query<Record<string, unknown>>('SELECT project_id FROM decisions WHERE id = ?', [decision_id]);
          })
          .then((res) => {
            const pid = res.rows[0]?.project_id as string | undefined;
            if (pid) invalidateDecisionCaches(pid).catch(() => {});
          })
          .catch(() => {});
      }

      // Check for auto-apply threshold
      checkAutoApply(agent_id).catch(() => {});

      return c.json(result, 201);
    } catch (err) {
      mapDbError(err);
    }
  });

    // Batch feedback
  app.post('/api/feedback/batch', async (c) => {
    const body = await c.req.json<{
      agent_id?: unknown;
      compile_request_id?: unknown;
      task_description?: unknown;
      ratings?: unknown;
    }>();

    const agent_id = requireUUID(body.agent_id, 'agent_id');
    const compile_request_id =
      body.compile_request_id != null
        ? requireUUID(body.compile_request_id, 'compile_request_id')
        : undefined;
    const task_description = optionalString(body.task_description, 'task_description', 1000);

    if (!Array.isArray(body.ratings) || body.ratings.length === 0) {
      throw new ValidationError('ratings must be a non-empty array');
    }

    const ratings = (body.ratings as Array<{ decision_id: unknown; rating: unknown }>).map((r) => {
      const decision_id = requireUUID(r.decision_id, 'decision_id');
      const rating = r.rating as string;
      if (!(VALID_RATINGS as readonly string[]).includes(rating)) {
        throw new ValidationError(`Invalid rating "${rating}" for decision ${decision_id}`);
      }
      return { decision_id, rating };
    });

    const result = await recordBatchFeedback(agent_id, compile_request_id, task_description, ratings);

    // Wing affinity learning from batch
    processWingFeedbackBatch(agent_id, ratings)
      .then(() => {
        // Invalidate caches after wing affinity changes
        const db = getDb();
        if (ratings.length === 0) return;
        return db.query<Record<string, unknown>>('SELECT project_id FROM decisions WHERE id = ? LIMIT 1', [ratings[0].decision_id]);
      })
      .then((res) => {
        if (res && res.rows[0]) {
          const pid = res.rows[0].project_id as string | undefined;
          if (pid) invalidateDecisionCaches(pid).catch(() => {});
        }
      })
      .catch(() => {});

    // Check for auto-apply
    checkAutoApply(agent_id).catch(() => {});

    return c.json(result, 201);
  });

    // Feedback history
  app.get('/api/agents/:id/feedback', async (c) => {
    const agentId = requireUUID(c.req.param('id'), 'agentId');
    const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200);
    const feedback = await getFeedbackForAgent(agentId, limit);
    return c.json(feedback);
  });

    // Weight suggestions (manual mode)
  app.get('/api/agents/:id/weight-suggestions', async (c) => {
    const agentId = requireUUID(c.req.param('id'), 'agentId');
    const suggestions = await getWeightSuggestions(agentId);
    return c.json({ agent_id: agentId, suggestions });
  });

    // Apply weights
  app.post('/api/agents/:id/apply-weights', async (c) => {
    const agentId = requireUUID(c.req.param('id'), 'agentId');
    const updates = await computeAndApplyWeightUpdates(agentId);
    logAudit('weights_applied', agentId, { updates_count: updates.length });
    return c.json({ agent_id: agentId, updates });
  });

    // Reset weights
  app.post('/api/agents/:id/reset-weights', async (c) => {
    const agentId = requireUUID(c.req.param('id'), 'agentId');
    const profile = await resetWeights(agentId);
    logAudit('weights_reset', agentId, {});
    return c.json({ agent_id: agentId, weights: profile.weights });
  });

    // Weight history
  app.get('/api/agents/:id/weight-history', async (c) => {
    const agentId = requireUUID(c.req.param('id'), 'agentId');
    const limit = Math.min(parseInt(c.req.query('limit') ?? '20', 10), 100);
    const history = await getWeightHistory(agentId, limit);
    return c.json(history);
  });
}

// ---------------------------------------------------------------------------
// Auto-apply check
// ---------------------------------------------------------------------------

async function checkAutoApply(agentId: string): Promise<void> {
  try {
    const db = getDb();

    // Check if learning should trigger based on DB count
    const countResult = await db.query<Record<string, unknown>>(
      `SELECT COUNT(*) as cnt FROM relevance_feedback WHERE agent_id = ? AND created_at >= ${db.dialect === 'sqlite' ? "datetime('now', '-1 hour')" : "NOW() - INTERVAL '1 hour'"}`,
      [agentId],
    );
    const recentCount = Number((countResult.rows[0] as any)?.cnt ?? 0);
    if (recentCount <= 0 || recentCount % 10 !== 0) return;

    // Check if project is in auto mode (default)
    const agentResult = await db.query<{ project_id: string }>(
      'SELECT project_id FROM agents WHERE id = ?',
      [agentId],
    );
    if (agentResult.rows.length === 0) return;

    const projResult = await db.query<{ metadata: unknown }>(
      'SELECT metadata FROM projects WHERE id = ?',
      [agentResult.rows[0].project_id],
    );
    if (projResult.rows.length === 0) return;

    let metadata: Record<string, unknown> = {};
    const raw = projResult.rows[0].metadata;
    if (typeof raw === 'string') try { metadata = JSON.parse(raw); } catch {}
    else if (raw && typeof raw === 'object') metadata = raw as Record<string, unknown>;

    const mode = (metadata.learning_mode as string) ?? 'auto';
    if (mode === 'auto') {
      await computeAndApplyWeightUpdates(agentId);
    }
  } catch (err) {
    console.warn('[hipp0:learner] Auto-apply failed:', (err as Error).message);
  }
}
