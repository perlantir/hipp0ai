/**
 * Team Procedure Extraction
 *
 * Mines `compile_history` (and optional `compile_outcomes`) for repeated
 * agent sequences that tend to get applied to similar tasks, and persists
 * them as reusable "team procedures".
 *
 * Pure SQL + deterministic post-processing — no LLM calls.
 *
 * Core operations:
 *   - extractTeamProcedures(projectId)    — mine repeated sequences and upsert
 *   - getMatchingProcedure(projectId, …)  — suggest the best procedure for a new task
 *   - recordProcedureExecution(…)         — track actual execution outcomes
 */

import { randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface TeamProcedure {
  id: string;
  project_id: string;
  name: string;
  description: string;
  agent_sequence: string[];
  trigger_tags: string[];
  trigger_domain: string | null;
  evidence_count: number;
  success_count: number;
  total_executions: number;
  success_rate: number;
  auto_extracted: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProcedureMatch extends TeamProcedure {
  match_score: number;
  similar_tasks: string[];
}

export type ProcedureOutcome = 'success' | 'failure' | 'partial';

/* ------------------------------------------------------------------ */
/*  Domain inference — shared with skill-profiler style keyword map    */
/* ------------------------------------------------------------------ */

const DOMAIN_KEYWORDS: Record<string, string[]> = {
  authentication: ['auth', 'login', 'session', 'oauth', 'jwt', 'token', 'password', 'signin', 'signup'],
  infrastructure: ['deploy', 'docker', 'k8s', 'kubernetes', 'ci', 'cd', 'pipeline', 'infra', 'terraform'],
  frontend: ['ui', 'css', 'react', 'component', 'layout', 'ux', 'tailwind', 'html'],
  database: ['db', 'sql', 'migration', 'schema', 'query', 'postgres', 'sqlite', 'table', 'index'],
  testing: ['test', 'spec', 'coverage', 'e2e', 'unit', 'integration', 'fixture', 'mock'],
  security: ['security', 'vulnerability', 'encrypt', 'permission', 'rbac', 'cors', 'csrf', 'xss'],
  api: ['api', 'endpoint', 'route', 'rest', 'graphql', 'webhook'],
  deployment: ['deploy', 'release', 'staging', 'production', 'rollback'],
  billing: ['billing', 'stripe', 'invoice', 'payment', 'subscription', 'checkout'],
  analytics: ['analytics', 'metric', 'dashboard', 'report', 'chart', 'graph'],
  notification: ['notify', 'notification', 'email', 'push', 'alert'],
};

const STOPWORDS = new Set([
  'the', 'a', 'an', 'to', 'for', 'of', 'and', 'or', 'in', 'on', 'with', 'by',
  'is', 'are', 'be', 'this', 'that', 'it', 'as', 'at', 'from', 'into', 'up',
  'do', 'does', 'did', 'please', 'add', 'create', 'make', 'build', 'fix',
  'update', 'new', 'some', 'any', 'all', 'we', 'our',
]);

function inferDomain(text: string): string | null {
  const lower = text.toLowerCase();
  let best: { domain: string; hits: number } | null = null;
  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    let hits = 0;
    for (const kw of keywords) {
      if (lower.includes(kw)) hits++;
    }
    if (hits > 0 && (!best || hits > best.hits)) {
      best = { domain, hits };
    }
  }
  return best?.domain ?? null;
}

function extractKeywordTags(text: string): string[] {
  const lower = text.toLowerCase();
  const tags = new Set<string>();

  // Known-domain keyword hits
  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        tags.add(domain);
        tags.add(kw);
      }
    }
  }

  // Simple word-level extraction (alnum, min length 4)
  const words = lower.match(/[a-z][a-z0-9_-]{3,}/g) ?? [];
  for (const w of words) {
    if (STOPWORDS.has(w)) continue;
    tags.add(w);
  }

  return Array.from(tags).slice(0, 20);
}

