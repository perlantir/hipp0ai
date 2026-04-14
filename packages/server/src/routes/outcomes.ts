import crypto from 'node:crypto';
import type { Hono } from 'hono';
import { getDb } from '@hipp0/core/db/index.js';
import { requireUUID, logAudit } from './validation.js';
import { requireProjectAccess } from './_helpers.js';
import { NotFoundError } from '@hipp0/core/types.js';
import { getMetrics, recordCounter } from '../telemetry.js';
import { randomUUID } from 'node:crypto';
import {
  recordBatchFeedback,
  computeAndApplyWeightUpdates,
} from '@hipp0/core/relevance-learner/index.js';
import { processWingOutcome } from '@hipp0/core';
import { invalidateDecisionCaches } from '../cache/redis.js';
import { safeEmit } from '../events/event-stream.js';

// ---------------------------------------------------------------------------
// Alignment analysis (keyword-based v1)
// ---------------------------------------------------------------------------

interface AlignmentResult {
  decisions_referenced: number;
  decisions_ignored: number;
  decisions_contradicted: number;
  alignment_score: number;
  contradiction_score: number;
}

function extractKeywords(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length >= 3);
}

function analyzeAlignment(
  decisionScores: Array<{ id: string; title: string; combined_score?: number }>,
  agentOutput: string,
): AlignmentResult {
  const outputLower = agentOutput.toLowerCase();
  let referenced = 0;
  let ignored = 0;
  const contradicted = 0;

  for (const decision of decisionScores) {
    const keywords = extractKeywords(decision.title);
    if (keywords.length === 0) {
      referenced++;
      continue;
    }
    const matchCount = keywords.filter((kw) => outputLower.includes(kw)).length;
    if (matchCount / keywords.length >= 0.5) {
      referenced++;
    } else {
      ignored++;
    }
  }

  const total = decisionScores.length;
  const alignmentScore = total > 0 ? referenced / total : 0;
  const contradictionScore = total > 0 ? contradicted / total : 0;

  return {
    decisions_referenced: referenced,
    decisions_ignored: ignored,
    decisions_contradicted: contradicted,
    alignment_score: Math.round(alignmentScore * 10000) / 10000,
    contradiction_score: Math.round(contradictionScore * 10000) / 10000,
  };
}

// ---------------------------------------------------------------------------
// Auto-learning: processOutcomeSignals
// ---------------------------------------------------------------------------

