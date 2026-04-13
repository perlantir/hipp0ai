/**
 * Playground Seed Data - builds a realistic "SaaS Platform" demo project.
 *
 * Inserts: 1 project, 6 agents, 50 decisions, 20 decision_edges,
 *          4 contradictions, 45 outcomes.
 *
 * All timestamps are spread deterministically across the last 30 days so
 * trends, time-travel, and analytics views look realistic.
 */

import { randomUUID } from 'node:crypto';
import type { DatabaseAdapter } from '@hipp0/core/db/adapter.js';

function daysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(10 + (days % 10), (days * 7) % 60, 0, 0);
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

const AGENTS = [
  { name: 'architect', role: 'Principal architect making high-level design decisions' },
  { name: 'backend', role: 'Backend engineer implementing server logic' },
  { name: 'frontend', role: 'Frontend engineer building UI and UX' },
  { name: 'security', role: 'Security reviewer enforcing auth and data protection' },
  { name: 'devops', role: 'DevOps engineer managing infra and deployment' },
  { name: 'reviewer', role: 'Code reviewer catching bugs and style issues' },
];

interface SeedDecision {
  title: string;
  description: string;
  reasoning: string;
  made_by: string;
  tags: string[];
  affects: string[];
  confidence: 'high' | 'medium' | 'low';
  domain: string;
  daysAgo: number;
  outcome?: 'success' | 'failure' | 'partial';
  outcomeScore?: number;
}

