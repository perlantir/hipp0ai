/**
 * Feature 10: Autonomous Decision Evolution
 *
 * Detects underperforming decisions and generates improved versions
 * with impact predictions for human approval.
 */
import { getDb } from '../db/index.js';
import { EVOLUTION_SYSTEM_PROMPT } from '../config/prompts/evolution.js';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface EvolutionCandidate {
  decision_id: string;
  project_id: string;
  title: string;
  description: string;
  reasoning: string;
  tags: string[];
  affects: string[];
  trigger_reason: string;
  trigger_data: Record<string, unknown>;
}

export interface EvolutionProposal {
  title: string;
  description: string;
  reasoning: string;
  tags: string[];
  affects: string[];
  change_type: 'refine' | 'redirect' | 'reaffirm' | 'deprecate';
  predicted_impact: {
    alignment_improvement_estimate: number;
    contradictions_resolved: number;
    agents_newly_affected: string[];
    risk_level: 'low' | 'medium' | 'high';
    confidence: 'high' | 'medium' | 'low';
  };
}

export interface SimulationResult {
  compiles_analyzed: number;
  avg_score_improvement: number;
  rank_changes: Array<{ agent: string; old_rank: number; new_rank: number }>;
  affected_agents: string[];
}

/* ------------------------------------------------------------------ */
/*  1. Find Evolution Candidates                                       */
/* ------------------------------------------------------------------ */

