import crypto from 'node:crypto';
import { getDb } from '../db/index.js';
import type {
  ExecutionProposal,
  GovernorDecision,
  GovernorReason,
  GovernorStatus,
  Decision,
} from '../types.js';

const LOW_TRUST_THRESHOLD = 0.35;
const POOR_OUTCOME_THRESHOLD = 0.35;
const STALE_DAYS_THRESHOLD = 90;

/**
 * Evaluate a proposed action against current decision state.
 * Returns allow / warn / block with explicit, grounded reasons.
 */
export async function evaluateProposal(
  proposal: ExecutionProposal,
): Promise<GovernorDecision> {
  const reasons: GovernorReason[] = [];

  // Gather all target and related decision IDs
  const allIds = [
    ...(proposal.target_decision_ids ?? []),
    ...(proposal.related_decision_ids ?? []),
  ];

  if (allIds.length === 0 && !proposal.task) {
    return {
      status: 'allow',
      summary: 'No decisions referenced — no governance checks applicable.',
      reasons: [],
      override_allowed: true,
    };
  }

  // Fetch referenced decisions
  const decisions = allIds.length > 0 ? await fetchDecisions(allIds) : [];

  // Run all checks
  checkSupersededPatterns(decisions, reasons);
  checkLowTrust(decisions, reasons);
  checkPoorOutcomes(decisions, reasons);
  await checkUnresolvedContradictions(proposal.project_id, allIds, reasons);
  checkStaleAssumptions(decisions, reasons);
  checkDeprecatedScope(decisions, reasons);
  await checkPolicyBlocks(proposal.project_id, allIds, reasons);

  // Determine overall status from reasons
  const status = determineStatus(reasons);

  // Build summary
  const blockCount = reasons.filter((r) => r.severity === 'block').length;
  const warnCount = reasons.filter((r) => r.severity === 'warn').length;
  let summary: string;
  if (status === 'block') {
    summary = `Blocked: ${blockCount} blocking issue${blockCount > 1 ? 's' : ''} detected.`;
  } else if (status === 'warn') {
    summary = `Warning: ${warnCount} concern${warnCount > 1 ? 's' : ''} found. Proceed with caution.`;
  } else {
    summary = 'No governance issues detected.';
  }

  // Required actions
  const requiredActions: string[] = [];
  if (reasons.some((r) => r.code === 'review_required')) requiredActions.push('Requires human review before proceeding.');
  if (reasons.some((r) => r.code === 'unresolved_contradiction')) requiredActions.push('Resolve contradictions before proceeding.');
  if (reasons.some((r) => r.code === 'superseded_pattern')) requiredActions.push('Update to current active decisions.');

  return {
    status,
    summary,
    reasons,
    required_actions: requiredActions.length > 0 ? requiredActions : undefined,
    override_allowed: status !== 'block' || !reasons.some((r) => r.code === 'policy_block'),
  };
}

function determineStatus(reasons: GovernorReason[]): GovernorStatus {
  if (reasons.some((r) => r.severity === 'block')) return 'block';
  if (reasons.some((r) => r.severity === 'warn')) return 'warn';
  return 'allow';
}

async function fetchDecisions(ids: string[]): Promise<Decision[]> {
  if (ids.length === 0) return [];
  const db = getDb();
  const placeholders = ids.map(() => '?').join(',');
  // outcome_success_rate/outcome_count come from decision_outcome_stats
  // (Phase 14, migration 062/sqlite-040) rather than the legacy columns
  // on decisions — those are being dropped by migration 060. Aliased to
  // the historical names so checkPoorOutcomes() below continues to read
  // them unchanged. LEFT JOIN so decisions with no outcome history are
  // still returned (with NULL/0 values).
  const result = await db.query<Record<string, unknown>>(
    `SELECT d.id, d.title, d.status, d.confidence, d.trust_score,
            v.success_rate AS outcome_success_rate,
            COALESCE(v.total_count, 0) AS outcome_count,
            d.supersedes_id, d.superseded_by, d.temporal_scope, d.valid_until, d.validated_at,
            d.assumptions, d.open_questions, d.made_by, d.tags, d.created_at, d.provenance_chain
     FROM decisions d
     LEFT JOIN decision_outcome_stats v
       ON v.decision_id = d.id AND v.project_id = d.project_id
     WHERE d.id IN (${placeholders})`,
    ids,
  );
  return result.rows.map((r) => r as unknown as Decision);
}

