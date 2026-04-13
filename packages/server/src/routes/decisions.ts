import type { Hono } from 'hono';
import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '@hipp0/core/db/index.js';
import { parseDecision, parseEdge } from '@hipp0/core/db/parsers.js';
import { withSpan, getMetrics, recordCounter } from '../telemetry.js';
import { NotFoundError, ValidationError } from '@hipp0/core/types.js';
import type { Decision, DecisionEdge, NotificationType } from '@hipp0/core/types.js';
import { propagateChange } from '@hipp0/core/change-propagator/index.js';
import { checkForContradictions } from '@hipp0/core/contradiction-detector/index.js';
import { dispatchWebhooks } from '@hipp0/core/webhooks/index.js';
import { findCascadeImpact, notifyCascade } from '@hipp0/core/dependency-cascade/index.js';
import { submitForExtraction } from '../queue/index.js';
import { randomUUID } from 'node:crypto';
import {
  requireUUID,
  requireString,
  optionalString,
  validateTags,
  validateAffects,
  validateAlternatives,
  mapDbError,
  logAudit,
  generateEmbedding,
} from './validation.js';
import { broadcast } from '../websocket.js';
import { safeEmit } from '../events/event-stream.js';
import { invalidateDecisionCaches } from '../cache/redis.js';
import { isAuthRequired, getTenantId } from '../auth/middleware.js';
import { notifySupersededDecision } from '../connectors/github.js';
import { classifyDecision as autoClassify } from '@hipp0/core/hierarchy/classifier.js';
import { classifyDecisionWing, maybeRecalculateWings, defaultProvenance, computeTrust, validationProvenance } from '@hipp0/core';
import { predictDecisionImpact } from '@hipp0/core/intelligence/impact-predictor.js';
import { requireProjectAccess } from './_helpers.js';

