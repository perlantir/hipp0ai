/**
 * Autonomous Evolution Engine — 10 rule-based triggers for decision evolution.
 *
 * 100% local/deterministic scanning. Zero LLM calls in "rule" mode.
 * Modes: "rule" (default), "llm" (adds natural-language explanation), "hybrid" (LLM for critical/high only).
 */

import { getDb } from '../db/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EvolutionMode = 'rule' | 'llm' | 'hybrid';
export type ProposalUrgency = 'critical' | 'high' | 'medium' | 'low';
export type ProposalStatus = 'pending' | 'accepted' | 'rejected' | 'overridden';

export type TriggerType =
  | 'stale_sprint'
  | 'stale_quarter'
  | 'unresolved_contradiction'
  | 'orphaned_decision'
  | 'concentration_risk'
  | 'supersede_chain'
  | 'high_impact_unvalidated'
  | 'wing_drift'
  | 'temporal_expiry'
  | 'feedback_negative'
  | 'pattern_divergence';

export interface EvolutionProposal {
  trigger_type: TriggerType;
  affected_decision_ids: string[];
  reasoning: string;
  confidence: number;
  impact_score: number;
  urgency: ProposalUrgency;
  suggested_action: string;
}

export interface EvolutionScanResult {
  proposals: EvolutionProposal[];
  scan_duration_ms: number;
  mode: EvolutionMode;
}

// ---------------------------------------------------------------------------
// Urgency calculation
// ---------------------------------------------------------------------------

function computeUrgency(trigger: TriggerType, context: {
  downstream_count?: number;
  days_unresolved?: number;
  supersede_count?: number;
  days_until_expiry?: number;
}): ProposalUrgency {
  const deps = context.downstream_count ?? 0;
  const daysUnresolved = context.days_unresolved ?? 0;
  const supersedeCount = context.supersede_count ?? 0;
  const daysUntilExpiry = context.days_until_expiry ?? 999;

  // Critical
  if (trigger === 'unresolved_contradiction' && deps >= 5) return 'critical';
  if (trigger === 'high_impact_unvalidated' && deps >= 8) return 'critical';

  // High
  if (trigger === 'unresolved_contradiction' && daysUnresolved >= 14) return 'high';
  if (trigger === 'supersede_chain' && supersedeCount >= 3) return 'high';
  if (trigger === 'temporal_expiry' && daysUntilExpiry <= 3) return 'high';

  // Low
  if (trigger === 'orphaned_decision') return 'low';
  if (trigger === 'temporal_expiry' && daysUntilExpiry >= 4) return 'low';

  // Medium (default for stale, concentration_risk, wing_drift, feedback_negative)
  return 'medium';
}

// ---------------------------------------------------------------------------
// Downstream dependency counter helper
// ---------------------------------------------------------------------------

