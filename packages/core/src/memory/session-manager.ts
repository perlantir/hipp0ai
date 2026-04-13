/**
 * Session Manager — multi-step task sessions where Agent B sees Agent A's actual output.
 * A session layer on top of the existing compile endpoint.
 */

import { getDb } from '../db/index.js';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface TaskSession {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: string;
  agents_involved: string[];
  current_step: number;
  state_summary: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface SessionStep {
  id: string;
  session_id: string;
  project_id: string;
  step_number: number;
  agent_name: string;
  agent_role: string | null;
  task_description: string;
  output: string | null;
  output_summary: string | null;
  artifacts: unknown[];
  decisions_compiled: number;
  decisions_created: string[];
  duration_ms: number | null;
  compile_time_ms: number | null;
  status: string;
  created_at: string;
  wing: string | null;
}

export interface SessionContext {
  session: TaskSession;
  previous_steps: SessionStep[];
  formatted_session_context: string;
}

/* ------------------------------------------------------------------ */
/*  In-memory session cache                                            */
/* ------------------------------------------------------------------ */

interface CacheEntry {
  data: SessionContext;
  expires: number;
}

const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const CACHE_MAX = 1000;

const sessionCache = new Map<string, CacheEntry>();

function cacheKey(sessionId: string, agentName: string): string {
  return `${sessionId}:${agentName}`;
}

function getCached(sessionId: string, agentName: string): SessionContext | null {
  const key = cacheKey(sessionId, agentName);
  const entry = sessionCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    sessionCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(sessionId: string, agentName: string, data: SessionContext): void {
  // Evict oldest if over limit
  if (sessionCache.size >= CACHE_MAX) {
    const firstKey = sessionCache.keys().next().value as string;
    sessionCache.delete(firstKey);
  }
  sessionCache.set(cacheKey(sessionId, agentName), {
    data,
    expires: Date.now() + CACHE_TTL_MS,
  });
}

function invalidateSession(sessionId: string): void {
  for (const key of sessionCache.keys()) {
    if (key.startsWith(`${sessionId}:`)) {
      sessionCache.delete(key);
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Row parsers                                                        */
/* ------------------------------------------------------------------ */

function parseArray(val: unknown): string[] {
  if (Array.isArray(val)) return val as string[];
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      // PostgreSQL array literal {a,b,c}
      if (val.startsWith('{') && val.endsWith('}')) {
        return val.slice(1, -1).split(',').filter(Boolean);
      }
      return [];
    }
  }
  return [];
}

function parseSession(row: Record<string, unknown>): TaskSession {
  return {
    id: row.id as string,
    project_id: row.project_id as string,
    title: row.title as string,
    description: (row.description as string) ?? null,
    status: row.status as string,
    agents_involved: parseArray(row.agents_involved),
    current_step: Number(row.current_step ?? 0),
    state_summary: (row.state_summary as string) ?? null,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
    completed_at: row.completed_at ? (row.completed_at instanceof Date ? row.completed_at.toISOString() : String(row.completed_at)) : null,
  };
}

function parseStep(row: Record<string, unknown>): SessionStep {
  let artifacts: unknown[] = [];
  if (typeof row.artifacts === 'string') {
    try { artifacts = JSON.parse(row.artifacts); } catch { artifacts = []; }
  } else if (Array.isArray(row.artifacts)) {
    artifacts = row.artifacts;
  }

  return {
    id: row.id as string,
    session_id: row.session_id as string,
    project_id: row.project_id as string,
    step_number: Number(row.step_number),
    agent_name: row.agent_name as string,
    agent_role: (row.agent_role as string) ?? null,
    task_description: row.task_description as string,
    output: (row.output as string) ?? null,
    output_summary: (row.output_summary as string) ?? null,
    artifacts,
    decisions_compiled: Number(row.decisions_compiled ?? 0),
    decisions_created: parseArray(row.decisions_created),
    duration_ms: row.duration_ms != null ? Number(row.duration_ms) : null,
    compile_time_ms: row.compile_time_ms != null ? Number(row.compile_time_ms) : null,
    status: row.status as string,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    wing: (row.wing as string | null) ?? null,
  };
}

/* ------------------------------------------------------------------ */
/*  LLM summary helper                                                 */
/* ------------------------------------------------------------------ */

async function generateSummary(text: string): Promise<string> {
  if (text.length <= 500) return text;
  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? '' });
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      messages: [
        {
          role: 'user',
          content: `Summarize this agent output in 2-3 sentences, focusing on key decisions made and artifacts produced:\n\n${text.slice(0, 4000)}`,
        },
      ],
    });
    const block = response.content[0];
    if (block.type === 'text') return block.text;
    return text.slice(0, 500);
  } catch {
    return text.slice(0, 500) + '...';
  }
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

