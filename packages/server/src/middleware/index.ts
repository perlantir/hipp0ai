import type { Context, MiddlewareHandler } from 'hono';
import { createMiddleware } from 'hono/factory';
import { Hipp0Error } from '@hipp0/core/types.js';
import { getDb } from '@hipp0/core/db/index.js';
import crypto from 'node:crypto';

// Legacy API key — kept for backward compat (step 5 in auth flow)
const LEGACY_API_KEY: string | undefined = process.env.HIPP0_API_KEY;

// Timing-safe comparison that handles length mismatches without leaking length info.
// Both buffers are padded to the longer length before comparison; original lengths
// are checked separately to avoid short-circuit leaks.
function safeEqual(a: Buffer, b: Buffer): boolean {
  const len = Math.max(a.length, b.length);
  const paddedA = Buffer.concat([a, Buffer.alloc(Math.max(0, len - a.length))]);
  const paddedB = Buffer.concat([b, Buffer.alloc(Math.max(0, len - b.length))]);
  const timingSafe = crypto.timingSafeEqual(paddedA, paddedB);
  return timingSafe && a.length === b.length;
}

function getClientIp(c: Context): string {
  // Proxy headers are only trusted when HIPP0_TRUSTED_PROXY=true. Otherwise
  // callers could spoof x-forwarded-for / x-real-ip to bypass per-IP rate
  // limits and auth-failure lockout. X-Forwarded-For uses the leftmost
  // entry (the original client) — not rightmost, which would be the proxy.
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

// Sanitise PostgreSQL errors — strip table/column/constraint names
function sanitisePgError(err: unknown): string {
  if (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as Record<string, unknown>).code === 'string'
  ) {
    const code = (err as Record<string, unknown>).code as string;
    // pg error codes: https://www.postgresql.org/docs/current/errcodes-appendix.html
    if (code.startsWith('23')) return 'Database constraint violation';
    if (code.startsWith('42')) return 'Database query error';
    if (code.startsWith('08')) return 'Database connection error';
    return 'Database error';
  }
  return 'Internal server error';
}

// Error Handler
export const errorHandler = (err: Error, c: Context) => {
  if (err instanceof Hipp0Error) {
    // 404 errors must not expose the route path
    if (err.statusCode === 404) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
    }
    return c.json(
      { error: { code: err.code, message: err.message, details: err.details } },
      err.statusCode as 400 | 401 | 403 | 409 | 422 | 500,
    );
  }

  // Log full error to stderr — never returned to the client
  console.error('[hipp0] Unhandled error:', err);

  // Check for PostgreSQL error shape
  if (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as Record<string, unknown>).code === 'string'
  ) {
    const msg = sanitisePgError(err);
    return c.json({ error: { code: 'INTERNAL_ERROR', message: msg } }, 500);
  }

  return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } }, 500);
};

// Security Headers — applied to ALL responses (Phase 3 hardened)
export const securityHeaders: MiddlewareHandler = createMiddleware(async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('X-XSS-Protection', '1; mode=block');
  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  c.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'");
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
});

// Request Timer
export const requestTimer: MiddlewareHandler = createMiddleware(async (c, next) => {
  const start = Date.now();
  await next();
  c.header('X-Response-Time', `${Date.now() - start}ms`);
});

// X-Request-Id middleware — generate UUID, attach to req context, include in response header
export const requestId: MiddlewareHandler = createMiddleware(async (c, next) => {
  const id = c.req.header('X-Request-Id') || crypto.randomUUID();
  c.set('requestId', id);
  await next();
  c.header('X-Request-Id', id);
});

