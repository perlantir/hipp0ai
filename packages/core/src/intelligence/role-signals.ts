/**
 * Super Brain Phase 2: Role Signals + Abstention
 *
 * Pure tag-matching math against agent relevance profiles.
 * Zero LLM calls — scoring only.
 */
import { getDb } from '../db/index.js';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface RoleSignal {
  agent_name: string;
  should_participate: boolean;
  abstain_probability: number;
  role_suggestion: string;
  reason: string;
  relevance_score: number;
  rank_among_agents: number;
  total_agents: number;
}

export interface TeamRelevance {
  task_description: string;
  recommended_participants: RoleSignal[];
  recommended_skip: RoleSignal[];
  optimal_team_size: number;
}

/* ------------------------------------------------------------------ */
/*  Role keyword map                                                   */
/* ------------------------------------------------------------------ */

const ROLE_KEYWORD_MAP: Array<{ role: string; keywords: string[]; suggestion: string }> = [
  { role: 'architect', keywords: ['design', 'plan', 'structure', 'architecture', 'system'], suggestion: 'design_lead' },
  { role: 'builder', keywords: ['implement', 'build', 'code', 'develop', 'feature'], suggestion: 'implementation_lead' },
  { role: 'security', keywords: ['auth', 'security', 'encrypt', 'permission', 'access'], suggestion: 'security_reviewer' },
  { role: 'ops', keywords: ['deploy', 'infrastructure', 'ci', 'cd', 'devops', 'monitor'], suggestion: 'deployment_lead' },
  { role: 'marketer', keywords: ['launch', 'marketing', 'campaign', 'growth', 'brand'], suggestion: 'launch_coordinator' },
  { role: 'reviewer', keywords: ['review', 'audit', 'quality', 'test', 'qa'], suggestion: 'code_reviewer' },
  { role: 'designer', keywords: ['ui', 'ux', 'design', 'layout', 'visual', 'css'], suggestion: 'design_lead' },
  { role: 'data', keywords: ['data', 'analytics', 'metric', 'dashboard', 'report'], suggestion: 'data_analyst' },
  { role: 'product', keywords: ['product', 'roadmap', 'feature', 'requirement', 'spec'], suggestion: 'product_lead' },
  { role: 'legal', keywords: ['legal', 'compliance', 'policy', 'regulation', 'license'], suggestion: 'compliance_reviewer' },
];

/* ------------------------------------------------------------------ */
/*  Scoring helpers                                                    */
/* ------------------------------------------------------------------ */

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
}

/**
 * Strip common English suffixes to produce a rough stem.
 * This is intentionally aggressive — we want "authentication" → "auth",
 * "tokens" → "token", "deployment" → "deploy", etc.
 */
function stem(word: string): string {
  return word
    .replace(/ication$/, '')
    .replace(/ation$/, '')
    .replace(/ment$/, '')
    .replace(/ness$/, '')
    .replace(/ity$/, '')
    .replace(/ious$/, '')
    .replace(/ive$/, '')
    .replace(/ing$/, '')
    .replace(/tion$/, '')
    .replace(/sion$/, '')
    .replace(/able$/, '')
    .replace(/ence$/, '')
    .replace(/ance$/, '')
    .replace(/ture$/, '')
    .replace(/ous$/, '')
    .replace(/ful$/, '')
    .replace(/ent$/, '')
    .replace(/ant$/, '')
    .replace(/al$/, '')
    .replace(/ed$/, '')
    .replace(/er$/, '')
    .replace(/ly$/, '')
    .replace(/es$/, '')
    .replace(/s$/, '');
}

/**
 * Check if a tag matches a task token.
 * Uses three strategies:
 *   1. Exact match
 *   2. Substring/contains (either direction)
 *   3. Stemmed match (both sides stemmed, min 3 chars)
 */
