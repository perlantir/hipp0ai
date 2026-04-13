/**
 * Tier Enforcement Middleware — checks resource limits based on tenant plan.
 *
 * Limits per tier:
 * - Free:       1 project, 100 decisions, 3 agents, 50 compile/day, 10 ask/day, no integrations
 * - Pro:        unlimited projects, 10K decisions, unlimited agents, 1000 compile/day, 100 ask/day, all integrations
 * - Enterprise: unlimited everything, API priority
 *
 * Usage counters stored in daily_usage table (reset daily by date).
 * At 80%: X-Usage-Warning header
 * At 100%: 429 with upgrade message (soft block)
 */
import type { MiddlewareHandler } from 'hono';
import { createMiddleware } from 'hono/factory';
import { getDb } from '@hipp0/core/db/index.js';
import type { AuthUser } from '../auth/middleware.js';

  // Tier limits

interface TierLimits {
  max_projects: number;
  max_decisions: number;
  max_agents: number;
  daily_compiles: number;
  daily_asks: number;
  integrations_enabled: boolean;
}

const TIER_LIMITS: Record<string, TierLimits> = {
  free: {
    max_projects: 1,
    max_decisions: 100,
    max_agents: 3,
    daily_compiles: 50,
    daily_asks: 10,
    integrations_enabled: false,
  },
  pro: {
    max_projects: Infinity,
    max_decisions: 10_000,
    max_agents: Infinity,
    daily_compiles: 1_000,
    daily_asks: 100,
    integrations_enabled: true,
  },
  enterprise: {
    max_projects: Infinity,
    max_decisions: Infinity,
    max_agents: Infinity,
    daily_compiles: Infinity,
    daily_asks: Infinity,
    integrations_enabled: true,
  },
};

function getLimits(plan: string): TierLimits {
  return TIER_LIMITS[plan] ?? TIER_LIMITS.free;
}

  // Upsert daily usage row

async function getOrCreateDailyUsage(tenantId: string): Promise<{ compiles_count: number; ask_count: number; decisions_count: number }> {
  const db = getDb();

  // Try to get existing row
  const result = await db.query(
    'SELECT compiles_count, ask_count, decisions_count FROM daily_usage WHERE tenant_id = ? AND date = CURRENT_DATE',
    [tenantId],
  );

  if (result.rows.length > 0) {
    const row = result.rows[0] as Record<string, unknown>;
    return {
      compiles_count: Number(row.compiles_count),
      ask_count: Number(row.ask_count),
      decisions_count: Number(row.decisions_count),
    };
  }

  // Create new row for today
  await db.query(
    `INSERT INTO daily_usage (tenant_id, date, compiles_count, ask_count, decisions_count)
     VALUES (?, CURRENT_DATE, 0, 0, 0)
     ON CONFLICT (tenant_id, date) DO NOTHING`,
    [tenantId],
  );

  return { compiles_count: 0, ask_count: 0, decisions_count: 0 };
}

async function incrementUsage(tenantId: string, field: 'compiles_count' | 'ask_count' | 'decisions_count'): Promise<void> {
  const db = getDb();
  await db.query(
    `INSERT INTO daily_usage (tenant_id, date, ${field})
     VALUES (?, CURRENT_DATE, 1)
     ON CONFLICT (tenant_id, date)
     DO UPDATE SET ${field} = daily_usage.${field} + 1, updated_at = NOW()`,
    [tenantId],
  );
}

  // Detect resource type from route

type ResourceAction = 'compile' | 'ask' | 'create_decision' | 'create_project' | 'create_agent' | 'integration' | 'none';

function detectAction(method: string, path: string): ResourceAction {
  if (method === 'POST' && path === '/api/compile') return 'compile';
  if (method === 'POST' && (path === '/api/distill/ask' || path.endsWith('/ask'))) return 'ask';
  if (method === 'POST' && path.match(/^\/api\/projects\/[^/]+\/decisions$/)) return 'create_decision';
  if (method === 'POST' && path === '/api/projects') return 'create_project';
  if (method === 'POST' && path.match(/^\/api\/projects\/[^/]+\/agents$/)) return 'create_agent';

  // Integration routes
  if (path.startsWith('/api/connectors') || path.startsWith('/api/webhooks/slack') || path.startsWith('/api/webhooks/github')) {
    if (method !== 'GET') return 'integration';
  }

  return 'none';
}

  // Middleware factory

