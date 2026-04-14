/**
 * Phase 3 Auth Middleware — Supabase JWT + API Key authentication.
 *
 * Three middleware variants:
 * - authMiddleware: Requires auth (401 if missing)
 * - optionalAuth: Attaches user if present, passes through if not
 * - apiKeyOrAuth: Accepts either Bearer JWT or h0_* API key
 *
 * Feature flag: HIPP0_AUTH_REQUIRED (default: true)
 * When false (dev only), optionalAuth is used everywhere and defaults to the default tenant.
 * In production, auth is always required regardless of env var.
 */
import type { Context, MiddlewareHandler } from 'hono';
import { createMiddleware } from 'hono/factory';
import { getDb } from '@hipp0/core/db/index.js';
import { validateAgentKey, recordKeyUsage, AGENT_KEY_PREFIX } from '@hipp0/core/intelligence/agent-keys.js';
import { getSupabase } from './supabase.js';
import crypto from 'node:crypto';
import { DEFAULT_TENANT_ID, DEFAULT_USER_ID } from '../constants.js';

export function isAuthRequired(): boolean {
  // In production, auth is ALWAYS required regardless of env var
  if (process.env.NODE_ENV === 'production') return true;
  // In dev, default to true unless explicitly set to false
  return process.env.HIPP0_AUTH_REQUIRED !== 'false';
}

export interface AuthUser {
  id: string;
  email: string;
  tenant_id: string;
  role: string;
  plan: string;
  /** Present only when the request authenticated via a per-agent API key. */
  agent_id?: string;
  /** Present only when the request authenticated via a per-agent API key. */
  agent_name?: string;
  /** Project scope from an agent key; used to restrict writes. */
  agent_key_project_id?: string;
  /** Scopes attached to the agent key (e.g. ["read","write"]). */
  agent_key_scopes?: string[];
}

function getClientIp(c: Context): string {
  // Proxy headers are only trusted when HIPP0_TRUSTED_PROXY=true. Otherwise
  // callers could spoof x-forwarded-for / x-real-ip to defeat free-tier
  // rate limiting. X-Forwarded-For uses the leftmost entry (the original
  // client) — not rightmost, which would be the closest proxy.
  if (process.env.HIPP0_TRUSTED_PROXY === 'true') {
    const forwarded = c.req.header('x-forwarded-for');
    if (forwarded) {
      return forwarded.split(',')[0]?.trim() ?? 'unknown';
    }
    const realIp = c.req.header('x-real-ip');
    if (realIp) return realIp.trim();
  }
  // Fall back to the socket remote address. Hono node adapter exposes the
  // IncomingMessage via c.env.incoming.
  const env = (c as unknown as { env?: { incoming?: { socket?: { remoteAddress?: string } } } }).env;
  return env?.incoming?.socket?.remoteAddress ?? 'unknown';
}

  // Free-tier IP tracking (50 requests without signup)
const freeTierUsage = new Map<string, number>();

// Prune every 24 hours
setInterval(() => {
  freeTierUsage.clear();
}, 24 * 60 * 60_000).unref();

export function getFreeTierCount(ip: string): number {
  return freeTierUsage.get(ip) ?? 0;
}

export function incrementFreeTier(ip: string): number {
  const count = (freeTierUsage.get(ip) ?? 0) + 1;
  freeTierUsage.set(ip, count);
  return count;
}

  // API Key Rate Limiting (sliding window)
interface SlidingWindowEntry {
  timestamps: number[];
}

const apiKeyRateLimitStore = new Map<string, SlidingWindowEntry>();

// Prune every 60s
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of apiKeyRateLimitStore) {
    entry.timestamps = entry.timestamps.filter((t) => t > now - 60_000);
    if (entry.timestamps.length === 0) apiKeyRateLimitStore.delete(key);
  }
}, 60_000).unref();

function checkApiKeyRateLimit(keyHash: string, maxPerMinute: number): { allowed: boolean; remaining: number; resetMs: number } {
  const now = Date.now();
  let entry = apiKeyRateLimitStore.get(keyHash);
  if (!entry) {
    entry = { timestamps: [] };
    apiKeyRateLimitStore.set(keyHash, entry);
  }

  // Remove timestamps older than 1 minute
  entry.timestamps = entry.timestamps.filter((t) => t > now - 60_000);
  const remaining = Math.max(0, maxPerMinute - entry.timestamps.length);

  if (entry.timestamps.length >= maxPerMinute) {
    const oldest = entry.timestamps[0] ?? now;
    return { allowed: false, remaining: 0, resetMs: oldest + 60_000 - now };
  }

  entry.timestamps.push(now);
  return { allowed: true, remaining: remaining - 1, resetMs: 60_000 };
}

  // Resolve rate limit from plan