async function countDownstream(decisionId: string): Promise<number> {
  const db = getDb();
  const result = await db.query<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM decision_edges WHERE target_id = ?`,
    [decisionId],
  );
  return Number((result.rows[0] as Record<string, unknown>)?.cnt ?? 0);
}

// ---------------------------------------------------------------------------
// 10 Rule Triggers
// ---------------------------------------------------------------------------

async function ruleStaleSprint(projectId: string): Promise<EvolutionProposal[]> {
  const db = getDb();
  const result = await db.query(
    `SELECT id, title FROM decisions
     WHERE project_id = ? AND temporal_scope = 'sprint'
       AND valid_from < datetime('now', '-14 days')
       AND status = 'active' AND superseded_by IS NULL`,
    [projectId],
  );
  const proposals: EvolutionProposal[] = [];
  for (const row of result.rows) {
    const r = row as Record<string, unknown>;
    const deps = await countDownstream(r.id as string);
    proposals.push({
      trigger_type: 'stale_sprint',
      affected_decision_ids: [r.id as string],
      reasoning: `Decision "${r.title}" is tagged sprint-scoped and was created over 14 days ago. ${deps} downstream decisions depend on it. Recommend review or supersede.`,
      confidence: 0.85,
      impact_score: Math.min(1.0, 0.3 + deps * 0.1),
      urgency: computeUrgency('stale_sprint', { downstream_count: deps }),
      suggested_action: 'review_or_supersede',
    });
  }
  return proposals;
}

async function ruleStaleQuarter(projectId: string): Promise<EvolutionProposal[]> {
  const db = getDb();
  const result = await db.query(
    `SELECT id, title FROM decisions
     WHERE project_id = ? AND temporal_scope = 'quarter'
       AND valid_from < datetime('now', '-90 days')
       AND status = 'active' AND superseded_by IS NULL`,
    [projectId],
  );
  const proposals: EvolutionProposal[] = [];
  for (const row of result.rows) {
    const r = row as Record<string, unknown>;
    const deps = await countDownstream(r.id as string);
    proposals.push({
      trigger_type: 'stale_quarter',
      affected_decision_ids: [r.id as string],
      reasoning: `Decision "${r.title}" is quarter-scoped and over 90 days old. ${deps} downstream decisions depend on it. Recommend review or archive.`,
      confidence: 0.80,
      impact_score: Math.min(1.0, 0.2 + deps * 0.1),
      urgency: computeUrgency('stale_quarter', { downstream_count: deps }),
      suggested_action: 'review_or_archive',
    });
  }
  return proposals;
}

async function ruleUnresolvedContradiction(projectId: string): Promise<EvolutionProposal[]> {
  const db = getDb();
  const result = await db.query(
    `SELECT c.id, c.decision_a_id, c.decision_b_id, c.conflict_description, c.detected_at,
            da.title AS title_a, db.title AS title_b
     FROM contradictions c
     JOIN decisions da ON da.id = c.decision_a_id
     JOIN decisions db ON db.id = c.decision_b_id
     WHERE c.project_id = ? AND c.status = 'unresolved'
       AND c.detected_at < datetime('now', '-7 days')`,
    [projectId],
  );
  const proposals: EvolutionProposal[] = [];
  for (const row of result.rows) {
    const r = row as Record<string, unknown>;
    const depsA = await countDownstream(r.decision_a_id as string);
    const depsB = await countDownstream(r.decision_b_id as string);
    const totalDeps = depsA + depsB;
    const daysUnresolved = Math.floor((Date.now() - new Date(r.detected_at as string).getTime()) / 86400000);
    proposals.push({
      trigger_type: 'unresolved_contradiction',
      affected_decision_ids: [r.decision_a_id as string, r.decision_b_id as string],
      reasoning: `Contradiction between "${r.title_a}" and "${r.title_b}" unresolved for ${daysUnresolved} days. ${r.conflict_description ?? 'No description.'}. ${totalDeps} total downstream dependencies.`,
      confidence: 0.90,
      impact_score: Math.min(1.0, 0.5 + totalDeps * 0.05),
      urgency: computeUrgency('unresolved_contradiction', { downstream_count: totalDeps, days_unresolved: daysUnresolved }),
      suggested_action: 'resolve_contradiction',
    });
  }
  return proposals;
}

async function ruleOrphanedDecision(projectId: string): Promise<EvolutionProposal[]> {
  const db = getDb();
  const result = await db.query(
    `SELECT d.id, d.title, d.tags, d.description FROM decisions d
     WHERE d.project_id = ? AND d.status = 'active'
       AND NOT EXISTS (SELECT 1 FROM decision_edges e WHERE e.source_id = d.id OR e.target_id = d.id)`,
    [projectId],
  );

  // Fetch all active decisions for tag-overlap checking
  const allDecisions = await db.query(
    `SELECT id, title, tags FROM decisions WHERE project_id = ? AND status = 'active'`,
    [projectId],
  );

  const proposals: EvolutionProposal[] = [];
  for (const row of result.rows) {
    const r = row as Record<string, unknown>;
    const orphanId = r.id as string;
    const orphanTitle = r.title as string;
    const orphanTags = parseTags(r.tags);

    // Find top 2 potential links based on tag overlap
    const potentialLinks: Array<{ title: string; sharedTags: string[] }> = [];
    if (orphanTags.length > 0) {
      for (const other of allDecisions.rows) {
        const o = other as Record<string, unknown>;
        if (o.id === orphanId) continue;
        const otherTags = parseTags(o.tags);
        const shared = orphanTags.filter(t => otherTags.map(x => x.toLowerCase()).includes(t.toLowerCase()));
        if (shared.length > 0) {
          potentialLinks.push({ title: o.title as string, sharedTags: shared });
        }
      }
      potentialLinks.sort((a, b) => b.sharedTags.length - a.sharedTags.length);
    }

    // Build smarter reasoning with potential links
    let reasoning: string;
    const top2 = potentialLinks.slice(0, 2);
    if (top2.length >= 2) {
      const sharedTagStr = [...new Set(top2.flatMap(l => l.sharedTags))].join(', ');
      reasoning = `Decision "${orphanTitle}" has zero connections. It may relate to "${top2[0].title}" and "${top2[1].title}" based on shared tags [${sharedTagStr}]. Consider linking or archiving.`;
    } else if (top2.length === 1) {
      reasoning = `Decision "${orphanTitle}" has zero connections. It may relate to "${top2[0].title}" based on shared tags [${top2[0].sharedTags.join(', ')}]. Consider linking or archiving.`;
    } else {
      reasoning = `Decision "${orphanTitle}" has zero connections to any other decision. No tag overlap found with other decisions. Recommend archiving or manual review.`;
    }

    proposals.push({
      trigger_type: 'orphaned_decision',
      affected_decision_ids: [orphanId],
      reasoning,
      confidence: 0.70,
      impact_score: 0.2,
      urgency: 'low' as ProposalUrgency,
      suggested_action: 'link_or_review',
    });
  }
  return proposals;
}

function parseTags(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return []; }
  }
  return [];
}

async function ruleConcentrationRisk(projectId: string): Promise<EvolutionProposal[]> {
  const db = getDb();
  const result = await db.query(
    `SELECT domain, made_by, COUNT(*) as cnt, GROUP_CONCAT(id) as ids
     FROM decisions
     WHERE project_id = ? AND status = 'active' AND domain IS NOT NULL
     GROUP BY domain, made_by
     HAVING COUNT(*) >= 5`,
    [projectId],
  );
  return result.rows.map((row) => {
    const r = row as Record<string, unknown>;
    const ids = (r.ids as string).split(',');
    return {
      trigger_type: 'concentration_risk' as TriggerType,
      affected_decision_ids: ids,
      reasoning: `${r.cnt} decisions in the "${r.domain}" domain were all made by "${r.made_by}" with no second opinion. Recommend cross-review by a different-wing agent.`,
      confidence: 0.75,
      impact_score: Math.min(1.0, 0.3 + ids.length * 0.05),
      urgency: 'medium' as ProposalUrgency,
      suggested_action: 'cross_review',
    };
  });
}

async function ruleSupersedChain(projectId: string): Promise<EvolutionProposal[]> {
  const db = getDb();
  // Find decisions that have been superseded 3+ times by tracing chains
  const result = await db.query(
    `SELECT d.id, d.title, COUNT(e.id) as supersede_count
     FROM decisions d
     JOIN decision_edges e ON e.target_id = d.id AND e.relationship = 'supersedes'
     WHERE d.project_id = ? AND d.status = 'active'
     GROUP BY d.id, d.title
     HAVING COUNT(e.id) >= 3`,
    [projectId],
  );
  const proposals: EvolutionProposal[] = [];
  for (const row of result.rows) {
    const r = row as Record<string, unknown>;
    const cnt = Number(r.supersede_count);
    proposals.push({
      trigger_type: 'supersede_chain',
      affected_decision_ids: [r.id as string],
      reasoning: `Decision "${r.title}" has been superseded ${cnt} times, indicating instability. Recommend root cause analysis and consolidation.`,
      confidence: 0.85,
      impact_score: Math.min(1.0, 0.4 + cnt * 0.1),
      urgency: computeUrgency('supersede_chain', { supersede_count: cnt }),
      suggested_action: 'root_cause_consolidate',
    });
  }
  return proposals;
}

async function ruleHighImpactUnvalidated(projectId: string): Promise<EvolutionProposal[]> {
  const db = getDb();
  const result = await db.query(
    `SELECT d.id, d.title, COUNT(e.id) as dep_count
     FROM decisions d
     JOIN decision_edges e ON e.target_id = d.id
     WHERE d.project_id = ? AND d.status = 'active' AND d.validated_at IS NULL
     GROUP BY d.id, d.title
     HAVING COUNT(e.id) >= 5`,
    [projectId],
  );
  const proposals: EvolutionProposal[] = [];
  for (const row of result.rows) {
    const r = row as Record<string, unknown>;
    const deps = Number(r.dep_count);
    proposals.push({
      trigger_type: 'high_impact_unvalidated',
      affected_decision_ids: [r.id as string],
      reasoning: `Decision "${r.title}" has ${deps} downstream dependencies but has never been validated. Urgent validation needed.`,
      confidence: 0.90,
      impact_score: Math.min(1.0, 0.5 + deps * 0.05),
      urgency: computeUrgency('high_impact_unvalidated', { downstream_count: deps }),
      suggested_action: 'urgent_validation',
    });
  }
  return proposals;
}

async function ruleWingDrift(projectId: string): Promise<EvolutionProposal[]> {
  const db = getDb();
  const result = await db.query(
    `SELECT d.id, d.title, d.wing AS decision_wing, a.primary_domain AS author_wing
     FROM decisions d
     JOIN agents a ON a.name = d.made_by AND a.project_id = d.project_id
     WHERE d.project_id = ? AND d.status = 'active'
       AND d.wing IS NOT NULL AND a.primary_domain IS NOT NULL
       AND d.wing != a.primary_domain`,
    [projectId],
  );
  return result.rows.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      trigger_type: 'wing_drift' as TriggerType,
      affected_decision_ids: [r.id as string],
      reasoning: `Decision "${r.title}" was auto-classified to wing "${r.decision_wing}" but author's primary wing is "${r.author_wing}". Recommend review by domain expert.`,
      confidence: 0.65,
      impact_score: 0.35,
      urgency: 'medium' as ProposalUrgency,
      suggested_action: 'domain_expert_review',
    };
  });
}

