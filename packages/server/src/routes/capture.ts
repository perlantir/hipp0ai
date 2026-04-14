/**
 * Passive Decision Capture routes — auto-extract decisions from agent conversations.
 *
 * POST /api/capture — submit a conversation for background extraction
 * GET  /api/capture/:id — check capture status
 * GET  /api/projects/:id/captures — list captures for a project
 */

import type { Hono } from 'hono';
import { requireUUID, requireString, optionalString, logAudit, mapDbError } from './validation.js';
import { getDb } from '@hipp0/core/db/index.js';
import { distill } from '@hipp0/core/distillery/index.js';
import { withSpan, getMetrics, recordHistogram } from '../telemetry.js';
import { dispatchWebhooks } from '@hipp0/core/webhooks/index.js';
import { runCaptureDedup } from '@hipp0/core/intelligence/capture-dedup.js';
import { generateEmbedding } from '@hipp0/core/decision-graph/embeddings.js';
import { defaultProvenance, computeTrust } from '@hipp0/core/intelligence/trust-scorer.js';
import { safeEmit } from '../events/event-stream.js';

export function registerCaptureRoutes(app: Hono): void {
    // POST /api/capture — Submit conversation for background extraction
  app.post('/api/capture', async (c) => {
    const body = await c.req.json<{
      agent_name?: unknown;
      project_id?: unknown;
      conversation?: unknown;
      content?: unknown;
      text?: unknown;
      session_id?: unknown;
      source?: unknown;
      source_event_id?: unknown;
      source_channel?: unknown;
    }>();

    const agent_name = requireString(body.agent_name, 'agent_name', 200);
    const project_id = requireUUID(body.project_id, 'project_id');
    // Accept content/text as aliases for conversation
    const rawConversation = body.conversation ?? body.content ?? body.text;
    const conversation = requireString(rawConversation, 'conversation', 500000);
    const session_id = body.session_id ? requireUUID(body.session_id, 'session_id') : null;
    const source = optionalString(body.source, 'source', 50) ?? 'api';

    const source_event_id = optionalString(body.source_event_id, 'source_event_id', 500) ?? null;
    const source_channel = optionalString(body.source_channel, 'source_channel', 200) ?? null;

    const validSources = ['openclaw', 'telegram', 'slack', 'discord', 'github', 'api', 'cli', 'web', 'vscode', 'jetbrains', 'test', 'manual', 'hermes'];
    if (!validSources.includes(source)) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: `source must be one of: ${validSources.join(', ')}` } }, 400);
    }

    const db = getDb();

    // Verify project exists and check settings in one query
    const projResult = await db.query('SELECT id, metadata FROM projects WHERE id = ?', [project_id]);
    if (projResult.rows.length === 0) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404);
    }

    // Check auto_capture setting
    let metadata: Record<string, unknown> = {};
    const raw = (projResult.rows[0] as Record<string, unknown>).metadata;
    if (typeof raw === 'string') {
      try { metadata = JSON.parse(raw); } catch { /* empty */ }
    } else if (typeof raw === 'object' && raw !== null) {
      metadata = raw as Record<string, unknown>;
    }

    // auto_capture defaults to false; warn but don't block
    if (metadata.auto_capture === false) {
      console.warn(`[hipp0:capture] auto_capture is disabled for project ${project_id}, processing anyway (explicit API call)`);
    }

    // Dedup check — block exact duplicates
    const dedupResult = await runCaptureDedup(project_id, conversation);
    if (dedupResult.dedup_action === 'blocked_exact_dup') {
      return c.json({
        capture_id: dedupResult.exact_duplicate_id,
        status: 'duplicate',
        dedup_hash: dedupResult.dedup_hash,
        message: 'Exact duplicate capture detected within 24h window',
      }, 200);
    }

    // Insert capture record
    let captureId: string;
    try {
      const insertResult = await db.query(
        `INSERT INTO captures (project_id, agent_name, session_id, source, conversation_text, status, dedup_hash, dedup_result, source_event_id, source_channel)
         VALUES (?, ?, ?, ?, ?, 'processing', ?, ?, ?, ?)
         RETURNING id`,
        [project_id, agent_name, session_id, source, conversation, dedupResult.dedup_hash, JSON.stringify(dedupResult), source_event_id, source_channel],
      );

      captureId = (insertResult.rows[0] as Record<string, unknown>).id as string;
    } catch (err) {
      mapDbError(err);
      return; // TypeScript flow - mapDbError always throws
    }

    logAudit('capture_started', project_id, {
      capture_id: captureId,
      agent_name,
      source,
      session_id,
    });

    safeEmit('capture.started', project_id, {
      capture_id: captureId,
      agent_name,
      source,
      session_id,
    });

    // Return immediately — extraction runs in the background.
    //
    // Retry-After signals the recommended initial poll cadence for the
    // status endpoint (GET /api/capture/:id). The distillery pipeline
    // typically finishes in 1-10 seconds; clients should poll at this
    // interval with exponential backoff (cap ~5s) until status is
    // 'completed' or 'failed'. Documented here instead of in a separate
    // doc so the contract travels with the response.
    c.header('Retry-After', '1');
    const response = c.json({ capture_id: captureId, status: 'processing' }, 202);

    // Fire-and-forget background extraction
    void runCaptureExtraction(captureId, project_id, conversation, agent_name, session_id, source);

    return response;
  });

    // GET /api/capture/:id — Check capture status
  app.get('/api/capture/:id', async (c) => {
    const captureId = requireUUID(c.req.param('id'), 'capture_id');
    const projectId = c.req.query('project_id');
    const db = getDb();

    let sql = 'SELECT id, project_id, agent_name, session_id, source, status, extracted_decision_ids, error_message, created_at, completed_at FROM captures WHERE id = ?';
    const params: unknown[] = [captureId];
    if (projectId) {
      sql += ' AND project_id = ?';
      params.push(projectId);
    }

    const result = await db.query(sql, params);

    if (result.rows.length === 0) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Capture not found' } }, 404);
    }

    const row = result.rows[0] as Record<string, unknown>;
    let decisionIds: string[] = [];
    const rawIds = row.extracted_decision_ids;
    if (typeof rawIds === 'string') {
      try { decisionIds = JSON.parse(rawIds); } catch { /* empty */ }
    } else if (Array.isArray(rawIds)) {
      decisionIds = rawIds as string[];
    }

    return c.json({
      id: row.id,
      status: row.status,
      extracted_decision_count: decisionIds.length,
      extracted_decision_ids: decisionIds,
      error_message: row.error_message ?? null,
      created_at: row.created_at,
      completed_at: row.completed_at ?? null,
    });
  });

    // GET /api/projects/:id/captures — List captures for a project
  app.get('/api/projects/:id/captures', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'project_id');
    const db = getDb();
    const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 100);
    const offset = parseInt(c.req.query('offset') ?? '0', 10);

    const result = await db.query(
      `SELECT id, project_id, agent_name, session_id, source, status, extracted_decision_ids, error_message, created_at, completed_at
       FROM captures
       WHERE project_id = ?
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [projectId, limit, offset],
    );

    const captures = result.rows.map((row) => {
      const r = row as Record<string, unknown>;
      let decisionIds: string[] = [];
      const rawIds = r.extracted_decision_ids;
      if (typeof rawIds === 'string') {
        try { decisionIds = JSON.parse(rawIds); } catch { /* empty */ }
      } else if (Array.isArray(rawIds)) {
        decisionIds = rawIds as string[];
      }

      return {
        id: r.id,
        project_id: r.project_id,
        agent_name: r.agent_name,
        session_id: r.session_id ?? null,
        source: r.source,
        status: r.status,
        extracted_decision_count: decisionIds.length,
        extracted_decision_ids: decisionIds,
        error_message: r.error_message ?? null,
        created_at: r.created_at,
        completed_at: r.completed_at ?? null,
      };
    });

    return c.json(captures);
  });
}

/**
 * Background extraction — runs the distillery pipeline and updates the capture record.
 */
async function runCaptureExtraction(
  captureId: string,
  projectId: string,
  conversation: string,
  agentName: string,
  sessionId: string | null,
  source: string,
): Promise<void> {
  const db = getDb();
  const __captureStart = Date.now();
  let __captureSuccess = true;

  try {
    // Run the distillery pipeline — traced under the distill_conversation span.
    const result = await withSpan('distill_conversation', {
      project_id: projectId,
      agent_name: agentName,
      source,
    }, async () => distill(projectId, conversation, agentName, sessionId ?? undefined, source));

    // Mark extracted decisions with appropriate source and flag for review
    // SQLite's original CHECK constraint only allows 'manual', 'auto_distilled', 'imported'
    // so we use 'auto_distilled' on SQLite and record the real origin in provenance_chain
    const captureSource = db.dialect === 'sqlite' ? 'auto_distilled' : 'auto_capture';
    const decisionIds = result.decisions.map((d) => d.id);
    for (const id of decisionIds) {
      await db.query(
        `UPDATE decisions SET source = ?, confidence = 'low', review_status = 'pending_review', status = 'pending'
         WHERE id = ?`,
        [captureSource, id],
      ).catch((err) => {
        console.warn(`[hipp0:capture] Could not update source for decision ${id}:`, (err as Error).message);
      });
    }

    // Assign provenance chain from Phase 2 for passive captures
    for (const id of decisionIds) {
      const provenance = [defaultProvenance('auto_capture', agentName)];
      provenance[0].source_label = `Captured from ${agentName} via ${source}`;
      const { trust_score } = computeTrust({
        source: 'auto_capture',
        confidence: 'low',
        created_at: new Date().toISOString(),
        provenance_chain: provenance,
      } as Parameters<typeof computeTrust>[0]);
      await db.query(
        `UPDATE decisions SET provenance_chain = ?, trust_score = ? WHERE id = ? AND (provenance_chain IS NULL OR provenance_chain = '[]')`,
        [JSON.stringify(provenance), trust_score, id],
      ).catch(() => {});
    }

    // Insert extracted user_facts with confidence-gated supersession
    const SUPERSESSION_ENABLED = process.env.HIPP0_SUPERSESSION_ENABLED !== 'false';
    const SUPERSESSION_THRESHOLD = parseFloat(process.env.HIPP0_SUPERSESSION_CONFIDENCE_THRESHOLD || '0.85');

    if (result.user_facts && result.user_facts.length > 0) {
      let addedCount = 0;
      let supersededCount = 0;

      for (const fact of result.user_facts) {
        try {
          // Determine effective action
          let effectiveAction = fact.action ?? 'add';

          // If supersession disabled globally, force all to "add"
          if (!SUPERSESSION_ENABLED) {
            effectiveAction = 'add';
          }

          // If action is "supersede" but confidence below threshold, downgrade to "add"
          if (effectiveAction === 'supersede' && (fact.supersession_confidence ?? 0) < SUPERSESSION_THRESHOLD) {
            console.warn(`[hipp0:capture] Supersession confidence ${fact.supersession_confidence} below threshold ${SUPERSESSION_THRESHOLD} for key "${fact.key}" — downgrading to add`);
            effectiveAction = 'add';
          }

          if (effectiveAction === 'supersede') {
            // Find matching active fact with same key AND same scope.
            // user_facts are project-scoped (they describe the *user*, not the agent),
            // so we match across all agents in the project — otherwise one agent
            // can't correct a fact another agent captured.
            const supersededKey = fact.supersedes_key ?? fact.key;
            const existing = await db.query(
              `SELECT id FROM user_facts WHERE project_id = ? AND fact_key = ? AND scope = ? AND is_active = true`,
              [projectId, supersededKey, fact.scope ?? 'global'],
            );

            // Insert the new fact
            const insertResult = await db.query(
              `INSERT INTO user_facts (project_id, agent_name, user_id, fact_type, fact_key, fact_value, source, confidence, scope, category, is_active)
               VALUES (?, ?, 'owner', 'preference', ?, ?, 'conversation', ?, ?, ?, true)
               RETURNING id`,
              [projectId, agentName, fact.key, fact.value, fact.confidence, fact.scope ?? 'global', fact.category ?? 'general'],
            );
            const newFactId = (insertResult.rows[0] as Record<string, unknown>).id as string;

            // Supersede old facts if found
            if (existing.rows.length > 0) {
              for (const row of existing.rows) {
                const oldId = (row as Record<string, unknown>).id as string;
                await db.query(
                  `UPDATE user_facts SET is_active = false, superseded_by = ?, superseded_at = ? WHERE id = ?`,
                  [newFactId, new Date().toISOString(), oldId],
                );
              }
              console.log(`[hipp0:capture] Superseded ${existing.rows.length} fact(s) for key "${supersededKey}" → new value: "${fact.value}"`);
              supersededCount += existing.rows.length;
            }
            addedCount++;
          } else {
            // Action = "add" — upsert project-wide on (fact_key, scope). user_facts
            // describe the *user*, so the same key captured by different agents must
            // converge on a single row, not proliferate per agent. agent_name on the
            // row records the most-recent captor for auditing.
            const existing = await db.query(
              `SELECT id FROM user_facts WHERE project_id = ? AND fact_key = ? AND scope = ? AND is_active = true ORDER BY updated_at DESC LIMIT 1`,
              [projectId, fact.key, fact.scope ?? 'global'],
            );
            if (existing.rows.length > 0) {
              // Update existing fact value
              const factId = (existing.rows[0] as Record<string, unknown>).id as string;
              await db.query(
                `UPDATE user_facts SET fact_value = ?, confidence = ?, updated_at = ?, scope = ?, category = ?, agent_name = ? WHERE id = ?`,
                [fact.value, fact.confidence, new Date().toISOString(), fact.scope ?? 'global', fact.category ?? 'general', agentName, factId],
              );
            } else {
              // Semantic dedup: compare against last-N active facts in the
              // same (project_id, scope). If a near-duplicate exists (cosine
              // > 0.85) we merge onto that row — latest fact_value wins,
              // fact_key tracked in metadata if it differed — instead of
              // inserting a second nearly-identical row under a new key.
              const semanticMatchId = await findSemanticFactMatch(
                projectId,
                fact.scope ?? 'global',
                fact.key,
                fact.value,
              );
              if (semanticMatchId) {
                await db.query(
                  `UPDATE user_facts SET fact_value = ?, confidence = ?, updated_at = ?, category = ?, agent_name = ? WHERE id = ?`,
                  [fact.value, fact.confidence, new Date().toISOString(), fact.category ?? 'general', agentName, semanticMatchId],
                );
              } else {
                // Insert new fact
                await db.query(
                  `INSERT INTO user_facts (project_id, agent_name, user_id, fact_type, fact_key, fact_value, source, confidence, scope, category, is_active)
                   VALUES (?, ?, 'owner', 'preference', ?, ?, 'conversation', ?, ?, ?, true)`,
                  [projectId, agentName, fact.key, fact.value, fact.confidence, fact.scope ?? 'global', fact.category ?? 'general'],
                );
              }
            }
            addedCount++;
          }
        } catch (err) {
          console.warn(`[hipp0:capture] Failed to upsert user_fact ${fact.key}:`, (err as Error).message);
        }
      }
      console.log(`[hipp0:capture] Processed ${result.user_facts.length} user_facts for ${agentName}: ${addedCount} added/updated, ${supersededCount} superseded`);
    }

    // Insert extracted observations into the decisions table with status='observation'.
    // Re-uses the decisions table so the compile scorer naturally returns them
    // alongside regular decisions (its statusFilter only excludes 'superseded').
    if (result.observations && result.observations.length > 0) {
      let observationCount = 0;
      for (const obs of result.observations) {
        try {
          const content = obs.content ?? '';
          const title = content.length > 200 ? content.slice(0, 197) + '...' : content;
          const madeBy = obs.source_agent || agentName;
          await db.query(
            `INSERT INTO decisions
               (project_id, title, description, reasoning, made_by, source, confidence, status, tags)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              projectId,
              title || '(empty observation)',
              content,
              'Extracted from conversation by distillery',
              madeBy,
              'auto_capture',
              'low',
              'observation',
              db.arrayParam(obs.tags ?? []),
            ],
          );
          observationCount++;
        } catch (err) {
          console.warn(`[hipp0:capture] Failed to insert observation:`, (err as Error).message);
        }
      }
      console.log(`[hipp0:capture] Inserted ${observationCount}/${result.observations.length} observations for ${agentName}`);
    }

    // Update capture record
    await db.query(
      `UPDATE captures SET status = 'completed', extracted_decision_ids = ?, completed_at = ?, decisions_extracted = ?, facts_extracted = ?
       WHERE id = ?`,
      [db.arrayParam(decisionIds), new Date().toISOString(), decisionIds.length, (result.user_facts ?? []).length, captureId],
    );

    logAudit('capture_completed', projectId, {
      capture_id: captureId,
      decisions_extracted: decisionIds.length,
      agent_name: agentName,
    });

    safeEmit('capture.completed', projectId, {
      capture_id: captureId,
      decisions_extracted: decisionIds.length,
      decision_ids: decisionIds,
      agent_name: agentName,
      source,
    });

    // Dispatch webhook
    dispatchWebhooks(projectId, 'capture_completed', {
      capture_id: captureId,
      decisions_extracted: decisionIds.length,
      decision_ids: decisionIds,
      agent_name: agentName,
    }).catch((err) => console.warn('[hipp0:webhook]', (err as Error).message));

  } catch (err) {
    __captureSuccess = false;
    const errorMsg = (err as Error).message ?? 'Unknown extraction error';
    console.error(`[hipp0:capture] Extraction failed for capture ${captureId}:`, errorMsg);

    await db.query(
      `UPDATE captures SET status = 'failed', error_message = ?, completed_at = ?
       WHERE id = ?`,
      [errorMsg.slice(0, 2000), new Date().toISOString(), captureId],
    ).catch((updateErr) => {
      console.error(`[hipp0:capture] Failed to update capture status:`, (updateErr as Error).message);
    });

    logAudit('capture_failed', projectId, {
      capture_id: captureId,
      error: errorMsg,
    });
  } finally {
    try {
      const __m = getMetrics();
      recordHistogram(__m.captureDuration, Date.now() - __captureStart, {
        project_id: projectId,
        agent_name: agentName,
        source,
        success: __captureSuccess,
      });
    } catch { /* ignore */ }
  }
}

