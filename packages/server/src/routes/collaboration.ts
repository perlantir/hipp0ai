/**
 * Collaboration Routes — Comments, Approvals, Annotations
 *
 * Comments (threaded):
 *   GET    /api/projects/:id/decisions/:decisionId/comments
 *   POST   /api/projects/:id/decisions/:decisionId/comments
 *   PATCH  /api/projects/:id/decisions/:decisionId/comments/:commentId
 *   DELETE /api/projects/:id/decisions/:decisionId/comments/:commentId
 *   GET    /api/projects/:id/comments/recent
 *
 * Approvals:
 *   POST   /api/projects/:id/decisions/:decisionId/approvals
 *   GET    /api/projects/:id/decisions/:decisionId/approvals
 *   POST   /api/projects/:id/approvals/:approvalId/approve
 *   POST   /api/projects/:id/approvals/:approvalId/reject
 *   GET    /api/projects/:id/approvals/pending
 *
 * Annotations:
 *   GET    /api/projects/:id/decisions/:decisionId/annotations
 *   POST   /api/projects/:id/decisions/:decisionId/annotations
 *   PATCH  /api/projects/:id/annotations/:annotationId
 *   DELETE /api/projects/:id/annotations/:annotationId
 */
import type { Hono } from 'hono';
import { ValidationError, NotFoundError } from '@hipp0/core/types.js';
import {
  addComment,
  getComments,
  updateComment,
  deleteComment,
  getRecentComments,
  requestApproval,
  approveDecision,
  rejectDecision,
  getPendingApprovals,
  getApprovalHistory,
  addAnnotation,
  getAnnotations,
  updateAnnotation,
  deleteAnnotation,
} from '@hipp0/core/intelligence/comments.js';
import { requireUUID, logAudit } from './validation.js';
import { requireProjectAccess } from './_helpers.js';
import { safeEmit } from '../events/event-stream.js';

