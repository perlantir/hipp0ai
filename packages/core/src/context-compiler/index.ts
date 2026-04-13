import crypto from 'node:crypto';
import { getDb } from '../db/index.js';
import { getPersona as _getPersonaImport } from '../config/agentPersonas.js';
import type { AgentPersona } from '../config/agentPersonas.js';
import {
  parseAgent,
  parseDecision,
  parseArtifact,
  parseSession,
  parseNotification,
} from '../db/parsers.js';
import { Hipp0Error, NotFoundError } from '../types.js';
import { computeFreshness, blendScores, computeEffectiveConfidence } from '../temporal/index.js';
import type {
  Agent,
  Decision,
  ScoredDecision,
  ScoredArtifact,
  Artifact,
  Notification,
  SessionSummary,
  CompileRequest,
  ContextPackage,
  ScoringBreakdown,
  DecisionDomain,
  WingAffinity,
  SuggestedPattern,
} from '../types.js';
import { getPatternRecommendations, DEFAULT_MIN_PATTERN_CONFIDENCE } from '../intelligence/pattern-extractor.js';
import { inferDomainFromTask } from '../hierarchy/classifier.js';
import { trustMultiplier } from '../intelligence/trust-scorer.js';
import { outcomeMultiplier } from '../intelligence/outcome-memory.js';
import { computeWingSources } from '../wings/affinity.js';

// Embedding helper — imported from decision-graph (generated at runtime).
// We use a dynamic import shape so the module can be provided at runtime.
// IMPORTANT: Do NOT cache the zero-vector fallback — retry the real import
// on every call so a transient import failure doesn't permanently disable
// semantic search for the lifetime of the process.
let _generateEmbedding: ((text: string) => Promise<number[]>) | null = null;
let _embeddingImportFailed = false;

const ZERO_VECTOR: number[] = new Array(1536).fill(0) as number[];

async function getEmbeddingFn(): Promise<(text: string) => Promise<number[]>> {
  if (_generateEmbedding) return _generateEmbedding;
  try {
    const mod = await import('../decision-graph/embeddings.js');
    _generateEmbedding = mod.generateEmbedding as (text: string) => Promise<number[]>;
    _embeddingImportFailed = false;
    return _generateEmbedding;
  } catch (err) {
    // Log but do NOT cache the fallback — retry the import next time.
    if (!_embeddingImportFailed) {
      console.warn('[hipp0/embeddings] Failed to import embeddings module — semantic search disabled for this call:', (err as Error).message);
      _embeddingImportFailed = true;
    }
    return async (_text: string) => [...ZERO_VECTOR];
  }
}

/**
 * Compute cosine similarity between two equal-length numeric vectors.
 * Returns 0 if either vector has zero magnitude.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    magA += a[i]! * a[i]!;
    magB += b[i]! * b[i]!;
  }

  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

function statusPenalty(decision: Decision, agent: Agent): number {
  switch (decision.status) {
    case 'active':
    case 'pending':
      return 1.0;
    case 'superseded':
      return agent.relevance_profile.include_superseded ? 0.4 : 0.1;
    case 'reverted':
      return 0.05;
    default:
      return 1.0;
  }
}

/**
 * Score a single decision for a specific agent using the 5-signal algorithm.
 *
 * Signal A (0.40): Direct affect — agent name or role in decision.affects
 * Signal B (0.20): Tag matching — average weight of matching profile tags
 * Signal C (0.15): Role relevance — count of high-priority tag matches
 * Signal D (0.25): Semantic similarity — cosine similarity of embeddings
 * Signal E     : Status penalty multiplier
 */
function _getPersonaSafe(agentName: string): AgentPersona | undefined {
  try {
    return _getPersonaImport(agentName);
  } catch {
    return undefined;
  }
}

// V4 scoring weights — freshness added as 5th weighted signal
// Env-configurable feature flags
const FRESHNESS_ENABLED = process.env.HIPP0_FRESHNESS_ENABLED !== 'false';
const FRESHNESS_FLOOR = parseFloat(process.env.HIPP0_FRESHNESS_FLOOR || '0.1');
const STALENESS_ENABLED = process.env.HIPP0_STALENESS_ENABLED !== 'false';

const SCORING_WEIGHTS = {
  directAffect: 0.25,
  tagMatch: 0.15,
  personaMatch: 0.20,  // This is THE differentiator between agents
  semanticSimilarity: 0.20,
  freshness: 0.20,
};

// Tier-aware decay lambdas for freshness calculation
const TIER_DECAY_LAMBDA: Record<string, number> = {
  permanent: 0.001,
  sprint: 0.0077,
  experiment: 0.099,
  deprecated: 0.231,
};

// Staleness thresholds and max penalties by tier
const STALENESS_CONFIG: Record<string, { threshold: number; maxPenalty: number }> = {
  sprint: { threshold: 120, maxPenalty: 0.25 },
  experiment: { threshold: 30, maxPenalty: 0.50 },
  deprecated: { threshold: 14, maxPenalty: 0.75 },
};

// Post-processing thresholds
export const MIN_SCORE = parseFloat(process.env.HIPP0_COMPILE_MIN_SCORE ?? '0.15');
export const MAX_RESULTS = 15;

  // Deduplication

