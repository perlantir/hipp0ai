import { Hono } from 'hono';
// Auditing strategy: route-level logAudit() calls are used for targeted
// logging of important operations (decision CRUD, compile, validate, etc.).
// Per-request auditMiddleware is intentionally not mounted — it would log
// every GET request which is noisy and provides little value.
import {
  errorHandler,
  authMiddleware,
  corsMiddleware,
  requestTimer,
  requestId,
  securityHeaders,
  rateLimiter,
  bodyLimit,
} from './middleware/index.js';
import { phase3AuthMiddleware, optionalAuth, freeTierOrAuth, isAuthRequired, requireRole } from './auth/middleware.js';
import { costLimiter } from './middleware/cost-limiter.js';
import { registerProjectRoutes } from './routes/projects.js';
import { registerAgentRoutes } from './routes/agents.js';
import { registerDecisionRoutes } from './routes/decisions.js';
import { registerCompileRoutes } from './routes/compile.js';
import { registerDistilleryRoutes } from './routes/distillery.js';
import { registerNotificationRoutes } from './routes/notifications.js';
import { registerContradictionRoutes } from './routes/contradictions.js';
import { registerFeedbackRoutes } from './routes/feedback.js';
import { registerTemplateRoutes } from './routes/templates.js';
import { registerAuditRoutes } from './routes/audit.js';
import { registerStatsRoutes } from './routes/stats.js';
import { registerArtifactRoutes } from './routes/artifacts.js';
import { registerDiscoveryRoutes } from './routes/discovery.js';
import { registerWebhookRoutes } from './routes/webhooks.js';
import { registerExportImportRoutes } from './routes/export-import.js';
import { registerDocsRoutes } from './routes/docs.js';
import { registerTimeTravelRoutes } from './routes/time-travel.js';
import { registerReviewRoutes } from './routes/review.js';
import { registerStatusRoutes } from './routes/status.js';
import { registerPhase2ContradictionRoutes } from './routes/phase2-contradictions.js';
import { registerPhase2EdgeRoutes } from './routes/phase2-edges.js';
import { registerImpactRoutes } from './routes/impact.js';
import { registerSlackConnector } from './connectors/slack.js';
import { registerLinearConnector } from './connectors/linear.js';
import { registerConnectorRoutes } from './routes/connectors.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerApiKeyRoutes } from './routes/api-keys.js';
import { registerAgentKeyRoutes } from './routes/agent-keys.js';
import { registerTeamRoutes } from './routes/team.js';
import { registerAuditLogRoutes } from './routes/audit-log.js';
import { registerBillingRoutes, registerStripeWebhookRoute } from './routes/billing.js';
import { registerDemoRoutes } from './routes/demo.js';
import { registerLinkRoutes } from './routes/links.js';
import { registerOutcomeRoutes } from './routes/outcomes.js';
import { registerPolicyRoutes } from './routes/policies.js';
import { registerDigestRoutes } from './routes/digests.js';
import { registerPatternRoutes } from './routes/patterns.js';
import { registerSharedPatternRoutes } from './routes/shared-patterns.js';
import { registerEvolutionRoutes } from './routes/evolution.js';
import { registerSimulationRoutes } from './routes/simulation.js';
import { registerSessionRoutes } from './routes/sessions.js';
import { registerImportWizardRoutes } from './routes/import-wizard.js';
import { registerCollabRoomRoutes } from './routes/collab-room.js';
import { registerHierarchyRoutes } from './routes/hierarchy.js';
import { registerWingRoutes } from './routes/wings.js';
import { registerCaptureRoutes } from './routes/capture.js';
import { registerHermesRoutes } from './routes/hermes.js';
import { registerPlaygroundRoutes } from './routes/playground.js';
import { registerExecutionRoutes } from './routes/execution.js';
import { registerSkillRoutes } from './routes/skills.js';
import { registerExperimentRoutes } from './routes/experiments.js';
import { registerReflectionRoutes } from './routes/reflection.js';
import { registerInsightRoutes } from './routes/insights.js';
import { registerBranchRoutes } from './routes/branches.js';
import { registerProcedureRoutes } from './routes/procedures.js';
import { registerAnalyticsRoutes } from './routes/analytics.js';
import { registerCollaborationRoutes } from './routes/collaboration.js';
import { registerCostRoutes } from './routes/cost.js';
import { registerEntityRoutes } from './routes/entities.js';

