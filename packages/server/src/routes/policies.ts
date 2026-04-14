/**
 * Governance Routes — Policy management + violation tracking.
 *
 * POST   /api/decisions/:id/policy        — Create/update policy
 * GET    /api/projects/:id/policies       — List active policies
 * PATCH  /api/policies/:id                — Update policy
 * DELETE /api/policies/:id                — Deactivate policy
 * GET    /api/projects/:id/violations     — List violations
 * PATCH  /api/violations/:id              — Resolve/acknowledge violation
 * GET    /api/projects/:id/violations/summary — Violation stats
 * POST   /api/policies/check              — Pre-compile policy check
 */

import type { Hono } from 'hono';
import { getDb } from '@hipp0/core/db/index.js';
import { randomUUID } from 'node:crypto';
import { requireUUID } from './validation.js';
import { requireProjectAccess } from './_helpers.js';

/*  Helpers  */

function requireString(val: unknown, name: string): string {
  if (typeof val !== 'string' || val.trim().length === 0) {
    throw Object.assign(new Error(`${name} is required`), { status: 400 });
  }
  return val.trim();
}

/*  Register  */

export function registerPolicyRoutes(app: Hono): void {
  /*  POLICY CRUD  */

  // Create / update policy for a decision
  app.post('/api/decisions/:id/policy', async (c) => {
    const db = getDb();
    const decisionId = requireUUID(c.req.param('id'), 'decision_id');

    const body = await c.req.json<{
      enforcement?: string;
      approved_by?: string;
      approval_notes?: string;
      applies_to?: string[];
      category?: string;
      expires_at?: string | null;
    }>();

    const enforcement = body.enforcement ?? 'advisory';
    const approvedBy = requireString(body.approved_by, 'approved_by');
    const category = body.category ?? 'general';
    const appliesTo = body.applies_to ?? [];
    const expiresAt = body.expires_at ?? null;

    // Verify decision exists
    const dec = await db.query('SELECT id, project_id FROM decisions WHERE id = ?', [decisionId]);
    if (dec.rows.length === 0) return c.json({ error: 'Decision not found' }, 404);
    const projectId = (dec.rows[0] as Record<string, unknown>).project_id as string;
    await requireProjectAccess(c, projectId);

    // Upsert — check if policy already exists for this decision
    const existing = await db.query(
      'SELECT id FROM decision_policies WHERE decision_id = ?',
      [decisionId],
    );

    if (existing.rows.length > 0) {
      const policyId = (existing.rows[0] as Record<string, unknown>).id as string;
      await db.query(
        `UPDATE decision_policies
         SET enforcement = ?, approved_by = ?, approval_notes = ?,
             applies_to = ?, category = ?, expires_at = ?,
             active = ?, updated_at = ?
         WHERE id = ?`,
        [
          enforcement, approvedBy, body.approval_notes ?? null,
          db.arrayParam(appliesTo), category, expiresAt,
          true, new Date().toISOString(), policyId,
        ],
      );
      const result = await db.query('SELECT * FROM decision_policies WHERE id = ?', [policyId]);
      return c.json(result.rows[0]);
    }

    const id = randomUUID();
    await db.query(
      `INSERT INTO decision_policies
       (id, project_id, decision_id, enforcement, approved_by, approved_at,
        approval_notes, applies_to, category, expires_at, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, projectId, decisionId, enforcement, approvedBy,
        new Date().toISOString(), body.approval_notes ?? null,
        db.arrayParam(appliesTo), category, expiresAt, true,
      ],
    );

    const result = await db.query('SELECT * FROM decision_policies WHERE id = ?', [id]);
    return c.json(result.rows[0], 201);
  });

  // List active policies for a project
  app.get('/api/projects/:id/policies', async (c) => {
    const db = getDb();
    const projectId = requireUUID(c.req.param('id'), 'project_id');
    await requireProjectAccess(c, projectId);

    const result = await db.query(
      `SELECT dp.*, d.title AS decision_title,
              (SELECT COUNT(*) FROM policy_violations pv
               WHERE pv.policy_id = dp.id AND pv.status = 'open') AS violations_count
       FROM decision_policies dp
       JOIN decisions d ON dp.decision_id = d.id
       WHERE dp.project_id = ? AND dp.active = ?
       ORDER BY dp.priority DESC, dp.created_at DESC`,
      [projectId, true],
    );

    return c.json(result.rows);
  });

  // Update a policy
  app.patch('/api/policies/:id', async (c) => {
    const db = getDb();
    const policyId = requireUUID(c.req.param('id'), 'policy_id');
    const body = await c.req.json<Record<string, unknown>>();

    const projectId = requireUUID(body.project_id, 'project_id');
    await requireProjectAccess(c, projectId);

    const sets: string[] = [];
    const params: unknown[] = [];

    if (body.enforcement !== undefined) { sets.push('enforcement = ?'); params.push(body.enforcement); }
    if (body.category !== undefined) { sets.push('category = ?'); params.push(body.category); }
    if (body.priority !== undefined) { sets.push('priority = ?'); params.push(body.priority); }
    if (body.expires_at !== undefined) { sets.push('expires_at = ?'); params.push(body.expires_at); }
    if (body.applies_to !== undefined) {
      sets.push('applies_to = ?');
      params.push(db.arrayParam(body.applies_to as string[]));
    }
    if (body.approval_notes !== undefined) { sets.push('approval_notes = ?'); params.push(body.approval_notes); }

    if (sets.length === 0) return c.json({ error: 'No fields to update' }, 400);

    sets.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(policyId);
    params.push(projectId);

    await db.query(
      `UPDATE decision_policies SET ${sets.join(', ')} WHERE id = ? AND project_id = ?`,
      params,
    );

    const result = await db.query('SELECT * FROM decision_policies WHERE id = ? AND project_id = ?', [policyId, projectId]);
    if (result.rows.length === 0) return c.json({ error: 'Policy not found' }, 404);
    return c.json(result.rows[0]);
  });

  // Deactivate a policy (soft delete)
  app.delete('/api/policies/:id', async (c) => {
    const db = getDb();
    const policyId = requireUUID(c.req.param('id'), 'policy_id');
    const projectId = requireUUID(c.req.query('project_id'), 'project_id');
    await requireProjectAccess(c, projectId);

    const result = await db.query(
      'UPDATE decision_policies SET active = ?, updated_at = ? WHERE id = ? AND project_id = ? RETURNING id',
      [false, new Date().toISOString(), policyId, projectId],
    );
    if (result.rows.length === 0) return c.json({ error: 'Policy not found' }, 404);
    return c.json({ ok: true });
  });

  /*  VIOLATIONS  */

  // List violations
  app.get('/api/projects/:id/violations', async (c) => {
    const db = getDb();
    const projectId = requireUUID(c.req.param('id'), 'project_id');
    await requireProjectAccess(c, projectId);
    const status = c.req.query('status');

    let query = `SELECT pv.*, d.title AS decision_title
                 FROM policy_violations pv
                 JOIN decisions d ON pv.decision_id = d.id
                 WHERE pv.project_id = ?`;
    const params: unknown[] = [projectId];

    if (status) {
      query += ' AND pv.status = ?';
      params.push(status);
    }

    query += ' ORDER BY pv.created_at DESC LIMIT 100';

    const result = await db.query(query, params);
    return c.json(result.rows);
  });

  // Resolve / acknowledge a violation
  app.patch('/api/violations/:id', async (c) => {
    const db = getDb();
    const violationId = requireUUID(c.req.param('id'), 'violation_id');
    const body = await c.req.json<{
      project_id?: string;
      status?: string;
      resolved_by?: string;
      resolution_notes?: string;
    }>();

    const sets: string[] = [];
    const params: unknown[] = [];

    const projectId = requireUUID(body.project_id, 'project_id');
    await requireProjectAccess(c, projectId);

    const VALID_STATUS = ['open', 'acknowledged', 'resolved'] as const;
    if (body.status !== undefined) {
      if (!(VALID_STATUS as readonly string[]).includes(body.status)) {
        return c.json(
          { error: { code: 'VALIDATION_ERROR', message: `status must be one of: ${VALID_STATUS.join(', ')}` } },
          400,
        );
      }
      sets.push('status = ?'); params.push(body.status);
    }
    if (body.resolved_by) { sets.push('resolved_by = ?'); params.push(body.resolved_by); }
    if (body.resolution_notes) { sets.push('resolution_notes = ?'); params.push(body.resolution_notes); }
    if (body.status === 'resolved') {
      sets.push('resolved_at = ?');
      params.push(new Date().toISOString());
    }

    if (sets.length === 0) return c.json({ error: 'No fields to update' }, 400);
    params.push(violationId);
    params.push(projectId);

    await db.query(`UPDATE policy_violations SET ${sets.join(', ')} WHERE id = ? AND project_id = ?`, params);
    const result = await db.query('SELECT * FROM policy_violations WHERE id = ? AND project_id = ?', [violationId, projectId]);
    if (result.rows.length === 0) return c.json({ error: 'Violation not found' }, 404);
    return c.json(result.rows[0]);
  });

  // Violation summary
  app.get('/api/projects/:id/violations/summary', async (c) => {
    const db = getDb();
    const projectId = requireUUID(c.req.param('id'), 'project_id');
    await requireProjectAccess(c, projectId);

    const [openR, ackR, resolvedR, allR] = await Promise.all([
      db.query("SELECT COUNT(*) as c FROM policy_violations WHERE project_id = ? AND status = 'open'", [projectId]),
      db.query("SELECT COUNT(*) as c FROM policy_violations WHERE project_id = ? AND status = 'acknowledged'", [projectId]),
      db.query("SELECT COUNT(*) as c FROM policy_violations WHERE project_id = ? AND status = 'resolved' AND resolved_at >= datetime('now', '-7 days')", [projectId])
        .catch(() => ({ rows: [{ c: 0 }] })),
      db.query('SELECT violation_type, severity FROM policy_violations WHERE project_id = ?', [projectId]),
    ]);

    const parse = (r: { rows: Record<string, unknown>[] }) =>
      parseInt((r.rows[0] as Record<string, unknown>)?.c as string ?? '0', 10);

    const bySeverity: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    const byType: Record<string, number> = { contradiction: 0, omission: 0, override: 0 };
    for (const row of allR.rows) {
      const r = row as Record<string, unknown>;
      const sev = r.severity as string;
      const typ = r.violation_type as string;
      if (sev in bySeverity) bySeverity[sev]++;
      if (typ in byType) byType[typ]++;
    }

    return c.json({
      open: parse(openR),
      acknowledged: parse(ackR),
      resolved_this_week: parse(resolvedR),
      by_severity: bySeverity,
      by_type: byType,
    });
  });

  /*  PRE-COMPILE POLICY CHECK  */

  app.post('/api/policies/check', async (c) => {
    const db = getDb();
    const body = await c.req.json<{
      project_id?: string;
      agent_name?: string;
      planned_action?: string;
    }>();

    const projectId = requireUUID(body.project_id, 'project_id');
    await requireProjectAccess(c, projectId);
    const agentName = requireString(body.agent_name, 'agent_name');
    const plannedAction = requireString(body.planned_action, 'planned_action');

    // Get active policies
    const policies = await db.query(
      `SELECT dp.*, d.title, d.description
       FROM decision_policies dp
       JOIN decisions d ON dp.decision_id = d.id
       WHERE dp.project_id = ? AND dp.active = ?
         AND (dp.expires_at IS NULL OR dp.expires_at > ?)`,
      [projectId, true, new Date().toISOString()],
    );

    const violations: Array<{
      policy_decision: string;
      enforcement: string;
      explanation: string;
      suggestion: string;
    }> = [];
    const advisories: Array<{
      policy_decision: string;
      enforcement: string;
      note: string;
    }> = [];

    const actionLower = plannedAction.toLowerCase();
    const negationPatterns = [
      'not using', 'instead of', 'replace', 'switch from',
      'moving away from', 'dropping', 'removing', 'without',
      'skip', 'avoid', "don't use", "won't use",
    ];

    for (const row of policies.rows) {
      const policy = row as Record<string, unknown>;
      const title = policy.title as string;
      const enforcement = policy.enforcement as string;

      // Check applies_to scoping
      let appliesTo: string[] = [];
      if (Array.isArray(policy.applies_to)) {
        appliesTo = policy.applies_to as string[];
      } else if (typeof policy.applies_to === 'string') {
        try { appliesTo = JSON.parse(policy.applies_to as string); } catch { appliesTo = []; }
      }
      if (appliesTo.length > 0 && !appliesTo.includes(agentName)) continue;

      if (enforcement === 'advisory') {
        advisories.push({
          policy_decision: title,
          enforcement: 'advisory',
          note: `Relevant policy — consider: ${title}`,
        });
        continue;
      }

      // Keyword + negation check
      const keywords = title.toLowerCase().split(/\s+/).filter((w) => w.length >= 4);
      let violationFound = false;

      for (const kw of keywords) {
        if (actionLower.includes(kw)) {
          const idx = actionLower.indexOf(kw);
          const surrounding = actionLower.slice(Math.max(0, idx - 60), idx + kw.length + 60);
          if (negationPatterns.some((neg) => surrounding.includes(neg))) {
            violationFound = true;
            break;
          }
        }
      }

      // Also check for proper noun / technology name matches (case-insensitive, 3+ chars)
      if (!violationFound) {
        const techTerms = title.match(/[A-Z][a-z]+(?:\s[A-Z][a-z]+)*/g) ?? [];
        for (const term of techTerms) {
          if (term.length >= 3 && actionLower.includes(term.toLowerCase())) {
            // Check for negation
            const idx = actionLower.indexOf(term.toLowerCase());
            const surrounding = actionLower.slice(Math.max(0, idx - 60), idx + term.length + 60);
            if (negationPatterns.some((neg) => surrounding.includes(neg))) {
              violationFound = true;
              break;
            }
          }
        }
      }

      if (violationFound) {
        violations.push({
          policy_decision: title,
          enforcement,
          explanation: `Planned action may contradict approved policy: "${title}"`,
          suggestion: `Follow the policy or request a policy exception.`,
        });
      }
    }

    return c.json({
      compliant: violations.length === 0,
      violations,
      advisories,
    });
  });
}