function tagMatches(tagLower: string, token: string): boolean {
  // Exact
  if (tagLower === token) return true;
  // Substring: "authentication" contains "auth", "tokens" contains "token"
  if (tagLower.includes(token) || token.includes(tagLower)) return true;
  // Stemmed: stem("authentication") = "auth", stem("tokens") = "token"
  const tagStem = stem(tagLower);
  const tokenStem = stem(token);
  if (tagStem.length >= 3 && tokenStem.length >= 3) {
    if (tagStem === tokenStem) return true;
    if (tagStem.includes(tokenStem) || tokenStem.includes(tagStem)) return true;
  }
  return false;
}

function scoreAgentForTask(
  weights: Record<string, number>,
  taskTokens: string[],
): number {
  if (Object.keys(weights).length === 0 || taskTokens.length === 0) return 0;

  let matchScore = 0;

  for (const [tag, weight] of Object.entries(weights)) {
    const tagLower = tag.toLowerCase();
    for (const token of taskTokens) {
      if (tagMatches(tagLower, token)) {
        matchScore += Math.abs(weight);
        break;
      }
    }
  }

  // Normalize by the sum of the top 3 weights (the agent's strongest tags).
  // This prevents low scores when an agent has many niche tags that don't
  // match the current task but their core tags match strongly.
  const sortedWeights = Object.values(weights).map(Math.abs).sort((a, b) => b - a);
  const top3Sum = sortedWeights.slice(0, 3).reduce((s, w) => s + w, 0);
  const maxPossible = Math.max(top3Sum, 0.1);

  return Math.min(matchScore / maxPossible, 1.0);
}

/* ------------------------------------------------------------------ */
/*  generateRoleSuggestion                                             */
/* ------------------------------------------------------------------ */


  // Machine-Readable Action Signals

export type RecommendedAction =
  | 'PROCEED'
  | 'PROCEED_WITH_NOTE'
  | 'SKIP'
  | 'OVERRIDE_TO'
  | 'ASK_FOR_CLARIFICATION';

export interface ActionSignal {
  recommended_action: RecommendedAction;
  action_reason: string;
  override_to_agent?: string;
}

/**
 * Compute a machine-readable action from a role signal.
 * Pure function — no LLM calls, no DB queries.
 */
export function computeRecommendedAction(signal: RoleSignal): ActionSignal {
  // Agent is a strong fit
  if (signal.abstain_probability < 0.30) {
    return {
      recommended_action: 'PROCEED',
      action_reason: signal.reason.startsWith('Strong fit')
        ? `${signal.reason}. Start working.`
        : `You are a strong fit for this task (${Math.round(signal.relevance_score * 100)}% relevance). Start working.`,
    };
  }

  // Agent can contribute but isn't the best fit
  if (signal.abstain_probability < 0.70) {
    return {
      recommended_action: 'PROCEED_WITH_NOTE',
      action_reason: signal.reason.startsWith('Can contribute')
        ? signal.reason
        : `You can contribute (${Math.round(signal.relevance_score * 100)}% relevance), but consider deferring to a higher-ranked agent for deeper review.`,
    };
  }

  // Agent is not a good fit — check if there's a better agent
  if (signal.rank_among_agents > 1) {
    return {
      recommended_action: 'SKIP',
      action_reason: signal.reason.includes('domain') || signal.reason.includes('expertise')
        ? signal.reason
        : `This task is outside your core expertise. Other agents are better suited.`,
    };
  }

  return {
    recommended_action: 'SKIP',
    action_reason: signal.reason.includes('domain')
      ? signal.reason
      : `Outside your domain — other agents are much better suited for this task.`,
  };
}

export function generateRoleSuggestion(
  agentRole: string,
  taskDescription: string,
  rank: number,
  _totalAgents: number,
): string {
  const roleLower = agentRole.toLowerCase();
  const taskLower = taskDescription.toLowerCase();

  // Check keyword map for specific role+task match
  for (const entry of ROLE_KEYWORD_MAP) {
    if (roleLower.includes(entry.role)) {
      for (const kw of entry.keywords) {
        if (taskLower.includes(kw)) {
          if (rank === 1) return entry.suggestion;
          if (rank <= 3) return entry.suggestion.replace('_lead', '_contributor').replace('_reviewer', '_contributor');
          return entry.suggestion.replace('_lead', '_observer').replace('_reviewer', '_observer');
        }
      }
    }
  }

  // Default: use agent role with rank suffix
  const baseRole = roleLower.replace(/\s+/g, '_');
  if (rank === 1) return `${baseRole}_lead`;
  if (rank <= 3) return `${baseRole}_contributor`;
  return `${baseRole}_observer`;
}