const SEMANTIC_FACT_DEDUP_THRESHOLD = 0.85;
const SEMANTIC_FACT_DEDUP_LAST_N = 50;

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Find a semantic near-duplicate for a proposed user_fact. Compares against
 * the last-N active user_facts rows in the same (project_id, scope) and
 * returns the matched row's id if cosine similarity between the proposed
 * fact's "key: value" text and the existing row's text exceeds
 * SEMANTIC_FACT_DEDUP_THRESHOLD. Returns null on any failure so the caller
 * falls back to a fresh INSERT.
 */
async function findSemanticFactMatch(
  projectId: string,
  scope: string,
  factKey: string,
  factValue: string,
): Promise<string | null> {
  try {
    const db = getDb();
    const recent = await db.query<Record<string, unknown>>(
      `SELECT id, fact_key, fact_value FROM user_facts
       WHERE project_id = ? AND scope = ? AND is_active = true
       ORDER BY updated_at DESC
       LIMIT ?`,
      [projectId, scope, SEMANTIC_FACT_DEDUP_LAST_N],
    );
    if (recent.rows.length === 0) return null;

    const candidateText = `${factKey}: ${factValue}`;
    const candidateEmbedding = await generateEmbedding(candidateText);
    if (!candidateEmbedding.length || candidateEmbedding.every((v) => v === 0)) return null;

    let bestId: string | null = null;
    let bestSim = SEMANTIC_FACT_DEDUP_THRESHOLD;
    for (const row of recent.rows) {
      const existingKey = (row.fact_key as string) ?? '';
      const existingValue = (row.fact_value as string) ?? '';
      const existingText = `${existingKey}: ${existingValue}`;
      const existingEmbedding = await generateEmbedding(existingText).catch(() => [] as number[]);
      if (!existingEmbedding.length) continue;
      const sim = cosineSimilarity(candidateEmbedding, existingEmbedding);
      if (sim > bestSim) {
        bestSim = sim;
        bestId = row.id as string;
      }
    }
    return bestId;
  } catch (err) {
    console.warn('[hipp0:capture] Semantic fact dedup failed:', (err as Error).message);
    return null;
  }
}