function tagOverlapScore(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a.map((t) => t.toLowerCase()));
  const setB = new Set(b.map((t) => t.toLowerCase()));
  let intersection = 0;
  for (const t of setA) if (setB.has(t)) intersection++;
  const union = setA.size + setB.size - intersection;
  if (union === 0) return 0;
  return intersection / union;
}

/* ------------------------------------------------------------------ */
/*  Dialect helpers                                                    */
/* ------------------------------------------------------------------ */

function parseArray(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter((x) => typeof x === 'string');
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed || trimmed === '{}' || trimmed === '[]') return [];
    // Postgres text[] text form: {a,b,c}
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      const inner = trimmed.slice(1, -1);
      if (!inner) return [];
      return inner.split(',').map((s) => s.replace(/^"|"$/g, '').trim()).filter(Boolean);
    }
    // JSON array
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.filter((x) => typeof x === 'string');
    } catch {
      // fall through
    }
  }
  return [];
}

function rowToProcedure(row: Record<string, unknown>): TeamProcedure {
  const successCount = Number(row.success_count ?? 0);
  const totalExecutions = Number(row.total_executions ?? 0);
  const evidenceCount = Number(row.evidence_count ?? 0);
  const effectiveTotal = totalExecutions > 0 ? totalExecutions : evidenceCount;
  const effectiveSuccess = totalExecutions > 0 ? successCount : successCount;
  const successRate = effectiveTotal > 0 ? effectiveSuccess / effectiveTotal : 0;

  return {
    id: String(row.id),
    project_id: String(row.project_id),
    name: String(row.name ?? ''),
    description: String(row.description ?? ''),
    agent_sequence: parseArray(row.agent_sequence),
    trigger_tags: parseArray(row.trigger_tags),
    trigger_domain: (row.trigger_domain as string | null) ?? null,
    evidence_count: evidenceCount,
    success_count: successCount,
    total_executions: totalExecutions,
    success_rate: successRate,
    auto_extracted: Boolean(row.auto_extracted),
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
  };
}

/* ------------------------------------------------------------------ */
/*  Grouping compile_history into sequences                            */
/* ------------------------------------------------------------------ */

interface CompileRow {
  id: string;
  agent_name: string;
  task_description: string;
  compiled_at: string;
  task_completed: boolean | null;
  alignment_score: number | null;
}

interface TaskGroup {
  domain: string;
  tasks: CompileRow[];
  sampleTasks: string[];
}

/**
 * Greedily form "sequence runs" inside a domain group. A run is a sequence of
 * compiles that share a similar task and are close in time. We use a simple
 * rolling window: when the domain continues but the gap from the previous
 * compile is small (< 6h) OR the task_description is highly similar, we
 * extend the current run; otherwise we start a new one.
 */
function buildSequenceRuns(group: TaskGroup): Array<{
  sequence: string[];
  compileIds: string[];
  taskSample: string;
  successes: number;
  total: number;
}> {
  const runs: Array<{
    sequence: string[];
    compileIds: string[];
    taskSample: string;
    successes: number;
    total: number;
  }> = [];

  let current: {
    sequence: string[];
    compileIds: string[];
    taskSample: string;
    successes: number;
    total: number;
    lastTs: number;
    lastTags: string[];
  } | null = null;

  const GAP_MS = 6 * 60 * 60 * 1000; // 6 hours

  for (const row of group.tasks) {
    const ts = Date.parse(row.compiled_at);
    const tags = extractKeywordTags(row.task_description);

    const gap = current ? ts - current.lastTs : Infinity;
    const overlap = current ? tagOverlapScore(tags, current.lastTags) : 0;

    const continueRun = current && (gap <= GAP_MS || overlap >= 0.4);

    if (!continueRun) {
      if (current && current.sequence.length >= 2) {
        runs.push({
          sequence: current.sequence,
          compileIds: current.compileIds,
          taskSample: current.taskSample,
          successes: current.successes,
          total: current.total,
        });
      }
      current = {
        sequence: [row.agent_name],
        compileIds: [row.id],
        taskSample: row.task_description,
        successes: 0,
        total: 0,
        lastTs: ts,
        lastTags: tags,
      };
    } else if (current) {
      // Avoid immediate duplicate of same agent (same agent re-compiling for itself)
      if (current.sequence[current.sequence.length - 1] !== row.agent_name) {
        current.sequence.push(row.agent_name);
      }
      current.compileIds.push(row.id);
      current.lastTs = ts;
      current.lastTags = tags;
    }

    if (current) {
      if (row.task_completed !== null) {
        current.total += 1;
        if (row.task_completed) current.successes += 1;
      } else if (row.alignment_score !== null) {
        current.total += 1;
        if (row.alignment_score >= 0.6) current.successes += 1;
      }
    }
  }

  if (current && current.sequence.length >= 2) {
    runs.push({
      sequence: current.sequence,
      compileIds: current.compileIds,
      taskSample: current.taskSample,
      successes: current.successes,
      total: current.total,
    });
  }

  return runs;
}