async function ruleTemporalExpiry(projectId: string): Promise<EvolutionProposal[]> {
  const db = getDb();
  const result = await db.query(
    `SELECT id, title, valid_until FROM decisions
     WHERE project_id = ? AND status = 'active'
       AND valid_until IS NOT NULL
       AND valid_until > datetime('now')
       AND valid_until < datetime('now', '+7 days')`,
    [projectId],
  );
  const proposals: EvolutionProposal[] = [];
  for (const row of result.rows) {
    const r = row as Record<string, unknown>;
    const daysUntil = Math.max(0, Math.floor((new Date(r.valid_until as string).getTime() - Date.now()) / 86400000));
    const deps = await countDownstream(r.id as string);
    proposals.push({
      trigger_type: 'temporal_expiry',
      affected_decision_ids: [r.id as string],
      reasoning: `Decision "${r.title}" expires in ${daysUntil} days. ${deps} downstream dependencies. Recommend renew, supersede, or archive.`,
      confidence: 0.95,
      impact_score: Math.min(1.0, 0.4 + deps * 0.1),
      urgency: computeUrgency('temporal_expiry', { days_until_expiry: daysUntil, downstream_count: deps }),
      suggested_action: 'renew_supersede_or_archive',
    });
  }
  return proposals;
}

async function ruleFeedbackNegative(projectId: string): Promise<EvolutionProposal[]> {
  const db = getDb();
  const result = await db.query(
    `SELECT d.id, d.title, COUNT(f.id) as neg_count
     FROM decisions d
     JOIN relevance_feedback f ON f.decision_id = d.id AND f.was_useful = 0
     WHERE d.project_id = ? AND d.status = 'active'
     GROUP BY d.id, d.title
     HAVING COUNT(f.id) >= 3`,
    [projectId],
  );
  return result.rows.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      trigger_type: 'feedback_negative' as TriggerType,
      affected_decision_ids: [r.id as string],
      reasoning: `Decision "${r.title}" has ${r.neg_count} negative relevance feedback signals. Recommend review or supersede.`,
      confidence: 0.80,
      impact_score: Math.min(1.0, 0.3 + Number(r.neg_count) * 0.1),
      urgency: 'medium' as ProposalUrgency,
      suggested_action: 'review_or_supersede',
    };
  });
}

