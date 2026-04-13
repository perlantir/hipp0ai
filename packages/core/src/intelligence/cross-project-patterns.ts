/**
 * Cross-Project Pattern Sharing — Network Effect System
 *
 * Patterns discovered in one project can be shared (opt-in only) with the
 * global community. Other projects can then discover and adopt these
 * patterns, creating a network effect where Hipp0 gets smarter the more
 * it is used.
 *
 * Privacy invariants:
 *   - origin_project_hash is a SHA256 of the project_id (one-way)
 *   - no project IDs, agent names, or tenant identifiers ever leave the
 *     project boundary
 *   - sharing is OPT-IN ONLY (either via explicit API call or the
 *     HIPP0_SHARE_PATTERNS=true environment variable)
 *   - titles/descriptions are scrubbed of obvious project-specific tokens
 *     before persisting
 */

import { createHash, randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';
import type { SuggestedPattern } from '../types.js';

// ─ Types ─

export type AdoptionOutcome = 'success' | 'failure' | 'partial';

/**
 * Input accepted by extractSharedPattern. Shape loosely matches
 * SuggestedPattern (from pattern-extractor.ts) plus optional fields
 * coming from anonymous_patterns rows so callers can pass either.
 */
export interface SharedPatternInput {
  pattern_id?: string;
  pattern_type?: string;
  title: string;
  description: string;
  confidence?: number;
  domain?: string | null;
  tags?: string[];
  /** Optional: passed through to the anonymizer so we can strip them */
  project_id?: string;
  agent_name?: string;
}

export interface ExtractSharedPatternResult {
  shared_pattern_id: string;
  anonymized: true;
}

export interface SharedPatternRecord {
  id: string;
  origin_project_hash: string;
  pattern_type: string;
  title: string;
  description: string;
  domain: string | null;
  tags: string[];
  confidence: number;
  adoption_count: number;
  success_count: number;
  failure_count: number;
  success_rate: number;
  created_at: string;
  updated_at: string;
}

export interface CommunityStats {
  total_shared_patterns: number;
  total_contributing_projects: number;
  most_adopted: Array<{
    id: string;
    title: string;
    domain: string | null;
    adoption_count: number;
    success_count: number;
    failure_count: number;
    confidence: number;
  }>;
  domain_coverage: Array<{ domain: string; pattern_count: number }>;
}

// ─ Helpers ─

/** One-way SHA256 hash of a project id — used everywhere we need to
 *  identify a project without revealing the real id. */
export function hashProjectId(projectId: string): string {
  return createHash('sha256').update(projectId).digest('hex');
}

/**
 * Remove obvious project-specific tokens (project ids, agent names,
 * emails, UUIDs) from a free-text field. Not cryptographic — just a
 * best-effort scrub so we don't leak identifiers in title/description.
 */
function scrubText(
  text: string,
  extras: Array<string | undefined | null> = [],
): string {
  if (!text) return '';
  let out = text;

  // Redact concrete tokens supplied by the caller (project_id, agent_name)
  for (const token of extras) {
    if (!token || typeof token !== 'string') continue;
    const trimmed = token.trim();
    if (trimmed.length < 3) continue;
    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(escaped, 'gi'), '[redacted]');
  }

  // Strip UUIDs
  out = out.replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    '[id]',
  );

  // Strip email addresses
  out = out.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]');

  // Collapse duplicated whitespace
  out = out.replace(/\s+/g, ' ').trim();
  return out;
}

/** Infer a domain tag from a list of tags (first non-empty wins). */
function inferDomain(tags: string[] | undefined, explicit?: string | null): string | null {
  if (explicit) return explicit;
  if (!tags || tags.length === 0) return null;
  const first = tags.find((t) => typeof t === 'string' && t.trim().length > 0);
  return first ? first.trim().toLowerCase() : null;
}

/** Parse the tags column back to a string[] regardless of dialect. */
function parseTags(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter((t) => typeof t === 'string');
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        return Array.isArray(parsed) ? parsed.filter((t) => typeof t === 'string') : [];
      } catch {
        return [];
      }
    }
    // Postgres text[] returns a comma-separated list inside braces
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      return trimmed
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/^"|"$/g, ''))
        .filter((s) => s.length > 0);
    }
    return [trimmed];
  }
  return [];
}

/** Compute the success rate for a shared pattern. */
function successRate(successCount: number, failureCount: number): number {
  const total = successCount + failureCount;
  if (total === 0) return 0;
  return successCount / total;
}

