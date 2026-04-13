/**
 * H0C Ultra Encoder - 20-30x token compression via semantic clustering.
 *
 * Strategy:
 * - Top 3 decisions: full detail (title + description + reasoning summary)
 * - Decisions 4-10: title only, one per line
 * - Decisions 11+: clustered by domain/tags, one line per cluster with count
 *
 * This is intentionally lossy for low-relevance decisions. The insight:
 * agents don't need to see every decision - they need the essence of what
 * matters for their current task.
 */

import type { ScoredDecision, ConfidenceLevel } from '../types.js';

export interface H0CUltraOptions {
  /** Number of top decisions with full detail (default: 3) */
  topDetailCount?: number;
  /** Number of decisions shown as title-only (default: 7) */
  titleOnlyCount?: number;
  /** Max words for description in top tier (default: 12) */
  maxDescWords?: number;
}

function confChar(c: ConfidenceLevel): string {
  return c === 'high' ? 'H' : c === 'medium' ? 'M' : 'L';
}

function truncate(text: string, maxWords: number): string {
  if (!text) return '';
  return text.split(/\s+/).filter(Boolean).slice(0, maxWords).join(' ').replace(/[.,;:!?]+$/, '');
}

function firstSentence(text: string): string {
  if (!text) return '';
  const m = text.match(/^[^.!?]*[.!?]/);
  return m ? m[0].trim() : text;
}

function safe(val: string): string {
  return val.replace(/\|/g, '/').replace(/\n/g, ' ').trim();
}

/**
 * Cluster decisions by their primary tag or domain.
 * Returns a map of cluster label -> decision titles.
 */
function clusterDecisions(decisions: ScoredDecision[]): Map<string, string[]> {
  const clusters = new Map<string, string[]>();

  for (const d of decisions) {
    // Use first tag as cluster key, fall back to "general"
    const key = d.tags[0] || (d as unknown as Record<string, unknown>).domain as string || 'general';
    if (!clusters.has(key)) clusters.set(key, []);
    clusters.get(key)!.push(truncate(d.title, 5));
  }

  return clusters;
}

export function encodeH0CUltra(
  decisions: ScoredDecision[],
  options?: H0CUltraOptions,
): string {
  if (decisions.length === 0) return '#H0C-U\n(empty)';

  const topN = options?.topDetailCount ?? 3;
  const titleN = options?.titleOnlyCount ?? 7;
  const maxDesc = options?.maxDescWords ?? 12;

  // Sort by score descending
  const sorted = [...decisions].sort((a, b) => (b.combined_score ?? 0) - (a.combined_score ?? 0));

  const lines: string[] = [];
  lines.push(`#H0C-U ${sorted.length}d`);

  // Tier 1: Top decisions with full detail
  const topDecisions = sorted.slice(0, topN);
  for (const d of topDecisions) {
    const score = Math.round((d.combined_score ?? 0) * 100);
    const desc = safe(truncate(firstSentence(d.description), maxDesc));
    const title = safe(truncate(d.title, 10));
    lines.push(`*[${score}|${confChar(d.confidence)}|${d.made_by}]${title}${desc ? ` - ${desc}` : ''}`);
  }

  // Tier 2: Title-only decisions
  const midDecisions = sorted.slice(topN, topN + titleN);
  if (midDecisions.length > 0) {
    const midLines = midDecisions.map((d) => {
      const score = Math.round((d.combined_score ?? 0) * 100);
      return `[${score}]${safe(truncate(d.title, 6))}`;
    });
    lines.push(midLines.join(';'));
  }

  // Tier 3: Clustered summary for remaining decisions
  const tailDecisions = sorted.slice(topN + titleN);
  if (tailDecisions.length > 0) {
    const clusters = clusterDecisions(tailDecisions);
    const clusterParts: string[] = [];
    for (const [label, titles] of clusters) {
      if (titles.length === 1) {
        clusterParts.push(`${label}:${titles[0]}`);
      } else {
        clusterParts.push(`${label}(${titles.length})`);
      }
    }
    lines.push(`+${tailDecisions.length}more:${clusterParts.join(',')}`);
  }

  return lines.join('\n');
}
