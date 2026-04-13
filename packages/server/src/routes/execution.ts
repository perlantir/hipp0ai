import type { Hono } from 'hono';
import { requireUUID, requireString, logAudit } from './validation.js';
import { evaluateProposal, recordOverride } from '@hipp0/core/governance/execution-governor.js';
import type { ExecutionProposal } from '@hipp0/core/types.js';

export function registerExecutionRoutes(app: Hono): void {
  // POST /api/execution/validate - Preflight governance check
  app.post('/api/execution/validate', async (c) => {
    const body = await c.req.json<ExecutionProposal>();

    if (!body.project_id) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'project_id is required' } }, 400);
    }

    const result = await evaluateProposal(body);

    return c.json(result);
  });

  // POST /api/execution/override - Override a governor block with justification
  app.post('/api/execution/override', async (c) => {
    const body = await c.req.json<{
      proposal: ExecutionProposal;
      justification?: string;
      actor_id?: string;
    }>();

    if (!body.proposal?.project_id) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'proposal.project_id is required' } }, 400);
    }
    if (!body.justification || body.justification.trim().length < 10) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'justification is required and must be at least 10 characters to ensure adequate reasoning is documented' } }, 400);
    }
    if (!body.actor_id) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'actor_id is required to identify who is performing the override' } }, 400);
    }

    // Re-evaluate to get current governor decision
    const governorResult = await evaluateProposal(body.proposal);

    if (!governorResult.override_allowed) {
      return c.json({
        status: 'denied',
        message: 'Override not allowed for policy-blocked actions.',
        governor_decision: governorResult,
      }, 403);
    }

    // Record override for audit trail
    await recordOverride(
      body.proposal.project_id,
      body.proposal,
      body.justification,
      body.actor_id,
      governorResult,
    );

    logAudit('governor_override', body.proposal.project_id, {
      actor_id: body.actor_id,
      action_type: body.proposal.action_type,
      governor_status: governorResult.status,
      justification: body.justification.slice(0, 500),
    });

    return c.json({
      status: 'overridden',
      message: 'Governor check overridden with justification. Proceed with caution.',
      governor_decision: governorResult,
      override: {
        actor_id: body.actor_id,
        justification: body.justification,
        recorded_at: new Date().toISOString(),
      },
    });
  });
}
