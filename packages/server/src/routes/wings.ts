/**
 * Wing management endpoints — agent-specific context spaces with learned affinity.
 */

import type { Hono } from 'hono';
import { getDb } from '@hipp0/core/db/index.js';
import {
  rebalanceWingAffinity,
  recalculateProjectWings,
  classifyDecisionWing,
  getWingAffinity,
} from '@hipp0/core';
import { requireUUID, requireString, logAudit } from './validation.js';
import { requireProjectAccess } from './_helpers.js';
import { invalidateDecisionCaches } from '../cache/redis.js';

export function registerWingRoutes(app: Hono): void {
    // GET /api/agents/:name/wing — Wing stats for an agent
  app.get('/api/agents/:name/wing', async (c) => {
    const db = getDb();
    const agentName = c.req.param('name');
    const projectId = c.req.query('project_id');

    // Find the agent
    let agentQuery = 'SELECT * FROM agents WHERE name = ?';
    const params: unknown[] = [agentName];
    if (projectId) {
      agentQuery += ' AND project_id = ?';
      params.push(projectId);
    }
    agentQuery += ' LIMIT 1';

    const agentResult = await db.query<Record<string, unknown>>(agentQuery, params);
    if (agentResult.rows.length === 0) {
      return c.json({ error: { code: 'NOT_FOUND', message: `Agent "${agentName}" not found` } }, 404);
    }

    const agent = agentResult.rows[0];
    const agentProjectId = agent.project_id as string;
    await requireProjectAccess(c, agentProjectId);

    // Decision count for this wing
    const decisionResult = await db.query<Record<string, unknown>>(
      `SELECT COUNT(*) as count FROM decisions WHERE project_id = ? AND (wing = ? OR (wing IS NULL AND made_by = ?))`,
      [agentProjectId, agentName, agentName],
    );
    const decisionCount = parseInt((decisionResult.rows[0] as Record<string, unknown>).count as string ?? '0', 10);

    // Top domains
    const domainResult = await db.query<Record<string, unknown>>(
      `SELECT domain, COUNT(*) as count FROM decisions
       WHERE project_id = ? AND (wing = ? OR (wing IS NULL AND made_by = ?)) AND domain IS NOT NULL
       GROUP BY domain ORDER BY count DESC LIMIT 5`,
      [agentProjectId, agentName, agentName],
    );
    const topDomains = domainResult.rows.map((r) => r.domain as string);

    // Cross-wing connections (decisions that affect other agents)
    const crossWingResult = await db.query<Record<string, unknown>>(
      `SELECT DISTINCT UNNEST(affects) as connected_agent FROM decisions
       WHERE project_id = ? AND (wing = ? OR (wing IS NULL AND made_by = ?))`,
      [agentProjectId, agentName, agentName],
    );
    const connections = crossWingResult.rows
      .map((r) => r.connected_agent as string)
      .filter((a) => a && a !== agentName);

    // Parse wing_affinity
    let wingAffinity = { cross_wing_weights: {}, last_recalculated: '', feedback_count: 0 };
    const rawAffinity = agent.wing_affinity;
    if (rawAffinity) {
      if (typeof rawAffinity === 'string') {
        try { wingAffinity = JSON.parse(rawAffinity); } catch { /* skip */ }
      } else if (typeof rawAffinity === 'object') {
        wingAffinity = rawAffinity as typeof wingAffinity;
      }
    }

    return c.json({
      agent_name: agentName,
      wing: agentName,
      decision_count: decisionCount,
      top_domains: topDomains,
      cross_wing_connections: connections.map((name) => ({
        wing: name,
        strength: ((wingAffinity.cross_wing_weights ?? {}) as Record<string, number>)[name] ?? 0,
      })),
      wing_affinity: wingAffinity,
    });
  });

    // GET /api/projects/:id/wings — All wings in a project (enhanced with affinity per agent)
  app.get('/api/projects/:id/wings', async (c) => {
    const db = getDb();
    const projectId = requireUUID(c.req.param('id'), 'project_id');
    await requireProjectAccess(c, projectId);

    // Get all wings with counts and top domains
    const wingResult = await db.query<Record<string, unknown>>(
      `SELECT COALESCE(wing, made_by) as wing_name, COUNT(*) as decision_count
       FROM decisions WHERE project_id = ?
       GROUP BY COALESCE(wing, made_by) ORDER BY decision_count DESC`,
      [projectId],
    );

    // Get all agents for affinity data
    const agentResult = await db.query<Record<string, unknown>>(
      `SELECT id, name, wing_affinity FROM agents WHERE project_id = ?`,
      [projectId],
    );
    const agentAffinities: Record<string, { name: string; affinity: Record<string, number> }> = {};
    for (const row of agentResult.rows) {
      let parsed = { cross_wing_weights: {} as Record<string, number> };
      const raw = row.wing_affinity;
      if (typeof raw === 'string') {
        try { parsed = JSON.parse(raw); } catch { /* skip */ }
      } else if (raw && typeof raw === 'object') {
        parsed = raw as typeof parsed;
      }
      agentAffinities[row.name as string] = {
        name: row.name as string,
        affinity: (parsed.cross_wing_weights ?? {}) as Record<string, number>,
      };
    }

    const wings: Array<Record<string, unknown>> = [];
    for (const row of wingResult.rows) {
      const wingName = row.wing_name as string;
      const decisionCount = parseInt(row.decision_count as string ?? '0', 10);

      // Top domains for this wing
      const domainResult = await db.query<Record<string, unknown>>(
        `SELECT domain, COUNT(*) as count FROM decisions
         WHERE project_id = ? AND (wing = ? OR (wing IS NULL AND made_by = ?)) AND domain IS NOT NULL
         GROUP BY domain ORDER BY count DESC LIMIT 3`,
        [projectId, wingName, wingName],
      );
      const topDomains = domainResult.rows.map((r) => r.domain as string);

      // Cross-references: which other wings reference this wing's decisions
      const crossRefResult = await db.query<Record<string, unknown>>(
        `SELECT rf.agent_id, a.name as agent_name, COUNT(*) as ref_count
         FROM relevance_feedback rf
         JOIN decisions d ON d.id = rf.decision_id
         JOIN agents a ON a.id = rf.agent_id
         WHERE d.project_id = ? AND COALESCE(d.wing, d.made_by) = ? AND rf.was_useful = true
         GROUP BY rf.agent_id, a.name
         ORDER BY ref_count DESC LIMIT 5`,
        [projectId, wingName],
      );

      // Per-agent affinity for this wing
      const agentAffinityList = Object.values(agentAffinities)
        .filter((a) => (a.affinity[wingName] ?? 0) > 0)
        .map((a) => ({ agent: a.name, affinity: a.affinity[wingName] }))
        .sort((a, b) => b.affinity - a.affinity);

      wings.push({
        wing: wingName,
        decision_count: decisionCount,
        top_domains: topDomains,
        cross_references: crossRefResult.rows.map((r) => ({
          agent: r.agent_name as string,
          strength: Math.min(1.0, (parseInt(r.ref_count as string ?? '0', 10) * 0.1)),
        })),
        agent_affinities: agentAffinityList,
      });
    }

    return c.json({ project_id: projectId, wings });
  });

    // GET /api/agents/:id/affinity — Agent's wing affinity scores and learning history
  app.get('/api/agents/:id/affinity', async (c) => {
    const db = getDb();
    const agentId = c.req.param('id');

    // Try UUID first, then name
    let agentQuery: string;
    let queryParam: string;
    if (agentId.match(/^[0-9a-f]{8}-/i)) {
      agentQuery = 'SELECT id, name, project_id, wing_affinity FROM agents WHERE id = ? LIMIT 1';
      queryParam = agentId;
    } else {
      agentQuery = 'SELECT id, name, project_id, wing_affinity FROM agents WHERE name = ? LIMIT 1';
      queryParam = agentId;
    }

    const agentResult = await db.query<Record<string, unknown>>(agentQuery, [queryParam]);
    if (agentResult.rows.length === 0) {
      return c.json({ error: { code: 'NOT_FOUND', message: `Agent "${agentId}" not found` } }, 404);
    }

    const agent = agentResult.rows[0];
    await requireProjectAccess(c, agent.project_id as string);
    let wingAffinity = { cross_wing_weights: {} as Record<string, number>, last_recalculated: '', feedback_count: 0 };
    const raw = agent.wing_affinity;
    if (typeof raw === 'string') {
      try { wingAffinity = JSON.parse(raw); } catch { /* skip */ }
    } else if (raw && typeof raw === 'object') {
      wingAffinity = raw as typeof wingAffinity;
    }

    // Get recent feedback for learning history
    const feedbackResult = await db.query<Record<string, unknown>>(
      `SELECT rf.rating, rf.was_useful, rf.created_at, COALESCE(d.wing, d.made_by) as wing
       FROM relevance_feedback rf
       JOIN decisions d ON d.id = rf.decision_id
       WHERE rf.agent_id = ?
       ORDER BY rf.created_at DESC LIMIT 50`,
      [agent.id as string],
    );

    // Compute learning trend: group by wing, compute net direction
    const wingTrends: Record<string, { positive: number; negative: number; total: number }> = {};
    for (const row of feedbackResult.rows) {
      const wing = row.wing as string;
      if (!wing) continue;
      if (!wingTrends[wing]) wingTrends[wing] = { positive: 0, negative: 0, total: 0 };
      wingTrends[wing].total++;
      if (row.was_useful || row.rating === 'useful' || row.rating === 'critical') {
        wingTrends[wing].positive++;
      } else {
        wingTrends[wing].negative++;
      }
    }

    // Sort wings by affinity score descending
    const sortedWings = Object.entries(wingAffinity.cross_wing_weights ?? {})
      .sort(([, a], [, b]) => b - a)
      .map(([wing, score]) => ({
        wing,
        affinity_score: score,
        trend: wingTrends[wing] ?? { positive: 0, negative: 0, total: 0 },
      }));

    return c.json({
      agent_id: agent.id,
      agent_name: agent.name,
      wing_affinity: wingAffinity,
      wings: sortedWings,
      strongest_wing: sortedWings.length > 0 ? sortedWings[0].wing : null,
      feedback_count: wingAffinity.feedback_count,
      last_recalculated: wingAffinity.last_recalculated,
    });
  });

    // POST /api/projects/:id/wings/recalculate — Manual trigger
  app.post('/api/projects/:id/wings/recalculate', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'project_id');
    await requireProjectAccess(c, projectId);

    const result = await recalculateProjectWings(projectId);

    invalidateDecisionCaches(projectId).catch(() => {});

    logAudit('wings_recalculated', projectId, {
      agents_updated: result.agents_updated,
      merge_suggestions: result.merge_suggestions.length,
    });

    return c.json({
      project_id: projectId,
      agents_updated: result.agents_updated,
      merge_suggestions: result.merge_suggestions,
      recalculated_at: new Date().toISOString(),
    });
  });

    // GET /api/decisions/:id/classification — Auto-classification details
  app.get('/api/decisions/:id/classification', async (c) => {
    const db = getDb();
    const decisionId = requireUUID(c.req.param('id'), 'decision_id');

    const result = await db.query<Record<string, unknown>>(
      'SELECT id, project_id, title, description, tags, domain, category, wing, made_by, priority_level, metadata FROM decisions WHERE id = ?',
      [decisionId],
    );
    if (result.rows.length === 0) {
      return c.json({ error: { code: 'NOT_FOUND', message: `Decision not found` } }, 404);
    }

    const row = result.rows[0];
    await requireProjectAccess(c, row.project_id as string);
    let tags: string[] = [];
    const rawTags = row.tags;
    if (typeof rawTags === 'string') {
      try { tags = JSON.parse(rawTags); } catch { /* skip */ }
    } else if (Array.isArray(rawTags)) {
      tags = rawTags as string[];
    }

    let metadata: Record<string, unknown> = {};
    const rawMeta = row.metadata;
    if (typeof rawMeta === 'string') {
      try { metadata = JSON.parse(rawMeta); } catch { /* skip */ }
    } else if (rawMeta && typeof rawMeta === 'object') {
      metadata = rawMeta as Record<string, unknown>;
    }

    // Re-classify to get live scores
    const classification = classifyDecisionWing(
      row.title as string,
      row.description as string,
      tags,
      row.made_by as string,
      row.domain as string | null,
    );

    return c.json({
      decision_id: decisionId,
      domain: row.domain,
      category: row.category,
      wing: row.wing,
      priority_level: row.priority_level,
      auto_domain: metadata.auto_domain ?? classification.auto_domain,
      auto_category: metadata.auto_category ?? classification.auto_category,
      classification_confidence: metadata.classification_confidence ?? classification.classification_confidence,
      best_wing: classification.best_wing,
      wing_scores: classification.wing_scores,
    });
  });

    // POST /api/agents/:name/wing/rebalance — Recalculate affinity
  app.post('/api/agents/:name/wing/rebalance', async (c) => {
    const db = getDb();
    const agentName = c.req.param('name');
    const projectId = c.req.query('project_id');

    // Find agent
    let agentQuery = 'SELECT id, project_id FROM agents WHERE name = ?';
    const params: unknown[] = [agentName];
    if (projectId) {
      agentQuery += ' AND project_id = ?';
      params.push(projectId);
    }
    agentQuery += ' LIMIT 1';

    const agentResult = await db.query<Record<string, unknown>>(agentQuery, params);
    if (agentResult.rows.length === 0) {
      return c.json({ error: { code: 'NOT_FOUND', message: `Agent "${agentName}" not found` } }, 404);
    }

    const agentIdVal = agentResult.rows[0].id as string;
    await requireProjectAccess(c, agentResult.rows[0].project_id as string);
    const affinity = await rebalanceWingAffinity(agentIdVal);

    logAudit('wing_rebalanced', agentResult.rows[0].project_id as string, {
      agent_name: agentName,
      agent_id: agentIdVal,
      wings_count: Object.keys(affinity.cross_wing_weights ?? {}).length,
      feedback_count: affinity.feedback_count,
    });

    return c.json({
      agent_name: agentName,
      wing_affinity: affinity,
      rebalanced_at: new Date().toISOString(),
    });
  });
}
