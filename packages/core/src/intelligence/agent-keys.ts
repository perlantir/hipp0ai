/**
 * Per-Agent API Keys — first-class credentials scoped to a single agent.
 *
 * Every key is generated as `h0_agent_<32 random hex chars>` and only the
 * SHA-256 hash of the raw key is ever persisted. The raw key is returned
 * exactly once (at creation time) and must be stored securely by the caller.
 *
 * Responsibilities:
 *   - createAgentApiKey: mint a fresh key, persist its hash
 *   - listAgentKeys:     list keys for a project, optionally filtered by agent
 *   - revokeAgentKey:    soft-revoke by stamping revoked_at
 *   - validateAgentKey:  look up a raw key and return the scope metadata
 *   - recordKeyUsage:    bump last_used_at (best-effort, async)
 *
 * All operations are best-effort: database errors are surfaced to the
 * caller (so HTTP routes can return 500), but validateAgentKey returns
 * null on any lookup failure so auth middleware can treat it as "no key".
 */

import crypto from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/** Raw credential prefix used for every per-agent key. */
export const AGENT_KEY_PREFIX = 'h0_agent_';

/** Default scopes given to a fresh agent key when none are supplied. */
export const DEFAULT_AGENT_KEY_SCOPES: readonly string[] = ['read', 'write'];

/** Shape of a stored key row, minus the secret hash, safe to return to API. */
export interface AgentKey {
  id: string;
  project_id: string;
  agent_id: string | null;
  agent_name: string | null;
  name: string;
  scopes: string[];
  last_used_at: string | null;
  created_at: string;
  revoked_at: string | null;
}

/** Metadata returned by validateAgentKey for the auth middleware. */
export interface ValidatedAgentKey {
  key_id: string;
  project_id: string;
  agent_id?: string;
  agent_name?: string;
  scopes: string[];
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function hashKey(rawKey: string): string {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

function generateRawKey(): string {
  // 32 random hex characters = 16 random bytes (128 bits of entropy).
  const randomHex = crypto.randomBytes(16).toString('hex');
  return `${AGENT_KEY_PREFIX}${randomHex}`;
}

function parseScopes(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') {
    // Postgres returns `{a,b}` text-array literal; sqlite/JSON returns `["a","b"]`.
    const trimmed = raw.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (Array.isArray(parsed)) return parsed.map(String);
      } catch {
        /* fall through */
      }
    }
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      return trimmed
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
    if (trimmed.length > 0) return [trimmed];
  }
  return [...DEFAULT_AGENT_KEY_SCOPES];
}

function serializeScopes(scopes: readonly string[]): unknown {
  const db = getDb();
  if (db.dialect === 'sqlite') return JSON.stringify([...scopes]);
  // Postgres TEXT[] — adapter accepts an array via arrayParam.
  return db.arrayParam([...scopes]);
}

function rowToAgentKey(row: Record<string, unknown>): AgentKey {
  return {
    id: String(row.id),
    project_id: String(row.project_id ?? ''),
    agent_id: row.agent_id ? String(row.agent_id) : null,
    agent_name: row.agent_name ? String(row.agent_name) : null,
    name: String(row.name ?? ''),
    scopes: parseScopes(row.scopes),
    last_used_at: row.last_used_at ? String(row.last_used_at) : null,
    created_at: row.created_at ? String(row.created_at) : '',
    revoked_at: row.revoked_at ? String(row.revoked_at) : null,
  };
}

/* ------------------------------------------------------------------ */
/*  createAgentApiKey                                                  */
/* ------------------------------------------------------------------ */

/**
 * Mint a fresh per-agent API key. Returns the raw key ONCE — callers
 * must surface it to the end user and never store or log it again.
 *
 * @param projectId  Project this key is scoped to.
 * @param agentId    Agent UUID; the key will be tied to this agent.
 * @param name       Human-readable label (e.g. "CI bot key").
 * @param scopes     Optional scope strings. Defaults to ['read','write'].
 */
