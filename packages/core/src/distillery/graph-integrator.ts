import crypto from 'node:crypto';
import type { ExtractedDecision, Decision, NotificationType } from '../types.js';
import { getDb } from '../db/index.js';
import { parseDecision } from '../db/parsers.js';
import { generateEmbedding } from '../decision-graph/embeddings.js';
import { propagateChange } from '../change-propagator/index.js';
import { classifyDecision } from '../hierarchy/classifier.js';

const SUPERSEDE_SIMILARITY_THRESHOLD = 0.92;

interface SupersedeCandidate {
  id: string;
  similarity: number;
}

/**
 * Stage 4 — Persist extracted decisions into the DB and integrate into the graph.
 * Inserts with source='auto_distilled', status='pending'. Auto-creates a
 * 'supersedes' edge when similarity to an existing decision exceeds threshold.
 */
export async function integrateDecisions(
  projectId: string,
  extracted: ExtractedDecision[],
  sessionId?: string,
): Promise<Decision[]> {
  if (extracted.length === 0) return [];

  const created: Decision[] = [];

  for (const ext of extracted) {
    try {
      const embedding = await generateEmbedding(`${ext.title}\n${ext.description}`).catch(
        (err: unknown) => {
          console.warn(
            `[hipp0:distillery] integrateDecisions: embedding failed for "${ext.title}":`,
            err,
          );
          return null;
        },
      );

      const vectorLiteral =
        embedding && !embedding.every((v) => v === 0) ? `[${embedding.join(',')}]` : null;

      let supersedes_id: string | undefined;
      if (vectorLiteral) {
        const db = getDb();
        const supersedeResult = await db.query<SupersedeCandidate>(
          `SELECT id,
                  1 - (embedding <=> ?) AS similarity
           FROM decisions
           WHERE project_id = ?
             AND status = 'active'
             AND embedding IS NOT NULL
             AND 1 - (embedding <=> ?) > ?
           ORDER BY similarity DESC
           LIMIT 1`,
          [vectorLiteral, projectId, vectorLiteral, SUPERSEDE_SIMILARITY_THRESHOLD],
        ).catch((err: unknown) => {
          console.warn('[hipp0:distillery] Supersede candidate query failed:', err);
          return { rows: [] as SupersedeCandidate[] };
        });

        supersedes_id = supersedeResult.rows[0]?.id;
      }

      const db = getDb();

      // Auto-approve logic: high confidence → active, medium/low → pending review
      const autoApproveThreshold = parseFloat(process.env.HIPP0_AUTO_APPROVE_THRESHOLD ?? '0.85');
      const confidenceScore = ext.confidence === 'high' ? 0.9 : ext.confidence === 'medium' ? 0.6 : 0.3;
      const autoApproved = confidenceScore >= autoApproveThreshold;
      const decisionStatus = autoApproved ? 'active' : 'pending';
      const reviewStatus = autoApproved ? 'approved' : 'pending_review';

      // Auto-classify domain + category
      const classification = classifyDecision(ext.title, ext.description, ext.tags, {
        source: 'auto_distilled',
        confidence: ext.confidence,
      });

      // Always client-generate the decision id. Postgres used to rely on
      // ``uuid_generate_v4()`` / ``gen_random_uuid()`` defaults on
      // decisions.id, but the SQLite schema (migration 001) declares
      // ``id TEXT NOT NULL PRIMARY KEY`` with no default, so INSERTs that
      // omit the column fail with ``NOT NULL constraint failed:
      // decisions.id``. Providing the id from JS works on both dialects
      // (Postgres's default only fires when the column is missing from
      // the INSERT list), so we share a single code path.
      const decisionId = crypto.randomUUID();

      const decision = await db.transaction(async (txQuery) => {
        const insertResult = await txQuery(
          `INSERT INTO decisions
             (id, project_id, title, description, reasoning, made_by, source,
              source_session_id, confidence, status, supersedes_id,
              alternatives_considered, affects, tags, assumptions,
              open_questions, dependencies, confidence_decay_rate, metadata,
              embedding, review_status, domain, category, priority_level)
           VALUES
             (?, ?, ?, ?, ?, ?, 'auto_distilled',
              ?, ?, ?, ?,
              ?, ?, ?, ?,
              ?, ?, 0, '{}',
              ?, ?, ?, ?, ?)
           RETURNING *`,
          [
            decisionId,
            projectId,
            ext.title,
            ext.description,
            ext.reasoning,
            'distillery',
            sessionId ?? null,
            ext.confidence,
            decisionStatus,
            supersedes_id ?? null,
            JSON.stringify(ext.alternatives_considered),
            db.arrayParam(ext.affects),
            db.arrayParam(ext.tags),
            JSON.stringify(ext.assumptions),
            JSON.stringify(ext.open_questions),
            JSON.stringify(ext.dependencies),
            vectorLiteral,
            reviewStatus,
            classification.domain,
            classification.category,
            1, // default priority_level
          ],
        );

        const row = insertResult.rows[0];
        if (!row) throw new Error('Insert returned no rows');
        const dec = parseDecision(row);

        if (supersedes_id) {
          await txQuery(
            `UPDATE decisions SET status = 'superseded', updated_at = ${db.dialect === 'sqlite' ? "datetime('now')" : 'NOW()'}
             WHERE id = ?`,
            [supersedes_id],
          );

          await txQuery(
            `INSERT INTO decision_edges
               (source_id, target_id, relationship, description, strength)
             VALUES (?, ?, 'supersedes', 'Auto-detected supersession by distillery', 1.0)
             ON CONFLICT (source_id, target_id, relationship) DO NOTHING`,
            [dec.id, supersedes_id],
          );

          console.warn(`[hipp0:distillery] "${dec.title}" supersedes decision ${supersedes_id}`);
        }

        return dec;
      });

      created.push(decision);

      // Fire-and-forget; errors caught inside propagateChange
      propagateChange(decision, 'decision_created' as NotificationType).catch((err: unknown) => {
        console.warn(`[hipp0:distillery] propagateChange failed for decision ${decision.id}:`, err);
      });
    } catch (err) {
      console.error(`[hipp0:distillery] integrateDecisions: failed to insert "${ext.title}":`, err);
    }
  }

  return created;
}
