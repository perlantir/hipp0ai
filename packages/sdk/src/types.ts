// SDK-local type definitions — mirrors core types without depending on @hipp0/core,
// so the SDK works in any environment (browser, edge, Node).

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

export interface WingAffinity {
  cross_wing_weights: Record<string, number>;
  last_recalculated: string;
  feedback_count: number;
}

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

export interface CreateAgentInput {
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
  wing?: string | null;
  namespace?: string | null;
}

export interface CreateDecisionInput {
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
  temporal_scope?: 'permanent' | 'sprint' | 'experiment';
  namespace?: string | null;
}

export interface UpdateDecisionInput {
  title?: string;
  description?: string;
  reasoning?: string;
  made_by?: string;
  confidence?: ConfidenceLevel;
  status?: DecisionStatus;
  affects?: string[];
  tags?: string[];
  assumptions?: string[];
  open_questions?: string[];
  dependencies?: string[];
  alternatives_considered?: Alternative[];
  confidence_decay_rate?: number;
  metadata?: Record<string, unknown>;
  validated_at?: string;
  validation_source?: string;
  namespace?: string | null;
}

export interface SupersedeDecisionInput {
  title: string;
  description: string;
  reasoning: string;
  made_by: string;
  tags?: string[];
  affects?: string[];
}

export type DecisionSource = 'manual' | 'auto_distilled' | 'imported' | 'auto_capture';
export type ConfidenceLevel = 'high' | 'medium' | 'low';
export type DecisionStatus = 'active' | 'superseded' | 'reverted' | 'pending';

export interface Alternative {
  option: string;
  rejected_reason: string;
}

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
}

export interface CreateArtifactInput {
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
}

export interface CreateSessionInput {
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

export interface Subscription {
  id: string;
  agent_id: string;
  topic: string;
  notify_on: NotifyEvent[];
  priority: Priority;
  created_at: string;
}

export interface CreateSubscriptionInput {
  topic: string;
  notify_on?: NotifyEvent[];
  priority?: Priority;
}

export type NotifyEvent = 'update' | 'supersede' | 'revert' | 'contradict';
export type Priority = 'high' | 'medium' | 'low';

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

export interface CompileContextInput {
  agent_name: string;
  project_id: string;
  task_description?: string;
  /** Alias for task_description — if both provided, task_description takes precedence */
  task?: string;
  max_tokens?: number;
  include_superseded?: boolean;
  session_lookback_days?: number;
  /** Response format: json (default), h0c, markdown, condensed, both */
  format?: 'json' | 'h0c' | 'markdown' | 'condensed' | 'both';
  /** Filter decisions by namespace. Comma-separated for multiple. */
  namespace?: string;
}

export interface SuggestedPattern {
  pattern_id: string;
  title: string;
  description: string;
  confidence: number;
  source_count: number;
  relevance_score: number;
}

export interface DecodedDecision {
  title: string;
  score: number;
  confidence: ConfidenceLevel;
  made_by: string;
  date: string;
  tags: string[];
  description: string;
  reasoning?: string;
  namespace?: string;
}

export interface ContextPackage {
  agent: { name: string; role: string };
  task: string;
  compiled_at: string;
  token_count: number;
  budget_used_pct: number;
  decisions: Decision[];
  artifacts: Artifact[];
  notifications: Notification[];
  recent_sessions: SessionSummary[];
  formatted_markdown: string;
  formatted_json: string;
  decisions_considered: number;
  decisions_included: number;
  relevance_threshold_used: number;
  compilation_time_ms: number;
  wing_sources?: Record<string, number>;
  suggested_patterns: SuggestedPattern[];
}

export interface DistillInput {
  conversation_text: string;
  agent_name?: string;
  session_id?: string;
}

export interface DistilleryResult {
  decisions_extracted: number;
  contradictions_found: number;
  decisions: Decision[];
  session_summary?: SessionSummary;
}

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
}

export type ContradictionStatus = 'unresolved' | 'resolved' | 'dismissed';