/* ------------------------------------------------------------------ */
/*  generateRoleSignal                                                 */
/* ------------------------------------------------------------------ */

export async function generateRoleSignal(
  projectId: string,
  agentName: string,
  taskDescription: string,
  sessionId?: string,
): Promise<RoleSignal> {
  const db = getDb();
  const taskTokens = tokenize(taskDescription);

  // 1. Get all agents for this project
  const agentsResult = await db.query(
    'SELECT id, name, role, relevance_profile FROM agents WHERE project_id = ?',
    [projectId],
  );
  const agents = agentsResult.rows as Array<{
    id: string;
    name: string;
    role: string;
    relevance_profile: string | Record<string, unknown> | null;
  }>;

  if (agents.length === 0) {
    return {
      agent_name: agentName,
      should_participate: false,
      abstain_probability: 0.95,
      role_suggestion: 'observer',
      reason: 'No agents found in project',
      relevance_score: 0,
      rank_among_agents: 0,
      total_agents: 0,
    };
  }

  // 2. Score each agent
  const scored: Array<{ name: string; role: string; score: number }> = [];
  for (const agent of agents) {
    const profile = typeof agent.relevance_profile === 'string'
      ? JSON.parse(agent.relevance_profile || '{}')
      : (agent.relevance_profile ?? {});
    const weights: Record<string, number> = (profile as Record<string, unknown>).weights as Record<string, number> ?? {};
    const score = scoreAgentForTask(weights, taskTokens);
    scored.push({ name: agent.name, role: agent.role, score });
  }

  // 3. Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // 4. Find this agent
  const agentIdx = scored.findIndex((a) => a.name === agentName);
  if (agentIdx === -1) {
    return {
      agent_name: agentName,
      should_participate: false,
      abstain_probability: 0.95,
      role_suggestion: 'observer',
      reason: 'Agent not found in project',
      relevance_score: 0,
      rank_among_agents: 0,
      total_agents: scored.length,
    };
  }

  const agentEntry = scored[agentIdx];
  const rank = agentIdx + 1;
  const relevanceScore = agentEntry.score;

  // 5. Check session participation history — increases abstain probability
  let sessionBoost = 0;
  if (sessionId) {
    try {
      const stepsResult = await db.query(
        'SELECT id FROM session_steps WHERE session_id = ? AND agent_name = ? LIMIT 1',
        [sessionId, agentName],
      );
      if (stepsResult.rows.length > 0) {
        sessionBoost = 0.2;
      }
    } catch {
      // session_steps table may not exist — ignore
    }
  }

  // 6. Collect matched tags for natural language reasons
  const agentData = agents.find((a) => a.name === agentName);
  const agentProfile = agentData
    ? (typeof agentData.relevance_profile === 'string'
      ? JSON.parse(agentData.relevance_profile || '{}')
      : (agentData.relevance_profile ?? {})) as Record<string, unknown>
    : {};
  const agentWeights = (agentProfile.weights ?? {}) as Record<string, number>;
  const matchedTagNames = Object.keys(agentWeights).filter((tag) =>
    taskTokens.some((token) => tagMatches(tag.toLowerCase(), token)),
  );
  const earlyRoleSuggestion = generateRoleSuggestion(agentEntry.role, taskDescription, rank, scored.length);
  const roleLabel = earlyRoleSuggestion.replace(/_/g, ' ');

  // 7. Apply thresholds with natural language reasons
  let shouldParticipate: boolean;
  let abstainProbability: number;
  let reason: string;

  if (relevanceScore >= 0.6) {
    shouldParticipate = true;
    abstainProbability = Math.min(0.05 + sessionBoost, 1);
    reason = matchedTagNames.length > 0
      ? `Strong fit for ${roleLabel} — this task directly involves ${matchedTagNames.slice(0, 3).join(' and ')}`
      : `Strong fit for this task (${Math.round(relevanceScore * 100)}% relevance)`;
  } else if (relevanceScore >= 0.3) {
    shouldParticipate = true;
    abstainProbability = Math.min(0.3 + sessionBoost, 1);
    const topAgent = scored[0]?.name;
    reason = matchedTagNames.length > 0
      ? `Can contribute on ${matchedTagNames.slice(0, 2).join(' and ')}, but ${topAgent ?? 'another agent'} may be a better lead`
      : `Partial overlap with this task — consider deferring to a higher-ranked agent`;
  } else if (relevanceScore >= 0.15) {
    shouldParticipate = false;
    abstainProbability = Math.min(0.7 + sessionBoost, 1);
    reason = `This task doesn't align with ${agentName}'s core expertise — skip unless explicitly needed`;
  } else {
    shouldParticipate = false;
    abstainProbability = Math.min(0.95 + sessionBoost, 1);
    reason = `Outside ${agentName}'s domain — other agents are much better suited for this task`;
  }

  // 7. Debug logging in development
  if (process.env.NODE_ENV === 'development') {
    const weights: Record<string, number> = (() => {
      const agent = agents.find((a) => a.name === agentName);
      if (!agent) return {};
      const profile = typeof agent.relevance_profile === 'string'
        ? JSON.parse(agent.relevance_profile || '{}')
        : (agent.relevance_profile ?? {});
      return (profile as Record<string, unknown>).weights as Record<string, number> ?? {};
    })();
    const matchedTags = Object.keys(weights).filter((tag) => {
      const tagLower = tag.toLowerCase();
      return taskTokens.some((token) => tagMatches(tagLower, token));
    });
    console.warn(`[role-signals] Agent: ${agentName}`);
    console.warn(`[role-signals]   Tags matched: ${matchedTags.join(', ')}`);
    console.warn(`[role-signals]   Raw score: ${relevanceScore}`);
    console.warn(`[role-signals]   Normalized: ${Math.round(relevanceScore * 1000) / 1000}`);
    console.warn(`[role-signals]   Abstain: ${abstainProbability}`);
  }

  // 8. Generate role suggestion
  const roleSuggestion = generateRoleSuggestion(agentEntry.role, taskDescription, rank, scored.length);

  return {
    agent_name: agentName,
    should_participate: shouldParticipate,
    abstain_probability: Math.round(abstainProbability * 100) / 100,
    role_suggestion: roleSuggestion,
    reason,
    relevance_score: Math.round(relevanceScore * 1000) / 1000,
    rank_among_agents: rank,
    total_agents: scored.length,
  };
}

