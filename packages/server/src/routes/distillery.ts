import type { Hono } from 'hono';
import { getDb } from '@hipp0/core/db/index.js';
import { parseDecision, parseSession } from '@hipp0/core/db/parsers.js';
import type { Decision } from '@hipp0/core/types.js';
import { distill, callLLM } from '@hipp0/core/distillery/index.js';
import { getModelIdentifier } from '@hipp0/core/distillery/extractor.js';
import { generateEmbedding } from '@hipp0/core/decision-graph/embeddings.js';
import { cosineSimilarity } from '@hipp0/core/decision-graph/embeddings.js';
import {
  requireUUID,
  requireString,
  optionalString,
  mapDbError,
  logAudit,
} from './validation.js';
import { requireProjectAccess } from './_helpers.js';

  // Ask Anything system prompt

const ASK_ANYTHING_SYSTEM_PROMPT = `You are a decision memory assistant for a software development team. Given a set of relevant decisions and a question, provide a clear, helpful answer.

Rules:
- Be concise: 2-4 sentences for simple questions, one paragraph max for complex ones
- Cite specific decisions by title when referencing them
- If decisions conflict with each other, note the contradiction
- If the question cannot be answered from the decisions, say so clearly
- Do NOT use markdown headers or bullet points — write natural prose
- Use the team's terminology naturally (agent names, project names, tools)`;