import { tierEnforcement } from './middleware/tierEnforcement.js';
import { getDb } from '@hipp0/core/db/index.js';

const SERVER_START_TIME = Date.now();

export function createApp() {
  const app = new Hono();

  // Global middleware stack
  app.use('*', requestId);
  app.use('*', requestTimer);
  app.use('*', securityHeaders);
  app.use('*', corsMiddleware);
  app.use('*', bodyLimit({ maxBytes: 2 * 1024 * 1024 }));

    // Demo routes: registered BEFORE auth/rate-limiting so they are fully public
  registerDemoRoutes(app);

    // Global rate limiting
  // Unauthenticated: 60/min, Authenticated: 300/min (enforced in middleware)
  app.use('/api/*', rateLimiter({ maxRequests: 100 }));
  app.use('/api/compile', rateLimiter({ maxRequests: 30, windowMs: 60000, namespace: 'compile' }));
  // Cost-budget gate on LLM-heavy routes. Opt-in via HIPP0_COST_LIMITER=true
  // (off by default so local dev and tests don't need a budget set). Runs
  // AFTER rateLimiter so budget checks happen only on requests that cleared
  // the rate limit; project_id is set later by the tenant/auth pipeline.
  app.use('/api/compile', costLimiter);
  app.use('/api/*/distill*', costLimiter);
  app.use(
    '/api/*/distill*',
    rateLimiter({ maxRequests: 10, windowMs: 60000, namespace: 'distill' }),
  );
  app.use(
    '/api/*/decisions',
    rateLimiter({ maxRequests: 60, windowMs: 60000, namespace: 'decisions' }),
  );
  // Rate limit auth endpoints: 10 req/min per IP
  app.use('/api/auth/*', rateLimiter({ maxRequests: 10, windowMs: 60000, namespace: 'auth' }));
  app.onError(errorHandler);

  // Auth middleware
  // When HIPP0_AUTH_REQUIRED=true (default), phase3AuthMiddleware enforces auth.
  // Set HIPP0_AUTH_REQUIRED=false for local development only.
  app.use('/api/*', async (c, next) => {
    const path = c.req.path;

    // Always public (health probes, docs, webhooks, auth)
    if (
      path === '/api/health' ||
      path === '/api/health/ready' ||
      path === '/api/health/live' ||
      path === '/api/docs' ||
      path === '/api/openapi.json' ||
      path.startsWith('/api/auth/') ||
      path.startsWith('/api/team/invite/') ||
      path.startsWith('/api/linear/install') ||
      path.startsWith('/api/linear/callback') ||
      path === '/api/linear/webhook' ||
      path === '/api/webhooks/github' ||
      path === '/api/webhooks/slack/events' ||
      path === '/api/webhooks/slack/commands' ||
      path === '/api/webhooks/stripe'
    ) {
      await next();
      return;
    }

    // /api/compile uses free tier when auth is required
    if (path === '/api/compile') {
      await freeTierOrAuth(c, next);
      return;
    }

    // /api/distill/ask — same free tier logic
    if (path === '/api/distill/ask') {
      await freeTierOrAuth(c, next);
      return;
    }

    // All other /api/* routes
    if (isAuthRequired()) {
      return phase3AuthMiddleware(c, next);
    } else {
      // Dev mode without auth: attach default user and continue
      (c as any).set('user', {
        id: 'anonymous',
        email: '',
        tenant_id: 'a0000000-0000-4000-8000-000000000001',
        role: 'admin',
        plan: 'enterprise',
      });
      await next();
    }
  });

  // Per-request RLS tenant context reset.
  // The pg Pool does not bind a client to a request, so `setProjectContext`
  // lives on the adapter instance. We make sure we wipe it at the end of
  // every request so a context set by request N never leaks into request
  // N+1 (which would otherwise see the previous project's rows).
  app.use('/api/*', async (c, next) => {
    try {
      await next();
    } finally {
      try {
        const db = getDb() as { setProjectContext?: (id: string | null) => void };
        db.setProjectContext?.(null);
      } catch {
        // DB may not be initialised during tests — ignore.
      }
    }
  });

    // Tier enforcement (after auth, before routes)
  app.use('/api/*', tierEnforcement());

  // Health — enhanced with db latency, uptime, version, decision_count
  app.get('/api/health', async (c) => {
    let dbLatencyMs = -1;
    let decisionCount = 0;
    try {
      const db = getDb();
      const start = Date.now();
      await db.query('SELECT 1', []);
      dbLatencyMs = Date.now() - start;
      const countResult = await db.query('SELECT COUNT(*) as c FROM decisions', []);
      decisionCount = parseInt((countResult.rows[0] as Record<string, unknown>)?.c as string ?? '0', 10);
    } catch { /* db unavailable */ }

    // Distillery resilience state (circuit breakers + in-memory queue). Wrapped
    // in try/catch so a misconfigured resilience module never breaks health.
    let distillery: Record<string, unknown> = {
      anthropic_breaker: 'closed',
      openai_breaker: 'closed',
      queued_extractions: 0,
    };
    try {
      const { getDistilleryHealth } = await import('@hipp0/core/intelligence/resilience.js');
      distillery = getDistilleryHealth();
    } catch { /* resilience module unavailable */ }

    return c.json({
      status: 'ok',
      version: '0.3.0',
      timestamp: new Date().toISOString(),
      db_latency_ms: dbLatencyMs,
      uptime_seconds: Math.floor((Date.now() - SERVER_START_TIME) / 1000),
      node_env: process.env.NODE_ENV ?? 'production',
      decision_count: decisionCount,
      distillery,
    });
  });

  // Liveness probe — always 200 (proves process is alive)
  app.get('/api/health/live', (c) => {
    return c.json({ status: 'ok' });
  });

  // Readiness probe — checks DB connection
  app.get('/api/health/ready', async (c) => {
    try {
      const db = getDb();
      await db.query('SELECT 1', []);
      return c.json({ status: 'ready' });
    } catch {
      return c.json({ status: 'not_ready', reason: 'database connection failed' }, 503);
    }
  });

  // Metrics endpoint — operational counters (admin only)
  app.get('/api/metrics', async (c) => {
    if (isAuthRequired()) {
      const user = c.get('user' as never) as { role?: string } | undefined;
      if (!user || (user.role !== 'admin' && user.role !== 'owner')) {
        return c.json({ error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } }, 403);
      }
    }
    try {
      const db = getDb();
      const [decisionsToday, compilesToday, avgCompile] = await Promise.all([
        db.query(
          "SELECT COUNT(*) as c FROM decisions WHERE created_at >= CURRENT_DATE",
          [],
        ).catch(() => ({ rows: [{ c: 0 }] })),
        db.query(
          "SELECT COUNT(*) as c FROM compile_history WHERE compiled_at >= CURRENT_DATE",
          [],
        ).catch(() => ({ rows: [{ c: 0 }] })),
        // Compile timing is persisted in audit_log.details (logAudit 'compile_request')
        db.query(
          "SELECT COALESCE(AVG((details->>'compilation_time_ms')::float), 0) as avg_ms FROM audit_log WHERE event_type = 'compile_request' AND created_at >= CURRENT_DATE",
          [],
        ).catch(() => ({ rows: [{ avg_ms: 0 }] })),
      ]);

      return c.json({
        decisions_today: parseInt((decisionsToday.rows[0] as Record<string, unknown>).c as string ?? '0', 10),
        compiles_today: parseInt((compilesToday.rows[0] as Record<string, unknown>).c as string ?? '0', 10),
        avg_compile_ms: parseFloat((avgCompile.rows[0] as Record<string, unknown>).avg_ms as string ?? '0'),
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  });

    // Auth, Team, API Key, Audit Log routes
  registerAuthRoutes(app);
  registerApiKeyRoutes(app);
  registerAgentKeyRoutes(app);
  registerTeamRoutes(app);
  registerAuditLogRoutes(app);

  // Register route modules
  registerProjectRoutes(app);
  registerAgentRoutes(app);
  registerDecisionRoutes(app);
  registerCompileRoutes(app);
  registerDistilleryRoutes(app);
  registerNotificationRoutes(app);
  registerContradictionRoutes(app);
  registerFeedbackRoutes(app);
  registerTemplateRoutes(app);
  registerAuditRoutes(app);
  registerStatsRoutes(app);
  registerArtifactRoutes(app);
  registerDiscoveryRoutes(app);
  registerWebhookRoutes(app);
  registerExportImportRoutes(app);
  registerDocsRoutes(app);
  registerTimeTravelRoutes(app);
  registerReviewRoutes(app);
  registerStatusRoutes(app);
  registerPhase2ContradictionRoutes(app);
  registerPhase2EdgeRoutes(app);
  registerImpactRoutes(app);
  registerOutcomeRoutes(app);
  registerSlackConnector(app);
  registerLinkRoutes(app);
  registerLinearConnector(app);
  registerConnectorRoutes(app);

    // Governance: policy & violation management
  registerPolicyRoutes(app);
  registerDigestRoutes(app);
  registerPatternRoutes(app);
  registerSharedPatternRoutes(app);
  registerEvolutionRoutes(app);
  registerSimulationRoutes(app);
  registerSessionRoutes(app);
  registerImportWizardRoutes(app);
  registerCollabRoomRoutes(app);
  registerHierarchyRoutes(app);
  registerWingRoutes(app);
  registerCaptureRoutes(app);
  registerHermesRoutes(app);
  if (process.env.HIPP0_PLAYGROUND_ENABLED === "true") {
    registerPlaygroundRoutes(app);
  }
  registerExecutionRoutes(app);
  registerSkillRoutes(app);
  registerExperimentRoutes(app);
  registerReflectionRoutes(app);
  registerInsightRoutes(app);
  registerBranchRoutes(app);
  registerProcedureRoutes(app);
  registerAnalyticsRoutes(app);
  registerCollaborationRoutes(app);
  registerCostRoutes(app);
  registerEntityRoutes(app);

    // Billing + Stripe webhook
  registerBillingRoutes(app);
  registerStripeWebhookRoute(app);

    // Flat route aliases for /api/decisions
  // Docs imply /api/decisions but the real route is /api/projects/:id/decisions.
  // These aliases read project_id from body/query and proxy to the scoped route.
  app.post('/api/decisions', async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const projectId = body.project_id as string | undefined;
    if (!projectId) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'project_id is required in the request body' } }, 400);
    }
    // Re-dispatch to the project-scoped route
    const url = new URL(c.req.url);
    url.pathname = `/api/projects/${projectId}/decisions`;
    const newReq = new Request(url.toString(), {
      method: 'POST',
      headers: c.req.raw.headers,
      body: JSON.stringify(body),
    });
    return app.fetch(newReq, c.env);
  });

  app.get('/api/decisions', async (c) => {
    const projectId = c.req.query('project_id');
    if (!projectId) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'project_id query parameter is required' } }, 400);
    }
    // Re-dispatch to the project-scoped route
    const url = new URL(c.req.url);
    url.pathname = `/api/projects/${projectId}/decisions`;
    url.searchParams.delete('project_id');
    const newReq = new Request(url.toString(), {
      method: 'GET',
      headers: c.req.raw.headers,
    });
    return app.fetch(newReq, c.env);
  });

  return app;
}

export default createApp();
