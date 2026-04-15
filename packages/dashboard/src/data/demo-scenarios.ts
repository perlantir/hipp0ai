/**
 * Hardcoded demo scenarios for the Super Brain playground.
 *
 * 100% client-side, no API calls. Each scenario simulates a multi-agent
 * collaboration coordinated by the hipp0 Super Brain, showcasing the real
 * hipp0 APIs (compile_context, record_decision, record_outcome,
 * search_decisions) that power contextual memory in production.
 */

export interface DemoTopDecision {
  title: string;
  score: number;
}

export interface DemoStep {
  step_number: number;
  agent_name: string;
  role_suggestion: string;
  task_suggestion: string;
  relevance_score: number;
  decisions_compiled: number;
  top_decisions: DemoTopDecision[];
  new_from_previous?: string;
  output: string;
}

export interface DemoSkippedAgent {
  agent_name: string;
  relevance_score: number;
  reason: string;
}

export interface DemoScenario {
  id: string;
  keywords: string[];
  title: string;
  totalDecisions: number;
  plan: DemoStep[];
  skipped: DemoSkippedAgent[];
}

// -- Scenarios --------------------------------------------------------------

const authScenario: DemoScenario = {
  id: 'auth-architecture',
  keywords: ['auth', 'jwt', 'login', 'session', 'oauth', 'token', 'refresh'],
  title: 'Design authentication architecture',
  totalDecisions: 18,
  plan: [
    {
      step_number: 1,
      agent_name: 'architect',
      role_suggestion: 'system design',
      task_suggestion: 'Map the auth surface and pick a token strategy',
      relevance_score: 0.92,
      decisions_compiled: 4,
      top_decisions: [
        { title: 'Multi-tenant isolation boundary', score: 0.88 },
        { title: 'Stateless API gateway pattern', score: 0.81 },
        { title: 'Edge session validation', score: 0.74 },
        { title: 'Prior incident: session fixation', score: 0.66 },
      ],
      output: 'compile_context(agent="architect", task="jwt auth") -> 4 decisions.\nProposal: OAuth2 authorization code flow + short-lived JWT access tokens (15m) + opaque refresh tokens (14d) stored in httpOnly cookies. Tenant claim embedded in JWT for edge routing.\nrecord_decision("Use OAuth2 + JWT access / opaque refresh") -> ok.',
    },
    {
      step_number: 2,
      agent_name: 'security',
      role_suggestion: 'threat modeling',
      task_suggestion: 'Threat model the proposed flow, flag weak spots',
      relevance_score: 0.87,
      decisions_compiled: 6,
      top_decisions: [
        { title: 'Use OAuth2 + JWT / opaque refresh', score: 0.95 },
        { title: 'Prior incident: session fixation', score: 0.79 },
        { title: 'Rotation policy baseline', score: 0.72 },
      ],
      new_from_previous: 'Picked up the JWT + opaque refresh decision from architect. Threat-modeling against that concrete choice instead of a generic auth design.',
      output: 'compile_context(agent="security") -> 6 decisions (1 new from step 1).\nSTRIDE pass: refresh-token theft is top risk. Mitigation: rotating refresh tokens with reuse detection, bound to device fingerprint. JWT signing via asymmetric keys (ES256), rotate every 30d.\nrecord_decision("Rotate refresh tokens w/ reuse detection") -> ok.\nrecord_decision("ES256 JWT signing, 30d key rotation") -> ok.',
    },
    {
      step_number: 3,
      agent_name: 'implementer',
      role_suggestion: 'backend implementation',
      task_suggestion: 'Draft the token issuance + refresh endpoints',
      relevance_score: 0.84,
      decisions_compiled: 9,
      top_decisions: [
        { title: 'Rotate refresh tokens w/ reuse detection', score: 0.93 },
        { title: 'ES256 JWT signing, 30d key rotation', score: 0.9 },
        { title: 'Use OAuth2 + JWT / opaque refresh', score: 0.88 },
      ],
      new_from_previous: 'Building directly on the rotation + ES256 decisions from security. No re-litigating the algorithm choice.',
      output: 'compile_context(agent="implementer") -> 9 decisions.\nEndpoints: POST /auth/token (code exchange), POST /auth/refresh (rotates), POST /auth/revoke. Refresh lookup by sha256(token) in Postgres with (family_id, generation) columns for reuse detection.\nrecord_decision("Refresh tokens keyed by sha256, family+generation schema") -> ok.',
    },
    {
      step_number: 4,
      agent_name: 'reviewer',
      role_suggestion: 'critique and harden',
      task_suggestion: 'Review the full plan end-to-end, find gaps',
      relevance_score: 0.71,
      decisions_compiled: 12,
      top_decisions: [
        { title: 'Refresh tokens keyed by sha256, family+generation', score: 0.91 },
        { title: 'Rotate refresh tokens w/ reuse detection', score: 0.87 },
        { title: 'Multi-tenant isolation boundary', score: 0.78 },
      ],
      new_from_previous: 'Now has the full picture across architect, security, and implementer. Reviewing coherence, not individual pieces.',
      output: 'compile_context(agent="reviewer") -> 12 decisions across 3 agents.\nGaps: (1) no logout-everywhere flow, (2) tenant claim not validated at refresh time, (3) missing audit trail for token family invalidation.\nrecord_outcome(decision="refresh schema", status="accepted_with_followups") -> ok.',
    },
  ],
  skipped: [
    { agent_name: 'data-engineer', relevance_score: 0.18, reason: 'no analytics pipeline in scope' },
    { agent_name: 'ml-engineer', relevance_score: 0.09, reason: 'no ML surface for auth' },
  ],
};

