/**
 * Entity Enricher - creates and updates entity pages for people, companies,
 * concepts, and tools mentioned in the decision graph.
 *
 * Tier logic (outcome-driven):
 *   Tier 1: 8+ mentions OR outcome_signal count >= 3 OR meeting/voice source
 *   Tier 2: 3-7 mentions across 2+ sources OR linked to 3+ decisions
 *   Tier 3: default
 */

import { randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';

export type EntityType = 'person' | 'company' | 'concept' | 'tool' | 'source';

export interface EntityPage {
  id: string;
  project_id: string;
  slug: string;
  type: EntityType;
  title: string;
  compiled_truth: string | null;
  trust_score: number;
  tier: 1 | 2 | 3;
  mention_count: number;
  created_at: string;
  updated_at: string;
}

export interface EnrichResult {
  entity: EntityPage;
  action: 'created' | 'updated';
  tier_changed: boolean;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const TYPE_PREFIX: Record<EntityType, string> = {
  person: 'persons',
  company: 'companies',
  concept: 'concepts',
  tool: 'tools',
  source: 'sources',
};

function toSlug(name: string, type: EntityType): string {
  const normalized = name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
  return `${TYPE_PREFIX[type]}/${normalized}`;
}

function computeTier(
  mentionCount: number,
  outcomeSignalCount: number,
  sources: string[],
  decisionLinkCount: number,
): 1 | 2 | 3 {
  if (
    mentionCount >= 8 ||
    outcomeSignalCount >= 3 ||
    sources.includes('meeting') ||
    sources.includes('voice')
  ) {
    return 1;
  }
  const uniqueSources = new Set(sources).size;
  if ((mentionCount >= 3 && uniqueSources >= 2) || decisionLinkCount >= 3) {
    return 2;
  }
  return 3;
}

// ---------------------------------------------------------------------------
// upsertEntityPage
// ---------------------------------------------------------------------------

/**
 * Upsert an entity page. Creates on first encounter; increments mention_count
 * and recalculates tier on subsequent calls.
 */
export async function upsertEntityPage(
  projectId: string,
  title: string,
  type: EntityType,
  source: string,
  summaryText: string,
  options?: {
    decisionId?: string;
    linkType?: 'affects' | 'references' | 'superseded_by' | 'informed_by';
    rawData?: Record<string, unknown>;
    compiledTruth?: string;
  },
): Promise<EnrichResult> {
  const db = getDb();
  const slug = toSlug(title, type);

  const existing = await db.query<Record<string, unknown>>(
    'SELECT * FROM entity_pages WHERE project_id = ? AND slug = ?',
    [projectId, slug],
  );

  if (existing.rows.length === 0) {
    const id = randomUUID();
    // Compute initial tier — decisionLinkCount and outcomeSignalCount are 0 on first insert.
    const initialTier = computeTier(1, 0, [source], 0);

    await db.query(
      `INSERT INTO entity_pages (id, project_id, slug, type, title, mention_count, trust_score, tier)
       VALUES (?, ?, ?, ?, ?, 1, 0.5, ?)`,
      [id, projectId, slug, type, title, initialTier],
    );

    await db.query(
      `INSERT INTO entity_timeline_entries (id, entity_id, source, summary)
       VALUES (?, ?, ?, ?)`,
      [randomUUID(), id, source, summaryText.slice(0, 500)],
    );

    if (options?.decisionId) {
      await db.query(
        `INSERT OR IGNORE INTO entity_decision_links (entity_id, decision_id, link_type)
         VALUES (?, ?, ?)`,
        [id, options.decisionId, options.linkType ?? 'references'],
      );
    }

    const fetched = await db.query<Record<string, unknown>>(
      'SELECT * FROM entity_pages WHERE id = ?',
      [id],
    );

    return {
      entity: fetched.rows[0] as unknown as EntityPage,
      action: 'created',
      tier_changed: false,
    };
  }

  // Entity exists -- update mention count and recalculate tier
  const entity = existing.rows[0] as unknown as EntityPage;
  const newMentionCount = entity.mention_count + 1;

  const [outcomeRes, sourcesRes, linksRes] = await Promise.all([
    db.query<Record<string, unknown>>(
      'SELECT COUNT(*) as cnt FROM entity_outcome_signals WHERE entity_id = ?',
      [entity.id],
    ),
    db.query<Record<string, unknown>>(
      'SELECT DISTINCT source FROM entity_timeline_entries WHERE entity_id = ?',
      [entity.id],
    ),
    db.query<Record<string, unknown>>(
      'SELECT COUNT(*) as cnt FROM entity_decision_links WHERE entity_id = ?',
      [entity.id],
    ),
  ]);

  const outcomeCount = Number((outcomeRes.rows[0] as any)?.cnt ?? 0);
  const existingSources = sourcesRes.rows.map((r) => (r as any).source as string);
  const linkCount = Number((linksRes.rows[0] as any)?.cnt ?? 0);
  const newTier = computeTier(newMentionCount, outcomeCount, [...existingSources, source], linkCount);
  const tierChanged = newTier !== entity.tier;

  await db.query(
    `UPDATE entity_pages
     SET mention_count = ?, tier = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [newMentionCount, newTier, entity.id],
  );

  await db.query(
    `INSERT INTO entity_timeline_entries (id, entity_id, source, summary)
     VALUES (?, ?, ?, ?)`,
    [randomUUID(), entity.id, source, summaryText.slice(0, 500)],
  );

  if (options?.decisionId) {
    await db.query(
      `INSERT OR IGNORE INTO entity_decision_links (entity_id, decision_id, link_type)
       VALUES (?, ?, ?)`,
      [entity.id, options.decisionId, options.linkType ?? 'references'],
    );
  }

  if (options?.compiledTruth !== undefined) {
    await db.query(
      `UPDATE entity_pages
       SET compiled_truth = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [options.compiledTruth, entity.id],
    );
  }

  const updated = await db.query<Record<string, unknown>>(
    'SELECT * FROM entity_pages WHERE id = ?',
    [entity.id],
  );

  return {
    entity: updated.rows[0] as unknown as EntityPage,
    action: 'updated',
    tier_changed: tierChanged,
  };
}

// ---------------------------------------------------------------------------
// propagateOutcomeToEntities
// ---------------------------------------------------------------------------

/**
 * Propagate an outcome signal to all entities linked to the given decision.
 * Recalculates trust_score for each entity based on the running tally of
 * positive vs negative signals.
 */
export async function propagateOutcomeToEntities(
  projectId: string,
  decisionId: string,
  outcomeType: 'positive' | 'negative' | 'partial',
  source: string,
): Promise<void> {
  const db = getDb();

  const links = await db.query<Record<string, unknown>>(
    'SELECT entity_id FROM entity_decision_links WHERE decision_id = ?',
    [decisionId],
  );

  for (const link of links.rows) {
    const entityId = (link as any).entity_id as string;

    await db.query(
      `INSERT INTO entity_outcome_signals (id, entity_id, outcome_type, source)
       VALUES (?, ?, ?, ?)`,
      [randomUUID(), entityId, outcomeType, source],
    );

    const statsRes = await db.query<Record<string, unknown>>(
      `SELECT
         COUNT(*) as total,
         SUM(CASE WHEN outcome_type = 'positive' THEN 1 ELSE 0 END) as pos,
         SUM(CASE WHEN outcome_type = 'negative' THEN 1 ELSE 0 END) as neg
       FROM entity_outcome_signals WHERE entity_id = ?`,
      [entityId],
    );

    const stats = statsRes.rows[0] as any;
    const total = Number(stats?.total ?? 0);

    if (total >= 2) {
      const pos = Number(stats?.pos ?? 0);
      const neg = Number(stats?.neg ?? 0);
      const newTrust = Math.min(0.95, Math.max(0.2, 0.5 + (pos - neg) / (total * 2)));

      await db.query(
        `UPDATE entity_pages
         SET trust_score = ?, updated_at = datetime('now')
         WHERE id = ?`,
        [Math.round(newTrust * 10000) / 10000, entityId],
      );
    }
  }
}

// ---------------------------------------------------------------------------
// getEntityPage
// ---------------------------------------------------------------------------

/**
 * Fetch a single entity page by project + slug. Returns null if not found.
 */
export async function getEntityPage(
  projectId: string,
  slug: string,
): Promise<EntityPage | null> {
  const db = getDb();
  const result = await db.query<Record<string, unknown>>(
    'SELECT * FROM entity_pages WHERE project_id = ? AND slug = ?',
    [projectId, slug],
  );
  return result.rows.length > 0 ? (result.rows[0] as unknown as EntityPage) : null;
}

// ---------------------------------------------------------------------------
// searchEntityPages
// ---------------------------------------------------------------------------

/**
 * Search entity pages by title substring within a project.
 * Results are ordered by tier ASC then mention_count DESC so the most
 * prominent entities surface first.
 */
export async function searchEntityPages(
  projectId: string,
  query: string,
  type?: EntityType,
  limit = 10,
): Promise<EntityPage[]> {
  const db = getDb();
  const typeFilter = type ? ' AND type = ?' : '';
  const params: unknown[] = [projectId, `%${query.toLowerCase()}%`];
  if (type) params.push(type);
  params.push(limit);

  const result = await db.query<Record<string, unknown>>(
    `SELECT * FROM entity_pages
     WHERE project_id = ? AND lower(title) LIKE ?${typeFilter}
     ORDER BY tier ASC, mention_count DESC
     LIMIT ?`,
    params,
  );
  return result.rows as unknown as EntityPage[];
}