/* ------------------------------------------------------------------ */
/*  extractTeamProcedures                                              */
/* ------------------------------------------------------------------ */

export async function extractTeamProcedures(
  projectId: string,
): Promise<TeamProcedure[]> {
  const db = getDb();

  // Pull recent compile history joined with outcomes. Use LEFT JOIN so
  // compiles without outcomes are still included. Limit to last 2000 rows
  // for reasonable extraction cost.
  const result = await db.query<Record<string, unknown>>(
    `SELECT ch.id, ch.agent_name, ch.task_description, ch.compiled_at,
            co.task_completed, co.alignment_score
     FROM compile_history ch
     LEFT JOIN compile_outcomes co ON co.compile_history_id = ch.id
     WHERE ch.project_id = ?
     ORDER BY ch.compiled_at ASC
     LIMIT 2000`,
    [projectId],
  );

  const compiles: CompileRow[] = result.rows.map((row) => {
    const r = row as Record<string, unknown>;
    let completed: boolean | null = null;
    const rawCompleted = r.task_completed;
    if (rawCompleted === true || rawCompleted === 1 || rawCompleted === '1' || rawCompleted === 't') {
      completed = true;
    } else if (rawCompleted === false || rawCompleted === 0 || rawCompleted === '0' || rawCompleted === 'f') {
      completed = false;
    }
    const rawAlignment = r.alignment_score;
    const alignment = rawAlignment === null || rawAlignment === undefined
      ? null
      : Number(rawAlignment);
    return {
      id: String(r.id),
      agent_name: String(r.agent_name ?? ''),
      task_description: String(r.task_description ?? ''),
      compiled_at: String(r.compiled_at ?? ''),
      task_completed: completed,
      alignment_score: alignment,
    };
  }).filter((c) => c.agent_name.length > 0);

  if (compiles.length === 0) return [];

  // Group by inferred domain
  const groups = new Map<string, TaskGroup>();
  for (const c of compiles) {
    const domain = inferDomain(c.task_description) ?? 'general';
    let g = groups.get(domain);
    if (!g) {
      g = { domain, tasks: [], sampleTasks: [] };
      groups.set(domain, g);
    }
    g.tasks.push(c);
    if (g.sampleTasks.length < 10 && !g.sampleTasks.includes(c.task_description)) {
      g.sampleTasks.push(c.task_description);
    }
  }

  // For each domain, build runs and tally repeated sequences
  interface SequenceBucket {
    domain: string;
    sequence: string[];
    count: number;
    successes: number;
    outcomeTotal: number;
    sampleTasks: Set<string>;
    tagHistogram: Map<string, number>;
  }

  const buckets = new Map<string, SequenceBucket>();

  for (const group of groups.values()) {
    const runs = buildSequenceRuns(group);
    for (const run of runs) {
      if (run.sequence.length < 2) continue;
      const key = `${group.domain}::${run.sequence.join('>')}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = {
          domain: group.domain,
          sequence: run.sequence,
          count: 0,
          successes: 0,
          outcomeTotal: 0,
          sampleTasks: new Set<string>(),
          tagHistogram: new Map<string, number>(),
        };
        buckets.set(key, bucket);
      }
      bucket.count += 1;
      bucket.successes += run.successes;
      bucket.outcomeTotal += run.total;
      if (bucket.sampleTasks.size < 5) {
        bucket.sampleTasks.add(run.taskSample);
      }
      for (const t of extractKeywordTags(run.taskSample)) {
        bucket.tagHistogram.set(t, (bucket.tagHistogram.get(t) ?? 0) + 1);
      }
    }
  }

  // Qualifying buckets — seen 3+ times
  const qualifying = Array.from(buckets.values())
    .filter((b) => b.count >= 3)
    .sort((a, b) => b.count - a.count);

  const persisted: TeamProcedure[] = [];

  for (const bucket of qualifying) {
    const topTags = Array.from(bucket.tagHistogram.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([t]) => t);

    const name = `${bucket.domain} procedure: ${bucket.sequence.join(' -> ')}`;
    const successRatePct = bucket.outcomeTotal > 0
      ? Math.round((bucket.successes / bucket.outcomeTotal) * 100)
      : 0;

    const description = bucket.outcomeTotal > 0
      ? `For ${bucket.domain} tasks: ${bucket.sequence.join(' -> ')} (seen ${bucket.count} times, avg success ${successRatePct}%)`
      : `For ${bucket.domain} tasks: ${bucket.sequence.join(' -> ')} (seen ${bucket.count} times)`;

    // Upsert by name+project+sequence — look up existing first
    const existing = await db.query<Record<string, unknown>>(
      `SELECT id, total_executions, success_count FROM team_procedures
       WHERE project_id = ? AND name = ?
       LIMIT 1`,
      [projectId, name],
    );

    if (existing.rows.length > 0) {
      const row = existing.rows[0] as Record<string, unknown>;
      const id = String(row.id);
      await db.query(
        `UPDATE team_procedures
         SET description = ?,
             agent_sequence = ?,
             trigger_tags = ?,
             trigger_domain = ?,
             evidence_count = ?,
             success_count = ?,
             updated_at = ${db.dialect === 'sqlite' ? "datetime('now')" : 'NOW()'}
         WHERE id = ?`,
        [
          description,
          db.arrayParam(bucket.sequence),
          db.arrayParam(topTags),
          bucket.domain,
          bucket.count,
          bucket.successes,
          id,
        ],
      );
      const refreshed = await db.query<Record<string, unknown>>(
        'SELECT * FROM team_procedures WHERE id = ?',
        [id],
      );
      if (refreshed.rows.length > 0) {
        persisted.push(rowToProcedure(refreshed.rows[0] as Record<string, unknown>));
      }
    } else {
      const id = randomUUID();
      await db.query(
        `INSERT INTO team_procedures
           (id, project_id, name, description, agent_sequence,
            trigger_tags, trigger_domain, evidence_count, success_count,
            total_executions, auto_extracted)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          projectId,
          name,
          description,
          db.arrayParam(bucket.sequence),
          db.arrayParam(topTags),
          bucket.domain,
          bucket.count,
          bucket.successes,
          0,
          db.dialect === 'sqlite' ? 1 : true,
        ],
      );
      const inserted = await db.query<Record<string, unknown>>(
        'SELECT * FROM team_procedures WHERE id = ?',
        [id],
      );
      if (inserted.rows.length > 0) {
        persisted.push(rowToProcedure(inserted.rows[0] as Record<string, unknown>));
      }
    }
  }

  return persisted;
}