// CORS Middleware — Phase 3: includes hipp0.ai + localhost:3200 by default
export const corsMiddleware: MiddlewareHandler = createMiddleware(async (c, next) => {
  const origin = c.req.header('Origin') ?? '';
  let allowOrigin: string;

  // Explicit allowlist — no wildcard even in dev
  const defaultOrigins = ['https://hipp0.ai', 'http://localhost:3200', 'http://localhost:3100'];
  const envOrigins = (process.env.HIPP0_CORS_ORIGINS ?? process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  const allowed = [...new Set([...defaultOrigins, ...envOrigins])];

  if (allowed.includes(origin)) {
    allowOrigin = origin;
  } else {
    allowOrigin = allowed[0] ?? 'null';
  }

  c.header('Access-Control-Allow-Origin', allowOrigin);
  c.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
  c.header('Access-Control-Max-Age', '86400');

  if (c.req.method === 'OPTIONS') {
    return c.body(null, 204);
  }

  await next();
});

// Public routes that never require auth
const PUBLIC_ROUTES = new Set([
  '/api/health',
  '/health',
  '/api/docs',
  '/api/openapi.json',
  '/api/health/ready',
  '/api/health/live',
]);

// Auth Middleware
// 1. Public route? pass through
// 2. HIPP0_AUTH_DISABLED=true? pass through with warning
// 3. Extract Bearer token → no header? 401
// 4. Hash token, look up in api_keys table (not revoked, not expired)
// 5. Not in DB? Check legacy HIPP0_API_KEY env var
// 6. Nothing matches? 401
// 7. Found? Update last_used_at, attach project_id, pass through
export const authMiddleware: MiddlewareHandler = createMiddleware(async (c, next) => {
  const path = new URL(c.req.url).pathname;

  // Public routes pass through
  if (PUBLIC_ROUTES.has(path)) {
    await next();
    return;
  }

  // HIPP0_AUTH_DISABLED removed — auth cannot be disabled

  const authHeader = c.req.header('Authorization');
  const ip = getClientIp(c);

  const fail = async (message: string) => {
    // Audit auth failure with IP — never log the key value
    getDb().query(`INSERT INTO audit_log (id, event_type, details) VALUES (?, ?, ?)`, [
      crypto.randomUUID(),
      'auth_failure',
      JSON.stringify({ ip, path, reason: message }),
    ]).catch((e: Error) => console.error('[hipp0] audit_log write error:', e.message));

    return c.json({ error: { code: 'UNAUTHORIZED', message } }, 401);
  };

  // Extract Bearer token
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return fail('Missing API key');
  }

  const token = authHeader.slice(7);

  // Hash token, look up in api_keys table
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  try {
    const db = getDb();
    const nowExpr = db.dialect === 'sqlite' ? "datetime('now')" : 'NOW()';
    const result = await db.query(
      `SELECT id, project_id FROM api_keys
       WHERE key_hash = ?
         AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > ${nowExpr})`,
      [tokenHash],
    );

    if (result.rows.length > 0) {
      const row = result.rows[0] as Record<string, unknown>;
      // Update last_used_at, attach project_id
      db.query(`UPDATE api_keys SET last_used_at = ${nowExpr} WHERE id = ?`, [row.id]).catch(() => {});
      if (row.project_id) {
        c.set('projectId', row.project_id as string);
      }
      await next();
      return;
    }
  } catch {
    // api_keys table may not exist yet — fall through to legacy check
  }

  // Check legacy HIPP0_API_KEY env var
  if (LEGACY_API_KEY) {
    const tokenBuf = Buffer.from(token, 'utf8');
    const keyBuf = Buffer.from(LEGACY_API_KEY, 'utf8');
    if (safeEqual(tokenBuf, keyBuf)) {
      await next();
      return;
    }
  }

  // No valid credentials found
  return fail('Invalid API key');
});

// Audit Middleware — async fire-and-forget after response is sent
export const auditMiddleware: MiddlewareHandler = createMiddleware(async (c, next) => {
  await next();

  const method = c.req.method;
  const path = new URL(c.req.url).pathname;
  const status = c.res.status;
  const projectId: string | undefined = c.get('projectId');

  // Hash task_description for compile requests instead of storing raw text
  let extra: Record<string, unknown> = {};
  if (method === 'POST' && path.endsWith('/compile')) {
    try {
      const body = (await c.req.raw.clone().json()) as Record<string, unknown>;
      if (typeof body.task_description === 'string') {
        extra.task_description_hash = crypto
          .createHash('sha256')
          .update(body.task_description)
          .digest('hex')
          .slice(0, 16);
      }
    } catch {
      // Body may already be consumed — skip
    }
  }

  getDb().query(`INSERT INTO audit_log (id, event_type, project_id, details) VALUES (?, ?, ?, ?)`, [
    crypto.randomUUID(),
    'api_request',
    projectId ?? null,
    JSON.stringify({ method, path, status, ...extra }),
  ]).catch((e: Error) => console.error('[hipp0] audit_log write error:', e.message));
});