export function registerDecisionRoutes(app: Hono): void {
  // Decisions — Create & List (project-scoped)

  app.post('/api/projects/:id/decisions', async (c) => {
    const db = getDb();
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);
    const rawBody = await c.req.json();

    // Bulk import: if body is an array, create each decision and return array of results
    if (Array.isArray(rawBody)) {
      const results: Array<Record<string, unknown>> = [];
      const errors: Array<{ index: number; error: string }> = [];
      for (let i = 0; i < rawBody.length; i++) {
        try {
          const item = rawBody[i] as Record<string, unknown>;
          const title = requireString(item.title, 'title', 500);
          const description = requireString(item.description, 'description', 10000);
          const reasoning = item.reasoning != null ? requireString(item.reasoning, 'reasoning', 10000) : description;
          const made_by = requireString(item.made_by, 'made_by', 200);
          const confidence = optionalString(item.confidence, 'confidence', 20) ?? 'medium';
          const tags = item.tags ?? [];
          const affects = item.affects ?? [];
          const result = await db.query(
            `INSERT INTO decisions
             (project_id, title, description, reasoning, made_by, source, confidence, status,
              alternatives_considered, affects, tags, assumptions, open_questions, dependencies,
              confidence_decay_rate, metadata)
             VALUES (?, ?, ?, ?, ?, 'manual', ?, 'active', '[]', ?, ?, '[]', '[]', '[]', 0, '{}')
             RETURNING *`,
            [projectId, title, description, reasoning, made_by, confidence,
             db.arrayParam(affects as string[]), db.arrayParam(tags as string[])],
          );
          const created = parseDecision(result.rows[0] as Record<string, unknown>) as unknown as Record<string, unknown>;
          results.push(created);
          safeEmit('decision.created', projectId, {
            decision_id: created.id,
            title: created.title,
            made_by: created.made_by,
            source: 'manual',
            bulk: true,
          });
        } catch (err) {
          errors.push({ index: i, error: (err as Error).message });
        }
      }
      try {
        const __m = getMetrics();
        recordCounter(__m.decisionsCreated, results.length, {
          project_id: projectId,
          source: 'bulk_import',
        });
      } catch { /* ignore */ }
      return c.json({ created: results.length, errors, decisions: results }, 201);
    }

    const body = rawBody as {
      title?: unknown;
      description?: unknown;
      reasoning?: unknown;
      made_by?: unknown;
      source?: unknown;
      source_session_id?: unknown;
      confidence?: unknown;
      status?: unknown;
      supersedes_id?: unknown;
      alternatives_considered?: unknown;
      affects?: unknown;
      tags?: unknown;
      assumptions?: unknown;
      open_questions?: unknown;
      dependencies?: unknown;
      confidence_decay_rate?: number;
      metadata?: Record<string, unknown>;
      depends_on?: unknown[];
      temporal_scope?: unknown;
      namespace?: unknown;
      provenance_chain?: unknown;
    };

    const title = requireString(body.title, 'title', 500);
    const description = requireString(body.description, 'description', 10000);
    const reasoning = body.reasoning != null ? requireString(body.reasoning, 'reasoning', 10000) : description;
    const made_by = requireString(body.made_by, 'made_by', 200);
    const tags = validateTags(body.tags);
    const affects = validateAffects(body.affects);
    const alternatives_considered = validateAlternatives(body.alternatives_considered);

    const supersedes_id =
      body.supersedes_id != null ? requireUUID(body.supersedes_id, 'supersedes_id') : null;

    const embeddingText = `${title}\n${description}\n${reasoning}`;
    const embedding = await generateEmbedding(embeddingText);

    // Auto-classify domain + category
    const classification = autoClassify(title, description, tags, {
      source: (body.source as Decision['source']) ?? 'manual',
      confidence: (body.confidence as Decision['confidence']) ?? 'high',
    });

    // Validate temporal_scope
    const validScopes = ['permanent', 'sprint', 'experiment'] as const;
    const temporal_scope = body.temporal_scope
      ? (validScopes as readonly string[]).includes(String(body.temporal_scope))
        ? String(body.temporal_scope)
        : 'permanent'
      : 'permanent';

    return withSpan('decision_create', {
      project_id: projectId,
      agent_name: made_by as string,
      source: (body.source as string) ?? 'manual',
    }, async () => {
    try {
      const namespaceVal = body.namespace != null ? optionalString(body.namespace, 'namespace', 100) : null;

      // Provenance & trust scoring
      const source = (body.source as string) ?? 'manual';
      const provenance = Array.isArray(body.provenance_chain) && body.provenance_chain.length > 0
        ? body.provenance_chain
        : [defaultProvenance(source, made_by)];
      const { trust_score } = computeTrust({
        ...({} as Decision),
        provenance_chain: provenance as Decision['provenance_chain'],
        source: source as Decision['source'],
        confidence: ((body.confidence as string) ?? 'high') as Decision['confidence'],
        validated_at: undefined,
        created_at: new Date().toISOString(),
      });

      const result = await db.query(
        `INSERT INTO decisions (
           project_id, title, description, reasoning, made_by,
           source, source_session_id, confidence, status, supersedes_id,
           alternatives_considered, affects, tags, assumptions,
           open_questions, dependencies, confidence_decay_rate, metadata, embedding,
           domain, category, priority_level, temporal_scope, valid_from, namespace,
           provenance_chain, trust_score
         ) VALUES (
           ?, ?, ?, ?, ?,
           ?, ?, ?, ?, ?,
           ?, ?, ?, ?,
           ?, ?, ?, ?, ?,
           ?, ?, ?, ?, NOW(), ?,
           ?, ?
         ) RETURNING *`,
        [
          projectId,
          title,
          description,
          reasoning,
          made_by,
          source,
          body.source_session_id ?? null,
          body.confidence ?? 'high',
          body.status ?? 'active',
          supersedes_id,
          JSON.stringify(alternatives_considered),
          db.arrayParam(affects),
          db.arrayParam(tags),
          JSON.stringify(body.assumptions ?? []),
          JSON.stringify(body.open_questions ?? []),
          JSON.stringify(body.dependencies ?? []),
          body.confidence_decay_rate ?? 0.0,
          JSON.stringify(body.metadata ?? {}),
          embedding ? `[${embedding.join(',')}]` : null,
          classification.domain,
          classification.category,
          1, // default priority_level
          temporal_scope,
          namespaceVal,
          JSON.stringify(provenance),
          trust_score,
        ],
      );

      const decision = parseDecision(result.rows[0] as Record<string, unknown>);

      // Auto-classify against wing profiles (5-signal scoring)
      const wingClassification = classifyDecisionWing(
        title, description, tags, made_by, classification.domain,
      );

      // Store classification metadata and assign wing
      if (wingClassification.best_wing || wingClassification.classification_confidence > 0) {
        const meta = {
          ...(decision.metadata ?? {}),
          auto_domain: wingClassification.auto_domain,
          auto_category: wingClassification.auto_category,
          classification_confidence: wingClassification.classification_confidence,
          wing_scores: wingClassification.wing_scores,
        };
        const wingVal = wingClassification.best_wing ?? decision.made_by;
        // Compute priority_level based on confidence + dependency count
        const depCount = Array.isArray(body.depends_on) ? body.depends_on.length : 0;
        const autoPriority = wingClassification.classification_confidence > 0.6 && depCount > 2 ? 2 : wingClassification.classification_confidence > 0.4 ? 1 : 0;
        await db.query(
          'UPDATE decisions SET metadata = ?, wing = ?, priority_level = ? WHERE id = ?',
          [JSON.stringify(meta), wingVal, autoPriority, decision.id],
        ).catch(() => {});
        (decision as unknown as Record<string, unknown>).wing = wingVal;
        (decision as unknown as Record<string, unknown>).metadata = meta;
        (decision as unknown as Record<string, unknown>).priority_level = autoPriority;
      }

      logAudit('decision_created', projectId, {
        decision_id: decision.id,
        title: decision.title,
        made_by: decision.made_by,
      });

      // Invalidate caches on new decision
      invalidateDecisionCaches(projectId).catch(() => {});

      propagateChange(decision, 'decision_created').catch((err) =>
        console.error('[hipp0] Change propagation failed:', (err as Error).message),
      );

      dispatchWebhooks(projectId, 'decision_created', {
        decision_id: decision.id,
        title: decision.title,
        made_by: decision.made_by,
      }).catch((err) => console.warn('[hipp0:webhook]', (err as Error).message));

      broadcast('decision_created', { id: decision.id, title: decision.title, project_id: projectId });

      safeEmit('decision.created', projectId, {
        decision_id: decision.id,
        title: decision.title,
        made_by: decision.made_by,
        confidence: decision.confidence,
        status: decision.status,
        tags: decision.tags,
      });

      checkForContradictions(decision)
        .then((found) => {
          try {
            const count = Array.isArray(found) ? found.length : 0;
            if (count > 0) {
              const __m = getMetrics();
              recordCounter(__m.contradictionsDetected, count, {
                project_id: projectId,
              });
            }
          } catch { /* ignore */ }
        })
        .catch((err) =>
          console.error('[hipp0] Contradiction check failed:', (err as Error).message),
        );

      // Wing recalculation trigger: every 50 decisions
      maybeRecalculateWings(projectId).catch(() => {});

      // Background: compute and store predicted impact in metadata
      predictDecisionImpact(projectId, {
        title: decision.title,
        description: decision.description,
        tags: decision.tags,
        confidence: decision.confidence,
        made_by: decision.made_by,
        affects: decision.affects,
        domain: decision.domain ?? undefined,
      }).then(async (prediction) => {
        try {
          const existingMeta = decision.metadata ?? {};
          const updatedMeta = { ...existingMeta, predicted_impact: prediction };
          await db.query(
            'UPDATE decisions SET metadata = ? WHERE id = ?',
            [JSON.stringify(updatedMeta), decision.id],
          );
        } catch (e) {
          console.error('[hipp0] Impact prediction storage failed:', (e as Error).message);
        }
      }).catch((err) =>
        console.error('[hipp0] Impact prediction failed:', (err as Error).message),
      );

      // Create "requires" edges from depends_on
      if (Array.isArray(body.depends_on)) {
        for (const targetId of body.depends_on) {
          try {
            const tid = requireUUID(targetId, 'depends_on');
            await db.query(
              `INSERT INTO decision_edges (id, source_id, target_id, relationship)
               VALUES (?, ?, ?, 'requires')
               ON CONFLICT (source_id, target_id, relationship) DO NOTHING`,
              [randomUUID(), decision.id, tid],
            );
          } catch { /* skip invalid IDs */ }
        }
      }

      try {
        const __m = getMetrics();
        recordCounter(__m.decisionsCreated, 1, {
          project_id: projectId,
          agent_name: (made_by as string) ?? 'unknown',
          source: (body.source as string) ?? 'manual',
        });
      } catch { /* ignore */ }

      return c.json(decision, 201);
    } catch (err) {
      mapDbError(err);
    }
    });
  });

  app.get('/api/projects/:id/decisions', async (c) => {
    const db = getDb();
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);
    const status = c.req.query('status');
    const tagsParam = c.req.query('tags');
    const madeBy = c.req.query('made_by');
    const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 500);
    const offset = Math.max(parseInt(c.req.query('offset') ?? '0', 10), 0);

    const tags = tagsParam ? tagsParam.split(',').map((t) => t.trim()) : null;

    const conditions: string[] = ['d.project_id = ?'];
    const params: unknown[] = [projectId];

    if (status) {
      conditions.push(`d.status = ?`);
      params.push(status);
    }
    if (tags && tags.length > 0) {
      conditions.push(`d.tags && ?`);
      params.push(db.arrayParam(tags));
    }
    if (madeBy) {
      conditions.push(`d.made_by = ?`);
      params.push(madeBy);
    }

    params.push(limit);
    params.push(offset);

    // Total count for pagination
    const countResult = await db.query(
      `SELECT COUNT(*) as total FROM decisions d WHERE ${conditions.join(' AND ')}`,
      params.slice(0, -2), // exclude limit and offset
    );
    const total = parseInt((countResult.rows[0] as Record<string, unknown>).total as string ?? '0', 10);

    const result = await db.query(
      `SELECT * FROM decisions d
       WHERE ${conditions.join(' AND ')}
       ORDER BY d.created_at DESC
       LIMIT ? OFFSET ?`,
      params,
    );

    c.header('X-Total-Count', String(total));
    return c.json(result.rows.map((r) => parseDecision(r as Record<string, unknown>)));
  });

  // Decisions — Single CRUD

  app.get('/api/decisions/:id', async (c) => {
    const db = getDb();
    const id = requireUUID(c.req.param('id'), 'id');
    let result;
    if (isAuthRequired()) {
      const tenantId = getTenantId(c);
      result = await db.query(
        'SELECT * FROM decisions WHERE id = ? AND project_id IN (SELECT id FROM projects WHERE tenant_id = ?)',
        [id, tenantId],
      );
    } else {
      result = await db.query('SELECT * FROM decisions WHERE id = ?', [id]);
    }
    if (result.rows.length === 0) throw new NotFoundError('Decision', id);
    return c.json(parseDecision(result.rows[0] as Record<string, unknown>));
  });

  app.patch('/api/decisions/:id', async (c) => {
    const db = getDb();
    const id = requireUUID(c.req.param('id'), 'id');
    const body = await c.req.json<
      Partial<{
        title: unknown;
        description: unknown;
        reasoning: unknown;
        made_by: unknown;
        confidence: unknown;
        status: unknown;
        affects: unknown;
        tags: unknown;
        assumptions: unknown[];
        open_questions: unknown[];
        dependencies: unknown[];
        alternatives_considered: unknown;
        confidence_decay_rate: number;
        metadata: Record<string, unknown>;
        validated_at: unknown;
        validation_source: unknown;
        domain: unknown;
        category: unknown;
        priority_level: unknown;
        namespace: unknown;
      }>
    >();

    let existing;
    if (isAuthRequired()) {
      const tenantId = getTenantId(c);
      existing = await db.query(
        'SELECT id FROM decisions WHERE id = ? AND project_id IN (SELECT id FROM projects WHERE tenant_id = ?)',
        [id, tenantId],
      );
    } else {
      existing = await db.query('SELECT id FROM decisions WHERE id = ?', [id]);
    }
    if (existing.rows.length === 0) throw new NotFoundError('Decision', id);

    const setClauses: string[] = ['updated_at = NOW()'];
    const params: unknown[] = [];

    const addField = (col: string, val: unknown, asJson = false) => {
      setClauses.push(`${col} = ?`);
      params.push(asJson ? JSON.stringify(val) : val);
    };

    if (body.title !== undefined) addField('title', requireString(body.title, 'title', 500));
    if (body.description !== undefined)
      addField('description', requireString(body.description, 'description', 10000));
    if (body.reasoning !== undefined)
      addField('reasoning', requireString(body.reasoning, 'reasoning', 10000));
    if (body.made_by !== undefined)
      addField('made_by', requireString(body.made_by, 'made_by', 200));
    if (body.confidence !== undefined) addField('confidence', body.confidence);
    if (body.status !== undefined) addField('status', body.status);
    if (body.affects !== undefined) addField('affects', db.arrayParam(validateAffects(body.affects)));
    if (body.tags !== undefined) addField('tags', db.arrayParam(validateTags(body.tags)));
    if (body.assumptions !== undefined) addField('assumptions', body.assumptions, true);
    if (body.open_questions !== undefined) addField('open_questions', body.open_questions, true);
    if (body.dependencies !== undefined) addField('dependencies', body.dependencies, true);
    if (body.alternatives_considered !== undefined)
      addField('alternatives_considered', validateAlternatives(body.alternatives_considered), true);
    if (body.confidence_decay_rate !== undefined)
      addField('confidence_decay_rate', body.confidence_decay_rate);
    if (body.metadata !== undefined) addField('metadata', body.metadata, true);
    if (body.validated_at !== undefined) addField('validated_at', body.validated_at);
    if (body.validation_source !== undefined)
      addField(
        'validation_source',
        optionalString(body.validation_source, 'validation_source', 200),
      );
    if (body.domain !== undefined) addField('domain', body.domain);
    if (body.category !== undefined) addField('category', body.category);
    if (body.priority_level !== undefined) {
      const pl = Number(body.priority_level);
      if (![0, 1, 2].includes(pl)) throw new ValidationError('priority_level must be 0, 1, or 2');
      addField('priority_level', pl);
    }
    if (body.namespace !== undefined) {
      addField('namespace', body.namespace === null ? null : optionalString(body.namespace, 'namespace', 100));
    }

    params.push(id);

    const result = await db.query(
      `UPDATE decisions SET ${setClauses.join(', ')} WHERE id = ? RETURNING *`,
      params,
    );

    const decision = parseDecision(result.rows[0] as Record<string, unknown>);

    logAudit('decision_updated', decision.project_id, {
      decision_id: decision.id,
      fields_updated: Object.keys(body),
    });

    // Invalidate caches on decision update
    invalidateDecisionCaches(decision.project_id).catch(() => {});

    propagateChange(decision, 'decision_updated').catch((err) =>
      console.error('[hipp0] Change propagation failed:', (err as Error).message),
    );

    broadcast('decision_updated', { id: decision.id, title: decision.title, project_id: decision.project_id });

    safeEmit('decision.updated', decision.project_id, {
      decision_id: decision.id,
      title: decision.title,
      fields_updated: Object.keys(body),
    });

    return c.json(decision);
  });

  // Supersede Decision

  app.post('/api/decisions/:id/supersede', async (c) => {
    const db = getDb();
    const oldId = requireUUID(c.req.param('id'), 'id');
    const body = await c.req.json<{
      title?: unknown;
      description?: unknown;
      reasoning?: unknown;
      made_by?: unknown;
      tags?: unknown;
      affects?: unknown;
    }>();

    const title = requireString(body.title, 'title', 500);
    const description = requireString(body.description, 'description', 10000);
    const reasoning = body.reasoning != null ? requireString(body.reasoning, 'reasoning', 10000) : (body.description ? requireString(body.description, 'description', 10000) : '');
    const made_by = requireString(body.made_by, 'made_by', 200);
    const tags = validateTags(body.tags);
    const affects = validateAffects(body.affects);

    const result = await db.transaction(async (txQuery) => {
      const oldResult = await txQuery('SELECT * FROM decisions WHERE id = ?', [oldId]);
      if (oldResult.rows.length === 0) throw new NotFoundError('Decision', oldId);
      const old = oldResult.rows[0] as Record<string, unknown>;

      const embeddingText = `${title}\n${description}\n${reasoning}`;
      const embedding = await generateEmbedding(embeddingText);

      const newResult = await txQuery(
        `INSERT INTO decisions (
           project_id, title, description, reasoning, made_by,
           source, confidence, status, supersedes_id,
           affects, tags, alternatives_considered, assumptions,
           open_questions, dependencies, metadata, embedding
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         RETURNING *`,
        [
          old.project_id,
          title,
          description,
          reasoning,
          made_by,
          'manual',
          'high',
          'active',
          oldId,
          db.arrayParam(affects.length ? affects : (old.affects as string[] ?? [])),
          db.arrayParam(tags.length ? tags : (old.tags as string[] ?? [])),
          old.alternatives_considered ?? '[]',
          old.assumptions ?? '[]',
          old.open_questions ?? '[]',
          old.dependencies ?? '[]',
          old.metadata ?? '{}',
          embedding ? `[${embedding.join(',')}]` : null,
        ],
      );

      const newId = (newResult.rows[0] as Record<string, unknown>).id as string;

      await txQuery(
        `UPDATE decisions SET status = 'superseded', updated_at = NOW(),
         valid_until = NOW(), superseded_by = ?, temporal_scope = 'deprecated'
         WHERE id = ?`,
        [newId, oldId],
      );

      await txQuery(
        // SQLite's decision_edges schema has id NOT NULL with no DEFAULT,
        // unlike Postgres. Client-generate so the INSERT works on both.
        `INSERT INTO decision_edges (id, source_id, target_id, relationship, strength)
         VALUES (?, ?, ?, 'supersedes', 1.0)
         ON CONFLICT (source_id, target_id, relationship) DO NOTHING`,
        [randomUUID(), newId, oldId],
      );

      return {
        newDecision: parseDecision(newResult.rows[0] as Record<string, unknown>),
        oldDecision: parseDecision({ ...old, status: 'superseded' }),
      };
    });

    logAudit('decision_superseded', (result.newDecision as Decision).project_id, {
      old_decision_id: oldId,
      new_decision_id: (result.newDecision as Decision).id,
      made_by,
    });

    // Invalidate caches on supersede
    invalidateDecisionCaches((result.newDecision as Decision).project_id).catch(() => {});

    propagateChange(result.newDecision as Decision, 'decision_superseded').catch((err) =>
      console.error('[hipp0] Change propagation failed:', (err as Error).message),
    );

    dispatchWebhooks((result.newDecision as Decision).project_id, 'decision_superseded', {
      decision_id: (result.newDecision as Decision).id,
      title: (result.newDecision as Decision).title,
      old_decision_id: oldId,
    }).catch((err) => console.warn('[hipp0:webhook]', (err as Error).message));

    safeEmit('decision.superseded', (result.newDecision as Decision).project_id, {
      old_decision_id: oldId,
      new_decision_id: (result.newDecision as Decision).id,
      title: (result.newDecision as Decision).title,
      made_by,
    });

    // Notify linked open PRs about superseded decision (fire-and-forget)
    notifySupersededDecision(
      oldId,
      (result.newDecision as Decision).id,
      (result.newDecision as Decision).title,
    ).catch((err) => console.warn('[hipp0/github] Supersede notify failed:', (err as Error).message));

    // Cascade impact detection (fire-and-forget notifications, but include in response)
    let cascadeImpact: { decisions_affected: number; chain: Array<Record<string, unknown>> } = { decisions_affected: 0, chain: [] };
    try {
      const cascade = await findCascadeImpact(oldId, (result.newDecision as Decision).project_id);
      cascadeImpact = {
        decisions_affected: cascade.total_affected,
        chain: cascade.impacts.map((i) => ({
          title: i.decision_title,
          depth: i.depth,
          impact: i.impact,
          agents_affected: i.affected_agents,
        })),
      };
      // Fire-and-forget: send notifications + webhooks
      notifyCascade(cascade, (result.newDecision as Decision).project_id, 'superseded').catch(
        (err) => console.warn('[hipp0:cascade]', (err as Error).message),
      );
      if (cascade.total_affected > 0) {
        dispatchWebhooks((result.newDecision as Decision).project_id, 'cascade_detected', {
          changed_decision_id: oldId,
          changed_decision_title: cascade.changed_decision_title,
          total_affected: cascade.total_affected,
        }).catch((err) => console.warn('[hipp0:webhook]', (err as Error).message));
      }
    } catch (err) {
      console.warn('[hipp0:cascade] Error:', (err as Error).message);
    }

    return c.json({ ...result, cascade_impact: cascadeImpact }, 201);
  });

  // Decision revert (restore superseded → active)

  app.post('/api/decisions/:id/revert', async (c) => {
    const db = getDb();
    const id = requireUUID(c.req.param('id'), 'id');

    const result = await db.query(
      `UPDATE decisions SET status = 'active', updated_at = NOW() WHERE id = ? RETURNING *`,
      [id],
    );

    if (result.rows.length === 0) throw new NotFoundError('Decision', id);
    const decision = parseDecision(result.rows[0] as Record<string, unknown>);

    logAudit('decision_reverted', decision.project_id, { decision_id: decision.id });

    // Invalidate caches on revert
    invalidateDecisionCaches(decision.project_id).catch(() => {});

    propagateChange(decision, 'decision_reverted').catch((err) =>
      console.error('[hipp0] Change propagation failed:', (err as Error).message),
    );

    dispatchWebhooks(decision.project_id, 'decision_reverted', {
      decision_id: decision.id,
      title: decision.title,
    }).catch((err) => console.warn('[hipp0:webhook]', (err as Error).message));

    // Cascade detection for revert (fire-and-forget)
    findCascadeImpact(id, decision.project_id).then((cascade) => {
      if (cascade.total_affected > 0) {
        notifyCascade(cascade, decision.project_id, 'reverted').catch(() => {});
        dispatchWebhooks(decision.project_id, 'cascade_detected', {
          changed_decision_id: id,
          changed_decision_title: cascade.changed_decision_title,
          total_affected: cascade.total_affected,
        }).catch(() => {});
      }
    }).catch((err) => console.warn('[hipp0:cascade]', (err as Error).message));

    return c.json(decision);
  });

  // Link-based supersession (link an old decision to a new one without creating)
  app.post('/api/decisions/:id/supersede-link', async (c) => {
    const db = getDb();
    const oldId = requireUUID(c.req.param('id'), 'id');
    const body = await c.req.json<{ superseded_by?: unknown }>();
    const newId = requireUUID(body.superseded_by, 'superseded_by');

    // Verify both decisions exist
    const oldResult = await db.query('SELECT * FROM decisions WHERE id = ?', [oldId]);
    if (oldResult.rows.length === 0) throw new NotFoundError('Decision', oldId);
    const newResult = await db.query('SELECT id FROM decisions WHERE id = ?', [newId]);
    if (newResult.rows.length === 0) throw new NotFoundError('Decision', newId);

    await db.transaction(async (txQuery) => {
      await txQuery(
        `UPDATE decisions SET status = 'superseded', updated_at = NOW(),
         valid_until = NOW(), superseded_by = ?, temporal_scope = 'deprecated'
         WHERE id = ?`,
        [newId, oldId],
      );
      await txQuery(
        `INSERT INTO decision_edges (id, source_id, target_id, relationship, strength)
         VALUES (?, ?, ?, 'supersedes', 1.0)
         ON CONFLICT (source_id, target_id, relationship) DO NOTHING`,
        [randomUUID(), newId, oldId],
      );
    });

    const updated = await db.query('SELECT * FROM decisions WHERE id = ?', [oldId]);
    const decision = parseDecision(updated.rows[0] as Record<string, unknown>);

    logAudit('decision_superseded', decision.project_id, {
      old_decision_id: oldId,
      new_decision_id: newId,
    });

    invalidateDecisionCaches(decision.project_id).catch(() => {});
    propagateChange(decision, 'decision_superseded').catch((err) =>
      console.error('[hipp0] Change propagation failed:', (err as Error).message),
    );

    safeEmit('decision.superseded', decision.project_id, {
      old_decision_id: oldId,
      new_decision_id: newId,
      title: decision.title,
      link_only: true,
    });

    return c.json(decision);
  });

  // Cascade preview endpoint
  app.get('/api/decisions/:id/cascade', async (c) => {
    const db = getDb();
    const id = requireUUID(c.req.param('id'), 'id');

    const decResult = await db.query('SELECT project_id FROM decisions WHERE id = ?', [id]);
    if (decResult.rows.length === 0) throw new NotFoundError('Decision', id);
    const projectId = (decResult.rows[0] as Record<string, unknown>).project_id as string;

    const cascade = await findCascadeImpact(id, projectId);
    return c.json({
      decision_id: id,
      decisions_affected: cascade.total_affected,
      chain: cascade.impacts.map((i) => ({
        decision_id: i.decision_id,
        title: i.decision_title,
        depth: i.depth,
        impact: i.impact,
        path: i.path,
        agents_affected: i.affected_agents,
      })),
    });
  });

  // Decision Graph + Impact

  app.get('/api/decisions/:id/graph', async (c) => {
    const db = getDb();
    const id = requireUUID(c.req.param('id'), 'id');
    const depth = Math.min(parseInt(c.req.query('depth') ?? '3', 10), 10);

    const visited = new Set<string>();
    const nodes: Decision[] = [];
    const edges: DecisionEdge[] = [];
    const queue: Array<{ nodeId: string; currentDepth: number }> = [
      { nodeId: id, currentDepth: 0 },
    ];

    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;
      const { nodeId, currentDepth } = item;
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);

      const decResult = await db.query('SELECT * FROM decisions WHERE id = ?', [nodeId]);
      if (decResult.rows.length === 0) continue;
      nodes.push(parseDecision(decResult.rows[0] as Record<string, unknown>));

      if (currentDepth >= depth) continue;

      const edgeResult = await db.query(
        'SELECT * FROM decision_edges WHERE source_id = ? OR target_id = ?',
        [nodeId, nodeId],
      );

      for (const row of edgeResult.rows) {
        const edge = parseEdge(row as Record<string, unknown>);
        if (!edges.find((e) => e.id === edge.id)) {
          edges.push(edge);
        }
        const nextId = edge.source_id === nodeId ? edge.target_id : edge.source_id;
        if (!visited.has(nextId)) {
          queue.push({ nodeId: nextId, currentDepth: currentDepth + 1 });
        }
      }
    }

    return c.json({ nodes, edges });
  });

  app.get('/api/decisions/:id/impact', async (c) => {
    const db = getDb();
    const id = requireUUID(c.req.param('id'), 'id');

    const decResult = await db.query('SELECT * FROM decisions WHERE id = ?', [id]);
    if (decResult.rows.length === 0) throw new NotFoundError('Decision', id);
    const decision = parseDecision(decResult.rows[0] as Record<string, unknown>);

    // Downstream: decisions this one affects (outgoing edges)
    const downstreamEdges = await db.query(
      `SELECT DISTINCT d.* FROM decisions d
       JOIN decision_edges e ON e.target_id = d.id
       WHERE e.source_id = ?`,
      [id],
    );
    const downstreamDecisions = downstreamEdges.rows.map((r) =>
      parseDecision(r as Record<string, unknown>),
    );

    // Upstream: decisions that depend ON this one (incoming edges)
    const upstreamEdges = await db.query(
      `SELECT DISTINCT d.* FROM decisions d
       JOIN decision_edges e ON e.source_id = d.id
       WHERE e.target_id = ?`,
      [id],
    );
    const upstreamDecisions = upstreamEdges.rows.map((r) =>
      parseDecision(r as Record<string, unknown>),
    );

    const affectedAgentIds = new Set<string>();
    if (decision.affects.length > 0) {
      const agentResult = await db.query(
        `SELECT DISTINCT a.* FROM agents a
         JOIN subscriptions s ON s.agent_id = a.id
         WHERE s.topic = ANY(?) AND a.project_id = ?`,
        [db.arrayParam(decision.affects), decision.project_id],
      );
      for (const row of agentResult.rows) {
        const agent = row as Record<string, unknown>;
        affectedAgentIds.add(agent.id as string);
      }
    }

    const affectedAgentsResult =
      affectedAgentIds.size > 0
        ? await db.query(`SELECT * FROM agents WHERE id = ANY(?)`, [
            db.arrayParam(Array.from(affectedAgentIds)),
          ])
        : { rows: [] };
    const affectedAgents = affectedAgentsResult.rows.map((r) => r as Record<string, unknown>);

    const blockingResult = await db.query(
      `SELECT DISTINCT d.* FROM decisions d
       JOIN decision_edges e ON e.source_id = d.id
       WHERE e.target_id = ? AND e.relationship = 'blocks'`,
      [id],
    );
    const blockingDecisions = blockingResult.rows.map((r) =>
      parseDecision(r as Record<string, unknown>),
    );

    const supersessionChain: Decision[] = [];
    let currentId: string | undefined = decision.supersedes_id;
    while (currentId) {
      const chainResult = await db.query('SELECT * FROM decisions WHERE id = ?', [currentId]);
      if (chainResult.rows.length === 0) break;
      const chainDecision = parseDecision(chainResult.rows[0] as Record<string, unknown>);
      supersessionChain.push(chainDecision);
      currentId = chainDecision.supersedes_id;
      if (supersessionChain.length > 20) break;
    }

    const cacheResult = await db.query(
      `SELECT COUNT(*) as count FROM context_cache
       WHERE ? = ANY(decision_ids_included) AND expires_at > NOW()`,
      [id],
    );
    const cachedContextsInvalidated = parseInt(
      ((cacheResult.rows[0] as Record<string, unknown>)?.count as string) ?? '0',
      10,
    );

    return c.json({
      decision,
      downstream_decisions: downstreamDecisions,
      upstream_decisions: upstreamDecisions,
      affected_agents: affectedAgents.map((a) => ({
        id: a.id,
        project_id: a.project_id,
        name: a.name,
        role: a.role,
      })),
      cached_contexts_invalidated: cachedContextsInvalidated,
      blocking_decisions: blockingDecisions,
      supersession_chain: supersessionChain,
    });
  });

  // Edges

  app.post('/api/decisions/:id/edges', async (c) => {
    const db = getDb();
    const sourceId = requireUUID(c.req.param('id'), 'id');
    const body = await c.req.json<{
      target_id?: unknown;
      relationship?: unknown;
      description?: unknown;
      strength?: number;
    }>();

    const target_id = requireUUID(body.target_id, 'target_id');
    const relationship = requireString(body.relationship, 'relationship', 100);

    const validRelationships = [
      'supersedes',
      'requires',
      'informs',
      'blocks',
      'contradicts',
      'enables',
      'depends_on',
      'refines',
      'reverts',
    ];
    if (!validRelationships.includes(relationship)) {
      throw new ValidationError(`relationship must be one of: ${validRelationships.join(', ')}`);
    }

    if (sourceId === target_id) {
      throw new ValidationError('Cannot create self-referencing edge');
    }

    try {
      const result = await db.query(
        `INSERT INTO decision_edges (id, source_id, target_id, relationship, description, strength)
         VALUES (?, ?, ?, ?, ?, ?)
         RETURNING *`,
        [
          randomUUID(),
          sourceId,
          target_id,
          relationship,
          optionalString(body.description, 'description', 1000) ?? null,
          body.strength ?? 1.0,
        ],
      );
      return c.json(parseEdge(result.rows[0] as Record<string, unknown>), 201);
    } catch (err) {
      mapDbError(err);
    }
  });

  app.get('/api/decisions/:id/edges', async (c) => {
    const db = getDb();
    const id = requireUUID(c.req.param('id'), 'id');
    const result = await db.query(
      'SELECT * FROM decision_edges WHERE source_id = ? OR target_id = ? ORDER BY created_at ASC',
      [id, id],
    );
    return c.json(result.rows.map((r) => parseEdge(r as Record<string, unknown>)));
  });

  app.delete('/api/edges/:id', async (c) => {
    const db = getDb();
    const id = requireUUID(c.req.param('id'), 'id');
    const result = await db.query('DELETE FROM decision_edges WHERE id = ? RETURNING id', [id]);
    if (result.rows.length === 0) throw new NotFoundError('Edge', id);
    return c.json({ deleted: true, id });
  });

  // Semantic Search

  app.post('/api/projects/:id/decisions/search', async (c) => {
    const db = getDb();
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    const body = await c.req.json<{ query?: unknown; limit?: number }>();

    const searchQuery = requireString(body.query, 'query', 1000);
    const limit = Math.min(body.limit ?? 10, 50);

    const embedding = await generateEmbedding(searchQuery);

    if (embedding) {
      const result = await db.query(
        `SELECT *, 1 - (embedding <=> ?) as similarity
         FROM decisions
         WHERE project_id = ? AND embedding IS NOT NULL
         ORDER BY embedding <=> ?
         LIMIT ?`,
        [`[${embedding.join(',')}]`, projectId, `[${embedding.join(',')}]`, limit],
      );
      return c.json(result.rows.map((r) => parseDecision(r as Record<string, unknown>)));
    } else {
      const result = await db.query(
        `SELECT * FROM decisions
         WHERE project_id = ?
           AND (title ILIKE ? OR description ILIKE ? OR reasoning ILIKE ?)
         ORDER BY created_at DESC
         LIMIT ?`,
        [projectId, `%${searchQuery}%`, `%${searchQuery}%`, `%${searchQuery}%`, limit],
      );
      return c.json(result.rows.map((r) => parseDecision(r as Record<string, unknown>)));
    }
  });

    // Stale, Duplicate, Reaffirm, Merge, Keep

  // GET /api/projects/:id/decisions/stale — list stale decisions
  app.get('/api/projects/:id/decisions/stale', async (c) => {
    const db = getDb();
    const projectId = requireUUID(c.req.param('id'), 'projectId');

    const result = await db.query(
      `SELECT * FROM decisions
       WHERE project_id = ? AND stale = true
       ORDER BY last_referenced_at ASC NULLS FIRST`,
      [projectId],
    );

    return c.json(result.rows.map((r) => parseDecision(r as Record<string, unknown>)));
  });

  // GET /api/projects/:id/decisions/duplicates — list potential duplicates
  app.get('/api/projects/:id/decisions/duplicates', async (c) => {
    const db = getDb();
    const projectId = requireUUID(c.req.param('id'), 'projectId');

    const result = await db.query(
      `SELECT d.*, orig.title as duplicate_of_title
       FROM decisions d
       JOIN decisions orig ON orig.id = d.potential_duplicate_of
       WHERE d.project_id = ? AND d.potential_duplicate_of IS NOT NULL
       LIMIT 50`,
      [projectId],
    );

    return c.json(result.rows);
  });

  // POST /api/projects/:id/decisions/:did/reaffirm — reset stale flag
  app.post('/api/projects/:id/decisions/:decisionId/reaffirm', async (c) => {
    const db = getDb();
    requireUUID(c.req.param('id'), 'projectId');
    const decisionId = requireUUID(c.req.param('decisionId'), 'decisionId');

    const result = await db.query(
      `UPDATE decisions SET stale = false, last_referenced_at = NOW()
       WHERE id = ? RETURNING *`,
      [decisionId],
    );

    if (result.rows.length === 0) throw new NotFoundError('Decision', decisionId);
    return c.json(parseDecision(result.rows[0] as Record<string, unknown>));
  });

  // POST /api/projects/:id/decisions/:did/merge — merge duplicate into original
  app.post('/api/projects/:id/decisions/:decisionId/merge', async (c) => {
    const db = getDb();
    requireUUID(c.req.param('id'), 'projectId');
    const decisionId = requireUUID(c.req.param('decisionId'), 'decisionId');

    // Get the decision and its duplicate target
    const decResult = await db.query(
      'SELECT * FROM decisions WHERE id = ?',
      [decisionId],
    );
    if (decResult.rows.length === 0) throw new NotFoundError('Decision', decisionId);

    const dec = decResult.rows[0] as Record<string, unknown>;
    if (!dec.potential_duplicate_of) {
      throw new ValidationError('Decision is not flagged as a potential duplicate');
    }

    // Mark the duplicate as superseded
    await db.query(
      "UPDATE decisions SET status = 'superseded', updated_at = NOW() WHERE id = ?",
      [decisionId],
    );

    // Create a supersedes edge in the Phase 1 decision_edges table
    await db.query(
      `INSERT INTO decision_edges (id, source_id, target_id, relationship, strength)
       VALUES (?, ?, ?, 'supersedes', 1.0)
       ON CONFLICT (source_id, target_id, relationship) DO NOTHING`,
      [randomUUID(), dec.potential_duplicate_of, decisionId],
    );

    // Clear the duplicate flag
    await db.query(
      'UPDATE decisions SET potential_duplicate_of = NULL WHERE id = ?',
      [decisionId],
    );

    return c.json({ merged: true, superseded_id: decisionId, kept_id: dec.potential_duplicate_of });
  });

  // POST /api/projects/:id/decisions/:did/keep — dismiss duplicate flag
  app.post('/api/projects/:id/decisions/:decisionId/keep', async (c) => {
    const db = getDb();
    requireUUID(c.req.param('id'), 'projectId');
    const decisionId = requireUUID(c.req.param('decisionId'), 'decisionId');

    const result = await db.query(
      'UPDATE decisions SET potential_duplicate_of = NULL WHERE id = ? RETURNING *',
      [decisionId],
    );

    if (result.rows.length === 0) throw new NotFoundError('Decision', decisionId);
    return c.json(parseDecision(result.rows[0] as Record<string, unknown>));
  });

    // Decision Validation

  const VALID_SOURCES = ['manual_review', 'test_passed', 'production_verified', 'peer_reviewed', 'external'] as const;

  app.post('/api/decisions/:id/validate', async (c) => {
    const db = getDb();
    const id = requireUUID(c.req.param('id'), 'id');
    const body = await c.req.json<{
      validation_source?: unknown;
      notes?: unknown;
    }>();

    const validation_source = requireString(body.validation_source, 'validation_source', 100);
    if (!(VALID_SOURCES as readonly string[]).includes(validation_source)) {
      throw new ValidationError(
        `validation_source must be one of: ${VALID_SOURCES.join(', ')}`,
      );
    }

    // Verify decision exists and is active
    const existing = await db.query('SELECT * FROM decisions WHERE id = ?', [id]);
    if (existing.rows.length === 0) throw new NotFoundError('Decision', id);
    const dec = existing.rows[0] as Record<string, unknown>;
    if (dec.status !== 'active') {
      throw new ValidationError('Only active decisions can be validated');
    }

    // Update validated_at and validation_source
    const notes = body.notes != null ? String(body.notes).slice(0, 5000) : undefined;
    let metadataObj: Record<string, unknown> = {};
    try {
      metadataObj = typeof dec.metadata === 'string' ? JSON.parse(dec.metadata as string) : (dec.metadata as Record<string, unknown>) ?? {};
    } catch { /* keep empty */ }
    if (notes) metadataObj.validation_notes = notes;

    // Append validation provenance and recompute trust
    let existingChain: unknown[] = [];
    try {
      existingChain = typeof dec.provenance_chain === 'string'
        ? JSON.parse(dec.provenance_chain as string)
        : Array.isArray(dec.provenance_chain) ? (dec.provenance_chain as unknown[]) : [];
    } catch { /* keep empty */ }
    const updatedChain = [...existingChain, validationProvenance(validation_source)];
    const parsedDec = parseDecision(dec);
    const { trust_score: newTrustScore } = computeTrust({
      ...parsedDec,
      provenance_chain: updatedChain as Decision['provenance_chain'],
      validated_at: new Date().toISOString(),
    });

    const result = await db.query(
      `UPDATE decisions SET validated_at = ${db.dialect === 'sqlite' ? "datetime('now')" : 'NOW()'}, validation_source = ?, metadata = ?, provenance_chain = ?, trust_score = ? WHERE id = ? RETURNING *`,
      [validation_source, JSON.stringify(metadataObj), JSON.stringify(updatedChain), newTrustScore, id],
    );

    const decision = parseDecision(result.rows[0] as Record<string, unknown>);

    // Invalidate compile caches since trust score changed
    invalidateDecisionCaches(decision.project_id).catch(() => {});

    logAudit('decision_validated', decision.project_id, {
      decision_id: decision.id,
      validation_source,
    });

    propagateChange(decision, 'decision_validated' as NotificationType).catch((err) =>
      console.error('[hipp0] Change propagation failed:', (err as Error).message),
    );

    dispatchWebhooks(decision.project_id, 'decision_validated', {
      decision_id: decision.id,
      title: decision.title,
      validation_source,
    }).catch((err) => console.warn('[hipp0:webhook]', (err as Error).message));

    return c.json(decision);
  });

    // Decision Invalidation

  app.post('/api/decisions/:id/invalidate', async (c) => {
    const db = getDb();
    const id = requireUUID(c.req.param('id'), 'id');
    const body = await c.req.json<{ reason?: unknown }>();

    const existing = await db.query('SELECT * FROM decisions WHERE id = ?', [id]);
    if (existing.rows.length === 0) throw new NotFoundError('Decision', id);
    const dec = existing.rows[0] as Record<string, unknown>;

    // Downgrade confidence: high → medium, medium → low, low stays low
    const currentConf = dec.confidence as string;
    const newConf = currentConf === 'high' ? 'medium' : currentConf === 'medium' ? 'low' : 'low';

    // Store invalidation reason in metadata
    let metadataObj: Record<string, unknown> = {};
    try {
      metadataObj = typeof dec.metadata === 'string' ? JSON.parse(dec.metadata as string) : (dec.metadata as Record<string, unknown>) ?? {};
    } catch { /* keep empty */ }
    if (body.reason) metadataObj.invalidation_reason = String(body.reason).slice(0, 5000);

    // Recompute trust score after invalidation (validation removed, confidence downgraded)
    const parsedDecForInvalidation = parseDecision(dec);
    const { trust_score: invalidatedTrustScore } = computeTrust({
      ...parsedDecForInvalidation,
      validated_at: undefined,
      confidence: newConf as Decision['confidence'],
    });

    const result = await db.query(
      `UPDATE decisions SET validated_at = NULL, validation_source = NULL, confidence = ?, metadata = ?, trust_score = ? WHERE id = ? RETURNING *`,
      [newConf, JSON.stringify(metadataObj), invalidatedTrustScore, id],
    );

    const decision = parseDecision(result.rows[0] as Record<string, unknown>);

    // Invalidate compile caches since trust score changed
    invalidateDecisionCaches(decision.project_id).catch(() => {});

    logAudit('decision_invalidated', decision.project_id, {
      decision_id: decision.id,
      reason: body.reason ? String(body.reason) : undefined,
    });

    propagateChange(decision, 'decision_invalidated' as NotificationType).catch((err) =>
      console.error('[hipp0] Change propagation failed:', (err as Error).message),
    );

    dispatchWebhooks(decision.project_id, 'decision_invalidated', {
      decision_id: decision.id,
      title: decision.title,
    }).catch((err) => console.warn('[hipp0:webhook]', (err as Error).message));

    return c.json(decision);
  });

    // Bulk Validation

  app.post('/api/projects/:id/decisions/validate-bulk', async (c) => {
    const db = getDb();
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    const body = await c.req.json<{
      decision_ids?: unknown;
      validation_source?: unknown;
      notes?: unknown;
    }>();

    if (!Array.isArray(body.decision_ids) || body.decision_ids.length === 0) {
      throw new ValidationError('decision_ids must be a non-empty array');
    }

    const validation_source = requireString(body.validation_source, 'validation_source', 100);
    if (!(VALID_SOURCES as readonly string[]).includes(validation_source)) {
      throw new ValidationError(
        `validation_source must be one of: ${VALID_SOURCES.join(', ')}`,
      );
    }

    const ids: string[] = body.decision_ids.map((id: unknown) => requireUUID(id, 'decision_id'));

    const results = await db.transaction(async (txQuery) => {
      const validated: Array<Record<string, unknown>> = [];
      const notFound: string[] = [];

      for (const id of ids) {
        const check = await txQuery('SELECT * FROM decisions WHERE id = ? AND project_id = ?', [id, projectId]);
        if (check.rows.length === 0) {
          notFound.push(id);
          continue;
        }
        validated.push(check.rows[0] as Record<string, unknown>);
      }

      if (notFound.length > 0) {
        throw new ValidationError(`Decisions not found in project: ${notFound.join(', ')}`);
      }

      for (const id of ids) {
        await txQuery(
          `UPDATE decisions SET validated_at = ${db.dialect === 'sqlite' ? "datetime('now')" : 'NOW()'}, validation_source = ? WHERE id = ?`,
          [validation_source, id],
        );
      }

      return validated;
    });

    // Fire-and-forget propagation for each validated decision
    for (const row of results as Array<Record<string, unknown>>) {
      const dec = parseDecision(row);
      propagateChange(dec, 'decision_validated' as NotificationType).catch((err) =>
        console.error('[hipp0] Change propagation failed:', (err as Error).message),
      );
    }

    logAudit('decisions_bulk_validated', projectId, {
      count: ids.length,
      validation_source,
    });

    return c.json({
      validated: ids.length,
      failed: 0,
      validation_source,
      decision_ids: ids,
    });
  });

  // What Changed — temporal intelligence query
  app.get('/api/decisions/changes', async (c) => {
    const db = getDb();
    const projectId = c.req.query('project_id');
    const since = c.req.query('since');

    if (!projectId || !since) {
      throw new ValidationError('project_id and since query parameters are required');
    }

    const sinceDate = new Date(since);
    if (isNaN(sinceDate.getTime())) {
      throw new ValidationError('since must be a valid ISO date string');
    }
    const now = new Date();

    // Created decisions
    const createdResult = await db.query<Record<string, unknown>>(
      `SELECT id, title, domain, made_by, created_at FROM decisions
       WHERE project_id = ? AND created_at >= ? ORDER BY created_at DESC`,
      [projectId, sinceDate.toISOString()],
    );
    const created = createdResult.rows.map((r) => ({
      id: r.id as string,
      title: r.title as string,
      domain: (r.domain as string) ?? null,
      made_by: r.made_by as string,
      created_at: r.created_at as string,
    }));

    // Superseded decisions
    const supersededResult = await db.query<Record<string, unknown>>(
      `SELECT id, title, superseded_by, valid_until FROM decisions
       WHERE project_id = ? AND status = 'superseded' AND updated_at >= ?
       ORDER BY updated_at DESC`,
      [projectId, sinceDate.toISOString()],
    );
    const superseded = supersededResult.rows.map((r) => ({
      id: r.id as string,
      title: r.title as string,
      superseded_by: (r.superseded_by as string) ?? null,
      superseded_at: (r.valid_until as string) ?? (r.updated_at as string) ?? '',
    }));

    // Deprecated decisions
    const deprecatedResult = await db.query<Record<string, unknown>>(
      `SELECT id, title, updated_at, reasoning FROM decisions
       WHERE project_id = ? AND temporal_scope = 'deprecated' AND updated_at >= ?
         AND status != 'superseded'
       ORDER BY updated_at DESC`,
      [projectId, sinceDate.toISOString()],
    );
    const deprecated = deprecatedResult.rows.map((r) => ({
      id: r.id as string,
      title: r.title as string,
      deprecated_at: r.updated_at as string,
      reason: (r.reasoning as string) ?? '',
    }));

    // Updated decisions (updated but not newly created or superseded)
    const updatedResult = await db.query<Record<string, unknown>>(
      `SELECT id, title, updated_at FROM decisions
       WHERE project_id = ? AND updated_at >= ? AND created_at < ?
         AND status = 'active' AND (temporal_scope IS NULL OR temporal_scope != 'deprecated')
       ORDER BY updated_at DESC`,
      [projectId, sinceDate.toISOString(), sinceDate.toISOString()],
    );
    const updated = updatedResult.rows.map((r) => ({
      id: r.id as string,
      title: r.title as string,
      fields_changed: [] as string[],
      updated_at: r.updated_at as string,
    }));

    // Try to enrich fields_changed from audit log
    for (const u of updated) {
      try {
        const auditResult = await db.query<Record<string, unknown>>(
          `SELECT details FROM audit_log
           WHERE event_type = 'decision_updated' AND decision_id = ? AND created_at >= ?
           ORDER BY created_at DESC LIMIT 1`,
          [u.id, sinceDate.toISOString()],
        );
        if (auditResult.rows.length > 0) {
          const details = auditResult.rows[0].details;
          const parsed = typeof details === 'string' ? JSON.parse(details) : details;
          if (parsed && Array.isArray((parsed as Record<string, unknown>).fields_updated)) {
            u.fields_changed = (parsed as Record<string, unknown>).fields_updated as string[];
          }
        }
      } catch {
        // audit enrichment is best-effort
      }
    }

    const summary = `${created.length} new decisions, ${superseded.length} superseded, ${deprecated.length} deprecated, ${updated.length} updated`;

    return c.json({
      period: { from: sinceDate.toISOString(), to: now.toISOString() },
      created,
      superseded,
      deprecated,
      updated,
      summary,
    });
  });

    // Namespace endpoints

  // List all namespaces with decision counts for a project
  app.get('/api/projects/:id/namespaces', async (c) => {
    const db = getDb();
    const projectId = requireUUID(c.req.param('id'), 'projectId');

    const result = await db.query(
      `SELECT namespace, COUNT(*) as count
       FROM decisions
       WHERE project_id = ? AND namespace IS NOT NULL
       GROUP BY namespace
       ORDER BY count DESC`,
      [projectId],
    );

    const namespaces = result.rows.map((row) => {
      const r = row as Record<string, unknown>;
      return {
        namespace: r.namespace as string,
        count: parseInt(String(r.count), 10),
      };
    });

    return c.json(namespaces);
  });

  // Bulk assign namespace to multiple decisions
  app.post('/api/decisions/bulk-namespace', async (c) => {
    const db = getDb();
    const body = await c.req.json<{
      decision_ids?: unknown;
      namespace?: unknown;
    }>();

    if (!Array.isArray(body.decision_ids) || body.decision_ids.length === 0) {
      throw new ValidationError('decision_ids must be a non-empty array');
    }
    const namespace = body.namespace === null ? null : requireString(body.namespace, 'namespace', 100);
    const ids: string[] = body.decision_ids.map((id: unknown) => requireUUID(id, 'decision_ids'));

    let updated = 0;
    for (const id of ids) {
      const result = await db.query(
        'UPDATE decisions SET namespace = ?, updated_at = NOW() WHERE id = ? RETURNING id',
        [namespace, id],
      );
      if (result.rows.length > 0) updated++;
    }

    return c.json({ updated, total: ids.length, namespace });
  });

  // Backfill embeddings — generate embeddings for any project decisions that
  // are missing them. Used to recover demo/seeded projects that were created
  // before embeddings were wired up or without the embeddings provider set.
  app.post('/api/projects/:id/embeddings/backfill', async (c) => {
    const db = getDb();
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);

    const missing = await db.query<Record<string, unknown>>(
      `SELECT id, title, description, reasoning
         FROM decisions
        WHERE project_id = ?
          AND embedding IS NULL`,
      [projectId],
    );

    const total = missing.rows.length;
    let succeeded = 0;
    let failed = 0;
    const errors: Array<{ id: string; error: string }> = [];

    for (const row of missing.rows) {
      const id = row.id as string;
      const text = `${row.title ?? ''}\n${row.description ?? ''}\n${row.reasoning ?? ''}`.trim();
      if (!text) {
        failed++;
        errors.push({ id, error: 'empty title/description/reasoning' });
        continue;
      }
      try {
        const embedding = await generateEmbedding(text);
        if (!embedding || embedding.length === 0) {
          failed++;
          errors.push({ id, error: 'generateEmbedding returned empty' });
          continue;
        }
        await db.query(
          'UPDATE decisions SET embedding = ? WHERE id = ?',
          [`[${embedding.join(',')}]`, id],
        );
        succeeded++;
      } catch (err) {
        failed++;
        errors.push({ id, error: (err as Error).message });
      }
    }

    return c.json({ total, succeeded, failed, errors: errors.slice(0, 10) });
  });

  // OpenClaw one-shot import — walks a directory of workspace-<agent>/ folders,
  // finds markdown files (audit reports, reviews, specs, etc.), and submits each
  // one to the Distillery queue for decision extraction. The workspace folder
  // name becomes the agent name. Skips:
  //   - repos/ subdirs (cloned third-party code)
  //   - hidden .openclaw/ config subdirs
  //   - files smaller than 500 bytes (too short to contain decisions)
  //   - files larger than 200KB (too long for single-shot distillery call)
  //
  // Returns stats without waiting for extraction to complete — jobs run async
  // in the background queue. Watch progress via Live Events or Timeline.
  app.post('/api/projects/:id/openclaw/import', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);

    const body = await c.req.json().catch(() => ({})) as { path?: unknown; max_files?: unknown };
    const rawPath = typeof body.path === 'string' && body.path.trim()
      ? body.path.trim()
      : (process.env.HIPP0_OPENCLAW_PATH ?? '');

    if (!rawPath) {
      return c.json({
        error: 'No path provided. Pass { "path": "/openclaw" } in the body or set HIPP0_OPENCLAW_PATH env var.',
      }, 400);
    }

    if (!fs.existsSync(rawPath)) {
      return c.json({ error: `Path does not exist inside container: ${rawPath}` }, 400);
    }

    const maxFiles = typeof body.max_files === 'number' && body.max_files > 0
      ? Math.min(body.max_files, 5000)
      : 2000;

    const MIN_SIZE = 500;
    const MAX_SIZE = 200_000;

    // Discover all workspace-<agent>/ dirs under the path
    const workspaceDirs: Array<{ agent: string; dir: string }> = [];
    try {
      for (const entry of fs.readdirSync(rawPath, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name.startsWith('workspace-')) {
          workspaceDirs.push({
            agent: entry.name.replace(/^workspace-/, ''),
            dir: path.join(rawPath, entry.name),
          });
        }
      }
    } catch (err) {
      return c.json({ error: `Cannot read path: ${(err as Error).message}` }, 500);
    }

    if (workspaceDirs.length === 0) {
      return c.json({
        error: `No workspace-* subdirectories found in ${rawPath}`,
        total_files: 0,
        submitted: 0,
        skipped: 0,
        workspaces: [],
      }, 404);
    }

    let totalFiles = 0;
    let submitted = 0;
    let skippedTooSmall = 0;
    let skippedTooLarge = 0;
    let skippedRepos = 0;
    let errors = 0;
    const perAgent: Record<string, number> = {};

    // Recursive walk, skipping repos/ and .openclaw/ subdirs
    function walk(dir: string, workspaceAgent: string): string[] {
      const out: string[] = [];
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return out;
      }
      for (const e of entries) {
        if (e.name === 'repos' && e.isDirectory()) { skippedRepos++; continue; }
        if (e.name === '.openclaw' && e.isDirectory()) continue;
        if (e.name === 'node_modules' && e.isDirectory()) continue;
        if (e.name.startsWith('.')) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          out.push(...walk(full, workspaceAgent));
        } else if (e.isFile() && e.name.endsWith('.md')) {
          out.push(full);
        }
      }
      return out;
    }

    for (const { agent, dir } of workspaceDirs) {
      const files = walk(dir, agent);
      for (const filePath of files) {
        if (totalFiles >= maxFiles) break;
        totalFiles++;

        let size: number;
        try {
          size = fs.statSync(filePath).size;
        } catch {
          errors++;
          continue;
        }
        if (size < MIN_SIZE) { skippedTooSmall++; continue; }
        if (size > MAX_SIZE) { skippedTooLarge++; continue; }

        let content: string;
        try {
          content = fs.readFileSync(filePath, 'utf8');
        } catch {
          errors++;
          continue;
        }

        const relPath = path.relative(rawPath, filePath);
        // Fire-and-forget so the HTTP response returns immediately even
        // when the queue is in inline mode (no Redis). Otherwise a 500-file
        // import would block the curl for 15-25 minutes while each file
        // runs through the synchronous Claude Haiku distillery call.
        submitForExtraction({
          raw_text: `# ${path.basename(filePath, '.md')}\n\n${content}`,
          source: 'openclaw',
          source_session_id: `openclaw:${relPath}`,
          made_by: agent,
          project_id: projectId,
        }).catch((err: Error) => {
          console.warn(`[hipp0/openclaw-import] ${relPath}: ${err.message}`);
        });
        submitted++;
        perAgent[agent] = (perAgent[agent] ?? 0) + 1;
      }
      if (totalFiles >= maxFiles) break;
    }

    return c.json({
      path: rawPath,
      workspaces_found: workspaceDirs.length,
      total_files_scanned: totalFiles,
      submitted,
      skipped_too_small: skippedTooSmall,
      skipped_too_large: skippedTooLarge,
      skipped_repos_dirs: skippedRepos,
      errors,
      per_agent: perAgent,
      hint: submitted > 0
        ? 'Decisions are being extracted asynchronously. Watch Live Events or Timeline for progress.'
        : 'No files were submitted. Check path, permissions, and file sizes.',
    });
  });
}
