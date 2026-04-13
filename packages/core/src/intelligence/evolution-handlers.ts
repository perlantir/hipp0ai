/**
 * Evolution Engine Phase 2 — Type-Specific Execution Handlers
 *
 * When a proposal is accepted, these handlers execute the actual changes
 * to the decision graph based on the proposal's trigger_type.
 */

import { getDb } from '../db/index.js';
import type { TriggerType } from './evolution-engine.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExecutionResult {
  executed_action: string;
  decisions_modified: string[];
  success: boolean;
}

export interface ProposalRecord {
  id: string;
  project_id: string;
  trigger_type: TriggerType;
  affected_decision_ids: string[];
  reasoning: string;
  suggested_action: string;
  resolution_notes?: string;
}

// ---------------------------------------------------------------------------
// 5-Signal Tag Overlap Scorer (for orphan linking)
// ---------------------------------------------------------------------------

interface DecisionSummary {
  id: string;
  title: string;
  description: string;
  tags: string[];
}

function computeTagRelevance(orphan: DecisionSummary, candidate: DecisionSummary): number {
  const orphanTags = new Set(orphan.tags.map(t => t.toLowerCase()));
  const candidateTags = new Set(candidate.tags.map(t => t.toLowerCase()));

  // Signal 1: Tag overlap (0–0.4)
  let sharedCount = 0;
  for (const t of orphanTags) {
    if (candidateTags.has(t)) sharedCount++;
  }
  const maxTags = Math.max(orphanTags.size, candidateTags.size, 1);
  const tagScore = Math.min(0.4, (sharedCount / maxTags) * 0.4);

  // Signal 2: Keyword match in title+description (0–0.25)
  const orphanWords = new Set(
    `${orphan.title} ${orphan.description}`.toLowerCase().split(/\W+/).filter(w => w.length > 3)
  );
  const candidateText = `${candidate.title} ${candidate.description}`.toLowerCase();
  let keywordHits = 0;
  for (const w of orphanWords) {
    if (candidateText.includes(w)) keywordHits++;
  }
  const keywordScore = Math.min(0.25, (keywordHits / Math.max(orphanWords.size, 1)) * 0.25);

  // Signal 3: Tag-in-title bonus (0–0.15)
  const titleLower = candidate.title.toLowerCase();
  let titleBonus = 0;
  for (const t of orphanTags) {
    if (titleLower.includes(t)) titleBonus += 0.05;
  }
  titleBonus = Math.min(0.15, titleBonus);

  // Signal 4: Description keyword overlap (0–0.15)
  const candidateWords = new Set(
    candidate.description.toLowerCase().split(/\W+/).filter(w => w.length > 3)
  );
  let descHits = 0;
  for (const w of orphanWords) {
    if (candidateWords.has(w)) descHits++;
  }
  const descScore = Math.min(0.15, (descHits / Math.max(orphanWords.size, 1)) * 0.15);

  // Signal 5: Shared tag count bonus (0–0.05)
  const sharedBonus = Math.min(0.05, sharedCount * 0.025);

  return tagScore + keywordScore + titleBonus + descScore + sharedBonus;
}

/**
 * Find top-N related decisions for an orphan based on tag/keyword overlap.
 */