/* ------------------------------------------------------------------ */
/*  listTeamProcedures                                                 */
/* ------------------------------------------------------------------ */

export async function listTeamProcedures(
  projectId: string,
): Promise<TeamProcedure[]> {
  const db = getDb();
  const result = await db.query<Record<string, unknown>>(
    `SELECT * FROM team_procedures
     WHERE project_id = ?
     ORDER BY evidence_count DESC, updated_at DESC`,
    [projectId],
  );
  return result.rows.map((row) => rowToProcedure(row as Record<string, unknown>));
}

/* ------------------------------------------------------------------ */
/*  getMatchingProcedure                                               */
/* ------------------------------------------------------------------ */

export async function getMatchingProcedure(
  projectId: string,
  task: string,
  tags: string[] = [],
): Promise<ProcedureMatch | null> {
  const db = getDb();

  // Domain inference from task
  const domain = inferDomain(task);
  const taskTags = extractKeywordTags(task);
  const combinedTags = Array.from(new Set([...taskTags, ...tags.map((t) => t.toLowerCase())]));

  const result = await db.query<Record<string, unknown>>(
    `SELECT * FROM team_procedures WHERE project_id = ?`,
    [projectId],
  );

  if (result.rows.length === 0) return null;

  let best: { procedure: TeamProcedure; score: number } | null = null;

  for (const row of result.rows) {
    const proc = rowToProcedure(row as Record<string, unknown>);

    // Domain bonus
    const domainMatch = domain && proc.trigger_domain === domain ? 0.4 : 0;

    // Tag overlap (jaccard)
    const tagScore = tagOverlapScore(combinedTags, proc.trigger_tags) * 0.4;

    // Evidence count confidence boost
    const evidenceBoost = Math.min(0.1, proc.evidence_count / 100);

    // Success rate weight
    const successWeight = proc.success_rate > 0 ? proc.success_rate * 0.1 : 0.05;

    const score = domainMatch + tagScore + evidenceBoost + successWeight;

    if (!best || score > best.score) {
      best = { procedure: proc, score };
    }
  }

  if (!best || best.score <= 0) return null;

  // Pull a few similar tasks from compile_history in the same domain to
  // illustrate why the procedure matches.
  let similarTasks: string[] = [];
  if (best.procedure.trigger_domain) {
    try {
      const samples = await db.query<Record<string, unknown>>(
        `SELECT DISTINCT task_description FROM compile_history
         WHERE project_id = ?
         ORDER BY compiled_at DESC
         LIMIT 200`,
        [projectId],
      );
      const domainName = best.procedure.trigger_domain;
      const keywords = DOMAIN_KEYWORDS[domainName] ?? [];
      similarTasks = samples.rows
        .map((r) => String((r as Record<string, unknown>).task_description ?? ''))
        .filter((t) => {
          const lower = t.toLowerCase();
          return keywords.some((kw) => lower.includes(kw));
        })
        .slice(0, 5);
    } catch {
      // ignore
    }
  }

  return {
    ...best.procedure,
    match_score: Math.round(best.score * 1000) / 1000,
    similar_tasks: similarTasks,
  };
}