export function tierEnforcement(): MiddlewareHandler {
  return createMiddleware(async (c, next) => {
    const user = c.get('user') as AuthUser | undefined;
    if (!user) {
      // No user context — skip enforcement (auth middleware handles this)
      await next();
      return;
    }

    const plan = user.plan ?? 'free';
    const limits = getLimits(plan);
    const tenantId = user.tenant_id;
    const action = detectAction(c.req.method, c.req.path);

    // Enterprise: no limits, skip all checks
    if (plan === 'enterprise' || action === 'none') {
      await next();
      return;
    }

    const db = getDb();

    switch (action) {
      case 'compile': {
        const usage = await getOrCreateDailyUsage(tenantId);
        const current = usage.compiles_count;
        const limit = limits.daily_compiles;

        // Warn at 80%
        if (current >= limit * 0.8 && current < limit) {
          c.header('X-Usage-Warning', `Compile usage at ${Math.round((current / limit) * 100)}% (${current}/${limit})`);
        }

        // Soft block at 100%
        if (current >= limit) {
          return c.json({
            error: {
              code: 'TIER_LIMIT_EXCEEDED',
              message: `Daily compile limit reached (${limit}/day on ${plan} plan). Upgrade for more compiles.`,
              upgrade_url: '/#pricing',
            },
          }, 429);
        }

        // Increment after check (will be counted for this request)
        await incrementUsage(tenantId, 'compiles_count');
        break;
      }

      case 'ask': {
        const usage = await getOrCreateDailyUsage(tenantId);
        const current = usage.ask_count;
        const limit = limits.daily_asks;

        if (current >= limit * 0.8 && current < limit) {
          c.header('X-Usage-Warning', `Ask usage at ${Math.round((current / limit) * 100)}% (${current}/${limit})`);
        }

        if (current >= limit) {
          return c.json({
            error: {
              code: 'TIER_LIMIT_EXCEEDED',
              message: `Daily Ask Anything limit reached (${limit}/day on ${plan} plan). Upgrade for more.`,
              upgrade_url: '/#pricing',
            },
          }, 429);
        }

        await incrementUsage(tenantId, 'ask_count');
        break;
      }

      case 'create_decision': {
        // Check total decisions for tenant
        const countResult = await db.query(
          'SELECT COUNT(*) as total FROM decisions WHERE tenant_id = ?',
          [tenantId],
        );
        const total = Number((countResult.rows[0] as Record<string, unknown>)?.total ?? 0);

        if (total >= limits.max_decisions * 0.8 && total < limits.max_decisions) {
          c.header('X-Usage-Warning', `Decision count at ${Math.round((total / limits.max_decisions) * 100)}% (${total}/${limits.max_decisions})`);
        }

        if (total >= limits.max_decisions) {
          return c.json({
            error: {
              code: 'TIER_LIMIT_EXCEEDED',
              message: `Decision limit reached (${limits.max_decisions} on ${plan} plan). Upgrade for more decisions.`,
              upgrade_url: '/#pricing',
            },
          }, 429);
        }

        await incrementUsage(tenantId, 'decisions_count');
        break;
      }

      case 'create_project': {
        const countResult = await db.query('SELECT COUNT(*) as total FROM projects', []);
        const total = Number((countResult.rows[0] as Record<string, unknown>)?.total ?? 0);

        if (total >= limits.max_projects) {
          return c.json({
            error: {
              code: 'TIER_LIMIT_EXCEEDED',
              message: `Project limit reached (${limits.max_projects} on ${plan} plan). Upgrade for unlimited projects.`,
              upgrade_url: '/#pricing',
            },
          }, 429);
        }
        break;
      }

      case 'create_agent': {
        const countResult = await db.query('SELECT COUNT(DISTINCT name) as total FROM agents', []);
        const total = Number((countResult.rows[0] as Record<string, unknown>)?.total ?? 0);

        if (total >= limits.max_agents) {
          return c.json({
            error: {
              code: 'TIER_LIMIT_EXCEEDED',
              message: `Agent limit reached (${limits.max_agents} on ${plan} plan). Upgrade for unlimited agents.`,
              upgrade_url: '/#pricing',
            },
          }, 429);
        }
        break;
      }

      case 'integration': {
        if (!limits.integrations_enabled) {
          return c.json({
            error: {
              code: 'TIER_LIMIT_EXCEEDED',
              message: 'Integrations are not available on the free plan. Upgrade to Pro for full integration support.',
              upgrade_url: '/#pricing',
            },
          }, 429);
        }
        break;
      }
    }

    await next();
  });
}

// Export limits for use in other modules (e.g., pricing page data)
export { TIER_LIMITS };
export type { TierLimits };
