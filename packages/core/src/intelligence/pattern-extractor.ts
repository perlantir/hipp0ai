/**
 * Pattern Extractor — queries anonymous_patterns and scores them for compile responses.
 */
import { getDb } from '../db/index.js';
import type { SuggestedPattern } from '../types.js';

export interface ExtractedPattern {
  pattern_type: string;
  description: string;
  confidence: number;
  decisions: string[];
}

/** Default minimum confidence for pattern recommendations */
export const DEFAULT_MIN_PATTERN_CONFIDENCE = 0.60;
/** Maximum patterns per compile response */
export const MAX_SUGGESTED_PATTERNS = 2;

interface PatternRow {
  id: string;
  pattern_type: string;
  tag_a: string;
  tag_b: string | null;
  title_pattern_a: string | null;
  title_pattern_b: string | null;
  occurrence_count: number;
  tenant_count: number;
  confidence: number;
}

/**
 * Score a pattern against a task's tags and description.
 * Uses tag overlap + description keyword similarity (lighter than decision scoring).
 */
function scorePattern(
  pattern: PatternRow,
  taskTags: string[],
  taskDescription: string,
): number {
  const taskTagsLower = taskTags.map((t) => t.toLowerCase());
  const descLower = taskDescription.toLowerCase();

  // Tag overlap: check if pattern tags match task tags
  let tagScore = 0;
  const patternTags = [pattern.tag_a, pattern.tag_b].filter(Boolean).map((t) => t!.toLowerCase());
  const matchCount = patternTags.filter((t) => taskTagsLower.includes(t)).length;
  if (patternTags.length > 0) {
    tagScore = matchCount / patternTags.length;
  }

  // Description keyword similarity: check if pattern title keywords appear in task description
  let descScore = 0;
  const titleWords = [pattern.title_pattern_a, pattern.title_pattern_b]
    .filter(Boolean)
    .flatMap((t) => t!.toLowerCase().split(/\s+/))
    .filter((w) => w.length > 3); // skip short words
  if (titleWords.length > 0) {
    const descHits = titleWords.filter((w) => descLower.includes(w)).length;
    descScore = descHits / titleWords.length;
  }

  // Weighted: 60% tag overlap, 40% description similarity
  return tagScore * 0.6 + descScore * 0.4;
}

/**
 * Get pattern recommendations for a compile request.
 * Returns top 2 patterns matching the task's tags/description above the confidence threshold.
 */
export async function getPatternRecommendations(
  projectId: string,
  taskTags: string[],
  taskDescription: string,
  minConfidence: number = DEFAULT_MIN_PATTERN_CONFIDENCE,
): Promise<SuggestedPattern[]> {
  const db = getDb();

  // Query active patterns above minimum confidence
  const result = await db.query<Record<string, unknown>>(
    `SELECT id, pattern_type, tag_a, tag_b, title_pattern_a, title_pattern_b,
            occurrence_count, tenant_count, confidence
     FROM anonymous_patterns
     WHERE active = ? AND confidence >= ?
     ORDER BY confidence DESC, tenant_count DESC
     LIMIT 50`,
    [true, minConfidence],
  );

  if (result.rows.length === 0) return [];

  // Score each pattern against the task
  const scored = result.rows.map((row) => {
    const r = row as unknown as PatternRow;
    const relevance = scorePattern(r, taskTags, taskDescription);
    const title = [r.title_pattern_a, r.title_pattern_b].filter(Boolean).join(' + ');
    const description = buildPatternDescription(r);
    return {
      pattern_id: r.id,
      title: title || `${r.pattern_type}: ${r.tag_a}${r.tag_b ? ' + ' + r.tag_b : ''}`,
      description,
      confidence: r.confidence,
      source_count: r.tenant_count,
      relevance_score: Math.round(relevance * 100) / 100,
    };
  });

  // Filter out zero-relevance patterns, sort by relevance, take top 2
  return scored
    .filter((p) => p.relevance_score > 0)
    .sort((a, b) => b.relevance_score - a.relevance_score)
    .slice(0, MAX_SUGGESTED_PATTERNS);
}

function buildPatternDescription(r: PatternRow): string {
  const count = r.tenant_count;
  switch (r.pattern_type) {
    case 'decision_pair':
      return `${count} projects commonly pair ${r.title_pattern_a ?? r.tag_a} with ${r.title_pattern_b ?? r.tag_b}`;
    case 'decision_sequence':
      return `${count} projects follow ${r.title_pattern_a ?? r.tag_a} with ${r.title_pattern_b ?? r.tag_b}`;
    case 'contradiction_common':
      return `${count} projects independently resolved a contradiction between ${r.tag_a} and ${r.tag_b ?? 'related decisions'}`;
    case 'gap_indicator':
      return `${count} projects with ${r.tag_a} also added ${r.tag_b ?? 'related'} decisions`;
    default:
      return `Pattern observed across ${count} projects`;
  }
}

/**
 * List all patterns with optional filtering — used by MCP tool.
 */
export async function listPatterns(opts?: {
  tags?: string[];
  domain?: string;
  minConfidence?: number;
  limit?: number;
}): Promise<SuggestedPattern[]> {
  const db = getDb();
  const conditions: string[] = ['active = ?'];
  const params: unknown[] = [true];

  if (opts?.minConfidence != null) {
    conditions.push('confidence >= ?');
    params.push(opts.minConfidence);
  }

  if (opts?.tags && opts.tags.length > 0) {
    const tagPlaceholders = opts.tags.map(() => '?').join(', ');
    conditions.push(`(tag_a IN (${tagPlaceholders}) OR tag_b IN (${tagPlaceholders}))`);
    params.push(...opts.tags, ...opts.tags);
  }

  if (opts?.domain) {
    conditions.push('(tag_a = ? OR tag_b = ?)');
    params.push(opts.domain, opts.domain);
  }

  const limit = opts?.limit ?? 20;
  const result = await db.query<Record<string, unknown>>(
    `SELECT id, pattern_type, tag_a, tag_b, title_pattern_a, title_pattern_b,
            occurrence_count, tenant_count, confidence
     FROM anonymous_patterns
     WHERE ${conditions.join(' AND ')}
     ORDER BY confidence DESC, tenant_count DESC
     LIMIT ?`,
    [...params, limit],
  );

  return result.rows.map((row) => {
    const r = row as unknown as PatternRow;
    const title = [r.title_pattern_a, r.title_pattern_b].filter(Boolean).join(' + ');
    return {
      pattern_id: r.id,
      title: title || `${r.pattern_type}: ${r.tag_a}${r.tag_b ? ' + ' + r.tag_b : ''}`,
      description: buildPatternDescription(r),
      confidence: r.confidence,
      source_count: r.tenant_count,
      relevance_score: 1.0, // no task context for listing
    };
  });
}

export async function getProjectPatterns(projectId: string): Promise<ExtractedPattern[]> {
  void projectId;
  return [];
}

export async function extractPatterns(projectId?: string): Promise<ExtractedPattern[]> {
  if (projectId) return getProjectPatterns(projectId);
  return [];
}

export async function extractCrossTenantPatterns(): Promise<ExtractedPattern[]> {
  return [];
}
