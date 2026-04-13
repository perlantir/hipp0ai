import crypto from 'node:crypto';
import { getDb } from '../db/index.js';
import { generateEmbedding } from '../decision-graph/embeddings.js';

const EXACT_DEDUP_WINDOW_HOURS = 24;
const SEMANTIC_DEDUP_THRESHOLD = 0.88;

/**
 * Compute a deterministic content hash for exact dedup.
 * Uses the conversation text normalized (trimmed, lowercased).
 */
export function computeCaptureHash(conversationText: string): string {
  const normalized = conversationText.trim().toLowerCase().replace(/\s+/g, ' ');
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

/**
 * Check for exact duplicate capture within the recent window.
 * Returns the existing capture ID if a duplicate is found, null otherwise.
 */
export async function checkExactDuplicate(
  projectId: string,
  dedupHash: string,
): Promise<string | null> {
  const db = getDb();
  const windowClause = db.dialect === 'sqlite'
    ? `created_at >= datetime('now', '-${EXACT_DEDUP_WINDOW_HOURS} hours')`
    : `created_at >= NOW() - INTERVAL '${EXACT_DEDUP_WINDOW_HOURS} hours'`;

  const result = await db.query<Record<string, unknown>>(
    `SELECT id FROM captures
     WHERE project_id = ? AND dedup_hash = ? AND ${windowClause}
     LIMIT 1`,
    [projectId, dedupHash],
  );

  return result.rows.length > 0 ? (result.rows[0].id as string) : null;
}

/**
 * Check for near-duplicate decisions using semantic similarity.
 * Returns IDs of similar existing decisions if found.
 */
export async function checkSemanticDuplicates(
  projectId: string,
  title: string,
  description: string,
  threshold: number = SEMANTIC_DEDUP_THRESHOLD,
): Promise<Array<{ id: string; title: string; similarity: number }>> {
  const db = getDb();

  let embedding: number[];
  try {
    embedding = await generateEmbedding(`${title}\n${description}`);
  } catch {
    return []; // Can't check — allow through
  }

  if (embedding.every((v) => v === 0)) return [];

  const vectorLiteral = `[${embedding.join(',')}]`;

  try {
    const result = await db.query<Record<string, unknown>>(
      `SELECT id, title, 1 - (embedding <=> ?) AS similarity
       FROM decisions
       WHERE project_id = ?
         AND status = 'active'
         AND embedding IS NOT NULL
         AND 1 - (embedding <=> ?) > ?
       ORDER BY similarity DESC
       LIMIT 3`,
      [vectorLiteral, projectId, vectorLiteral, threshold],
    );

    return result.rows.map((r) => ({
      id: r.id as string,
      title: r.title as string,
      similarity: Number(r.similarity),
    }));
  } catch {
    return [];
  }
}

/**
 * Build dedup metadata to attach to capture records for visibility.
 */
export interface DedupResult {
  dedup_hash: string;
  exact_duplicate_id: string | null;
  similar_decision_ids: string[];
  dedup_action: 'allowed' | 'blocked_exact_dup' | 'flagged_near_dup';
}

export async function runCaptureDedup(
  projectId: string,
  conversationText: string,
): Promise<DedupResult> {
  const dedupHash = computeCaptureHash(conversationText);
  const exactDup = await checkExactDuplicate(projectId, dedupHash);

  if (exactDup) {
    return {
      dedup_hash: dedupHash,
      exact_duplicate_id: exactDup,
      similar_decision_ids: [],
      dedup_action: 'blocked_exact_dup',
    };
  }

  return {
    dedup_hash: dedupHash,
    exact_duplicate_id: null,
    similar_decision_ids: [],
    dedup_action: 'allowed',
  };
}