export async function startSession(input: {
  project_id: string;
  title: string;
  description?: string;
}): Promise<{ session_id: string; title: string }> {
  const db = getDb();
  const result = await db.query<Record<string, unknown>>(
    `INSERT INTO task_sessions (project_id, title, description)
     VALUES (?, ?, ?)
     RETURNING id, title`,
    [input.project_id, input.title, input.description ?? null],
  );
  const row = result.rows[0];
  return { session_id: row.id as string, title: row.title as string };
}

export async function recordStep(input: {
  session_id: string;
  project_id: string;
  agent_name: string;
  agent_role?: string;
  task_description: string;
  output: string;
  artifacts?: unknown[];
  duration_ms?: number;
  decisions_created?: string[];
}): Promise<{ step_id: string; step_number: number; next_suggestion?: Record<string, unknown> }> {
  const db = getDb();

  // Get next step number
  const maxResult = await db.query<Record<string, unknown>>(
    'SELECT COALESCE(MAX(step_number), 0) AS max_step FROM session_steps WHERE session_id = ?',
    [input.session_id],
  );
  const stepNumber = Number((maxResult.rows[0] as Record<string, unknown>).max_step) + 1;

  // Generate summary if output is long
  const outputSummary = await generateSummary(input.output);

  // Insert the step (wing = agent_name, the agent's dedicated context space)
  const stepResult = await db.query<Record<string, unknown>>(
    `INSERT INTO session_steps
       (session_id, project_id, step_number, agent_name, agent_role,
        task_description, output, output_summary, artifacts,
        decisions_created, duration_ms, wing)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING id, step_number`,
    [
      input.session_id,
      input.project_id,
      stepNumber,
      input.agent_name,
      input.agent_role ?? null,
      input.task_description,
      input.output,
      outputSummary,
      JSON.stringify(input.artifacts ?? []),
      db.arrayParam(input.decisions_created ?? []),
      input.duration_ms ?? null,
      input.agent_name, // wing = agent who created the step
    ],
  );

  const step = stepResult.rows[0];

  // Update session: current_step, state_summary
  const stateSummary = `Step ${stepNumber}: ${input.agent_name} — ${outputSummary.slice(0, 200)}`;
  await db.query(
    `UPDATE task_sessions SET current_step = ?, state_summary = ?, updated_at = ${db.dialect === 'sqlite' ? "datetime('now')" : 'NOW()'} WHERE id = ?`,
    [stepNumber, stateSummary, input.session_id],
  );

  // Update agents_involved (read-modify-write in app code)
  const sessionResult = await db.query<Record<string, unknown>>(
    'SELECT agents_involved FROM task_sessions WHERE id = ?',
    [input.session_id],
  );
  if (sessionResult.rows.length > 0) {
    const current = parseArray((sessionResult.rows[0] as Record<string, unknown>).agents_involved);
    if (!current.includes(input.agent_name)) {
      current.push(input.agent_name);
      await db.query(
        'UPDATE task_sessions SET agents_involved = ? WHERE id = ?',
        [db.arrayParam(current), input.session_id],
      );
    }
  }

  // Invalidate cache so next compile gets fresh data
  invalidateSession(input.session_id);

  // Suggest next agent (non-fatal — never breaks step recording)
  let nextSuggestion: Record<string, unknown> | null = null;
  try {
    const { suggestNextAgent } = await import('../intelligence/orchestrator.js');
    const suggestion = await suggestNextAgent(input.session_id, input.project_id);
    nextSuggestion = suggestion as unknown as Record<string, unknown>;

    // Store suggestion in state_summary as JSON
    const summaryWithSuggestion = JSON.stringify({
      step: stepNumber,
      agent: input.agent_name,
      summary: outputSummary.slice(0, 200),
      next_suggestion: {
        agent: suggestion.recommended_agent,
        role: suggestion.recommended_role,
        confidence: suggestion.confidence,
        is_complete: suggestion.is_session_complete,
      },
    });
    await db.query(
      'UPDATE task_sessions SET state_summary = ? WHERE id = ?',
      [summaryWithSuggestion, input.session_id],
    );
  } catch {
    // Non-fatal — orchestrator suggestion is optional
  }

  return {
    step_id: step.id as string,
    step_number: Number(step.step_number),
    ...(nextSuggestion ? { next_suggestion: nextSuggestion } : {}),
  };
}

