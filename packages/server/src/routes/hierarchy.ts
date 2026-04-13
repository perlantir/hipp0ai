/**
 * Hierarchy Routes — bulk classification and domain listing endpoints
 * for the hierarchical decision organization feature.
 */
import type { Hono } from 'hono';
import { getDb } from '@hipp0/core/db/index.js';
import { parseDecision } from '@hipp0/core/db/parsers.js';
import { classifyDecision } from '@hipp0/core/hierarchy/classifier.js';
import { requireUUID, logAudit } from './validation.js';
import { requireProjectAccess } from './_helpers.js';

export function registerHierarchyRoutes(app: Hono): void {
    // Bulk classify all decisions in a project
  // Idempotent: re-classifies all decisions using current rules.
  app.post('/api/projects/:id/decisions/bulk-classify', async (c) => {
    const db = getDb();
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);

    const result = await db.query<Record<string, unknown>>(
      `SELECT id, title, description, tags, source, confidence FROM decisions WHERE project_id = ?`,
      [projectId],
    );

    let classified = 0;
    let errors = 0;

    for (const row of result.rows) {
      try {
        const tags: string[] = Array.isArray(row.tags)
          ? row.tags as string[]
          : typeof row.tags === 'string' && (row.tags as string).startsWith('{')
            ? (row.tags as string).slice(1, -1).split(',').filter(Boolean)
            : [];

        const classification = classifyDecision(
          row.title as string,
          row.description as string,
          tags,
          {
            source: row.source as 'manual' | 'auto_distilled' | 'imported',
            confidence: row.confidence as 'high' | 'medium' | 'low',
          },
        );

        await db.query(
          `UPDATE decisions SET domain = ?, category = ? WHERE id = ?`,
          [classification.domain, classification.category, row.id],
        );
        classified++;
      } catch {
        errors++;
      }
    }

    logAudit('bulk_classify', projectId, { classified, errors, total: result.rows.length });

    return c.json({
      classified,
      errors,
      total: result.rows.length,
    });
  });

    // Domain distribution for a project
  app.get('/api/projects/:id/domains', async (c) => {
    const db = getDb();
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);

    // Get domain counts
    const domainResult = await db.query<Record<string, unknown>>(
      `SELECT COALESCE(domain, 'general') as name, COUNT(*) as count
       FROM decisions WHERE project_id = ? AND status = 'active'
       GROUP BY COALESCE(domain, 'general')
       ORDER BY count DESC`,
      [projectId],
    );

    // Get agents per domain (via the affects array overlap)
    const agentsResult = await db.query<Record<string, unknown>>(
      `SELECT COALESCE(d.domain, 'general') as domain, UNNEST(d.affects) as agent_name
       FROM decisions d
       WHERE d.project_id = ? AND d.status = 'active'
       GROUP BY COALESCE(d.domain, 'general'), agent_name`,
      [projectId],
    );

    // Build agent map per domain
    const agentMap = new Map<string, Set<string>>();
    for (const row of agentsResult.rows) {
      const domain = row.domain as string;
      const agent = row.agent_name as string;
      if (!agentMap.has(domain)) agentMap.set(domain, new Set());
      agentMap.get(domain)!.add(agent);
    }

    const domains = domainResult.rows.map((row) => {
      const name = row.name as string;
      return {
        name,
        count: parseInt(String(row.count), 10),
        agents: Array.from(agentMap.get(name) ?? []),
      };
    });

    return c.json({ domains });
  });
}
