/**
 * Fire-and-forget decision embedding. Called from the decision write path.
 * Non-fatal on failure - the decision write succeeds regardless.
 *
 * Writes to two locations:
 *   - decisions.embedding (inline column; read by contradiction-detector)
 *   - decision_embeddings (sidecar table in SQLite; joined by hybrid search)
 *
 * When HIPP0_EMBEDDING_PROVIDER is unset/off, this is a no-op.
 */
import { getDb } from '../db/index.js';
import { getEmbeddingProvider } from './embedding-provider.js';

export async function embedDecisionAsync(
  decisionId: string,
  title: string,
  content: string | null,
): Promise<void> {
  const provider = getEmbeddingProvider();
  if (!provider) return;

  try {
    const text = [title, content ?? ''].filter(Boolean).join('\n\n').slice(0, 16000);
    if (text.trim().length === 0) return;
    const [vec] = await provider.embed([text]);
    if (!vec || vec.length === 0) return;

    const db = getDb();
    // pgvector literal format; SQLite column is TEXT and stores the same string.
    const literal = `[${vec.join(',')}]`;

    // Inline column: decisions.embedding
    try {
      await db.query('UPDATE decisions SET embedding = ? WHERE id = ?', [literal, decisionId]);
    } catch (err) {
      console.warn('[hipp0:embed] decisions.embedding update failed:', (err as Error).message);
    }

    // Sidecar table: decision_embeddings (SQLite only; PK on decision_id so upsert is safe)
    try {
      await db.query(
        `INSERT INTO decision_embeddings (decision_id, embedding)
         VALUES (?, ?)
         ON CONFLICT (decision_id) DO UPDATE SET embedding = excluded.embedding`,
        [decisionId, literal],
      );
    } catch {
      // non-fatal: table may not exist on the current dialect
    }
  } catch (err) {
    console.warn('[hipp0:embed] embedDecisionAsync failed:', (err as Error).message);
  }
}

export function embedDecisionFireAndForget(
  decisionId: string,
  title: string,
  content: string | null,
): void {
  embedDecisionAsync(decisionId, title, content).catch(() => {});
}
