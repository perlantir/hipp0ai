/**
 * Bootstrap API Keys — on every startup, generate a default key for any
 * project that has zero active (non-revoked, non-expired) API keys.
 * The full key is logged once to stdout; only the SHA-256 hash is persisted.
 */
import { getDb } from '@hipp0/core/db/index.js';
import crypto from 'node:crypto';

import { DEFAULT_TENANT_ID, DEFAULT_USER_ID } from './constants.js';

export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const randomPart = crypto.randomBytes(32).toString('hex');
  const prefix = 'h0_live_';
  const key = `${prefix}${randomPart}`;
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  return { key, prefix, hash };
}

export async function bootstrapApiKeys(): Promise<void> {
  // When auth is disabled (dev / local smoke tests), there is no point
  // seeding API keys — the middleware bypasses every request anyway, and
  // the INSERT path below collides with the SQLite-only api_keys.id NOT
  // NULL constraint. Skip entirely in that mode so fresh SQLite boots
  // succeed without having to reach into the bootstrap SQL.
  if (process.env.HIPP0_AUTH_REQUIRED === 'false') {
    console.warn('[hipp0] HIPP0_AUTH_REQUIRED=false — skipping API key bootstrap');
    return;
  }

  const db = getDb();

  // Check if api_keys table exists
  try {
    await db.query('SELECT 1 FROM api_keys LIMIT 0', []);
  } catch {
    console.warn('[hipp0] api_keys table does not exist yet — skipping key bootstrap');
    return;
  }

  // Get all projects
  let projects: Array<Record<string, unknown>>;
  try {
    const result = await db.query('SELECT id, name FROM projects', []);
    projects = result.rows as Array<Record<string, unknown>>;
  } catch {
    console.warn('[hipp0] projects table does not exist yet — skipping key bootstrap');
    return;
  }

  if (projects.length === 0) {
    return;
  }

  for (const project of projects) {
    const projectId = project.id as string;
    const projectName = project.name as string;

    // Check for existing active keys for this project
    const existing = await db.query(
      `SELECT id FROM api_keys
       WHERE project_id = ?
         AND (expires_at IS NULL OR expires_at > ${db.dialect === 'sqlite' ? "datetime('now')" : 'NOW()'})`,
      [projectId],
    );

    if (existing.rows.length > 0) {
      continue; // already has active keys
    }

    // Generate a new key
    const { key, prefix, hash } = generateApiKey();

    // Client-generate the id so the INSERT works on SQLite. The Postgres
    // schema has DEFAULT uuid_generate_v4() on api_keys.id; SQLite doesn't.
    // Without this, bootstrap silently crashed on every prod-auth boot
    // against SQLite. The dev-mode guard above already short-circuits
    // HIPP0_AUTH_REQUIRED=false, so this only matters when auth is real.
    const id = crypto.randomUUID();
    await db.query(
      `INSERT INTO api_keys (id, tenant_id, project_id, name, key_hash, key_prefix, permissions, rate_limit, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, DEFAULT_TENANT_ID, projectId, 'Default (auto-generated)', hash, prefix, 'admin', 1000, DEFAULT_USER_ID],
    );

    const masked = key.slice(0, 16) + '...';
    console.warn(`[hipp0] API key generated for project "${projectName}": ${masked}`);

    // One-shot full-key emission for deploy / capture flows. The plaintext
    // is only ever held in memory once — only its SHA-256 hash hits the
    // database — so this is the *only* opportunity to record the key.
    // Tagged so deploy scripts can grep journalctl reliably:
    //
    //   journalctl -u hipp0 | grep -oP '\[hipp0:BOOTSTRAP_API_KEY\].*' \
    //     | tail -1
    //
    // This line only fires when bootstrap actually generates a key (i.e.
    // the project had zero active keys), so it is one-shot per project.
    // The journal is root + systemd-journal readable, not world-readable;
    // the deploy script captures it to /etc/team-hippo/api-key.txt (mode
    // 600) immediately after first boot. Subsequent boots skip this
    // function entirely because the project now has an active key.
    console.warn(
      `[hipp0:BOOTSTRAP_API_KEY] project_id=${projectId} project_name="${projectName}" key=${key}`,
    );
  }
}