export async function findEvolutionCandidates(
  projectId: string,
): Promise<EvolutionCandidate[]> {
  const db = getDb();
  const candidates: EvolutionCandidate[] = [];

  // Get IDs of decisions that already have pending proposals (skip them)
  let pendingIds: string[] = [];
  try {
    const pending = await db.query(
      `SELECT original_decision_id FROM decision_evolution_proposals
       WHERE project_id = ? AND status = 'proposed'`,
      [projectId],
    );
    pendingIds = pending.rows.map(
      (r) => (r as Record<string, unknown>).original_decision_id as string,
    );
  } catch {
    // table may not exist yet
  }

  const pendingSet = new Set(pendingIds);

  // Trigger 1: Low alignment — decisions with low outcome alignment scores
  try {
    const lowAlignment = await db.query(
      `SELECT d.id, d.title, d.description, d.reasoning, d.tags, d.affects, d.domain,
              AVG(co.alignment_score) as avg_alignment
       FROM decisions d
       JOIN compile_history ch ON d.project_id = ch.project_id AND d.id = ANY(ch.decision_ids)
       JOIN compile_outcomes co ON co.compile_history_id = ch.id
       WHERE d.project_id = ? AND d.status = 'active'
         AND co.alignment_score IS NOT NULL
       GROUP BY d.id, d.title, d.description, d.reasoning, d.tags, d.affects, d.domain
       HAVING AVG(co.alignment_score) < 0.5
       ORDER BY AVG(co.alignment_score) ASC
       LIMIT 5`,
      [projectId],
    );
    for (const row of lowAlignment.rows) {
      const r = row as Record<string, unknown>;
      const id = r.id as string;
      if (pendingSet.has(id)) continue;
      candidates.push({
        decision_id: id,
        project_id: projectId,
        title: r.title as string,
        description: r.description as string,
        reasoning: r.reasoning as string,
        tags: (r.tags as string[]) ?? [],
        affects: (r.affects as string[]) ?? [],
        trigger_reason: 'low_alignment',
        trigger_data: { avg_alignment: parseFloat(String(r.avg_alignment)), domain: r.domain ?? null },
      });
      pendingSet.add(id);
    }
  } catch (err) {
    console.warn('[hipp0/evolution] Low alignment query failed:', (err as Error).message);
  }

  // Trigger 2: Frequently contradicted
  try {
    const contradicted = await db.query(
      `SELECT d.id, d.title, d.description, d.reasoning, d.tags, d.affects,
              COUNT(c.id) as contradiction_count
       FROM decisions d
       JOIN contradictions c ON (c.decision_a_id = d.id OR c.decision_b_id = d.id)
       WHERE d.project_id = ? AND d.status = 'active' AND c.status = 'unresolved'
       GROUP BY d.id, d.title, d.description, d.reasoning, d.tags, d.affects
       HAVING COUNT(c.id) >= 2
       ORDER BY COUNT(c.id) DESC
       LIMIT 5`,
      [projectId],
    );
    for (const row of contradicted.rows) {
      const r = row as Record<string, unknown>;
      const id = r.id as string;
      if (pendingSet.has(id)) continue;
      candidates.push({
        decision_id: id,
        project_id: projectId,
        title: r.title as string,
        description: r.description as string,
        reasoning: r.reasoning as string,
        tags: (r.tags as string[]) ?? [],
        affects: (r.affects as string[]) ?? [],
        trigger_reason: 'frequently_contradicted',
        trigger_data: { contradiction_count: parseInt(String(r.contradiction_count), 10) },
      });
      pendingSet.add(id);
    }
  } catch (err) {
    console.warn('[hipp0/evolution] Contradiction query failed:', (err as Error).message);
  }

  // Trigger 3: Frequently superseded (has been superseded multiple times)
  try {
    const superseded = await db.query(
      `SELECT d.id, d.title, d.description, d.reasoning, d.tags, d.affects,
              COUNT(e.id) as supersede_count
       FROM decisions d
       JOIN decision_edges e ON e.source_id = d.id AND e.relationship = 'supersedes'
       WHERE d.project_id = ? AND d.status = 'active'
       GROUP BY d.id, d.title, d.description, d.reasoning, d.tags, d.affects
       HAVING COUNT(e.id) >= 2
       ORDER BY COUNT(e.id) DESC
       LIMIT 5`,
      [projectId],
    );
    for (const row of superseded.rows) {
      const r = row as Record<string, unknown>;
      const id = r.id as string;
      if (pendingSet.has(id)) continue;
      candidates.push({
        decision_id: id,
        project_id: projectId,
        title: r.title as string,
        description: r.description as string,
        reasoning: r.reasoning as string,
        tags: (r.tags as string[]) ?? [],
        affects: (r.affects as string[]) ?? [],
        trigger_reason: 'frequently_superseded',
        trigger_data: { supersede_count: parseInt(String(r.supersede_count), 10) },
      });
      pendingSet.add(id);
    }
  } catch (err) {
    console.warn('[hipp0/evolution] Superseded query failed:', (err as Error).message);
  }

  // Trigger 4: Stale decisions (stale = true and no recent validation)
  try {
    const stale = await db.query(
      `SELECT id, title, description, reasoning, tags, affects, domain,
              created_at, last_referenced_at, validated_at
       FROM decisions
       WHERE project_id = ? AND status = 'active' AND stale = true
         AND (validated_at IS NULL OR validated_at < ${db.dialect === 'sqlite' ? "datetime('now', '-60 days')" : "NOW() - INTERVAL '60 days'"})
       ORDER BY COALESCE(last_referenced_at, created_at) ASC
       LIMIT 5`,
      [projectId],
    );
    for (const row of stale.rows) {
      const r = row as Record<string, unknown>;
      const id = r.id as string;
      if (pendingSet.has(id)) continue;
      candidates.push({
        decision_id: id,
        project_id: projectId,
        title: r.title as string,
        description: r.description as string,
        reasoning: r.reasoning as string,
        tags: (r.tags as string[]) ?? [],
        affects: (r.affects as string[]) ?? [],
        trigger_reason: 'stale',
        trigger_data: {
          last_referenced_at: r.last_referenced_at ?? null,
          validated_at: r.validated_at ?? null,
          created_at: r.created_at,
          domain: r.domain ?? null,
        },
      });
      pendingSet.add(id);
    }
  } catch (err) {
    console.warn('[hipp0/evolution] Stale query failed:', (err as Error).message);
  }

  // Trigger 5: Supersession candidates — newer decisions in same domain
  try {
    const supersessionCandidates = await db.query(
      `SELECT d.id, d.title, d.description, d.reasoning, d.tags, d.affects, d.domain,
              d.created_at, d.confidence,
              newer.id as newer_id, newer.title as newer_title, newer.confidence as newer_confidence
       FROM decisions d
       JOIN decisions newer ON newer.project_id = d.project_id
         AND newer.domain = d.domain
         AND newer.domain IS NOT NULL
         AND newer.created_at > d.created_at
         AND newer.status = 'active'
         AND newer.id != d.id
       WHERE d.project_id = ? AND d.status = 'active'
         AND (d.temporal_scope IS NULL OR d.temporal_scope NOT IN ('deprecated'))
       ORDER BY d.created_at ASC
       LIMIT 5`,
      [projectId],
    );
    for (const row of supersessionCandidates.rows) {
      const r = row as Record<string, unknown>;
      const id = r.id as string;
      if (pendingSet.has(id)) continue;
      candidates.push({
        decision_id: id,
        project_id: projectId,
        title: r.title as string,
        description: r.description as string,
        reasoning: r.reasoning as string,
        tags: (r.tags as string[]) ?? [],
        affects: (r.affects as string[]) ?? [],
        trigger_reason: 'supersession_candidate',
        trigger_data: {
          newer_decision_id: r.newer_id as string,
          newer_decision_title: r.newer_title as string,
          newer_confidence: r.newer_confidence as string,
          domain: r.domain ?? null,
        },
      });
      pendingSet.add(id);
    }
  } catch (err) {
    console.warn('[hipp0/evolution] Supersession candidate query failed:', (err as Error).message);
  }

  // Trigger 6: Sprint-scoped decisions expiring within 2 days
  try {
    const expiringSprint = await db.query(
      `SELECT id, title, description, reasoning, tags, affects, domain,
              created_at, valid_from, temporal_scope
       FROM decisions
       WHERE project_id = ? AND status = 'active' AND temporal_scope = 'sprint'
         AND created_at < ${db.dialect === 'sqlite' ? "datetime('now', '-12 days')" : "NOW() - INTERVAL '12 days'"}
       ORDER BY created_at ASC
       LIMIT 5`,
      [projectId],
    );
    for (const row of expiringSprint.rows) {
      const r = row as Record<string, unknown>;
      const id = r.id as string;
      if (pendingSet.has(id)) continue;
      candidates.push({
        decision_id: id,
        project_id: projectId,
        title: r.title as string,
        description: r.description as string,
        reasoning: r.reasoning as string,
        tags: (r.tags as string[]) ?? [],
        affects: (r.affects as string[]) ?? [],
        trigger_reason: 'sprint_expiring',
        trigger_data: {
          created_at: r.created_at,
          domain: r.domain ?? null,
          days_until_stale: Math.max(0, 14 - Math.floor((Date.now() - new Date(r.created_at as string).getTime()) / 86400000)),
        },
      });
      pendingSet.add(id);
    }
  } catch (err) {
    console.warn('[hipp0/evolution] Sprint expiring query failed:', (err as Error).message);
  }

  // Max 5 candidates per run — prioritize candidates in recently active domains
  if (candidates.length > 5) {
    try {
      const recentDomains = await db.query(
        `SELECT domain, COUNT(*) as cnt FROM decisions
         WHERE project_id = ? AND domain IS NOT NULL AND created_at >= ${db.dialect === 'sqlite' ? "datetime('now', '-30 days')" : "NOW() - INTERVAL '30 days'"}
         GROUP BY domain ORDER BY cnt DESC LIMIT 3`,
        [projectId],
      );
      const activeDomains = new Set(
        recentDomains.rows.map((r) => (r as Record<string, unknown>).domain as string),
      );
      if (activeDomains.size > 0) {
        // Sort: same-domain candidates first, then by trigger severity
        candidates.sort((a, b) => {
          const aDomain = (a.trigger_data as Record<string, unknown>).domain as string | undefined;
          const bDomain = (b.trigger_data as Record<string, unknown>).domain as string | undefined;
          const aMatch = aDomain && activeDomains.has(aDomain) ? 1 : 0;
          const bMatch = bDomain && activeDomains.has(bDomain) ? 1 : 0;
          return bMatch - aMatch;
        });
      }
    } catch {
      // Domain prioritization is best-effort
    }
  }

  return candidates.slice(0, 5);
}