const DECISIONS: SeedDecision[] = [
  // Database / persistence
  { title: 'Use PostgreSQL with pgvector for persistence', description: 'Primary datastore for structured data and vector embeddings.', reasoning: 'Relational model fits our domain. pgvector eliminates need for separate vector DB.', made_by: 'architect', tags: ['database', 'infrastructure', 'postgres'], affects: ['backend', 'devops'], confidence: 'high', domain: 'database', daysAgo: 28, outcome: 'success', outcomeScore: 0.95 },
  { title: 'Add Redis for session caching', description: 'Use Redis as a hot cache for session data and rate limiting.', reasoning: 'Sub-millisecond reads for auth and session checks.', made_by: 'backend', tags: ['cache', 'performance', 'redis'], affects: ['backend', 'security'], confidence: 'medium', domain: 'infrastructure', daysAgo: 26, outcome: 'success', outcomeScore: 0.88 },
  { title: 'MongoDB for relational user data', description: 'Tried using MongoDB to store users and tenancy relations.', reasoning: 'Document DB seemed fast but joins became painful.', made_by: 'backend', tags: ['database', 'mongodb'], affects: ['backend'], confidence: 'low', domain: 'database', daysAgo: 25, outcome: 'failure', outcomeScore: 0.15 },
  { title: 'Connection pooling via PgBouncer', description: 'Front PostgreSQL with PgBouncer in transaction mode.', reasoning: 'Prevents connection exhaustion under load.', made_by: 'devops', tags: ['database', 'performance', 'pgbouncer'], affects: ['backend', 'devops'], confidence: 'high', domain: 'infrastructure', daysAgo: 24, outcome: 'success', outcomeScore: 0.92 },

  // Auth / security
  { title: 'JWT for stateless API authentication', description: 'Use signed JWTs for API auth instead of server-side sessions.', reasoning: 'Stateless auth enables horizontal scaling without shared session store.', made_by: 'architect', tags: ['auth', 'api', 'security'], affects: ['backend', 'frontend', 'security'], confidence: 'high', domain: 'auth', daysAgo: 27, outcome: 'success', outcomeScore: 0.93 },
  { title: 'Refresh tokens in HTTP-only cookies', description: 'Store refresh tokens server-managed, never accessible to JS.', reasoning: 'Defense against XSS token theft.', made_by: 'security', tags: ['auth', 'security', 'cookies'], affects: ['backend', 'frontend'], confidence: 'high', domain: 'auth', daysAgo: 26, outcome: 'success', outcomeScore: 0.96 },
  { title: '15 minute JWT expiry', description: 'Short-lived access tokens paired with refresh rotation.', reasoning: 'Limits blast radius if a token is compromised.', made_by: 'security', tags: ['auth', 'security', 'jwt'], affects: ['backend'], confidence: 'high', domain: 'auth', daysAgo: 25, outcome: 'success', outcomeScore: 0.91 },
  { title: 'Session-based auth with cookies', description: 'Original plan - server-side sessions in Redis.', reasoning: 'Simpler to invalidate but blocks horizontal scaling.', made_by: 'backend', tags: ['auth', 'sessions'], affects: ['backend'], confidence: 'low', domain: 'auth', daysAgo: 29, outcome: 'failure', outcomeScore: 0.25 },
  { title: 'bcrypt for password hashing with cost 12', description: 'Use bcrypt with adequate work factor for password storage.', reasoning: 'Industry standard, resistant to GPU attacks.', made_by: 'security', tags: ['auth', 'security', 'bcrypt'], affects: ['backend'], confidence: 'high', domain: 'auth', daysAgo: 24, outcome: 'success', outcomeScore: 0.97 },
  { title: 'OAuth2 PKCE for third-party login', description: 'Google and GitHub OAuth2 with PKCE flow.', reasoning: 'PKCE prevents auth code interception in SPAs.', made_by: 'security', tags: ['auth', 'oauth', 'security'], affects: ['backend', 'frontend'], confidence: 'high', domain: 'auth', daysAgo: 20, outcome: 'success', outcomeScore: 0.89 },
  { title: 'Rate limit login to 5/min per IP', description: 'Sliding window rate limit on /auth/login endpoint.', reasoning: 'Mitigates brute force while not blocking legitimate users.', made_by: 'security', tags: ['auth', 'rate-limit', 'security'], affects: ['backend'], confidence: 'high', domain: 'security', daysAgo: 18, outcome: 'success', outcomeScore: 0.9 },

  // API / backend
  { title: 'REST API with versioned routes under /v1', description: 'Namespace all endpoints under /v1 for future versioning.', reasoning: 'Allows breaking changes without breaking existing clients.', made_by: 'backend', tags: ['api', 'rest', 'versioning'], affects: ['backend', 'frontend'], confidence: 'high', domain: 'api', daysAgo: 27, outcome: 'success', outcomeScore: 0.94 },
  { title: 'Zod validation on all request bodies', description: 'Validate every request with Zod schemas.', reasoning: 'Type-safe validation and automatic error messages.', made_by: 'backend', tags: ['api', 'validation', 'zod'], affects: ['backend'], confidence: 'high', domain: 'api', daysAgo: 26, outcome: 'success', outcomeScore: 0.92 },
  { title: 'Cursor-based pagination for list endpoints', description: 'All list endpoints use opaque cursors instead of offset.', reasoning: 'Stable across inserts and efficient on large tables.', made_by: 'backend', tags: ['api', 'pagination', 'performance'], affects: ['backend', 'frontend'], confidence: 'high', domain: 'api', daysAgo: 22, outcome: 'success', outcomeScore: 0.88 },
  { title: 'Hono framework for HTTP server', description: 'Use Hono instead of Express for the API layer.', reasoning: 'Edge-compatible, faster, better TypeScript support.', made_by: 'backend', tags: ['api', 'framework', 'hono'], affects: ['backend'], confidence: 'high', domain: 'backend', daysAgo: 28, outcome: 'success', outcomeScore: 0.9 },
  { title: 'GraphQL for public API', description: 'Proposed switching REST to GraphQL.', reasoning: 'Client-side flexibility.', made_by: 'frontend', tags: ['api', 'graphql'], affects: ['backend', 'frontend'], confidence: 'low', domain: 'api', daysAgo: 15, outcome: 'failure', outcomeScore: 0.3 },
  { title: 'WebSocket for real-time updates', description: 'Use WebSockets for live collaboration features.', reasoning: 'Bi-directional needed for presence and live edits.', made_by: 'architect', tags: ['realtime', 'websocket'], affects: ['backend', 'frontend'], confidence: 'high', domain: 'realtime', daysAgo: 17, outcome: 'success', outcomeScore: 0.91 },
  { title: 'Health check at /api/health', description: 'Kubernetes liveness and readiness probes hit /api/health.', reasoning: 'Standard pattern for container orchestration.', made_by: 'devops', tags: ['api', 'health', 'kubernetes'], affects: ['devops'], confidence: 'high', domain: 'api', daysAgo: 26, outcome: 'success', outcomeScore: 0.99 },

  // Frontend
  { title: 'React + Vite for dashboard', description: 'React 19 with Vite for the admin dashboard.', reasoning: 'Fast HMR, great DX, team already knows React.', made_by: 'frontend', tags: ['frontend', 'react', 'vite'], affects: ['frontend'], confidence: 'high', domain: 'frontend', daysAgo: 28, outcome: 'success', outcomeScore: 0.95 },
  { title: 'Tailwind CSS for styling', description: 'Utility-first CSS with Tailwind.', reasoning: 'Fast iteration, consistent design system.', made_by: 'frontend', tags: ['frontend', 'css', 'tailwind'], affects: ['frontend'], confidence: 'high', domain: 'frontend', daysAgo: 28, outcome: 'success', outcomeScore: 0.93 },
  { title: 'TypeScript strict mode across packages', description: 'Enable strict TS in every package.', reasoning: 'Catches bugs at compile time.', made_by: 'architect', tags: ['typescript', 'tooling'], affects: ['backend', 'frontend'], confidence: 'high', domain: 'tooling', daysAgo: 29, outcome: 'success', outcomeScore: 0.97 },
  { title: 'Lucide React for icons', description: 'Use lucide-react instead of Material Symbols.', reasoning: 'Lightweight, tree-shakable, consistent.', made_by: 'frontend', tags: ['frontend', 'icons'], affects: ['frontend'], confidence: 'high', domain: 'frontend', daysAgo: 22, outcome: 'success', outcomeScore: 0.87 },
  { title: 'Dark mode support via CSS variables', description: 'Theme via CSS custom properties with class toggle.', reasoning: 'No runtime cost, works with SSR.', made_by: 'frontend', tags: ['frontend', 'theming'], affects: ['frontend'], confidence: 'high', domain: 'frontend', daysAgo: 14, outcome: 'success', outcomeScore: 0.89 },
  { title: 'D3.js for decision graph visualization', description: 'Use D3 for the interactive decision graph.', reasoning: 'Most flexible viz library, handles force layouts well.', made_by: 'frontend', tags: ['frontend', 'visualization', 'd3'], affects: ['frontend'], confidence: 'medium', domain: 'visualization', daysAgo: 19, outcome: 'partial', outcomeScore: 0.7 },

  // DevOps / deployment
  { title: 'Docker Compose for local development', description: 'Full stack runs in Docker Compose.', reasoning: 'Consistent dev environment across machines.', made_by: 'devops', tags: ['docker', 'devops'], affects: ['backend', 'devops'], confidence: 'high', domain: 'infrastructure', daysAgo: 27, outcome: 'success', outcomeScore: 0.93 },
  { title: 'Deploy to VPS with Docker', description: 'Single-node Docker deployment on Hostinger VPS.', reasoning: 'Simpler than Kubernetes for current scale.', made_by: 'devops', tags: ['deployment', 'docker', 'vps'], affects: ['devops'], confidence: 'medium', domain: 'infrastructure', daysAgo: 21, outcome: 'success', outcomeScore: 0.86 },
  { title: 'Cloudflare for DNS and DDoS', description: 'Use Cloudflare in front of origin for DNS and protection.', reasoning: 'Free DDoS protection and CDN.', made_by: 'devops', tags: ['cloudflare', 'dns', 'security'], affects: ['devops'], confidence: 'high', domain: 'infrastructure', daysAgo: 20, outcome: 'success', outcomeScore: 0.94 },
  { title: 'GitHub Actions for CI/CD', description: 'Automated build, test, and deploy on push.', reasoning: 'Tight GitHub integration, free for open source.', made_by: 'devops', tags: ['ci', 'devops', 'github'], affects: ['devops'], confidence: 'high', domain: 'ci', daysAgo: 25, outcome: 'success', outcomeScore: 0.91 },
  { title: 'Multi-region deployment on AWS', description: 'Deploy across us-east and eu-west for latency.', reasoning: 'Reduces TTFB for international users.', made_by: 'devops', tags: ['aws', 'deployment', 'multi-region'], affects: ['devops'], confidence: 'medium', domain: 'infrastructure', daysAgo: 10, outcome: 'partial', outcomeScore: 0.65 },
  { title: 'Structured logging with pino', description: 'JSON logs via pino, shipped to Datadog.', reasoning: 'Machine-parseable logs enable filtering and alerts.', made_by: 'devops', tags: ['logging', 'pino', 'observability'], affects: ['backend'], confidence: 'high', domain: 'observability', daysAgo: 23, outcome: 'success', outcomeScore: 0.9 },

  // Testing
  { title: 'Vitest as test runner for all packages', description: 'Unified test runner across the monorepo.', reasoning: 'Fast, ESM-native, great TypeScript support.', made_by: 'reviewer', tags: ['testing', 'vitest'], affects: ['backend', 'frontend'], confidence: 'high', domain: 'testing', daysAgo: 28, outcome: 'success', outcomeScore: 0.92 },
  { title: '80% minimum code coverage', description: 'CI fails if coverage drops below 80%.', reasoning: 'Forces test writing for new features.', made_by: 'reviewer', tags: ['testing', 'coverage'], affects: ['backend', 'frontend'], confidence: 'high', domain: 'testing', daysAgo: 24, outcome: 'success', outcomeScore: 0.85 },
  { title: 'Component tests with React Testing Library', description: 'RTL for component-level tests instead of Enzyme.', reasoning: 'Tests user behavior, not implementation details.', made_by: 'frontend', tags: ['testing', 'react', 'rtl'], affects: ['frontend'], confidence: 'high', domain: 'testing', daysAgo: 16, outcome: 'success', outcomeScore: 0.89 },
  { title: 'Integration tests hit real PostgreSQL', description: 'Use real PG in tests via Docker, not mocks.', reasoning: 'Catches SQL errors that mocks hide.', made_by: 'backend', tags: ['testing', 'integration'], affects: ['backend'], confidence: 'high', domain: 'testing', daysAgo: 13, outcome: 'success', outcomeScore: 0.9 },

  // Misc
  { title: 'Audit log for all decision mutations', description: 'Record every create/update/delete with actor and reason.', reasoning: 'Compliance and debugging.', made_by: 'backend', tags: ['audit', 'compliance'], affects: ['backend'], confidence: 'high', domain: 'compliance', daysAgo: 22, outcome: 'success', outcomeScore: 0.93 },
  { title: 'Drizzle ORM for type-safe SQL', description: 'Proposed Drizzle instead of raw SQL.', reasoning: 'Type-safety without query builder ceremony.', made_by: 'backend', tags: ['orm', 'drizzle'], affects: ['backend'], confidence: 'low', domain: 'database', daysAgo: 12, outcome: 'failure', outcomeScore: 0.35 },
  { title: 'API keys hashed with SHA-256', description: 'Store only SHA-256 hashes of API keys.', reasoning: 'Protects against DB leaks.', made_by: 'security', tags: ['auth', 'api-keys', 'security'], affects: ['backend'], confidence: 'high', domain: 'security', daysAgo: 17, outcome: 'success', outcomeScore: 0.96 },
  { title: 'GIN index on decisions.tags column', description: 'PostgreSQL GIN index for tag queries.', reasoning: 'Enables fast containment queries.', made_by: 'backend', tags: ['database', 'indexing', 'performance'], affects: ['backend'], confidence: 'high', domain: 'performance', daysAgo: 11, outcome: 'success', outcomeScore: 0.88 },
  { title: 'Presence indicators in collaboration UI', description: 'Show who else is viewing a decision in real time.', reasoning: 'Prevents merge conflicts and encourages collaboration.', made_by: 'frontend', tags: ['frontend', 'realtime', 'collaboration'], affects: ['frontend'], confidence: 'medium', domain: 'realtime', daysAgo: 9, outcome: 'partial', outcomeScore: 0.72 },
  { title: 'Optimistic UI updates for messages', description: 'Apply UI changes before server confirms.', reasoning: 'Feels instant, rollback on error.', made_by: 'frontend', tags: ['frontend', 'ux'], affects: ['frontend'], confidence: 'medium', domain: 'frontend', daysAgo: 8, outcome: 'success', outcomeScore: 0.84 },
  { title: 'Feature flags with LaunchDarkly', description: 'Use LaunchDarkly for gradual rollouts.', reasoning: 'Safer deployments with instant rollback.', made_by: 'devops', tags: ['devops', 'feature-flags'], affects: ['backend', 'frontend'], confidence: 'medium', domain: 'deployment', daysAgo: 7, outcome: 'success', outcomeScore: 0.81 },
  { title: 'Session recording with Sentry Session Replay', description: 'Record user sessions for debugging prod issues.', reasoning: 'Sees what users see when errors occur.', made_by: 'frontend', tags: ['frontend', 'monitoring', 'sentry'], affects: ['frontend'], confidence: 'medium', domain: 'observability', daysAgo: 6, outcome: 'partial', outcomeScore: 0.68 },
  { title: 'Storybook for component docs', description: 'Document all components in Storybook.', reasoning: 'Living design system, easier onboarding.', made_by: 'frontend', tags: ['frontend', 'storybook', 'docs'], affects: ['frontend'], confidence: 'high', domain: 'frontend', daysAgo: 15, outcome: 'success', outcomeScore: 0.87 },
  { title: 'Backup to S3 every 6 hours', description: 'Automated PG backups to S3 every 6 hours.', reasoning: 'Reasonable RPO for current scale.', made_by: 'devops', tags: ['backup', 's3', 'disaster-recovery'], affects: ['devops'], confidence: 'high', domain: 'infrastructure', daysAgo: 5, outcome: 'success', outcomeScore: 0.95 },
  { title: 'Weekly dependency updates via Renovate', description: 'Renovate bot opens PRs for dep updates weekly.', reasoning: 'Stays ahead of security patches.', made_by: 'devops', tags: ['devops', 'dependencies', 'security'], affects: ['backend', 'frontend'], confidence: 'high', domain: 'security', daysAgo: 4, outcome: 'success', outcomeScore: 0.91 },
  { title: 'Error budget: 99.9% uptime target', description: 'Define SLO with 0.1% error budget.', reasoning: 'Balances reliability against velocity.', made_by: 'devops', tags: ['slo', 'reliability'], affects: ['devops', 'backend'], confidence: 'medium', domain: 'reliability', daysAgo: 3, outcome: 'success', outcomeScore: 0.82 },
  { title: 'Polyglot persistence with Elasticsearch', description: 'Tried adding Elasticsearch for search.', reasoning: 'Needed more sophisticated search.', made_by: 'backend', tags: ['search', 'elasticsearch'], affects: ['backend'], confidence: 'low', domain: 'database', daysAgo: 2, outcome: 'failure', outcomeScore: 0.28 },
  { title: 'Use pgvector semantic search instead', description: 'Replaced Elasticsearch with pgvector semantic search.', reasoning: 'One fewer service to maintain, good enough quality.', made_by: 'architect', tags: ['search', 'pgvector', 'postgres'], affects: ['backend'], confidence: 'high', domain: 'search', daysAgo: 1, outcome: 'success', outcomeScore: 0.89 },
];