const databaseScenario: DemoScenario = {
  id: 'database-choice',
  keywords: ['database', 'db', 'postgres', 'mongo', 'schema', 'storage', 'tenancy', 'multi-tenant', 'multi-tenancy'],
  title: 'Choose a database for multi-tenant workload',
  totalDecisions: 15,
  plan: [
    {
      step_number: 1,
      agent_name: 'architect',
      role_suggestion: 'evaluate constraints',
      task_suggestion: 'Enumerate workload shape and consistency needs',
      relevance_score: 0.9,
      decisions_compiled: 3,
      top_decisions: [
        { title: 'Target: 5k tenants, 100 rps peak', score: 0.86 },
        { title: 'Strong consistency required for billing', score: 0.82 },
        { title: 'Relational joins across 12 entities', score: 0.77 },
      ],
      output: 'compile_context(agent="architect", task="pick db") -> 3 decisions.\nShape: OLTP, write-heavy on session + billing tables, 12-entity relational graph, ACID required for invoicing. Read replicas acceptable.\nrecord_decision("Workload is relational OLTP, ACID required") -> ok.',
    },
    {
      step_number: 2,
      agent_name: 'data-engineer',
      role_suggestion: 'compare candidates',
      task_suggestion: 'PostgreSQL vs MongoDB vs CockroachDB trade-offs',
      relevance_score: 0.88,
      decisions_compiled: 5,
      top_decisions: [
        { title: 'Workload is relational OLTP, ACID required', score: 0.94 },
        { title: 'Relational joins across 12 entities', score: 0.83 },
      ],
      new_from_previous: 'Picked up the ACID + relational-shape decision. Narrows the shortlist to row-stores; Mongo is out without extra justification.',
      output: 'search_decisions("document store evaluation") -> 0 hits.\nComparison: Postgres wins on tooling + JSON-flex; Cockroach wins on horizontal scale but 2x ops cost. 100 rps peak fits a single Postgres primary comfortably.\nrecord_decision("PostgreSQL 16 as primary store") -> ok.',
    },
    {
      step_number: 3,
      agent_name: 'architect',
      role_suggestion: 'tenancy model',
      task_suggestion: 'Pick shared-db vs schema-per-tenant vs db-per-tenant',
      relevance_score: 0.82,
      decisions_compiled: 7,
      top_decisions: [
        { title: 'PostgreSQL 16 as primary store', score: 0.95 },
        { title: 'Target: 5k tenants, 100 rps peak', score: 0.89 },
        { title: 'Strong consistency required for billing', score: 0.8 },
      ],
      new_from_previous: 'Postgres is now locked in. Tenancy model decision can use Postgres-specific features (RLS, schemas).',
      output: 'compile_context(agent="architect") -> 7 decisions.\n5k tenants makes schema-per-tenant painful (migration fan-out). Pick shared tables + Row-Level Security with tenant_id on every row. Pooled connections via PgBouncer.\nrecord_decision("Shared schema + RLS, tenant_id FK everywhere") -> ok.',
    },
    {
      step_number: 4,
      agent_name: 'implementer',
      role_suggestion: 'migration plan',
      task_suggestion: 'Draft rollout + backfill steps',
      relevance_score: 0.68,
      decisions_compiled: 10,
      top_decisions: [
        { title: 'Shared schema + RLS, tenant_id FK everywhere', score: 0.96 },
        { title: 'PostgreSQL 16 as primary store', score: 0.92 },
      ],
      new_from_previous: 'All architecture decisions are settled; implementer only has to plan the migration, not choose the DB.',
      output: 'compile_context(agent="implementer") -> 10 decisions.\nSteps: add tenant_id nullable -> backfill from session -> enforce NOT NULL -> enable RLS policies -> drop legacy dbo schemas. Feature-flagged per tenant, 2 week rollout.\nrecord_outcome(decision="RLS rollout", status="planned") -> ok.',
    },
  ],
  skipped: [
    { agent_name: 'security', relevance_score: 0.22, reason: 'will review RLS policies in a later pass' },
    { agent_name: 'ml-engineer', relevance_score: 0.05, reason: 'no ML workload depends on this' },
  ],
};