export async function getSessionContext(
  sessionId: string,
  agentName: string,
  taskDescription: string,
  projectId: string,
): Promise<SessionContext> {
  // Check cache first
  const cached = getCached(sessionId, agentName);
  if (cached) return cached;

  const db = getDb();

  // Get session
  const sessionResult = await db.query<Record<string, unknown>>(
    'SELECT * FROM task_sessions WHERE id = ?',
    [sessionId],
  );
  if (sessionResult.rows.length === 0) {
    throw new Error(`Session ${sessionId} not found`);
  }
  const session = parseSession(sessionResult.rows[0] as Record<string, unknown>);

  // Get completed steps ordered by step_number
  const stepsResult = await db.query<Record<string, unknown>>(
    `SELECT * FROM session_steps
     WHERE session_id = ? AND status = 'completed'
     ORDER BY step_number ASC`,
    [sessionId],
  );
  const allSteps = stepsResult.rows.map((r) => parseStep(r as Record<string, unknown>));

  // Wing-aware step prioritization:
  // Lookup requesting agent's wing affinity to determine priority
  const agentResult = await db.query<Record<string, unknown>>(
    `SELECT wing_affinity, role FROM agents WHERE project_id = ? AND name = ? LIMIT 1`,
    [session.project_id, agentName],
  );
  const isOrchestrator = agentResult.rows.length > 0 && (agentResult.rows[0].role as string || '').toLowerCase() === 'orchestrator';

  let steps: SessionStep[];
  if (isOrchestrator) {
    // Orchestrator sees all steps equally
    steps = allSteps;
  } else {
    let wingAffinityData: Record<string, number> = {};
    if (agentResult.rows.length > 0) {
      const rawAffinity = agentResult.rows[0].wing_affinity;
      if (rawAffinity) {
        let parsed: Record<string, unknown> = {};
        if (typeof rawAffinity === 'string') {
          try { parsed = JSON.parse(rawAffinity); } catch { /* skip */ }
        } else if (typeof rawAffinity === 'object') {
          parsed = rawAffinity as Record<string, unknown>;
        }
        wingAffinityData = ((parsed as Record<string, unknown>).cross_wing_weights ?? {}) as Record<string, number>;
      }
    }

    // Categorize steps: own-wing (full detail), high-affinity (full), low-affinity (condensed)
    const ownWingSteps: SessionStep[] = [];
    const highAffinitySteps: SessionStep[] = [];
    const lowAffinitySteps: SessionStep[] = [];
    for (const step of allSteps) {
      const stepWing = step.wing ?? step.agent_name;
      if (stepWing === agentName) {
        ownWingSteps.push(step);
      } else if ((wingAffinityData[stepWing] ?? 0.5) >= 0.5) {
        highAffinitySteps.push(step);
      } else {
        lowAffinitySteps.push(step);
      }
    }
    // Prioritized order: own-wing first, then high-affinity, then low-affinity
    steps = [...ownWingSteps, ...highAffinitySteps, ...lowAffinitySteps];
  }

  // Format as markdown
  const lines: string[] = [
    `## Task Session: ${session.title}`,
    '',
    `**Status:** ${session.status} | **Steps completed:** ${steps.length}`,
    `**Agents involved:** ${session.agents_involved.join(', ') || 'none yet'}`,
  ];

  if (session.description) {
    lines.push('', `**Description:** ${session.description}`);
  }

  if (steps.length > 0) {
    // Condensed summary when 5+ steps completed
    if (steps.length >= 5) {
      lines.push('', `### Session Summary (${steps.length} steps completed)`);
      const summaryParts = steps.map((s) => {
        const summary = s.output_summary ?? s.output?.slice(0, 100) ?? 'completed';
        return `${s.agent_name} ${summary.split('.')[0].toLowerCase()}`;
      });
      lines.push(`This task started with ${summaryParts.join(', then ')}.`);
    }

    lines.push('', '### Previous Steps', '');

    // Build a set of low-affinity step wings for condensed rendering
    const lowAffinityWings = new Set<string>();
    if (!isOrchestrator && agentResult.rows.length > 0) {
      let wingAffinityMap: Record<string, number> = {};
      const rawAff = agentResult.rows[0].wing_affinity;
      if (rawAff) {
        let p: Record<string, unknown> = {};
        if (typeof rawAff === 'string') { try { p = JSON.parse(rawAff); } catch {} }
        else if (typeof rawAff === 'object') p = rawAff as Record<string, unknown>;
        wingAffinityMap = ((p as Record<string, unknown>).cross_wing_weights ?? {}) as Record<string, number>;
      }
      for (const step of steps) {
        const sw = step.wing ?? step.agent_name;
        if (sw !== agentName && (wingAffinityMap[sw] ?? 0.5) < 0.5) {
          lowAffinityWings.add(sw);
        }
      }
    }

    for (const step of steps) {
      const stepWing = step.wing ?? step.agent_name;
      const isLowAffinity = !isOrchestrator && lowAffinityWings.has(stepWing) && stepWing !== agentName;

      if (isLowAffinity) {
        // Condensed: just summary line for low-affinity wings
        const summary = step.output_summary ?? step.output?.slice(0, 100) ?? 'completed';
        lines.push(`**Step ${step.step_number} — ${step.agent_name}** _(low-affinity wing):_ ${summary.split('.')[0]}`);
      } else {
        // Full detail for own-wing and high-affinity
        const outputText = step.output_summary ?? step.output?.slice(0, 500) ?? '(no output)';
        lines.push(`**Step ${step.step_number} — ${step.agent_name}${step.agent_role ? ` (${step.agent_role})` : ''} completed:**`);
        lines.push(`Here is what ${step.agent_name} decided: ${outputText}`);
        if (step.decisions_created.length > 0) {
          lines.push(`Decisions created: ${step.decisions_created.join(', ')}`);
        }
        if (step.artifacts.length > 0) {
          lines.push(`Artifacts: ${JSON.stringify(step.artifacts)}`);
        }
      }
      lines.push('');
    }
  }

  lines.push('---', '');
  lines.push(`**Your turn:** You are \`${agentName}\`. Continue this task session.`);

  const ctx: SessionContext = {
    session,
    previous_steps: steps,
    formatted_session_context: lines.join('\n'),
  };

  setCache(sessionId, agentName, ctx);
  return ctx;
}

