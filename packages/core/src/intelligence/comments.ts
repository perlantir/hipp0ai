/**
 * Collaboration Features: Comments, Approvals, and Annotations
 *
 * Enables multiple humans to collaboratively curate a team's decision memory
 * by layering threaded comments, approval workflows, and inline annotations
 * on top of individual decisions.
 *
 * Core operations:
 *   Comments:
 *     - addComment, getComments, updateComment, deleteComment, getRecentComments
 *   Approvals:
 *     - requestApproval, approveDecision, rejectDecision, getPendingApprovals,
 *       getApprovalHistory
 *   Annotations:
 *     - addAnnotation, getAnnotations, updateAnnotation, deleteAnnotation
 */

import { randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';
import { ValidationError, NotFoundError } from '../types.js';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface DecisionComment {
  id: string;
  project_id: string;
  decision_id: string;
  parent_comment_id: string | null;
  author: string;
  content: string;
  edited: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  replies?: DecisionComment[];
}

export interface AddCommentInput {
  content: string;
  author: string;
  parent_comment_id?: string | null;
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface DecisionApproval {
  id: string;
  project_id: string;
  decision_id: string;
  requested_by: string;
  approvers: string[];
  status: ApprovalStatus;
  approved_by: string | null;
  rejected_by: string | null;
  rejection_reason: string | null;
  comment: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface RequestApprovalInput {
  requested_by: string;
  approvers: string[];
}

export interface ApproveInput {
  comment?: string;
}

export interface RejectInput {
  reason: string;
}

export interface TextRange {
  start: number;
  end: number;
}

export interface DecisionAnnotation {
  id: string;
  project_id: string;
  decision_id: string;
  author: string;
  text_range: TextRange;
  note: string;
  created_at: string;
  updated_at: string;
}

export interface AddAnnotationInput {
  text_range: TextRange;
  note: string;
  author: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function nowLit(): string {
  return getDb().dialect === 'sqlite' ? "datetime('now')" : 'NOW()';
}

function requireNonEmptyString(value: unknown, field: string, maxLen = 10000): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ValidationError(`${field} must be a non-empty string`);
  }
  if (value.length > maxLen) {
    throw new ValidationError(`${field} exceeds maximum length of ${maxLen}`);
  }
  return value.trim();
}

function toBool(value: unknown): boolean {
  if (value === true || value === 1 || value === '1' || value === 't' || value === 'true') {
    return true;
  }
  return false;
}

function parseStringArray(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter((x): x is string => typeof x === 'string');
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed || trimmed === '{}' || trimmed === '[]') return [];
    // Postgres text[] text form: {a,b,c}
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      const inner = trimmed.slice(1, -1);
      if (!inner) return [];
      return inner
        .split(',')
        .map((s) => s.replace(/^"|"$/g, '').trim())
        .filter(Boolean);
    }
    // JSON array
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === 'string');
    } catch {
      // fall through
    }
  }
  return [];
}

function parseTextRange(raw: unknown): TextRange {
  let obj: Record<string, unknown> = {};
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      obj = {};
    }
  } else if (raw && typeof raw === 'object') {
    obj = raw as Record<string, unknown>;
  }
  const start = Number(obj.start ?? 0);
  const end = Number(obj.end ?? 0);
  return {
    start: Number.isFinite(start) ? start : 0,
    end: Number.isFinite(end) ? end : 0,
  };
}

function rowToComment(row: Record<string, unknown>): DecisionComment {
  return {
    id: String(row.id),
    project_id: String(row.project_id),
    decision_id: String(row.decision_id),
    parent_comment_id: row.parent_comment_id ? String(row.parent_comment_id) : null,
    author: String(row.author ?? ''),
    content: String(row.content ?? ''),
    edited: toBool(row.edited),
    deleted_at: row.deleted_at ? String(row.deleted_at) : null,
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
  };
}

function rowToApproval(row: Record<string, unknown>): DecisionApproval {
  return {
    id: String(row.id),
    project_id: String(row.project_id),
    decision_id: String(row.decision_id),
    requested_by: String(row.requested_by ?? ''),
    approvers: parseStringArray(row.approvers),
    status: (row.status as ApprovalStatus) ?? 'pending',
    approved_by: row.approved_by ? String(row.approved_by) : null,
    rejected_by: row.rejected_by ? String(row.rejected_by) : null,
    rejection_reason: row.rejection_reason ? String(row.rejection_reason) : null,
    comment: row.comment ? String(row.comment) : null,
    created_at: String(row.created_at ?? ''),
    resolved_at: row.resolved_at ? String(row.resolved_at) : null,
  };
}

