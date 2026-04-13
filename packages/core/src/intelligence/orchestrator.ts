/**
 * Super Brain Phase 3: Smart Orchestrator
 *
 * Recommends who should go next, what they should do, and pre-loads their context.
 * Uses role signals from Phase 2 — zero LLM calls.
 */
import { getDb } from '../db/index.js';
import { generateRoleSignal, computeRecommendedAction } from './role-signals.js';
import { getSessionContext } from '../memory/session-manager.js';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface NextAgentSuggestion {
  recommended_agent: string;
  recommended_role: string;
  confidence: number;
  task_suggestion: string;
  pre_compiled_context: string | null;
  reasoning: string;
  alternatives: Array<{
    agent: string;
    role: string;
    score: number;
    task_suggestion: string;
  }>;
  is_session_complete: boolean;
  completion_reason?: string;
  estimated_remaining_steps: number;
  session_progress: number;
  recommended_action?: string;
  action_reason?: string;
  override_to_agent?: string;
}

export interface SessionPlan {
  session_title: string;
  suggested_plan: Array<{
    step: number;
    agent: string;
    role: string;
    task: string;
    relevance: number;
  }>;
  estimated_agents: number;
  note: string;
}

/* ------------------------------------------------------------------ */
/*  Task suggestion templates                                          */
/* ------------------------------------------------------------------ */

const TASK_TEMPLATES: Record<string, string> = {
  security_reviewer: 'Review for security vulnerabilities, authentication issues, and access control gaps',
  implementation_lead: 'Implement based on the design decisions and architecture from previous steps',
  design_lead: 'Design the system architecture, component structure, and data flow',
  deployment_lead: 'Plan and execute deployment, CI/CD pipeline, and infrastructure setup',
  code_reviewer: 'Review code quality, test coverage, and adherence to project standards',
  data_analyst: 'Analyze data requirements, schema design, and reporting needs',
  product_lead: 'Define product requirements, user stories, and acceptance criteria',
  launch_coordinator: 'Coordinate launch activities, marketing, and stakeholder communication',
  compliance_reviewer: 'Review for regulatory compliance, licensing, and policy adherence',
};

/* ------------------------------------------------------------------ */
/*  Workflow ordering for plan generation                               */
/* ------------------------------------------------------------------ */

const WORKFLOW_ORDER: Record<string, number> = {
  product_lead: 1,
  design_lead: 2,
  architect_lead: 2,
  implementation_lead: 3,
  builder_lead: 3,
  data_analyst: 3,
  code_reviewer: 4,
  security_reviewer: 4,
  compliance_reviewer: 4,
  deployment_lead: 5,
  launch_coordinator: 6,
};

function getWorkflowOrder(role: string): number {
  // Check exact match first
  if (WORKFLOW_ORDER[role] !== undefined) return WORKFLOW_ORDER[role];
  // Check prefix match
  for (const [key, order] of Object.entries(WORKFLOW_ORDER)) {
    if (role.startsWith(key.replace('_lead', '').replace('_reviewer', ''))) return order;
  }
  return 3; // default to middle of workflow
}

/* ------------------------------------------------------------------ */
/*  generateTaskSuggestion                                             */
/* ------------------------------------------------------------------ */

export function generateTaskSuggestion(
  agentName: string,
  roleSuggestion: string,
  sessionTitle: string,
  completedSteps: number,
): string {
  // Check for exact role template match
  if (TASK_TEMPLATES[roleSuggestion]) {
    return `${TASK_TEMPLATES[roleSuggestion]} for "${sessionTitle}"`;
  }

  // Check for partial match (e.g., security_contributor → security_reviewer template)
  const roleBase = roleSuggestion.replace(/_(?:lead|contributor|observer)$/, '_reviewer');
  if (TASK_TEMPLATES[roleBase]) {
    return `${TASK_TEMPLATES[roleBase]} for "${sessionTitle}"`;
  }

  const roleBaseAlt = roleSuggestion.replace(/_(?:lead|contributor|observer)$/, '_lead');
  if (TASK_TEMPLATES[roleBaseAlt]) {
    return `${TASK_TEMPLATES[roleBaseAlt]} for "${sessionTitle}"`;
  }

  // Fallback
  return completedSteps === 0
    ? `Begin work on "${sessionTitle}" as ${agentName}`
    : `Continue the task "${sessionTitle}" — build on the ${completedSteps} completed step${completedSteps !== 1 ? 's' : ''}`;
}

/* ------------------------------------------------------------------ */
/*  buildReasoningExplanation                                          */
/* ------------------------------------------------------------------ */

