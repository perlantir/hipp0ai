#!/usr/bin/env tsx
/**
 * Backfill embeddings for decisions that don't have them.
 *
 * Usage:
 *   HIPP0_EMBEDDING_PROVIDER=openai OPENAI_API_KEY=sk-... \
 *     npx tsx packages/core/scripts/backfill-embeddings.ts [project_id]
 *
 * If project_id is omitted, backfills all projects.
 *
 * Processes in batches of 100. Respects rate limits via small delay between batches.
 */
import { initDb, getDb, closeDb } from '../src/db/index.js';
import { embedDecisionAsync } from '../src/intelligence/decision-embedder.js';
import { getEmbeddingProvider } from '../src/intelligence/embedding-provider.js';

const BATCH_SIZE = 100;
const DELAY_MS = 500;

async function main(): Promise<void> {
  const projectId = process.argv[2];
  const provider = getEmbeddingProvider();
  if (!provider) {
    console.error('HIPP0_EMBEDDING_PROVIDER is not set. Aborting.');
    process.exit(1);
  }

  await initDb();
  const db = getDb();

  const sql = projectId
    ? `SELECT id, title, description, reasoning FROM decisions
       WHERE project_id = ? AND embedding IS NULL ORDER BY created_at DESC LIMIT ?`
    : `SELECT id, title, description, reasoning FROM decisions
       WHERE embedding IS NULL ORDER BY created_at DESC LIMIT ?`;

  let totalProcessed = 0;
  let totalFailed = 0;

  while (true) {
    const params = projectId ? [projectId, BATCH_SIZE] : [BATCH_SIZE];
    const batch = await db.query<Record<string, unknown>>(sql, params);
    if (batch.rows.length === 0) break;

    console.log(`[backfill] Processing batch of ${batch.rows.length} decisions...`);
    let batchSuccesses = 0;

    for (const row of batch.rows) {
      const id = row.id as string;
      const title = (row.title as string) ?? '';
      const content = ((row.description as string) ?? (row.reasoning as string) ?? '') as string;
      try {
        await embedDecisionAsync(id, title, content);
        totalProcessed++;
        batchSuccesses++;
      } catch (err) {
        totalFailed++;
        console.warn(`[backfill] Failed to embed ${id}: ${(err as Error).message}`);
      }
    }

    console.log(`[backfill] Progress: processed=${totalProcessed} failed=${totalFailed}`);

    if (batchSuccesses === 0) {
      console.log('[backfill] No progress in last batch. Stopping.');
      break;
    }

    await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  console.log(`[backfill] DONE. processed=${totalProcessed} failed=${totalFailed}`);
  await closeDb();
  process.exit(0);
}

main().catch((err) => {
  console.error('[backfill] FATAL:', err);
  process.exit(1);
});