function rowToAnnotation(row: Record<string, unknown>): DecisionAnnotation {
  return {
    id: String(row.id),
    project_id: String(row.project_id),
    decision_id: String(row.decision_id),
    author: String(row.author ?? ''),
    text_range: parseTextRange(row.text_range),
    note: String(row.note ?? ''),
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
  };
}

function validateTextRange(raw: unknown): TextRange {
  if (!raw || typeof raw !== 'object') {
    throw new ValidationError('text_range must be an object with numeric start and end');
  }
  const obj = raw as Record<string, unknown>;
  const start = Number(obj.start);
  const end = Number(obj.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    throw new ValidationError('text_range.start and text_range.end must be numbers');
  }
  if (start < 0 || end < 0) {
    throw new ValidationError('text_range positions must be non-negative');
  }
  if (end < start) {
    throw new ValidationError('text_range.end must be >= text_range.start');
  }
  return { start: Math.floor(start), end: Math.floor(end) };
}

/* ================================================================== */
/*  COMMENTS                                                           */
/* ================================================================== */

export async function addComment(
  projectId: string,
  decisionId: string,
  input: AddCommentInput,
): Promise<DecisionComment> {
  const content = requireNonEmptyString(input.content, 'content', 10000);
  const author = requireNonEmptyString(input.author, 'author', 200);
  const parentCommentId = input.parent_comment_id ?? null;

  const db = getDb();

  // If parent provided, validate it exists and belongs to the same decision
  if (parentCommentId) {
    const parentCheck = await db.query<Record<string, unknown>>(
      `SELECT id, decision_id FROM decision_comments WHERE id = ? AND project_id = ?`,
      [parentCommentId, projectId],
    );
    if (parentCheck.rows.length === 0) {
      throw new NotFoundError('Comment', parentCommentId);
    }
    const parentDecisionId = String((parentCheck.rows[0] as Record<string, unknown>).decision_id);
    if (parentDecisionId !== decisionId) {
      throw new ValidationError('parent_comment_id must belong to the same decision');
    }
  }

  const id = randomUUID();
  await db.query(
    `INSERT INTO decision_comments
       (id, project_id, decision_id, parent_comment_id, author, content, edited, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ${nowLit()}, ${nowLit()})`,
    [
      id,
      projectId,
      decisionId,
      parentCommentId,
      author,
      content,
      db.dialect === 'sqlite' ? 0 : false,
    ],
  );

  const result = await db.query<Record<string, unknown>>(
    `SELECT * FROM decision_comments WHERE id = ?`,
    [id],
  );
  if (result.rows.length === 0) {
    throw new Error('Failed to insert comment');
  }
  return rowToComment(result.rows[0] as Record<string, unknown>);
}

/**
 * Return all (non-deleted) comments for a decision as a threaded tree.
 * Each top-level comment has a `replies` array populated recursively.
 */
export async function getComments(
  projectId: string,
  decisionId: string,
): Promise<DecisionComment[]> {
  const db = getDb();
  const result = await db.query<Record<string, unknown>>(
    `SELECT * FROM decision_comments
     WHERE project_id = ? AND decision_id = ? AND deleted_at IS NULL
     ORDER BY created_at ASC`,
    [projectId, decisionId],
  );

  const comments = result.rows.map((row) => rowToComment(row as Record<string, unknown>));

  // Build threaded tree
  const byId = new Map<string, DecisionComment>();
  for (const c of comments) {
    c.replies = [];
    byId.set(c.id, c);
  }

  const roots: DecisionComment[] = [];
  for (const c of comments) {
    if (c.parent_comment_id && byId.has(c.parent_comment_id)) {
      byId.get(c.parent_comment_id)!.replies!.push(c);
    } else {
      roots.push(c);
    }
  }

  return roots;
}

export async function updateComment(
  commentId: string,
  content: string,
): Promise<DecisionComment> {
  const cleanContent = requireNonEmptyString(content, 'content', 10000);
  const db = getDb();

  const existing = await db.query<Record<string, unknown>>(
    `SELECT id FROM decision_comments WHERE id = ? AND deleted_at IS NULL`,
    [commentId],
  );
  if (existing.rows.length === 0) {
    throw new NotFoundError('Comment', commentId);
  }

  await db.query(
    `UPDATE decision_comments
     SET content = ?,
         edited = ?,
         updated_at = ${nowLit()}
     WHERE id = ?`,
    [cleanContent, db.dialect === 'sqlite' ? 1 : true, commentId],
  );

  const result = await db.query<Record<string, unknown>>(
    `SELECT * FROM decision_comments WHERE id = ?`,
    [commentId],
  );
  return rowToComment(result.rows[0] as Record<string, unknown>);
}

