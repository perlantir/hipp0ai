/**
 * Knowledge Branching Routes ("Git for Decisions")
 *
 * POST   /api/projects/:id/branches                      — create a branch
 * GET    /api/projects/:id/branches                      — list branches
 * GET    /api/projects/:id/branches/:branchId/diff       — diff vs main
 * POST   /api/projects/:id/branches/:branchId/merge      — merge into main
 * DELETE /api/projects/:id/branches/:branchId            — delete branch
 */
import type { Hono } from 'hono';
import { ValidationError, NotFoundError } from '@hipp0/core/types.js';
import {
  createBranch,
  listBranches,
  getBranchDiff,
  mergeBranch,
  deleteBranch,
} from '@hipp0/core/intelligence/knowledge-branches.js';
import { requireUUID, requireString, optionalString } from './validation.js';
import { requireProjectAccess } from './_helpers.js';

export function registerBranchRoutes(app: Hono): void {
  // Create branch
  app.post('/api/projects/:id/branches', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);

    const body = await c.req.json<Record<string, unknown>>();
    const name = requireString(body.name, 'name', 200);
    const description = optionalString(body.description, 'description', 2000);
    const baseBranch = body.base_branch != null ? requireUUID(body.base_branch, 'base_branch') : undefined;

    try {
      const branch = await createBranch(projectId, {
        name,
        description,
        base_branch: baseBranch ?? null,
      });
      return c.json(branch, 201);
    } catch (err) {
      const msg = (err as Error).message || '';
      if (msg.includes('UNIQUE') || msg.includes('duplicate')) {
        throw new ValidationError(`Branch with name "${name}" already exists in this project`);
      }
      throw err;
    }
  });

  // List branches
  app.get('/api/projects/:id/branches', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);

    const branches = await listBranches(projectId);
    return c.json({ branches });
  });

  // Branch diff vs main
  app.get('/api/projects/:id/branches/:branchId/diff', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);
    const branchId = requireUUID(c.req.param('branchId'), 'branchId');

    const diff = await getBranchDiff(projectId, branchId);
    return c.json(diff);
  });

  // Merge branch into main
  app.post('/api/projects/:id/branches/:branchId/merge', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);
    const branchId = requireUUID(c.req.param('branchId'), 'branchId');

    const body = await c.req.json<Record<string, unknown>>();
    const strategy = body.strategy ?? 'all';
    if (strategy !== 'all' && strategy !== 'cherry_pick') {
      throw new ValidationError(`strategy must be 'all' or 'cherry_pick'`);
    }

    let decisionIds: string[] | undefined;
    if (strategy === 'cherry_pick') {
      if (!Array.isArray(body.decision_ids) || body.decision_ids.length === 0) {
        throw new ValidationError('cherry_pick strategy requires a non-empty decision_ids array');
      }
      decisionIds = (body.decision_ids as unknown[]).map((id, i) =>
        requireUUID(id, `decision_ids[${i}]`),
      );
    }

    try {
      const result = await mergeBranch(projectId, branchId, {
        strategy: strategy as 'all' | 'cherry_pick',
        decision_ids: decisionIds,
      });
      return c.json(result);
    } catch (err) {
      if ((err as Error).message.includes('not found')) {
        throw new NotFoundError('Branch', branchId);
      }
      throw err;
    }
  });

  // Delete branch
  app.delete('/api/projects/:id/branches/:branchId', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);
    const branchId = requireUUID(c.req.param('branchId'), 'branchId');

    const result = await deleteBranch(projectId, branchId);
    if (!result.deleted) {
      throw new NotFoundError('Branch', branchId);
    }
    return c.json(result);
  });
}
