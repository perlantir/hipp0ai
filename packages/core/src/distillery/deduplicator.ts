import type { ExtractedDecision } from '../types.js';
import { getDb } from '../db/index.js';
import { generateEmbedding } from '../decision-graph/embeddings.js';

const DEDUP_SIMILARITY_THRESHOLD = 0.9;

interface SimilarDecisionRow {
  id: string;
  similarity: number;
}

/** Stage 2 — Remove decisions already represented in the DB via pgvector similarity. */
export async function deduplicateDecisions(
  projectId: string,
  extracted: ExtractedDecision[],
): Promise<ExtractedDecision[]> {
  if (extracted.length === 0) return [];

  const unique: ExtractedDecision[] = [];

  for (const decision of extracted) {
    const textToEmbed = `${decision.title}\n${decision.description}`;

    let embedding: number[];
    try {
      embedding = await generateEmbedding(textToEmbed);
    } catch (err) {
      console.error(
        `[hipp0:distillery] deduplicateDecisions: embedding failed for "${decision.title}":`,
        err,
      );
      // Include when we can't verify — better a near-duplicate than silent drop
      unique.push(decision);
      continue;
    }

    // Zero-vector means embeddings unavailable (mock mode); skip similarity check
    const isZeroVector = embedding.every((v) => v === 0);
    if (isZeroVector) {
      unique.push(decision);
      continue;
    }

    const vectorLiteral = `[${embedding.join(',')}]`;

    let rows: SimilarDecisionRow[] = [];
    try {
      const db = getDb();
      const result = await db.query<SimilarDecisionRow>(
        `SELECT id,
                1 - (embedding <=> ?) AS similarity
         FROM decisions
         WHERE project_id = ?
           AND status = 'active'
           AND embedding IS NOT NULL
           AND 1 - (embedding <=> ?) > ?
         ORDER BY similarity DESC
         LIMIT 1`,
        [vectorLiteral, projectId, vectorLiteral, DEDUP_SIMILARITY_THRESHOLD],
      );
      rows = result.rows;
    } catch (err) {
      console.error(
        `[hipp0:distillery] deduplicateDecisions: similarity query failed for "${decision.title}":`,
        err,
      );
      unique.push(decision);
      continue;
    }

    if (rows.length > 0) {
      console.warn(
        `[hipp0:distillery] Duplicate detected for "${decision.title}" ` +
          `(similarity=${rows[0]?.similarity?.toFixed(4)}); skipping.`,
      );
      continue;
    }

    // Within-batch dedup: check against already-accepted items
    const normalizedTitle = decision.title.toLowerCase().trim();
    const batchDuplicate = unique.some((accepted) => {
      const acceptedTitle = accepted.title.toLowerCase().trim();
      // Exact title match
      if (acceptedTitle === normalizedTitle) return true;
      // Near-match: one title contains the other and they're similar length
      if (acceptedTitle.length > 10 && normalizedTitle.length > 10) {
        if (acceptedTitle.includes(normalizedTitle) || normalizedTitle.includes(acceptedTitle)) {
          const lenRatio = Math.min(acceptedTitle.length, normalizedTitle.length) / Math.max(acceptedTitle.length, normalizedTitle.length);
          if (lenRatio > 0.7) return true;
        }
      }
      return false;
    });

    if (batchDuplicate) {
      console.warn(`[hipp0:distillery] Within-batch duplicate: "${decision.title}" — skipping.`);
      continue;
    }

    unique.push(decision);
  }

  return unique;
}
