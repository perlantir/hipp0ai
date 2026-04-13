/**
 * Playground Session Manager — per-visitor isolated SQLite DBs.
 *
 * Each visitor to the hosted playground gets their own fresh SQLite database
 * under `/tmp/hipp0-playground/<session-id>.db`.  The adapter is created on
 * demand via `createAdapter({ dialect: 'sqlite', sqlitePath })`, connected,
 * and has the standard Hipp0 migrations applied.  When the session expires
 * (1 h of inactivity) the adapter is closed and the `.db` file is deleted.
 *
 * Metadata lives only in an in-memory Map — playground sessions are
 * intentionally ephemeral; restarting the server wipes them.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { createAdapter } from '@hipp0/core/db/factory.js';
import type { DatabaseAdapter } from '@hipp0/core/db/adapter.js';

import { seedPlaygroundProject } from './seed-data.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PlaygroundSession {
  id: string;
  projectId: string;
  dbPath: string;
  createdAt: Date;
  lastActivityAt: Date;
  expiresAt: Date;
}

export interface PlaygroundSessionSummary {
  session_id: string;
  project_id: string;
  expires_at: string;
  created_at?: string;
  last_activity_at?: string;
}

export interface PlaygroundSessionStats {
  total_sessions: number;
  active_sessions: number;
  total_created: number;
  total_expired: number;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PLAYGROUND_ROOT = '/tmp/hipp0-playground';
export const PLAYGROUND_SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // every 10 minutes

// Resolve the migrations directory for the SQLite dialect.  We need an
// absolute path that points at the core package's SQLite migrations so each
// per-session database gets the full schema applied.
function resolveSqliteMigrationsDir(): string {
  // At runtime this file lives at
  //   packages/server/dist/playground/session-manager.js
  // and the migrations live at
  //   packages/core/dist/db/migrations/sqlite
  // Walk up to the monorepo root and join the core dist path.
  const here = path.dirname(new URL(import.meta.url).pathname);
  // here = .../packages/server/dist/playground
  const coreDist = path.resolve(
    here,
    '..',
    '..',
    '..',
    'core',
    'dist',
    'db',
    'migrations',
    'sqlite',
  );
  if (fs.existsSync(coreDist)) return coreDist;

  // Fallback: walk up to repo root and use the source tree (dev / tsx).
  const coreSrc = path.resolve(
    here,
    '..',
    '..',
    '..',
    'core',
    'src',
    'db',
    'migrations',
    'sqlite',
  );
  if (fs.existsSync(coreSrc)) return coreSrc;

  // Last-resort fallback: assume CWD is the monorepo root.
  return path.resolve(process.cwd(), 'packages/core/src/db/migrations/sqlite');
}

// ---------------------------------------------------------------------------
// In-memory session + adapter stores
// ---------------------------------------------------------------------------

const sessions = new Map<string, PlaygroundSession>();
const adapters = new Map<string, DatabaseAdapter>();

let totalCreated = 0;
let totalExpired = 0;

let cleanupTimer: NodeJS.Timeout | null = null;

// ---------------------------------------------------------------------------
// Filesystem helpers
// ---------------------------------------------------------------------------

async function ensureRootDir(): Promise<void> {
  try {
    await fsp.mkdir(PLAYGROUND_ROOT, { recursive: true });
  } catch (err) {
    console.error(
      '[hipp0/playground] Failed to ensure root dir:',
      (err as Error).message,
    );
  }
}

async function removeDbFile(dbPath: string): Promise<void> {
  const candidates = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`, `${dbPath}-journal`];
  for (const p of candidates) {
    try {
      await fsp.unlink(p);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        console.warn(
          `[hipp0/playground] Failed to remove ${p}:`,
          (err as Error).message,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Core API
// ---------------------------------------------------------------------------

/**
 * Create a new playground session with an isolated, freshly-seeded SQLite DB.
 */
export async function createPlaygroundSession(): Promise<PlaygroundSessionSummary> {
  await ensureRootDir();
  // Ensure the cleanup interval is running (lazy start).
  startCleanupInterval();

  const sessionId = randomUUID();
  const dbPath = path.join(PLAYGROUND_ROOT, `${sessionId}.db`);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + PLAYGROUND_SESSION_TTL_MS);

  let adapter: DatabaseAdapter | null = null;
  try {
    adapter = await createAdapter({ dialect: 'sqlite', sqlitePath: dbPath });
    await adapter.connect();
    await adapter.runMigrations(resolveSqliteMigrationsDir());

    const { projectId } = await seedPlaygroundProject(adapter);

    const session: PlaygroundSession = {
      id: sessionId,
      projectId,
      dbPath,
      createdAt: now,
      lastActivityAt: now,
      expiresAt,
    };

    sessions.set(sessionId, session);
    adapters.set(sessionId, adapter);
    totalCreated++;

    console.warn(
      `[hipp0/playground] created session=${sessionId} project=${projectId} db=${dbPath}`,
    );

    return {
      session_id: session.id,
      project_id: session.projectId,
      expires_at: session.expiresAt.toISOString(),
      created_at: session.createdAt.toISOString(),
      last_activity_at: session.lastActivityAt.toISOString(),
    };
  } catch (err) {
    console.error(
      '[hipp0/playground] Failed to create session:',
      (err as Error).message,
    );
    // Cleanup half-initialised state.
    if (adapter) {
      try {
        await adapter.close();
      } catch {
        /* ignore */
      }
    }
    await removeDbFile(dbPath);
    throw err;
  }
}

