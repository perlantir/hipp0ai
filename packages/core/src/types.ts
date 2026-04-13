// --- Projects ---
export interface Project {
  id: string;
  name: string;
  description?: string;
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown>;
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

// --- Agents ---
export interface Agent {
  id: string;
  project_id: string;
  name: string;
  role: string;
  relevance_profile: RelevanceProfile;
  context_budget_tokens: number;
  wing_affinity?: WingAffinity;
  primary_domain?: string | null;
  created_at: string;
  updated_at: string;
}

// --- Wing Affinity ---
export interface WingAffinity {
  cross_wing_weights: Record<string, number>;
  last_recalculated: string;
  feedback_count: number;
}

export interface CreateAgentInput {
  project_id: string;
  name: string;
  role: string;
  relevance_profile?: RelevanceProfile;
  context_budget_tokens?: number;
}

export interface RelevanceProfile {
  weights: Record<string, number>;
  decision_depth: number;
  freshness_preference: FreshnessPreference;
  include_superseded: boolean;
}

export type FreshnessPreference = 'recent_first' | 'validated_first' | 'balanced';

// --- Provenance ---
export type ProvenanceSourceType = 'manual' | 'auto_distilled' | 'auto_capture' | 'imported' | 'github_pr' | 'github_commit' | 'transcript' | 'connector' | 'system_inferred';
export type ProvenanceActorType = 'human' | 'agent' | 'system';
export type ProvenanceMethod = 'direct_entry' | 'llm_extraction' | 'import_sync' | 'capture_pipeline' | 'review_approval' | 'manual_validation';
export type ProvenanceVerificationStatus = 'unverified' | 'pending_review' | 'validated' | 'disputed';

export interface ProvenanceRecord {
  source_type: ProvenanceSourceType;
  source_id?: string;
  source_label?: string;
  actor_type: ProvenanceActorType;
  actor_id?: string;
  method: ProvenanceMethod;
  timestamp: string;
  verification_status: ProvenanceVerificationStatus;
  evidence_refs?: string[];
  notes?: string;
}

export interface TrustComponents {
  source_weight: number;
  validation_weight: number;
  recency_weight: number;
  contradiction_penalty: number;
  confidence_weight: number;
}

// --- Decision Outcomes ---
export type OutcomeType = 'success' | 'failure' | 'regression' | 'partial' | 'reversed' | 'unknown';

export interface DecisionOutcome {
  id: string;
  decision_id: string;
  project_id: string;
  agent_id?: string;
  compile_history_id?: string;
  task_session_id?: string;
  outcome_type: OutcomeType;
  outcome_score: number;
  reversal: boolean;
  reversal_reason?: string;
  notes?: string;
  created_at: string;
  metadata?: Record<string, unknown>;
}

export interface OutcomeStats {
  decision_id: string;
  total_outcomes: number;
  success_rate: number;
  failure_rate: number;
  regression_rate: number;
  reversal_rate: number;
  avg_outcome_score: number;
  last_outcome_at?: string;
}

// --- Cross-Agent Learning ---
export interface AgentPerformanceStats {
  agent_id: string;
  agent_name: string;
  total_decisions: number;
  total_linked_outcomes: number;
  success_rate: number;
  failure_rate: number;
  regression_rate: number;
  reversal_rate: number;
  avg_outcome_score: number;
  trust_weighted_score: number;
  top_domains: string[];
  last_updated_at: string;
}

export interface CrossAgentSignal {
  source_agent: string;
  target_agent: string;
  signal_type: 'positive_transfer' | 'negative_transfer' | 'contradiction_risk' | 'domain_strength';
  sample_size: number;
  score: number;
  confidence: number;
  last_updated_at: string;
}

// --- Execution Governor ---
export type GovernorStatus = 'allow' | 'warn' | 'block';
export type GovernorReasonCode =
  | 'conflicts_active_decision'
  | 'low_trust_dependency'
  | 'poor_outcome_history'
  | 'unresolved_contradiction'
  | 'stale_assumption'
  | 'superseded_pattern'
  | 'policy_block'
  | 'review_required'
  | 'deprecated_scope';
export type GovernorSeverity = 'info' | 'warn' | 'block';

export interface ExecutionProposal {
  project_id: string;
  agent_id?: string;
  agent_name?: string;
  action_type: string;
  target_decision_ids?: string[];
  related_decision_ids?: string[];
  task?: string;
  proposed_tags?: string[];
  proposed_domain?: string;
  metadata?: Record<string, unknown>;
}

export interface GovernorReason {
  code: GovernorReasonCode;
  severity: GovernorSeverity;
  decision_id?: string;
  message: string;
  evidence?: Record<string, unknown>;
}

export interface GovernorDecision {
  status: GovernorStatus;
  summary: string;
  reasons: GovernorReason[];
  required_actions?: string[];
  override_allowed: boolean;
}

export interface GovernorOverrideRequest {
  proposal: ExecutionProposal;
  justification: string;
  actor_id: string;
  metadata?: Record<string, unknown>;
}

// --- Decisions ---
export interface Decision {
  id: string;
  project_id: string;
  title: string;
  description: string;
  reasoning: string;
  made_by: string;
  source: DecisionSource;
  source_session_id?: string;
  confidence: ConfidenceLevel;
  status: DecisionStatus;
  supersedes_id?: string;
  alternatives_considered: Alternative[];
  affects: string[];
  tags: string[];
  assumptions: string[];
  open_questions: string[];
  dependencies: string[];
  validated_at?: string;
  validation_source?: string;
  confidence_decay_rate: number;
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown>;
  embedding?: number[];
  domain?: DecisionDomain | null;
  category?: DecisionCategory | null;
  priority_level: PriorityLevel;
  wing?: string | null;
  valid_from?: string;
  valid_until?: string | null;
  superseded_by?: string | null;
  temporal_scope: TemporalScope;
  namespace?: string | null;
  provenance_chain?: ProvenanceRecord[];
  trust_score?: number | null;
  trust_components?: TrustComponents | null;
  outcome_success_rate?: number | null;
  outcome_count?: number;
}

export interface CreateDecisionInput {
  project_id: string;
  title: string;
  description: string;
  reasoning: string;
  made_by: string;
  source?: DecisionSource;
  source_session_id?: string;
  confidence?: ConfidenceLevel;
  status?: DecisionStatus;
  supersedes_id?: string;
  alternatives_considered?: Alternative[];
  affects?: string[];
  tags?: string[];
  assumptions?: string[];
  open_questions?: string[];
  dependencies?: string[];
  confidence_decay_rate?: number;
  metadata?: Record<string, unknown>;
  domain?: DecisionDomain | null;
  category?: DecisionCategory | null;
  priority_level?: PriorityLevel;
  wing?: string | null;
  temporal_scope?: TemporalScope;
  valid_from?: string;
  valid_until?: string | null;
  namespace?: string | null;
  provenance_chain?: ProvenanceRecord[];
}

export type DecisionSource = 'manual' | 'auto_distilled' | 'imported' | 'auto_capture';
export type ConfidenceLevel = 'high' | 'medium' | 'low';
export type DecisionStatus = 'active' | 'superseded' | 'reverted' | 'pending';

export type DecisionDomain =
  | 'authentication'
  | 'database'
  | 'frontend'
  | 'infrastructure'
  | 'testing'
  | 'security'
  | 'api'
  | 'collaboration'
  | 'general';

export type DecisionCategory =
  | 'architecture'
  | 'tool-choice'
  | 'rejected-alternative'
  | 'convention'
  | 'security-policy'
  | 'configuration'
  | 'decision';

export type PriorityLevel = 0 | 1 | 2;

export type TemporalScope = 'permanent' | 'sprint' | 'experiment' | 'deprecated';

export interface Alternative {
  option: string;
  rejected_reason: string;
}

export interface ScoredDecision extends Decision {
  relevance_score: number;
  freshness_score: number;
  combined_score: number;
  scoring_breakdown: ScoringBreakdown;
  loading_layer?: 'L0' | 'L1' | 'L2';
}

export interface ScoringBreakdown {
  direct_affect: number;
  tag_matching: number;
  role_relevance: number;
  semantic_similarity: number;
  status_penalty: number;
  freshness: number;
  combined: number;
  domain_boost?: number;
  trust_multiplier?: number;
  outcome_multiplier?: number;
  staleness_multiplier?: number;
}

// --- Edges ---
export interface DecisionEdge {
  id: string;
  source_id: string;
  target_id: string;
  relationship: EdgeRelationship;
  description?: string;
  strength: number;
  created_at: string;
}

export interface CreateEdgeInput {
  source_id: string;
  target_id: string;
  relationship: EdgeRelationship;
  description?: string;
  strength?: number;
}

export type EdgeRelationship =
  | 'supersedes'
  | 'requires'
  | 'informs'
  | 'blocks'
  | 'contradicts'
  | 'enables'
  | 'depends_on'
  | 'refines'
  | 'reverts';

export const EDGE_RELATIONSHIPS: EdgeRelationship[] = [
  'supersedes',
  'requires',
  'informs',
  'blocks',
  'contradicts',
  'enables',
  'depends_on',
  'refines',
  'reverts',
];

// --- Artifacts ---
export interface Artifact {
  id: string;
  project_id: string;
  name: string;
  path?: string;
  artifact_type: ArtifactType;
  description?: string;
  content_summary?: string;
  content_hash?: string;
  produced_by: string;
  related_decision_ids: string[];
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown>;
  embedding?: number[];
}

export interface CreateArtifactInput {
  project_id: string;
  name: string;
  path?: string;
  artifact_type: ArtifactType;
  description?: string;
  content_summary?: string;
  content_hash?: string;
  produced_by: string;
  related_decision_ids?: string[];
  metadata?: Record<string, unknown>;
}

export type ArtifactType =
  | 'spec'
  | 'code'
  | 'design'
  | 'report'
  | 'config'
  | 'documentation'
  | 'test'
  | 'other';

export interface ScoredArtifact extends Artifact {
  relevance_score: number;
}

// --- Session Summaries ---
export interface SessionSummary {
  id: string;
  project_id: string;
  agent_name: string;
  session_date: string;
  topic: string;
  summary: string;
  decision_ids: string[];
  artifact_ids: string[];
  assumptions: string[];
  open_questions: string[];
  lessons_learned: string[];
  raw_conversation_hash?: string;
  extraction_model?: string;
  extraction_confidence?: number;
  created_at: string;
  embedding?: number[];
}

export interface CreateSessionInput {
  project_id: string;
  agent_name: string;
  topic: string;
  summary: string;
  decision_ids?: string[];
  artifact_ids?: string[];
  assumptions?: string[];
  open_questions?: string[];
  lessons_learned?: string[];
  raw_conversation_hash?: string;
  extraction_model?: string;
  extraction_confidence?: number;
}

// --- Subscriptions ---
export interface Subscription {
  id: string;
  agent_id: string;
  topic: string;
  notify_on: NotifyEvent[];
  priority: Priority;
  created_at: string;
}

export interface CreateSubscriptionInput {
  agent_id: string;
  topic: string;
  notify_on?: NotifyEvent[];
  priority?: Priority;
}

export type NotifyEvent = 'update' | 'supersede' | 'revert' | 'contradict';
export type Priority = 'high' | 'medium' | 'low';

// --- Notifications ---
export interface Notification {
  id: string;
  agent_id: string;
  decision_id?: string;
  notification_type: NotificationType;
  message: string;
  role_context?: string;
  urgency: Urgency;
  read_at?: string;
  created_at: string;
}

export type NotificationType =
  | 'decision_created'
  | 'decision_updated'
  | 'decision_superseded'
  | 'decision_reverted'
  | 'artifact_updated'
  | 'blocked'
  | 'unblocked'
  | 'contradiction_detected'
  | 'assumption_invalidated'
  | 'dependency_changed';

export type Urgency = 'critical' | 'high' | 'medium' | 'low';

// --- Suggested Patterns ---
export interface SuggestedPattern {
  pattern_id: string;
  title: string;
  description: string;
  confidence: number;
  source_count: number;
  relevance_score: number;
}

// --- Context Compiler ---
export interface CompileRequest {
  agent_name: string;
  project_id: string;
  task_description: string;
  max_tokens?: number;
  include_superseded?: boolean;
  session_lookback_days?: number;
  depth?: 'default' | 'full';
  namespace?: string;
  /** Override the minimum relevance score threshold (default: 0.5) */
  min_score?: number;
  /** Include pattern recommendations in response (default: true) */
  include_patterns?: boolean;
}

export interface ContextPackage {
  agent: { name: string; role: string };
  task: string;
  compiled_at: string;
  token_count: number;
  budget_used_pct: number;
  decisions: ScoredDecision[];
  artifacts: ScoredArtifact[];
  notifications: Notification[];
  recent_sessions: SessionSummary[];
  formatted_markdown: string;
  formatted_json: string;
  decisions_considered: number;
  decisions_included: number;
  relevance_threshold_used: number;
  compilation_time_ms: number;
  loading_layers?: { l0_count: number; l1_count: number; l2_available: number };
  wing_sources?: Record<string, number>;
  suggested_patterns: SuggestedPattern[];
}

// --- Contradictions ---
export interface Contradiction {
  id: string;
  project_id: string;
  decision_a_id: string;
  decision_b_id: string;
  similarity_score: number;
  conflict_description?: string;
  status: ContradictionStatus;
  resolved_by?: string;
  resolution?: string;
  detected_at: string;
  resolved_at?: string;
  proposed_supersession?: {
    newer_decision_id: string;
    older_decision_id: string;
    confidence_delta: number;
  } | null;
}

export type ContradictionStatus = 'unresolved' | 'resolved' | 'dismissed';

// --- Relevance Feedback ---
export interface RelevanceFeedback {
  id: string;
  agent_id: string;
  decision_id: string;
  compile_request_id?: string;
  was_useful: boolean;
  usage_signal?: UsageSignal;
  created_at: string;
}

export interface CreateFeedbackInput {
  agent_id: string;
  decision_id: string;
  compile_request_id?: string;
  was_useful: boolean;
  usage_signal?: UsageSignal;
}

export type UsageSignal = 'referenced' | 'ignored' | 'contradicted' | 'built_upon';

// --- Graph Traversal ---
export interface GraphNode {
  decision: Decision;
  depth: number;
  via_relationship: string;
}

export interface GraphResult {
  nodes: Decision[];
  edges: DecisionEdge[];
}

// --- Impact Analysis ---
export interface ImpactAnalysis {
  decision: Decision;
  downstream_decisions: Decision[];
  affected_agents: Agent[];
  cached_contexts_invalidated: number;
  blocking_decisions: Decision[];
  supersession_chain: Decision[];
}

// --- Distillery ---
export interface DistilleryResult {
  decisions_extracted: number;
  contradictions_found: number;
  decisions: Decision[];
  session_summary?: SessionSummary;
  user_facts?: Array<{ key: string; value: string; confidence: number; category: string; scope: string; action: 'add' | 'supersede'; supersession_confidence: number; supersedes_key?: string; reason?: string }>;
  observations?: Array<{ content: string; tags: string[]; source_agent: string }>;
}

export interface ExtractedDecision {
  title: string;
  description: string;
  reasoning: string;
  alternatives_considered: Alternative[];
  confidence: ConfidenceLevel;
  tags: string[];
  affects: string[];
  assumptions: string[];
  open_questions: string[];
  dependencies: string[];
  implicit: boolean;
}

// --- Audit Log ---
export interface AuditEntry {
  id: string;
  event_type: string;
  agent_id?: string;
  project_id?: string;
  decision_id?: string;
  details: Record<string, unknown>;
  created_at: string;
}

// --- API Keys ---
export interface ApiKey {
  id: string;
  key_hash: string;
  project_id: string;
  name: string;
  scopes: string[];
  last_used_at?: string;
  created_at: string;
  revoked_at?: string;
}

// --- Project Stats ---
export interface ProjectStats {
  total_decisions: number;
  active_decisions: number;
  superseded_decisions: number;
  pending_decisions: number;
  total_agents: number;
  total_artifacts: number;
  total_sessions: number;
  unresolved_contradictions: number;
  total_edges: number;
  recent_activity: AuditEntry[];
}

// --- Condensed Compile Response (Hipp0Condensed) ---
export interface CondensedCompileResponse {
  condensed_context: string;
  original_tokens: number;
  compressed_tokens: number;
  compression_ratio: number;
  format_version: string; // "h0c-v1"
  decisions_considered: number;
  decisions_included: number;
  compilation_time_ms: number;
  feedback_hint: string;
  outcome_hint: string;
  wing_sources?: Record<string, number>;
}

export interface CompressionMetrics {
  original_tokens: number;
  compressed_tokens: number;
  compression_ratio: number;
  format_version: string;
}

// --- Wing Types ---
export interface WingSummary {
  wing: string;
  decision_count: number;
  top_domains: string[];
  cross_wing_connections: Array<{ wing: string; strength: number }>;
}

export interface WingStats {
  agent_name: string;
  wing: string;
  decision_count: number;
  top_domains: string[];
  cross_wing_connections: Array<{ wing: string; strength: number }>;
  wing_affinity: WingAffinity;
}

// --- What Changed Response ---
export interface WhatChangedResponse {
  period: { from: string; to: string };
  created: Array<{ id: string; title: string; domain: string | null; made_by: string; created_at: string }>;
  superseded: Array<{ id: string; title: string; superseded_by: string | null; superseded_at: string }>;
  deprecated: Array<{ id: string; title: string; deprecated_at: string; reason: string }>;
  updated: Array<{ id: string; title: string; fields_changed: string[]; updated_at: string }>;
  summary: string;
}

// --- Captures (Passive Decision Capture) ---
export interface Capture {
  id: string;
  project_id: string;
  agent_name: string;
  session_id?: string | null;
  source: string;
  conversation_text: string;
  status: CaptureStatus;
  extracted_decision_ids: string[];
  error_message?: string | null;
  created_at: string;
  completed_at?: string | null;
}

export type CaptureStatus = 'processing' | 'completed' | 'failed';

// --- Error Types ---
export class Hipp0Error extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'Hipp0Error';
  }
}

export class NotFoundError extends Hipp0Error {
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`, 'NOT_FOUND', 404);
  }
}

export class ValidationError extends Hipp0Error {
  constructor(message: string, details?: unknown) {
    super(message, 'VALIDATION_ERROR', 400, details);
  }
}

export class ConflictError extends Hipp0Error {
  constructor(message: string) {
    super(message, 'CONFLICT', 409);
  }
}
