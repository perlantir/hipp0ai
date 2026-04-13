// --- Types ---
export * from './types.js';

// --- LLM Config ---
export * from './config/llm.js';

// --- Roles ---
export {
  ROLE_TEMPLATES,
  ROLE_NAMES,
  getRoleNotificationContext,
  getRoleProfile,
  listRoles,
} from './roles.js';
export type { RoleTemplate } from './roles.js';

// --- Database ---
// New adapter API (preferred for new code)
export { initDb, getDb, closeDb } from './db/index.js';
export type { DatabaseAdapter, QueryResult } from './db/index.js';
export type { DatabaseConfig } from './db/index.js';
export { createAdapter, resolveDialect } from './db/index.js';
// Backward-compatible pool API (legacy — prefer db/index.js for new code)
export { getPool, query, getClient, transaction, closePool, healthCheck } from './db/pool.js';
export { runMigrations } from './db/migrations.js';
export * from './db/parsers.js';

// --- Decision Graph ---
export {
  createDecision,
  getDecision,
  updateDecision,
  listDecisions,
  searchDecisionsByEmbedding,
  createEdge,
  getEdges,
  deleteEdge,
  getConnectedDecisions,
  getGraph,
  supersedeDecision,
  getSupersessionChain,
  getImpact,
} from './decision-graph/index.js';
export { generateEmbedding } from './decision-graph/embeddings.js';

// --- Context Compiler ---
export { compileContext, scoreDecision, cosineSimilarity } from './context-compiler/index.js';

// --- Hipp0Condensed Compression ---
export {
  condenseDecisions,
  condenseSessionHistory,
  condenseContradictions,
  condenseTeamScores,
  condenseRecommendedAction,
  condenseCompileResponse,
  computeCompressionMetrics,
  estimateTokens,
} from './context-compiler/compression.js';
export type { CondenseCompileInput } from './context-compiler/compression.js';

// --- H0C Encoder / Decoder ---
export { encodeH0C, encodeH0CPatterns } from './compression/h0c-encoder.js';
export type { H0CEncodeOptions, DecodedDecision } from './compression/h0c-encoder.js';
export { decodeH0C, decodeH0CPatterns } from './compression/h0c-decoder.js';
export { encodeH0CUltra } from './compression/h0c-ultra.js';
export type { H0CUltraOptions } from './compression/h0c-ultra.js';

// --- Change Propagator ---
export {
  createSubscription,
  getSubscriptions,
  deleteSubscription,
  propagateChange,
  getNotifications,
  markNotificationRead,
  matchSubscriptions,
  invalidateCache,
} from './change-propagator/index.js';

// --- Distillery ---
export {
  distill,
  extractDecisions,
  deduplicateDecisions,
  detectContradictions,
  integrateDecisions,
  createSessionSummary,
} from './distillery/index.js';

// --- Temporal ---
export {
  computeFreshness,
  computeEffectiveConfidence,
  confidenceToScore,
  getTemporalFlags,
  validateDecision,
  blendScores,
} from './temporal/index.js';

// --- Role Signals (Super Brain Phase 2) ---
export {
  generateRoleSignal,
  generateRoleSuggestion,
  scoreTeamForTask,
} from './intelligence/role-signals.js';
export type { RoleSignal, TeamRelevance } from './intelligence/role-signals.js';

// --- Smart Orchestrator (Super Brain Phase 3) ---
export {
  suggestNextAgent,
  generateSessionPlan,
  generateTaskSuggestion,
  buildReasoningExplanation,
} from './intelligence/orchestrator.js';
export type { NextAgentSuggestion, SessionPlan } from './intelligence/orchestrator.js';

// --- Relevance Learner ---
export {
  recordFeedback,
  getFeedbackForAgent,
  evolveWeights,
  getEvolutionStats,
} from './relevance-learner/index.js';

// --- Hierarchy / Classification ---
export {
  classifyDecision,
  inferDomainFromTask,
} from './hierarchy/classifier.js';
export type { ClassificationResult } from './hierarchy/classifier.js';

// --- Wings / Affinity ---
export {
  getWingAffinity,
  getDecisionWing,
  increaseWingAffinity,
  decreaseWingAffinity,
  processWingFeedback,
  processWingFeedbackBatch,
  processWingOutcome,
  rebalanceWingAffinity,
  computeWingSources,
  classifyDecisionWing,
  maybeRecalculateWings,
  recalculateProjectWings,
  getAgentWingAffinityScore,
  resetRecalcCounter,
  getRecalcCounter,
} from './wings/affinity.js';
export type { WingClassification } from './wings/affinity.js';

// --- Evolution Engine ---
export {
  runEvolutionScan,
  computeUrgency,
} from './intelligence/evolution-engine.js';
export type {
  EvolutionMode,
  ProposalUrgency,
  ProposalStatus,
  TriggerType,
  EvolutionProposal,
  EvolutionScanResult,
} from './intelligence/evolution-engine.js';

