/**
 * Cost & Budget Routes
 *
 *   GET  /api/projects/:id/cost/usage              — today's usage + rollup
 *   GET  /api/projects/:id/cost/history?days=30    — time-series for charts
 *   GET  /api/projects/:id/cost/budget             — current budget status
 *   PUT  /api/projects/:id/cost/budget             — set / clear budget cap
 *
 * Backed by the cost-tracker module in @hipp0/core, which records every
 * LLM call the distillery makes and enforces per-project daily caps.
 */
import type { Hono } from 'hono';
import { ValidationError } from '@hipp0/core/types.js';
import {
  getDailyUsage,
  getProjectUsage,
  getUsageHistory,
  checkBudget,
  setProjectBudget,
} from '@hipp0/core/intelligence/cost-tracker.js';
import { requireUUID, logAudit } from './validation.js';
import { requireProjectAccess } from './_helpers.js';

export function registerCostRoutes(app: Hono): void {
  /* ============================================================== */
  /*  USAGE                                                           */
  /* ============================================================== */

  // GET /api/projects/:id/cost/usage
  //   Returns today's usage summary plus the previous-24h figure for a
  //   quick trend comparison.
  app.get('/api/projects/:id/cost/usage', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);

    const today = new Date().toISOString().slice(0, 10);
    const yesterdayDate = new Date();
    yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
    const yesterday = yesterdayDate.toISOString().slice(0, 10);

    const [todayUsage, yesterdayUsage, weekUsage, monthUsage] = await Promise.all([
      getDailyUsage(projectId, today),
      getDailyUsage(projectId, yesterday),
      getProjectUsage(projectId, { window: 'weekly' }),
      getProjectUsage(projectId, { window: 'monthly' }),
    ]);

    const trendPct =
      yesterdayUsage.total_cost_usd > 0
        ? ((todayUsage.total_cost_usd - yesterdayUsage.total_cost_usd) /
            yesterdayUsage.total_cost_usd) *
          100
        : todayUsage.total_cost_usd > 0
          ? 100
          : 0;

    return c.json({
      today: todayUsage,
      yesterday: yesterdayUsage,
      week: weekUsage,
      month: monthUsage,
      trend_pct: Math.round(trendPct * 100) / 100,
    });
  });

  // GET /api/projects/:id/cost/history?days=30
  //   Per-day cost + token counts for the last N calendar days, most recent
  //   first. Missing days are zero-filled.
  app.get('/api/projects/:id/cost/history', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);

    const daysRaw = c.req.query('days');
    const days = daysRaw ? parseInt(daysRaw, 10) : 30;
    if (daysRaw && (!Number.isFinite(days) || days < 1 || days > 365)) {
      throw new ValidationError('days must be an integer between 1 and 365');
    }

    const series = await getUsageHistory(projectId, days);
    const totalCost = series.reduce((acc: number, d) => acc + d.cost_usd, 0);
    const totalCalls = series.reduce((acc: number, d) => acc + d.call_count, 0);
    return c.json({
      days,
      series,
      total_cost_usd: Math.round(totalCost * 1e6) / 1e6,
      total_calls: totalCalls,
    });
  });

  /* ============================================================== */
  /*  BUDGET                                                          */
  /* ============================================================== */

  // GET /api/projects/:id/cost/budget
  //   Returns the current budget status: cap (if any), spent today,
  //   remaining, and the source (project metadata vs env var).
  app.get('/api/projects/:id/cost/budget', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);

    const status = await checkBudget(projectId);
    // JSON.stringify replaces Infinity with null, so normalise to a string
    // that clients can detect explicitly.
    const remaining = Number.isFinite(status.remaining_usd) ? status.remaining_usd : null;
    return c.json({
      ...status,
      remaining_usd: remaining,
      unlimited: status.cap_usd === null,
    });
  });

  // PUT /api/projects/:id/cost/budget
  //   Body:
  //     { daily_usd: 10 }           — set a $10/day cap
  //     { daily_usd: null }         — clear the project's cap (fall back to env)
  //     { per_operation: {...} }    — (optional) per-operation caps
  app.put('/api/projects/:id/cost/budget', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);

    const body = await c.req.json<Record<string, unknown>>();

    // Allow explicit null to clear the cap entirely.
    if (body.clear === true || (body.daily_usd === null && body.per_operation === undefined)) {
      await setProjectBudget(projectId, null);
      logAudit('cost_budget_cleared', projectId, {});
      const status = await checkBudget(projectId);
      return c.json({
        cleared: true,
        budget: { daily_usd: null },
        status: {
          ...status,
          remaining_usd: Number.isFinite(status.remaining_usd) ? status.remaining_usd : null,
        },
      });
    }

    let dailyUsd: number | null | undefined = undefined;
    if (body.daily_usd === null) {
      dailyUsd = null;
    } else if (typeof body.daily_usd === 'number') {
      if (!Number.isFinite(body.daily_usd) || body.daily_usd < 0) {
        throw new ValidationError('daily_usd must be a non-negative number');
      }
      dailyUsd = body.daily_usd;
    } else if (typeof body.daily_usd === 'string' && body.daily_usd.length > 0) {
      const parsed = parseFloat(body.daily_usd);
      if (!Number.isFinite(parsed) || parsed < 0) {
        throw new ValidationError('daily_usd must be a non-negative number');
      }
      dailyUsd = parsed;
    }

    let perOperation: Record<string, number> | undefined = undefined;
    if (body.per_operation && typeof body.per_operation === 'object') {
      perOperation = {};
      for (const [k, v] of Object.entries(body.per_operation as Record<string, unknown>)) {
        const n = typeof v === 'number' ? v : parseFloat(String(v));
        if (!Number.isFinite(n) || n < 0) {
          throw new ValidationError(`per_operation.${k} must be a non-negative number`);
        }
        perOperation[k] = n;
      }
    }

    if (dailyUsd === undefined && perOperation === undefined) {
      throw new ValidationError('Provide daily_usd or per_operation to update budget');
    }

    const config = {
      ...(dailyUsd !== undefined ? { daily_usd: dailyUsd } : {}),
      ...(perOperation !== undefined ? { per_operation: perOperation } : {}),
    };
    await setProjectBudget(projectId, config);

    logAudit('cost_budget_updated', projectId, {
      daily_usd: dailyUsd ?? null,
      per_operation_keys: perOperation ? Object.keys(perOperation) : [],
    });

    const status = await checkBudget(projectId);
    return c.json({
      budget: config,
      status: {
        ...status,
        remaining_usd: Number.isFinite(status.remaining_usd) ? status.remaining_usd : null,
      },
    });
  });
}