const scalingScenario: DemoScenario = {
  id: 'scaling-strategy',
  keywords: ['scale', 'scaling', 'horizontal', 'capacity', 'load', 'ci', 'cd', 'pipeline', 'launch', 'product'],
  title: 'Plan horizontal scaling strategy',
  totalDecisions: 14,
  plan: [
    {
      step_number: 1,
      agent_name: 'architect',
      role_suggestion: 'scale audit',
      task_suggestion: 'Find the next bottleneck from current metrics',
      relevance_score: 0.89,
      decisions_compiled: 4,
      top_decisions: [
        { title: 'Current: 1 API node, 1 Postgres primary', score: 0.9 },
        { title: 'p95 latency drift at 200 rps', score: 0.84 },
        { title: 'CPU saturates before memory', score: 0.76 },
      ],
      output: 'compile_context(agent="architect", task="scaling") -> 4 decisions.\nBottleneck: API CPU. DB headroom is fine to 500 rps. Recommend stateless API with N replicas behind ALB, sticky sessions off, session state moved to Redis.\nrecord_decision("Make API stateless, externalize session to Redis") -> ok.',
    },
    {
      step_number: 2,
      agent_name: 'implementer',
      role_suggestion: 'session externalization',
      task_suggestion: 'Move session state out of memory',
      relevance_score: 0.83,
      decisions_compiled: 6,
      top_decisions: [
        { title: 'Make API stateless, externalize session to Redis', score: 0.95 },
        { title: 'p95 latency drift at 200 rps', score: 0.78 },
      ],
      new_from_previous: 'The "stateless API" decision from architect directly drives the implementer task; no re-deciding whether to use Redis.',
      output: 'compile_context(agent="implementer") -> 6 decisions.\nPlan: swap in-memory session store for Redis (cluster mode, 3 shards). TTL from JWT expiry. Fallback: if Redis is down, deny new sessions but keep existing JWTs valid.\nrecord_decision("Redis cluster, 3 shards, fail-closed for new sessions") -> ok.',
    },
    {
      step_number: 3,
      agent_name: 'security',
      role_suggestion: 'blast radius review',
      task_suggestion: 'What fails if Redis is compromised or down?',
      relevance_score: 0.74,
      decisions_compiled: 8,
      top_decisions: [
        { title: 'Redis cluster, 3 shards, fail-closed for new sessions', score: 0.92 },
        { title: 'Make API stateless, externalize session to Redis', score: 0.88 },
      ],
      new_from_previous: 'Security review can anchor on concrete infra choices (Redis cluster, fail-closed mode) rather than debating whether to externalize at all.',
      output: 'compile_context(agent="security") -> 8 decisions.\nFindings: Redis must be in private subnet with TLS; session values must be opaque (not JWT); add circuit breaker on API to short-circuit if Redis p99 > 50ms.\nrecord_decision("Redis TLS + private subnet + circuit breaker @ 50ms") -> ok.',
    },
    {
      step_number: 4,
      agent_name: 'reviewer',
      role_suggestion: 'rollout sign-off',
      task_suggestion: 'Decide rollout cadence and rollback plan',
      relevance_score: 0.66,
      decisions_compiled: 11,
      top_decisions: [
        { title: 'Redis TLS + private subnet + circuit breaker', score: 0.91 },
        { title: 'Redis cluster, 3 shards, fail-closed', score: 0.87 },
        { title: 'Make API stateless, externalize session', score: 0.82 },
      ],
      new_from_previous: 'Reviewer sees the full chain from architect to security. Rollout plan is the only remaining open question.',
      output: 'compile_context(agent="reviewer") -> 11 decisions across 3 agents.\nRollout: shadow Redis writes for 48h, flip reads behind feature flag at 1% / 10% / 50% / 100%, auto-rollback if p95 regresses >15%.\nrecord_outcome(decision="redis rollout plan", status="approved") -> ok.',
    },
  ],
  skipped: [
    { agent_name: 'data-engineer', relevance_score: 0.24, reason: 'no schema change needed' },
    { agent_name: 'ml-engineer', relevance_score: 0.08, reason: 'no ML workload in critical path' },
  ],
};

const SCENARIOS: DemoScenario[] = [authScenario, databaseScenario, scalingScenario];

// -- Lookup -----------------------------------------------------------------

export function findScenario(query: string): DemoScenario {
  const q = query.toLowerCase();
  const matched = SCENARIOS.find(
    (s) =>
      s.keywords.some((kw) => q.includes(kw)) ||
      q.includes(s.title.toLowerCase()),
  );
  return matched ?? SCENARIOS[0];
}
