/**
 * Feature 11: What-If Simulator — API Routes
 */
import type { Hono } from 'hono';
import { getDb } from '@hipp0/core/db/index.js';
import { NotFoundError, ValidationError } from '@hipp0/core/types.js';
import { requireUUID, requireString, validateTags, validateAffects } from './validation.js';
import { requireProjectAccess } from './_helpers.js';
import {
  simulateDecisionChange,
  simulateHistoricalImpact,
  simulateMultiDecisionChange,
  simulateCascadeImpact,
  simulateRollback,
} from '@hipp0/core/intelligence/whatif-simulator.js';
import {
  predictDecisionImpact,
} from '@hipp0/core/intelligence/impact-predictor.js';

export function registerSimulationRoutes(app: Hono): void {
    // POST /api/simulation/preview
  app.post('/api/simulation/preview', async (c) => {
    const body = await c.req.json();

    const decisionId = requireUUID(body.decision_id, 'decision_id');
    const projectId = requireUUID(body.project_id, 'project_id');
    await requireProjectAccess(c, projectId);

    if (!body.proposed_changes || typeof body.proposed_changes !== 'object') {
      throw new ValidationError('proposed_changes is required and must be an object');
    }

    const proposedChanges: Record<string, unknown> = {};
    if (body.proposed_changes.title !== undefined) {
      proposedChanges.title = requireString(body.proposed_changes.title, 'proposed_changes.title', 500);
    }
    if (body.proposed_changes.description !== undefined) {
      proposedChanges.description = requireString(body.proposed_changes.description, 'proposed_changes.description', 10000);
    }
    if (body.proposed_changes.tags !== undefined) {
      proposedChanges.tags = validateTags(body.proposed_changes.tags);
    }
    if (body.proposed_changes.affects !== undefined) {
      proposedChanges.affects = validateAffects(body.proposed_changes.affects);
    }

    const result = await simulateDecisionChange(decisionId, proposedChanges, projectId);
    return c.json(result);
  });

    // POST /api/simulation/historical
  app.post('/api/simulation/historical', async (c) => {
    const body = await c.req.json();

    const decisionId = requireUUID(body.decision_id, 'decision_id');
    const projectId = requireUUID(body.project_id, 'project_id');
    await requireProjectAccess(c, projectId);
    const lookbackDays = typeof body.lookback_days === 'number' ? body.lookback_days : 30;

    if (!body.proposed_changes || typeof body.proposed_changes !== 'object') {
      throw new ValidationError('proposed_changes is required and must be an object');
    }

    const proposedChanges: Record<string, unknown> = {};
    if (body.proposed_changes.title !== undefined) {
      proposedChanges.title = body.proposed_changes.title;
    }
    if (body.proposed_changes.description !== undefined) {
      proposedChanges.description = body.proposed_changes.description;
    }
    if (body.proposed_changes.tags !== undefined) {
      proposedChanges.tags = body.proposed_changes.tags;
    }
    if (body.proposed_changes.affects !== undefined) {
      proposedChanges.affects = body.proposed_changes.affects;
    }

    // Run both real-time and historical simulation
    const [simulation, historical] = await Promise.all([
      simulateDecisionChange(decisionId, proposedChanges, projectId),
      simulateHistoricalImpact(decisionId, proposedChanges, projectId, lookbackDays),
    ]);

    return c.json({
      ...simulation,
      historical: historical ?? { lookback_days: lookbackDays, compile_appearances: 0, agents_that_received: [], avg_score: 0 },
    });
  });

    // POST /api/simulation/apply
  app.post('/api/simulation/apply', async (c) => {
    const db = getDb();
    const body = await c.req.json();

    const decisionId = requireUUID(body.decision_id, 'decision_id');
    const projectId = requireUUID(body.project_id, 'project_id');
    await requireProjectAccess(c, projectId);

    if (!body.proposed_changes || typeof body.proposed_changes !== 'object') {
      throw new ValidationError('proposed_changes is required and must be an object');
    }

    // Get original decision
    const origResult = await db.query(
      `SELECT * FROM decisions WHERE id = ? AND project_id = ?`,
      [decisionId, projectId],
    );
    if (origResult.rows.length === 0) {
      throw new NotFoundError('Decision', decisionId);
    }
    const original = origResult.rows[0] as Record<string, unknown>;

    // Parse JSON fields from original
    const origTags = typeof original.tags === 'string' ? JSON.parse(original.tags as string) : original.tags ?? [];
    const origAffects = typeof original.affects === 'string' ? JSON.parse(original.affects as string) : original.affects ?? [];
    const origAlternatives = typeof original.alternatives_considered === 'string'
      ? JSON.parse(original.alternatives_considered as string) : original.alternatives_considered ?? [];
    const origAssumptions = typeof original.assumptions === 'string'
      ? JSON.parse(original.assumptions as string) : original.assumptions ?? [];
    const origOpenQuestions = typeof original.open_questions === 'string'
      ? JSON.parse(original.open_questions as string) : original.open_questions ?? [];
    const origDependencies = typeof original.dependencies === 'string'
      ? JSON.parse(original.dependencies as string) : original.dependencies ?? [];
    const origMetadata = typeof original.metadata === 'string'
      ? JSON.parse(original.metadata as string) : original.metadata ?? {};

    // Build new decision values
    const newTitle = body.proposed_changes.title ?? original.title;
    const newDescription = body.proposed_changes.description ?? original.description;
    const newTags = body.proposed_changes.tags ?? origTags;
    const newAffects = body.proposed_changes.affects ?? origAffects;

    // Generate new ID
    const newId = crypto.randomUUID();

    // Create new decision with proposed content
    await db.query(
      `INSERT INTO decisions (id, project_id, title, description, reasoning, made_by, source, confidence, status, supersedes_id, alternatives_considered, affects, tags, assumptions, open_questions, dependencies, confidence_decay_rate, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        newId,
        projectId,
        newTitle,
        newDescription,
        original.reasoning ?? '',
        original.made_by ?? 'whatif-simulator',
        'manual',
        original.confidence ?? 'medium',
        decisionId,
        JSON.stringify(origAlternatives),
        JSON.stringify(newAffects),
        JSON.stringify(newTags),
        JSON.stringify(origAssumptions),
        JSON.stringify(origOpenQuestions),
        JSON.stringify(origDependencies),
        original.confidence_decay_rate ?? 0.1,
        JSON.stringify(origMetadata),
      ],
    );

    // Supersede original
    await db.query(
      `UPDATE decisions SET status = 'superseded', updated_at = NOW() WHERE id = ?`,
      [decisionId],
    );

    // Create decision_edge if table exists
    try {
      await db.query(
        `INSERT INTO decision_edges (id, source_id, target_id, relationship, description, strength)
         VALUES (?, ?, ?, 'supersedes', 'Applied via What-If Simulator', 1.0)`,
        [crypto.randomUUID(), newId, decisionId],
      );
    } catch {
      // decision_edges table may not exist
    }

    return c.json({
      success: true,
      new_decision_id: newId,
      superseded_decision_id: decisionId,
    });
  });

    // POST /api/simulation/predict-impact
  app.post('/api/simulation/predict-impact', async (c) => {
    const body = await c.req.json();

    const projectId = requireUUID(body.project_id, 'project_id');
    await requireProjectAccess(c, projectId);

    const title = requireString(body.title, 'title', 500);
    const description = body.description != null ? requireString(body.description, 'description', 10000) : undefined;
    const tags = body.tags != null ? validateTags(body.tags) : undefined;
    const affects = body.affects != null ? validateAffects(body.affects) : undefined;
    const confidence = body.confidence != null ? String(body.confidence) : undefined;
    const made_by = body.made_by != null ? String(body.made_by) : undefined;
    const domain = body.domain != null ? String(body.domain) : undefined;

    const prediction = await predictDecisionImpact(projectId, {
      title,
      description,
      tags,
      confidence,
      made_by,
      affects,
      domain,
    });

    return c.json(prediction);
  });

  // POST /api/simulation/multi-change — simulate multiple decisions at once
  app.post('/api/simulation/multi-change', async (c) => {
    const body = await c.req.json<Record<string, unknown>>();

    const projectId = requireUUID(body.project_id, 'project_id');
    await requireProjectAccess(c, projectId);

    if (!Array.isArray(body.changes) || body.changes.length === 0) {
      throw new ValidationError('changes must be a non-empty array');
    }
    if (body.changes.length > 25) {
      throw new ValidationError('changes: maximum 25 items per request');
    }

    const changes = (body.changes as Array<Record<string, unknown>>).map((ch, i) => {
      const decisionId = requireUUID(ch.decision_id, `changes[${i}].decision_id`);
      if (!ch.proposed_changes || typeof ch.proposed_changes !== 'object') {
        throw new ValidationError(`changes[${i}].proposed_changes is required and must be an object`);
      }
      const pc = ch.proposed_changes as Record<string, unknown>;
      const proposed: Record<string, unknown> = {};
      if (pc.title !== undefined) proposed.title = requireString(pc.title, `changes[${i}].proposed_changes.title`, 500);
      if (pc.description !== undefined) proposed.description = requireString(pc.description, `changes[${i}].proposed_changes.description`, 10000);
      if (pc.tags !== undefined) proposed.tags = validateTags(pc.tags);
      if (pc.affects !== undefined) proposed.affects = validateAffects(pc.affects);
      return { decision_id: decisionId, proposed_changes: proposed };
    });

    const result = await simulateMultiDecisionChange(projectId, changes);
    return c.json(result);
  });

  // POST /api/simulation/cascade — cascade impact analysis via decision_edges
  app.post('/api/simulation/cascade', async (c) => {
    const body = await c.req.json<Record<string, unknown>>();

    const decisionId = requireUUID(body.decision_id, 'decision_id');
    const projectId = requireUUID(body.project_id, 'project_id');
    await requireProjectAccess(c, projectId);

    if (!body.proposed_changes || typeof body.proposed_changes !== 'object') {
      throw new ValidationError('proposed_changes is required and must be an object');
    }
    const pc = body.proposed_changes as Record<string, unknown>;
    const proposed: Record<string, unknown> = {};
    if (pc.title !== undefined) proposed.title = requireString(pc.title, 'proposed_changes.title', 500);
    if (pc.description !== undefined) proposed.description = requireString(pc.description, 'proposed_changes.description', 10000);
    if (pc.tags !== undefined) proposed.tags = validateTags(pc.tags);
    if (pc.affects !== undefined) proposed.affects = validateAffects(pc.affects);

    const result = await simulateCascadeImpact(projectId, decisionId, proposed);
    return c.json(result);
  });

  // POST /api/simulation/rollback — what happens if we revert a decision
  app.post('/api/simulation/rollback', async (c) => {
    const body = await c.req.json<Record<string, unknown>>();

    const decisionId = requireUUID(body.decision_id, 'decision_id');
    const projectId = requireUUID(body.project_id, 'project_id');
    await requireProjectAccess(c, projectId);

    try {
      const result = await simulateRollback(projectId, decisionId);
      return c.json(result);
    } catch (err) {
      if ((err as Error).message.includes('not found')) {
        throw new NotFoundError('Decision', decisionId);
      }
      throw err;
    }
  });
}