/* ------------------------------------------------------------------ */
/*  scoreTeamForTask                                                   */
/* ------------------------------------------------------------------ */

export async function scoreTeamForTask(
  projectId: string,
  taskDescription: string,
  sessionId?: string,
): Promise<TeamRelevance> {
  const db = getDb();

  // Get all agents
  const agentsResult = await db.query(
    'SELECT name FROM agents WHERE project_id = ?',
    [projectId],
  );
  const agentNames = (agentsResult.rows as Array<{ name: string }>).map((a) => a.name);

  // Score all agents in parallel
  const signals = await Promise.all(
    agentNames.map((name) => generateRoleSignal(projectId, name, taskDescription, sessionId)),
  );

  // Sort by relevance descending
  signals.sort((a, b) => b.relevance_score - a.relevance_score);

  const participants = signals.filter((s) => s.should_participate);
  const skip = signals.filter((s) => !s.should_participate);

  // Optimal team size: agents with relevance >= 0.3, capped at 5
  const qualifiedCount = signals.filter((s) => s.relevance_score >= 0.3).length;
  const optimalTeamSize = Math.min(qualifiedCount, 5);

  return {
    task_description: taskDescription,
    recommended_participants: participants,
    recommended_skip: skip,
    optimal_team_size: optimalTeamSize,
  };
}