async function rulePatternDivergence(projectId: string): Promise<EvolutionProposal[]> {
  const db = getDb();
  // Find patterns with 3+ source projects and confidence > 0.70
  const patternResult = await db.query(
    `SELECT id, pattern_type, tag_a, tag_b, title_pattern_a, title_pattern_b, tenant_count, confidence
     FROM anonymous_patterns
     WHERE active = ? AND tenant_count >= 3 AND confidence > 0.70`,
    [true],
  );

  const proposals: EvolutionProposal[] = [];
  for (const row of patternResult.rows) {
    const p = row as Record<string, unknown>;
    const tagA = p.tag_a as string;
    const tagB = p.tag_b as string | null;
    const titleA = p.title_pattern_a as string | null;

    // Look for project decisions that contradict this pattern
    // A decision "contradicts" a pattern if it shares a tag but uses a different approach
    const divergent = await db.query(
      `SELECT d.id, d.title, d.tags FROM decisions d
       WHERE d.project_id = ? AND d.status = 'active'
         AND (d.tags LIKE ? ${tagB ? 'OR d.tags LIKE ?' : ''})`,
      tagB
        ? [projectId, `%${tagA}%`, `%${tagB}%`]
        : [projectId, `%${tagA}%`],
    );

    if (divergent.rows.length === 0) continue;

    // Check if any project decisions match the pattern (same tags but different title pattern)
    for (const drow of divergent.rows) {
      const d = drow as Record<string, unknown>;
      const decisionTitle = (d.title as string).toLowerCase();
      const patternTitle = (titleA ?? '').toLowerCase();

      // If the pattern title is mentioned, decision aligns — no divergence
      if (patternTitle && decisionTitle.includes(patternTitle.split(' ')[0] ?? '')) continue;

      proposals.push({
        trigger_type: 'pattern_divergence',
        affected_decision_ids: [d.id as string],
        reasoning: `${p.tenant_count} other projects use "${titleA ?? tagA}" for ${tagA}${tagB ? '/' + tagB : ''} decisions. This project's "${d.title}" may diverge from the common pattern. Consider aligning.`,
        confidence: p.confidence as number,
        impact_score: Math.min(1.0, 0.3 + (p.tenant_count as number) * 0.05),
        urgency: 'medium',
        suggested_action: 'review_alignment',
      });
    }
  }
  return proposals;
}

