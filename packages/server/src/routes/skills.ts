import type { Hono } from 'hono';
import { requireUUID, requireString } from './validation.js';
import { requireProjectAccess } from './_helpers.js';
import {
  computeAgentSkillProfile,
  getSkillMatrix,
  suggestBestAgent,
} from '@hipp0/core/intelligence/skill-profiler.js';

export function registerSkillRoutes(app: Hono): void {
  // GET /api/projects/:id/agent-skills — skill matrix for all agents
  app.get('/api/projects/:id/agent-skills', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);

    const matrix = await getSkillMatrix(projectId);
    return c.json(matrix);
  });

  // GET /api/projects/:id/agent-skills/:agentName — one agent's skill profile
  app.get('/api/projects/:id/agent-skills/:agentName', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);
    const agentName = requireString(c.req.param('agentName'), 'agentName', 200);

    const profile = await computeAgentSkillProfile(projectId, agentName);
    return c.json(profile);
  });

  // GET /api/projects/:id/suggest-agent — suggests best agent for a task
  app.get('/api/projects/:id/suggest-agent', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);
    const task = requireString(c.req.query('task'), 'task', 10000);
    const tagsParam = c.req.query('tags') ?? '';
    const tags = tagsParam ? tagsParam.split(',').map((t) => t.trim()).filter(Boolean) : [];

    const suggestions = await suggestBestAgent(projectId, task, tags);
    return c.json({ suggestions });
  });
}