export async function findRelatedDecisions(
  orphanId: string,
  projectId: string,
  limit = 10,
): Promise<Array<{ id: string; title: string; score: number }>> {
  const db = getDb();

  // Fetch the orphan decision
  const orphanResult = await db.query<Record<string, unknown>>(
    `SELECT id, title, description, tags FROM decisions WHERE id = ?`,
    [orphanId],
  );
  if (orphanResult.rows.length === 0) return [];
  const orphanRow = orphanResult.rows[0];
  const orphan: DecisionSummary = {
    id: orphanRow.id as string,
    title: orphanRow.title as string,
    description: (orphanRow.description as string) || '',
    tags: parseTags(orphanRow.tags),
  };

  // Fetch all other active decisions in the project
  const candidatesResult = await db.query<Record<string, unknown>>(
    `SELECT id, title, description, tags FROM decisions
     WHERE project_id = ? AND status = 'active' AND id != ?`,
    [projectId, orphanId],
  );

  const scored: Array<{ id: string; title: string; score: number }> = [];
  for (const row of candidatesResult.rows) {
    const candidate: DecisionSummary = {
      id: row.id as string,
      title: row.title as string,
      description: (row.description as string) || '',
      tags: parseTags(row.tags),
    };
    const score = computeTagRelevance(orphan, candidate);
    if (score > 0) {
      scored.push({ id: candidate.id, title: candidate.title, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

function parseTags(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return []; }
  }
  return [];
}

// ---------------------------------------------------------------------------
// Handler: Orphaned Decision
// ---------------------------------------------------------------------------

export async function handleOrphanedDecision(proposal: ProposalRecord): Promise<ExecutionResult> {
  const db = getDb();
  const decisionId = proposal.affected_decision_ids[0];
  if (!decisionId) {
    return { executed_action: 'No decision ID found', decisions_modified: [], success: false };
  }

  const related = await findRelatedDecisions(decisionId, proposal.project_id);
  const matches = related.filter(r => r.score >= 0.4);

  if (matches.length >= 2) {
    // Auto-link: create edges to matching decisions
    const edgesCreated: string[] = [];
    for (const match of matches) {
      const now = new Date().toISOString();
      await db.query(
        `INSERT INTO decision_edges (id, source_id, target_id, relationship, description, strength, created_at)
         VALUES (
           lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))),
           ?, ?, 'informs', ?, 0.7, ?
         )`,
        [decisionId, match.id, `Auto-linked by evolution engine (score: ${match.score.toFixed(2)})`, now],
      );
      edgesCreated.push(match.id);
    }
    const action = `Linked to ${edgesCreated.length} related decisions`;
    return { executed_action: action, decisions_modified: [decisionId, ...edgesCreated], success: true };
  } else {
    // Archive: no meaningful relationships found
    const now = new Date().toISOString();
    await db.query(
      `UPDATE decisions SET status = 'reverted', updated_at = ? WHERE id = ?`,
      [now, decisionId],
    );
    // Use metadata to track temporal_scope change
    await db.query(
      `UPDATE decisions SET metadata = json_set(COALESCE(metadata, '{}'), '$.archived_by', 'evolution_engine', '$.archived_at', ?) WHERE id = ?`,
      [now, decisionId],
    );
    const action = 'Archived — no related decisions found';
    return { executed_action: action, decisions_modified: [decisionId], success: true };
  }
}

// ---------------------------------------------------------------------------
// Handler: Stale Decision (stale_sprint / stale_quarter)
// ---------------------------------------------------------------------------

export async function handleStaleDecision(
  proposal: ProposalRecord,
  overrideText?: string,
): Promise<ExecutionResult> {
  const db = getDb();
  const decisionId = proposal.affected_decision_ids[0];
  if (!decisionId) {
    return { executed_action: 'No decision ID found', decisions_modified: [], success: false };
  }

  const now = new Date().toISOString();

  // Archive the stale decision
  await db.query(
    `UPDATE decisions SET status = 'superseded', updated_at = ? WHERE id = ?`,
    [now, decisionId],
  );

  // Set valid_until and archived metadata
  await db.query(
    `UPDATE decisions SET metadata = json_set(COALESCE(metadata, '{}'), '$.valid_until', ?, '$.archived_by', 'evolution_engine') WHERE id = ?`,
    [now, decisionId],
  );

  const decisionsModified = [decisionId];

  // If replacement text is provided, create a superseding decision
  const replacementText = overrideText || extractReplacementText(proposal.suggested_action);
  if (replacementText) {
    // Get the original decision to copy fields
    const original = await db.query<Record<string, unknown>>(
      `SELECT * FROM decisions WHERE id = ?`,
      [decisionId],
    );
    if (original.rows.length > 0) {
      const orig = original.rows[0];
      const newResult = await db.query<Record<string, unknown>>(
        `INSERT INTO decisions (
           id, project_id, title, description, reasoning, made_by,
           source, confidence, status, supersedes_id,
           alternatives_considered, affects, tags, assumptions,
           open_questions, dependencies, confidence_decay_rate, metadata, created_at, updated_at
         ) VALUES (
           lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))),
           ?, ?, ?, ?, ?,
           'auto_distilled', ?, 'active', ?,
           ?, ?, ?, ?,
           ?, ?, ?, ?, ?, ?
         ) RETURNING id`,
        [
          orig.project_id,
          `${orig.title} (updated)`,
          replacementText,
          `Supersedes stale decision. ${proposal.reasoning}`,
          orig.made_by,
          orig.confidence ?? 'medium',
          decisionId,
          orig.alternatives_considered ?? '[]',
          orig.affects ?? '[]',
          orig.tags ?? '[]',
          orig.assumptions ?? '[]',
          orig.open_questions ?? '[]',
          orig.dependencies ?? '[]',
          orig.confidence_decay_rate ?? 0,
          JSON.stringify({ created_by: 'evolution_engine' }),
          now,
          now,
        ],
      );
      if (newResult.rows.length > 0) {
        const newId = (newResult.rows[0] as Record<string, unknown>).id as string;
        decisionsModified.push(newId);
        // Update old decision's superseded_by
        await db.query(
          `UPDATE decisions SET metadata = json_set(COALESCE(metadata, '{}'), '$.superseded_by', ?) WHERE id = ?`,
          [newId, decisionId],
        );
        // Create supersedes edge
        await db.query(
          `INSERT INTO decision_edges (id, source_id, target_id, relationship, strength, created_at)
           VALUES (
             lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))),
             ?, ?, 'supersedes', 1.0, ?
           )`,
          [newId, decisionId, now],
        );
        return {
          executed_action: `Archived stale decision and created superseding decision ${newId}`,
          decisions_modified: decisionsModified,
          success: true,
        };
      }
    }
  }

  // Get how old it is
  const ageResult = await db.query<Record<string, unknown>>(
    `SELECT CAST(julianday(?) - julianday(created_at) AS INTEGER) as age_days FROM decisions WHERE id = ?`,
    [now, decisionId],
  );
  const ageDays = ageResult.rows.length > 0 ? (ageResult.rows[0] as Record<string, unknown>).age_days : '?';

  return {
    executed_action: `Archived stale decision (last updated ${ageDays} days ago)`,
    decisions_modified: decisionsModified,
    success: true,
  };
}

function extractReplacementText(suggestedAction: string): string | null {
  // Check if suggested_action contains replacement text (after a colon or "replace with:")
  const match = suggestedAction.match(/replace\s*(?:with)?:\s*(.+)/i);
  return match?.[1]?.trim() || null;
}

// ---------------------------------------------------------------------------
// Handler: Contradiction Resolution
// ---------------------------------------------------------------------------

export async function handleContradiction(
  proposal: ProposalRecord,
  overrideText?: string,
): Promise<ExecutionResult> {
  const db = getDb();
  const [decisionAId, decisionBId] = proposal.affected_decision_ids;
  if (!decisionAId || !decisionBId) {
    return { executed_action: 'Missing decision IDs', decisions_modified: [], success: false };
  }

  const now = new Date().toISOString();

  if (overrideText) {
    // Override: create a new decision that supersedes both
    const decisionA = await db.query<Record<string, unknown>>(
      `SELECT * FROM decisions WHERE id = ?`,
      [decisionAId],
    );
    if (decisionA.rows.length === 0) {
      return { executed_action: 'Decision A not found', decisions_modified: [], success: false };
    }
    const a = decisionA.rows[0];

    // Create superseding decision
    const newResult = await db.query<Record<string, unknown>>(
      `INSERT INTO decisions (
         id, project_id, title, description, reasoning, made_by,
         source, confidence, status, supersedes_id,
         alternatives_considered, affects, tags, assumptions,
         open_questions, dependencies, confidence_decay_rate, metadata, created_at, updated_at
       ) VALUES (
         lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))),
         ?, ?, ?, ?, ?,
         'auto_distilled', 'high', 'active', ?,
         '[]', ?, ?, '[]',
         '[]', '[]', 0, ?, ?, ?
       ) RETURNING id`,
      [
        a.project_id,
        `Resolution: ${overrideText.slice(0, 80)}`,
        overrideText,
        `Resolves contradiction between decisions. ${proposal.reasoning}`,
        'evolution_engine',
        decisionAId,
        a.affects ?? '[]',
        a.tags ?? '[]',
        JSON.stringify({ created_by: 'evolution_engine', resolves_contradiction: true }),
        now,
        now,
      ],
    );

    if (newResult.rows.length === 0) {
      return { executed_action: 'Failed to create superseding decision', decisions_modified: [], success: false };
    }
    const newId = (newResult.rows[0] as Record<string, unknown>).id as string;

    // Supersede both old decisions
    await db.query(
      `UPDATE decisions SET status = 'superseded', metadata = json_set(COALESCE(metadata, '{}'), '$.superseded_by', ?), updated_at = ? WHERE id = ?`,
      [newId, now, decisionAId],
    );
    await db.query(
      `UPDATE decisions SET status = 'superseded', metadata = json_set(COALESCE(metadata, '{}'), '$.superseded_by', ?), updated_at = ? WHERE id = ?`,
      [newId, now, decisionBId],
    );

    // Create supersedes edges
    for (const oldId of [decisionAId, decisionBId]) {
      await db.query(
        `INSERT INTO decision_edges (id, source_id, target_id, relationship, strength, created_at)
         VALUES (
           lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))),
           ?, ?, 'supersedes', 1.0, ?
         )`,
        [newId, oldId, now],
      );
    }

    // Resolve the contradiction record
    await db.query(
      `UPDATE contradictions SET status = 'resolved', resolved_by = 'evolution_engine', resolution = ?, resolved_at = ?
       WHERE (decision_a_id = ? AND decision_b_id = ?) OR (decision_a_id = ? AND decision_b_id = ?)
         AND status = 'unresolved'`,
      [overrideText, now, decisionAId, decisionBId, decisionBId, decisionAId],
    );

    return {
      executed_action: `Created superseding decision ${newId} resolving contradiction`,
      decisions_modified: [decisionAId, decisionBId, newId],
      success: true,
    };
  } else {
    // Plain accept: newer decision wins
    const resultA = await db.query<Record<string, unknown>>(
      `SELECT id, created_at FROM decisions WHERE id = ?`,
      [decisionAId],
    );
    const resultB = await db.query<Record<string, unknown>>(
      `SELECT id, created_at FROM decisions WHERE id = ?`,
      [decisionBId],
    );

    if (resultA.rows.length === 0 || resultB.rows.length === 0) {
      return { executed_action: 'One or both decisions not found', decisions_modified: [], success: false };
    }

    const aCreated = new Date((resultA.rows[0] as Record<string, unknown>).created_at as string).getTime();
    const bCreated = new Date((resultB.rows[0] as Record<string, unknown>).created_at as string).getTime();

    const olderId = aCreated <= bCreated ? decisionAId : decisionBId;
    const newerId = aCreated <= bCreated ? decisionBId : decisionAId;

    // Supersede the older decision
    await db.query(
      `UPDATE decisions SET status = 'superseded', metadata = json_set(COALESCE(metadata, '{}'), '$.superseded_by', ?), updated_at = ? WHERE id = ?`,
      [newerId, now, olderId],
    );

    // Resolve the contradiction record
    await db.query(
      `UPDATE contradictions SET status = 'resolved', resolved_by = 'evolution_engine', resolution = 'Newer decision wins', resolved_at = ?
       WHERE ((decision_a_id = ? AND decision_b_id = ?) OR (decision_a_id = ? AND decision_b_id = ?))
         AND status = 'unresolved'`,
      [now, decisionAId, decisionBId, decisionBId, decisionAId],
    );

    return {
      executed_action: `Newer decision wins — superseded older decision ${olderId.slice(0, 8)}`,
      decisions_modified: [olderId, newerId],
      success: true,
    };
  }
}

// ---------------------------------------------------------------------------
// Handler: Concentration Risk
// ---------------------------------------------------------------------------

export async function handleConcentrationRisk(proposal: ProposalRecord): Promise<ExecutionResult> {
  const db = getDb();
  const affectedIds = proposal.affected_decision_ids;
  if (affectedIds.length === 0) {
    return { executed_action: 'No affected decisions', decisions_modified: [], success: false };
  }

  const now = new Date().toISOString();

  // Flag all affected decisions with needs_cross_review metadata
  for (const id of affectedIds) {
    await db.query(
      `UPDATE decisions SET
         metadata = json_set(COALESCE(metadata, '{}'), '$.needs_cross_review', json('true'), '$.flagged_by', 'evolution_engine'),
         review_status = 'pending',
         updated_at = ?
       WHERE id = ?`,
      [now, id],
    );
  }

  // Extract domain and agent info from reasoning
  const domainMatch = proposal.reasoning.match(/"([^"]+)" domain/);
  const agentMatch = proposal.reasoning.match(/by "([^"]+)"/);
  const domain = domainMatch?.[1] ?? 'unknown';
  const agent = agentMatch?.[1] ?? 'unknown';

  const action = `Flagged ${affectedIds.length} decisions for cross-review`;
  const note = `${affectedIds.length}+ decisions in ${domain} made by ${agent} with no second opinion — cross-review recommended`;

  // Store the review note in resolution_notes for the proposal
  await db.query(
    `UPDATE evolution_proposals SET resolution_notes = ? WHERE id = ?`,
    [note, proposal.id],
  );

  return { executed_action: action, decisions_modified: affectedIds, success: true };
}

// ---------------------------------------------------------------------------
// Handler: High-Impact Unvalidated
// ---------------------------------------------------------------------------

export async function handleHighImpactUnvalidated(proposal: ProposalRecord): Promise<ExecutionResult> {
  const db = getDb();
  const affectedIds = proposal.affected_decision_ids;
  if (affectedIds.length === 0) {
    return { executed_action: 'No affected decisions', decisions_modified: [], success: false };
  }

  const now = new Date().toISOString();

  for (const id of affectedIds) {
    // Count downstream dependencies
    const depsResult = await db.query<Record<string, unknown>>(
      `SELECT COUNT(*) as cnt FROM decision_edges WHERE target_id = ?`,
      [id],
    );
    const downstreamCount = Number((depsResult.rows[0] as Record<string, unknown>)?.cnt ?? 0);

    // Flag for urgent validation with priority metadata
    await db.query(
      `UPDATE decisions SET
         metadata = json_set(COALESCE(metadata, '{}'), '$.validation_requested', json('true'), '$.downstream_count', ?, '$.validation_priority', 'high'),
         review_status = 'pending',
         updated_at = ?
       WHERE id = ?`,
      [downstreamCount, now, id],
    );
  }

  // Get downstream count from reasoning for the action label
  const depsMatch = proposal.reasoning.match(/(\d+) downstream/);
  const depsCount = depsMatch?.[1] ?? '?';

  const action = `Queued for urgent validation — ${depsCount} downstream dependencies`;
  return { executed_action: action, decisions_modified: affectedIds, success: true };
}

// ---------------------------------------------------------------------------
// Master Handler Dispatcher
// ---------------------------------------------------------------------------

export async function executeProposalHandler(
  proposal: ProposalRecord,
  overrideText?: string,
  executedBy?: string,
): Promise<ExecutionResult> {
  let result: ExecutionResult;

  switch (proposal.trigger_type) {
    case 'orphaned_decision':
      result = await handleOrphanedDecision(proposal);
      break;
    case 'stale_sprint':
    case 'stale_quarter':
      result = await handleStaleDecision(proposal, overrideText);
      break;
    case 'unresolved_contradiction':
      result = await handleContradiction(proposal, overrideText);
      break;
    case 'concentration_risk':
      result = await handleConcentrationRisk(proposal);
      break;
    case 'high_impact_unvalidated':
      result = await handleHighImpactUnvalidated(proposal);
      break;
    default:
      // For trigger types without specific handlers, just record acceptance
      result = {
        executed_action: `Accepted proposal (${proposal.trigger_type})`,
        decisions_modified: proposal.affected_decision_ids,
        success: true,
      };
  }

  // Write audit trail
  if (result.success) {
    const now = new Date().toISOString();
    const db = getDb();
    await db.query(
      `UPDATE evolution_proposals
       SET executed_action = ?, decisions_modified = ?, executed_at = ?, executed_by = ?
       WHERE id = ?`,
      [
        result.executed_action,
        JSON.stringify(result.decisions_modified),
        now,
        executedBy ?? 'system',
        proposal.id,
      ],
    );
  }

  return result;
}