function planRateLimit(plan: string): number {
  switch (plan) {
    case 'enterprise': return 10_000;
    case 'pro': return 1_000;
    default: return 100;
  }
}

  // Authenticate via API key (h0_live_* or h0_test_*)
async function authenticateApiKey(token: string, c: Context): Promise<AuthUser | null> {
  if (!token.startsWith('h0_live_') && !token.startsWith('h0_test_')) return null;

  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const db = getDb();

  const result = await db.query(
    `SELECT ak.*, t.plan FROM api_keys ak
     JOIN tenants t ON t.id = ak.tenant_id
     WHERE ak.key_hash = ? AND ak.revoked_at IS NULL`,
    [hash],
  );

  if (result.rows.length === 0) return null;

  const key = result.rows[0] as Record<string, unknown>;

  // Check expiry
  if (key.expires_at && new Date(key.expires_at as string) < new Date()) return null;

  // Rate limit check
  const maxRate = planRateLimit(key.plan as string);
  const rateCheck = checkApiKeyRateLimit(hash, maxRate);
  if (!rateCheck.allowed) {
    c.header('Retry-After', String(Math.ceil(rateCheck.resetMs / 1000)));
    c.header('X-RateLimit-Limit', String(maxRate));
    c.header('X-RateLimit-Remaining', '0');
    return null; // Will be treated as rate limited
  }

  // Update last_used_at (fire-and-forget)
  db.query('UPDATE api_keys SET last_used_at = NOW() WHERE id = ?', [key.id]).catch(() => {});

  return {
    id: key.created_by as string,
    email: '',
    tenant_id: key.tenant_id as string,
    role: key.permissions as string === 'admin' ? 'admin' : 'member',
    plan: key.plan as string,
  };
}

  // Authenticate via Supabase JWT
async function authenticateJwt(token: string): Promise<AuthUser | null> {
  try {
    const supabase = getSupabase();
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) return null;

    const db = getDb();
    const membership = await db.query(
      `SELECT tm.tenant_id, tm.role, t.plan
       FROM tenant_members tm
       JOIN tenants t ON t.id = tm.tenant_id
       WHERE tm.user_id = ? AND tm.accepted_at IS NOT NULL
       LIMIT 1`,
      [user.id],
    );

    if (membership.rows.length === 0) return null;

    const member = membership.rows[0] as Record<string, unknown>;

    return {
      id: user.id,
      email: user.email ?? '',
      tenant_id: member.tenant_id as string,
      role: member.role as string,
      plan: member.plan as string,
    };
  } catch {
    return null;
  }
}

  // Extract token from request
function extractToken(c: Context): string | null {
  // Check Authorization header
  const authHeader = c.req.header('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  // Check X-API-Key header
  const apiKey = c.req.header('X-API-Key');
  if (apiKey) return apiKey;

  return null;
}

  // Authenticate via a per-agent API key (h0_agent_*).
// Looks up the key in api_keys, attaches agent_id/agent_name/scopes
// to the AuthUser, and best-effort updates last_used_at.
async function authenticateAgentKey(token: string, c: Context): Promise<AuthUser | null> {
  if (!token.startsWith(AGENT_KEY_PREFIX)) return null;

  const validated = await validateAgentKey(token);
  if (!validated) return null;

  // Rate limit agent keys the same way as tenant keys — keyed by hash of
  // the token so different keys don't share quotas.
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const rateCheck = checkApiKeyRateLimit(hash, 1_000);
  if (!rateCheck.allowed) {
    c.header('Retry-After', String(Math.ceil(rateCheck.resetMs / 1000)));
    c.header('X-RateLimit-Limit', '1000');
    c.header('X-RateLimit-Remaining', '0');
    return null;
  }

  // Look up the owning tenant via the project row (best-effort).
  // If the project or tenant lookup fails we still authenticate, but
  // fall back to the default tenant so downstream code has a value.
  let tenantId = DEFAULT_TENANT_ID;
  let plan = 'free';
  try {
    const db = getDb();
    const res = await db.query(
      `SELECT p.tenant_id, t.plan
         FROM projects p
         LEFT JOIN tenants t ON t.id = p.tenant_id
        WHERE p.id = ?
        LIMIT 1`,
      [validated.project_id],
    );
    if (res.rows.length > 0) {
      const row = res.rows[0] as Record<string, unknown>;
      if (row.tenant_id) tenantId = row.tenant_id as string;
      if (row.plan) plan = row.plan as string;
    }
  } catch {
    /* ignore — best effort */
  }

  // Fire-and-forget usage update.
  recordKeyUsage(validated.key_id).catch(() => {});

  return {
    id: `agent:${validated.agent_id ?? 'unknown'}`,
    email: '',
    tenant_id: tenantId,
    role: validated.scopes.includes('write') ? 'member' : 'viewer',
    plan,
    agent_id: validated.agent_id,
    agent_name: validated.agent_name,
    agent_key_project_id: validated.project_id,
    agent_key_scopes: validated.scopes,
  };
}

  // Authenticate from token (root bypass, API key, or JWT)
async function authenticateToken(token: string, c: Context): Promise<AuthUser | null> {
  // Root admin bypass — HIPP0_API_KEY from .env is the self-hoster's
  // "I own this server" master key. Accepts anything non-empty that
  // exactly matches the env var. Skips all DB lookups so it works
  // even before multi-tenancy tables exist on fresh installs.
  const rootKey = process.env.HIPP0_API_KEY;
  if (rootKey && token === rootKey) {
    return {
      id: DEFAULT_USER_ID,
      email: 'root@hipp0.local',
      tenant_id: DEFAULT_TENANT_ID,
      role: 'admin',
      plan: 'enterprise',
    } satisfies AuthUser;
  }
  // Per-agent key (more specific prefix, check first)
  if (token.startsWith(AGENT_KEY_PREFIX)) {
    return authenticateAgentKey(token, c);
  }
  // Tenant/project-level API key
  if (token.startsWith('h0_')) {
    return authenticateApiKey(token, c);
  }
  // Try JWT
  return authenticateJwt(token);
}

/**
 * Strict auth middleware — returns 401 if no valid auth.
 * When HIPP0_AUTH_REQUIRED=false (dev only), defaults to default tenant with viewer role.
 */
export const phase3AuthMiddleware: MiddlewareHandler = createMiddleware(async (c, next) => {
  if (!isAuthRequired()) {
    // Dev mode only: default to default tenant with read-only viewer access
    c.set('user', {
      id: 'anonymous',
      email: '',
      tenant_id: DEFAULT_TENANT_ID,
      role: 'viewer',
      plan: 'enterprise',
    } satisfies AuthUser);
    await next();
    return;
  }

  const token = extractToken(c);
  if (!token) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }, 401);
  }

  const user = await authenticateToken(token, c);
  if (!user) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } }, 401);
  }

  c.set('user', user);
  await next();
});