export async function getSessionState(sessionId: string): Promise<{
  session: TaskSession;
  steps: SessionStep[];
}> {
  const db = getDb();

  const sessionResult = await db.query<Record<string, unknown>>(
    'SELECT * FROM task_sessions WHERE id = ?',
    [sessionId],
  );
  if (sessionResult.rows.length === 0) {
    throw new Error(`Session ${sessionId} not found`);
  }
  const session = parseSession(sessionResult.rows[0] as Record<string, unknown>);

  const stepsResult = await db.query<Record<string, unknown>>(
    'SELECT * FROM session_steps WHERE session_id = ? ORDER BY step_number ASC',
    [sessionId],
  );
  const steps = stepsResult.rows.map((r) => parseStep(r as Record<string, unknown>));

  return { session, steps };
}

export async function updateSessionStatus(
  sessionId: string,
  status: 'active' | 'paused' | 'completed' | 'cancelled',
): Promise<TaskSession> {
  const db = getDb();

  const nowExpr = db.dialect === 'sqlite' ? "datetime('now')" : 'NOW()';
  const completedAt = status === 'completed' ? nowExpr : 'NULL';
  await db.query(
    `UPDATE task_sessions
     SET status = ?, updated_at = ${nowExpr}, completed_at = ${completedAt}
     WHERE id = ?`,
    [status, sessionId],
  );

  const result = await db.query<Record<string, unknown>>(
    'SELECT * FROM task_sessions WHERE id = ?',
    [sessionId],
  );
  if (result.rows.length === 0) {
    throw new Error(`Session ${sessionId} not found`);
  }

  invalidateSession(sessionId);
  return parseSession(result.rows[0] as Record<string, unknown>);
}

export async function listProjectSessions(
  projectId: string,
  status?: string,
): Promise<TaskSession[]> {
  const db = getDb();
  let sql = 'SELECT * FROM task_sessions WHERE project_id = ?';
  const params: unknown[] = [projectId];

  if (status) {
    sql += ' AND status = ?';
    params.push(status);
  }

  sql += ' ORDER BY updated_at DESC';

  const result = await db.query<Record<string, unknown>>(sql, params);
  return result.rows.map((r) => parseSession(r as Record<string, unknown>));
}