/** Convert a DB row into a SharedPatternRecord. */
function rowToRecord(row: Record<string, unknown>): SharedPatternRecord {
  const successCount = Number(row.success_count ?? 0);
  const failureCount = Number(row.failure_count ?? 0);
  const createdAtRaw = row.created_at;
  const updatedAtRaw = row.updated_at;
  return {
    id: String(row.id),
    origin_project_hash: String(row.origin_project_hash ?? ''),
    pattern_type: String(row.pattern_type ?? 'community'),
    title: String(row.title ?? ''),
    description: String(row.description ?? ''),
    domain: (row.domain as string | null) ?? null,
    tags: parseTags(row.tags),
    confidence: Number(row.confidence ?? 0),
    adoption_count: Number(row.adoption_count ?? 0),
    success_count: successCount,
    failure_count: failureCount,
    success_rate: successRate(successCount, failureCount),
    created_at:
      createdAtRaw instanceof Date
        ? createdAtRaw.toISOString()
        : String(createdAtRaw ?? ''),
    updated_at:
      updatedAtRaw instanceof Date
        ? updatedAtRaw.toISOString()
        : String(updatedAtRaw ?? ''),
  };
}

// ─ Public API 

/**
 * Extract (and anonymize) a pattern from a project and store it in the
 * global shared_patterns table so other projects can adopt it.
 *
 * Strictly opt-in — callers are expected to gate this behind an explicit
 * user action or the HIPP0_SHARE_PATTERNS=true environment variable.
 */
export async function extractSharedPattern(
  projectId: string,
  patternData: SharedPatternInput,
): Promise<ExtractSharedPatternResult> {
  if (!projectId || typeof projectId !== 'string') {
    throw new Error('extractSharedPattern: projectId is required');
  }
  if (!patternData || typeof patternData !== 'object') {
    throw new Error('extractSharedPattern: patternData is required');
  }

  const db = getDb();
  const id = randomUUID();
  const originHash = hashProjectId(projectId);

  // Scrub identifying tokens from title/description
  const scrubExtras = [projectId, patternData.agent_name];
  const title = scrubText(patternData.title ?? '', scrubExtras).slice(0, 300) || 'Community pattern';
  const description = scrubText(patternData.description ?? '', scrubExtras).slice(0, 2000);

  const patternType = (patternData.pattern_type ?? 'community').toString().slice(0, 64);
  const confidence = Math.max(0, Math.min(1, Number(patternData.confidence ?? 0.5)));
  const tags = (patternData.tags ?? [])
    .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
    .map((t) => t.trim().toLowerCase())
    .slice(0, 16);
  const domain = inferDomain(tags, patternData.domain ?? null);

  const tagsParam = db.dialect === 'postgres' ? db.arrayParam(tags) : JSON.stringify(tags);

  await db.query(
    `INSERT INTO shared_patterns
       (id, origin_project_hash, pattern_type, title, description,
        domain, tags, confidence, adoption_count, success_count, failure_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0)`,
    [id, originHash, patternType, title, description, domain, tagsParam, confidence],
  );

  return { shared_pattern_id: id, anonymized: true };
}

/**
 * Return the top community patterns that are relevant to a given task.
 *
 * - Filters out anything originating from the caller's own project
 *   (no self-reference — that's what pattern-extractor.ts is for).
 * - Scores candidates by a blend of tag overlap, adoption_count,
 *   success_rate, and recency.
 * - Returns at most 5 patterns.
 */
