/**
 * A/B Testing Experiment Routes
 *
 * POST /api/projects/:id/experiments           — create experiment
 * GET  /api/projects/:id/experiments           — list experiments
 * GET  /api/projects/:id/experiments/:experimentId — get results
 * POST /api/projects/:id/experiments/:experimentId/resolve — resolve experiment
 */
import type { Hono } from 'hono';
import { ValidationError, NotFoundError } from '@hipp0/core/types.js';
import {
  createExperiment,
  getExperiments,
  getExperimentResults,
  resolveExperiment,
} from '@hipp0/core/intelligence/ab-testing.js';
import { requireUUID, requireString } from './validation.js';
import { requireProjectAccess } from './_helpers.js';
import { safeEmit } from '../events/event-stream.js';
import { withSpan } from '../telemetry.js';

export function registerExperimentRoutes(app: Hono): void {
  // Create experiment
  app.post('/api/projects/:id/experiments', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);

    const body = await c.req.json<Record<string, unknown>>();
    const name = requireString(body.name, 'name', 500);
    const decisionAId = requireUUID(body.decision_a_id, 'decision_a_id');
    const decisionBId = requireUUID(body.decision_b_id, 'decision_b_id');

    if (decisionAId === decisionBId) {
      throw new ValidationError('decision_a_id and decision_b_id must be different');
    }

    const trafficSplit = body.traffic_split != null ? Number(body.traffic_split) : undefined;
    if (trafficSplit !== undefined && (isNaN(trafficSplit) || trafficSplit < 0 || trafficSplit > 1)) {
      throw new ValidationError('traffic_split must be a number between 0 and 1');
    }

    const durationDays = body.duration_days != null ? Number(body.duration_days) : undefined;
    if (durationDays !== undefined && (isNaN(durationDays) || durationDays < 1)) {
      throw new ValidationError('duration_days must be a positive number');
    }

    const experiment = await createExperiment(projectId, {
      name,
      decision_a_id: decisionAId,
      decision_b_id: decisionBId,
      traffic_split: trafficSplit,
      duration_days: durationDays,
    });

    safeEmit('experiment.started', projectId, {
      experiment_id: (experiment as unknown as Record<string, unknown>).id,
      name,
      decision_a_id: decisionAId,
      decision_b_id: decisionBId,
      traffic_split: trafficSplit,
      duration_days: durationDays,
    });

    return c.json(experiment, 201);
  });

  // List experiments for project
  app.get('/api/projects/:id/experiments', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);

    const experiments = await getExperiments(projectId);
    return c.json({ experiments });
  });

  // Get experiment results
  app.get('/api/projects/:id/experiments/:experimentId', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);
    const experimentId = requireUUID(c.req.param('experimentId'), 'experimentId');

    try {
      const results = await getExperimentResults(experimentId);
      // Verify the experiment belongs to the requested project
      if (results.experiment.project_id !== projectId) {
        throw new NotFoundError('Experiment', experimentId);
      }
      return c.json(results);
    } catch (err) {
      if ((err as Error).message.includes('not found')) {
        throw new NotFoundError('Experiment', experimentId);
      }
      throw err;
    }
  });

  // Resolve experiment
  app.post('/api/projects/:id/experiments/:experimentId/resolve', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);
    const experimentId = requireUUID(c.req.param('experimentId'), 'experimentId');

    const body = await c.req.json<Record<string, unknown>>();
    const winner = body.winner as string;

    if (!winner || !['a', 'b', 'inconclusive'].includes(winner)) {
      throw new ValidationError('winner must be one of: a, b, inconclusive');
    }

    return withSpan('experiment_resolve', {
      project_id: projectId,
      winner,
    }, async () => {
      try {
        const experiment = await resolveExperiment(experimentId, winner as 'a' | 'b' | 'inconclusive');
        if (experiment.project_id !== projectId) {
          throw new NotFoundError('Experiment', experimentId);
        }
        safeEmit('experiment.resolved', projectId, {
          experiment_id: experimentId,
          winner,
          name: (experiment as unknown as Record<string, unknown>).name,
        });
        return c.json(experiment);
      } catch (err) {
        if ((err as Error).message.includes('not found')) {
          throw new NotFoundError('Experiment', experimentId);
        }
        throw err;
      }
    });
  });
}
