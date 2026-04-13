import type {
  Decision,
  DecisionDomain,
  DecisionCategory,
  PriorityLevel,
  Agent,
  Project,
  Artifact,
  SessionSummary,
  Subscription,
  Notification,
  DecisionEdge,
  Contradiction,
  RelevanceFeedback,
  AuditEntry,
  ApiKey,
  RelevanceProfile,
  WingAffinity,
  DecisionOutcome,
} from '../types.js';

/**
 * Parse a pgvector embedding into number[].
 * pgvector can return: string "[0.02,0.08,...]", actual number[], or undefined.
 */
function parseEmbedding(raw: unknown): number[] | undefined {
  if (!raw) return undefined;
  if (Array.isArray(raw)) {
    return raw.length > 0 && typeof raw[0] === 'number' ? raw as number[] : undefined;
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'number') {
        return parsed as number[];
      }
    } catch { /* not valid JSON */ }
  }
  return undefined;
}

function parseJsonb<T>(val: unknown, fallback: T): T {
  if (val === null || val === undefined) return fallback;
  if (typeof val === 'string') {
    try {
      return JSON.parse(val) as T;
    } catch {
      return fallback;
    }
  }
  return val as T;
}

function parseArray(val: unknown): string[] {
  if (Array.isArray(val)) return val;
  if (typeof val === 'string' && val.startsWith('{')) {
    return val.slice(1, -1).split(',').filter(Boolean);
  }
  return [];
}

/**
 * Normalize a timestamp column to an ISO-8601 string regardless of which
 * driver materialized it. Postgres (node-postgres) returns ``Date``
 * instances, SQLite returns the stored text verbatim, and a fresh INSERT
 * RETURNING inside the same connection can return either depending on
 * adapter version. The parsers used to hard-cast ``(row.x as Date)`` and
 * crash with ``toISOString is not a function`` on SQLite — this helper
 * handles all three cases.
 */
function toIsoString(val: unknown): string {
  if (val instanceof Date) return val.toISOString();
  if (typeof val === 'string') return val;
  if (typeof val === 'number') return new Date(val).toISOString();
  return new Date().toISOString();
}

export function parseProject(row: Record<string, unknown>): Project {
  return {
    id: row.id as string,
    name: row.name as string,
    description: row.description as string | undefined,
    created_at: toIsoString(row.created_at),
    updated_at: toIsoString(row.updated_at),
    metadata: parseJsonb(row.metadata, {}),
  };
}

export function parseAgent(row: Record<string, unknown>): Agent {
  return {
    id: row.id as string,
    project_id: row.project_id as string,
    name: row.name as string,
    role: row.role as string,
    relevance_profile: parseJsonb<RelevanceProfile>(row.relevance_profile, {
      weights: {},
      decision_depth: 2,
      freshness_preference: 'balanced',
      include_superseded: false,
    }),
    context_budget_tokens: row.context_budget_tokens as number,
    wing_affinity: (() => {
      const raw = parseJsonb<Partial<WingAffinity>>(row.wing_affinity, {});
      return {
        cross_wing_weights: raw.cross_wing_weights ?? {},
        last_recalculated: raw.last_recalculated ?? new Date().toISOString(),
        feedback_count: raw.feedback_count ?? 0,
      };
    })(),
    primary_domain: (row.primary_domain as string | null) ?? null,
    created_at: toIsoString(row.created_at),
    updated_at: toIsoString(row.updated_at),
  };
}

export function parseDecision(row: Record<string, unknown>): Decision {
  return {
    id: row.id as string,
    project_id: row.project_id as string,
    title: row.title as string,
    description: row.description as string,
    reasoning: row.reasoning as string,
    made_by: row.made_by as string,
    source: row.source as Decision['source'],
    source_session_id: row.source_session_id as string | undefined,
    confidence: row.confidence as Decision['confidence'],
    status: row.status as Decision['status'],
    supersedes_id: row.supersedes_id as string | undefined,
    alternatives_considered: parseJsonb(row.alternatives_considered, []),
    affects: parseArray(row.affects),
    tags: parseArray(row.tags),
    assumptions: parseJsonb(row.assumptions, []),
    open_questions: parseJsonb(row.open_questions, []),
    dependencies: parseJsonb(row.dependencies, []),
    validated_at: row.validated_at ? toIsoString(row.validated_at) : undefined,
    validation_source: row.validation_source as string | undefined,
    confidence_decay_rate: (row.confidence_decay_rate as number) ?? 0,
    created_at: toIsoString(row.created_at),
    updated_at: toIsoString(row.updated_at),
    metadata: parseJsonb(row.metadata, {}),
    embedding: parseEmbedding(row.embedding),
    domain: (row.domain as DecisionDomain | null) ?? null,
    category: (row.category as DecisionCategory | null) ?? null,
    priority_level: ((row.priority_level as number) ?? 1) as PriorityLevel,
    wing: (row.wing as string | null) ?? null,
    valid_from: row.valid_from ? (row.valid_from instanceof Date ? (row.valid_from as Date).toISOString() : String(row.valid_from)) : undefined,
    valid_until: row.valid_until ? (row.valid_until instanceof Date ? (row.valid_until as Date).toISOString() : String(row.valid_until)) : null,
    superseded_by: (row.superseded_by as string | null) ?? null,
    temporal_scope: (row.temporal_scope as Decision['temporal_scope']) ?? 'permanent',
    namespace: (row.namespace as string | null) ?? null,
    provenance_chain: parseJsonb(row.provenance_chain, []),
    trust_score: row.trust_score != null ? Number(row.trust_score) : null,
    trust_components: parseJsonb(row.trust_components, null),
    outcome_success_rate: row.outcome_success_rate != null ? Number(row.outcome_success_rate) : null,
    outcome_count: Number(row.outcome_count ?? 0),
  };
}