async function processOutcomeSignals(agentId: string): Promise<void> {
  const db = getDb();

  const outcomes = await db.query<Record<string, unknown>>(
    `SELECT co.*, ch.decision_ids, ch.decision_scores
     FROM compile_outcomes co
     JOIN compile_history ch ON ch.id = co.compile_history_id
     WHERE co.agent_id = ?
     ORDER BY co.created_at DESC
     LIMIT 20`,
    [agentId],
  );

  if (outcomes.rows.length < 5) return;

  const syntheticRatings: Array<{ decision_id: string; rating: string }> = [];

  for (const row of outcomes.rows) {
    let decisionScores: Array<{ id: string; title: string }> = [];
    const rawScores = row.decision_scores;
    if (typeof rawScores === 'string') {
      try { decisionScores = JSON.parse(rawScores); } catch { /* skip */ }
    } else if (Array.isArray(rawScores)) {
      decisionScores = rawScores as Array<{ id: string; title: string }>;
    }

    const taskCompleted = row.task_completed;
    const alignmentScore = row.alignment_score as number | null;
    const referenced = row.decisions_referenced as number | null;
    const compiled = row.decisions_compiled as number | null;

    for (const d of decisionScores) {
      if (alignmentScore != null && alignmentScore > 0.7 && taskCompleted) {
        syntheticRatings.push({ decision_id: d.id, rating: 'useful' });
      } else if (referenced != null && compiled != null && referenced < compiled * 0.3) {
        syntheticRatings.push({ decision_id: d.id, rating: 'irrelevant' });
      }
    }
  }

  if (syntheticRatings.length === 0) return;

  try {
    await recordBatchFeedback(
      agentId,
      undefined,
      'auto-learning from outcome signals',
      syntheticRatings,
    );
    await computeAndApplyWeightUpdates(agentId);
    console.warn(`[hipp0:outcomes] Processed ${syntheticRatings.length} synthetic signals for agent ${agentId}`);
  } catch (err) {
    console.warn('[hipp0:outcomes] Auto-learning failed:', (err as Error).message);
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function registerOutcomeRoutes(app: Hono): void {
    // POST /api/outcomes — Report an outcome
  app.post('/api/outcomes', async (c) => {
    const db = getDb();
    const body = await c.req.json<{
      compile_request_id?: unknown;
      decision_id?: unknown;
      project_id?: unknown;
      agent_id?: unknown;
      outcome_type?: string;
      outcome_score?: number;
      task_completed?: boolean;
      task_duration_ms?: number;
      agent_output?: string;
      error_occurred?: boolean;
      error_message?: string;
    }>();

    const compileRequestId = body.compile_request_id ? requireUUID(body.compile_request_id, 'compile_request_id') : null;

    if (!compileRequestId) {
      // No compile history — record directly to decision_outcomes if decision_id provided
      const decisionId = body.decision_id ? requireUUID(body.decision_id, 'decision_id') : null;
      const projectId = body.project_id ? requireUUID(body.project_id, 'project_id') : null;

      if (decisionId && projectId) {
        // Verify the decision belongs to the provided project, then check tenant access.
        const db2 = getDb();
        const verify = await db2.query<{ project_id: string }>(
          'SELECT project_id FROM decisions WHERE id = ?',
          [decisionId],
        );
        if (verify.rows.length === 0 || verify.rows[0].project_id !== projectId) {
          return c.json({ error: { code: 'NOT_FOUND', message: 'Decision not found' } }, 404);
        }
        await requireProjectAccess(c, projectId);
        try {
          const { recordDecisionOutcome } = await import('@hipp0/core/intelligence/outcome-memory.js');
          const outcome = await recordDecisionOutcome({
            decision_id: decisionId,
            project_id: projectId,
            agent_id: body.agent_id ? String(body.agent_id) : undefined,
            outcome_type: (body as any).outcome_type ?? (body.task_completed ? 'success' : 'unknown'),
            outcome_score: (body as any).outcome_score ?? 0.5,
            notes: body.error_message ?? undefined,
          });
          safeEmit('outcome.recorded', projectId, {
            outcome_id: outcome.id,
            decision_id: decisionId,
            agent_id: body.agent_id ? String(body.agent_id) : null,
            outcome_type: (body as any).outcome_type ?? (body.task_completed ? 'success' : 'unknown'),
            outcome_score: (body as any).outcome_score ?? 0.5,
          });
          try {
            const __m = getMetrics();
            recordCounter(__m.outcomesRecorded, 1, {
              project_id: projectId,
              success: true,
            });
          } catch { /* ignore */ }
          return c.json({ id: outcome.id, status: 'recorded_to_decision_outcomes' }, 201);
        } catch (err) {
          try {
            const __m = getMetrics();
            recordCounter(__m.outcomesRecorded, 1, {
              project_id: projectId,
              success: false,
            });
          } catch { /* ignore */ }
          return c.json({ error: { code: 'INTERNAL_ERROR', message: (err as Error).message } }, 500);
        }
      }

      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Either compile_request_id or decision_id + project_id is required' } }, 400);
    }

    // Look up compile_history record
    const historyResult = await db.query<Record<string, unknown>>(
      `SELECT id, project_id, agent_id, agent_name, decision_ids, decision_scores, total_decisions
       FROM compile_history WHERE id = ?`,
      [compileRequestId],
    );

    if (historyResult.rows.length === 0) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Compile request not found' } }, 404);
    }

    const history = historyResult.rows[0];
    const projectId = history.project_id as string;
    const agentId = history.agent_id as string;
    const totalDecisions = (history.total_decisions as number) ?? 0;
    await requireProjectAccess(c, projectId);

    // Parse decision scores
    let decisionScores: Array<{ id: string; title: string; combined_score?: number }> = [];
    const rawScores = history.decision_scores;
    if (typeof rawScores === 'string') {
      try { decisionScores = JSON.parse(rawScores); } catch { /* skip */ }
    } else if (Array.isArray(rawScores)) {
      decisionScores = rawScores as Array<{ id: string; title: string; combined_score?: number }>;
    }

    // Alignment analysis
    let alignment: AlignmentResult = {
      decisions_referenced: 0,
      decisions_ignored: 0,
      decisions_contradicted: 0,
      alignment_score: 0,
      contradiction_score: 0,
    };
    let outputHash: string | null = null;
    let outputLength: number | null = null;

    if (body.agent_output && decisionScores.length > 0) {
      alignment = analyzeAlignment(decisionScores, body.agent_output);
      outputHash = crypto.createHash('sha256').update(body.agent_output).digest('hex');
      outputLength = body.agent_output.length;
    }

    const outcomeId = randomUUID();
    const taskCompleted = body.task_completed ?? null;
    const errorOccurred = body.error_occurred ?? false;

    await db.query(
      `INSERT INTO compile_outcomes (
         id, compile_history_id, project_id, agent_id,
         task_completed, task_duration_ms,
         error_occurred, error_message,
         decisions_compiled, decisions_referenced,
         decisions_ignored, decisions_contradicted,
         alignment_score, contradiction_score,
         output_hash, output_length, metadata
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        outcomeId,
        compileRequestId,
        projectId,
        agentId,
        db.dialect === 'sqlite'
          ? (taskCompleted == null ? null : taskCompleted ? 1 : 0)
          : taskCompleted,
        body.task_duration_ms ?? null,
        db.dialect === 'sqlite' ? (errorOccurred ? 1 : 0) : errorOccurred,
        body.error_message ?? null,
        totalDecisions,
        alignment.decisions_referenced,
        alignment.decisions_ignored,
        alignment.decisions_contradicted,
        alignment.alignment_score,
        alignment.contradiction_score,
        outputHash,
        outputLength,
        JSON.stringify({}),
      ],
    );

    logAudit('outcome_reported', projectId, {
      outcome_id: outcomeId,
      compile_request_id: compileRequestId,
      agent_id: agentId,
      task_completed: taskCompleted,
      alignment_score: alignment.alignment_score,
    });

    // Attribute outcome to individual decisions from this compile
    const outcomeType = taskCompleted ? 'success' : errorOccurred ? 'failure' : 'partial';
    const outcomeScore = taskCompleted ? (alignment.alignment_score * 0.7 + 0.3) : (errorOccurred ? 0.1 : 0.4);

    let decisionsAttributed = 0;
    try {
      const { attributeOutcomeToDecisions } = await import('@hipp0/core/intelligence/outcome-memory.js');
      decisionsAttributed = await attributeOutcomeToDecisions({
        compile_history_id: compileRequestId,
        project_id: projectId,
        agent_id: agentId,
        outcome_type: outcomeType,
        outcome_score: outcomeScore,
        notes: body.error_message ?? undefined,
      });
    } catch (err) {
      console.warn('[hipp0:outcomes] Decision attribution failed:', (err as Error).message);
    }

    // Wing affinity: boost for all contributing wings on successful outcome
    if (taskCompleted) {
      processWingOutcome(agentId, compileRequestId)
        .then(() => invalidateDecisionCaches(projectId))
        .then(() => {
          safeEmit('skill.updated', projectId, {
            agent_id: agentId,
            trigger: 'wing_outcome',
            compile_request_id: compileRequestId,
          });
        })
        .catch(() => {});
    }

    // Check auto-learning trigger based on DB count
    const countResult = await db.query<Record<string, unknown>>(
      `SELECT COUNT(*) as cnt FROM compile_outcomes WHERE agent_id = ? AND created_at >= ${db.dialect === 'sqlite' ? "datetime('now', '-1 hour')" : "NOW() - INTERVAL '1 hour'"}`,
      [agentId],
    );
    const recentCount = Number((countResult.rows[0] as any)?.cnt ?? 0);
    if (recentCount > 0 && recentCount % 10 === 0) {
      processOutcomeSignals(agentId).catch(() => {});
    }

    // Trigger cross-agent learning every 20 outcomes
    if (recentCount > 0 && recentCount % 20 === 0) {
      import('@hipp0/core/intelligence/cross-agent-learner.js')
        .then(({ applyCrossAgentLearning }) => applyCrossAgentLearning(projectId))
        .then(() => invalidateDecisionCaches(projectId))
        .catch(() => {});
    }

    safeEmit('outcome.recorded', projectId, {
      outcome_id: outcomeId,
      compile_request_id: compileRequestId,
      agent_id: agentId,
      task_completed: taskCompleted,
      alignment_score: alignment.alignment_score,
      decisions_compiled: totalDecisions,
      decisions_referenced: alignment.decisions_referenced,
      decisions_ignored: alignment.decisions_ignored,
      decisions_attributed: decisionsAttributed,
    });

    try {
      const __m = getMetrics();
      recordCounter(__m.outcomesRecorded, 1, {
        project_id: projectId,
        success: Boolean(taskCompleted),
      });
    } catch { /* ignore */ }

    return c.json({
      id: outcomeId,
      compile_request_id: compileRequestId,
      project_id: projectId,
      agent_id: agentId,
      task_completed: taskCompleted,
      alignment_score: alignment.alignment_score,
      decisions_compiled: totalDecisions,
      decisions_referenced: alignment.decisions_referenced,
      decisions_ignored: alignment.decisions_ignored,
      decisions_attributed: decisionsAttributed,
    }, 201);
  });

    // GET /api/agents/:id/outcomes — Outcome history
  app.get('/api/agents/:id/outcomes', async (c) => {
    const db = getDb();
    const agentId = requireUUID(c.req.param('id'), 'agentId');
    const agentRow = await db.query<{ project_id: string }>(
      'SELECT project_id FROM agents WHERE id = ?',
      [agentId],
    );
    if (agentRow.rows.length === 0) throw new NotFoundError('Agent', agentId);
    await requireProjectAccess(c, agentRow.rows[0].project_id);
    const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200);

    const result = await db.query<Record<string, unknown>>(
      `SELECT * FROM compile_outcomes
       WHERE agent_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
      [agentId, limit],
    );

    return c.json(result.rows);
  });

    // GET /api/projects/:id/outcome-summary — Aggregated stats
  app.get('/api/projects/:id/outcome-summary', async (c) => {
    const db = getDb();
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);

    // Overall stats
    const statsResult = await db.query<Record<string, unknown>>(
      `SELECT
         COUNT(*) as total_outcomes,
         AVG(alignment_score) as avg_alignment_score,
         AVG(CASE WHEN task_completed = ${db.dialect === 'sqlite' ? '1' : 'true'} THEN 1.0 ELSE 0.0 END) as avg_task_completion_rate,
         AVG(task_duration_ms) as avg_task_duration_ms
       FROM compile_outcomes
       WHERE project_id = ?`,
      [projectId],
    );

    const stats = statsResult.rows[0] ?? {};

    // Per-agent breakdown
    const agentResult = await db.query<Record<string, unknown>>(
      `SELECT
         co.agent_id,
         a.name as agent_name,
         COUNT(*) as total_outcomes,
         AVG(co.alignment_score) as avg_alignment_score,
         AVG(CASE WHEN co.task_completed = ${db.dialect === 'sqlite' ? '1' : 'true'} THEN 1.0 ELSE 0.0 END) as avg_task_completion_rate,
         AVG(co.task_duration_ms) as avg_task_duration_ms
       FROM compile_outcomes co
       LEFT JOIN agents a ON a.id = co.agent_id
       WHERE co.project_id = ?
       GROUP BY co.agent_id, a.name`,
      [projectId],
    );

    // Trend: last 7 days vs previous 7 days
    const recentResult = await db.query<Record<string, unknown>>(
      db.dialect === 'sqlite'
        ? `SELECT
             AVG(alignment_score) as avg_alignment,
             AVG(CASE WHEN task_completed = 1 THEN 1.0 ELSE 0.0 END) as avg_completion,
             COUNT(*) as count
           FROM compile_outcomes
           WHERE project_id = ? AND created_at >= datetime('now', '-7 days')`
        : `SELECT
             AVG(alignment_score) as avg_alignment,
             AVG(CASE WHEN task_completed = true THEN 1.0 ELSE 0.0 END) as avg_completion,
             COUNT(*) as count
           FROM compile_outcomes
           WHERE project_id = ? AND created_at >= NOW() - INTERVAL '7 days'`,
      [projectId],
    );

    const previousResult = await db.query<Record<string, unknown>>(
      db.dialect === 'sqlite'
        ? `SELECT
             AVG(alignment_score) as avg_alignment,
             AVG(CASE WHEN task_completed = 1 THEN 1.0 ELSE 0.0 END) as avg_completion,
             COUNT(*) as count
           FROM compile_outcomes
           WHERE project_id = ?
             AND created_at >= datetime('now', '-14 days')
             AND created_at < datetime('now', '-7 days')`
        : `SELECT
             AVG(alignment_score) as avg_alignment,
             AVG(CASE WHEN task_completed = true THEN 1.0 ELSE 0.0 END) as avg_completion,
             COUNT(*) as count
           FROM compile_outcomes
           WHERE project_id = ?
             AND created_at >= NOW() - INTERVAL '14 days'
             AND created_at < NOW() - INTERVAL '7 days'`,
      [projectId],
    );

    const recent = recentResult.rows[0] ?? {};
    const previous = previousResult.rows[0] ?? {};

    const recentAlignment = parseFloat(recent.avg_alignment as string) || 0;
    const previousAlignment = parseFloat(previous.avg_alignment as string) || 0;
    const recentCompletion = parseFloat(recent.avg_completion as string) || 0;
    const previousCompletion = parseFloat(previous.avg_completion as string) || 0;

    return c.json({
      total_outcomes: parseInt(stats.total_outcomes as string) || 0,
      avg_alignment_score: parseFloat(stats.avg_alignment_score as string) || 0,
      avg_task_completion_rate: parseFloat(stats.avg_task_completion_rate as string) || 0,
      avg_task_duration_ms: parseFloat(stats.avg_task_duration_ms as string) || 0,
      by_agent: agentResult.rows.map((row: Record<string, unknown>) => ({
        agent_id: row.agent_id,
        agent_name: row.agent_name ?? 'unknown',
        total_outcomes: parseInt(row.total_outcomes as string) || 0,
        avg_alignment_score: parseFloat(row.avg_alignment_score as string) || 0,
        avg_task_completion_rate: parseFloat(row.avg_task_completion_rate as string) || 0,
        avg_task_duration_ms: parseFloat(row.avg_task_duration_ms as string) || 0,
      })),
      trend: {
        period: '7d',
        alignment_delta: Math.round((recentAlignment - previousAlignment) * 10000) / 10000,
        completion_delta: Math.round((recentCompletion - previousCompletion) * 10000) / 10000,
        recent_count: parseInt(recent.count as string) || 0,
        previous_count: parseInt(previous.count as string) || 0,
      },
    });
  });

  // GET /api/decisions/:id/outcomes — Decision outcome history
  app.get('/api/decisions/:id/outcomes', async (c) => {
    const decisionId = requireUUID(c.req.param('id'), 'decisionId');
    await requireDecisionProjectAccess(c, decisionId);
    const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200);
    const { getDecisionOutcomes } = await import('@hipp0/core/intelligence/outcome-memory.js');
    const outcomes = await getDecisionOutcomes(decisionId, limit);
    return c.json(outcomes);
  });

  // GET /api/decisions/:id/outcome-stats — Decision outcome aggregates
  app.get('/api/decisions/:id/outcome-stats', async (c) => {
    const decisionId = requireUUID(c.req.param('id'), 'decisionId');
    await requireDecisionProjectAccess(c, decisionId);
    const { getOutcomeStats } = await import('@hipp0/core/intelligence/outcome-memory.js');
    const stats = await getOutcomeStats(decisionId);
    return c.json(stats);
  });

  // GET /api/projects/:id/agent-performance — Cross-agent learning summary
  app.get('/api/projects/:id/agent-performance', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);
    const { getCrossAgentSummary } = await import('@hipp0/core/intelligence/cross-agent-learner.js');
    const summary = await getCrossAgentSummary(projectId);
    return c.json(summary);
  });

  // POST /api/projects/:id/apply-learning — Trigger cross-agent learning update
  app.post('/api/projects/:id/apply-learning', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);
    const { applyCrossAgentLearning } = await import('@hipp0/core/intelligence/cross-agent-learner.js');
    const result = await applyCrossAgentLearning(projectId);
    return c.json(result);
  });

  // --------------------------------------------------------------------
  // Reset / reconsider outcome trust for a single decision.
  //
  // Surfaces the "forget" operation the Phase-14 review called out: negative
  // trust only accumulates; there was no user-facing way to clear a decision
  // that had been unfairly dampened (one accidental thumbs-down under
  // MIN_OUTCOMES_FOR_EFFECT=1 used to be permanent; even with the 90-day
  // window and MIN=2 there are legitimate reasons to reset — e.g. the
  // decision was rewritten, the project changed direction, or an automated
  // signal misfired).
  //
  // Semantics: deletes every decision_outcomes row for the decision, deletes
  // every hermes_outcomes row whose snippet_ids_json contains the decision
  // id (since those are the raw reactions that fed attribution), zeros the
  // legacy decisions.outcome_* columns (no-op post-060), and invalidates
  // compile caches for the project so the next compile re-scores from a
  // clean slate. Does NOT delete the decision itself.
  //
  // Requires project access. Audit-logged. Returns a count of rows deleted
  // from each table so callers/tests can verify the reset landed.
  // --------------------------------------------------------------------
  app.post('/api/decisions/:id/outcomes/reset', async (c) => {
    const decisionId = requireUUID(c.req.param('id'), 'decisionId');
    await requireDecisionProjectAccess(c, decisionId);

    const db = getDb();
    const { rows: projRows } = await db.query<{ project_id: string }>(
      'SELECT project_id FROM decisions WHERE id = ?',
      [decisionId],
    );
    if (projRows.length === 0) throw new NotFoundError('Decision', decisionId);
    const projectId = projRows[0].project_id;

    // 1. decision_outcomes — the attribution audit trail. These feed the
    //    decision_outcome_stats view directly, so clearing them wipes the
    //    view's view of this decision (90-day window already filters old
    //    rows, but operators may want immediate clearance).
    const delDecOutcomes = await db.query<Record<string, unknown>>(
      'DELETE FROM decision_outcomes WHERE decision_id = ?',
      [decisionId],
    );

    // 2. hermes_outcomes — raw per-turn reactions. We can't use a JSON
    //    containment check that's portable across dialects, so we fetch
    //    candidate rows (project-scoped) and filter in app code. The
    //    volume is small (90 days * typical reactions/day) and this
    //    endpoint is not on a hot path.
    const candidateRows = await db.query<Record<string, unknown>>(
      `SELECT id, snippet_ids_json FROM hermes_outcomes WHERE project_id = ?`,
      [projectId],
    );
    const toDelete: string[] = [];
    for (const row of candidateRows.rows) {
      const raw = row.snippet_ids_json;
      let ids: unknown[] = [];
      if (typeof raw === 'string') {
        try { const parsed = JSON.parse(raw); if (Array.isArray(parsed)) ids = parsed; } catch { /* skip */ }
      } else if (Array.isArray(raw)) {
        ids = raw as unknown[];
      }
      if (ids.some((v) => typeof v === 'string' && v === decisionId)) {
        toDelete.push(String(row.id));
      }
    }
    let hermesDeletedCount = 0;
    if (toDelete.length > 0) {
      const placeholders = toDelete.map(() => '?').join(',');
      const res = await db.query<Record<string, unknown>>(
        `DELETE FROM hermes_outcomes WHERE id IN (${placeholders})`,
        toDelete,
      );
      hermesDeletedCount = Number((res as { rowCount?: number }).rowCount ?? toDelete.length);
    }

    // 3. Zero the legacy columns. Post-060 the columns don't exist and
    //    recomputeOutcomeAggregates already no-ops on the resulting error;
    //    reuse it here so behaviour is consistent across the window.
    const { recomputeOutcomeAggregates } = await import(
      '@hipp0/core/intelligence/outcome-memory.js'
    );
    await recomputeOutcomeAggregates(decisionId);

    // 4. Invalidate compile caches so the next /api/compile re-scores.
    try {
      await invalidateDecisionCaches(projectId);
    } catch (err) {
      console.warn('[hipp0:outcomes-reset] cache invalidation failed:', (err as Error).message);
    }

    logAudit('decision_outcomes_reset', projectId, {
      decision_id: decisionId,
      decision_outcomes_deleted: Number((delDecOutcomes as { rowCount?: number }).rowCount ?? 0),
      hermes_outcomes_deleted: hermesDeletedCount,
    });

    return c.json({
      decision_id: decisionId,
      decision_outcomes_deleted: Number((delDecOutcomes as { rowCount?: number }).rowCount ?? 0),
      hermes_outcomes_deleted: hermesDeletedCount,
      reset_at: new Date().toISOString(),
    });
  });
}

async function requireDecisionProjectAccess(
  c: import('hono').Context,
  decisionId: string,
): Promise<void> {
  const db = getDb();
  const res = await db.query<{ project_id: string }>(
    'SELECT project_id FROM decisions WHERE id = ?',
    [decisionId],
  );
  if (res.rows.length === 0) throw new NotFoundError('Decision', decisionId);
  await requireProjectAccess(c, res.rows[0].project_id);
}