function deduplicateDecisions(decisions: ScoredDecision[]): ScoredDecision[] {
  const seen = new Set<string>();
  return decisions.filter((d) => {
    const normalized = d.title
      .toLowerCase()
      .replace(/\s*(in hipp0|across ops|for v1|for bouts|for agents)\s*$/i, '')
      .trim();
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

  // Single Output Funnel
// EVERY code path must go through this before returning decisions.

function finalizeResults(
  scored: ScoredDecision[],
  agentName: string,
  projectId: string,
  startMs: number,
  minScore: number = MIN_SCORE,
  maxResults: number = MAX_RESULTS,
): ScoredDecision[] {
  // Re-clamp all scores to [0, 1.0]
  for (const d of scored) {
    d.combined_score = Math.max(0, Math.min(1.0, d.combined_score));
  }

  const filtered = scored.filter((d) => d.combined_score >= minScore);
  const deduped = deduplicateDecisions(filtered);
  const sorted = deduped.sort((a, b) => b.combined_score - a.combined_score);
  const capped = sorted.slice(0, maxResults);

  // Normalize: map top score to 0.95, scale others proportionally
  if (capped.length > 0) {
    const maxScore = capped[0].combined_score;
    if (maxScore > 0) {
      const TARGET_MAX = 0.95;
      const scale = TARGET_MAX / maxScore;
      capped.forEach((d) => {
        d.combined_score = Math.round(d.combined_score * scale * 1000) / 1000;
      });
    }
  }

  // After normalization, ensure unique scores via micro-spread
  if (capped.length > 1) {
    for (let i = 1; i < capped.length; i++) {
      if (capped[i].combined_score >= capped[i - 1].combined_score) {
        // Use semantic_similarity to determine spread amount
        const sem = (capped[i].scoring_breakdown as unknown as Record<string, unknown>)?.semantic_similarity as number ?? 0;
        const prevSem = (capped[i - 1].scoring_breakdown as unknown as Record<string, unknown>)?.semantic_similarity as number ?? 0;
        const semDiff = Math.abs(sem - prevSem);
        // Minimum spread of 0.001, up to 0.005 based on semantic difference
        const spread = Math.max(0.001, Math.min(0.005, semDiff * 0.02));
        capped[i].combined_score = Math.round((capped[i - 1].combined_score - spread) * 1000) / 1000;
      }
    }
  }

  // One-line compile trace (always-on, permanent)
  const ms = Date.now() - startMs;
  console.warn(
    `[hipp0/compile] agent=${agentName} project=${(projectId ?? '').slice(0, 8)}.. scored=${scored.length} passed=${capped.length} top=${(capped[0]?.combined_score ?? 0).toFixed(3)} semantic=${scored.filter((d) => ((d.scoring_breakdown as unknown) as Record<string, unknown>)?.semantic_similarity as number > 0).length} ms=${ms}`,
  );

  return capped;
}

  // Conversational Explanation Generator

function formatTemporalContext(decision: Decision): string | null {
  const scope = (decision as Decision & { temporal_scope?: string }).temporal_scope ?? 'permanent';
  const validFrom = (decision as Decision & { valid_from?: string }).valid_from;

  if (scope === 'permanent' && validFrom) {
    const date = new Date(validFrom);
    const month = date.toLocaleString('en-US', { month: 'long' });
    const year = date.getFullYear();
    return `Active since ${month} ${year}`;
  }

  if ((scope === 'sprint' || scope === 'experiment') && validFrom) {
    const ageMs = Date.now() - new Date(validFrom).getTime();
    const ageDays = Math.floor(ageMs / 86400000);
    return `Active for ${ageDays} day${ageDays !== 1 ? 's' : ''} (${scope}-scoped)`;
  }

  return null;
}

function generateExplanation(
  _agentName: string,
  decision: { made_by?: string; confidence?: string; title?: string },
  signals: {
    directAffect: number;
    matchedTags: string[];
    semanticScore: number;
    freshnessMultiplier: number;
    keywordScore: number;
  },
  taskDescription?: string,
): string {
  // Build a concise, task-specific explanation (1 sentence max)
  const tagFragment = signals.matchedTags.length > 0
    ? signals.matchedTags.slice(0, 3).join(', ')
    : '';

  // Extract a short task phrase from the task description
  const taskPhrase = taskDescription
    ? taskDescription.length > 60 ? taskDescription.slice(0, 57) + '...' : taskDescription
    : '';

  // Semantic match — closely related to the task
  if (signals.semanticScore > 0.3 && taskPhrase) {
    if (tagFragment) {
      return `Directly relevant to ${taskPhrase} \u2014 covers ${tagFragment}.`;
    }
    return `Closely related to ${taskPhrase}.`;
  }

  // Strong tag match with task context
  if (tagFragment && taskPhrase) {
    return `Relevant to ${taskPhrase} \u2014 covers ${tagFragment}.`;
  }

  // Tag match without task context
  if (tagFragment) {
    return `Covers ${tagFragment}.`;
  }

  // Semantic match without tags
  if (signals.semanticScore > 0.15 && taskPhrase) {
    return `Related to ${taskPhrase}.`;
  }

  // Attribution as context
  if (decision.made_by) {
    return `Cross-team context from ${decision.made_by}${taskPhrase ? ` \u2014 may affect ${taskPhrase}` : ''}.`;
  }

  return 'General project context.';
}

export function scoreDecision(
  decision: Decision,
  agent: Agent,
  taskEmbedding: number[],
  domainContext?: { taskDomain?: DecisionDomain | null; agentDomain?: DecisionDomain | null },
  taskDescription?: string,
): ScoredDecision {
  const profile = agent.relevance_profile;
  const agentNameLower = agent.name.toLowerCase();
  const agentRoleLower = agent.role.toLowerCase();
  const decisionTags = (decision.tags ?? []).map((t) => t.toLowerCase());
  const affects = (decision.affects ?? []).map((a) => a.toLowerCase());

    // Signal A: Direct Affect (0 or 1)
  // Check agent name, role, AND known aliases (e.g. 'pm' for 'makspm')
  const agentAliases = new Set([agentNameLower, agentRoleLower]);
  // Add common aliases
  if (agentNameLower === 'makspm') { agentAliases.add('pm'); agentAliases.add('maks_pm'); }
  if (agentNameLower === 'maks') { agentAliases.add('builder'); }
  const directAffectScore =
    affects.some((a) => agentAliases.has(a)) ? 1.0 : 0.0;

    // Signal B: Tag Matching (overlap with profile weights)
  const profileWeights = profile.weights;
  let tagMatchScore = 0;
  if (decisionTags.length > 0 && Object.keys(profileWeights).length > 0) {
    const matchingTags = decisionTags.filter((tag) => profileWeights[tag] !== undefined);
    if (matchingTags.length > 0) {
      const sumWeights = matchingTags.reduce((sum, tag) => sum + (profileWeights[tag] ?? 0.5), 0);
      tagMatchScore = sumWeights / decisionTags.length;
    }
  }

    // Signal C: Persona Match (primaryTags overlap - excludeTags penalty + wing affinity)
  const persona = _getPersonaSafe(agent.name);
  if (!persona) {
    console.warn(`[hipp0/scoring] No persona found for agent: "${agent.name}" — persona match signal will be 0`);
  }
  let personaMatchScore = 0;
  let excludePenalty = 0;
  let wingAffinityBoost = 0;
  if (persona && decisionTags.length > 0) {
    // Positive: overlap with primaryTags
    const primaryOverlap = persona.primaryTags.filter((t) => decisionTags.includes(t)).length;
    personaMatchScore = persona.primaryTags.length > 0
      ? (primaryOverlap / persona.primaryTags.length) * (persona.boostFactor / 0.20)
      : 0;
    // Negative: excludeTags penalty (-0.10 per match, capped at -0.20)
    const excludeHits = persona.excludeTags.filter((t) => decisionTags.includes(t)).length;
    excludePenalty = Math.min(excludeHits * 0.10, 0.20);
  }

  // Wing affinity sub-signal within personaMatch
  // If agent has learned affinity for the decision's wing, boost/penalize
  const decisionWing = decision.wing ?? decision.made_by;
  if (decisionWing && agent.wing_affinity) {
    const affinityScore = (agent.wing_affinity.cross_wing_weights ?? {})[decisionWing] ?? 0.5;
    if (affinityScore >= 0.3) {
      // Boost: affinity * 0.125 (max +0.125 at affinity=1.0)
      wingAffinityBoost = affinityScore * 0.125;
    } else {
      // Penalty: mild -0.05 when affinity is below 0.3
      wingAffinityBoost = -0.05;
    }
    personaMatchScore += wingAffinityBoost;
    personaMatchScore = Math.max(0, personaMatchScore);
  }

    // Signal D: Semantic Similarity
  // Ensure embedding is number[] (pgvector may return string from DB)
  let decisionEmbedding: number[] = [];
  const rawEmb = decision.embedding as unknown;
  if (Array.isArray(rawEmb) && rawEmb.length > 0 && typeof rawEmb[0] === 'number') {
    decisionEmbedding = rawEmb;
  } else if (typeof rawEmb === 'string' && String(rawEmb).startsWith('[')) {
    try { decisionEmbedding = JSON.parse(rawEmb); } catch { /* invalid */ }
  }

  const semanticScore =
    decisionEmbedding.length > 0 && taskEmbedding.length > 0
      ? Math.max(0, cosineSimilarity(taskEmbedding, decisionEmbedding))
      : 0;

    // Signal E: Keyword Matching (title + description substring match)
  // Critical for agents like makspm and counsel where tag overlap is weak
  // but decision titles contain PM/legal language.
  let keywordScore = 0;
  if (persona && (persona.keywords ?? []).length > 0) {
    const titleLower = (decision.title ?? '').toLowerCase();
    const descLower = (decision.description ?? '').toLowerCase();
    const keywordHits = persona.keywords.filter((kw) =>
      titleLower.includes(kw.toLowerCase()) ||
      descLower.includes(kw.toLowerCase()),
    ).length;
    keywordScore = Math.min(keywordHits * 0.08, 0.20); // cap at 0.20
  }

    // Made-by bonus
  const madeByBonus = (decision.made_by ?? '').toLowerCase() === agentNameLower ? 0.15 : 0;

    // Signal E: Tier-aware freshness (exponential decay)
  const ageInDays = (Date.now() - new Date(decision.created_at).getTime()) / 86400000;
  const temporalTier = (decision as Decision & { temporal_tier?: string }).temporal_tier ?? 'permanent';
  let freshnessScore: number;
  if (!FRESHNESS_ENABLED) {
    freshnessScore = 1.0; // Disabled — everything is fully fresh
  } else {
    const lambda = TIER_DECAY_LAMBDA[temporalTier] ?? TIER_DECAY_LAMBDA.permanent!;
    freshnessScore = Math.max(FRESHNESS_FLOOR, Math.exp(-lambda * ageInDays));
  }

    // Weighted sum (5 signals)
  let finalScore =
    SCORING_WEIGHTS.directAffect * directAffectScore +
    SCORING_WEIGHTS.tagMatch * tagMatchScore +
    SCORING_WEIGHTS.personaMatch * personaMatchScore +
    SCORING_WEIGHTS.semanticSimilarity * semanticScore +
    SCORING_WEIGHTS.freshness * freshnessScore +
    keywordScore +
    madeByBonus -
    excludePenalty;

    // Specificity Multiplier
  // Penalize generic decisions that affect everyone
  const affectsLen = (decision.affects ?? []).length;
  const specificityMultiplier =
    affectsLen <= 1 ? 1.15 :  // Very targeted
    affectsLen <= 3 ? 1.00 :  // Normal
    affectsLen <= 5 ? 0.85 :  // Broad
    0.70;                     // Generic — affects everyone
  finalScore *= specificityMultiplier;

    // Status Multiplier
  if (decision.status === 'superseded') finalScore *= 0.4;
  if (decision.status === 'pending') finalScore *= 0.6;

    // Confidence Multiplier
  const confidenceMultiplier =
    decision.confidence === 'high' ? 1.15 :
    decision.confidence === 'medium' ? 1.00 :
    0.88;
  finalScore *= confidenceMultiplier;

    // Direct agent match bonus (flat add after multipliers)
  if (affects.some((a) => agentAliases.has(a))) finalScore += 0.25;

    // Domain-aware scoring boost
  let domainBoost = 0;
  const decisionDomain = (decision as Decision & { domain?: string }).domain;
  if (decisionDomain && domainContext) {
    if (domainContext.taskDomain && decisionDomain === domainContext.taskDomain) {
      domainBoost += 0.12;
    }
    if (domainContext.agentDomain && decisionDomain === domainContext.agentDomain) {
      domainBoost += 0.08;
    }
    domainBoost = Math.min(domainBoost, 0.15); // cap total domain boost
  }
  finalScore += domainBoost;

  // Trust multiplier: low-trust decisions penalized (0.70x), high-trust boosted (1.15x)
  const trustMult = trustMultiplier(decision.trust_score);
  finalScore *= trustMult;

  // Outcome multiplier: decisions with strong track records get modest boost (0.85 to 1.10)
  const outcomeMult = outcomeMultiplier(
    (decision as Decision & { outcome_success_rate?: number | null }).outcome_success_rate,
    (decision as Decision & { outcome_count?: number }).outcome_count,
  );
  finalScore *= outcomeMult;

  // Staleness multiplier: tier-aware gradual ramp (permanent tier NEVER stale)
  let stalenessMultiplier = 1.0;
  if (STALENESS_ENABLED && temporalTier !== 'permanent') {
    const lastReferenced = (decision as Decision & { last_referenced_at?: string | Date | null }).last_referenced_at;
    const refDate = lastReferenced ? new Date(lastReferenced as string).getTime() : new Date(decision.created_at).getTime();
    const daysUnreferenced = (Date.now() - refDate) / 86400000;
    const stalenessConfig = STALENESS_CONFIG[temporalTier];
    if (stalenessConfig && daysUnreferenced > stalenessConfig.threshold) {
      const overage = daysUnreferenced - stalenessConfig.threshold;
      const penalty = Math.min(stalenessConfig.maxPenalty, (overage / 30) * stalenessConfig.maxPenalty);
      stalenessMultiplier = 1.0 - penalty;
    }
  }
  finalScore *= stalenessMultiplier;

  // Normalize to [0, 1.0] — no score exceeds 1.0
  finalScore = Math.max(0, Math.min(1.0, finalScore));

    // Build human-readable explanation
  // Collect matched tags (union of profile weight matches + persona primaryTag matches)
  const profileMatchedTags = decisionTags.filter((t) => profileWeights[t] !== undefined);
  const personaMatchedTags = persona ? persona.primaryTags.filter((t) => decisionTags.includes(t)) : [];
  const allMatchedTags = [...new Set([...profileMatchedTags, ...personaMatchedTags])];

  const explanation = generateExplanation(
    agent.name,
    { made_by: decision.made_by, confidence: decision.confidence, title: decision.title },
    {
      directAffect: directAffectScore,
      matchedTags: allMatchedTags,
      semanticScore,
      freshnessMultiplier: freshnessScore,
      keywordScore,
    },
    taskDescription,
  );

  const statusPenaltyVal = decision.status === 'superseded' ? 0.4 : decision.status === 'pending' ? 0.6 : 1.0;

  const breakdown: ScoringBreakdown = {
    direct_affect: directAffectScore,
    tag_matching: tagMatchScore,
    role_relevance: personaMatchScore,
    semantic_similarity: semanticScore,
    status_penalty: statusPenaltyVal,
    freshness: freshnessScore,
    combined: finalScore,
    // V4 extended signals
    keyword_score: keywordScore,
    made_by_bonus: madeByBonus,
    confidence_multiplier: confidenceMultiplier,
    specificity_multiplier: specificityMultiplier,
    freshness_multiplier: freshnessScore,
    staleness_multiplier: stalenessMultiplier,
    exclude_penalty: excludePenalty,
    domain_boost: domainBoost,
    wing_affinity_boost: wingAffinityBoost,
    trust_multiplier: trustMult,
    outcome_multiplier: outcomeMult,
    explanation,
  } as ScoringBreakdown;

  return {
    ...decision,
    relevance_score: SCORING_WEIGHTS.directAffect * directAffectScore + SCORING_WEIGHTS.tagMatch * tagMatchScore + SCORING_WEIGHTS.personaMatch * personaMatchScore + SCORING_WEIGHTS.semanticSimilarity * semanticScore,
    freshness_score: freshnessScore,
    combined_score: finalScore,
    scoring_breakdown: breakdown,
  };
}

// --- Cache helpers ---

function buildTaskHash(agentId: string, taskDescription: string): string {
  return crypto.createHash('sha256').update(`${agentId}::${taskDescription}`).digest('hex');
}

interface CacheRow {
  id: string;
  compiled_context: unknown;
  expires_at: Date;
  decision_ids_included: string[];
  artifact_ids_included: string[];
  token_count: number;
}

async function readCache(agentId: string, taskHash: string): Promise<ContextPackage | null> {
  const db = getDb();
  const result = await db.query<Record<string, unknown>>(
    `SELECT id, compiled_context, expires_at, decision_ids_included, artifact_ids_included, token_count
       FROM context_cache
      WHERE agent_id = ? AND task_hash = ? AND expires_at > ${db.dialect === 'sqlite' ? "datetime('now')" : 'NOW()'}
      LIMIT 1`,
    [agentId, taskHash],
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0] as unknown as CacheRow;
  return row.compiled_context as ContextPackage;
}

async function writeCache(
  agentId: string,
  taskHash: string,
  pkg: ContextPackage,
  decisionIds: string[],
  artifactIds: string[],
): Promise<void> {
  const db = getDb();
  const now = db.dialect === 'sqlite' ? "datetime('now')" : 'NOW()';
  const expiry = db.dialect === 'sqlite' ? "datetime('now', '+1 hour')" : "NOW() + INTERVAL '1 hour'";
  await db.query(
    `INSERT INTO context_cache
       (id, agent_id, task_hash, compiled_context, decision_ids_included, artifact_ids_included, token_count, compiled_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ${now}, ${expiry})
     ON CONFLICT (agent_id, task_hash) DO UPDATE
       SET compiled_context = EXCLUDED.compiled_context,
           decision_ids_included = EXCLUDED.decision_ids_included,
           artifact_ids_included = EXCLUDED.artifact_ids_included,
           token_count = EXCLUDED.token_count,
           compiled_at = ${now},
           expires_at = ${expiry}`,
    [crypto.randomUUID(), agentId, taskHash, JSON.stringify(pkg), db.arrayParam(decisionIds), db.arrayParam(artifactIds), pkg.token_count],
  );
}

// --- Token budget packing ---

/** Rough token estimate: chars / 4 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function packItems<T>(
  items: T[],
  scorer: (item: T) => number,
  tokenizer: (item: T) => number,
  budget: number,
): T[] {
  const sorted = [...items].sort((a, b) => scorer(b) - scorer(a));
  const packed: T[] = [];
  let used = 0;
  for (const item of sorted) {
    const t = tokenizer(item);
    if (used + t <= budget) {
      packed.push(item);
      used += t;
    }
  }
  return packed;
}

// --- Graph expansion — fetch neighbors via decision_edges ---

interface ExpandedDecision {
  decision: Decision;
  parentScore: number;
  depth: number;
}

async function expandGraphContext(
  topDecisions: ScoredDecision[],
  maxDepth: number,
  allDecisionMap: Map<string, Decision>,
): Promise<ExpandedDecision[]> {
  const db = getDb();
  const visited = new Set<string>(topDecisions.map((d) => d.id));
  const expansions: ExpandedDecision[] = [];

  // BFS queue: [decisionId, parentScore, depth]
  const queue: Array<{ id: string; parentScore: number; depth: number }> = topDecisions.map(
    (d) => ({ id: d.id, parentScore: d.combined_score, depth: 1 }),
  );

  while (queue.length > 0) {
    const item = queue.shift();
    if (!item) break;
    const { id, parentScore, depth } = item;
    if (depth > maxDepth) continue;

    const edgeResult = await db.query<Record<string, unknown>>(
      `SELECT DISTINCT
         CASE WHEN source_id = ? THEN target_id ELSE source_id END AS neighbor_id
       FROM decision_edges
      WHERE source_id = ? OR target_id = ?`,
      [id, id, id],
    );

    for (const row of edgeResult.rows) {
      const neighborId = row['neighbor_id'] as string;
      if (visited.has(neighborId)) continue;
      visited.add(neighborId);

      const neighbor = allDecisionMap.get(neighborId);
      if (!neighbor) continue;

      const decayedScore = parentScore * Math.pow(0.6, depth);
      expansions.push({ decision: neighbor, parentScore: decayedScore, depth });

      if (depth < maxDepth) {
        queue.push({ id: neighborId, parentScore: decayedScore, depth: depth + 1 });
      }
    }
  }

  return expansions;
}

// --- Markdown + JSON formatters ---

function formatTemporalFlags(d: ScoredDecision): string {
  const flags: string[] = [];
  if (d.open_questions.length > 0) {
    flags.push(`⚠️ Open questions: ${d.open_questions.join('; ')}`);
  }
  if (d.assumptions.length > 0) {
    flags.push(`🔷 Assumptions: ${d.assumptions.join('; ')}`);
  }
  return flags.length > 0 ? `\n${flags.join('\n')}` : '';
}

function formatMarkdown(
  agent: Agent,
  request: CompileRequest,
  compiledAt: string,
  decisions: ScoredDecision[],
  artifacts: ScoredArtifact[],
  notifications: Notification[],
  sessions: SessionSummary[],
  totalTokens: number,
): string {
  const lines: string[] = [];

  lines.push(`# Context for ${agent.name} (${agent.role})`);
  lines.push(`## Task: ${request.task_description}`);
  lines.push(`*Compiled at ${compiledAt} | ${decisions.length} decisions | ${totalTokens} tokens*`);
  lines.push('');

  lines.push('## 🔔 Notifications');
  if (notifications.length === 0) {
    lines.push('_No unread notifications._');
  } else {
    for (const n of notifications) {
      const urgencyBadge = n.urgency === 'critical' || n.urgency === 'high' ? '🔴' : '🟡';
      lines.push(`- ${urgencyBadge} **[${n.notification_type}]** ${n.message}`);
      if (n.role_context) {
        lines.push(`  _${n.role_context}_`);
      }
    }
  }
  lines.push('');

  lines.push('## 📋 Active Decisions');
  if (decisions.length === 0) {
    lines.push('_No relevant decisions found._');
  } else {
    for (const d of decisions) {
      lines.push(`### ${d.title} (score: ${d.combined_score.toFixed(2)})`);
      lines.push(
        `**Status:** ${d.status} | **Confidence:** ${d.confidence} | **By:** ${d.made_by}`,
      );
      lines.push(`**Description:** ${d.description}`);
      lines.push(`**Reasoning:** ${d.reasoning}`);
      if (d.tags.length > 0) {
        lines.push(`**Tags:** ${d.tags.join(', ')}`);
      }
      if (d.affects.length > 0) {
        lines.push(`**Affects:** ${d.affects.join(', ')}`);
      }
      if (d.dependencies.length > 0) {
        lines.push(`**Dependencies:** ${d.dependencies.join(', ')}`);
      }
      const temporalFlags = formatTemporalFlags(d);
      if (temporalFlags) {
        lines.push(temporalFlags);
      }
      lines.push('');
    }
  }

  lines.push('## 📦 Artifacts');
  if (artifacts.length === 0) {
    lines.push('_No relevant artifacts found._');
  } else {
    for (const a of artifacts) {
      lines.push(`### ${a.name} (${a.artifact_type}) — relevance: ${a.relevance_score.toFixed(2)}`);
      if (a.description) lines.push(`**Description:** ${a.description}`);
      if (a.content_summary) lines.push(`**Summary:** ${a.content_summary}`);
      if (a.path) lines.push(`**Path:** \`${a.path}\``);
      lines.push(`**Produced by:** ${a.produced_by}`);
      lines.push('');
    }
  }

  lines.push('## 📝 Recent Sessions');
  if (sessions.length === 0) {
    lines.push('_No recent sessions found._');
  } else {
    for (const s of sessions) {
      lines.push(`### ${s.topic} — ${s.session_date}`);
      lines.push(`**Agent:** ${s.agent_name}`);
      lines.push(s.summary);
      if (s.lessons_learned.length > 0) {
        lines.push(`**Lessons:** ${s.lessons_learned.join('; ')}`);
      }
      if (s.open_questions.length > 0) {
        lines.push(`**Open questions:** ${s.open_questions.join('; ')}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

// --- Audit log helper ---

async function writeAuditLog(
  agentId: string,
  projectId: string,
  details: Record<string, unknown>,
): Promise<void> {
  const db = getDb();
  await db.query(
    `INSERT INTO audit_log (id, event_type, agent_id, project_id, details)
     VALUES (?, ?, ?, ?, ?)`,
    [crypto.randomUUID(), 'context_compiled', agentId, projectId, JSON.stringify(details)],
  );
}

/**
 * Compile a rich context package for an agent performing a specific task.
 * Implements the full 5-signal scoring pipeline with graph expansion,
 * cache, token budget packing, and dual-format output.
 */
export async function compileContext(request: CompileRequest): Promise<ContextPackage> {
  const db = getDb();
  const startMs = Date.now();
  const compiledAt = new Date().toISOString();

  const { agent_name, project_id, task_description, session_lookback_days = 7 } = request;

  // Agent lookup — try exact name first, then known aliases
  const AGENT_ALIASES: Record<string, string[]> = {
    makspm: ['pm', 'maks_pm', 'maks-pm', 'MaksPM'],
    maks: ['builder'],
  };

  let agentResult = await db.query<Record<string, unknown>>(
    `SELECT * FROM agents WHERE project_id = ? AND name = ? LIMIT 1`,
    [project_id, agent_name],
  );

  // If not found, try aliases
  if (agentResult.rows.length === 0) {
    const aliases = AGENT_ALIASES[agent_name.toLowerCase()] ?? [];
    for (const alias of aliases) {
      agentResult = await db.query<Record<string, unknown>>(
        `SELECT * FROM agents WHERE project_id = ? AND LOWER(name) = LOWER(?) LIMIT 1`,
        [project_id, alias],
      );
      if (agentResult.rows.length > 0) {
        console.warn(`[hipp0/compile] Agent "${agent_name}" not found, matched alias "${alias}"`);
        break;
      }
    }
  }

  // Also try case-insensitive match as last resort
  if (agentResult.rows.length === 0) {
    agentResult = await db.query<Record<string, unknown>>(
      `SELECT * FROM agents WHERE project_id = ? AND LOWER(name) = LOWER(?) LIMIT 1`,
      [project_id, agent_name],
    );
  }

  // Auto-create agent if not found after all lookups
  if (agentResult.rows.length === 0) {
    console.warn(`[hipp0/compile] Agent "${agent_name}" not found in project ${project_id.slice(0, 8)}.. — auto-creating`);
    const newAgent = await db.query(
      `INSERT INTO agents (id, project_id, name, role, relevance_profile, context_budget_tokens)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING *`,
      [
        crypto.randomUUID(),
        project_id,
        agent_name,
        agent_name, // role defaults to agent name
        JSON.stringify({ weights: {}, decision_depth: 2, freshness_preference: 'balanced', include_superseded: false }),
        50000,
      ],
    );
    agentResult = newAgent;
  }
  const agent = parseAgent(agentResult.rows[0]!);
  const tokenBudget = request.max_tokens ?? agent.context_budget_tokens;

  const taskHash = buildTaskHash(agent.id, task_description);
  const cached = await readCache(agent.id, taskHash);
  if (cached) {
    // Return cached data directly — it was already finalized before caching.
    // Do NOT re-run finalizeResults, which would double-normalize scores
    // and potentially filter out decisions that originally passed MIN_SCORE.
    const cachedDecisions = (cached.decisions ?? []) as ScoredDecision[];
    console.warn(`[hipp0/compile] agent=${agent_name} CACHE HIT decisions=${cachedDecisions.length} ms=${Date.now() - startMs}`);
    return { ...cached, decisions: cachedDecisions, decisions_included: cachedDecisions.length };
  }

    // Layered context loading
  // L0: priority_level=0, always loaded (max 5)
  // L1: priority_level=1 or NULL, scored normally (default)
  // L2: priority_level=2, only loaded when depth=full
  const includeL2 = request.depth === 'full';
  const includeSuperseded = agent.relevance_profile.include_superseded || request.include_superseded;
  const statusFilter = !includeSuperseded ? ` AND status != 'superseded'` : '';
  // Temporal filter: exclude expired/deprecated decisions unless include_superseded
  const temporalFilter = !includeSuperseded
    ? ` AND (valid_until IS NULL OR valid_until > ${db.dialect === 'sqlite' ? "datetime('now')" : 'NOW()'}) AND (temporal_scope IS NULL OR temporal_scope != 'deprecated')`
    : '';

  // Namespace filter: when set, include matching namespace + global (NULL) decisions
  let namespaceFilter = '';
  const namespaceParams: unknown[] = [];
  if (request.namespace) {
    const namespaces = request.namespace.split(',').map((ns) => ns.trim()).filter(Boolean);
    if (namespaces.length > 0) {
      const placeholders = namespaces.map(() => '?').join(', ');
      namespaceFilter = ` AND (namespace IS NULL OR namespace IN (${placeholders}))`;
      namespaceParams.push(...namespaces);
    }
  }

  // Fetch L0 (critical) decisions — always included
  const l0Result = await db.query<Record<string, unknown>>(
    `SELECT * FROM decisions WHERE project_id = ? AND priority_level = 0${statusFilter}${temporalFilter}${namespaceFilter} ORDER BY created_at DESC LIMIT 5`,
    [project_id, ...namespaceParams],
  );
  const l0Decisions = l0Result.rows.map(parseDecision);

  // Fetch L1 (standard) decisions
  const l1Result = await db.query<Record<string, unknown>>(
    `SELECT * FROM decisions WHERE project_id = ? AND (priority_level = 1 OR priority_level IS NULL)${statusFilter}${temporalFilter}${namespaceFilter} ORDER BY created_at DESC`,
    [project_id, ...namespaceParams],
  );
  const l1Decisions = l1Result.rows.map(parseDecision);

  // Fetch L2 count (or full results if depth=full)
  let l2Decisions: Decision[] = [];
  let l2Available = 0;
  if (includeL2) {
    const l2Result = await db.query<Record<string, unknown>>(
      `SELECT * FROM decisions WHERE project_id = ? AND priority_level = 2${statusFilter}${temporalFilter}${namespaceFilter} ORDER BY created_at DESC`,
      [project_id, ...namespaceParams],
    );
    l2Decisions = l2Result.rows.map(parseDecision);
    l2Available = l2Decisions.length;
  } else {
    const l2CountResult = await db.query<Record<string, unknown>>(
      `SELECT COUNT(*) as count FROM decisions WHERE project_id = ? AND priority_level = 2${statusFilter}${temporalFilter}${namespaceFilter}`,
      [project_id, ...namespaceParams],
    );
    l2Available = parseInt(String((l2CountResult.rows[0] as Record<string, unknown>)?.count ?? '0'), 10);
  }

  // Combine all decisions for scoring
  const l0Ids = new Set(l0Decisions.map((d) => d.id));
  const allDecisions = [...l0Decisions, ...l1Decisions.filter((d) => !l0Ids.has(d.id)), ...l2Decisions.filter((d) => !l0Ids.has(d.id))];

  const allDecisionMap = new Map<string, Decision>(allDecisions.map((d) => [d.id, d]));

  const generateEmbedding = await getEmbeddingFn();
  let taskEmbedding: number[];
  try {
    taskEmbedding = await generateEmbedding(task_description);
  } catch (err) {
    // Graceful degradation: if embedding generation fails (API down, rate limit,
    // network error), continue scoring without semantic similarity rather than
    // crashing the entire compile request.
    console.warn(`[hipp0/compile] Embedding generation failed for agent=${agent_name} — falling back to non-semantic scoring:`, (err as Error).message);
    taskEmbedding = [...ZERO_VECTOR];
  }

  // Infer domain from task for domain-aware scoring boost
  const taskDomain = inferDomainFromTask(task_description);
  const persona = _getPersonaSafe(agent_name);
  // Infer agent's primary domain from persona primaryTags
  const agentDomain = persona ? inferDomainFromTask(persona.primaryTags.join(' ')) : null;
  const domainContext = { taskDomain, agentDomain };

  const scored = allDecisions.map((d) => {
    const sd = scoreDecision(d, agent, taskEmbedding, domainContext, task_description);
    // Tag loading layer
    if (l0Ids.has(d.id)) {
      sd.loading_layer = 'L0';
    } else if (d.priority_level === 2) {
      sd.loading_layer = 'L2';
    } else {
      sd.loading_layer = 'L1';
    }
    return sd;
  });

    // Wing-aware affinity boost
  // Orchestrator agents (role "orchestrator") see all wings equally — no bias.
  const isOrchestrator = agent.role.toLowerCase() === 'orchestrator';
  if (!isOrchestrator) {
    const wingAffinity: WingAffinity = agent.wing_affinity ?? { cross_wing_weights: {}, last_recalculated: '', feedback_count: 0 };
    const crossWingWeights = wingAffinity.cross_wing_weights ?? {};
    for (const sd of scored) {
      const decisionWing = sd.wing ?? sd.made_by;
      if (decisionWing === agent_name || decisionWing === agent.name) {
        // Own-wing: +0.10 flat boost
        sd.combined_score = Math.min(1.0, sd.combined_score + 0.10);
      } else {
        const affinityWeight = crossWingWeights[decisionWing] ?? 0;
        if (affinityWeight >= 0.5) {
          // High-affinity wing: boost of (affinity * 0.08)
          sd.combined_score = Math.min(1.0, sd.combined_score + affinityWeight * 0.08);
        }
        // Other wings: standard scoring (no boost or penalty)
      }
    }
  }

  const depth = agent.relevance_profile.decision_depth;

  // L0 decisions always pass regardless of score
  const l0Scored = scored.filter((d) => d.loading_layer === 'L0');
  const nonL0Scored = scored.filter((d) => d.loading_layer !== 'L0');

  // Apply minimum score threshold and max results cap (L1/L2 only)
  const effectiveMinScore = request.min_score ?? MIN_SCORE;
  const qualifiedDecisions = [
    ...l0Scored, // L0 always included
    ...nonL0Scored.filter((d) => d.combined_score >= effectiveMinScore),
  ]
    .sort((a, b) => b.combined_score - a.combined_score)
    .slice(0, MAX_RESULTS);

  // Take top-N scored decisions as seeds (configurable via decision_depth)
  const topN = Math.max(25, depth * 5);
  const topDecisions = qualifiedDecisions.slice(0, topN);

  const expanded = await expandGraphContext(topDecisions, depth, allDecisionMap);

  const scoredIds = new Set(scored.map((d) => d.id));
  const expandedScored: ScoredDecision[] = expanded
    .filter((e) => !scoredIds.has(e.decision.id))
    .map((e) => {
      const base = scoreDecision(e.decision, agent, taskEmbedding, undefined, task_description);
      const decayed: ScoredDecision = {
        ...base,
        combined_score: e.parentScore,
        relevance_score: e.parentScore,
        scoring_breakdown: { ...base.scoring_breakdown, combined: e.parentScore },
      };
      return decayed;
    });

  const allScored = [...scored, ...expandedScored];

  const artifactResult = await db.query<Record<string, unknown>>(
    `SELECT * FROM artifacts WHERE project_id = ? ORDER BY created_at DESC`,
    [project_id],
  );
  const allArtifacts = artifactResult.rows.map(parseArtifact);

  const decisionScoreMap = new Map<string, number>(allScored.map((d) => [d.id, d.combined_score]));

  const scoredArtifacts: ScoredArtifact[] = allArtifacts.map((a) => {
    const relatedScores = a.related_decision_ids
      .map((id) => decisionScoreMap.get(id) ?? 0)
      .filter((s) => s > 0);
    const relevance_score =
      relatedScores.length > 0
        ? relatedScores.reduce((sum, s) => sum + s, 0) / relatedScores.length
        : 0;
    return { ...a, relevance_score };
  });

  const notifResult = await db.query<Record<string, unknown>>(
    `SELECT * FROM notifications
      WHERE agent_id = ? AND read_at IS NULL
      ORDER BY created_at DESC`,
    [agent.id],
  );
  const notifications = notifResult.rows.map(parseNotification);

  const sessionResult = await db.query<Record<string, unknown>>(
    db.dialect === 'sqlite'
      ? `SELECT * FROM session_summaries
          WHERE project_id = ?
            AND created_at >= datetime('now', '-' || ? || ' days')
          ORDER BY created_at DESC`
      : `SELECT * FROM session_summaries
          WHERE project_id = ?
            AND created_at >= NOW() - INTERVAL '1 day' * ?
          ORDER BY created_at DESC`,
    [project_id, session_lookback_days],
  );
  const sessions = sessionResult.rows.map(parseSession);

  // Token budget allocation: Notifications 10%, Decisions 55%, Artifacts 30%, Sessions remainder
  const notifBudget = Math.floor(tokenBudget * 0.1);
  const decisionBudget = Math.floor(tokenBudget * 0.55);
  const artifactBudget = Math.floor(tokenBudget * 0.3);

  const packedNotifications = packItems<Notification>(
    notifications,
    (n) =>
      n.urgency === 'critical' ? 4 : n.urgency === 'high' ? 3 : n.urgency === 'medium' ? 2 : 1,
    (n) => estimateTokens(n.message + (n.role_context ?? '')),
    notifBudget,
  );

  // SINGLE OUTPUT FUNNEL: filter + dedupe + sort + cap
  // Every code path goes through finalizeResults — no exceptions.
  // Log embedding / semantic health for this compile
  const semanticHits = allScored.filter((d) => ((d.scoring_breakdown as unknown) as Record<string, unknown>)?.semantic_similarity as number > 0).length;
  if (allScored.length > 0) {
    // One-time debug: log embedding types for first decision
    const first = allScored[0];
    const rawType = typeof first.embedding;
    const isArr = Array.isArray(first.embedding);
    const embLen = isArr ? (first.embedding as number[]).length : (typeof first.embedding === 'string' ? (first.embedding as string).length : 0);
    console.warn(`[hipp0/embeddings] first_decision_embedding: type=${rawType} isArray=${isArr} len=${embLen} semanticHits=${semanticHits}/${allScored.length}`);
  }
  const packedDecisions = finalizeResults(allScored, agent_name, project_id, startMs);

  // Update last_referenced_at + reference_count for included decisions
  if (packedDecisions.length > 0) {
    const includedIds = packedDecisions.map((d) => d.id);
    try {
      await db.query(
        `UPDATE decisions SET last_referenced_at = ${db.dialect === 'sqlite' ? "datetime('now')" : 'NOW()'}, reference_count = reference_count + 1 WHERE id = ANY(?)`,
        [db.arrayParam(includedIds)],
      );
    } catch (err) {
      console.warn('[hipp0/compile] Failed to update last_referenced_at:', (err as Error).message);
    }
  }

  if (packedDecisions.length === 0 && allScored.length > 0) {
    console.warn('[hipp0/compile] WARNING: finalizeResults returned 0 but allScored had', allScored.length, 'items for agent', agent_name);
    console.warn('[hipp0/compile] Top score:', allScored[0]?.combined_score, 'MIN_SCORE:', MIN_SCORE);
  }

  const packedArtifacts = packItems<ScoredArtifact>(
    scoredArtifacts,
    (a) => a.relevance_score,
    (a) => estimateTokens(a.name + (a.description ?? '') + (a.content_summary ?? '')),
    artifactBudget,
  );

  const usedSoFar =
    packedNotifications.reduce(
      (s, n) => s + estimateTokens(n.message + (n.role_context ?? '')),
      0,
    ) +
    packedDecisions.reduce((s, d) => s + estimateTokens(d.title + d.description + d.reasoning), 0) +
    packedArtifacts.reduce(
      (s, a) => s + estimateTokens(a.name + (a.description ?? '') + (a.content_summary ?? '')),
      0,
    );
  const sessionBudget = Math.max(0, tokenBudget - usedSoFar);

  const packedSessions = packItems<SessionSummary>(
    sessions,
    (_s) => 1, // equal priority — ordered by recency from query
    (s) => estimateTokens(s.topic + s.summary),
    sessionBudget,
  );

  const totalTokens =
    usedSoFar + packedSessions.reduce((s, ss) => s + estimateTokens(ss.topic + ss.summary), 0);

  const formatted_markdown = formatMarkdown(
    agent,
    request,
    compiledAt,
    packedDecisions,
    packedArtifacts,
    packedNotifications,
    packedSessions,
    totalTokens,
  );

  const formatted_json = JSON.stringify(
    {
      agent: { name: agent.name, role: agent.role },
      task: task_description,
      compiled_at: compiledAt,
      token_count: totalTokens,
      decisions: packedDecisions,
      artifacts: packedArtifacts,
      notifications: packedNotifications,
      recent_sessions: packedSessions,
    },
    null,
    2,
  );

    // Pattern Recommendations
  let suggestedPatterns: SuggestedPattern[] = [];
  const includePatterns = request.include_patterns !== false;
  if (includePatterns) {
    try {
      // Check project setting for pattern_recommendations
      const projResult = await db.query<Record<string, unknown>>(
        'SELECT metadata FROM projects WHERE id = ? LIMIT 1',
        [project_id],
      );
      let patternRecsEnabled = true;
      let minPatternConfidence = DEFAULT_MIN_PATTERN_CONFIDENCE;
      if (projResult.rows.length > 0) {
        const rawMeta = (projResult.rows[0] as Record<string, unknown>).metadata;
        const meta = typeof rawMeta === 'string' ? JSON.parse(rawMeta) : (rawMeta ?? {});
        if ((meta as Record<string, unknown>).pattern_recommendations === false) {
          patternRecsEnabled = false;
        }
        if (typeof (meta as Record<string, unknown>).min_pattern_confidence === 'number') {
          minPatternConfidence = (meta as Record<string, unknown>).min_pattern_confidence as number;
        }
      }

      if (patternRecsEnabled) {
        // Collect all tags from top decisions for matching
        const taskTags = [...new Set(packedDecisions.flatMap((d) => d.tags))];
        suggestedPatterns = await getPatternRecommendations(
          project_id,
          taskTags,
          task_description,
          minPatternConfidence,
        );
      }
    } catch (err) {
      console.warn('[hipp0/compile] Pattern recommendations failed:', (err as Error).message);
    }
  }

  const pkg: ContextPackage = {
    agent: { name: agent.name, role: agent.role },
    task: task_description,
    compiled_at: compiledAt,
    token_count: totalTokens,
    budget_used_pct: Math.min(100, Math.round((totalTokens / tokenBudget) * 100)),
    decisions: packedDecisions,
    artifacts: packedArtifacts,
    notifications: packedNotifications,
    recent_sessions: packedSessions,
    formatted_markdown,
    formatted_json,
    decisions_considered: allScored.length,
    decisions_included: packedDecisions.length,
    relevance_threshold_used: request.min_score ?? MIN_SCORE,
    compilation_time_ms: Date.now() - startMs,
    loading_layers: {
      l0_count: packedDecisions.filter((d) => d.loading_layer === 'L0').length,
      l1_count: packedDecisions.filter((d) => d.loading_layer === 'L1').length,
      l2_available: l2Available,
    },
    wing_sources: computeWingSources(packedDecisions, agent_name),
    suggested_patterns: suggestedPatterns,
  };

  const includedDecisionIds = packedDecisions.map((d) => d.id);
  const includedArtifactIds = packedArtifacts.map((a) => a.id);

  try {
    await writeCache(agent.id, taskHash, pkg, includedDecisionIds, includedArtifactIds);
  } catch (err) {
    // Cache write failures are non-fatal
    console.warn('[hipp0:context-compiler] Cache write failed:', (err as Error).message);
  }

  try {
    await writeAuditLog(agent.id, project_id, {
      agent_name,
      task_description,
      decisions_considered: allScored.length,
      decisions_included: packedDecisions.length,
      token_count: totalTokens,
      compilation_time_ms: pkg.compilation_time_ms,
    });
  } catch (err) {
    console.warn('[hipp0:context-compiler] Audit log write failed:', (err as Error).message);
  }

  return pkg;
}

// Re-export scoreDecision and cosineSimilarity for external use
export { Hipp0Error };

// Re-export compression utilities
export {
  condenseDecisions,
  condenseSessionHistory,
  condenseContradictions,
  condenseTeamScores,
  condenseRecommendedAction,
  condenseCompileResponse,
  computeCompressionMetrics,
  estimateTokens,
} from './compression.js';
export type { CondenseCompileInput } from './compression.js';
