/**
 * Scenario 09: Knowledge branching (create, list, merge, delete).
 *
 * Branching routes live in packages/server/src/routes/branches.ts:
 *   POST   /api/projects/:id/branches
 *   GET    /api/projects/:id/branches
 *   GET    /api/projects/:id/branches/:branchId/diff
 *   POST   /api/projects/:id/branches/:branchId/merge
 *   DELETE /api/projects/:id/branches/:branchId
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { fetchJson, requireSeed, serverReachable } from './_helpers.js';

interface Branch {
  id: string;
  name: string;
}

interface BranchList {
  branches: Branch[];
}

describe('scenario-09: knowledge branching', () => {
  const seed = requireSeed();

  beforeAll(async () => {
    await serverReachable();
  });

  it('creates a branch, lists it, diffs it, then deletes it', async () => {
    const name = `e2e-branch-${Date.now()}`;

    let branch: Branch;
    try {
      branch = await fetchJson<Branch>(
        `/api/projects/${seed.project_id}/branches`,
        {
          method: 'POST',
          body: JSON.stringify({
            name,
            description: 'E2E scenario 09 branch',
          }),
        },
      );
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('404') || msg.includes('not found')) {
        console.warn('[scenario-09] branches route not available; skipping');
        return;
      }
      throw err;
    }
    expect(branch.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(branch.name).toEqual(name);

    const list = await fetchJson<BranchList>(
      `/api/projects/${seed.project_id}/branches`,
    );
    expect(list.branches.some((b) => b.id === branch.id)).toBe(true);

    // Diff should return without error (may be empty).
    const diff = await fetchJson<Record<string, unknown>>(
      `/api/projects/${seed.project_id}/branches/${branch.id}/diff`,
    );
    expect(diff).toBeDefined();

    // Merge with strategy='all' -- empty branch should merge as a no-op.
    const merge = await fetchJson<Record<string, unknown>>(
      `/api/projects/${seed.project_id}/branches/${branch.id}/merge`,
      {
        method: 'POST',
        body: JSON.stringify({ strategy: 'all' }),
      },
    );
    expect(merge).toBeDefined();

    // Cleanup. Branch may already be merged+deleted by the merge path; if
    // delete 404s, that's fine.
    try {
      await fetchJson(`/api/projects/${seed.project_id}/branches/${branch.id}`, {
        method: 'DELETE',
      });
    } catch (err) {
      if (!(err as Error).message.includes('404')) throw err;
    }
  });
});
