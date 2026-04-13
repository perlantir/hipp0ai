import { getDb } from '../db/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SkillEntry {
  domain: string;
  total_outcomes: number;
  successes: number;
  partials: number;
  failures: number;
  skill_score: number;
  measured: boolean;
}

export interface AgentSkillProfile {
  agent_name: string;
  skills: SkillEntry[];
  overall_score: number;
  total_measured_domains: number;
  last_updated_at: string;
}

export interface SkillMatrix {
  agents: string[];
  domains: string[];
  matrix: Record<string, Record<string, SkillEntry>>;
}

export interface AgentSuggestion {
  agent_name: string;
  match_score: number;
  matching_domains: string[];
  matching_tags: string[];
  measured_skills: number;
  overall_score: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_OUTCOMES_FOR_MEASURED = 3;

// ---------------------------------------------------------------------------
// computeAgentSkillProfile
// ---------------------------------------------------------------------------

/**
 * Queries outcome data grouped by domain/tag for a single agent and
 * computes per-domain success rates.
 *
 * Skill score = (successful_outcomes * 1.0 + partial * 0.5) / total_outcomes
 * A domain is "measured" only when it has >= MIN_OUTCOMES_FOR_MEASURED outcomes.
 */
export async function computeAgentSkillProfile(
  projectId: string,
  agentName: string,
): Promise<AgentSkillProfile> {
  const db = getDb();

  // Get per-domain stats from decision_outcomes joined with decisions
  const result = await db.query<Record<string, unknown>>(
    `SELECT
       d.domain,
       COUNT(do2.id) as total_outcomes,
       SUM(CASE WHEN do2.outcome_type = 'success' THEN 1 ELSE 0 END) as successes,
       SUM(CASE WHEN do2.outcome_type = 'partial' THEN 1 ELSE 0 END) as partials,
       SUM(CASE WHEN do2.outcome_type IN ('failure', 'regression') THEN 1 ELSE 0 END) as failures
     FROM decisions d
     JOIN decision_outcomes do2 ON do2.decision_id = d.id
     WHERE d.project_id = ?
       AND d.made_by = ?
       AND d.domain IS NOT NULL
     GROUP BY d.domain
     ORDER BY COUNT(do2.id) DESC`,
    [projectId, agentName],
  );

  const skills: SkillEntry[] = result.rows.map((row) => {
    const total = Number(row.total_outcomes ?? 0);
    const successes = Number(row.successes ?? 0);
    const partials = Number(row.partials ?? 0);
    const failures = Number(row.failures ?? 0);
    const measured = total >= MIN_OUTCOMES_FOR_MEASURED;
    const skillScore = total > 0
      ? (successes * 1.0 + partials * 0.5) / total
      : 0;

    return {
      domain: row.domain as string,
      total_outcomes: total,
      successes,
      partials,
      failures,
      skill_score: Math.round(skillScore * 10000) / 10000,
      measured,
    };
  });

  // Also pull stats from compile_outcomes (agent's compilation records)
  const compileResult = await db.query<Record<string, unknown>>(
    `SELECT
       COUNT(*) as total,
       AVG(CASE WHEN co.task_completed = ${db.dialect === 'sqlite' ? '1' : 'true'} THEN 1.0 ELSE 0.0 END) as avg_completion,
       AVG(co.alignment_score) as avg_alignment
     FROM compile_outcomes co
     JOIN compile_history ch ON ch.id = co.compile_history_id
     WHERE ch.project_id = ?
       AND ch.agent_name = ?`,
    [projectId, agentName],
  );

  const compileTotal = Number(compileResult.rows[0]?.total ?? 0);
  const avgCompletion = Number(compileResult.rows[0]?.avg_completion ?? 0);
  const avgAlignment = Number(compileResult.rows[0]?.avg_alignment ?? 0);

  // Overall score: weighted average of measured skills + compile success rate
  const measuredSkills = skills.filter((s) => s.measured);
  let overallScore = 0;

  if (measuredSkills.length > 0) {
    const totalWeight = measuredSkills.reduce((acc, s) => acc + s.total_outcomes, 0);
    overallScore = measuredSkills.reduce(
      (acc, s) => acc + s.skill_score * s.total_outcomes,
      0,
    ) / (totalWeight || 1);
  } else if (compileTotal > 0) {
    // Fallback: use compile outcomes
    overallScore = (avgCompletion * 0.6 + avgAlignment * 0.4);
  }

  return {
    agent_name: agentName,
    skills,
    overall_score: Math.round(overallScore * 10000) / 10000,
    total_measured_domains: measuredSkills.length,
    last_updated_at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// getSkillMatrix
// ---------------------------------------------------------------------------

/**
 * Returns a matrix of all agents x all domains with success rates for a project.
 */
export async function getSkillMatrix(
  projectId: string,
): Promise<SkillMatrix> {
  const db = getDb();

  // Get all agent + domain combinations with outcome data
  const result = await db.query<Record<string, unknown>>(
    `SELECT
       d.made_by as agent_name,
       d.domain,
       COUNT(do2.id) as total_outcomes,
       SUM(CASE WHEN do2.outcome_type = 'success' THEN 1 ELSE 0 END) as successes,
       SUM(CASE WHEN do2.outcome_type = 'partial' THEN 1 ELSE 0 END) as partials,
       SUM(CASE WHEN do2.outcome_type IN ('failure', 'regression') THEN 1 ELSE 0 END) as failures
     FROM decisions d
     JOIN decision_outcomes do2 ON do2.decision_id = d.id
     WHERE d.project_id = ?
       AND d.domain IS NOT NULL
     GROUP BY d.made_by, d.domain
     ORDER BY d.made_by, d.domain`,
    [projectId],
  );

  const agents = new Set<string>();
  const domains = new Set<string>();
  const matrix: Record<string, Record<string, SkillEntry>> = {};

  for (const row of result.rows) {
    const agentName = row.agent_name as string;
    const domain = row.domain as string;
    const total = Number(row.total_outcomes ?? 0);
    const successes = Number(row.successes ?? 0);
    const partials = Number(row.partials ?? 0);
    const failures = Number(row.failures ?? 0);
    const measured = total >= MIN_OUTCOMES_FOR_MEASURED;
    const skillScore = total > 0
      ? (successes * 1.0 + partials * 0.5) / total
      : 0;

    agents.add(agentName);
    domains.add(domain);

    if (!matrix[agentName]) matrix[agentName] = {};
    matrix[agentName][domain] = {
      domain,
      total_outcomes: total,
      successes,
      partials,
      failures,
      skill_score: Math.round(skillScore * 10000) / 10000,
      measured,
    };
  }

  // Fill empty cells with "insufficient data" entries
  for (const agent of agents) {
    for (const domain of domains) {
      if (!matrix[agent]?.[domain]) {
        if (!matrix[agent]) matrix[agent] = {};
        matrix[agent][domain] = {
          domain,
          total_outcomes: 0,
          successes: 0,
          partials: 0,
          failures: 0,
          skill_score: 0,
          measured: false,
        };
      }
    }
  }

  return {
    agents: Array.from(agents).sort(),
    domains: Array.from(domains).sort(),
    matrix,
  };
}

// ---------------------------------------------------------------------------
// suggestBestAgent
// ---------------------------------------------------------------------------

/**
 * Given a task description and optional tags, returns agents ranked by
 * how well their measured skill profile matches the task's domain/tags.
 */
export async function suggestBestAgent(
  projectId: string,
  task: string,
  tags: string[],
): Promise<AgentSuggestion[]> {
  const db = getDb();

  // Step 1: Infer likely domains from the task keywords and tags
  const taskLower = task.toLowerCase();
  const domainKeywords: Record<string, string[]> = {
    authentication: ['auth', 'login', 'session', 'oauth', 'jwt', 'token', 'password'],
    infrastructure: ['deploy', 'docker', 'k8s', 'kubernetes', 'ci', 'cd', 'pipeline', 'infra'],
    frontend: ['ui', 'css', 'react', 'component', 'layout', 'design', 'ux'],
    database: ['db', 'sql', 'migration', 'schema', 'query', 'postgres', 'table', 'index'],
    testing: ['test', 'spec', 'coverage', 'e2e', 'unit', 'integration', 'fixture'],
    security: ['security', 'vulnerability', 'encrypt', 'permission', 'rbac', 'cors'],
    api: ['api', 'endpoint', 'route', 'rest', 'graphql', 'webhook'],
    deployment: ['deploy', 'release', 'staging', 'production', 'rollback'],
    general: [],
  };

  const matchedDomains = new Set<string>();
  for (const [domain, keywords] of Object.entries(domainKeywords)) {
    for (const kw of keywords) {
      if (taskLower.includes(kw)) {
        matchedDomains.add(domain);
        break;
      }
    }
  }

  // Also check tags directly as domains
  for (const tag of tags) {
    const tagLower = tag.toLowerCase();
    for (const [domain, keywords] of Object.entries(domainKeywords)) {
      if (domain === tagLower || keywords.includes(tagLower)) {
        matchedDomains.add(domain);
      }
    }
  }

  // Step 2: Get the skill matrix
  const skillMatrix = await getSkillMatrix(projectId);

  // Step 3: Also check tag-based overlap from decisions
  const tagMatchResult = tags.length > 0
    ? await db.query<Record<string, unknown>>(
        `SELECT
           d.made_by as agent_name,
           COUNT(DISTINCT do2.id) as tag_outcomes,
           SUM(CASE WHEN do2.outcome_type = 'success' THEN 1 ELSE 0 END) as tag_successes
         FROM decisions d
         JOIN decision_outcomes do2 ON do2.decision_id = d.id
         WHERE d.project_id = ?
           AND ${tags.map(() => '? = ANY(d.tags)').join(' OR ') || '1=0'}
         GROUP BY d.made_by`,
        [projectId, ...tags],
      ).catch(() => ({ rows: [] as Record<string, unknown>[] }))
    : { rows: [] as Record<string, unknown>[] };

  const tagScores: Record<string, { outcomes: number; successes: number }> = {};
  for (const row of tagMatchResult.rows) {
    tagScores[row.agent_name as string] = {
      outcomes: Number(row.tag_outcomes ?? 0),
      successes: Number(row.tag_successes ?? 0),
    };
  }

  // Step 4: Score each agent
  const suggestions: AgentSuggestion[] = [];

  for (const agentName of skillMatrix.agents) {
    const agentSkills = skillMatrix.matrix[agentName] ?? {};
    let domainMatchScore = 0;
    let domainMatchCount = 0;
    const matchingDomains: string[] = [];

    if (matchedDomains.size > 0) {
      for (const domain of matchedDomains) {
        const skill = agentSkills[domain];
        if (skill && skill.measured) {
          domainMatchScore += skill.skill_score;
          domainMatchCount++;
          matchingDomains.push(domain);
        }
      }
    }

    // Tag score component
    const ts = tagScores[agentName];
    const tagScore = ts && ts.outcomes >= MIN_OUTCOMES_FOR_MEASURED
      ? ts.successes / ts.outcomes
      : 0;
    const matchingTags = ts && ts.outcomes >= MIN_OUTCOMES_FOR_MEASURED ? tags : [];

    // Overall skill score (across all measured domains)
    const measuredEntries = Object.values(agentSkills).filter((s) => s.measured);
    const overallScore = measuredEntries.length > 0
      ? measuredEntries.reduce((acc, s) => acc + s.skill_score * s.total_outcomes, 0) /
        measuredEntries.reduce((acc, s) => acc + s.total_outcomes, 0)
      : 0;

    // Composite match score:
    // 50% domain match, 30% tag match, 20% overall track record
    const avgDomainMatch = domainMatchCount > 0 ? domainMatchScore / domainMatchCount : 0;
    const matchScore = avgDomainMatch * 0.5 + tagScore * 0.3 + overallScore * 0.2;

    if (matchScore > 0 || matchingDomains.length > 0 || matchingTags.length > 0) {
      suggestions.push({
        agent_name: agentName,
        match_score: Math.round(matchScore * 10000) / 10000,
        matching_domains: matchingDomains,
        matching_tags: matchingTags,
        measured_skills: measuredEntries.length,
        overall_score: Math.round(overallScore * 10000) / 10000,
      });
    }
  }

  // Sort by match_score descending
  suggestions.sort((a, b) => b.match_score - a.match_score);

  return suggestions;
}
