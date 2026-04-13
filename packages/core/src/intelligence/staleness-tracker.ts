/**
 * Phase 2 Intelligence: Staleness Tracker
 *
 * Marks decisions as stale when unreferenced for configurable periods.
 * Applies confidence decay at 60 and 90 day thresholds.
 * Temporal-scope-aware: sprint (14d), experiment (7d), permanent (30d), deprecated (skip).
 */
import { getDb } from '../db/index.js';

/** Return a dialect-aware "timestamp older than N days" expression */
function olderThan(col: string, days: number, dialect: 'sqlite' | 'postgres'): string {
  if (dialect === 'sqlite') {
    return `${col} < datetime('now', '-${days} days')`;
  }
  return `${col} < NOW() - INTERVAL '${days} days'`;
}

/** Return a dialect-aware NOW() expression */
function now(dialect: 'sqlite' | 'postgres'): string {
  return dialect === 'sqlite' ? "datetime('now')" : 'NOW()';
}

export async function markStaleDecisions(projectId: string): Promise<number> {
  const db = getDb();
  const dialect = db.dialect === 'sqlite' ? 'sqlite' as const : 'postgres' as const;
  let staleCount = 0;

  // Skip deprecated decisions entirely
  // Sprint-scoped: auto-flag stale after 14 days
  const sprintResult = await db.query(
    `UPDATE decisions
     SET stale = true
     WHERE project_id = ?
       AND status = 'active'
       AND stale = false
       AND temporal_scope = 'sprint'
       AND (
         (last_referenced_at IS NOT NULL AND ${olderThan('last_referenced_at', 14, dialect)})
         OR
         (last_referenced_at IS NULL AND ${olderThan('created_at', 14, dialect)})
       )
     RETURNING id`,
    [projectId],
  );
  staleCount += sprintResult.rows.length;

  // Experiment-scoped: auto-flag stale after 7 days
  const experimentResult = await db.query(
    `UPDATE decisions
     SET stale = true
     WHERE project_id = ?
       AND status = 'active'
       AND stale = false
       AND temporal_scope = 'experiment'
       AND (
         (last_referenced_at IS NOT NULL AND ${olderThan('last_referenced_at', 7, dialect)})
         OR
         (last_referenced_at IS NULL AND ${olderThan('created_at', 7, dialect)})
       )
     RETURNING id`,
    [projectId],
  );
  staleCount += experimentResult.rows.length;

  // Permanent-scoped (or null): existing 30-day behavior
  const permanentResult = await db.query(
    `UPDATE decisions
     SET stale = true
     WHERE project_id = ?
       AND status = 'active'
       AND stale = false
       AND (temporal_scope = 'permanent' OR temporal_scope IS NULL)
       AND (
         (last_referenced_at IS NOT NULL AND ${olderThan('last_referenced_at', 30, dialect)})
         OR
         (last_referenced_at IS NULL AND ${olderThan('created_at', 30, dialect)})
       )
     RETURNING id`,
    [projectId],
  );
  staleCount += permanentResult.rows.length;

  // Auto-set valid_until for decisions with superseded_by but no valid_until
  await db.query(
    `UPDATE decisions
     SET valid_until = updated_at
     WHERE project_id = ?
       AND superseded_by IS NOT NULL
       AND valid_until IS NULL`,
    [projectId],
  );

  // Confidence decay: 60 days unreferenced -> medium
  await db.query(
    `UPDATE decisions
     SET confidence = 'medium'
     WHERE project_id = ?
       AND status = 'active'
       AND confidence = 'high'
       AND (temporal_scope IS NULL OR temporal_scope NOT IN ('deprecated'))
       AND (
         (last_referenced_at IS NOT NULL AND ${olderThan('last_referenced_at', 60, dialect)})
         OR
         (last_referenced_at IS NULL AND ${olderThan('created_at', 60, dialect)})
       )`,
    [projectId],
  );

  // Confidence decay: 90 days unreferenced -> low
  await db.query(
    `UPDATE decisions
     SET confidence = 'low'
     WHERE project_id = ?
       AND status = 'active'
       AND confidence IN ('high', 'medium')
       AND (temporal_scope IS NULL OR temporal_scope NOT IN ('deprecated'))
       AND (
         (last_referenced_at IS NOT NULL AND ${olderThan('last_referenced_at', 90, dialect)})
         OR
         (last_referenced_at IS NULL AND ${olderThan('created_at', 90, dialect)})
       )`,
    [projectId],
  );

  // Orphan detection: flag decisions whose ALL affected decisions have been superseded
  try {
    await db.query(
      `UPDATE decisions d
       SET stale = true
       WHERE d.project_id = ?
         AND d.status = 'active'
         AND d.stale = false
         AND EXISTS (
           SELECT 1 FROM decision_edges e
           WHERE e.source_id = d.id AND e.relationship = 'requires'
         )
         AND NOT EXISTS (
           SELECT 1 FROM decision_edges e
           JOIN decisions dep ON dep.id = e.target_id
           WHERE e.source_id = d.id
             AND e.relationship = 'requires'
             AND dep.status = 'active'
         )`,
      [projectId],
    );
  } catch {
    // Orphan detection is best-effort
  }

  if (staleCount > 0) {
    console.warn(`[hipp0/staleness] ${staleCount} decisions marked stale in project ${projectId.slice(0, 8)}..`);
  }

  return staleCount;
}

export async function reaffirmDecision(decisionId: string): Promise<void> {
  const db = getDb();
  const nowExpr = now(db.dialect === 'sqlite' ? 'sqlite' : 'postgres');

  await db.query(
    `UPDATE decisions
     SET stale = false, last_referenced_at = ${nowExpr}
     WHERE id = ?`,
    [decisionId],
  );

  console.warn(`[hipp0/staleness] Decision ${decisionId.slice(0, 8)}.. reaffirmed`);
}