/**
 * Return the DB adapter for a session, or `null` if the session does not
 * exist (or has expired).
 */
export function getSessionDb(sessionId: string): DatabaseAdapter | null {
  const session = sessions.get(sessionId);
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    // Lazily expire — do not block callers.
    void expireSession(sessionId);
    return null;
  }
  return adapters.get(sessionId) ?? null;
}

/**
 * Return the session metadata for a given id, or `null` if not found / expired.
 */
export function getSession(sessionId: string): PlaygroundSession | null {
  const session = sessions.get(sessionId);
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    void expireSession(sessionId);
    return null;
  }
  return session;
}

/**
 * Bump the `lastActivityAt` + `expiresAt` timestamps for a session.
 * No-op if the session does not exist.
 */
export function touchSession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  const now = new Date();
  session.lastActivityAt = now;
  session.expiresAt = new Date(now.getTime() + PLAYGROUND_SESSION_TTL_MS);
  console.warn(`[hipp0/playground] touched session=${sessionId}`);
}

/**
 * Check if a session ID refers to a playground session (alive or not).
 * Used by other modules (e.g. capture.ts) to detect playground requests
 * so they can skip LLM-backed work.
 */
export function isPlaygroundSession(sessionId: string | null | undefined): boolean {
  if (!sessionId) return false;
  return sessions.has(sessionId);
}

/**
 * Check if a project belongs to an active playground session.
 */
export function isPlaygroundProject(projectId: string | null | undefined): boolean {
  if (!projectId) return false;
  for (const s of sessions.values()) {
    if (s.projectId === projectId) return true;
  }
  return false;
}

/**
 * Force-expire a single session: close the adapter and delete the DB file.
 */
async function expireSession(sessionId: string): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) return;

  const adapter = adapters.get(sessionId);
  adapters.delete(sessionId);
  sessions.delete(sessionId);
  totalExpired++;

  if (adapter) {
    try {
      await adapter.close();
    } catch (err) {
      console.warn(
        `[hipp0/playground] Failed to close adapter for ${sessionId}:`,
        (err as Error).message,
      );
    }
  }

  await removeDbFile(session.dbPath);

  console.warn(`[hipp0/playground] expired session=${sessionId}`);
}

/**
 * Walk the in-memory Map and evict any sessions whose `expiresAt` has passed.
 * Returns the number of sessions cleaned up.
 */
export async function cleanupExpiredSessions(): Promise<number> {
  const now = Date.now();
  const toExpire: string[] = [];
  for (const [id, s] of sessions) {
    if (s.expiresAt.getTime() < now) toExpire.push(id);
  }
  for (const id of toExpire) {
    try {
      await expireSession(id);
    } catch (err) {
      console.warn(
        `[hipp0/playground] cleanup failed for ${id}:`,
        (err as Error).message,
      );
    }
  }
  if (toExpire.length > 0) {
    console.warn(
      `[hipp0/playground] cleanup: removed ${toExpire.length} expired sessions`,
    );
  }
  return toExpire.length;
}

/**
 * Snapshot of playground runtime metrics.
 */
export function getSessionStats(): PlaygroundSessionStats {
  const now = Date.now();
  let active = 0;
  for (const s of sessions.values()) {
    if (s.expiresAt.getTime() >= now) active++;
  }
  return {
    total_sessions: sessions.size,
    active_sessions: active,
    total_created: totalCreated,
    total_expired: totalExpired,
  };
}

/**
 * List all sessions currently known to the manager (including expired ones
 * that haven't been swept yet).  Used by admin / debug endpoints.
 */
export function listSessions(): PlaygroundSessionSummary[] {
  const out: PlaygroundSessionSummary[] = [];
  for (const s of sessions.values()) {
    out.push({
      session_id: s.id,
      project_id: s.projectId,
      created_at: s.createdAt.toISOString(),
      last_activity_at: s.lastActivityAt.toISOString(),
      expires_at: s.expiresAt.toISOString(),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Cleanup scheduler
// ---------------------------------------------------------------------------

/**
 * Start the background cleanup interval.  Idempotent — safe to call many
 * times; the timer is only registered once.
 */
export function startCleanupInterval(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    void cleanupExpiredSessions();
  }, CLEANUP_INTERVAL_MS);
  // Don't keep the event loop alive solely for cleanup.
  cleanupTimer.unref?.();
}

/**
 * Stop the background cleanup interval.  Primarily for tests.
 */
export function stopCleanupInterval(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

/**
 * Tear down every active session.  Used on graceful shutdown and in tests.
 */
export async function shutdownAllSessions(): Promise<void> {
  stopCleanupInterval();
  const ids = Array.from(sessions.keys());
  for (const id of ids) {
    try {
      await expireSession(id);
    } catch (err) {
      console.warn(
        `[hipp0/playground] shutdown failed for ${id}:`,
        (err as Error).message,
      );
    }
  }
}