const CONTRADICTION_PAIRS: Array<[string, string, string]> = [
  ['JWT for stateless API authentication', 'Session-based auth with cookies', 'Stateless vs stateful auth approach'],
  ['Use PostgreSQL with pgvector for persistence', 'MongoDB for relational user data', 'Relational vs document DB choice'],
  ['REST API with versioned routes under /v1', 'GraphQL for public API', 'REST vs GraphQL API style'],
  ['Use pgvector semantic search instead', 'Polyglot persistence with Elasticsearch', 'pgvector vs Elasticsearch for search'],
];

const EDGE_PAIRS: Array<[string, string, string]> = [
  ['JWT for stateless API authentication', 'Refresh tokens in HTTP-only cookies', 'requires'],
  ['JWT for stateless API authentication', '15 minute JWT expiry', 'requires'],
  ['Use PostgreSQL with pgvector for persistence', 'Connection pooling via PgBouncer', 'requires'],
  ['Use PostgreSQL with pgvector for persistence', 'GIN index on decisions.tags column', 'enables'],
  ['REST API with versioned routes under /v1', 'Zod validation on all request bodies', 'requires'],
  ['Hono framework for HTTP server', 'Zod validation on all request bodies', 'enables'],
  ['React + Vite for dashboard', 'Tailwind CSS for styling', 'requires'],
  ['React + Vite for dashboard', 'Lucide React for icons', 'requires'],
  ['Docker Compose for local development', 'Deploy to VPS with Docker', 'informs'],
  ['Deploy to VPS with Docker', 'Cloudflare for DNS and DDoS', 'requires'],
  ['JWT for stateless API authentication', 'Session-based auth with cookies', 'supersedes'],
  ['Use PostgreSQL with pgvector for persistence', 'MongoDB for relational user data', 'supersedes'],
  ['Use pgvector semantic search instead', 'Polyglot persistence with Elasticsearch', 'supersedes'],
  ['OAuth2 PKCE for third-party login', 'JWT for stateless API authentication', 'depends_on'],
  ['bcrypt for password hashing with cost 12', 'Rate limit login to 5/min per IP', 'informs'],
  ['Vitest as test runner for all packages', '80% minimum code coverage', 'enables'],
  ['GitHub Actions for CI/CD', '80% minimum code coverage', 'requires'],
  ['WebSocket for real-time updates', 'Presence indicators in collaboration UI', 'enables'],
  ['Structured logging with pino', 'Error budget: 99.9% uptime target', 'enables'],
  ['Audit log for all decision mutations', 'API keys hashed with SHA-256', 'informs'],
];

