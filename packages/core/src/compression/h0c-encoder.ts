/**
 * H0C (Hipp0Condensed) Encoder -- high-ratio compression for compiled decisions.
 *
 * Produces a compact, one-line-per-decision format with:
 * - Tag deduplication via a header index
 * - Agent deduplication via a header index
 * - Field abbreviation (title->t, tags->g, score->s, etc.)
 * - Confidence shorthand (high->H, medium->M, low->L)
 * - Integer scores (0.92->92)
 * - Compact dates (2026-04-08T01:29:38.121Z->Apr8)
 * - Tiered detail: top decisions get description, lower ones get title only
 *
 * Target: 10-12x token reduction vs full formatted markdown.
 */

import type { ScoredDecision, ConfidenceLevel, SuggestedPattern } from '../types.js';

/* ------------------------------------------------------------------ */
/*  Options                                                            */
/* ------------------------------------------------------------------ */

export interface H0CEncodeOptions {
  /** Include first-sentence reasoning hint (default: false) */
  includeReasoning?: boolean;
  /** Max words for description summary (default: 7) */
  maxDescriptionWords?: number;
  /** Number of top decisions that get full detail (default: 5) */
  fullDetailCount?: number;
}

/* ------------------------------------------------------------------ */
/*  Decoded decision type (returned by decoder)                        */
/* ------------------------------------------------------------------ */

export interface DecodedDecision {
  title: string;
  score: number;
  confidence: ConfidenceLevel;
  made_by: string;
  date: string;
  tags: string[];
  description: string;
  reasoning?: string;
  namespace?: string;
}

/* ------------------------------------------------------------------ */
/*  Internal helpers                                                   */
/* ------------------------------------------------------------------ */

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function confShorthand(c: ConfidenceLevel): string {
  if (c === 'high') return 'H';
  if (c === 'medium') return 'M';
  return 'L';
}

function compactDate(dateStr: string | undefined): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    return `${MONTH_NAMES[d.getMonth()]}${d.getDate()}`;
  } catch {
    return '';
  }
}

function truncateWords(text: string, maxWords: number): string {
  if (!text) return '';
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  return words.slice(0, maxWords).join(' ').replace(/[.,;:!?]+$/, '');
}

function firstSentence(text: string): string {
  if (!text) return '';
  const match = text.match(/^[^.!?]*[.!?]/);
  return match ? match[0].trim() : text;
}

/** Escape pipe characters so they don't break the line format. */
function safePipe(val: string): string {
  return val.replace(/\|/g, '/').replace(/\n/g, ' ').trim();
}

/* ------------------------------------------------------------------ */
/*  Encoder                                                            */
/* ------------------------------------------------------------------ */

export function encodeH0C(
  decisions: ScoredDecision[],
  options?: H0CEncodeOptions,
): string {
  if (decisions.length === 0) return '#H0C v2\n---\n(empty)';

  const includeReasoning = options?.includeReasoning ?? false;
  const maxDescWords = options?.maxDescriptionWords ?? 7;
  const fullDetailCount = options?.fullDetailCount ?? 5;

  // 1. Build tag index from all decisions
  const tagSet = new Set<string>();
  for (const d of decisions) {
    for (const tag of d.tags) {
      tagSet.add(tag);
    }
  }
  const tagList = [...tagSet];
  const tagIndex = new Map<string, number>();
  tagList.forEach((tag, i) => tagIndex.set(tag, i));

  // 2. Build header. Tags use implicit index via position; decoder also accepts
  // explicit `N=tag` tokens for backward compatibility.
  const tagHeader = tagList.join(',');
  const lines: string[] = [];
  lines.push(`#H0C v2`);
  if (tagList.length > 0) {
    lines.push(`#TAGS: ${tagHeader}`);
  }
  lines.push('---');

  // 3. One line per decision - tiered detail
  const sorted = [...decisions].sort((a, b) => (b.combined_score ?? 0) - (a.combined_score ?? 0));

  for (let i = 0; i < sorted.length; i++) {
    const d = sorted[i];
    const isTopTier = i < fullDetailCount;
    const score = Math.round((d.combined_score ?? 0) * 100);
    const conf = confShorthand(d.confidence);
    const agentRef = safePipe(d.made_by);
    const title = safePipe(truncateWords(d.title, isTopTier ? 8 : 6));

    // Tag references by index
    const tagRefs = d.tags.map((t) => tagIndex.get(t)).filter((idx) => idx !== undefined);
    const tagStr = tagRefs.length > 0 ? `g:${tagRefs.join(',')}` : '';

    // Namespace marker (inside metadata bracket)
    const nsMarker = d.namespace ? `|ns:${safePipe(d.namespace)}` : '';

    if (isTopTier) {
      // Full detail: score, confidence, agent, date, [ns], title, tags, description
      const date = compactDate(d.created_at);
      const desc = safePipe(truncateWords(firstSentence(d.description), maxDescWords));
      let line = `[${score}|${conf}|${agentRef}|${date}${nsMarker}]${title}`;
      if (tagStr) line += `|${tagStr}`;
      if (desc) line += `|${desc}`;

      if (includeReasoning && d.reasoning) {
        const reason = safePipe(truncateWords(firstSentence(d.reasoning), 6));
        if (reason) line += `|r:${reason}`;
      }
      lines.push(line);
    } else if (i < fullDetailCount * 3) {
      // Mid-tier: score, conf, agent, [ns], short title, tags
      let line = `[${score}|${conf}|${agentRef}${nsMarker}]${title}`;
      if (tagStr) line += `|${tagStr}`;
      lines.push(line);
    } else {
      // Minimal: score, conf, [ns], and title only
      lines.push(`[${score}|${conf}${nsMarker}]${title}`);
    }
  }

  return lines.join('\n');
}

/**
 * Encode suggested patterns into H0C patterns section.
 * Format: ---PATTERNS---
 * [P|confidence|source_count] title | description
 */
export function encodeH0CPatterns(patterns: SuggestedPattern[]): string {
  if (patterns.length === 0) return '';

  const lines: string[] = ['---PATTERNS---'];
  for (const p of patterns) {
    const conf = Math.round(p.confidence * 100);
    const title = safePipe(truncateWords(p.title, 8));
    const desc = safePipe(truncateWords(p.description, 12));
    lines.push(`[P|${conf}|${p.source_count}src] ${title} | ${desc}`);
  }
  return lines.join('\n');
}