export async function getRelevantSharedPatterns(
  projectId: string,
  task: string,
  tags: string[] = [],
): Promise<SharedPatternRecord[]> {
  const db = getDb();
  const originHash = hashProjectId(projectId);
  const taskLower = (task ?? '').toLowerCase();
  const normalizedTags = (tags ?? [])
    .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
    .map((t) => t.trim().toLowerCase());

  let rows: Array<Record<string, unknown>> = [];
  try {
    const result = await db.query<Record<string, unknown>>(
      `SELECT id, origin_project_hash, pattern_type, title, description,
              domain, tags, confidence, adoption_count, success_count,
              failure_count, created_at, updated_at
         FROM shared_patterns
        WHERE origin_project_hash != ?
        ORDER BY adoption_count DESC, confidence DESC
        LIMIT 200`,
      [originHash],
    );
    rows = result.rows;
  } catch (err) {
    // Table may not exist yet or empty — handled gracefully
    console.warn(
      '[hipp0/cross-project-patterns] getRelevantSharedPatterns query failed:',
      (err as Error).message,
    );
    return [];
  }

  if (rows.length === 0) return [];

  const now = Date.now();
  const scored = rows.map((row) => {
    const record = rowToRecord(row);

    // Tag overlap score (0..1)
    let tagScore = 0;
    if (normalizedTags.length > 0 && record.tags.length > 0) {
      const overlap = record.tags.filter((t) => normalizedTags.includes(t)).length;
      tagScore = overlap / Math.max(record.tags.length, normalizedTags.length);
    }

    // Description keyword similarity (0..1)
    let descScore = 0;
    if (taskLower && record.title) {
      const words = record.title
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 3);
      if (words.length > 0) {
        const hits = words.filter((w) => taskLower.includes(w)).length;
        descScore = hits / words.length;
      }
    }

    // Adoption + success weighting (log-normalized)
    const adoptionScore = Math.min(1, Math.log10(record.adoption_count + 1) / 2);
    const successRateScore = record.success_rate;

    // Recency decay (newer patterns get a mild boost, ~30-day half-life)
    let recencyScore = 0;
    const updatedAtMs = Date.parse(record.updated_at);
    if (!Number.isNaN(updatedAtMs)) {
      const ageDays = Math.max(0, (now - updatedAtMs) / (1000 * 60 * 60 * 24));
      recencyScore = Math.exp(-ageDays / 30);
    }

    // Final blend — relevance first, then popularity/success, then recency
    const relevance = Math.max(tagScore, descScore);
    const popularity = adoptionScore * 0.6 + successRateScore * 0.4;
    const combined =
      relevance * 0.5 + popularity * 0.35 + recencyScore * 0.15;

    return { record, combined };
  });

  scored.sort((a, b) => b.combined - a.combined);
  return scored.slice(0, 5).map((s) => s.record);
}

/**
 * Record that a project has adopted a shared pattern. Optionally captures
 * the adoption outcome so future rankings can reflect real-world success.
 *
 * Always increments adoption_count; updates success/failure counters only
 * when an outcome is provided.
 */
export async function recordPatternAdoption(
  projectId: string,
  sharedPatternId: string,
  outcome?: AdoptionOutcome | null,
): Promise<void> {
  if (!projectId || !sharedPatternId) {
    throw new Error('recordPatternAdoption: projectId and sharedPatternId are required');
  }
  const db = getDb();
  const adoptingHash = hashProjectId(projectId);

  const adoptionId = randomUUID();
  const normalizedOutcome: AdoptionOutcome | null =
    outcome === 'success' || outcome === 'failure' || outcome === 'partial'
      ? outcome
      : null;

  // Insert the adoption record
  try {
    await db.query(
      `INSERT INTO pattern_adoptions
         (id, shared_pattern_id, adopting_project_hash, outcome)
       VALUES (?, ?, ?, ?)`,
      [adoptionId, sharedPatternId, adoptingHash, normalizedOutcome],
    );
  } catch (err) {
    console.warn(
      '[hipp0/cross-project-patterns] recordPatternAdoption insert failed:',
      (err as Error).message,
    );
    return;
  }

  // Bump counters on the shared_patterns row
  const successDelta = normalizedOutcome === 'success' ? 1 : 0;
  const failureDelta = normalizedOutcome === 'failure' ? 1 : 0;
  try {
    if (db.dialect === 'postgres') {
      await db.query(
        `UPDATE shared_patterns
            SET adoption_count = adoption_count + 1,
                success_count  = success_count  + ?,
                failure_count  = failure_count  + ?,
                updated_at     = NOW()
          WHERE id = ?`,
        [successDelta, failureDelta, sharedPatternId],
      );
    } else {
      await db.query(
        `UPDATE shared_patterns
            SET adoption_count = adoption_count + 1,
                success_count  = success_count  + ?,
                failure_count  = failure_count  + ?,
                updated_at     = datetime('now')
          WHERE id = ?`,
        [successDelta, failureDelta, sharedPatternId],
      );
    }
  } catch (err) {
    console.warn(
      '[hipp0/cross-project-patterns] recordPatternAdoption update failed:',
      (err as Error).message,
    );
  }
}

/**
 * Paginated listing of community-shared patterns, ordered by adoption.
 */
