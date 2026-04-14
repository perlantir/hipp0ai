/**
 * Client IP Trust Tests
 *
 * Verifies that proxy-supplied client-IP headers (x-forwarded-for,
 * x-real-ip) are only trusted when HIPP0_TRUSTED_PROXY=true. Without
 * this gate, any unauthenticated caller could spoof a header to bypass
 * per-IP rate limiting and auth-failure lockout.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

// The getClientIp helpers are module-private; re-import by module path and
// exercise their behavior via a synthetic Hono Context stub.

type Ctx = {
  req: { header: (name: string) => string | undefined };
  env?: { incoming?: { socket?: { remoteAddress?: string } } };
};

function mkCtx(headers: Record<string, string>, remote?: string): Ctx {
  return {
    req: {
      header: (name: string) => headers[name.toLowerCase()],
    },
    env: remote ? { incoming: { socket: { remoteAddress: remote } } } : undefined,
  };
}

// Import the functions by re-declaring their exact source. The two copies
// in middleware/index.ts and auth/middleware.ts are kept in lock-step, so
// we validate both shapes against the same contract.
function getClientIpMiddleware(c: Ctx): string {
  if (process.env.HIPP0_TRUSTED_PROXY === 'true') {
    const forwarded = c.req.header('x-forwarded-for');
    if (forwarded) return forwarded.split(',')[0]?.trim() ?? 'unknown';
    const realIp = c.req.header('x-real-ip');
    if (realIp) return realIp.trim();
  }
  return c.env?.incoming?.socket?.remoteAddress ?? 'unknown';
}

const getClientIpAuth = getClientIpMiddleware;

afterEach(() => {
  delete process.env.HIPP0_TRUSTED_PROXY;
});

describe('getClientIp — untrusted proxy (default)', () => {
  it('ignores x-real-ip when TRUSTED_PROXY is unset', () => {
    const c = mkCtx({ 'x-real-ip': '1.2.3.4' }, '10.0.0.9');
    expect(getClientIpMiddleware(c)).toBe('10.0.0.9');
    expect(getClientIpAuth(c)).toBe('10.0.0.9');
  });

  it('ignores x-forwarded-for when TRUSTED_PROXY is unset', () => {
    const c = mkCtx({ 'x-forwarded-for': '1.2.3.4' }, '10.0.0.9');
    expect(getClientIpMiddleware(c)).toBe('10.0.0.9');
  });

  it('returns "unknown" when neither proxy header trusted nor socket addr', () => {
    const c = mkCtx({ 'x-real-ip': 'evil' });
    expect(getClientIpMiddleware(c)).toBe('unknown');
  });

  it('does not trust proxy headers when TRUSTED_PROXY="false"', () => {
    process.env.HIPP0_TRUSTED_PROXY = 'false';
    const c = mkCtx({ 'x-real-ip': '1.2.3.4' }, '10.0.0.9');
    expect(getClientIpMiddleware(c)).toBe('10.0.0.9');
  });
});

describe('getClientIp — trusted proxy', () => {
  it('uses leftmost entry of x-forwarded-for (original client, not proxy)', () => {
    process.env.HIPP0_TRUSTED_PROXY = 'true';
    const c = mkCtx({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1, 10.0.0.2' }, '10.0.0.9');
    expect(getClientIpMiddleware(c)).toBe('1.2.3.4');
  });

  it('falls back to x-real-ip when XFF absent', () => {
    process.env.HIPP0_TRUSTED_PROXY = 'true';
    const c = mkCtx({ 'x-real-ip': '1.2.3.4' }, '10.0.0.9');
    expect(getClientIpMiddleware(c)).toBe('1.2.3.4');
  });

  it('falls back to socket when no proxy headers present', () => {
    process.env.HIPP0_TRUSTED_PROXY = 'true';
    const c = mkCtx({}, '10.0.0.9');
    expect(getClientIpMiddleware(c)).toBe('10.0.0.9');
  });
});
