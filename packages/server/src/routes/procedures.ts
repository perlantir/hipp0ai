/**
 * Team Procedures Routes
 *
 * GET  /api/projects/:id/procedures            — list extracted procedures
 * POST /api/projects/:id/procedures/extract    — run extraction now
 * GET  /api/projects/:id/procedures/suggest    — suggest matching procedure
 * POST /api/projects/:id/procedures/:procedureId/executions — record execution outcome
 */
import type { Hono } from 'hono';
import { ValidationError } from '@hipp0/core/types.js';
import {
  extractTeamProcedures,
  listTeamProcedures,
  getMatchingProcedure,
  recordProcedureExecution,
} from '@hipp0/core/intelligence/team-procedures.js';
import type { ProcedureOutcome } from '@hipp0/core/intelligence/team-procedures.js';
import { requireUUID, logAudit } from './validation.js';
import { requireProjectAccess } from './_helpers.js';

const VALID_OUTCOMES: ProcedureOutcome[] = ['success', 'failure', 'partial'];

export function registerProcedureRoutes(app: Hono): void {
  // GET /api/projects/:id/procedures
  app.get('/api/projects/:id/procedures', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);

    const procedures = await listTeamProcedures(projectId);
    return c.json({ procedures, count: procedures.length });
  });

  // POST /api/projects/:id/procedures/extract
  app.post('/api/projects/:id/procedures/extract', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);

    const started = Date.now();
    const procedures = await extractTeamProcedures(projectId);
    const durationMs = Date.now() - started;

    logAudit('team_procedures_extract', projectId, {
      count: procedures.length,
      duration_ms: durationMs,
    });

    return c.json({
      procedures,
      count: procedures.length,
      duration_ms: durationMs,
    });
  });

  // GET /api/projects/:id/procedures/suggest?task=...&tags=a,b,c
  app.get('/api/projects/:id/procedures/suggest', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);

    const task = c.req.query('task');
    if (!task || task.trim().length === 0) {
      throw new ValidationError('task query parameter is required');
    }
    if (task.length > 2000) {
      throw new ValidationError('task exceeds maximum length of 2000');
    }

    const tagsRaw = c.req.query('tags');
    const tags = tagsRaw
      ? tagsRaw.split(',').map((t) => t.trim()).filter(Boolean)
      : [];

    const match = await getMatchingProcedure(projectId, task, tags);
    if (!match) {
      return c.json({ match: null, message: 'No matching procedure found' });
    }
    return c.json({ match });
  });

  // POST /api/projects/:id/procedures/:procedureId/executions
  app.post('/api/projects/:id/procedures/:procedureId/executions', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);
    const procedureId = requireUUID(c.req.param('procedureId'), 'procedureId');

    const body = await c.req.json<Record<string, unknown>>();
    const outcome = body.outcome;
    if (typeof outcome !== 'string' || !VALID_OUTCOMES.includes(outcome as ProcedureOutcome)) {
      throw new ValidationError(
        `outcome must be one of: ${VALID_OUTCOMES.join(', ')}`,
      );
    }

    const updated = await recordProcedureExecution(
      projectId,
      procedureId,
      outcome as ProcedureOutcome,
    );
    if (!updated) {
      return c.json(
        { error: { code: 'NOT_FOUND', message: 'Procedure not found' } },
        404,
      );
    }

    logAudit('team_procedure_execution_recorded', projectId, {
      procedure_id: procedureId,
      outcome,
    });

    return c.json({ procedure: updated });
  });
}