export async function createAgentApiKey(
  projectId: string,
  agentId: string,
  name: string,
  scopes?: string[],
): Promise<{ key: string; key_id: string }> {
  if (!projectId) throw new Error('projectId is required');
  if (!agentId) throw new Error('agentId is required');
  if (!name || name.length === 0) throw new Error('name is required');

  const db = getDb();
  const rawKey = generateRawKey();
  const keyHash = hashKey(rawKey);
  const keyId = randomUUID();
  const scopeList = scopes && scopes.length > 0 ? scopes : [...DEFAULT_AGENT_KEY_SCOPES];

  // Look up agent_name for denormalised lookups. Best-effort — if the
  // agents table doesn't have this agent, we still create the key.
  let agentName: string | null = null;
  try {
    const agentRes = await db.query<Record<string, unknown>>(
      'SELECT name FROM agents WHERE id = ? LIMIT 1',
      [agentId],
    );
    if (agentRes.rows.length > 0) {
      agentName = String(agentRes.rows[0].name ?? '') || null;
    }
  } catch {
    /* ignore — column may be missing in exotic deployments */
  }

  if (db.dialect === 'sqlite') {
    await db.query(
      `INSERT INTO api_keys
         (id, project_id, agent_id, agent_name, name, key_hash, scopes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [keyId, projectId, agentId, agentName, name, keyHash, serializeScopes(scopeList)],
    );
  } else {
    await db.query(
      `INSERT INTO api_keys
         (id, project_id, agent_id, agent_name, name, key_hash, scopes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
      [keyId, projectId, agentId, agentName, name, keyHash, serializeScopes(scopeList)],
    );
  }

  return { key: rawKey, key_id: keyId };
}

/* ------------------------------------------------------------------ */
/*  listAgentKeys                                                      */
/* ------------------------------------------------------------------ */

/**
 * List all API keys for a project, optionally filtered to a single agent.
 * Returns the safe (hash-less) metadata view of each key, including
 * revoked keys — callers can filter them out if desired.
 */
export async function listAgentKeys(
  projectId: string,
  agentId?: string,
): Promise<AgentKey[]> {
  const db = getDb();
  const params: unknown[] = [projectId];
  let where = 'project_id = ?';
  if (agentId) {
    where += ' AND agent_id = ?';
    params.push(agentId);
  }

  const result = await db.query<Record<string, unknown>>(
    `SELECT id, project_id, agent_id, agent_name, name, scopes,
            last_used_at, created_at, revoked_at
       FROM api_keys
      WHERE ${where}
      ORDER BY created_at DESC`,
    params,
  );

  return result.rows.map(rowToAgentKey);
}

/* ------------------------------------------------------------------ */
/*  revokeAgentKey                                                     */
/* ------------------------------------------------------------------ */

/**
 * Soft-revoke a key by stamping its revoked_at column. The row is kept
 * for audit purposes. Idempotent: revoking an already-revoked key
 * leaves the original timestamp intact.
 */
export async function revokeAgentKey(keyId: string): Promise<void> {
  if (!keyId) throw new Error('keyId is required');
  const db = getDb();
  if (db.dialect === 'sqlite') {
    await db.query(
      `UPDATE api_keys
          SET revoked_at = datetime('now')
        WHERE id = ? AND revoked_at IS NULL`,
      [keyId],
    );
  } else {
    await db.query(
      `UPDATE api_keys
          SET revoked_at = NOW()
        WHERE id = ? AND revoked_at IS NULL`,
      [keyId],
    );
  }
}

/* ------------------------------------------------------------------ */
/*  validateAgentKey                                                   */
/* ------------------------------------------------------------------ */

/**
 * Validate a raw bearer token. Returns the project/agent scope on
 * success, or `null` when the key is unknown, revoked, or the lookup
 * failed. Never throws — safe to call from auth middleware.
 *
 * Only tokens starting with the `h0_agent_` prefix are considered;
 * callers that want to support legacy project-level keys should fall
 * back to their existing auth path when this function returns null.
 */
export async function validateAgentKey(
  rawKey: string,
): Promise<ValidatedAgentKey | null> {
  try {
    if (!rawKey || typeof rawKey !== 'string') return null;
    if (!rawKey.startsWith(AGENT_KEY_PREFIX)) return null;

    const hash = hashKey(rawKey);
    const db = getDb();
    const result = await db.query<Record<string, unknown>>(
      `SELECT id, project_id, agent_id, agent_name, scopes, revoked_at
         FROM api_keys
        WHERE key_hash = ?
        LIMIT 1`,
      [hash],
    );

    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    if (row.revoked_at) return null;

    const validated: ValidatedAgentKey = {
      key_id: String(row.id),
      project_id: String(row.project_id ?? ''),
      scopes: parseScopes(row.scopes),
    };
    if (row.agent_id) validated.agent_id = String(row.agent_id);
    if (row.agent_name) validated.agent_name = String(row.agent_name);
    return validated;
  } catch (err) {
    console.warn(
      '[hipp0:agent-keys] validateAgentKey failed:',
      (err as Error).message,
    );
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  recordKeyUsage                                                     */
/* ------------------------------------------------------------------ */

/**
 * Bump last_used_at on a key. This is called from the auth hot path,
 * so it's fire-and-forget: errors are swallowed and never bubble up.
 */
export async function recordKeyUsage(keyId: string): Promise<void> {
  if (!keyId) return;
  try {
    const db = getDb();
    if (db.dialect === 'sqlite') {
      await db.query(
        `UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?`,
        [keyId],
      );
    } else {
      await db.query(
        `UPDATE api_keys SET last_used_at = NOW() WHERE id = ?`,
        [keyId],
      );
    }
  } catch (err) {
    console.warn(
      '[hipp0:agent-keys] recordKeyUsage failed:',
      (err as Error).message,
    );
  }
}
