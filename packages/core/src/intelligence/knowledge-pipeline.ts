/**
 * Three-Tier Knowledge Pipeline
 *
 * Promotes raw traces up through queryable facts to distilled insights:
 *
 *   Tier 1 (Interaction): Raw captures, sessions, webhook ingests, tool traces
 *                         Lives in: captures, task_sessions tables
 *   Tier 2 (Facts):       Structured, queryable decisions with relationships
 *                         Lives in: decisions, decision_edges tables
 *   Tier 3 (Insights):    Distilled team knowledge — reusable procedures,
 *                         policies, learned rules
 *                         Lives in: knowledge_insights table (NEW)
 *
 * This module exposes:
 *   - promoteToFacts(projectId)    → Tier 1 → Tier 2 (runs the distillery)
 *   - promoteToInsights(projectId) → Tier 2 → Tier 3 (statistical analysis)
 *   - getInsights(projectId, ?)    → query insights with filters
 *   - runFullPipeline(projectId)   → run both promotions in sequence
 *
 * No LLM calls are made in the Tier 2 → Tier 3 promotion — it is pure SQL
 * and statistics over decisions, outcomes, and compile history.
 */
import { randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';
import { distill } from '../distillery/index.js';

// ─ Types ─

export type InsightType = 'procedure' | 'policy' | 'anti_pattern' | 'domain_rule';
export type InsightStatus = 'active' | 'superseded' | 'dismissed';

export interface KnowledgeInsight {
  id: string;
  project_id: string;
  insight_type: InsightType;
  title: string;
  description: string;
  evidence_decision_ids: string[];
  confidence: number;
  domain: string | null;
  tags: string[];
  status: InsightStatus;
  created_at: string;
  updated_at: string;
}

export interface PromoteToFactsResult {
  captures_processed: number;
  facts_extracted: number;
  errors: number;
}

export interface PromoteToInsightsResult {
  procedures_created: number;
  policies_created: number;
  anti_patterns_created: number;
  domain_rules_created: number;
  total_created: number;
}

export interface PipelineSummary {
  tier1_to_tier2: PromoteToFactsResult;
  tier2_to_tier3: PromoteToInsightsResult;
  duration_ms: number;
}

export interface GetInsightsOptions {
  type?: InsightType;
  domain?: string;
  min_confidence?: number;
  status?: InsightStatus;
  tags?: string[];
  limit?: number;
}

// ─ Helpers ─

function parseJsonArray(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter((v) => typeof v === 'string') as string[];
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter((v) => typeof v === 'string');
    } catch {
      // Postgres array literal like {a,b,c}
      if (raw.startsWith('{') && raw.endsWith('}')) {
        return raw.slice(1, -1).split(',').map((v) => v.trim()).filter(Boolean);
      }
    }
  }
  return [];
}

function parseInsightRow(row: Record<string, unknown>): KnowledgeInsight {
  return {
    id: row.id as string,
    project_id: row.project_id as string,
    insight_type: row.insight_type as InsightType,
    title: row.title as string,
    description: row.description as string,
    evidence_decision_ids: parseJsonArray(row.evidence_decision_ids),
    confidence: Number(row.confidence ?? 0.5),
    domain: (row.domain as string | null) ?? null,
    tags: parseJsonArray(row.tags),
    status: (row.status as InsightStatus) ?? 'active',
    created_at:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at ?? ''),
    updated_at:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : String(row.updated_at ?? ''),
  };
}

