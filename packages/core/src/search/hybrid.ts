/**
 * Hybrid search pipeline: parallel FTS + vector search -> RRF fusion.
 *
 * Stage 1: Parallel keyword (FTS) + vector (HNSW cosine) search
 * Stage 2: Reciprocal Rank Fusion (K=60)
 * Stage 3: Jaccard deduplication + type diversity
 */

import { getDb } from '../db/index.js';
import { getEmbeddingProvider, cosineSim } from '../intelligence/embedding-provider.js';
import { classifyIntent, type SearchIntent } from './intent-classifier.js';

const RRF_K = 60;

interface SearchCandidate {
  id: string;
  kind: 'decision' | 'entity';
  title: string;
  content: string;
  fts_rank?: number;
  vec_rank?: number;
  rrf_score: number;
}

function applyRRF(
  ftsResults: Array<{ id: string; kind: 'decision' | 'entity'; title: string; content: string }>,
  vecResults: Array<{ id: string; kind: 'decision' | 'entity'; title: string; content: string }>,
): SearchCandidate[] {
  const scores = new Map<string, SearchCandidate>();

  for (let i = 0; i < ftsResults.length; i++) {
    const item = ftsResults[i];
    const key = `${item.kind}:${item.id}`;
    const existing = scores.get(key) ?? { ...item, rrf_score: 0 };
    scores.set(key, { ...existing, fts_rank: i + 1, rrf_score: existing.rrf_score + 1 / (RRF_K + i + 1) });
  }

  for (let i = 0; i < vecResults.length; i++) {
    const item = vecResults[i];
    const key = `${item.kind}:${item.id}`;
    const existing = scores.get(key) ?? { ...item, rrf_score: 0 };
    scores.set(key, { ...existing, vec_rank: i + 1, rrf_score: existing.rrf_score + 1 / (RRF_K + i + 1) });
  }

  const items = Array.from(scores.values());
  const maxScore = Math.max(...items.map((i) => i.rrf_score), 0.001);
  for (const item of items) {
    item.rrf_score = item.rrf_score / maxScore;
  }

  return items.sort((a, b) => b.rrf_score - a.rrf_score);
}