/* ------------------------------------------------------------------ */
/*  recordProcedureExecution                                           */
/* ------------------------------------------------------------------ */

export async function recordProcedureExecution(
  projectId: string,
  procedureId: string,
  outcome: ProcedureOutcome,
): Promise<TeamProcedure | null> {
  const db = getDb();

  const existing = await db.query<Record<string, unknown>>(
    `SELECT * FROM team_procedures WHERE id = ? AND project_id = ?`,
    [procedureId, projectId],
  );
  if (existing.rows.length === 0) return null;

  const row = existing.rows[0] as Record<string, unknown>;
  const totalExecutions = Number(row.total_executions ?? 0) + 1;
  let successCount = Number(row.success_count ?? 0);
  if (outcome === 'success') successCount += 1;
  if (outcome === 'partial') successCount += 0; // partials do not count as success

  await db.query(
    `UPDATE team_procedures
     SET total_executions = ?,
         success_count = ?,
         updated_at = ${db.dialect === 'sqlite' ? "datetime('now')" : 'NOW()'}
     WHERE id = ?`,
    [totalExecutions, successCount, procedureId],
  );

  const refreshed = await db.query<Record<string, unknown>>(
    'SELECT * FROM team_procedures WHERE id = ?',
    [procedureId],
  );
  if (refreshed.rows.length === 0) return null;
  return rowToProcedure(refreshed.rows[0] as Record<string, unknown>);
}