// --- Evolution Handlers (Phase 2) ---
export {
  executeProposalHandler,
  handleOrphanedDecision,
  handleStaleDecision,
  handleContradiction,
  handleConcentrationRisk,
  handleHighImpactUnvalidated,
  findRelatedDecisions,
} from './intelligence/evolution-handlers.js';
export type {
  ExecutionResult,
  ProposalRecord,
} from './intelligence/evolution-handlers.js';

// --- Trust Scorer (Provenance & Trust Phase 2) ---
export {
  computeTrust,
  trustMultiplier,
  defaultProvenance,
  validationProvenance,
} from './intelligence/trust-scorer.js';

// --- Capture Dedup (Passive Ingestion Phase 4) ---
export {
  computeCaptureHash,
  checkExactDuplicate,
  checkSemanticDuplicates,
  runCaptureDedup,
} from './intelligence/capture-dedup.js';
export type { DedupResult } from './intelligence/capture-dedup.js';

// --- Outcome Memory ---
export { recordDecisionOutcome, getDecisionOutcomes, getOutcomeStats, outcomeMultiplier, attributeOutcomeToDecisions } from './intelligence/outcome-memory.js';

// --- Cross-Agent Learning ---
export { computeAgentPerformance, computeCrossAgentTransfer, computeDomainStrengths, applyCrossAgentLearning, getCrossAgentSummary } from './intelligence/cross-agent-learner.js';

// --- Pattern Recommendations ---
export {
  getPatternRecommendations,
  listPatterns,
  DEFAULT_MIN_PATTERN_CONFIDENCE,
  MAX_SUGGESTED_PATTERNS,
} from './intelligence/pattern-extractor.js';

// --- Contrastive Explainer ---
export {
  generateContrastiveExplanation,
  generateTopContrastPairs,
  generateBoundaryExplanations,
} from './intelligence/contrastive-explainer.js';
export type { ContrastiveExplanation } from './intelligence/contrastive-explainer.js';

// --- LLM Explainer (optional pretty-prose layer over contrastive-explainer) ---
export {
  rewriteExplanation,
  rewriteExplanationsBatch,
} from './intelligence/llm-explainer.js';
export type {
  LLMExplainerOptions,
  ExplanationContext,
} from './intelligence/llm-explainer.js';

// --- Per-Agent API Keys ---
export {
  createAgentApiKey,
  listAgentKeys,
  revokeAgentKey,
  validateAgentKey,
  recordKeyUsage,
  AGENT_KEY_PREFIX,
  DEFAULT_AGENT_KEY_SCOPES,
} from './intelligence/agent-keys.js';
export type { AgentKey, ValidatedAgentKey } from './intelligence/agent-keys.js';

// --- Agent Skill Profiler ---
export { computeAgentSkillProfile, getSkillMatrix, suggestBestAgent } from './intelligence/skill-profiler.js';
export type { SkillEntry, AgentSkillProfile, SkillMatrix, AgentSuggestion } from './intelligence/skill-profiler.js';

// --- Impact Predictor ---
export { predictDecisionImpact, predictBatchImpact } from './intelligence/impact-predictor.js';
export type { DecisionInput as ImpactDecisionInput, ImpactPrediction, BatchImpactResult, RiskFactor } from './intelligence/impact-predictor.js';

// --- Execution Governor ---
export { evaluateProposal, recordOverride } from './governance/execution-governor.js';

// --- A/B Testing ---
export {
  createExperiment,
  getActiveExperiments,
  getExperiments,
  getExperimentResults,
  resolveExperiment,
  resolveTrafficSplit,
} from './intelligence/ab-testing.js';
export type {
  Experiment,
  ExperimentGroupResult,
  ExperimentResults,
} from './intelligence/ab-testing.js';

// --- Cross-Project Pattern Sharing ---
export {
  extractSharedPattern,
  getRelevantSharedPatterns,
  recordPatternAdoption,
  getCommunityStats,
  listSharedPatterns,
  hashProjectId,
  toSuggestedPattern,
  isAutoShareEnabled,
} from './intelligence/cross-project-patterns.js';
export type {
  AdoptionOutcome,
  SharedPatternInput,
  SharedPatternRecord,
  ExtractSharedPatternResult,
  CommunityStats,
} from './intelligence/cross-project-patterns.js';

// --- Three-Tier Knowledge Pipeline ---
export {
  promoteToFacts,
  promoteToInsights,
  getInsights,
  updateInsightStatus,
  runFullPipeline,
} from './intelligence/knowledge-pipeline.js';
export type {
  InsightType,
  InsightStatus,
  KnowledgeInsight,
  PromoteToFactsResult,
  PromoteToInsightsResult,
  PipelineSummary,
  GetInsightsOptions,
} from './intelligence/knowledge-pipeline.js';