function checkSupersededPatterns(decisions: Decision[], reasons: GovernorReason[]): void {
  for (const d of decisions) {
    if (d.status === 'superseded') {
      reasons.push({
        code: 'superseded_pattern',
        severity: 'warn',
        decision_id: d.id,
        message: `Decision "${(d as any).title ?? d.id}" has been superseded${(d as any).superseded_by ? ' by ' + (d as any).superseded_by : ''}.`,
        evidence: { status: d.status, superseded_by: (d as any).superseded_by },
      });
    }
    if (d.status === 'reverted') {
      reasons.push({
        code: 'superseded_pattern',
        severity: 'block',
        decision_id: d.id,
        message: `Decision "${(d as any).title ?? d.id}" has been reverted and should not be relied upon.`,
        evidence: { status: d.status },
      });
    }
  }
}

function checkLowTrust(decisions: Decision[], reasons: GovernorReason[]): void {
  for (const d of decisions) {
    const trust = (d as any).trust_score;
    if (trust != null && trust < LOW_TRUST_THRESHOLD) {
      reasons.push({
        code: 'low_trust_dependency',
        severity: 'warn',
        decision_id: d.id,
        message: `Decision "${(d as any).title ?? d.id}" has low trust (${(trust as number).toFixed(2)}). Consider validation before relying on it.`,
        evidence: { trust_score: trust },
      });
    }
  }
}

function checkPoorOutcomes(decisions: Decision[], reasons: GovernorReason[]): void {
  for (const d of decisions) {
    const rate = (d as any).outcome_success_rate;
    const count = (d as any).outcome_count ?? 0;
    if (rate != null && count >= 3 && rate < POOR_OUTCOME_THRESHOLD) {
      reasons.push({
        code: 'poor_outcome_history',
        severity: count >= 5 ? 'block' : 'warn',
        decision_id: d.id,
        message: `Decision "${(d as any).title ?? d.id}" has poor outcome history (${(rate * 100).toFixed(0)}% success over ${count} outcomes).`,
        evidence: { success_rate: rate, outcome_count: count },
      });
    }
  }
}

async function checkUnresolvedContradictions(
  projectId: string,
  decisionIds: string[],
  reasons: GovernorReason[],
): Promise<void> {
  if (decisionIds.length === 0) return;
  const db = getDb();
  const placeholders = decisionIds.map(() => '?').join(',');
  try {
    const result = await db.query<Record<string, unknown>>(
      `SELECT id, decision_a_id, decision_b_id, conflict_description
       FROM contradictions
       WHERE (decision_a_id IN (${placeholders}) OR decision_b_id IN (${placeholders}))
         AND status = 'unresolved'`,
      [...decisionIds, ...decisionIds],
    );
    for (const row of result.rows) {
      reasons.push({
        code: 'unresolved_contradiction',
        severity: 'warn',
        decision_id: (row.decision_a_id as string),
        message: `Unresolved contradiction: ${(row.conflict_description as string) ?? 'Conflicting decisions detected.'}`,
        evidence: { contradiction_id: row.id, decision_a: row.decision_a_id, decision_b: row.decision_b_id },
      });
    }
  } catch {
    // contradictions table may not exist in test environments
  }
}

