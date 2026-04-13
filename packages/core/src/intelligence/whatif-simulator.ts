/**
 * Feature 11: What-If Simulator
 *
 * Real-time impact preview showing per-agent rank/score changes
 * before committing a decision change. Two modes:
 *   - Real-time: uses live scoring engine (always works)
 *   - Historical: queries compile_history (optional, fault-tolerant)
 */
import { getDb } from '../db/index.js';
import { scoreDecision, cosineSimilarity } from '../context-compiler/index.js';
import type { Decision, Agent, ScoredDecision } from '../types.js';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ProposedChanges {
  title?: string;
  description?: string;
  tags?: string[];
  affects?: string[];
}

export interface AgentImpact {
  agent_id: string;
  agent_name: string;
  agent_role: string;
  original_rank: number;
  proposed_rank: number;
  original_score: number;
  proposed_score: number;
  score_delta: number;
  rank_delta: number;
}

export interface SimulationWarning {
  type: 'rank_drop' | 'lost_agent' | 'new_contradiction' | 'cascade_risk';
  message: string;
  severity: 'info' | 'warning' | 'critical';
}

export interface SimulationResult {
  simulation_id: string;
  original_decision: Decision;
  proposed_decision: Decision;
  agent_impacts: AgentImpact[];
  summary: {
    total_agents: number;
    agents_affected: number;
    agents_improved: number;
    agents_degraded: number;
    agents_unchanged: number;
    newly_reached: string[];
    lost: string[];
  };
  warnings: SimulationWarning[];
  cascade_edges: Array<{ source_id: string; target_id: string; relationship: string }>;
}

export interface HistoricalImpact {
  lookback_days: number;
  compile_appearances: number;
  agents_that_received: string[];
  avg_score: number;
}

/* ------------------------------------------------------------------ */
/*  Zero vector for skipping semantic similarity                       */
/* ------------------------------------------------------------------ */

const ZERO_VECTOR: number[] = new Array(1536).fill(0) as number[];

/* ------------------------------------------------------------------ */
/*  Helper: Build proposed decision from original + changes            */
/* ------------------------------------------------------------------ */

function buildProposedDecision(original: Decision, changes: ProposedChanges): Decision {
  return {
    ...original,
    title: changes.title ?? original.title,
    description: changes.description ?? original.description,
    tags: changes.tags ?? original.tags,
    affects: changes.affects ?? original.affects,
  };
}

/* ------------------------------------------------------------------ */
/*  Helper: Get rank of a decision for a given agent                   */
/* ------------------------------------------------------------------ */

function getRank(
  decisionId: string,
  scoredDecisions: ScoredDecision[],
): { rank: number; score: number } {
  const sorted = [...scoredDecisions].sort((a, b) => b.combined_score - a.combined_score);
  const idx = sorted.findIndex((d) => d.id === decisionId);
  if (idx === -1) return { rank: -1, score: 0 };
  return { rank: idx + 1, score: sorted[idx].combined_score };
}

/* ------------------------------------------------------------------ */
/*  Check for potential contradictions                                  */
/* ------------------------------------------------------------------ */

export function checkProposedContradictions(
  proposedDecision: Decision,
  otherDecisions: Decision[],
): SimulationWarning[] {
  const warnings: SimulationWarning[] = [];

  for (const other of otherDecisions) {
    if (other.id === proposedDecision.id) continue;
    if (other.status !== 'active') continue;

    // Use embedding cosine similarity if both have embeddings
    const propEmb = proposedDecision.embedding;
    const otherEmb = other.embedding;
    if (
      propEmb && Array.isArray(propEmb) && propEmb.length > 0 &&
      otherEmb && Array.isArray(otherEmb) && otherEmb.length > 0
    ) {
      const sim = cosineSimilarity(propEmb, otherEmb);
      if (sim > 0.85) {
        warnings.push({
          type: 'new_contradiction',
          message: `High similarity (${(sim * 100).toFixed(0)}%) with "${other.title}" — potential contradiction`,
          severity: 'warning',
        });
      }
    }
  }

  return warnings;
}

/* ------------------------------------------------------------------ */
/*  Find cascade impact via decision_edges                             */
/* ------------------------------------------------------------------ */