/**
 * Optional auth — attaches user if present, returns 401 for invalid tokens.
 * When no token provided in dev mode, defaults to default tenant with viewer role.
 */
export const optionalAuth: MiddlewareHandler = createMiddleware(async (c, next) => {
  const token = extractToken(c);

  if (token) {
    const user = await authenticateToken(token, c);
    if (user) {
      c.set('user', user);
      await next();
      return;
    }
    // Invalid/expired token = 401, NOT silent elevation
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } }, 401);
  }

  // No token provided — use default tenant with read-only access (dev mode only)
  c.set('user', {
    id: 'anonymous',
    email: '',
    tenant_id: DEFAULT_TENANT_ID,
    role: 'viewer',
    plan: 'free',
  } satisfies AuthUser);

  await next();
});

/**
 * Free-tier middleware for /api/compile — allows 50 requests without auth.
 */
export const freeTierOrAuth: MiddlewareHandler = createMiddleware(async (c, next) => {
  if (!isAuthRequired()) {
    c.set('user', {
      id: 'anonymous',
      email: '',
      tenant_id: DEFAULT_TENANT_ID,
      role: 'viewer',
      plan: 'enterprise',
    } satisfies AuthUser);
    await next();
    return;
  }

  const token = extractToken(c);

  // If token provided, authenticate normally
  if (token) {
    const user = await authenticateToken(token, c);
    if (user) {
      c.set('user', user);
      await next();
      return;
    }
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } }, 401);
  }

  // No token — check free tier
  const ip = getClientIp(c);
  const count = getFreeTierCount(ip);

  if (count >= 50) {
    return c.json(
      {
        error: {
          code: 'FREE_TIER_EXCEEDED',
          message: 'Create a free account to continue. It takes 10 seconds.',
        },
      },
      429,
    );
  }

  incrementFreeTier(ip);

  c.set('user', {
    id: 'anonymous',
    email: '',
    tenant_id: DEFAULT_TENANT_ID,
    role: 'viewer',
    plan: 'free',
  } satisfies AuthUser);

  await next();
});

/**
 * Role-based authorization middleware.
 * Must be used after auth middleware.
 */
export function requireRole(...roles: string[]): MiddlewareHandler {
  return createMiddleware(async (c, next) => {
    const user = c.get('user') as AuthUser | undefined;
    if (!user) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }, 401);
    }
    if (!roles.includes(user.role)) {
      return c.json({ error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } }, 403);
    }
    await next();
  });
}

/**
 * Helper to get the current user from context.
 */
export function getUser(c: Context): AuthUser {
  return c.get('user') as AuthUser;
}

/**
 * Helper to get tenant_id from context.
 */
export function getTenantId(c: Context): string {
  const user = c.get('user') as AuthUser | undefined;
  return user?.tenant_id ?? DEFAULT_TENANT_ID;
}