function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(a.toLowerCase().split(/\s+/));
  const setB = new Set(b.toLowerCase().split(/\s+/));
  const intersection = new Set([...setA].filter((x) => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

export interface HybridSearchResult {
  id: string;
  kind: 'decision' | 'entity';
  title: string;
  content: string;
  rrf_score: number;
  intent: SearchIntent;
}

async function vectorStage(
  db: ReturnType<typeof getDb>,
  projectId: string,
  query: string,
): Promise<Array<{ id: string; kind: 'decision'; title: string; content: string }>> {
  if (!query || query.trim().length === 0) return [];
  let provider;
  try {
    provider = getEmbeddingProvider();
  } catch {
    return [];
  }
  if (!provider) return [];

  let queryVec: number[];
  try {
    const [vec] = await provider.embed([query]);
    if (!vec || vec.length === 0) return [];
    queryVec = vec;
  } catch {
    return [];
  }

  // Try Postgres pgvector path first (operator <=> computes cosine distance)
  const pgvectorLiteral = `[${queryVec.join(',')}]`;
  try {
    const res = await db.query<Record<string, unknown>>(
      `SELECT d.id, d.title, d.description AS content
       FROM decisions d
       WHERE d.project_id = ? AND d.status != 'superseded' AND d.embedding IS NOT NULL
       ORDER BY d.embedding <=> ?
       LIMIT 20`,
      [projectId, pgvectorLiteral],
    );
    if (res.rows.length > 0) {
      return res.rows.map((row) => ({
        id: row.id as string,
        kind: 'decision' as const,
        title: row.title as string,
        content: ((row.content as string) ?? '').slice(0, 500),
      }));
    }
  } catch {
    // Fall through to SQLite path
  }

  // SQLite/TEXT fallback: load candidates, compute cosine in-process
  try {
    const candidates = await db.query<Record<string, unknown>>(
      `SELECT d.id, d.title, d.description AS content, de.embedding AS embedding_text
       FROM decisions d
       LEFT JOIN decision_embeddings de ON de.decision_id = d.id
       WHERE d.project_id = ? AND d.status != 'superseded'
         AND (de.embedding IS NOT NULL OR d.embedding IS NOT NULL)
       LIMIT 500`,
      [projectId],
    );
    const scored: Array<{ row: Record<string, unknown>; score: number }> = [];
    for (const row of candidates.rows) {
      const rawEmb = (row.embedding_text as string | null) ?? null;
      if (!rawEmb) continue;
      let vec: number[];
      try {
        vec = JSON.parse(rawEmb) as number[];
      } catch {
        continue;
      }
      if (!Array.isArray(vec) || vec.length !== queryVec.length) continue;
      scored.push({ row, score: cosineSim(queryVec, vec) });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 20).map((s) => ({
      id: s.row.id as string,
      kind: 'decision' as const,
      title: s.row.title as string,
      content: ((s.row.content as string) ?? '').slice(0, 500),
    }));
  } catch {
    return [];
  }
}

export async function hybridSearch(
  projectId: string,
  query: string,
  limit = 10,
): Promise<HybridSearchResult[]> {
  const db = getDb();
  const intent = classifyIntent(query);
  const ftsQuery = query.replace(/['"]/g, '').trim();
  const ftsLike = `%${ftsQuery.toLowerCase()}%`;

  const [ftsDecisions, ftsEntities] = await Promise.all([
    // FTS on decisions - LIKE search (SQLite compatible)
    // decisions table uses 'description' column; alias to 'content' for uniform interface
    ftsQuery.length > 0
      ? db.query<Record<string, unknown>>(
          `SELECT id, title, description AS content FROM decisions
           WHERE project_id = ? AND (lower(title) LIKE ? OR lower(description) LIKE ?)
             AND status != 'superseded'
           ORDER BY updated_at DESC LIMIT 20`,
          [projectId, ftsLike, ftsLike],
        ).then((r) => r.rows.map((row) => ({
          id: row.id as string,
          kind: 'decision' as const,
          title: row.title as string,
          content: ((row.content as string) ?? '').slice(0, 500),
        }))).catch(() => [])
      : Promise.resolve([]),

    // FTS on entity pages (only if not purely decision-intent)
    intent !== 'decision' && ftsQuery.length > 0
      ? db.query<Record<string, unknown>>(
          `SELECT id, title, compiled_truth AS content FROM entity_pages
           WHERE project_id = ? AND (lower(title) LIKE ? OR lower(compiled_truth) LIKE ?)
           ORDER BY tier ASC, mention_count DESC LIMIT 10`,
          [projectId, ftsLike, ftsLike],
        ).then((r) => r.rows.map((row) => ({
          id: row.id as string,
          kind: 'entity' as const,
          title: row.title as string,
          content: ((row.content as string) ?? '').slice(0, 500),
        }))).catch(() => [])
      : Promise.resolve([]),
  ]);

  // Vector search (best-effort - no-op if provider disabled or embeddings absent)
  const vecDecisions = await vectorStage(db, projectId, ftsQuery);

  // RRF fusion
  const fused = applyRRF([...ftsDecisions, ...ftsEntities], vecDecisions);

  // Jaccard dedup (> 0.80)
  const deduped: SearchCandidate[] = [];
  for (const candidate of fused) {
    const isDuplicate = deduped.some(
      (d) => jaccardSimilarity(d.content, candidate.content) > 0.80,
    );
    if (!isDuplicate) deduped.push(candidate);
  }

  // Type diversity: no type > 60%
  const maxPerKind = Math.ceil(limit * 0.6);
  const kindCounts = new Map<string, number>();
  const diversified: SearchCandidate[] = [];
  for (const candidate of deduped) {
    const count = kindCounts.get(candidate.kind) ?? 0;
    if (count < maxPerKind) {
      diversified.push(candidate);
      kindCounts.set(candidate.kind, count + 1);
    }
    if (diversified.length >= limit) break;
  }

  return diversified.slice(0, limit).map((c) => ({ ...c, intent }));
}
