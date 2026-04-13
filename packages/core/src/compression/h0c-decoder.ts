/**
 * H0C (Hipp0Condensed) Decoder — parses H0C format back to decision objects.
 *
 * Handles tag index lookup, score/confidence/date expansion.
 */

import type { ConfidenceLevel, SuggestedPattern } from '../types.js';
import type { DecodedDecision } from './h0c-encoder.js';

/* ------------------------------------------------------------------ */
/*  Internal helpers                                                   */
/* ------------------------------------------------------------------ */

function expandConfidence(c: string): ConfidenceLevel {
  if (c === 'H') return 'high';
  if (c === 'M') return 'medium';
  return 'low';
}

/* ------------------------------------------------------------------ */
/*  Decoder                                                            */
/* ------------------------------------------------------------------ */

export function decodeH0C(h0c: string): DecodedDecision[] {
  if (!h0c || h0c.trim().length === 0) return [];

  const lines = h0c.split('\n');
  const tagMap = new Map<number, string>();
  const decisions: DecodedDecision[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and format header
    if (!trimmed || trimmed === '---' || trimmed === '(empty)') continue;
    if (trimmed.startsWith('#H0C')) continue;

    // Parse tag index: #TAGS: 0=auth 1=security 2=jwt ...
    if (trimmed.startsWith('#TAGS:')) {
      const tagPart = trimmed.slice('#TAGS:'.length).trim();
      const entries = tagPart.split(/\s+/);
      for (const entry of entries) {
        const eqIdx = entry.indexOf('=');
        if (eqIdx > 0) {
          const idx = parseInt(entry.slice(0, eqIdx), 10);
          const tag = entry.slice(eqIdx + 1);
          if (!isNaN(idx) && tag) tagMap.set(idx, tag);
        }
      }
      continue;
    }

    // Parse decision line: [score|conf|by:agent|date] title | g:0,1,2 | description | r:reasoning
    const bracketMatch = trimmed.match(/^\[([^\]]+)\]\s*(.*)$/);
    if (!bracketMatch) continue;

    const meta = bracketMatch[1]!;
    const rest = bracketMatch[2]!;

    // Parse metadata fields: score|conf|by:agent|date
    const metaParts = meta.split('|');
    const scoreRaw = parseInt(metaParts[0] ?? '0', 10);
    const score = isNaN(scoreRaw) ? 0 : scoreRaw / 100;
    const confidence = expandConfidence(metaParts[1]?.trim() ?? 'M');

    let made_by = '';
    let date = '';
    let namespace: string | undefined;
    for (let i = 2; i < metaParts.length; i++) {
      const part = metaParts[i]!.trim();
      if (part.startsWith('by:')) {
        made_by = part.slice(3);
      } else if (part.startsWith('ns:')) {
        namespace = part.slice(3);
      } else if (i === 2 && !part.startsWith('by:')) {
        // New format: agent name without by: prefix
        made_by = part;
      } else {
        date = part;
      }
    }

    // Parse rest: title|g:tags|description|r:reasoning
    const segments = rest.split('|');
    const title = segments[0]?.trim() ?? '';
    let tags: string[] = [];
    let description = '';
    let reasoning: string | undefined;

    for (let i = 1; i < segments.length; i++) {
      const seg = segments[i]!.trim();
      if (seg.startsWith('g:')) {
        // Tag references
        const indices = seg.slice(2).split(',').map((s) => parseInt(s.trim(), 10));
        tags = indices
          .filter((idx) => !isNaN(idx))
          .map((idx) => tagMap.get(idx) ?? `tag-${idx}`);
      } else if (seg.startsWith('r:')) {
        reasoning = seg.slice(2).trim();
      } else if (seg.startsWith('ns:')) {
        // Namespace in rest segments (shouldn't happen normally, but be safe)
        namespace = namespace ?? seg.slice(3).trim();
      } else {
        description = seg;
      }
    }

    decisions.push({
      title,
      score,
      confidence,
      made_by,
      date,
      tags,
      description,
      ...(reasoning ? { reasoning } : {}),
      ...(namespace ? { namespace } : {}),
    });
  }

  return decisions;
}

/**
 * Decode H0C patterns section back to SuggestedPattern objects.
 * Handles format: [P|confidence|Nsrc] title | description
 */
export function decodeH0CPatterns(h0c: string): SuggestedPattern[] {
  if (!h0c || !h0c.includes('---PATTERNS---')) return [];

  const patternsSection = h0c.split('---PATTERNS---')[1];
  if (!patternsSection) return [];

  const lines = patternsSection.split('\n');
  const patterns: SuggestedPattern[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Parse: [P|85|3src] title | description
    const match = trimmed.match(/^\[P\|(\d+)\|(\d+)src\]\s*(.*)$/);
    if (!match) continue;

    const confidence = parseInt(match[1]!, 10) / 100;
    const sourceCount = parseInt(match[2]!, 10);
    const rest = match[3]!;

    const segments = rest.split('|').map((s) => s.trim());
    const title = segments[0] ?? '';
    const description = segments[1] ?? '';

    patterns.push({
      pattern_id: '',
      title,
      description,
      confidence,
      source_count: sourceCount,
      relevance_score: 0,
    });
  }

  return patterns;
}