export function parseDecisionOutcome(row: Record<string, unknown>): DecisionOutcome {
  return {
    id: row.id as string,
    decision_id: row.decision_id as string,
    project_id: row.project_id as string,
    agent_id: row.agent_id as string | undefined,
    compile_history_id: row.compile_history_id as string | undefined,
    task_session_id: row.task_session_id as string | undefined,
    outcome_type: row.outcome_type as DecisionOutcome['outcome_type'],
    outcome_score: Number(row.outcome_score ?? 0.5),
    reversal: Boolean(row.reversal),
    reversal_reason: row.reversal_reason as string | undefined,
    notes: row.notes as string | undefined,
    created_at: toIsoString(row.created_at),
    metadata: parseJsonb(row.metadata, {}),
  };
}

export function parseEdge(row: Record<string, unknown>): DecisionEdge {
  return {
    id: row.id as string,
    source_id: row.source_id as string,
    target_id: row.target_id as string,
    relationship: row.relationship as DecisionEdge['relationship'],
    description: row.description as string | undefined,
    strength: (row.strength as number) ?? 1.0,
    created_at: toIsoString(row.created_at),
  };
}

export function parseArtifact(row: Record<string, unknown>): Artifact {
  return {
    id: row.id as string,
    project_id: row.project_id as string,
    name: row.name as string,
    path: row.path as string | undefined,
    artifact_type: row.artifact_type as Artifact['artifact_type'],
    description: row.description as string | undefined,
    content_summary: row.content_summary as string | undefined,
    content_hash: row.content_hash as string | undefined,
    produced_by: row.produced_by as string,
    related_decision_ids: parseArray(row.related_decision_ids),
    created_at: toIsoString(row.created_at),
    updated_at: toIsoString(row.updated_at),
    metadata: parseJsonb(row.metadata, {}),
    embedding: parseEmbedding(row.embedding),
  };
}

export function parseSession(row: Record<string, unknown>): SessionSummary {
  return {
    id: row.id as string,
    project_id: row.project_id as string,
    agent_name: row.agent_name as string,
    session_date: String(row.session_date),
    topic: row.topic as string,
    summary: row.summary as string,
    decision_ids: parseArray(row.decision_ids),
    artifact_ids: parseArray(row.artifact_ids),
    assumptions: parseArray(row.assumptions),
    open_questions: parseArray(row.open_questions),
    lessons_learned: parseArray(row.lessons_learned),
    raw_conversation_hash: row.raw_conversation_hash as string | undefined,
    extraction_model: row.extraction_model as string | undefined,
    extraction_confidence: row.extraction_confidence as number | undefined,
    created_at: toIsoString(row.created_at),
    embedding: parseEmbedding(row.embedding),
  };
}

export function parseSubscription(row: Record<string, unknown>): Subscription {
  return {
    id: row.id as string,
    agent_id: row.agent_id as string,
    topic: row.topic as string,
    notify_on: parseArray(row.notify_on) as Subscription['notify_on'],
    priority: row.priority as Subscription['priority'],
    created_at: toIsoString(row.created_at),
  };
}

export function parseNotification(row: Record<string, unknown>): Notification {
  return {
    id: row.id as string,
    agent_id: row.agent_id as string,
    decision_id: row.decision_id as string | undefined,
    notification_type: row.notification_type as Notification['notification_type'],
    message: row.message as string,
    role_context: row.role_context as string | undefined,
    urgency: row.urgency as Notification['urgency'],
    read_at: row.read_at ? toIsoString(row.read_at) : undefined,
    created_at: toIsoString(row.created_at),
  };
}

export function parseContradiction(row: Record<string, unknown>): Contradiction {
  return {
    id: row.id as string,
    project_id: row.project_id as string,
    decision_a_id: row.decision_a_id as string,
    decision_b_id: row.decision_b_id as string,
    similarity_score: row.similarity_score as number,
    conflict_description: row.conflict_description as string | undefined,
    status: row.status as Contradiction['status'],
    resolved_by: row.resolved_by as string | undefined,
    resolution: row.resolution as string | undefined,
    detected_at: toIsoString(row.detected_at),
    resolved_at: row.resolved_at ? toIsoString(row.resolved_at) : undefined,
  };
}

export function parseFeedback(row: Record<string, unknown>): RelevanceFeedback {
  return {
    id: row.id as string,
    agent_id: row.agent_id as string,
    decision_id: row.decision_id as string,
    compile_request_id: row.compile_request_id as string | undefined,
    was_useful: row.was_useful as boolean,
    usage_signal: row.usage_signal as RelevanceFeedback['usage_signal'],
    created_at: toIsoString(row.created_at),
  };
}

export function parseAuditEntry(row: Record<string, unknown>): AuditEntry {
  return {
    id: row.id as string,
    event_type: row.event_type as string,
    agent_id: row.agent_id as string | undefined,
    project_id: row.project_id as string | undefined,
    decision_id: row.decision_id as string | undefined,
    details: parseJsonb(row.details, {}),
    created_at: toIsoString(row.created_at),
  };
}

export function parseApiKey(row: Record<string, unknown>): ApiKey {
  return {
    id: row.id as string,
    key_hash: row.key_hash as string,
    project_id: row.project_id as string,
    name: row.name as string,
    scopes: parseArray(row.scopes),
    last_used_at: row.last_used_at ? toIsoString(row.last_used_at) : undefined,
    created_at: toIsoString(row.created_at),
    revoked_at: row.revoked_at ? toIsoString(row.revoked_at) : undefined,
  };
}