async function insertInsight(params: {
  project_id: string;
  insight_type: InsightType;
  title: string;
  description: string;
  evidence_decision_ids: string[];
  confidence: number;
  domain?: string | null;
  tags?: string[];
}): Promise<string> {
  const db = getDb();
  const id = randomUUID();
  await db.query(
    `INSERT INTO knowledge_insights
     (id, project_id, insight_type, title, description,
      evidence_decision_ids, confidence, domain, tags, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
    [
      id,
      params.project_id,
      params.insight_type,
      params.title,
      params.description,
      db.arrayParam(params.evidence_decision_ids),
      Math.max(0, Math.min(1, params.confidence)),
      params.domain ?? null,
      db.arrayParam(params.tags ?? []),
    ],
  );
  return id;
}

/**
 * Check whether an insight with the same title already exists and is active.
 * Used to avoid duplicating insights on repeated pipeline runs.
 */
async function insightExists(
  projectId: string,
  insightType: InsightType,
  title: string,
): Promise<boolean> {
  const db = getDb();
  const result = await db.query(
    `SELECT id FROM knowledge_insights
     WHERE project_id = ? AND insight_type = ? AND title = ? AND status = 'active'
     LIMIT 1`,
    [projectId, insightType, title],
  );
  return result.rows.length > 0;
}

// ─ Tier 1 → Tier 2 ─

/**
 * Scan recent captures that haven't been processed, run the distillery to
 * extract decisions from them, and mark them completed.
 * Returns count of new facts (decisions) extracted.
 */
export async function promoteToFacts(projectId: string): Promise<PromoteToFactsResult> {
  const db = getDb();

  // Find captures that are still in 'processing' state OR that completed with
  // zero extracted decisions (and are thus ripe for another pass).
  const pending = await db.query<Record<string, unknown>>(
    `SELECT id, conversation_text, agent_name, session_id
     FROM captures
     WHERE project_id = ?
       AND status = 'processing'
     ORDER BY created_at ASC
     LIMIT 50`,
    [projectId],
  );

  let factsExtracted = 0;
  let errors = 0;
  let processed = 0;

  for (const row of pending.rows) {
    const captureId = row.id as string;
    const conversation = (row.conversation_text as string) ?? '';
    const agentName = (row.agent_name as string) ?? 'unknown';
    const sessionId = (row.session_id as string) ?? undefined;

    if (!conversation.trim()) {
      // Nothing to extract; mark completed with empty decision list
      await db.query(
        `UPDATE captures
         SET status = 'completed', extracted_decision_ids = ?, completed_at = ?
         WHERE id = ?`,
        [db.arrayParam([]), new Date().toISOString(), captureId],
      ).catch(() => {});
      processed++;
      continue;
    }

    try {
      const result = await distill(projectId, conversation, agentName, sessionId);
      const decisionIds = (result.decisions ?? []).map((d) => d.id);
      factsExtracted += decisionIds.length;
      processed++;

      await db.query(
        `UPDATE captures
         SET status = 'completed',
             extracted_decision_ids = ?,
             completed_at = ?
         WHERE id = ?`,
        [db.arrayParam(decisionIds), new Date().toISOString(), captureId],
      ).catch(() => {});
    } catch (err) {
      errors++;
      const msg = (err as Error).message ?? 'unknown error';
      await db.query(
        `UPDATE captures
         SET status = 'failed',
             error_message = ?,
             completed_at = ?
         WHERE id = ?`,
        [msg.slice(0, 2000), new Date().toISOString(), captureId],
      ).catch(() => {});
    }
  }

  return {
    captures_processed: processed,
    facts_extracted: factsExtracted,
    errors,
  };
}

// ─ Tier 2 → Tier 3 ─

/**
 * Detect repeated agent-ordering sequences in compile_history.
 * A procedure is considered "common" when the same ordered sequence of 2-3
 * agents appears at least 3 times within the project's compile history.
 */
async function detectProcedures(projectId: string): Promise<number> {
  const db = getDb();

  // Fetch compile_history rows ordered by time so we can build sequences.
  // We limit to the most recent 500 compiles for efficiency.
  const result = await db.query<Record<string, unknown>>(
    `SELECT agent_name, compiled_at, task_description
     FROM compile_history
     WHERE project_id = ?
     ORDER BY compiled_at ASC
     LIMIT 500`,
    [projectId],
  );

  const rows = result.rows;
  if (rows.length < 3) return 0;

  // Build windowed sequences of 3 consecutive agents.
  const seqCounts = new Map<string, { count: number; agents: string[] }>();
  for (let i = 0; i < rows.length - 2; i++) {
    const a = (rows[i].agent_name as string) ?? '';
    const b = (rows[i + 1].agent_name as string) ?? '';
    const c = (rows[i + 2].agent_name as string) ?? '';
    if (!a || !b || !c) continue;
    // Skip degenerate "same agent three times" sequences
    if (a === b && b === c) continue;
    const key = `${a}->${b}->${c}`;
    const existing = seqCounts.get(key);
    if (existing) {
      existing.count++;
    } else {
      seqCounts.set(key, { count: 1, agents: [a, b, c] });
    }
  }

  let created = 0;
  for (const [key, info] of seqCounts) {
    if (info.count < 3) continue;

    const title = `Procedure: ${info.agents.join(' → ')}`;
    if (await insightExists(projectId, 'procedure', title)) continue;

    // Confidence scales with how often the sequence repeats, capped at 0.95.
    const confidence = Math.min(0.95, 0.4 + info.count * 0.1);

    const description =
      `When work flows through ${info.agents[0]}, the team commonly follows ` +
      `with ${info.agents[1]} and then ${info.agents[2]}. ` +
      `This sequence has been observed ${info.count} times in recent work.`;

    try {
      await insertInsight({
        project_id: projectId,
        insight_type: 'procedure',
        title,
        description,
        evidence_decision_ids: [],
        confidence,
        tags: ['auto-generated', 'procedure', ...info.agents],
      });
      created++;
    } catch {
      // ignore failures (likely unique/constraint contention)
    }
    void key;
  }

  return created;
}

/**
 * Detect high-performing decisions (>=90% success over 5+ outcomes) and
 * convert them into policies of the form "Always use X when doing Y".
 */
async function detectPolicies(projectId: string): Promise<number> {
  const db = getDb();

  // Join decisions with an aggregated outcome view.
  const result = await db.query<Record<string, unknown>>(
    `SELECT
       d.id            AS decision_id,
       d.title         AS title,
       d.description   AS description,
       d.domain        AS domain,
       d.tags          AS tags,
       COUNT(o.id)     AS total_outcomes,
       SUM(CASE WHEN o.outcome_type = 'success' THEN 1 ELSE 0 END) AS success_count
     FROM decisions d
     JOIN decision_outcomes o ON o.decision_id = d.id
     WHERE d.project_id = ? AND d.status = 'active'
     GROUP BY d.id, d.title, d.description, d.domain, d.tags
     HAVING COUNT(o.id) >= 5`,
    [projectId],
  );

  let created = 0;
  for (const row of result.rows) {
    const total = Number(row.total_outcomes ?? 0);
    const successes = Number(row.success_count ?? 0);
    if (total < 5) continue;
    const successRate = total > 0 ? successes / total : 0;
    if (successRate < 0.9) continue;

    const decisionId = row.decision_id as string;
    const decisionTitle = row.title as string;
    const domain = (row.domain as string | null) ?? null;
    const tags = parseJsonArray(row.tags);

    const title = `Policy: Always use "${decisionTitle}"${domain ? ` when doing ${domain}` : ''}`;
    if (await insightExists(projectId, 'policy', title)) continue;

    const description =
      `This decision has succeeded ${successes}/${total} times ` +
      `(${Math.round(successRate * 100)}% success rate). ` +
      `It is a strong candidate for a team policy: always prefer this approach ` +
      `${domain ? `in the ${domain} domain` : ''}.`.trim();

    const confidence = Math.min(0.99, successRate);

    try {
      await insertInsight({
        project_id: projectId,
        insight_type: 'policy',
        title,
        description,
        evidence_decision_ids: [decisionId],
        confidence,
        domain,
        tags: ['auto-generated', 'policy', ...tags],
      });
      created++;
    } catch {
      // ignore
    }
  }

  return created;
}

/**
 * Detect low-performing decisions (<30% success over 5+ outcomes) and
 * convert them into anti-patterns of the form "Avoid X when doing Y".
 */
async function detectAntiPatterns(projectId: string): Promise<number> {
  const db = getDb();

  const result = await db.query<Record<string, unknown>>(
    `SELECT
       d.id            AS decision_id,
       d.title         AS title,
       d.description   AS description,
       d.domain        AS domain,
       d.tags          AS tags,
       COUNT(o.id)     AS total_outcomes,
       SUM(CASE WHEN o.outcome_type = 'failure' THEN 1 ELSE 0 END)    AS failure_count,
       SUM(CASE WHEN o.outcome_type = 'regression' THEN 1 ELSE 0 END) AS regression_count,
       SUM(CASE WHEN o.outcome_type = 'success' THEN 1 ELSE 0 END)    AS success_count
     FROM decisions d
     JOIN decision_outcomes o ON o.decision_id = d.id
     WHERE d.project_id = ? AND d.status = 'active'
     GROUP BY d.id, d.title, d.description, d.domain, d.tags
     HAVING COUNT(o.id) >= 5`,
    [projectId],
  );

  let created = 0;
  for (const row of result.rows) {
    const total = Number(row.total_outcomes ?? 0);
    const successes = Number(row.success_count ?? 0);
    const failures = Number(row.failure_count ?? 0);
    const regressions = Number(row.regression_count ?? 0);
    if (total < 5) continue;
    const successRate = total > 0 ? successes / total : 0;
    if (successRate >= 0.3) continue;

    const decisionId = row.decision_id as string;
    const decisionTitle = row.title as string;
    const domain = (row.domain as string | null) ?? null;
    const tags = parseJsonArray(row.tags);

    const title = `Anti-pattern: Avoid "${decisionTitle}"${domain ? ` when doing ${domain}` : ''}`;
    if (await insightExists(projectId, 'anti_pattern', title)) continue;

    const failEvents = failures + regressions;
    const description =
      `This decision has failed or regressed in ${failEvents} of ${total} recorded outcomes ` +
      `(${Math.round((1 - successRate) * 100)}% failure rate). ` +
      `Consider alternatives ${domain ? `when working in the ${domain} domain` : ''}.`.trim();

    // Confidence = how confident we are that this is a problem. High failure
    // rates and more evidence both increase confidence.
    const confidence = Math.min(0.95, (1 - successRate) * Math.min(1, total / 20));

    try {
      await insertInsight({
        project_id: projectId,
        insight_type: 'anti_pattern',
        title,
        description,
        evidence_decision_ids: [decisionId],
        confidence,
        domain,
        tags: ['auto-generated', 'anti-pattern', ...tags],
      });
      created++;
    } catch {
      // ignore
    }
  }

  return created;
}

/**
 * Detect domain rules: when 3+ decisions in the same domain share a common
 * tag, emit a domain rule that captures the shared pattern.
 */
async function detectDomainRules(projectId: string): Promise<number> {
  const db = getDb();

  const result = await db.query<Record<string, unknown>>(
    `SELECT id, title, domain, tags
     FROM decisions
     WHERE project_id = ?
       AND status = 'active'
       AND domain IS NOT NULL
       AND domain != ''`,
    [projectId],
  );

  // Group decisions by (domain, tag) pair and count occurrences.
  const groups = new Map<string, {
    domain: string;
    tag: string;
    decisionIds: string[];
    titles: string[];
  }>();

  for (const row of result.rows) {
    const domain = (row.domain as string) ?? '';
    const decisionId = row.id as string;
    const title = (row.title as string) ?? '';
    const tags = parseJsonArray(row.tags);

    for (const tag of tags) {
      if (!tag || tag.length > 80) continue;
      const key = `${domain}::${tag}`;
      const existing = groups.get(key);
      if (existing) {
        existing.decisionIds.push(decisionId);
        existing.titles.push(title);
      } else {
        groups.set(key, {
          domain,
          tag,
          decisionIds: [decisionId],
          titles: [title],
        });
      }
    }
  }

  let created = 0;
  for (const group of groups.values()) {
    if (group.decisionIds.length < 3) continue;

    const title = `Domain rule: ${group.domain} decisions commonly use "${group.tag}"`;
    if (await insightExists(projectId, 'domain_rule', title)) continue;

    const description =
      `${group.decisionIds.length} active decisions in the "${group.domain}" domain ` +
      `share the "${group.tag}" tag. This is a recurring pattern and should be ` +
      `considered standard practice for ${group.domain} work.`;

    const confidence = Math.min(0.9, 0.4 + group.decisionIds.length * 0.08);

    try {
      await insertInsight({
        project_id: projectId,
        insight_type: 'domain_rule',
        title,
        description,
        evidence_decision_ids: group.decisionIds.slice(0, 20),
        confidence,
        domain: group.domain,
        tags: ['auto-generated', 'domain-rule', group.tag],
      });
      created++;
    } catch {
      // ignore
    }
  }

  return created;
}

/**
 * Analyze Tier 2 decisions to generate Tier 3 insights.
 * Runs all four detectors and returns a summary of how many insights of each
 * type were created. Pure SQL + statistics — no LLM calls.
 */
export async function promoteToInsights(
  projectId: string,
): Promise<PromoteToInsightsResult> {
  const [procedures, policies, antiPatterns, domainRules] = await Promise.all([
    detectProcedures(projectId).catch((err) => {
      console.warn('[hipp0:knowledge-pipeline] procedure detection failed:', (err as Error).message);
      return 0;
    }),
    detectPolicies(projectId).catch((err) => {
      console.warn('[hipp0:knowledge-pipeline] policy detection failed:', (err as Error).message);
      return 0;
    }),
    detectAntiPatterns(projectId).catch((err) => {
      console.warn('[hipp0:knowledge-pipeline] anti-pattern detection failed:', (err as Error).message);
      return 0;
    }),
    detectDomainRules(projectId).catch((err) => {
      console.warn('[hipp0:knowledge-pipeline] domain-rule detection failed:', (err as Error).message);
      return 0;
    }),
  ]);

  return {
    procedures_created: procedures,
    policies_created: policies,
    anti_patterns_created: antiPatterns,
    domain_rules_created: domainRules,
    total_created: procedures + policies + antiPatterns + domainRules,
  };
}

// ─ Query API ─

/**
 * Query the insights table with optional filters.
 */
export async function getInsights(
  projectId: string,
  options: GetInsightsOptions = {},
): Promise<KnowledgeInsight[]> {
  const db = getDb();

  const clauses: string[] = ['project_id = ?'];
  const params: unknown[] = [projectId];

  if (options.type) {
    clauses.push('insight_type = ?');
    params.push(options.type);
  }
  if (options.domain) {
    clauses.push('domain = ?');
    params.push(options.domain);
  }
  if (typeof options.min_confidence === 'number') {
    clauses.push('confidence >= ?');
    params.push(options.min_confidence);
  }
  if (options.status) {
    clauses.push('status = ?');
    params.push(options.status);
  } else {
    // Default: only return active insights
    clauses.push("status = 'active'");
  }

  const limit = Math.max(1, Math.min(500, options.limit ?? 100));

  const sql =
    `SELECT id, project_id, insight_type, title, description,
            evidence_decision_ids, confidence, domain, tags, status,
            created_at, updated_at
     FROM knowledge_insights
     WHERE ${clauses.join(' AND ')}
     ORDER BY confidence DESC, created_at DESC
     LIMIT ${limit}`;

  const result = await db.query<Record<string, unknown>>(sql, params);
  let insights = result.rows.map(parseInsightRow);

  // Tag filter applied in-memory (portable across sqlite/postgres)
  if (options.tags && options.tags.length > 0) {
    const required = new Set(options.tags);
    insights = insights.filter((ins) =>
      ins.tags.some((t) => required.has(t)),
    );
  }

  return insights;
}

/**
 * Update the status of a specific insight (active/superseded/dismissed).
 */
export async function updateInsightStatus(
  projectId: string,
  insightId: string,
  status: InsightStatus,
): Promise<KnowledgeInsight | null> {
  const db = getDb();
  const now = new Date().toISOString();

  await db.query(
    `UPDATE knowledge_insights
     SET status = ?, updated_at = ?
     WHERE id = ? AND project_id = ?`,
    [status, now, insightId, projectId],
  );

  const result = await db.query<Record<string, unknown>>(
    `SELECT id, project_id, insight_type, title, description,
            evidence_decision_ids, confidence, domain, tags, status,
            created_at, updated_at
     FROM knowledge_insights
     WHERE id = ? AND project_id = ?
     LIMIT 1`,
    [insightId, projectId],
  );

  if (result.rows.length === 0) return null;
  return parseInsightRow(result.rows[0]);
}

/**
 * Run both Tier 1 → 2 and Tier 2 → 3 promotions in sequence.
 * Returns a summary of the whole run.
 */
export async function runFullPipeline(projectId: string): Promise<PipelineSummary> {
  const start = Date.now();

  const tier1to2 = await promoteToFacts(projectId).catch((err) => {
    console.warn('[hipp0:knowledge-pipeline] promoteToFacts failed:', (err as Error).message);
    return { captures_processed: 0, facts_extracted: 0, errors: 1 };
  });

  const tier2to3 = await promoteToInsights(projectId).catch((err) => {
    console.warn('[hipp0:knowledge-pipeline] promoteToInsights failed:', (err as Error).message);
    return {
      procedures_created: 0,
      policies_created: 0,
      anti_patterns_created: 0,
      domain_rules_created: 0,
      total_created: 0,
    };
  });

  return {
    tier1_to_tier2: tier1to2,
    tier2_to_tier3: tier2to3,
    duration_ms: Date.now() - start,
  };
}