// Rate Limiter
// NOTE: Rate-limit counters are held in-process memory. When running multiple
// server instances behind a load balancer each instance tracks limits
// independently. For shared rate limiting across instances, use a Redis-backed
// store (see CACHE_PROVIDER / REDIS_URL in the self-hosting docs).
interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface LockoutEntry {
  until: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();
const lockoutStore = new Map<string, LockoutEntry>();
const authFailStore = new Map<string, RateLimitEntry>();

// Prune expired entries every 60 s — unref so the timer doesn't keep the process alive
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateLimitStore) if (v.resetAt < now) rateLimitStore.delete(k);
  for (const [k, v] of authFailStore) if (v.resetAt < now) authFailStore.delete(k);
  for (const [k, v] of lockoutStore) if (v.until < now) lockoutStore.delete(k);
}, 60_000).unref();

export interface RateLimiterConfig {
  windowMs?: number; // default: 60_000
  maxRequests?: number; // default: 100
  namespace?: string; // used to key a separate counter per endpoint group
}

export function rateLimiter(opts: RateLimiterConfig = {}): MiddlewareHandler {
  const windowMs = opts.windowMs ?? 60_000;
  const maxRequests = opts.maxRequests ?? 100;
  const ns = opts.namespace ?? 'global';

  return createMiddleware(async (c, next) => {
    // Test/CI bypass: HIPP0_DISABLE_RATE_LIMIT=true turns the limiter into a
    // pass-through. Only intended for e2e harnesses; production deployments
    // should never set this.
    if (process.env.HIPP0_DISABLE_RATE_LIMIT === 'true') {
      await next();
      return;
    }

    // Rate limiting is always active regardless of NODE_ENV
    const ip = getClientIp(c);

    // Check auth-failure lockout first
    const lockout = lockoutStore.get(ip);
    if (lockout && lockout.until > Date.now()) {
      const retryAfter = Math.ceil((lockout.until - Date.now()) / 1000);
      c.header('Retry-After', String(retryAfter));
      return c.json(
        {
          error: {
            code: 'RATE_LIMITED',
            message: 'Too many failed auth attempts. Try again later.',
          },
        },
        429,
      );
    }

    // Identify by hashed auth token or by IP
    const authHeader = c.req.header('Authorization');
    const identifier = authHeader
      ? `key:${crypto.createHash('sha256').update(authHeader).digest('hex').slice(0, 16)}`
      : `ip:${ip}`;

    const storeKey = `${ns}:${identifier}`;
    const now = Date.now();
    let entry = rateLimitStore.get(storeKey);

    if (!entry || entry.resetAt < now) {
      entry = { count: 0, resetAt: now + windowMs };
      rateLimitStore.set(storeKey, entry);
    }

    entry.count++;

    const remaining = Math.max(0, maxRequests - entry.count);
    c.header('X-RateLimit-Limit', String(maxRequests));
    c.header('X-RateLimit-Remaining', String(remaining));
    c.header('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > maxRequests) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      c.header('Retry-After', String(retryAfter));
      return c.json(
        {
          error: {
            code: 'RATE_LIMITED',
            message: `Rate limit exceeded. Try again in ${retryAfter}s.`,
          },
        },
        429,
      );
    }

    await next();

    // Track auth failures for lockout
    if (c.res.status === 401) {
      const failKey = `authfail:${ip}`;
      let failEntry = authFailStore.get(failKey);
      if (!failEntry || failEntry.resetAt < now) {
        failEntry = { count: 0, resetAt: now + 60_000 };
        authFailStore.set(failKey, failEntry);
      }
      failEntry.count++;
      if (failEntry.count >= 5) {
        lockoutStore.set(ip, { until: now + 15 * 60_000 });
        authFailStore.delete(failKey);
      }
    }
  });
}

// Body Size Limit Middleware
// Rejects requests with Content-Length > maxBytes before body parsing.
export interface BodyLimitConfig {
  maxBytes?: number; // default: 2MB
  distilleryMaxChars?: number; // default: 100_000
}

export function bodyLimit(opts: BodyLimitConfig = {}): MiddlewareHandler {
  const maxBytes = opts.maxBytes ?? 2 * 1024 * 1024; // 2MB
  const distilleryMaxChars = opts.distilleryMaxChars ?? 100_000;

  return createMiddleware(async (c, next) => {
    const contentLength = Number(c.req.header('content-length') ?? 0);

    if (contentLength > maxBytes) {
      return c.json(
        { error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body exceeds size limit' } },
        413,
      );
    }

    await next();
  });
}