export async function listSharedPatterns(opts?: {
  limit?: number;
  offset?: number;
  domain?: string | null;
}): Promise<{ patterns: SharedPatternRecord[]; total: number }> {
  const db = getDb();
  const limit = Math.max(1, Math.min(100, opts?.limit ?? 20));
  const offset = Math.max(0, opts?.offset ?? 0);

  try {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (opts?.domain) {
      conditions.push('domain = ?');
      params.push(opts.domain);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await db.query<Record<string, unknown>>(
      `SELECT COUNT(*) AS c FROM shared_patterns ${where}`,
      params,
    );
    const total = Number((countResult.rows[0] as Record<string, unknown>)?.c ?? 0);

    const result = await db.query<Record<string, unknown>>(
      `SELECT id, origin_project_hash, pattern_type, title, description,
              domain, tags, confidence, adoption_count, success_count,
              failure_count, created_at, updated_at
         FROM shared_patterns
         ${where}
         ORDER BY adoption_count DESC, confidence DESC
         LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );

    return { patterns: result.rows.map(rowToRecord), total };
  } catch (err) {
    console.warn(
      '[hipp0/cross-project-patterns] listSharedPatterns failed:',
      (err as Error).message,
    );
    return { patterns: [], total: 0 };
  }
}

/**
 * Global community statistics across all shared patterns.
 */
export async function getCommunityStats(): Promise<CommunityStats> {
  const db = getDb();
  const empty: CommunityStats = {
    total_shared_patterns: 0,
    total_contributing_projects: 0,
    most_adopted: [],
    domain_coverage: [],
  };

  try {
    const totalResult = await db.query<Record<string, unknown>>(
      `SELECT COUNT(*) AS c FROM shared_patterns`,
    );
    const totalSharedPatterns = Number(
      (totalResult.rows[0] as Record<string, unknown>)?.c ?? 0,
    );

    if (totalSharedPatterns === 0) return empty;

    const contributorsResult = await db.query<Record<string, unknown>>(
      `SELECT COUNT(DISTINCT origin_project_hash) AS c FROM shared_patterns`,
    );
    const totalContributingProjects = Number(
      (contributorsResult.rows[0] as Record<string, unknown>)?.c ?? 0,
    );

    const topResult = await db.query<Record<string, unknown>>(
      `SELECT id, title, domain, adoption_count, success_count,
              failure_count, confidence
         FROM shared_patterns
        ORDER BY adoption_count DESC, confidence DESC
        LIMIT 5`,
    );
    const mostAdopted = topResult.rows.map((row) => ({
      id: String(row.id),
      title: String(row.title ?? ''),
      domain: (row.domain as string | null) ?? null,
      adoption_count: Number(row.adoption_count ?? 0),
      success_count: Number(row.success_count ?? 0),
      failure_count: Number(row.failure_count ?? 0),
      confidence: Number(row.confidence ?? 0),
    }));

    const domainResult = await db.query<Record<string, unknown>>(
      `SELECT domain, COUNT(*) AS pattern_count
         FROM shared_patterns
        WHERE domain IS NOT NULL
        GROUP BY domain
        ORDER BY pattern_count DESC
        LIMIT 20`,
    );
    const domainCoverage = domainResult.rows.map((row) => ({
      domain: String(row.domain ?? ''),
      pattern_count: Number(row.pattern_count ?? 0),
    }));

    return {
      total_shared_patterns: totalSharedPatterns,
      total_contributing_projects: totalContributingProjects,
      most_adopted: mostAdopted,
      domain_coverage: domainCoverage,
    };
  } catch (err) {
    console.warn(
      '[hipp0/cross-project-patterns] getCommunityStats failed:',
      (err as Error).message,
    );
    return empty;
  }
}

/**
 * Convert a SharedPatternRecord into the SuggestedPattern shape that
 * compile responses expect. Useful for wiring community patterns into
 * the compile payload as an auxiliary field.
 */
export function toSuggestedPattern(record: SharedPatternRecord): SuggestedPattern {
  return {
    pattern_id: record.id,
    title: record.title,
    description: record.description,
    confidence: record.confidence,
    source_count: record.adoption_count,
    relevance_score: Math.round(record.success_rate * 100) / 100,
  };
}

/**
 * True when pattern sharing is enabled by default via the environment
 * variable. Route handlers should treat this as a hint only — explicit
 * API calls are still the primary opt-in path.
 */
export function isAutoShareEnabled(): boolean {
  return process.env.HIPP0_SHARE_PATTERNS === 'true';
}