export function registerDistilleryRoutes(app: Hono): void {
  // POST /api/distill/ask — Ask Anything endpoint
  // Natural language query against the decision graph.
  app.post('/api/distill/ask', async (c) => {
    const body = await c.req.json<{
      project_id?: unknown;
      question?: unknown;
      agent_name?: unknown;
    }>();

    const projectId = requireUUID(body.project_id, 'project_id');
    await requireProjectAccess(c, projectId);
    const question = requireString(body.question, 'question', 2000);
    const agentName = optionalString(body.agent_name, 'agent_name', 200) ?? null;

    const db = getDb();

    // 1. Generate embedding for the question
    let questionEmbedding: number[];
    try {
      questionEmbedding = await generateEmbedding(question);
    } catch (err) {
      console.warn('[hipp0/ask] Embedding generation failed:', (err as Error).message);
      questionEmbedding = [];
    }

    // 2. Query decisions — prefer vector similarity if embedding available,
    //    otherwise fall back to text search
    interface ScoredDecision {
      id: string;
      title: string;
      description: string;
      made_by: string;
      confidence: string;
      status: string;
      tags: string[];
      created_at: string;
      similarity: number;
    }

    let relevantDecisions: ScoredDecision[] = [];

    const hasEmbedding = questionEmbedding.length > 0 && !questionEmbedding.every((v) => v === 0);

    if (hasEmbedding) {
      // Vector similarity search
      const vectorLiteral = `[${questionEmbedding.join(',')}]`;
      try {
        const result = await db.query(
          `SELECT id, title, description, made_by, confidence, status, tags, created_at,
                  1 - (embedding <=> ?) AS similarity
           FROM decisions
           WHERE project_id = ? AND status != 'superseded' AND embedding IS NOT NULL
           ORDER BY embedding <=> ?
           LIMIT 10`,
          [vectorLiteral, projectId, vectorLiteral],
        );
        relevantDecisions = result.rows.map((r) => {
          const row = r as Record<string, unknown>;
          return {
            id: row.id as string,
            title: row.title as string,
            description: (row.description as string) ?? '',
            made_by: (row.made_by as string) ?? '',
            confidence: (row.confidence as string) ?? 'medium',
            status: (row.status as string) ?? 'active',
            tags: Array.isArray(row.tags) ? row.tags as string[] : [],
            created_at: (row.created_at as string) ?? '',
            similarity: parseFloat(String(row.similarity ?? '0')),
          };
        });
      } catch (err) {
        console.warn('[hipp0/ask] Vector search failed:', (err as Error).message);
      }
    }

    // Fallback: text search if vector search returned nothing
    if (relevantDecisions.length === 0) {
      try {
        // Simple keyword matching
        const keywords = question.toLowerCase().split(/\s+/).filter((w) => w.length > 3).slice(0, 5);
        const result = await db.query(
          `SELECT id, title, description, made_by, confidence, status, tags, created_at
           FROM decisions
           WHERE project_id = ? AND status != 'superseded'
           ORDER BY created_at DESC
           LIMIT 20`,
          [projectId],
        );

        // Score by keyword overlap
        relevantDecisions = result.rows.map((r) => {
          const row = r as Record<string, unknown>;
          const text = `${row.title} ${row.description}`.toLowerCase();
          const matchCount = keywords.filter((kw) => text.includes(kw)).length;
          return {
            id: row.id as string,
            title: row.title as string,
            description: (row.description as string) ?? '',
            made_by: (row.made_by as string) ?? '',
            confidence: (row.confidence as string) ?? 'medium',
            status: (row.status as string) ?? 'active',
            tags: Array.isArray(row.tags) ? row.tags as string[] : [],
            created_at: (row.created_at as string) ?? '',
            similarity: matchCount / Math.max(keywords.length, 1),
          };
        })
        .filter((d) => d.similarity > 0)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 10);
      } catch (err) {
        console.warn('[hipp0/ask] Text search failed:', (err as Error).message);
      }
    }

    // 3. If no relevant decisions found, return early
    if (relevantDecisions.length === 0) {
      return c.json({
        answer: 'No relevant decisions found for this question. The project may not have any decisions recorded on this topic yet.',
        sources: [],
        tokens_used: 0,
      });
    }

    // 4. Build context and call Distillery (Opus)
    const decisionContext = relevantDecisions
      .map((d, i) => {
        return `Decision ${i + 1}: "${d.title}"
  Description: ${d.description}
  Made by: ${d.made_by}
  Confidence: ${d.confidence}
  Status: ${d.status}
  Tags: ${d.tags.join(', ')}`;
      })
      .join('\n\n');

    const userMessage = `Question: ${question}\n\nRelevant decisions:\n\n${decisionContext}`;

    let answer: string;
    let tokensUsed = 0;
    try {
      let rawAnswer = await callLLM(ASK_ANYTHING_SYSTEM_PROMPT, userMessage);
      // Strip markdown formatting from the answer
      rawAnswer = rawAnswer
        .replace(/^#{1,6}\s+/gm, '')  // Remove markdown headers
        .replace(/\*\*(.+?)\*\*/g, '$1')  // Remove bold
        .replace(/\*(.+?)\*/g, '$1')  // Remove italic
        .replace(/^[-*]\s+/gm, '')  // Remove bullet points
        .trim();
      answer = rawAnswer;
      // Rough token estimate: ~4 chars per token
      tokensUsed = Math.round((ASK_ANYTHING_SYSTEM_PROMPT.length + userMessage.length + answer.length) / 4);
    } catch (err) {
      console.error('[hipp0/ask] LLM call failed:', (err as Error).message);
      // Fallback: return the decisions directly without synthesis
      answer = `Found ${relevantDecisions.length} relevant decisions but synthesis failed. Top results: ${relevantDecisions.slice(0, 3).map((d) => `"${d.title}"`).join(', ')}.`;
    }

    logAudit('ask_anything', projectId, {
      question,
      agent_name: agentName,
      sources_count: relevantDecisions.length,
    });

    return c.json({
      answer,
      sources: relevantDecisions.map((d) => ({
        id: d.id,
        title: d.title,
        score: Math.round(d.similarity * 100) / 100,
      })),
      tokens_used: tokensUsed,
    });
  });

  // POST /api/projects/:id/distill — extract decisions from conversation text
  app.post('/api/projects/:id/distill', async (c) => {
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);
    const body = await c.req.json<{
      conversation_text?: unknown;
      agent_name?: unknown;
      session_id?: unknown;
    }>();

    const conversationText = requireString(body.conversation_text, 'conversation_text', 100000);
    const agentName = optionalString(body.agent_name, 'agent_name', 200) ?? 'distiller';

    const result = await distill(projectId, conversationText, agentName);

    logAudit('distill_completed', projectId, {
      decisions_extracted: result.decisions_extracted,
      contradictions_found: result.contradictions_found,
      agent_name: agentName,
    });

    return c.json(result, 201);
  });

  // POST /api/projects/:id/distill/session — extract + create session summary
  app.post('/api/projects/:id/distill/session', async (c) => {
    const db = getDb();
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);
    const body = await c.req.json<{
      conversation_text?: unknown;
      agent_name?: unknown;
      session_id?: unknown;
      topic?: unknown;
    }>();

    const conversationText = requireString(body.conversation_text, 'conversation_text', 100000);
    const agentName = requireString(body.agent_name, 'agent_name', 200);
    const topic = optionalString(body.topic, 'topic', 500) ?? 'Session';

    const distillResult = await distill(projectId, conversationText, agentName);

    try {
      const summaryResult = await db.query(
        `INSERT INTO session_summaries (
           project_id, agent_name, topic, summary,
           decision_ids, extraction_model, extraction_confidence
         ) VALUES (?, ?, ?, ?, ?, ?, ?)
         RETURNING *`,
        [
          projectId,
          agentName,
          topic,
          `Session with ${distillResult.decisions_extracted} decisions extracted`,
          db.arrayParam(distillResult.decisions.map((d: Decision) => d.id)),
          getModelIdentifier(),
          0.8,
        ],
      );

      const session = parseSession(summaryResult.rows[0] as Record<string, unknown>);

      logAudit('distill_session_completed', projectId, {
        session_id: session.id,
        decisions_extracted: distillResult.decisions_extracted,
        agent_name: agentName,
      });

      return c.json(
        {
          decisions_extracted: distillResult.decisions_extracted,
          contradictions_found: distillResult.contradictions_found,
          decisions: distillResult.decisions,
          session_summary: session,
        },
        201,
      );
    } catch (err) {
      mapDbError(err);
    }
  });

  // POST /api/projects/:id/sessions — create session summary manually
  app.post('/api/projects/:id/sessions', async (c) => {
    const db = getDb();
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);
    const body = await c.req.json<{
      agent_name?: unknown;
      topic?: unknown;
      summary?: unknown;
      decision_ids?: string[];
      artifact_ids?: string[];
      assumptions?: string[];
      open_questions?: string[];
      lessons_learned?: string[];
      raw_conversation_hash?: unknown;
      extraction_model?: unknown;
      extraction_confidence?: number;
    }>();

    const agent_name = requireString(body.agent_name, 'agent_name', 200);
    const topic = requireString(body.topic, 'topic', 500);
    const summary = requireString(body.summary, 'summary', 10000);

    try {
      const result = await db.query(
        `INSERT INTO session_summaries (
           project_id, agent_name, topic, summary,
           decision_ids, artifact_ids, assumptions,
           open_questions, lessons_learned,
           raw_conversation_hash, extraction_model, extraction_confidence
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
         RETURNING *`,
        [
          projectId,
          agent_name,
          topic,
          summary,
          db.arrayParam(body.decision_ids ?? []),
          db.arrayParam(body.artifact_ids ?? []),
          db.arrayParam(body.assumptions ?? []),
          db.arrayParam(body.open_questions ?? []),
          db.arrayParam(body.lessons_learned ?? []),
          optionalString(body.raw_conversation_hash, 'raw_conversation_hash', 256) ?? null,
          optionalString(body.extraction_model, 'extraction_model', 100) ?? null,
          body.extraction_confidence ?? null,
        ],
      );
      return c.json(parseSession(result.rows[0] as Record<string, unknown>), 201);
    } catch (err) {
      mapDbError(err);
    }
  });

  // GET /api/projects/:id/sessions — list session summaries
  app.get('/api/projects/:id/sessions', async (c) => {
    const db = getDb();
    const projectId = requireUUID(c.req.param('id'), 'projectId');
    await requireProjectAccess(c, projectId);
    const result = await db.query(
      'SELECT * FROM session_summaries WHERE project_id = ? ORDER BY created_at DESC',
      [projectId],
    );
    return c.json(result.rows.map((r) => parseSession(r as Record<string, unknown>)));
  });
}
