#!/usr/bin/env node
/**
 * E2E seed script.
 * Usage: node e2e/seed.js [--base-url=http://localhost:3001]
 * Prints JSON to stdout with created IDs.
 *
 * Payload shapes verified against packages/server/src/routes/*.ts on
 * fix/contextual-memory-correctness.
 */

const BASE =
  process.argv.find((a) => a.startsWith('--base-url='))?.split('=')[1] ??
  process.env.HIPP0_BASE_URL ??
  'http://localhost:3001';

async function post(path: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`POST ${path} -> ${res.status}: ${txt.slice(0, 300)}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

async function get(path: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

interface SeedResult {
  base_url: string;
  project_id: string;
  agents: Record<string, string>;
  decisions: string[];
  entities: string[];
  outcomes: string[];
  contradictions: string[];
}

const SAMPLE_DECISIONS = [
  {
    title: 'Use PostgreSQL for primary datastore',
    description:
      'PostgreSQL chosen for ACID + JSONB support. Rejected MongoDB because payment flow requires transactions.',
    tags: ['database', 'postgres', 'payments'],
  },
  {
    title: 'OAuth2 + JWT for authentication',
    description:
      'OAuth2 for delegation, JWT for sessions. 30-day refresh token rotation. Rejected sessions-in-cookie because we need multi-device.',
    tags: ['auth', 'security', 'oauth', 'jwt'],
  },
  {
    title: 'Redis for session cache',
    description:
      'Redis chosen over Memcached for pub/sub and persistence. TTL 24h.',
    tags: ['cache', 'redis', 'sessions'],
  },
  {
    title: 'Horizontal scaling via Kubernetes',
    description:
      'K8s with HPA on p95 latency. Prefer stateless services. Session state externalised to Redis.',
    tags: ['infrastructure', 'kubernetes', 'scaling'],
  },
  {
    title: 'Use ClickHouse for event analytics',
    description:
      'Columnar store for funnel + retention queries. Rejected Postgres for this workload: too slow at 1B+ rows.',
    tags: ['analytics', 'clickhouse', 'database'],
  },
  {
    title: 'Structured logging with pino',
    description:
      'pino for JSON logs. Log aggregation via Grafana Loki. Redact PII in middleware.',
    tags: ['observability', 'logging'],
  },
  {
    title: 'Monorepo via pnpm workspaces',
    description:
      'pnpm for disk efficiency. Turbo for build orchestration. Rejected Nx because tooling complexity.',
    tags: ['tooling', 'monorepo', 'pnpm'],
  },
  {
    title: 'TypeScript strict mode everywhere',
    description:
      'noImplicitAny, strictNullChecks, exactOptionalPropertyTypes. Pre-commit hook blocks type errors.',
    tags: ['typescript', 'tooling'],
  },
];

// Contradiction pairs - two decisions that logically conflict. The server
// auto-detects contradictions, but for deterministic seeding we just record
// the pairs so downstream tests can assert detection ran.
const CONTRADICTION_PAIRS = [
  {
    a: {
      title: 'Store session in JWT cookies',
      description:
        'Sessions must be stateless - JWT in httpOnly cookies. Explicitly rejects server-side session storage.',
      tags: ['auth', 'sessions', 'jwt'],
    },
    b: {
      title: 'Store session state in Redis',
      description:
        'All session state lives in Redis with 24h TTL. Explicitly rejects client-side JWT sessions.',
      tags: ['auth', 'sessions', 'redis'],
    },
  },
  {
    a: {
      title: 'Adopt microservices architecture',
      description:
        'Split monolith into 8+ services by domain. Rejects monolith due to team scaling.',
      tags: ['architecture', 'microservices'],
    },
    b: {
      title: 'Keep the monolith',
      description:
        'Deploy a single Rails-style monolith. Rejects microservices due to operational overhead.',
      tags: ['architecture', 'monolith'],
    },
  },
];

async function main(): Promise<void> {
  // Check server health first
  try {
    await get('/api/health');
  } catch (err) {
    throw new Error(`Server not reachable at ${BASE}: ${(err as Error).message}`);
  }

  // 1. Project
  const project = await post('/api/projects', {
    name: 'e2e-test-project',
    description: 'E2E harness seed project',
  });
  const project_id = project.id as string;
  if (!project_id) throw new Error(`Project response missing id: ${JSON.stringify(project)}`);

  // 2. Agents - route is POST /api/projects/:id/agents
  const agents: Record<string, string> = {};
  for (const name of ['architect', 'security', 'implementer']) {
    const a = await post(`/api/projects/${project_id}/agents`, {
      name,
      role: name,
    });
    agents[name] = a.id as string;
  }

  // 3. Decisions - route is POST /api/projects/:id/decisions
  // Required fields: title, description, made_by (string). reasoning defaults
  // to description if omitted.
  const decisions: string[] = [];
  for (const d of SAMPLE_DECISIONS) {
    const res = await post(`/api/projects/${project_id}/decisions`, {
      title: d.title,
      description: d.description,
      made_by: 'architect',
      tags: d.tags,
      confidence: 'high',
      source: 'manual',
    });
    decisions.push(res.id as string);
  }

  // 4. Entities - route is POST /api/entities, response shape {entity, action, tier_changed}
  const entities: string[] = [];
  for (const { title, type } of [
    { title: 'Anthropic', type: 'company' },
    { title: 'PostgreSQL', type: 'tool' },
    { title: 'Redis', type: 'tool' },
  ]) {
    const res = await post('/api/entities', {
      project_id,
      title,
      type,
      source: 'seed',
      summary: `E2E seed for ${title}`,
    });
    const entity = (res.entity as Record<string, unknown> | undefined) ?? res;
    entities.push(entity.id as string);
  }

  // 5. Contradiction seeds - record the pairs as decisions. The server's
  // contradiction detector picks them up out-of-band; tests can poll
  // GET /api/projects/:id/contradictions.
  const contradictions: string[] = [];
  for (const pair of CONTRADICTION_PAIRS) {
    const a = await post(`/api/projects/${project_id}/decisions`, {
      title: pair.a.title,
      description: pair.a.description,
      made_by: 'architect',
      tags: pair.a.tags,
      confidence: 'high',
      source: 'manual',
    });
    const b = await post(`/api/projects/${project_id}/decisions`, {
      title: pair.b.title,
      description: pair.b.description,
      made_by: 'security',
      tags: pair.b.tags,
      confidence: 'high',
      source: 'manual',
    });
    contradictions.push(`${a.id as string}:${b.id as string}`);
    decisions.push(a.id as string, b.id as string);
  }

  // 6. Outcomes - route is POST /api/outcomes with {decision_id, project_id, ...}
  const outcomes: string[] = [];
  const outcomeTargets = decisions.slice(0, 5);
  for (let i = 0; i < outcomeTargets.length; i++) {
    const decision_id = outcomeTargets[i];
    const res = await post('/api/outcomes', {
      decision_id,
      project_id,
      agent_id: agents.implementer,
      outcome_type: i % 2 === 0 ? 'success' : 'failure',
      outcome_score: i % 2 === 0 ? 0.9 : 0.2,
    });
    const oid = (res.id as string | undefined) ?? `outcome-${i}`;
    outcomes.push(oid);
  }

  const result: SeedResult = {
    base_url: BASE,
    project_id,
    agents,
    decisions,
    entities,
    outcomes,
    contradictions,
  };
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error('Seed failed:', e);
  process.exit(1);
});