/**
 * Soft delete — sets deleted_at. Content is preserved but excluded from
 * listings. Replies are left intact (parent row is kept so the thread
 * structure survives).
 */
export async function deleteComment(commentId: string): Promise<{ deleted: boolean }> {
  const db = getDb();

  const existing = await db.query<Record<string, unknown>>(
    `SELECT id FROM decision_comments WHERE id = ? AND deleted_at IS NULL`,
    [commentId],
  );
  if (existing.rows.length === 0) {
    return { deleted: false };
  }

  await db.query(
    `UPDATE decision_comments
     SET deleted_at = ${nowLit()},
         updated_at = ${nowLit()}
     WHERE id = ?`,
    [commentId],
  );

  return { deleted: true };
}

export async function getRecentComments(
  projectId: string,
  limit = 20,
): Promise<DecisionComment[]> {
  const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
  const db = getDb();
  const result = await db.query<Record<string, unknown>>(
    `SELECT * FROM decision_comments
     WHERE project_id = ? AND deleted_at IS NULL
     ORDER BY created_at DESC
     LIMIT ?`,
    [projectId, safeLimit],
  );
  return result.rows.map((row) => rowToComment(row as Record<string, unknown>));
}

/* ================================================================== */
/*  APPROVALS                                                          */
/* ================================================================== */

export async function requestApproval(
  projectId: string,
  decisionId: string,
  input: RequestApprovalInput,
): Promise<DecisionApproval> {
  const requestedBy = requireNonEmptyString(input.requested_by, 'requested_by', 200);
  if (!Array.isArray(input.approvers) || input.approvers.length === 0) {
    throw new ValidationError('approvers must be a non-empty array');
  }
  const approvers = input.approvers.map((a, i) => {
    if (typeof a !== 'string' || a.trim().length === 0) {
      throw new ValidationError(`approvers[${i}] must be a non-empty string`);
    }
    if (a.length > 200) {
      throw new ValidationError(`approvers[${i}] exceeds 200 characters`);
    }
    return a.trim();
  });

  const db = getDb();
  const id = randomUUID();

  await db.query(
    `INSERT INTO decision_approvals
       (id, project_id, decision_id, requested_by, approvers, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ${nowLit()})`,
    [id, projectId, decisionId, requestedBy, db.arrayParam(approvers)],
  );

  const result = await db.query<Record<string, unknown>>(
    `SELECT * FROM decision_approvals WHERE id = ?`,
    [id],
  );
  return rowToApproval(result.rows[0] as Record<string, unknown>);
}

async function loadApproval(approvalId: string): Promise<DecisionApproval> {
  const db = getDb();
  const result = await db.query<Record<string, unknown>>(
    `SELECT * FROM decision_approvals WHERE id = ?`,
    [approvalId],
  );
  if (result.rows.length === 0) {
    throw new NotFoundError('Approval', approvalId);
  }
  return rowToApproval(result.rows[0] as Record<string, unknown>);
}

function assertPending(approval: DecisionApproval): void {
  if (approval.status !== 'pending') {
    throw new ValidationError(`Approval is already ${approval.status}`);
  }
}

function assertApprover(approval: DecisionApproval, approver: string): void {
  const normalized = approver.trim();
  if (!approval.approvers.includes(normalized)) {
    throw new ValidationError(`"${normalized}" is not in the approvers list`);
  }
}

export async function approveDecision(
  approvalId: string,
  approver: string,
  input: ApproveInput = {},
): Promise<DecisionApproval> {
  const cleanApprover = requireNonEmptyString(approver, 'approver', 200);
  const comment = input.comment !== undefined ? requireNonEmptyString(input.comment, 'comment', 5000) : null;

  const approval = await loadApproval(approvalId);
  assertPending(approval);
  assertApprover(approval, cleanApprover);

  const db = getDb();
  await db.query(
    `UPDATE decision_approvals
     SET status = 'approved',
         approved_by = ?,
         comment = ?,
         resolved_at = ${nowLit()}
     WHERE id = ?`,
    [cleanApprover, comment, approvalId],
  );

  return loadApproval(approvalId);
}