export async function findCascadeImpact(
  decisionId: string,
  projectId: string,
): Promise<Array<{ source_id: string; target_id: string; relationship: string }>> {
  const db = getDb();
  try {
    const result = await db.query(
      `SELECT source_id, target_id, relationship
       FROM decision_edges
       WHERE source_id = ? OR target_id = ?`,
      [decisionId, decisionId],
    );
    return result.rows as Array<{ source_id: string; target_id: string; relationship: string }>;
  } catch {
    // decision_edges table may not exist
    return [];
  }
}

/* ------------------------------------------------------------------ */
/*  Main: simulateDecisionChange                                       */
/* ------------------------------------------------------------------ */

export async function simulateDecisionChange(
  decisionId: string,
  proposedChanges: ProposedChanges,
  projectId: string,
): Promise<SimulationResult> {
  const db = getDb();

  // 1. Get all agents for the project
  const agentsResult = await db.query(
    `SELECT * FROM agents WHERE project_id = ?`,
    [projectId],
  );
  const agents = agentsResult.rows as unknown as Agent[];

  // 2. Get the original decision
  const decResult = await db.query(
    `SELECT * FROM decisions WHERE id = ? AND project_id = ?`,
    [decisionId, projectId],
  );
  if (decResult.rows.length === 0) {
    throw new Error(`Decision not found: ${decisionId}`);
  }
  const originalDecision = decResult.rows[0] as unknown as Decision;

  // Parse JSON fields if needed
  if (typeof originalDecision.tags === 'string') {
    originalDecision.tags = JSON.parse(originalDecision.tags as unknown as string);
  }
  if (typeof originalDecision.affects === 'string') {
    originalDecision.affects = JSON.parse(originalDecision.affects as unknown as string);
  }

  // 3. Get ALL active decisions for the project
  const allDecResult = await db.query(
    `SELECT * FROM decisions WHERE project_id = ? AND status = 'active'`,
    [projectId],
  );
  const allDecisions = (allDecResult.rows as unknown as Decision[]).map((d) => {
    if (typeof d.tags === 'string') d.tags = JSON.parse(d.tags as unknown as string);
    if (typeof d.affects === 'string') d.affects = JSON.parse(d.affects as unknown as string);
    return d;
  });

  // 4. Build proposed decision
  const proposedDecision = buildProposedDecision(originalDecision, proposedChanges);

  // 5. For each agent: score original and proposed, compute rank changes
  const agentImpacts: AgentImpact[] = [];
  const newlyReached: string[] = [];
  const lost: string[] = [];

  for (const agent of agents) {
    // Parse relevance_profile if it's a string
    if (typeof agent.relevance_profile === 'string') {
      agent.relevance_profile = JSON.parse(agent.relevance_profile as unknown as string);
    }

    // Score ALL decisions for this agent (original set)
    const originalScores = allDecisions.map((d) =>
      scoreDecision(d, agent, ZERO_VECTOR),
    );

    // Score ALL decisions with proposed change swapped in
    const proposedDecisions = allDecisions.map((d) =>
      d.id === decisionId ? proposedDecision : d,
    );
    const proposedScores = proposedDecisions.map((d) =>
      scoreDecision(d, agent, ZERO_VECTOR),
    );

    // Get rank of target decision in both sets
    const origRank = getRank(decisionId, originalScores);
    const propRank = getRank(decisionId, proposedScores);

    const scoreDelta = propRank.score - origRank.score;
    const rankDelta = origRank.rank - propRank.rank; // positive = improved

    // Track newly reached/lost
    const MIN_SCORE = 0.50;
    if (origRank.score < MIN_SCORE && propRank.score >= MIN_SCORE) {
      newlyReached.push(agent.name);
    }
    if (origRank.score >= MIN_SCORE && propRank.score < MIN_SCORE) {
      lost.push(agent.name);
    }

    agentImpacts.push({
      agent_id: agent.id,
      agent_name: agent.name,
      agent_role: agent.role,
      original_rank: origRank.rank,
      proposed_rank: propRank.rank,
      original_score: Math.round(origRank.score * 1000) / 1000,
      proposed_score: Math.round(propRank.score * 1000) / 1000,
      score_delta: Math.round(scoreDelta * 1000) / 1000,
      rank_delta: rankDelta,
    });
  }

  // 6. Summary
  const affected = agentImpacts.filter((a) => a.score_delta !== 0);
  const improved = agentImpacts.filter((a) => a.score_delta > 0);
  const degraded = agentImpacts.filter((a) => a.score_delta < 0);

  // 7. Check contradictions
  const contradictionWarnings = checkProposedContradictions(proposedDecision, allDecisions);

  // 8. Check cascade
  const cascadeEdges = await findCascadeImpact(decisionId, projectId);

  // 9. Generate warnings
  const warnings: SimulationWarning[] = [...contradictionWarnings];

  // Warn about significant rank drops
  for (const impact of agentImpacts) {
    if (impact.rank_delta < -3) {
      warnings.push({
        type: 'rank_drop',
        message: `"${impact.agent_name}" drops ${Math.abs(impact.rank_delta)} ranks (${impact.original_rank} → ${impact.proposed_rank})`,
        severity: impact.rank_delta < -5 ? 'critical' : 'warning',
      });
    }
  }

  // Warn about lost agents
  for (const name of lost) {
    warnings.push({
      type: 'lost_agent',
      message: `"${name}" would no longer receive this decision in context`,
      severity: 'warning',
    });
  }

  // Warn about cascade risk
  if (cascadeEdges.length > 3) {
    warnings.push({
      type: 'cascade_risk',
      message: `This decision has ${cascadeEdges.length} edges — changes may cascade`,
      severity: 'warning',
    });
  }

  return {
    simulation_id: `sim_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    original_decision: originalDecision,
    proposed_decision: proposedDecision,
    agent_impacts: agentImpacts,
    summary: {
      total_agents: agents.length,
      agents_affected: affected.length,
      agents_improved: improved.length,
      agents_degraded: degraded.length,
      agents_unchanged: agents.length - affected.length,
      newly_reached: newlyReached,
      lost,
    },
    warnings,
    cascade_edges: cascadeEdges,
  };
}

/* ------------------------------------------------------------------ */
/*  Historical impact (optional — compile_history may not exist)       */
/* ------------------------------------------------------------------ */

export async function simulateHistoricalImpact(
  decisionId: string,
  proposedChanges: ProposedChanges,
  projectId: string,
  lookbackDays: number = 30,
): Promise<HistoricalImpact | null> {
  const db = getDb();
  try {
    const lookbackClause = db.dialect === 'sqlite'
      ? `compiled_at >= datetime('now', '-${lookbackDays} days')`
      : `compiled_at >= NOW() - INTERVAL '${lookbackDays} days'`;
    const result = await db.query(
      `SELECT agent_name, decision_ids, decision_scores
       FROM compile_history
       WHERE project_id = ?
         AND ${lookbackClause}
       ORDER BY compiled_at DESC`,
      [projectId],
    );

    if (result.rows.length === 0) return null;

    let appearances = 0;
    const agentSet = new Set<string>();
    let totalScore = 0;

    for (const row of result.rows) {
      const r = row as Record<string, unknown>;
      const ids: string[] = typeof r.decision_ids === 'string'
        ? JSON.parse(r.decision_ids as string)
        : (r.decision_ids as string[]) ?? [];
      const scores: number[] = typeof r.decision_scores === 'string'
        ? JSON.parse(r.decision_scores as string)
        : (r.decision_scores as number[]) ?? [];

      const idx = ids.indexOf(decisionId);
      if (idx !== -1) {
        appearances++;
        agentSet.add(r.agent_name as string);
        totalScore += scores[idx] ?? 0;
      }
    }

    return {
      lookback_days: lookbackDays,
      compile_appearances: appearances,
      agents_that_received: [...agentSet],
      avg_score: appearances > 0 ? Math.round((totalScore / appearances) * 1000) / 1000 : 0,
    };
  } catch {
    // compile_history table may not exist
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Expanded simulation: multi-decision, cascade, rollback             */
/* ------------------------------------------------------------------ */

export interface DecisionChange {
  decision_id: string;
  proposed_changes: ProposedChanges;
}

export interface MultiChangeInteraction {
  decision_a: string;
  decision_b: string;
  kind: 'shared_domain' | 'shared_tags' | 'shared_affects';
  details: string;
}

export interface MultiChangeResult {
  individual: SimulationResult[];
  combined: {
    total_agents_affected: number;
    total_agents_improved: number;
    total_agents_degraded: number;
    agents_net_impact: Record<string, number>;
    warnings: SimulationWarning[];
  };
  interactions: MultiChangeInteraction[];
}

export interface CascadeNode {
  decision_id: string;
  title: string;
  depth: number;
  estimated_effect: 'high' | 'medium' | 'low';
  relationship: string;
}

export interface CascadeResult {
  direct_impact: {
    decision_id: string;
    agent_impacts_count: number;
    degraded: number;
    improved: number;
  };
  cascade: CascadeNode[];
  total_affected_decisions: number;
}

export interface RollbackRisk {
  decision_id: string;
  title: string;
  reason: string;
  severity: 'info' | 'warning' | 'critical';
}

export interface RollbackResult {
  original_decision: Decision;
  rollback_to: Decision | null;
  contradiction_risks: RollbackRisk[];
  agents_affected: string[];
  estimated_impact: {
    agents_gaining_context: number;
    agents_losing_context: number;
    net_score_delta: number;
  };
}

/* ------------------------------------------------------------------ */
/*  simulateMultiDecisionChange                                         */
/* ------------------------------------------------------------------ */

export async function simulateMultiDecisionChange(
  projectId: string,
  changes: DecisionChange[],
): Promise<MultiChangeResult> {
  if (!changes || changes.length === 0) {
    return {
      individual: [],
      combined: {
        total_agents_affected: 0,
        total_agents_improved: 0,
        total_agents_degraded: 0,
        agents_net_impact: {},
        warnings: [],
      },
      interactions: [],
    };
  }

  // Run all individual simulations in parallel
  const individual = await Promise.all(
    changes.map((c) =>
      simulateDecisionChange(c.decision_id, c.proposed_changes, projectId),
    ),
  );

  // Compute combined impact: sum per-agent score deltas across all simulations
  const agentsNetImpact: Record<string, number> = {};
  let totalAffected = 0;
  let totalImproved = 0;
  let totalDegraded = 0;
  const combinedWarnings: SimulationWarning[] = [];

  for (const sim of individual) {
    for (const imp of sim.agent_impacts) {
      const prev = agentsNetImpact[imp.agent_name] ?? 0;
      agentsNetImpact[imp.agent_name] = Math.round((prev + imp.score_delta) * 1000) / 1000;
    }
    totalAffected += sim.summary.agents_affected;
    totalImproved += sim.summary.agents_improved;
    totalDegraded += sim.summary.agents_degraded;
    combinedWarnings.push(...sim.warnings);
  }

  // Detect interactions: shared tags / domain / affects between changed decisions
  const interactions: MultiChangeInteraction[] = [];
  for (let i = 0; i < individual.length; i++) {
    for (let j = i + 1; j < individual.length; j++) {
      const a = individual[i].proposed_decision;
      const b = individual[j].proposed_decision;

      // Shared tags
      const aTags = new Set((a.tags ?? []) as string[]);
      const bTags = (b.tags ?? []) as string[];
      const sharedTags = bTags.filter((t) => aTags.has(t));
      if (sharedTags.length > 0) {
        interactions.push({
          decision_a: a.id,
          decision_b: b.id,
          kind: 'shared_tags',
          details: `Share ${sharedTags.length} tag(s): ${sharedTags.slice(0, 3).join(', ')}`,
        });
      }

      // Shared affects
      const aAffects = new Set((a.affects ?? []) as string[]);
      const bAffects = (b.affects ?? []) as string[];
      const sharedAffects = bAffects.filter((t) => aAffects.has(t));
      if (sharedAffects.length > 0) {
        interactions.push({
          decision_a: a.id,
          decision_b: b.id,
          kind: 'shared_affects',
          details: `Share ${sharedAffects.length} affected area(s): ${sharedAffects.slice(0, 3).join(', ')}`,
        });
      }

      // Shared domain (if present)
      if (a.domain && b.domain && a.domain === b.domain) {
        interactions.push({
          decision_a: a.id,
          decision_b: b.id,
          kind: 'shared_domain',
          details: `Both belong to domain "${a.domain}"`,
        });
      }
    }
  }

  // Raise a cascade_risk warning if many interactions
  if (interactions.length >= 3) {
    combinedWarnings.push({
      type: 'cascade_risk',
      message: `${interactions.length} interactions detected between changed decisions — combined effect may be non-linear`,
      severity: 'warning',
    });
  }

  return {
    individual,
    combined: {
      total_agents_affected: totalAffected,
      total_agents_improved: totalImproved,
      total_agents_degraded: totalDegraded,
      agents_net_impact: agentsNetImpact,
      warnings: combinedWarnings,
    },
    interactions,
  };
}

/* ------------------------------------------------------------------ */
/*  simulateCascadeImpact                                               */
/* ------------------------------------------------------------------ */

const CASCADE_MAX_DEPTH = 3;

function classifyRelationshipEffect(
  relationship: string,
): 'high' | 'medium' | 'low' {
  const r = relationship.toLowerCase();
  if (r === 'supersedes' || r === 'contradicts' || r === 'reverts') return 'high';
  if (r === 'requires' || r === 'depends_on' || r === 'blocks') return 'high';
  if (r === 'refines' || r === 'enables') return 'medium';
  return 'low';
}

export async function simulateCascadeImpact(
  projectId: string,
  decisionId: string,
  proposedChanges: ProposedChanges,
): Promise<CascadeResult> {
  const db = getDb();

  // 1. Compute direct impact
  const directSim = await simulateDecisionChange(decisionId, proposedChanges, projectId);

  // 2. BFS through decision_edges up to depth 3
  const cascade: CascadeNode[] = [];
  const visited = new Set<string>([decisionId]);
  let frontier: Array<{ id: string; depth: number }> = [{ id: decisionId, depth: 0 }];

  for (let depth = 1; depth <= CASCADE_MAX_DEPTH; depth++) {
    const nextFrontier: Array<{ id: string; depth: number }> = [];

    for (const node of frontier) {
      let edges: Array<Record<string, unknown>>;
      try {
        const res = await db.query<Record<string, unknown>>(
          `SELECT source_id, target_id, relationship
           FROM decision_edges
           WHERE source_id = ? OR target_id = ?`,
          [node.id, node.id],
        );
        edges = res.rows;
      } catch {
        edges = [];
      }

      for (const edge of edges) {
        const sourceId = edge.source_id as string;
        const targetId = edge.target_id as string;
        const relationship = (edge.relationship as string) ?? '';
        const neighborId = sourceId === node.id ? targetId : sourceId;
        if (visited.has(neighborId)) continue;
        visited.add(neighborId);

        // Look up neighbor metadata
        const neighborRes = await db.query<Record<string, unknown>>(
          `SELECT id, title FROM decisions
           WHERE id = ? AND project_id = ?`,
          [neighborId, projectId],
        );
        if (neighborRes.rows.length === 0) continue;

        const row = neighborRes.rows[0];
        const baseEffect = classifyRelationshipEffect(relationship);
        // Attenuate by depth: each hop downgrades the effect by one notch
        let effect: 'high' | 'medium' | 'low' = baseEffect;
        if (depth >= 2 && effect === 'high') effect = 'medium';
        if (depth >= 3 && effect === 'medium') effect = 'low';

        cascade.push({
          decision_id: neighborId,
          title: (row.title as string) ?? '',
          depth,
          estimated_effect: effect,
          relationship,
        });
        nextFrontier.push({ id: neighborId, depth });
      }
    }

    frontier = nextFrontier;
    if (frontier.length === 0) break;
  }

  return {
    direct_impact: {
      decision_id: decisionId,
      agent_impacts_count: directSim.agent_impacts.length,
      degraded: directSim.summary.agents_degraded,
      improved: directSim.summary.agents_improved,
    },
    cascade,
    total_affected_decisions: cascade.length,
  };
}

/* ------------------------------------------------------------------ */
/*  simulateRollback                                                    */
/* ------------------------------------------------------------------ */

export async function simulateRollback(
  projectId: string,
  decisionId: string,
): Promise<RollbackResult> {
  const db = getDb();

  // 1. Fetch the decision
  const decRes = await db.query<Record<string, unknown>>(
    `SELECT * FROM decisions WHERE id = ? AND project_id = ?`,
    [decisionId, projectId],
  );
  if (decRes.rows.length === 0) {
    throw new Error(`Decision not found: ${decisionId}`);
  }
  const originalRow = decRes.rows[0];
  const originalDecision = originalRow as unknown as Decision;
  if (typeof originalDecision.tags === 'string') {
    originalDecision.tags = JSON.parse(originalDecision.tags as unknown as string);
  }
  if (typeof originalDecision.affects === 'string') {
    originalDecision.affects = JSON.parse(originalDecision.affects as unknown as string);
  }

  // 2. Find the decision that this one superseded
  let rollbackTo: Decision | null = null;
  const supersedesId = (originalRow.supersedes_id as string | null | undefined) ?? null;
  if (supersedesId) {
    const prevRes = await db.query<Record<string, unknown>>(
      `SELECT * FROM decisions WHERE id = ? AND project_id = ?`,
      [supersedesId, projectId],
    );
    if (prevRes.rows.length > 0) {
      const prevRow = prevRes.rows[0];
      const prev = prevRow as unknown as Decision;
      if (typeof prev.tags === 'string') prev.tags = JSON.parse(prev.tags as unknown as string);
      if (typeof prev.affects === 'string') prev.affects = JSON.parse(prev.affects as unknown as string);
      rollbackTo = prev;
    }
  }

  // 3. Check for contradiction risks that would re-emerge
  const contradictionRisks: RollbackRisk[] = [];
  if (rollbackTo) {
    // Any active decisions that share tags or affects with the rolled-back
    // decision AND have similar titles (heuristic) could re-collide.
    const rbTags = (rollbackTo.tags ?? []) as string[];
    const rbAffects = (rollbackTo.affects ?? []) as string[];

    const activeRes = await db.query<Record<string, unknown>>(
      `SELECT id, title, tags, affects FROM decisions
       WHERE project_id = ? AND status = 'active' AND id != ? AND id != ?`,
      [projectId, rollbackTo.id, decisionId],
    );

    for (const row of activeRes.rows) {
      const rowTags = parseTagList(row.tags);
      const rowAffects = parseTagList(row.affects);
      const sharedTags = rbTags.filter((t) => rowTags.includes(t));
      const sharedAffects = rbAffects.filter((a) => rowAffects.includes(a));

      if (sharedTags.length >= 2 || sharedAffects.length >= 2) {
        contradictionRisks.push({
          decision_id: row.id as string,
          title: (row.title as string) ?? '',
          reason: `Shares ${sharedTags.length} tag(s) and ${sharedAffects.length} affected area(s) with rollback target`,
          severity: sharedTags.length + sharedAffects.length >= 4 ? 'critical' : 'warning',
        });
      }
    }
  }

  // 4. Identify agents affected: run a simulation pretending the
  //    original decision is "gone" (we use the rollback-target's fields
  //    if available, otherwise a minimal change that removes the title).
  let agentsAffected: string[] = [];
  let agentsGaining = 0;
  let agentsLosing = 0;
  let netScoreDelta = 0;

  try {
    const proposedChanges: ProposedChanges = rollbackTo
      ? {
          title: rollbackTo.title,
          description: rollbackTo.description,
          tags: rollbackTo.tags,
          affects: rollbackTo.affects,
        }
      : {
          // If there's nothing to roll back to, simulate removal by
          // clearing the description; score will drop for everyone.
          description: '',
          tags: [],
          affects: [],
        };

    const sim = await simulateDecisionChange(decisionId, proposedChanges, projectId);
    for (const imp of sim.agent_impacts) {
      if (imp.score_delta !== 0) {
        agentsAffected.push(imp.agent_name);
        netScoreDelta += imp.score_delta;
      }
      if (imp.score_delta > 0) agentsGaining++;
      if (imp.score_delta < 0) agentsLosing++;
    }
  } catch {
    // Simulation may fail if the decision is missing from active set;
    // fall back to zero impact — we still return meta info.
    agentsAffected = [];
  }

  return {
    original_decision: originalDecision,
    rollback_to: rollbackTo,
    contradiction_risks: contradictionRisks,
    agents_affected: agentsAffected,
    estimated_impact: {
      agents_gaining_context: agentsGaining,
      agents_losing_context: agentsLosing,
      net_score_delta: Math.round(netScoreDelta * 1000) / 1000,
    },
  };
}

function parseTagList(val: unknown): string[] {
  if (!val) return [];
  if (Array.isArray(val)) return val as string[];
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      return Array.isArray(parsed) ? (parsed as string[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}