// --- Reflection Engine (Automated Reflection Loops) ---
export {
  runHourlyReflection,
  runDailyReflection,
  runWeeklyReflection,
  getReflectionHistory,
} from './intelligence/reflection-engine.js';
export type {
  ReflectionType,
  HourlyReflectionResult,
  DailyReflectionResult,
  WeeklyReflectionResult,
  TeamHealthMetrics,
  ReflectionRunRecord,
} from './intelligence/reflection-engine.js';

// --- Trace Collector (Broader Stigmergy) ---
export {
  recordTrace,
  getRecentTraces,
  distillTraces,
} from './intelligence/trace-collector.js';
export type {
  TraceType,
  TraceInput,
  TraceRecord,
  GetTracesOptions,
  DistilledCandidate,
} from './intelligence/trace-collector.js';

// --- Knowledge Branching ("Git for Decisions") ---
export {
  createBranch,
  listBranches,
  getBranchDiff,
  mergeBranch,
  deleteBranch,
} from './intelligence/knowledge-branches.js';
export type {
  DecisionBranch,
  CreateBranchInput,
  BranchDiff,
  MergeOptions,
  MergeConflict,
  MergeResult,
} from './intelligence/knowledge-branches.js';

// --- Expanded What-If Simulation ---
export {
  simulateDecisionChange,
  simulateHistoricalImpact,
  simulateMultiDecisionChange,
  simulateCascadeImpact,
  simulateRollback,
  checkProposedContradictions,
  findCascadeImpact,
} from './intelligence/whatif-simulator.js';
export type {
  ProposedChanges,
  AgentImpact,
  SimulationWarning,
  SimulationResult,
  HistoricalImpact,
  DecisionChange,
  MultiChangeInteraction,
  MultiChangeResult,
  CascadeNode,
  CascadeResult,
  RollbackRisk,
  RollbackResult,
} from './intelligence/whatif-simulator.js';

// --- Memory Analytics & Weekly Digest ---
export {
  computeTeamHealth,
  generateWeeklyDigest as generateMemoryWeeklyDigest,
  getMemoryTrends,
  exportDigestMarkdown,
} from './intelligence/memory-analytics.js';
export type {
  TeamHealth,
  WeeklyDigest as MemoryWeeklyDigest,
  MemoryTrends,
  DailyCount,
  DailyOutcomeCount,
  DailyContradictionCount,
  TopAgent,
  WeakestDomain,
  TopDecisionRef,
  EmergingPattern,
  SkillChange,
  ComputeTeamHealthOptions,
} from './intelligence/memory-analytics.js';

// --- Collaboration (Comments, Approvals, Annotations) ---
export {
  addComment,
  getComments,
  updateComment,
  deleteComment,
  getRecentComments,
  requestApproval,
  approveDecision,
  rejectDecision,
  getPendingApprovals,
  getApprovalHistory,
  addAnnotation,
  getAnnotations,
  updateAnnotation,
  deleteAnnotation,
} from './intelligence/comments.js';
export type {
  DecisionComment,
  AddCommentInput,
  ApprovalStatus,
  DecisionApproval,
  RequestApprovalInput,
  ApproveInput,
  RejectInput,
  TextRange,
  DecisionAnnotation,
  AddAnnotationInput,
} from './intelligence/comments.js';

// --- Cost Tracking & Budget Caps ---
export {
  recordLLMCall,
  getProjectUsage,
  getDailyUsage,
  getUsageHistory,
  checkBudget,
  setProjectBudget,
  estimateCostUsd,
} from './intelligence/cost-tracker.js';
export type {
  LLMProvider,
  RecordLLMCallInput,
  LLMUsageRecord,
  UsageSummary,
  GetProjectUsageOptions,
  BudgetStatus,
  ProjectBudgetConfig,
} from './intelligence/cost-tracker.js';

// --- Resilience (retry + circuit breaker) ---
export {
  withRetry,
  defaultIsRetryable,
  CircuitBreaker,
  CircuitOpenError,
  distilleryBreakerAnthropic,
  distilleryBreakerOpenAI,
  distilleryQueue,
  getBreakerForProvider,
  getDistilleryHealth,
  startDistilleryDrainLoop,
  stopDistilleryDrainLoop,
  DISTILLERY_QUEUE_MAX_SIZE,
} from './intelligence/resilience.js';
export type {
  RetryOptions,
  CircuitBreakerOptions,
  CircuitState,
  CircuitStats,
  QueuedExtraction,
} from './intelligence/resilience.js';

// --- Digest Delivery (email, Slack, webhook) ---
export {
  sendDigestEmail,
  sendDigestSlack,
  sendDigestWebhook,
  deliverDigest,
  buildSlackBlocks,
  markdownToSimpleHtml,
} from './intelligence/digest-delivery.js';
export type {
  DeliveryResult,
  SmtpConfig,
  EmailDeliveryConfig,
  SlackDeliveryConfig,
  WebhookDeliveryConfig,
  DeliveryConfig,
  DeliveryDispatchResult,
} from './intelligence/digest-delivery.js';
