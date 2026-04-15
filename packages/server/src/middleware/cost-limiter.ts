/**
 * Per-project daily cost ceiling middleware.
 *
 * Consults `checkBudget` from the core cost-tracker before allowing a
 * request to proceed on LLM-heavy routes (compile, distillery). If the
 * project is over its daily cap, returns 429 with retry-after set to the
 * start of the next UTC day. The counter itself is incremented in the
 * cost-tracker's recordLLMCall path — this middleware only *gates*.
 *
 * Activation is opt-in per-route: mount via `.use('/compile/*', costLimiter)`
 * rather than globally, so cheap read endpoints aren't gated on LLM budget.
 */

import type { Context, Next } from 'hono';
import { createMiddleware } from 'hono/factory';
import { checkBudget } from '@hipp0/core/intelligence/cost-tracker.js';

type CostLimiterVars = { project_id?: string };

function secondsUntilNextUtcMidnight(): number {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return Math.max(1, Math.floor((next.getTime() - now.getTime()) / 1000));
}

export const costLimiter = createMiddleware(async (c: Context<{ Variables: CostLimiterVars }>, next: Next) => {
  // Disabled globally in dev/test unless the env var is set true.
  if (process.env.HIPP0_COST_LIMITER !== 'true') {
    return next();
  }

  // project_id should already be set by tenant-context middleware. If not,
  // this route isn't project-scoped and cost gating doesn't apply.
  const projectId = c.get('project_id');
  if (!projectId) return next();

  let status;
  try {
    status = await checkBudget(projectId);
  } catch (err) {
    // Fail-open: budget subsystem failure must not block the request path.
    // Errors are logged by the tracker; we just proceed.
    return next();
  }

  if (!status.allowed) {
    const retryAfter = secondsUntilNextUtcMidnight();
    c.header('Retry-After', String(retryAfter));
    return c.json(
      {
        error: 'cost_budget_exceeded',
        message: status.reason ?? 'Daily cost budget exceeded for this project',
        cap_usd: status.cap_usd,
        spent_today_usd: status.spent_today_usd,
        cap_source: status.cap_source,
        retry_after_seconds: retryAfter,
      },
      429,
    );
  }

  return next();
});
