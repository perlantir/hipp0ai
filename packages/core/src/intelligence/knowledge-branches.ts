/**
 * Knowledge Branching ("Git for Decisions")
 *
 * Let users fork the decision graph, experiment on a branch, and merge
 * winners back into main. A branch is a named label; new decisions
 * created on a branch carry that branch's id. A null branch_id means
 * the decision belongs to main.
 *
 * Workflow:
 *   1. createBranch(projectId, { name, description?, base_branch? })
 *   2. Create / supersede decisions with branch_id = <branch>
 *   3. getBranchDiff(projectId, branchId) to see what changed vs main
 *   4. mergeBranch(projectId, branchId, { strategy: 'all' | 'cherry_pick' })
 *   5. deleteBranch(projectId, branchId) to discard
 */
import { randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';
import type { Decision } from '../types.js';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface DecisionBranch {
  id: string;
  project_id: string;
  name: string;
  description: string;
  status: 'active' | 'merged' | 'deleted';
  created_at: string;
  merged_at: string | null;
  decision_count: number;
}

export interface CreateBranchInput {
  name: string;
  description?: string;
  base_branch?: string | null;
}

export interface BranchDiff {
  added: Decision[];
  modified: Decision[];
  removed_from_main: Decision[];
}

export interface MergeOptions {
  strategy: 'all' | 'cherry_pick';
  decision_ids?: string[];
}

export interface MergeConflict {
  decision_id: string;
  title: string;
  reason: string;
}

export interface MergeResult {
  merged_count: number;
  conflict_count: number;
  conflicts: MergeConflict[];
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function parseJSONField<T>(val: unknown, fallback: T): T {
  if (val == null) return fallback;
  if (typeof val !== 'string') return val as T;
  try {
    return JSON.parse(val) as T;
  } catch {
    return fallback;
  }
}

function rowToDecision(row: Record<string, unknown>): Decision {
  const d = { ...row } as unknown as Decision;
  d.tags = parseJSONField<string[]>(row.tags, []);
  d.affects = parseJSONField<string[]>(row.affects, []);
  d.alternatives_considered = parseJSONField<Decision['alternatives_considered']>(
    row.alternatives_considered,
    [],
  );
  d.assumptions = parseJSONField<string[]>(row.assumptions, []);
  d.open_questions = parseJSONField<string[]>(row.open_questions, []);
  d.dependencies = parseJSONField<string[]>(row.dependencies, []);
  d.metadata = parseJSONField<Record<string, unknown>>(row.metadata, {});
  return d;
}

function rowToBranch(row: Record<string, unknown>, decisionCount: number): DecisionBranch {
  return {
    id: row.id as string,
    project_id: row.project_id as string,
    name: row.name as string,
    description: (row.description as string) ?? '',
    status: (row.status as DecisionBranch['status']) ?? 'active',
    created_at: row.created_at as string,
    merged_at: (row.merged_at as string) ?? null,
    decision_count: decisionCount,
  };
}

async function countBranchDecisions(branchId: string): Promise<number> {
  const db = getDb();
  const result = await db.query<{ cnt: number | string }>(
    `SELECT COUNT(*) as cnt FROM decisions WHERE branch_id = ?`,
    [branchId],
  );
  const c = result.rows[0]?.cnt;
  return typeof c === 'number' ? c : parseInt(String(c ?? '0'), 10);
}

/* ------------------------------------------------------------------ */
/*  createBranch                                                       */
/* ------------------------------------------------------------------ */

export async function createBranch(
  projectId: string,
  input: CreateBranchInput,
): Promise<DecisionBranch> {
  const db = getDb();
  const id = randomUUID();
  const description = input.description ?? '';

  await db.query(
    `INSERT INTO decision_branches (id, project_id, name, description, status)
     VALUES (?, ?, ?, ?, 'active')`,
    [id, projectId, input.name, description],
  );

  const result = await db.query<Record<string, unknown>>(
    `SELECT * FROM decision_branches WHERE id = ?`,
    [id],
  );
  if (result.rows.length === 0) {
    throw new Error(`Branch creation failed for project ${projectId}`);
  }

  return rowToBranch(result.rows[0], 0);
}

/* ------------------------------------------------------------------ */
/*  listBranches                                                       */
/* ------------------------------------------------------------------ */

export async function listBranches(projectId: string): Promise<DecisionBranch[]> {
  const db = getDb();
  const result = await db.query<Record<string, unknown>>(
    `SELECT * FROM decision_branches
     WHERE project_id = ?
     ORDER BY created_at DESC`,
    [projectId],
  );

  const branches: DecisionBranch[] = [];
  for (const row of result.rows) {
    const count = await countBranchDecisions(row.id as string);
    branches.push(rowToBranch(row, count));
  }
  return branches;
}

/* ------------------------------------------------------------------ */
/*  getBranchDiff                                                      */
/* ------------------------------------------------------------------ */

export async function getBranchDiff(
  projectId: string,
  branchId: string,
): Promise<BranchDiff> {
  const db = getDb();

  // Decisions created on the branch (any status)
  const branchDecisionsResult = await db.query<Record<string, unknown>>(
    `SELECT * FROM decisions
     WHERE project_id = ? AND branch_id = ?`,
    [projectId, branchId],
  );
  const branchDecisions = branchDecisionsResult.rows.map(rowToDecision);

  // Added: branch decisions that do NOT supersede anything on main
  //        (new insertions that only exist on this branch)
  const added: Decision[] = [];
  // Modified: branch decisions that supersede a main decision
  const modified: Decision[] = [];

  for (const d of branchDecisions) {
    if (d.supersedes_id) {
      // Check whether the superseded decision belongs to main (null branch_id)
      const superRes = await db.query<Record<string, unknown>>(
        `SELECT id, branch_id FROM decisions WHERE id = ?`,
        [d.supersedes_id],
      );
      const superRow = superRes.rows[0];
      if (superRow && superRow.branch_id == null) {
        modified.push(d);
        continue;
      }
    }
    added.push(d);
  }

  // Removed from main: main decisions that have been superseded on the branch
  // (i.e. decisions referenced by modified branch decisions)
  const removed_from_main: Decision[] = [];
  for (const d of modified) {
    if (!d.supersedes_id) continue;
    const mainRes = await db.query<Record<string, unknown>>(
      `SELECT * FROM decisions
       WHERE id = ? AND project_id = ? AND branch_id IS NULL`,
      [d.supersedes_id, projectId],
    );
    if (mainRes.rows.length > 0) {
      removed_from_main.push(rowToDecision(mainRes.rows[0]));
    }
  }

  return { added, modified, removed_from_main };
}

/* ------------------------------------------------------------------ */
/*  mergeBranch                                                        */
/* ------------------------------------------------------------------ */

export async function mergeBranch(
  projectId: string,
  branchId: string,
  options: MergeOptions,
): Promise<MergeResult> {
  const db = getDb();

  // Confirm the branch exists
  const branchRes = await db.query<Record<string, unknown>>(
    `SELECT * FROM decision_branches
     WHERE id = ? AND project_id = ?`,
    [branchId, projectId],
  );
  if (branchRes.rows.length === 0) {
    throw new Error(`Branch ${branchId} not found in project ${projectId}`);
  }

  // Collect candidate decisions to merge
  let candidates: Decision[];
  if (options.strategy === 'cherry_pick') {
    if (!options.decision_ids || options.decision_ids.length === 0) {
      return { merged_count: 0, conflict_count: 0, conflicts: [] };
    }
    const placeholders = options.decision_ids.map(() => '?').join(',');
    const res = await db.query<Record<string, unknown>>(
      `SELECT * FROM decisions
       WHERE project_id = ? AND branch_id = ? AND id IN (${placeholders})`,
      [projectId, branchId, ...options.decision_ids],
    );
    candidates = res.rows.map(rowToDecision);
  } else {
    const res = await db.query<Record<string, unknown>>(
      `SELECT * FROM decisions
       WHERE project_id = ? AND branch_id = ?`,
      [projectId, branchId],
    );
    candidates = res.rows.map(rowToDecision);
  }

  const conflicts: MergeConflict[] = [];
  let mergedCount = 0;

  for (const d of candidates) {
    // Conflict detection: if this branch decision supersedes a main
    // decision that has ALSO been superseded by another main decision
    // (i.e. main moved on while the branch existed), flag as conflict.
    if (d.supersedes_id) {
      const conflictRes = await db.query<Record<string, unknown>>(
        `SELECT id, title FROM decisions
         WHERE project_id = ?
           AND supersedes_id = ?
           AND branch_id IS NULL
           AND id != ?`,
        [projectId, d.supersedes_id, d.id],
      );
      if (conflictRes.rows.length > 0) {
        const conflicting = conflictRes.rows[0];
        conflicts.push({
          decision_id: d.id,
          title: d.title,
          reason: `Branch decision supersedes "${d.supersedes_id}", which was also superseded on main by "${conflicting.id as string}"`,
        });
        continue;
      }
    }

    // Clear the branch_id — promote to main
    await db.query(
      `UPDATE decisions SET branch_id = NULL WHERE id = ?`,
      [d.id],
    );

    // If this branch decision supersedes a main decision, mark the
    // main one as 'superseded' (if not already).
    if (d.supersedes_id) {
      await db.query(
        `UPDATE decisions SET status = 'superseded'
         WHERE id = ? AND status = 'active'`,
        [d.supersedes_id],
      );
    }

    mergedCount++;
  }

  // If we merged ALL branch decisions (strategy = 'all') mark the
  // branch as merged.
  if (options.strategy === 'all' && conflicts.length === 0) {
    const nowClause = db.dialect === 'sqlite' ? `datetime('now')` : `NOW()`;
    await db.query(
      `UPDATE decision_branches
       SET status = 'merged', merged_at = ${nowClause}
       WHERE id = ?`,
      [branchId],
    );
  }

  return {
    merged_count: mergedCount,
    conflict_count: conflicts.length,
    conflicts,
  };
}

/* ------------------------------------------------------------------ */
/*  deleteBranch                                                       */
/* ------------------------------------------------------------------ */

export async function deleteBranch(
  projectId: string,
  branchId: string,
): Promise<{ deleted: boolean; decisions_deleted: number }> {
  const db = getDb();

  // Verify branch exists and belongs to project
  const branchRes = await db.query<Record<string, unknown>>(
    `SELECT id FROM decision_branches
     WHERE id = ? AND project_id = ?`,
    [branchId, projectId],
  );
  if (branchRes.rows.length === 0) {
    return { deleted: false, decisions_deleted: 0 };
  }

  // Delete all decisions that only exist on this branch
  const countRes = await db.query<{ cnt: number | string }>(
    `SELECT COUNT(*) as cnt FROM decisions
     WHERE project_id = ? AND branch_id = ?`,
    [projectId, branchId],
  );
  const cntRaw = countRes.rows[0]?.cnt;
  const decisionsDeleted = typeof cntRaw === 'number' ? cntRaw : parseInt(String(cntRaw ?? '0'), 10);

  await db.query(
    `DELETE FROM decisions
     WHERE project_id = ? AND branch_id = ?`,
    [projectId, branchId],
  );

  // Mark the branch itself as deleted (soft delete so we keep history)
  await db.query(
    `UPDATE decision_branches SET status = 'deleted' WHERE id = ?`,
    [branchId],
  );

  return { deleted: true, decisions_deleted: decisionsDeleted };
}