export async function seedPlaygroundProject(
  db: DatabaseAdapter,
): Promise<{ projectId: string }> {
  const projectId = randomUUID();
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  // 1. Project
  await db.query(
    `INSERT INTO projects (id, name, description, created_at, updated_at, metadata)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      projectId,
      'SaaS Platform Demo',
      'A realistic decision memory for building a multi-tenant SaaS platform.',
      daysAgo(30),
      now,
      '{"playground":true}',
    ],
  );

  // 2. Agents
  for (const agent of AGENTS) {
    await db.query(
      `INSERT INTO agents (id, project_id, name, role, relevance_profile, context_budget_tokens)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        projectId,
        agent.name,
        agent.role,
        JSON.stringify({
          weights: {},
          decision_depth: 2,
          freshness_preference: 'balanced',
          include_superseded: false,
        }),
        50000,
      ],
    );
  }

  // 3. Decisions
  const decisionIds = new Map<string, string>();
  for (const d of DECISIONS) {
    const id = randomUUID();
    decisionIds.set(d.title, id);
    const createdAt = daysAgo(d.daysAgo);
    const status = d.outcome === 'failure' ? 'superseded' : 'active';
    await db.query(
      `INSERT INTO decisions
       (id, project_id, title, description, reasoning, made_by, source, confidence,
        status, alternatives_considered, affects, tags, assumptions, open_questions,
        dependencies, created_at, updated_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, 'manual', ?, ?, '[]', ?, ?, '[]', '[]', '[]', ?, ?, ?)`,
      [
        id,
        projectId,
        d.title,
        d.description,
        d.reasoning,
        d.made_by,
        d.confidence,
        status,
        JSON.stringify(d.affects),
        JSON.stringify(d.tags),
        createdAt,
        createdAt,
        JSON.stringify({ domain: d.domain }),
      ],
    );
  }

  // 4. Decision outcomes
  for (const d of DECISIONS) {
    if (!d.outcome) continue;
    const decisionId = decisionIds.get(d.title);
    if (!decisionId) continue;
    try {
      await db.query(
        `INSERT INTO decision_outcomes
         (id, decision_id, project_id, outcome_type, outcome_score, recorded_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          randomUUID(),
          decisionId,
          projectId,
          d.outcome,
          d.outcomeScore ?? 0.5,
          d.made_by,
          daysAgo(Math.max(0, d.daysAgo - 2)),
        ],
      );
    } catch {
      // outcomes table might have slightly different shape - ignore
    }
  }

  // 5. Decision edges (relationships)
  for (const [srcTitle, tgtTitle, rel] of EDGE_PAIRS) {
    const sourceId = decisionIds.get(srcTitle);
    const targetId = decisionIds.get(tgtTitle);
    if (!sourceId || !targetId) continue;
    try {
      await db.query(
        `INSERT INTO decision_edges (id, source_id, target_id, relationship, description, strength)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [randomUUID(), sourceId, targetId, rel, `${rel} relationship`, 0.8],
      );
    } catch {
      // ignore if edge table shape differs
    }
  }

  // 6. Contradictions
  for (const [aTitle, bTitle, description] of CONTRADICTION_PAIRS) {
    const a = decisionIds.get(aTitle);
    const b = decisionIds.get(bTitle);
    if (!a || !b) continue;
    try {
      await db.query(
        `INSERT INTO contradictions
         (id, project_id, decision_a_id, decision_b_id, similarity_score,
          conflict_description, status, detected_at)
         VALUES (?, ?, ?, ?, ?, ?, 'resolved', ?)`,
        [
          randomUUID(),
          projectId,
          a,
          b,
          0.75,
          description,
          daysAgo(5),
        ],
      );
    } catch {
      // ignore if contradictions table has slightly different shape
    }
  }

  return { projectId };
}