/* ------------------------------------------------------------------ */
/*  2. Generate Evolution Proposal                                     */
/* ------------------------------------------------------------------ */

export async function generateEvolutionProposal(
  candidate: EvolutionCandidate,
  projectId: string,
): Promise<EvolutionProposal> {
  const db = getDb();

  // Get contradictions for this decision
  let contradictions: Array<Record<string, unknown>> = [];
  try {
    const cResult = await db.query(
      `SELECT c.id, c.conflict_description, c.similarity_score,
              da.title as decision_a_title, db.title as decision_b_title
       FROM contradictions c
       JOIN decisions da ON da.id = c.decision_a_id
       JOIN decisions db ON db.id = c.decision_b_id
       WHERE (c.decision_a_id = ? OR c.decision_b_id = ?)
         AND c.status = 'unresolved'
       LIMIT 5`,
      [candidate.decision_id, candidate.decision_id],
    );
    contradictions = cResult.rows as Array<Record<string, unknown>>;
  } catch {
    // table may have different schema
  }

  // Get related decisions via edges
  let relatedDecisions: Array<Record<string, unknown>> = [];
  try {
    const edgeResult = await db.query(
      `SELECT d.id, d.title, d.description, e.relationship
       FROM decision_edges e
       JOIN decisions d ON (
         (e.source_id = ? AND d.id = e.target_id) OR
         (e.target_id = ? AND d.id = e.source_id)
       )
       WHERE d.status = 'active'
       LIMIT 10`,
      [candidate.decision_id, candidate.decision_id],
    );
    relatedDecisions = edgeResult.rows as Array<Record<string, unknown>>;
  } catch {
    // edge table may not exist
  }

  const prompt = JSON.stringify({
    original_decision: {
      title: candidate.title,
      description: candidate.description,
      reasoning: candidate.reasoning,
      tags: candidate.tags,
      affects: candidate.affects,
    },
    trigger_reason: candidate.trigger_reason,
    trigger_data: candidate.trigger_data,
    contradictions: contradictions.map((c) => ({
      conflict: c.conflict_description,
      between: [c.decision_a_title, c.decision_b_title],
      similarity: c.similarity_score,
    })),
    related_decisions: relatedDecisions.map((d) => ({
      title: d.title,
      description: d.description,
      relationship: d.relationship,
    })),
  }, null, 2);

  // Call LLM
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? '' });

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    system: EVOLUTION_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  });

  const block = response.content[0];
  const text = block?.type === 'text' ? block.text : '{}';

  // Parse JSON from response (handle potential markdown wrapping)
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  const parsed = JSON.parse(cleaned) as EvolutionProposal;

  // Validate required fields with defaults
  return {
    title: parsed.title || candidate.title,
    description: parsed.description || candidate.description,
    reasoning: parsed.reasoning || 'Automated improvement proposal',
    tags: Array.isArray(parsed.tags) ? parsed.tags : candidate.tags,
    affects: Array.isArray(parsed.affects) ? parsed.affects : candidate.affects,
    change_type: ['refine', 'redirect', 'reaffirm', 'deprecate'].includes(parsed.change_type)
      ? parsed.change_type
      : 'refine',
    predicted_impact: {
      alignment_improvement_estimate: parsed.predicted_impact?.alignment_improvement_estimate ?? 0,
      contradictions_resolved: parsed.predicted_impact?.contradictions_resolved ?? 0,
      agents_newly_affected: Array.isArray(parsed.predicted_impact?.agents_newly_affected)
        ? parsed.predicted_impact.agents_newly_affected
        : [],
      risk_level: (['low', 'medium', 'high'].includes(parsed.predicted_impact?.risk_level ?? '')
        ? parsed.predicted_impact.risk_level
        : 'low') as 'low' | 'medium' | 'high',
      confidence: (['high', 'medium', 'low'].includes(parsed.predicted_impact?.confidence ?? '')
        ? parsed.predicted_impact.confidence
        : 'medium') as 'high' | 'medium' | 'low',
    },
  };
}