// ---------------------------------------------------------------------------
// Sort proposals by urgency, then impact_score
// ---------------------------------------------------------------------------

const URGENCY_ORDER: Record<ProposalUrgency, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function sortProposals(proposals: EvolutionProposal[]): EvolutionProposal[] {
  return proposals.sort((a, b) => {
    const urgDiff = URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency];
    if (urgDiff !== 0) return urgDiff;
    return b.impact_score - a.impact_score;
  });
}

// ---------------------------------------------------------------------------
// Main scan function
// ---------------------------------------------------------------------------

export async function runEvolutionScan(
  projectId: string,
  mode: EvolutionMode = 'rule',
): Promise<EvolutionScanResult> {
  const start = Date.now();

  const allRules = [
    ruleStaleSprint,
    ruleStaleQuarter,
    ruleUnresolvedContradiction,
    ruleOrphanedDecision,
    ruleConcentrationRisk,
    ruleSupersedChain,
    ruleHighImpactUnvalidated,
    ruleWingDrift,
    ruleTemporalExpiry,
    ruleFeedbackNegative,
    rulePatternDivergence,
  ];

  const results = await Promise.all(allRules.map((rule) => rule(projectId).catch(() => [] as EvolutionProposal[])));
  const proposals = sortProposals(results.flat());

  const duration = Date.now() - start;
  return { proposals, scan_duration_ms: duration, mode };
}

// Re-export urgency helper for tests
export { computeUrgency };