export async function rejectDecision(
  approvalId: string,
  approver: string,
  input: RejectInput,
): Promise<DecisionApproval> {
  const cleanApprover = requireNonEmptyString(approver, 'approver', 200);
  const reason = requireNonEmptyString(input.reason, 'reason', 5000);

  const approval = await loadApproval(approvalId);
  assertPending(approval);
  assertApprover(approval, cleanApprover);

  const db = getDb();
  await db.query(
    `UPDATE decision_approvals
     SET status = 'rejected',
         rejected_by = ?,
         rejection_reason = ?,
         resolved_at = ${nowLit()}
     WHERE id = ?`,
    [cleanApprover, reason, approvalId],
  );

  return loadApproval(approvalId);
}

/**
 * List pending approvals for a project. If `approver` is provided, only
 * returns approvals where that approver is in the approvers list.
 */
export async function getPendingApprovals(
  projectId: string,
  approver?: string,
): Promise<DecisionApproval[]> {
  const db = getDb();
  const result = await db.query<Record<string, unknown>>(
    `SELECT * FROM decision_approvals
     WHERE project_id = ? AND status = 'pending'
     ORDER BY created_at DESC`,
    [projectId],
  );

  let approvals = result.rows.map((row) => rowToApproval(row as Record<string, unknown>));

  if (approver && approver.trim().length > 0) {
    const needle = approver.trim();
    approvals = approvals.filter((a) => a.approvers.includes(needle));
  }

  return approvals;
}

export async function getApprovalHistory(
  decisionId: string,
): Promise<DecisionApproval[]> {
  const db = getDb();
  const result = await db.query<Record<string, unknown>>(
    `SELECT * FROM decision_approvals
     WHERE decision_id = ?
     ORDER BY created_at DESC`,
    [decisionId],
  );
  return result.rows.map((row) => rowToApproval(row as Record<string, unknown>));
}

/* ================================================================== */
/*  ANNOTATIONS                                                        */
/* ================================================================== */

export async function addAnnotation(
  projectId: string,
  decisionId: string,
  input: AddAnnotationInput,
): Promise<DecisionAnnotation> {
  const author = requireNonEmptyString(input.author, 'author', 200);
  const note = requireNonEmptyString(input.note, 'note', 5000);
  const textRange = validateTextRange(input.text_range);

  const db = getDb();
  const id = randomUUID();
  const textRangeJson = JSON.stringify(textRange);

  await db.query(
    `INSERT INTO decision_annotations
       (id, project_id, decision_id, author, text_range, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ${nowLit()}, ${nowLit()})`,
    [id, projectId, decisionId, author, textRangeJson, note],
  );

  const result = await db.query<Record<string, unknown>>(
    `SELECT * FROM decision_annotations WHERE id = ?`,
    [id],
  );
  return rowToAnnotation(result.rows[0] as Record<string, unknown>);
}

export async function getAnnotations(
  projectId: string,
  decisionId: string,
): Promise<DecisionAnnotation[]> {
  const db = getDb();
  const result = await db.query<Record<string, unknown>>(
    `SELECT * FROM decision_annotations
     WHERE project_id = ? AND decision_id = ?
     ORDER BY created_at ASC`,
    [projectId, decisionId],
  );
  return result.rows.map((row) => rowToAnnotation(row as Record<string, unknown>));
}

export async function updateAnnotation(
  annotationId: string,
  note: string,
): Promise<DecisionAnnotation> {
  const cleanNote = requireNonEmptyString(note, 'note', 5000);
  const db = getDb();

  const existing = await db.query<Record<string, unknown>>(
    `SELECT id FROM decision_annotations WHERE id = ?`,
    [annotationId],
  );
  if (existing.rows.length === 0) {
    throw new NotFoundError('Annotation', annotationId);
  }

  await db.query(
    `UPDATE decision_annotations
     SET note = ?,
         updated_at = ${nowLit()}
     WHERE id = ?`,
    [cleanNote, annotationId],
  );

  const result = await db.query<Record<string, unknown>>(
    `SELECT * FROM decision_annotations WHERE id = ?`,
    [annotationId],
  );
  return rowToAnnotation(result.rows[0] as Record<string, unknown>);
}

/**
 * Hard delete for annotations (they're not content worth preserving).
 */
export async function deleteAnnotation(
  annotationId: string,
): Promise<{ deleted: boolean }> {
  const db = getDb();
  const result = await db.query(
    `DELETE FROM decision_annotations WHERE id = ?`,
    [annotationId],
  );
  return { deleted: result.rowCount > 0 };
}