/* ------------------------------------------------------------------ */
/*  3. Simulate Proposal Impact                                        */
/* ------------------------------------------------------------------ */

export async function simulateProposalImpact(
  originalDecisionId: string,
  proposal: EvolutionProposal,
  projectId: string,
): Promise<SimulationResult> {
  const db = getDb();
  const result: SimulationResult = {
    compiles_analyzed: 0,
    avg_score_improvement: 0,
    rank_changes: [],
    affected_agents: [],
  };

  try {
    // Get recent compiles that included this decision
    const compiles = await db.query(
      `SELECT ch.id, ch.agent_name, ch.decision_scores, co.alignment_score
       FROM compile_history ch
       LEFT JOIN compile_outcomes co ON co.compile_history_id = ch.id
       WHERE ch.project_id = ? AND ? = ANY(ch.decision_ids)
       ORDER BY ch.compiled_at DESC
       LIMIT 20`,
      [projectId, originalDecisionId],
    );

    result.compiles_analyzed = compiles.rows.length;

    if (compiles.rows.length === 0) return result;

    // Collect affected agents
    const agentSet = new Set<string>();
    let totalImprovement = 0;

    for (const row of compiles.rows) {
      const r = row as Record<string, unknown>;
      const agentName = r.agent_name as string;
      agentSet.add(agentName);

      const alignmentScore = r.alignment_score != null
        ? parseFloat(String(r.alignment_score))
        : 0.5;

      // Estimate improvement based on predicted impact
      const estimatedImprovement = proposal.predicted_impact.alignment_improvement_estimate * 0.5;
      totalImprovement += Math.min(estimatedImprovement, 1.0 - alignmentScore);
    }

    result.affected_agents = Array.from(agentSet);
    result.avg_score_improvement = compiles.rows.length > 0
      ? totalImprovement / compiles.rows.length
      : 0;

    // Calculate rank changes for each agent (simplified)
    for (const agent of result.affected_agents) {
      const agentCompiles = compiles.rows.filter(
        (r) => (r as Record<string, unknown>).agent_name === agent,
      );
      if (agentCompiles.length > 0) {
        const currentScore = parseFloat(
          String((agentCompiles[0] as Record<string, unknown>).alignment_score ?? 0.5),
        );
        const projectedScore = Math.min(
          currentScore + proposal.predicted_impact.alignment_improvement_estimate * 0.5,
          1.0,
        );
        // Rank is approximate — higher score = lower (better) rank number
        const oldRank = Math.round((1 - currentScore) * 10) + 1;
        const newRank = Math.round((1 - projectedScore) * 10) + 1;
        if (oldRank !== newRank) {
          result.rank_changes.push({ agent, old_rank: oldRank, new_rank: newRank });
        }
      }
    }
  } catch (err) {
    console.warn('[hipp0/evolution] Simulation failed:', (err as Error).message);
  }

  return result;
}
