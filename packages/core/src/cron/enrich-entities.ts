/**
 * Enrich stale or empty entity pages by calling the enrichment provider.
 * Selects Tier 1-2 entities where compiled_truth is empty OR last update is > N days ago.
 *
 * Designed to be invoked by a scheduler or by an admin API endpoint.
 * Respects daily USD budget cap from HIPP0_ENRICHMENT_DAILY_USD_CAP.
 */

import { getDb } from '../db/index.js';
import { getEnrichmentProvider } from '../intelligence/entity-enrichment-provider.js';
import { upsertEntityPage } from '../intelligence/entity-enricher.js';

export interface EnrichJobOptions {
  maxEntities?: number;     // default 5
  minTier?: 1 | 2 | 3;      // default 2 (tier <= minTier means enrich)
  staleDays?: number;       // default 7
}

export interface EnrichJobResult {
  attempted: number;
  succeeded: number;
  failed: number;
  totalCostUsd: number;
  spentBefore: number;
  skipped: string[];        // reasons
}

export async function enrichStaleEntities(
  projectId: string,
  options: EnrichJobOptions = {},
): Promise<EnrichJobResult> {
  const result: EnrichJobResult = { attempted: 0, succeeded: 0, failed: 0, totalCostUsd: 0, spentBefore: 0, skipped: [] };
  const provider = getEnrichmentProvider();
  if (!provider) {
    result.skipped.push('no enrichment provider configured');
    return result;
  }

  const max = options.maxEntities ?? 5;
  const minTier = options.minTier ?? 2;
  const stale = options.staleDays ?? 7;
  const dailyCap = Number(process.env.HIPP0_ENRICHMENT_DAILY_USD_CAP ?? '5');

  const db = getDb();

  // Read today's spend so the cap applies across all invocations within the day
  const today = new Date().toISOString().slice(0, 10);
  const spentTodayRes = await db.query<Record<string, unknown>>(
    `SELECT COALESCE(SUM(cost_usd), 0) as spent FROM enrichment_cost_log WHERE project_id = ? AND date = ?`,
    [projectId, today],
  ).catch(() => ({ rows: [{ spent: 0 }] as Record<string, unknown>[] }));
  const spentToday = Number((spentTodayRes.rows[0] as any)?.spent ?? 0);
  result.spentBefore = spentToday;
  result.totalCostUsd = spentToday;
  if (spentToday >= dailyCap) {
    result.skipped.push(`daily cost cap ${dailyCap} already reached for ${today}`);
    return result;
  }

  // Select candidates: tier <= minTier, compiled_truth NULL or empty, OR updated_at older than stale days
  const staleCutoff = new Date(Date.now() - stale * 24 * 60 * 60 * 1000).toISOString();
  const rows = await db.query<Record<string, unknown>>(
    `SELECT id, title, type, slug, compiled_truth, updated_at
     FROM entity_pages
     WHERE project_id = ?
       AND tier <= ?
       AND (compiled_truth IS NULL OR compiled_truth = '' OR updated_at < ?)
     ORDER BY tier ASC, mention_count DESC
     LIMIT ?`,
    [projectId, minTier, staleCutoff, max],
  );

  for (const row of rows.rows) {
    if (result.totalCostUsd >= dailyCap) {
      result.skipped.push(`daily cost cap ${dailyCap} reached`);
      break;
    }
    result.attempted++;
    const title = row.title as string;
    const type = row.type as string;
    const slug = row.slug as string;

    // Build context from recent timeline entries
    const ctxRows = await db.query<Record<string, unknown>>(
      `SELECT summary FROM entity_timeline_entries WHERE entity_id = ? ORDER BY created_at DESC LIMIT 5`,
      [row.id],
    );
    const context = ctxRows.rows.map(r => r.summary as string).join('\n');

    try {
      const enriched = await provider.enrich(title, type, context);
      if (!enriched) {
        result.failed++;
        continue;
      }
      // Update via upsertEntityPage with compiledTruth
      await upsertEntityPage(projectId, title, type as 'person' | 'company' | 'concept' | 'tool' | 'source', `enrichment:${enriched.source}`, '', {
        compiledTruth: enriched.compiledTruth,
      });
      await db.query(
        `INSERT INTO enrichment_cost_log (project_id, date, cost_usd, source, entity_id)
         VALUES (?, ?, ?, ?, ?)`,
        [projectId, today, enriched.costUsd, enriched.source, row.id],
      ).catch(() => {});
      result.succeeded++;
      result.totalCostUsd += enriched.costUsd;
    } catch (err) {
      result.failed++;
      console.warn(`[enrich] Failed to enrich ${slug}: ${(err as Error).message}`);
    }
  }

  return result;
}
