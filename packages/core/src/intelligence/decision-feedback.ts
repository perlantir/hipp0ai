/**
 * Decision Feedback (thumbs up / down)
 *
 * Captures human- or agent-supplied feedback on whether a specific decision
 * was useful when it showed up in a compiled context window. This is a
 * high-signal learning input for the relevance-learner: negative feedback
 * can push scoring weights down, positive feedback can reinforce them, and
 * "misleading" signals get surfaced to the review queue.
 *
 * Core operations:
 *   - recordDecisionFeedback(input)
 *   - getDecisionFeedbackSummary(projectId, decisionId)
 *   - getTopRatedDecisions(projectId, agentName?, limit?)
 *   - getFlaggedDecisions(projectId, limit?)
 */

import { randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';
import { parseDecision } from '../db/parsers.js';
import { ValidationError } from '../types.js';
import type { Decision } from '../types.js';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type FeedbackRating = 'positive' | 'negative' | 'neutral';
export type UsageSignal = 'used' | 'mentioned' | 'ignored' | 'misleading';

export interface DecisionFeedbackInput {
  project_id: string;
  decision_id: string;
  compile_request_id?: string;
  agent_name: string;
  rating: FeedbackRating;
  usage_signal?: UsageSignal;
  comment?: string;
  rated_by?: string;
}

export interface FeedbackRecord {
  id: string;
  project_id: string;
  decision_id: string;
  compile_request_id: string | null;
  agent_name: string;
  rating: FeedbackRating;
  usage_signal: UsageSignal | null;
  comment: string | null;
  rated_by: string | null;
  created_at: string;
}

export interface FeedbackSummary {
  decision_id: string;
  project_id: string;
  total: number;
  positive: number;
  negative: number;
  neutral: number;
  net_score: number;
  score_ratio: number;
  recent_comments: Array<{
    rating: FeedbackRating;
    comment: string;
    rated_by: string | null;
    created_at: string;
  }>;
}

export interface RatedDecision {
  decision_id: string;
  title: string;
  agent_name: string | null;
  total: number;
  positive: number;
  negative: number;
  net_score: number;
  score_ratio: number;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const VALID_RATINGS: FeedbackRating[] = ['positive', 'negative', 'neutral'];
const VALID_USAGE_SIGNALS: UsageSignal[] = ['used', 'mentioned', 'ignored', 'misleading'];

function validateInput(input: DecisionFeedbackInput): DecisionFeedbackInput {
  if (!input || typeof input !== 'object') {
    throw new ValidationError('feedback input must be an object');
  }
  if (typeof input.project_id !== 'string' || !input.project_id) {
    throw new ValidationError('project_id is required');
  }
  if (typeof input.decision_id !== 'string' || !input.decision_id) {
    throw new ValidationError('decision_id is required');
  }
  if (typeof input.agent_name !== 'string' || !input.agent_name.trim()) {
    throw new ValidationError('agent_name is required');
  }
  if (!VALID_RATINGS.includes(input.rating)) {
    throw new ValidationError(
      `rating must be one of: ${VALID_RATINGS.join(', ')}`,
    );
  }
  if (
    input.usage_signal !== undefined &&
    input.usage_signal !== null &&
    !VALID_USAGE_SIGNALS.includes(input.usage_signal)
  ) {
    throw new ValidationError(
      `usage_signal must be one of: ${VALID_USAGE_SIGNALS.join(', ')}`,
    );
  }
  if (input.comment !== undefined && input.comment !== null) {
    if (typeof input.comment !== 'string') {
      throw new ValidationError('comment must be a string');
    }
    if (input.comment.length > 5000) {
      throw new ValidationError('comment exceeds maximum length of 5000');
    }
  }
  return {
    ...input,
    agent_name: input.agent_name.trim(),
    comment: input.comment?.trim() || undefined,
    rated_by: input.rated_by?.trim() || undefined,
  };
}

function rowToRecord(row: Record<string, unknown>): FeedbackRecord {
  return {
    id: String(row.id),
    project_id: String(row.project_id),
    decision_id: String(row.decision_id),
    compile_request_id: row.compile_request_id ? String(row.compile_request_id) : null,
    agent_name: String(row.agent_name ?? ''),
    rating: (row.rating as FeedbackRating) ?? 'neutral',
    usage_signal: row.usage_signal ? (row.usage_signal as UsageSignal) : null,
    comment: row.comment ? String(row.comment) : null,
    rated_by: row.rated_by ? String(row.rated_by) : null,
    created_at: row.created_at instanceof Date
      ? row.created_at.toISOString()
      : String(row.created_at ?? ''),
  };
}

/* ------------------------------------------------------------------ */
/*  Operations                                                         */
/* ------------------------------------------------------------------ */

/**
 * Record a feedback entry for a decision. This is best-effort: a DB failure
 * throws through so the caller (HTTP handler) can surface the error, but the
 * function never mutates the decision itself.
 */
export async function recordDecisionFeedback(
  input: DecisionFeedbackInput,
): Promise<void> {
  const clean = validateInput(input);
  const db = getDb();

  await db.query(
    `INSERT INTO decision_feedback
       (id, project_id, decision_id, compile_request_id, agent_name,
        rating, usage_signal, comment, rated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      clean.project_id,
      clean.decision_id,
      clean.compile_request_id ?? null,
      clean.agent_name,
      clean.rating,
      clean.usage_signal ?? null,
      clean.comment ?? null,
      clean.rated_by ?? null,
    ],
  );
}

/**
 * Aggregate feedback for a single decision.
 */
export async function getDecisionFeedbackSummary(
  projectId: string,
  decisionId: string,
): Promise<FeedbackSummary> {
  const db = getDb();

  const countResult = await db.query<Record<string, unknown>>(
    `SELECT rating, COUNT(*) AS cnt
     FROM decision_feedback
     WHERE project_id = ? AND decision_id = ?
     GROUP BY rating`,
    [projectId, decisionId],
  );

  const buckets: Record<FeedbackRating, number> = {
    positive: 0,
    negative: 0,
    neutral: 0,
  };
  for (const row of countResult.rows) {
    const rating = String(row.rating) as FeedbackRating;
    const cnt = Number(row.cnt ?? 0);
    if (VALID_RATINGS.includes(rating)) {
      buckets[rating] = cnt;
    }
  }

  const total = buckets.positive + buckets.negative + buckets.neutral;
  const netScore = buckets.positive - buckets.negative;
  const engaged = buckets.positive + buckets.negative;
  const scoreRatio = engaged > 0 ? buckets.positive / engaged : 0;

  const commentsResult = await db.query<Record<string, unknown>>(
    `SELECT rating, comment, rated_by, created_at
     FROM decision_feedback
     WHERE project_id = ? AND decision_id = ? AND comment IS NOT NULL AND comment <> ''
     ORDER BY created_at DESC
     LIMIT 10`,
    [projectId, decisionId],
  );

  return {
    decision_id: decisionId,
    project_id: projectId,
    total,
    positive: buckets.positive,
    negative: buckets.negative,
    neutral: buckets.neutral,
    net_score: netScore,
    score_ratio: Math.round(scoreRatio * 1000) / 1000,
    recent_comments: commentsResult.rows.map((r) => ({
      rating: (r.rating as FeedbackRating) ?? 'neutral',
      comment: String(r.comment ?? ''),
      rated_by: r.rated_by ? String(r.rated_by) : null,
      created_at: r.created_at instanceof Date
        ? r.created_at.toISOString()
        : String(r.created_at ?? ''),
    })),
  };
}

/**
 * Return decisions with the highest net positive feedback, optionally
 * filtered by the agent that supplied the rating.
 */
export async function getTopRatedDecisions(
  projectId: string,
  agentName?: string,
  limit = 20,
): Promise<RatedDecision[]> {
  const db = getDb();
  const lim = Math.max(1, Math.min(200, limit));

  const params: unknown[] = [projectId];
  let agentFilter = '';
  if (agentName) {
    agentFilter = 'AND df.agent_name = ?';
    params.push(agentName);
  }
  params.push(lim);

  const sql = `
    SELECT
      df.decision_id,
      d.title,
      df.agent_name,
      COUNT(*) AS total,
      SUM(CASE WHEN df.rating = 'positive' THEN 1 ELSE 0 END) AS positive,
      SUM(CASE WHEN df.rating = 'negative' THEN 1 ELSE 0 END) AS negative
    FROM decision_feedback df
    JOIN decisions d ON d.id = df.decision_id
    WHERE df.project_id = ? ${agentFilter}
    GROUP BY df.decision_id, d.title, df.agent_name
    HAVING SUM(CASE WHEN df.rating = 'positive' THEN 1 ELSE 0 END)
         > SUM(CASE WHEN df.rating = 'negative' THEN 1 ELSE 0 END)
    ORDER BY (SUM(CASE WHEN df.rating = 'positive' THEN 1 ELSE 0 END)
            - SUM(CASE WHEN df.rating = 'negative' THEN 1 ELSE 0 END)) DESC,
             total DESC
    LIMIT ?
  `;

  const result = await db.query<Record<string, unknown>>(sql, params);

  return result.rows.map((row) => {
    const total = Number(row.total ?? 0);
    const positive = Number(row.positive ?? 0);
    const negative = Number(row.negative ?? 0);
    const engaged = positive + negative;
    const scoreRatio = engaged > 0 ? positive / engaged : 0;
    return {
      decision_id: String(row.decision_id),
      title: String(row.title ?? ''),
      agent_name: row.agent_name ? String(row.agent_name) : null,
      total,
      positive,
      negative,
      net_score: positive - negative,
      score_ratio: Math.round(scoreRatio * 1000) / 1000,
    };
  });
}

/**
 * Return decisions that have received negative feedback — candidates for the
 * review queue, contradiction detection, or further validation.
 */
export async function getFlaggedDecisions(
  projectId: string,
  limit = 20,
): Promise<Decision[]> {
  const db = getDb();
  const lim = Math.max(1, Math.min(200, limit));

  const sql = `
    SELECT d.*
    FROM decisions d
    JOIN (
      SELECT decision_id,
             SUM(CASE WHEN rating = 'positive' THEN 1 ELSE 0 END) AS pos,
             SUM(CASE WHEN rating = 'negative' THEN 1 ELSE 0 END) AS neg,
             MAX(created_at) AS last_feedback_at
      FROM decision_feedback
      WHERE project_id = ?
      GROUP BY decision_id
      HAVING SUM(CASE WHEN rating = 'negative' THEN 1 ELSE 0 END) > 0
    ) flagged ON flagged.decision_id = d.id
    WHERE d.project_id = ?
      AND flagged.neg >= flagged.pos
    ORDER BY flagged.neg DESC, flagged.last_feedback_at DESC
    LIMIT ?
  `;

  const result = await db.query<Record<string, unknown>>(sql, [
    projectId,
    projectId,
    lim,
  ]);
  return result.rows.map((row) => parseDecision(row));
}

/**
 * List raw feedback rows for a decision, newest first. Useful for admin/
 * debugging views.
 */
export async function listDecisionFeedback(
  projectId: string,
  decisionId: string,
  limit = 50,
): Promise<FeedbackRecord[]> {
  const db = getDb();
  const lim = Math.max(1, Math.min(500, limit));
  const result = await db.query<Record<string, unknown>>(
    `SELECT *
     FROM decision_feedback
     WHERE project_id = ? AND decision_id = ?
     ORDER BY created_at DESC
     LIMIT ?`,
    [projectId, decisionId, lim],
  );
  return result.rows.map(rowToRecord);
}