export function buildReasoningExplanation(
  recommended: { agent: string; role: string; score: number },
  completedAgents: string[],
  sessionTitle: string,
): string {
  const parts: string[] = [];

  parts.push(`Recommending ${recommended.agent} (${recommended.role}) for "${sessionTitle}".`);

  if (recommended.score >= 0.6) {
    parts.push(`High relevance score (${(recommended.score * 100).toFixed(0)}%) — strong tag match for this task.`);
  } else if (recommended.score >= 0.3) {
    parts.push(`Moderate relevance score (${(recommended.score * 100).toFixed(0)}%) — partial tag overlap.`);
  } else {
    parts.push(`Lower relevance score (${(recommended.score * 100).toFixed(0)}%) — best available candidate.`);
  }

  if (completedAgents.length > 0) {
    const isNew = !completedAgents.includes(recommended.agent);
    if (isNew) {
      parts.push(`Fresh perspective — hasn't participated yet (${completedAgents.length} agent${completedAgents.length !== 1 ? 's' : ''} have contributed).`);
    } else {
      parts.push(`Returning participant — relevance score high enough to justify re-engagement.`);
    }
  } else {
    parts.push('First agent in this session.');
  }

  return parts.join(' ');
}

/* ------------------------------------------------------------------ */
/*  suggestNextAgent                                                   */
/* ------------------------------------------------------------------ */