export function registerCollaborationRoutes(app: Hono): void {
  /* ============================================================== */
  /*  COMMENTS                                                       */
  /* ============================================================== */

  // GET /api/projects/:id/decisions/:decisionId/comments
  app.get('/api/projects/:id/decisions/:decisionId/comments', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    const decisionId = requireUUID(c.req.param('decisionId'), 'decisionId');
    await requireProjectAccess(c, projectId);

    const comments = await getComments(projectId, decisionId);
    return c.json({ comments, count: comments.length });
  });

  // POST /api/projects/:id/decisions/:decisionId/comments
  app.post('/api/projects/:id/decisions/:decisionId/comments', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    const decisionId = requireUUID(c.req.param('decisionId'), 'decisionId');
    await requireProjectAccess(c, projectId);

    const body = await c.req.json<Record<string, unknown>>();
    const content = body.content;
    const author = body.author;
    const rawParent = body.parent_comment_id;
    const parentCommentId =
      rawParent === undefined || rawParent === null
        ? null
        : requireUUID(rawParent, 'parent_comment_id');

    if (typeof content !== 'string') {
      throw new ValidationError('content is required and must be a string');
    }
    if (typeof author !== 'string') {
      throw new ValidationError('author is required and must be a string');
    }

    const comment = await addComment(projectId, decisionId, {
      content,
      author,
      parent_comment_id: parentCommentId,
    });

    logAudit('comment_added', projectId, {
      comment_id: comment.id,
      decision_id: decisionId,
      author: comment.author,
      has_parent: parentCommentId !== null,
    });

    safeEmit('comment.added', projectId, {
      comment_id: comment.id,
      decision_id: decisionId,
      author: comment.author,
      parent_comment_id: parentCommentId,
    });

    return c.json(comment, 201);
  });

  // PATCH /api/projects/:id/decisions/:decisionId/comments/:commentId
  app.patch(
    '/api/projects/:id/decisions/:decisionId/comments/:commentId',
    async (c) => {
      const projectId = requireUUID(c.req.param('id'), 'projectId');
      const decisionId = requireUUID(c.req.param('decisionId'), 'decisionId');
      const commentId = requireUUID(c.req.param('commentId'), 'commentId');
      await requireProjectAccess(c, projectId);

      const body = await c.req.json<Record<string, unknown>>();
      const content = body.content;
      if (typeof content !== 'string') {
        throw new ValidationError('content is required and must be a string');
      }

      const updated = await updateComment(commentId, content);

      logAudit('comment_updated', projectId, {
        comment_id: commentId,
        decision_id: decisionId,
      });

      safeEmit('comment.updated', projectId, {
        comment_id: commentId,
        decision_id: decisionId,
        author: updated.author,
      });

      return c.json(updated);
    },
  );

  // DELETE /api/projects/:id/decisions/:decisionId/comments/:commentId
  app.delete(
    '/api/projects/:id/decisions/:decisionId/comments/:commentId',
    async (c) => {
      const projectId = requireUUID(c.req.param('id'), 'projectId');
      const decisionId = requireUUID(c.req.param('decisionId'), 'decisionId');
      const commentId = requireUUID(c.req.param('commentId'), 'commentId');
      await requireProjectAccess(c, projectId);

      const result = await deleteComment(commentId);
      if (!result.deleted) {
        throw new NotFoundError('Comment', commentId);
      }

      logAudit('comment_deleted', projectId, {
        comment_id: commentId,
        decision_id: decisionId,
      });

      safeEmit('comment.deleted', projectId, {
        comment_id: commentId,
        decision_id: decisionId,
      });

      return c.json(result);
    },
  );

  // GET /api/projects/:id/comments/recent
  app.get('/api/projects/:id/comments/recent', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);

    const limitRaw = c.req.query('limit');
    const limit = limitRaw ? parseInt(limitRaw, 10) : 20;
    if (limitRaw && (!Number.isFinite(limit) || limit < 1)) {
      throw new ValidationError('limit must be a positive integer');
    }

    const comments = await getRecentComments(projectId, limit);
    return c.json({ comments, count: comments.length });
  });

  /* ============================================================== */
  /*  APPROVALS                                                      */
  /* ============================================================== */

  // POST /api/projects/:id/decisions/:decisionId/approvals
  app.post('/api/projects/:id/decisions/:decisionId/approvals', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    const decisionId = requireUUID(c.req.param('decisionId'), 'decisionId');
    await requireProjectAccess(c, projectId);

    const body = await c.req.json<Record<string, unknown>>();
    const requestedBy = body.requested_by;
    const approvers = body.approvers;

    if (typeof requestedBy !== 'string') {
      throw new ValidationError('requested_by is required and must be a string');
    }
    if (!Array.isArray(approvers)) {
      throw new ValidationError('approvers must be an array');
    }

    const approval = await requestApproval(projectId, decisionId, {
      requested_by: requestedBy,
      approvers: approvers as string[],
    });

    logAudit('approval_requested', projectId, {
      approval_id: approval.id,
      decision_id: decisionId,
      requested_by: approval.requested_by,
      approver_count: approval.approvers.length,
    });

    safeEmit('approval.requested', projectId, {
      approval_id: approval.id,
      decision_id: decisionId,
      requested_by: approval.requested_by,
      approvers: approval.approvers,
    });

    return c.json(approval, 201);
  });

  // GET /api/projects/:id/decisions/:decisionId/approvals
  app.get('/api/projects/:id/decisions/:decisionId/approvals', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    const decisionId = requireUUID(c.req.param('decisionId'), 'decisionId');
    await requireProjectAccess(c, projectId);

    const approvals = await getApprovalHistory(decisionId);
    return c.json({ approvals, count: approvals.length });
  });

  // POST /api/projects/:id/approvals/:approvalId/approve
  app.post('/api/projects/:id/approvals/:approvalId/approve', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    const approvalId = requireUUID(c.req.param('approvalId'), 'approvalId');
    await requireProjectAccess(c, projectId);

    const body = await c.req
      .json<Record<string, unknown>>()
      .catch(() => ({} as Record<string, unknown>));
    const approver = body.approver;
    const comment = body.comment;

    if (typeof approver !== 'string') {
      throw new ValidationError('approver is required and must be a string');
    }
    if (comment !== undefined && typeof comment !== 'string') {
      throw new ValidationError('comment must be a string when provided');
    }

    const approval = await approveDecision(approvalId, approver, {
      comment: comment as string | undefined,
    });

    logAudit('approval_granted', projectId, {
      approval_id: approvalId,
      decision_id: approval.decision_id,
      approved_by: approval.approved_by,
    });

    safeEmit('approval.granted', projectId, {
      approval_id: approvalId,
      decision_id: approval.decision_id,
      approved_by: approval.approved_by,
    });

    return c.json(approval);
  });

  // POST /api/projects/:id/approvals/:approvalId/reject
  app.post('/api/projects/:id/approvals/:approvalId/reject', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    const approvalId = requireUUID(c.req.param('approvalId'), 'approvalId');
    await requireProjectAccess(c, projectId);

    const body = await c.req.json<Record<string, unknown>>();
    const approver = body.approver;
    const reason = body.reason;

    if (typeof approver !== 'string') {
      throw new ValidationError('approver is required and must be a string');
    }
    if (typeof reason !== 'string') {
      throw new ValidationError('reason is required and must be a string');
    }

    const approval = await rejectDecision(approvalId, approver, { reason });

    logAudit('approval_rejected', projectId, {
      approval_id: approvalId,
      decision_id: approval.decision_id,
      rejected_by: approval.rejected_by,
    });

    safeEmit('approval.rejected', projectId, {
      approval_id: approvalId,
      decision_id: approval.decision_id,
      rejected_by: approval.rejected_by,
      reason: approval.rejection_reason,
    });

    return c.json(approval);
  });

  // GET /api/projects/:id/approvals/pending
  app.get('/api/projects/:id/approvals/pending', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);

    const approver = c.req.query('approver');
    const approvals = await getPendingApprovals(projectId, approver);
    return c.json({ approvals, count: approvals.length });
  });

  /* ============================================================== */
  /*  ANNOTATIONS                                                    */
  /* ============================================================== */

  // GET /api/projects/:id/decisions/:decisionId/annotations
  app.get('/api/projects/:id/decisions/:decisionId/annotations', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    const decisionId = requireUUID(c.req.param('decisionId'), 'decisionId');
    await requireProjectAccess(c, projectId);

    const annotations = await getAnnotations(projectId, decisionId);
    return c.json({ annotations, count: annotations.length });
  });

  // POST /api/projects/:id/decisions/:decisionId/annotations
  app.post('/api/projects/:id/decisions/:decisionId/annotations', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    const decisionId = requireUUID(c.req.param('decisionId'), 'decisionId');
    await requireProjectAccess(c, projectId);

    const body = await c.req.json<Record<string, unknown>>();
    const author = body.author;
    const note = body.note;
    const textRange = body.text_range;

    if (typeof author !== 'string') {
      throw new ValidationError('author is required and must be a string');
    }
    if (typeof note !== 'string') {
      throw new ValidationError('note is required and must be a string');
    }
    if (!textRange || typeof textRange !== 'object') {
      throw new ValidationError('text_range is required and must be an object');
    }

    const annotation = await addAnnotation(projectId, decisionId, {
      author,
      note,
      text_range: textRange as { start: number; end: number },
    });

    logAudit('annotation_added', projectId, {
      annotation_id: annotation.id,
      decision_id: decisionId,
      author: annotation.author,
    });

    safeEmit('annotation.added', projectId, {
      annotation_id: annotation.id,
      decision_id: decisionId,
      author: annotation.author,
      text_range: annotation.text_range,
    });

    return c.json(annotation, 201);
  });

  // PATCH /api/projects/:id/annotations/:annotationId
  app.patch('/api/projects/:id/annotations/:annotationId', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    const annotationId = requireUUID(c.req.param('annotationId'), 'annotationId');
    await requireProjectAccess(c, projectId);

    const body = await c.req.json<Record<string, unknown>>();
    const note = body.note;
    if (typeof note !== 'string') {
      throw new ValidationError('note is required and must be a string');
    }

    const annotation = await updateAnnotation(annotationId, note);

    logAudit('annotation_updated', projectId, {
      annotation_id: annotationId,
      decision_id: annotation.decision_id,
    });

    safeEmit('annotation.updated', projectId, {
      annotation_id: annotationId,
      decision_id: annotation.decision_id,
      author: annotation.author,
    });

    return c.json(annotation);
  });

  // DELETE /api/projects/:id/annotations/:annotationId
  app.delete('/api/projects/:id/annotations/:annotationId', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    const annotationId = requireUUID(c.req.param('annotationId'), 'annotationId');
    await requireProjectAccess(c, projectId);

    const result = await deleteAnnotation(annotationId);
    if (!result.deleted) {
      throw new NotFoundError('Annotation', annotationId);
    }

    logAudit('annotation_deleted', projectId, {
      annotation_id: annotationId,
    });

    return c.json(result);
  });
}
