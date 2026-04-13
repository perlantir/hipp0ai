/**
 * Broader Stigmergy: Implicit Agent Trace Capture
 *
 * Records lightweight breadcrumbs of agent activity beyond explicit decisions.
 * Distillation analyzes patterns in traces to surface implicit decisions for
 * human review or automatic capture.
 */

import { randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TraceType =
  | 'tool_call'
  | 'api_response'
  | 'error'
  | 'observation'
  | 'artifact_created'
  | 'code_change';

const VALID_TRACE_TYPES: TraceType[] = [
  'tool_call',
  'api_response',
  'error',
  'observation',
  'artifact_created',
  'code_change',
];

export interface TraceInput {
  agent_name: string;
  trace_type: TraceType;
  content: string;
  metadata?: Record<string, unknown>;
  source?: string;
}

export interface TraceRecord {
  id: string;
  project_id: string;
  agent_name: string;
  trace_type: TraceType;
  content: string;
  metadata: Record<string, unknown>;
  source: string;
  created_at: string;
}

export interface GetTracesOptions {
  agent_name?: string;
  trace_type?: TraceType;
  since?: string | Date;
  until?: string | Date;
  limit?: number;
}

export interface DistilledCandidate {
  suggested_title: string;
  suggested_description: string;
  evidence_type: 'repeated_tool' | 'error_correction' | 'recurring_observation';
  evidence_count: number;
  agent_name: string;
  related_trace_ids: string[];
  confidence: 'high' | 'medium' | 'low';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseTrace(row: Record<string, unknown>): TraceRecord {
  let metadata: Record<string, unknown> = {};
  const raw = row.metadata;
  if (typeof raw === 'string') {
    try {
      metadata = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      metadata = {};
    }
  } else if (raw && typeof raw === 'object') {
    metadata = raw as Record<string, unknown>;
  }

  return {
    id: row.id as string,
    project_id: row.project_id as string,
    agent_name: row.agent_name as string,
    trace_type: row.trace_type as TraceType,
    content: row.content as string,
    metadata,
    source: (row.source as string) ?? 'auto',
    created_at: row.created_at as string,
  };
}

function toIsoString(value: string | Date | undefined): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString();
  return value;
}

// ---------------------------------------------------------------------------
// recordTrace
// ---------------------------------------------------------------------------

/**
 * Record a single agent activity trace. Lightweight breadcrumb — not a full
 * decision. Returns the created record.
 */
export async function recordTrace(
  projectId: string,
  trace: TraceInput,
): Promise<TraceRecord> {
  if (!trace.agent_name || trace.agent_name.trim().length === 0) {
    throw new Error('agent_name is required');
  }
  if (!VALID_TRACE_TYPES.includes(trace.trace_type)) {
    throw new Error(
      `trace_type must be one of: ${VALID_TRACE_TYPES.join(', ')}`,
    );
  }
  if (!trace.content || trace.content.length === 0) {
    throw new Error('content is required');
  }

  const db = getDb();
  const id = randomUUID();
  const source = trace.source ?? 'auto';
  const metadataJson = JSON.stringify(trace.metadata ?? {});
  const nowLit = db.dialect === 'sqlite' ? "datetime('now')" : 'NOW()';

  await db.query(
    `INSERT INTO agent_traces
     (id, project_id, agent_name, trace_type, content, metadata, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ${nowLit})`,
    [
      id,
      projectId,
      trace.agent_name,
      trace.trace_type,
      trace.content,
      metadataJson,
      source,
    ],
  );

  const result = await db.query<Record<string, unknown>>(
    `SELECT id, project_id, agent_name, trace_type, content, metadata, source, created_at
     FROM agent_traces
     WHERE id = ?`,
    [id],
  );

  if (result.rows.length === 0) {
    // Unlikely, but fall back to the input
    return {
      id,
      project_id: projectId,
      agent_name: trace.agent_name,
      trace_type: trace.trace_type,
      content: trace.content,
      metadata: trace.metadata ?? {},
      source,
      created_at: new Date().toISOString(),
    };
  }

  return parseTrace(result.rows[0]);
}

// ---------------------------------------------------------------------------
// getRecentTraces
// ---------------------------------------------------------------------------

/**
 * Query traces with optional filters.
 */
export async function getRecentTraces(
  projectId: string,
  options: GetTracesOptions = {},
): Promise<TraceRecord[]> {
  const db = getDb();
  const where: string[] = ['project_id = ?'];
  const params: unknown[] = [projectId];

  if (options.agent_name) {
    where.push('agent_name = ?');
    params.push(options.agent_name);
  }

  if (options.trace_type) {
    if (!VALID_TRACE_TYPES.includes(options.trace_type)) {
      throw new Error(`invalid trace_type: ${options.trace_type}`);
    }
    where.push('trace_type = ?');
    params.push(options.trace_type);
  }

  const since = toIsoString(options.since);
  if (since) {
    where.push('created_at >= ?');
    params.push(since);
  }

  const until = toIsoString(options.until);
  if (until) {
    where.push('created_at <= ?');
    params.push(until);
  }

  const limit = Math.max(1, Math.min(1000, Math.floor(options.limit ?? 100)));
  params.push(limit);

  const result = await db.query<Record<string, unknown>>(
    `SELECT id, project_id, agent_name, trace_type, content, metadata, source, created_at
     FROM agent_traces
     WHERE ${where.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT ?`,
    params,
  );

  return result.rows.map(parseTrace);
}

// ---------------------------------------------------------------------------
// distillTraces
// ---------------------------------------------------------------------------

const MIN_EVIDENCE = 3; // Conservative threshold: require 3+ similar traces

/**
 * Normalize a trace content string for pattern grouping. Strips whitespace,
 * collapses multiples, lowercases, truncates to a reasonable length.
 */
function normalizeForGrouping(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .slice(0, 300);
}

/**
 * Extract a stable tool identifier from tool_call metadata/content.
 */
function extractToolKey(trace: TraceRecord): string {
  const meta = trace.metadata ?? {};
  const toolName =
    (meta.tool as string | undefined) ??
    (meta.tool_name as string | undefined) ??
    (meta.name as string | undefined);
  if (toolName && typeof toolName === 'string') return toolName.toLowerCase();
  // Fallback: first word of content
  const firstWord = trace.content.trim().split(/\s+/)[0] ?? '';
  return firstWord.toLowerCase();
}

/**
 * Analyze recent traces for implicit decisions. Conservative — only suggests
 * candidates with 3+ supporting traces.
 *
 * Patterns detected:
 *   1. Repeated tool_call by same agent → "implicit decision to use tool X"
 *   2. Error → code_change sequences → "avoid X" decision
 *   3. Recurring observations → "recognize pattern X" decision
 */
export async function distillTraces(
  projectId: string,
  since?: string | Date,
): Promise<DistilledCandidate[]> {
  // Default lookback: 7 days if not provided
  const defaultSince = new Date();
  defaultSince.setDate(defaultSince.getDate() - 7);
  const sinceIso = toIsoString(since) ?? defaultSince.toISOString();

  const traces = await getRecentTraces(projectId, {
    since: sinceIso,
    limit: 1000,
  });

  if (traces.length === 0) return [];

  const candidates: DistilledCandidate[] = [];

  // ---- Pattern 1: Repeated tool_call by same agent ----
  const toolGroups = new Map<
    string,
    { agent: string; tool: string; traces: TraceRecord[] }
  >();
  for (const trace of traces) {
    if (trace.trace_type !== 'tool_call') continue;
    const toolKey = extractToolKey(trace);
    if (!toolKey) continue;
    const groupKey = `${trace.agent_name}::${toolKey}`;
    let group = toolGroups.get(groupKey);
    if (!group) {
      group = { agent: trace.agent_name, tool: toolKey, traces: [] };
      toolGroups.set(groupKey, group);
    }
    group.traces.push(trace);
  }

  for (const group of toolGroups.values()) {
    if (group.traces.length < MIN_EVIDENCE) continue;
    candidates.push({
      suggested_title: `Use ${group.tool} for recurring tasks`,
      suggested_description: `Agent "${group.agent}" invoked "${group.tool}" ${group.traces.length} times in the lookback window, suggesting an implicit preference for this tool.`,
      evidence_type: 'repeated_tool',
      evidence_count: group.traces.length,
      agent_name: group.agent,
      related_trace_ids: group.traces.slice(0, 10).map((t) => t.id),
      confidence: group.traces.length >= 6 ? 'high' : 'medium',
    });
  }

  // ---- Pattern 2: Error traces followed closely by code_change ----
  // Group errors by agent + normalized content
  const errorGroups = new Map<
    string,
    { agent: string; signature: string; traces: TraceRecord[]; followedByChange: number }
  >();
  // Traces are DESC; iterate chronologically by reversing
  const chrono = [...traces].reverse();
  for (let i = 0; i < chrono.length; i++) {
    const trace = chrono[i]!;
    if (trace.trace_type !== 'error') continue;
    const signature = normalizeForGrouping(trace.content).slice(0, 80);
    const groupKey = `${trace.agent_name}::${signature}`;
    let group = errorGroups.get(groupKey);
    if (!group) {
      group = {
        agent: trace.agent_name,
        signature,
        traces: [],
        followedByChange: 0,
      };
      errorGroups.set(groupKey, group);
    }
    group.traces.push(trace);

    // Look ahead up to 5 traces by same agent for a code_change / artifact_created
    let followedUp = false;
    for (let j = i + 1; j < Math.min(i + 20, chrono.length) && !followedUp; j++) {
      const next = chrono[j]!;
      if (next.agent_name !== trace.agent_name) continue;
      if (
        next.trace_type === 'code_change' ||
        next.trace_type === 'artifact_created'
      ) {
        followedUp = true;
      }
    }
    if (followedUp) group.followedByChange++;
  }

  for (const group of errorGroups.values()) {
    if (
      group.traces.length < MIN_EVIDENCE ||
      group.followedByChange < MIN_EVIDENCE
    )
      continue;
    candidates.push({
      suggested_title: `Avoid pattern that causes "${group.signature.slice(0, 60)}"`,
      suggested_description: `Agent "${group.agent}" hit this error ${group.traces.length} times, correcting with a code change ${group.followedByChange} times. Consider capturing as an explicit "avoid X" decision.`,
      evidence_type: 'error_correction',
      evidence_count: group.traces.length,
      agent_name: group.agent,
      related_trace_ids: group.traces.slice(0, 10).map((t) => t.id),
      confidence: group.followedByChange >= 5 ? 'high' : 'medium',
    });
  }

  // ---- Pattern 3: Recurring observations ----
  const obsGroups = new Map<
    string,
    { agent: string; signature: string; traces: TraceRecord[] }
  >();
  for (const trace of traces) {
    if (trace.trace_type !== 'observation') continue;
    const signature = normalizeForGrouping(trace.content).slice(0, 80);
    const groupKey = `${trace.agent_name}::${signature}`;
    let group = obsGroups.get(groupKey);
    if (!group) {
      group = { agent: trace.agent_name, signature, traces: [] };
      obsGroups.set(groupKey, group);
    }
    group.traces.push(trace);
  }

  for (const group of obsGroups.values()) {
    if (group.traces.length < MIN_EVIDENCE) continue;
    candidates.push({
      suggested_title: `Recurring observation: "${group.signature.slice(0, 60)}"`,
      suggested_description: `Agent "${group.agent}" recorded this observation ${group.traces.length} times. May indicate a stable pattern worth capturing.`,
      evidence_type: 'recurring_observation',
      evidence_count: group.traces.length,
      agent_name: group.agent,
      related_trace_ids: group.traces.slice(0, 10).map((t) => t.id),
      confidence: group.traces.length >= 5 ? 'high' : 'low',
    });
  }

  // Sort by evidence count desc
  candidates.sort((a, b) => b.evidence_count - a.evidence_count);

  return candidates;
}
