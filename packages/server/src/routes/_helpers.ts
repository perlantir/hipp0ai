import { getDb } from '@hipp0/core/db/index.js';
import { NotFoundError } from '@hipp0/core/types.js';
import type { Context } from 'hono';

/**
 * Set the Postgres RLS tenant context for the current request.
 *
 * Safe to call regardless of dialect — SQLite adapters simply don't
 * implement `setProjectContext` and the call is a no-op there.
 */
export function setProjectContext(projectId: string | null): void {
  try {
    const db = getDb() as { setProjectContext?: (id: string | null) => void };
    if (typeof db.setProjectContext === 'function') {
      db.setProjectContext(projectId);
    }
  } catch {
    // getDb() can throw before the DB is initialised (e.g. during tests
    // that mock the module); never let this crash the request.
  }
}

/**
 * Verify the authenticated caller has access to the given project.
 * When auth is required, checks project belongs to caller's tenant.
 * In dev mode (HIPP0_AUTH_REQUIRED=false), allows all access.
 *
 * In addition, sets the Postgres RLS tenant context so that every subsequent
 * query on this request is automatically scoped to the project via
 * `app.current_project_id`.
 */
export async function requireProjectAccess(c: Context, projectId: string): Promise<void> {
  // Always set the Postgres RLS context, even in dev / auth-disabled mode.
  // This is the safety net that prevents data leakage across projects.
  setProjectContext(projectId);

  if (process.env.HIPP0_AUTH_REQUIRED === 'false') return;
  if (process.env.NODE_ENV !== 'production' && process.env.HIPP0_AUTH_REQUIRED !== 'true') return;

  const user = (c.get('user') as any) as { tenant_id?: string } | undefined;
  if (!user?.tenant_id) return;

  const db = getDb();
  // The tenant-lookup query itself needs bypass (the projects table is not
  // scoped by project_id). Temporarily lift the context, then restore it.
  const adapter = db as {
    setProjectContext?: (id: string | null) => void;
    enableRlsBypass?: () => void;
    disableRlsBypass?: () => void;
  };

  let result;
  try {
    adapter.enableRlsBypass?.();
    result = await db.query(
      'SELECT id FROM projects WHERE id = ? AND tenant_id = ?',
      [projectId, user.tenant_id],
    );
  } finally {
    adapter.disableRlsBypass?.();
  }

  if (result.rows.length === 0) {
    throw new NotFoundError('Project', projectId);
  }
}
