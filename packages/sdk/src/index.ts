export { Hipp0Client } from './client.js';
export { Hipp0 } from './facade.js';
export type { Hipp0Config, CompileOptions, AddDecisionOptions, SearchOptions } from './facade.js';
export { auto, autoDisable } from './auto.js';
export type { AutoOptions } from './auto.js';
export { Hipp0EventStream } from './events.js';
export type { MemoryEvent, Hipp0EventStreamConfig } from './events.js';

export type {
  // Client options
  Hipp0ClientOptions,

  // Domain types
  Project,
  CreateProjectInput,
  Agent,
  CreateAgentInput,
  RelevanceProfile,
  FreshnessPreference,
  Decision,
  CreateDecisionInput,
  UpdateDecisionInput,
  SupersedeDecisionInput,
  DecisionListFilters,
  DecisionSource,
  ConfidenceLevel,
  DecisionStatus,
  Alternative,
  DecisionEdge,
  CreateEdgeInput,
  EdgeRelationship,
  Artifact,
  CreateArtifactInput,
  ArtifactType,
  SessionSummary,
  CreateSessionInput,
  Subscription,
  CreateSubscriptionInput,
  NotifyEvent,
  Priority,
  Notification,
  NotificationType,
  Urgency,
  CompileContextInput,
  ContextPackage,
  DistillInput,
  DistilleryResult,
  Contradiction,
  ContradictionStatus,
  ResolveContradictionInput,
  RelevanceFeedback,
  CreateFeedbackInput,
  UsageSignal,
  GraphResult,
  ImpactAnalysis,
  AuditEntry,
  ProjectStats,
  Hipp0Error,
  OutcomeResult,
  ReportOutcomeInput,
  WhatChangedResponse,
  DecodedDecision,
} from './types.js';

export { Hipp0ApiError } from './types.js';
