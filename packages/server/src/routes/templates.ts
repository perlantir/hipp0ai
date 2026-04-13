/**
 * Project Templates API - list, get, apply pre-built project templates.
 */

import type { Hono } from 'hono';
import {
  listTemplates,
  getTemplate,
  applyTemplate,
} from '@hipp0/core/intelligence/project-templates.js';
import { requireUUID, requireString, logAudit } from './validation.js';
import { requireProjectAccess } from './_helpers.js';

export function registerTemplateRoutes(app: Hono): void {
  // List all templates
  app.get('/api/templates', async (c) => {
    const templates = listTemplates().map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      tags: t.tags,
      agent_count: t.agents.length,
      decision_count: t.decisions.length,
    }));
    return c.json({ templates });
  });

  // Get single template with full details
  app.get('/api/templates/:id', async (c) => {
    const id = c.req.param('id');
    const template = getTemplate(id);
    if (!template) {
      return c.json({ error: 'Template not found' }, 404);
    }
    return c.json(template);
  });

  // Apply a template to a project
  app.post('/api/projects/:id/apply-template', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);

    const body = await c.req.json<{ template_id?: unknown }>();
    const templateId = requireString(body.template_id, 'template_id', 100);

    const template = getTemplate(templateId);
    if (!template) {
      return c.json({ error: 'Template not found' }, 404);
    }

    try {
      const result = await applyTemplate(projectId, templateId);
      logAudit('template_applied', projectId, {
        template_id: templateId,
        agents_created: result.agents_created,
        decisions_created: result.decisions_created,
      });
      return c.json({
        success: true,
        template: { id: template.id, name: template.name },
        ...result,
      });
    } catch (err) {
      console.error('[templates] apply failed:', (err as Error).message);
      return c.json(
        { error: 'Failed to apply template', detail: (err as Error).message },
        500,
      );
    }
  });
}