function checkStaleAssumptions(decisions: Decision[], reasons: GovernorReason[]): void {
  const now = Date.now();
  for (const d of decisions) {
    // Check temporal staleness
    const createdMs = new Date((d as any).created_at).getTime();
    const ageDays = (now - createdMs) / 86400000;
    const validated = (d as any).validated_at;

    if (ageDays > STALE_DAYS_THRESHOLD && !validated) {
      reasons.push({
        code: 'stale_assumption',
        severity: 'warn',
        decision_id: d.id,
        message: `Decision "${(d as any).title ?? d.id}" is ${Math.floor(ageDays)} days old and unvalidated.`,
        evidence: { age_days: Math.floor(ageDays), validated: false },
      });
    }

    // Check expired temporal scope
    const validUntil = (d as any).valid_until;
    if (validUntil && new Date(validUntil).getTime() < now) {
      reasons.push({
        code: 'stale_assumption',
        severity: 'block',
        decision_id: d.id,
        message: `Decision "${(d as any).title ?? d.id}" has expired (valid_until: ${validUntil}).`,
        evidence: { valid_until: validUntil },
      });
    }

    // Check unresolved open questions
    const openQuestions = (d as any).open_questions;
    if (Array.isArray(openQuestions) && openQuestions.length > 0) {
      reasons.push({
        code: 'stale_assumption',
        severity: 'info',
        decision_id: d.id,
        message: `Decision "${(d as any).title ?? d.id}" has ${openQuestions.length} unresolved open question${openQuestions.length > 1 ? 's' : ''}.`,
        evidence: { open_questions: openQuestions },
      });
    }
  }
}

function checkDeprecatedScope(decisions: Decision[], reasons: GovernorReason[]): void {
  for (const d of decisions) {
    if ((d as any).temporal_scope === 'deprecated') {
      reasons.push({
        code: 'deprecated_scope',
        severity: 'block',
        decision_id: d.id,
        message: `Decision "${(d as any).title ?? d.id}" is marked as deprecated.`,
        evidence: { temporal_scope: 'deprecated' },
      });
    }
  }
}

async function checkPolicyBlocks(
  projectId: string,
  decisionIds: string[],
  reasons: GovernorReason[],
): Promise<void> {
  if (decisionIds.length === 0) return;
  const db = getDb();
  const placeholders = decisionIds.map(() => '?').join(',');
  try {
    const result = await db.query<Record<string, unknown>>(
      `SELECT dp.id, dp.decision_id, dp.enforcement, dp.approval_notes
       FROM decision_policies dp
       WHERE dp.decision_id IN (${placeholders})
         AND dp.active = ${db.dialect === 'sqlite' ? '1' : 'true'}
         AND dp.enforcement = 'block'`,
      decisionIds,
    );
    for (const row of result.rows) {
      reasons.push({
        code: 'policy_block',
        severity: 'block',
        decision_id: row.decision_id as string,
        message: `Policy block: ${(row.approval_notes as string) ?? 'Explicit block policy on this decision.'}`,
        evidence: { policy_id: row.id, enforcement: row.enforcement },
      });
    }
  } catch {
    // policy table may not exist in test environments
  }
}

/**
 * Record an override event for audit trail.
 */
export async function recordOverride(
  projectId: string,
  proposal: ExecutionProposal,
  justification: string,
  actorId: string,
  governorResult: GovernorDecision,
): Promise<void> {
  const db = getDb();
  try {
    await db.query(
      `INSERT INTO audit_log (id, event_type, project_id, details)
       VALUES (?, ?, ?, ?)`,
      [
        crypto.randomUUID(),
        'governor_override',
        projectId,
        JSON.stringify({
          actor_id: actorId,
          justification,
          governor_status: governorResult.status,
          reasons_count: governorResult.reasons.length,
          action_type: proposal.action_type,
          target_decisions: proposal.target_decision_ids,
        }),
      ],
    );
  } catch {
    // audit_log may not exist — non-fatal
  }
}