export async function suggestNextAgent(
  sessionId: string,
  projectId: string,
): Promise<NextAgentSuggestion> {
  const db = getDb();

  // 1. Get session state + completed steps
  const sessionResult = await db.query<Record<string, unknown>>(
    'SELECT id, title, status, agents_involved, current_step, state_summary FROM task_sessions WHERE id = ?',
    [sessionId],
  );
  if (sessionResult.rows.length === 0) {
    throw new Error(`Session ${sessionId} not found`);
  }
  const session = sessionResult.rows[0];
  const sessionTitle = session.title as string;

  const stepsResult = await db.query<Record<string, unknown>>(
    `SELECT step_number, agent_name, agent_role, output_summary
     FROM session_steps WHERE session_id = ? AND status = 'completed'
     ORDER BY step_number ASC`,
    [sessionId],
  );
  const completedSteps = stepsResult.rows as Array<{
    step_number: number;
    agent_name: string;
    agent_role: string | null;
    output_summary: string | null;
  }>;

  const completedAgents = [...new Set(completedSteps.map((s) => s.agent_name))];

  // 2. Build context description from session title + last step output
  const lastStep = completedSteps[completedSteps.length - 1];
  const currentContext = lastStep
    ? `${sessionTitle}. Previous: ${lastStep.output_summary ?? 'completed'}`
    : sessionTitle;

  // 3. Score ALL agents using generateRoleSignal
  const agentsResult = await db.query<Record<string, unknown>>(
    'SELECT name FROM agents WHERE project_id = ?',
    [projectId],
  );
  const agentNames = (agentsResult.rows as Array<{ name: string }>).map((a) => a.name);

  if (agentNames.length === 0) {
    return {
      recommended_agent: '',
      recommended_role: '',
      confidence: 0,
      task_suggestion: '',
      pre_compiled_context: null,
      reasoning: 'No agents found in project',
      alternatives: [],
      is_session_complete: true,
      completion_reason: 'No agents are configured for this project yet.',
      estimated_remaining_steps: 0,
      session_progress: 100,
    };
  }

  const signals = await Promise.all(
    agentNames.map((name) => generateRoleSignal(projectId, name, currentContext, sessionId)),
  );

  // 4. Filter and adjust scores
  const candidates = signals
    .filter((s) => s.relevance_score >= 0.15)
    .map((s) => {
      let adjustedScore = s.relevance_score;
      // Penalize agents who already participated, unless high relevance
      if (completedAgents.includes(s.agent_name) && s.relevance_score < 0.6) {
        adjustedScore -= 0.3;
      }
      return {
        agent: s.agent_name,
        role: s.role_suggestion,
        score: Math.max(adjustedScore, 0),
        originalScore: s.relevance_score,
      };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);

  // 5. Count agents with relevance > 0.3 that haven't participated (for remaining estimate)
  const remainingRelevant = signals
    .filter((s) => s.relevance_score > 0.3 && !completedAgents.includes(s.agent_name))
    .length;

  // 6. Check completion conditions
  if (candidates.length === 0 || (completedSteps.length >= 3 && (candidates[0]?.score ?? 0) < 0.3)) {
    const contributorNames = completedAgents.join(', ');
    return {
      recommended_agent: '',
      recommended_role: '',
      confidence: 0,
      task_suggestion: '',
      pre_compiled_context: null,
      reasoning: candidates.length === 0
        ? 'No relevant agents remaining for this task'
        : `Best candidate score (${((candidates[0]?.score ?? 0) * 100).toFixed(0)}%) too low after ${completedSteps.length} steps`,
      alternatives: [],
      is_session_complete: true,
      completion_reason: `Task complete — ${completedAgents.length} agent${completedAgents.length !== 1 ? 's' : ''} contributed (${contributorNames}). The remaining agents don't have the right expertise for what's left. No further steps needed.`,
      estimated_remaining_steps: 0,
      session_progress: 100,
    };
  }

  const top = candidates[0];

  // 6. Generate task suggestion
  const taskSuggestion = generateTaskSuggestion(
    top.agent,
    top.role,
    sessionTitle,
    completedSteps.length,
  );

  // 7. Pre-fetch context for recommended agent
  let preCompiledContext: string | null = null;
  try {
    const ctx = await getSessionContext(sessionId, top.agent, taskSuggestion, projectId);
    preCompiledContext = ctx.formatted_session_context;
  } catch {
    // Non-fatal — context pre-fetch is optional
  }

  // 8. Build reasoning
  const reasoning = buildReasoningExplanation(top, completedAgents, sessionTitle);

  // 9. Alternatives (next 3 candidates)
  const alternatives = candidates.slice(1, 4).map((c) => ({
    agent: c.agent,
    role: c.role,
    score: Math.round(c.score * 1000) / 1000,
    task_suggestion: generateTaskSuggestion(c.agent, c.role, sessionTitle, completedSteps.length),
  }));

  const estimatedRemaining = remainingRelevant;
  const sessionProgress = completedSteps.length > 0
    ? Math.round((completedSteps.length / (completedSteps.length + estimatedRemaining)) * 100)
    : 0;

  return {
    recommended_agent: top.agent,
    recommended_role: top.role,
    confidence: Math.round(top.score * 1000) / 1000,
    task_suggestion: taskSuggestion,
    pre_compiled_context: preCompiledContext,
    reasoning,
    alternatives,
    is_session_complete: false,
    estimated_remaining_steps: estimatedRemaining,
    session_progress: sessionProgress,
    recommended_action: 'OVERRIDE_TO' as const,
    override_to_agent: top.agent,
    action_reason: `${top.agent} has ${Math.round(top.score * 100)}% relevance as ${top.role}. They should handle the next step.`,
  };
}

/* ------------------------------------------------------------------ */
/*  generateSessionPlan                                                */
/* ------------------------------------------------------------------ */

export async function generateSessionPlan(
  sessionId: string,
  projectId: string,
): Promise<SessionPlan> {
  const db = getDb();

  // Get session
  const sessionResult = await db.query<Record<string, unknown>>(
    'SELECT id, title, current_step FROM task_sessions WHERE id = ?',
    [sessionId],
  );
  if (sessionResult.rows.length === 0) {
    throw new Error(`Session ${sessionId} not found`);
  }
  const session = sessionResult.rows[0];
  const sessionTitle = session.title as string;

  // Score all agents
  const agentsResult = await db.query<Record<string, unknown>>(
    'SELECT name FROM agents WHERE project_id = ?',
    [projectId],
  );
  const agentNames = (agentsResult.rows as Array<{ name: string }>).map((a) => a.name);

  const signals = await Promise.all(
    agentNames.map((name) => generateRoleSignal(projectId, name, sessionTitle, sessionId)),
  );

  // Filter to participants (relevance >= 0.15), sort by workflow order then relevance
  const participants = signals
    .filter((s) => s.relevance_score >= 0.15)
    .sort((a, b) => {
      const orderA = getWorkflowOrder(a.role_suggestion);
      const orderB = getWorkflowOrder(b.role_suggestion);
      if (orderA !== orderB) return orderA - orderB;
      return b.relevance_score - a.relevance_score;
    });

  const suggestedPlan = participants.map((p, idx) => ({
    step: idx + 1,
    agent: p.agent_name,
    role: p.role_suggestion,
    task: generateTaskSuggestion(p.agent_name, p.role_suggestion, sessionTitle, idx),
    relevance: Math.round(p.relevance_score * 1000) / 1000,
  }));

  return {
    session_title: sessionTitle,
    suggested_plan: suggestedPlan,
    estimated_agents: suggestedPlan.length,
    note: suggestedPlan.length === 0
      ? 'No agents with sufficient relevance found for this task.'
      : `Plan suggests ${suggestedPlan.length} agent${suggestedPlan.length !== 1 ? 's' : ''} in logical workflow order (design → build → review → deploy).`,
  };
}