export interface ResolveContradictionInput {
  status: ContradictionStatus;
  resolved_by?: string;
  resolution?: string;
}

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

export interface GraphResult {
  nodes: Decision[];
  edges: DecisionEdge[];
}

export interface ImpactAnalysis {
  decision: Decision;
  downstream_decisions: Decision[];
  affected_agents: Array<{ id: string; name: string; role: string; project_id: string }>;
  cached_contexts_invalidated: number;
  blocking_decisions: Decision[];
  supersession_chain: Decision[];
}

export interface AuditEntry {
  id: string;
  event_type: string;
  agent_id?: string;
  project_id?: string;
  decision_id?: string;
  details: Record<string, unknown>;
  created_at: string;
}

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

export interface DecisionListFilters {
  status?: DecisionStatus;
  tags?: string[];
  made_by?: string;
  limit?: number;
  offset?: number;
}

export interface OutcomeResult {
  id: string;
  compile_request_id: string;
  project_id: string;
  agent_id: string;
  task_completed: boolean | null;
  alignment_score: number;
  decisions_compiled: number;
  decisions_referenced: number;
  decisions_ignored: number;
}

export interface ReportOutcomeInput {
  compile_request_id: string;
  task_completed: boolean;
  task_duration_ms?: number;
  agent_output?: string;
  error_occurred?: boolean;
  error_message?: string;
}

  // Task Sessions (Super Brain Phase 1)

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
}

export interface StartSessionInput {
  project_id: string;
  title: string;
  description?: string;
}

export interface RecordStepInput {
  agent_name: string;
  agent_role?: string;
  task_description: string;
  output: string;
  artifacts?: unknown[];
  duration_ms?: number;
  decisions_created?: string[];
  project_id?: string;
}

export interface SessionState {
  session: TaskSession;
  steps: SessionStep[];
}

  // Role Signals (Super Brain Phase 2)

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

export interface ScoreTeamInput {
  projectId: string;
  taskDescription: string;
  sessionId?: string;
}

  // Smart Orchestrator (Super Brain Phase 3)

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

export interface AcceptSuggestionInput {
  accepted_agent: string;
  override?: boolean;
  override_reason?: string;
}

export interface AcceptSuggestionResult {
  accepted: boolean;
  agent: string;
  was_override: boolean;
}

export interface Hipp0ClientOptions {
  baseUrl: string;
  apiKey?: string;
  /** Default project id for auto-instrumentation / convenience methods. */
  projectId?: string;
}

export interface Hipp0Error {
  code: string;
  message: string;
  details?: unknown;
}

// --- Temporal Intelligence ---
export interface WhatChangedResponse {
  period: { from: string; to: string };
  created: Array<{ id: string; title: string; domain: string | null; made_by: string; created_at: string }>;
  superseded: Array<{ id: string; title: string; superseded_by: string | null; superseded_at: string }>;
  deprecated: Array<{ id: string; title: string; deprecated_at: string; reason: string }>;
  updated: Array<{ id: string; title: string; fields_changed: string[]; updated_at: string }>;
  summary: string;
}

  // Context Compression Survival

export interface SaveBeforeTrimInput {
  session_id: string;
  agent_name: string;
  context_summary: string;
  important_decisions: string[];
}

export interface SaveBeforeTrimResult {
  checkpoint_id: string;
  session_id: string;
  agent_name: string;
}

  // Passive Decision Capture

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

export interface CaptureInput {
  agent_name: string;
  project_id: string;
  conversation: string;
  session_id?: string;
  source?: string;
}

export interface CaptureResult {
  capture_id: string;
  status: string;
}

export interface CaptureStatusResult {
  id: string;
  status: CaptureStatus;
  extracted_decision_count: number;
  extracted_decision_ids: string[];
  error_message?: string | null;
  created_at: string;
  completed_at?: string | null;
}

export class Hipp0ApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'Hipp0ApiError';
  }
}
