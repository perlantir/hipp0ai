/**
 * Reflection & Trace Routes
 *
 * POST /api/projects/:id/reflect      — trigger reflection (hourly/daily/weekly)
 * GET  /api/projects/:id/reflections  — list past reflection runs
 * POST /api/projects/:id/traces       — record an agent trace
 * GET  /api/projects/:id/traces       — query traces
 * POST /api/projects/:id/traces/distill — distill recent traces into candidates
 */
import type { Hono } from 'hono';
import { ValidationError } from '@hipp0/core/types.js';
import {
  runHourlyReflection,
  runDailyReflection,
  runWeeklyReflection,
  getReflectionHistory,
} from '@hipp0/core/intelligence/reflection-engine.js';
import {
  recordTrace,
  getRecentTraces,
  distillTraces,
} from '@hipp0/core/intelligence/trace-collector.js';
import type {
  TraceType,
  GetTracesOptions,
} from '@hipp0/core/intelligence/trace-collector.js';
import type { ReflectionType } from '@hipp0/core/intelligence/reflection-engine.js';
import { requireUUID, requireString } from './validation.js';
import { requireProjectAccess } from './_helpers.js';
import { safeEmit } from '../events/event-stream.js';
import {
  getSchedulerStatus,
  runScheduledReflections,
} from '../jobs/reflection-scheduler.js';
import { getMetrics, recordCounter } from '../telemetry.js';

const VALID_REFLECTION_TYPES: ReflectionType[] = ['hourly', 'daily', 'weekly'];
const VALID_TRACE_TYPES: TraceType[] = [
  'tool_call',
  'api_response',
  'error',
  'observation',
  'artifact_created',
  'code_change',
];

export function registerReflectionRoutes(app: Hono): void {
  // ---------------------------------------------------------------------
  // POST /api/projects/:id/reflect
  // ---------------------------------------------------------------------
  app.post('/api/projects/:id/reflect', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);

    const body = await c
      .req
      .json<Record<string, unknown>>()
      .catch(() => ({} as Record<string, unknown>));

    const typeRaw = (body.type as string | undefined) ?? 'hourly';
    if (!VALID_REFLECTION_TYPES.includes(typeRaw as ReflectionType)) {
      throw new ValidationError(
        `type must be one of: ${VALID_REFLECTION_TYPES.join(', ')}`,
      );
    }
    const type = typeRaw as ReflectionType;

    let results: unknown;
    switch (type) {
      case 'hourly':
        results = await runHourlyReflection(projectId);
        break;
      case 'daily':
        results = await runDailyReflection(projectId);
        break;
      case 'weekly':
        results = await runWeeklyReflection(projectId);
        break;
    }

    safeEmit('reflection.completed', projectId, {
      type,
      summary:
        typeof results === 'object' && results !== null
          ? (results as Record<string, unknown>)
          : {},
    });

    try {
      const __m = getMetrics();
      recordCounter(__m.reflectionsRun, 1, {
        project_id: projectId,
        reflection_type: type,
      });
    } catch { /* ignore */ }

    return c.json({ type, results }, 200);
  });

  // ---------------------------------------------------------------------
  // GET /api/projects/:id/reflections
  // ---------------------------------------------------------------------
  app.get('/api/projects/:id/reflections', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);

    const limitParam = c.req.query('limit');
    const limit = limitParam ? parseInt(limitParam, 10) : 50;
    if (Number.isNaN(limit) || limit < 1) {
      throw new ValidationError('limit must be a positive integer');
    }

    const history = await getReflectionHistory(projectId, limit);
    return c.json({ reflections: history });
  });

  // ---------------------------------------------------------------------
  // POST /api/projects/:id/traces
  // ---------------------------------------------------------------------
  app.post('/api/projects/:id/traces', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);

    const body = await c.req.json<Record<string, unknown>>();
    const agentName = requireString(body.agent_name, 'agent_name', 200);
    const traceTypeRaw = requireString(body.trace_type, 'trace_type', 50);
    if (!VALID_TRACE_TYPES.includes(traceTypeRaw as TraceType)) {
      throw new ValidationError(
        `trace_type must be one of: ${VALID_TRACE_TYPES.join(', ')}`,
      );
    }
    const content = requireString(body.content, 'content', 20000);

    let metadata: Record<string, unknown> | undefined;
    if (body.metadata !== undefined && body.metadata !== null) {
      if (typeof body.metadata !== 'object' || Array.isArray(body.metadata)) {
        throw new ValidationError('metadata must be an object');
      }
      metadata = body.metadata as Record<string, unknown>;
    }

    const source =
      typeof body.source === 'string' && body.source.trim().length > 0
        ? body.source.trim().slice(0, 200)
        : undefined;

    const record = await recordTrace(projectId, {
      agent_name: agentName,
      trace_type: traceTypeRaw as TraceType,
      content,
      metadata,
      source,
    });

    return c.json(record, 201);
  });

  // ---------------------------------------------------------------------
  // GET /api/projects/:id/traces
  // ---------------------------------------------------------------------
  app.get('/api/projects/:id/traces', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);

    const options: GetTracesOptions = {};
    const agentName = c.req.query('agent_name');
    if (agentName) options.agent_name = agentName;

    const traceType = c.req.query('trace_type');
    if (traceType) {
      if (!VALID_TRACE_TYPES.includes(traceType as TraceType)) {
        throw new ValidationError(
          `trace_type must be one of: ${VALID_TRACE_TYPES.join(', ')}`,
        );
      }
      options.trace_type = traceType as TraceType;
    }

    const since = c.req.query('since');
    if (since) options.since = since;
    const until = c.req.query('until');
    if (until) options.until = until;

    const limitParam = c.req.query('limit');
    if (limitParam) {
      const limit = parseInt(limitParam, 10);
      if (Number.isNaN(limit) || limit < 1) {
        throw new ValidationError('limit must be a positive integer');
      }
      options.limit = limit;
    }

    const traces = await getRecentTraces(projectId, options);
    return c.json({ traces });
  });

  // ---------------------------------------------------------------------
  // POST /api/projects/:id/traces/distill
  // ---------------------------------------------------------------------
  app.post('/api/projects/:id/traces/distill', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);

    const body = await c
      .req
      .json<Record<string, unknown>>()
      .catch(() => ({} as Record<string, unknown>));
    const since =
      typeof body.since === 'string' ? body.since : undefined;

    const candidates = await distillTraces(projectId, since);
    return c.json({ candidates });
  });

  // ---------------------------------------------------------------------
  // GET /api/scheduler/status
  // ---------------------------------------------------------------------
  app.get('/api/scheduler/status', (c) => {
    return c.json(getSchedulerStatus());
  });

  // ---------------------------------------------------------------------
  // POST /api/scheduler/trigger
  // ---------------------------------------------------------------------
  // Manually runs the scheduler loop once. Useful for testing and for
  // forcing a sweep without waiting for the next tick. Runs synchronously
  // so the caller gets a summary of what was dispatched.
  app.post('/api/scheduler/trigger', async (c) => {
    const summary = await runScheduledReflections();
    return c.json({
      triggered: true,
      ...summary,
      status: getSchedulerStatus(),
    });
  });
}
