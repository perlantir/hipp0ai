/**
 * Idempotent demo project seeder.
 * Creates a fixed "AI SaaS Platform (Demo)" project with 6 agents,
 * 50 decisions, decision edges, and contradictions for the public
 * playground.
 *
 * Idempotent behavior:
 *   - If demo project does NOT exist: full seed (project + agents + decisions + edges + contradictions)
 *   - If demo project ALREADY exists: UPDATE agent relevance_profiles only
 *     (ensures weighted tags are always current for Super Brain / team-score)
 *
 * Called once on server startup (after migrations).
 */

import { randomUUID } from 'node:crypto';
import { getDb } from '@hipp0/core/db/index.js';
import { DEMO_DATA } from './demo-data.js';

const DEMO_PROJECT_ID = 'de000000-0000-4000-8000-000000000001';

const DEMO_RELEVANCE_WEIGHTS: Record<string, Record<string, number>> = {
  architect: { architecture: 0.9, design: 0.8, database: 0.7, api: 0.7, schema: 0.6, infrastructure: 0.5, scalability: 0.6, 'system-design': 0.8 },
  backend: { api: 0.9, auth: 0.8, database: 0.8, server: 0.7, middleware: 0.7, jwt: 0.6, rest: 0.6, graphql: 0.5 },
  security: { auth: 0.9, security: 0.9, vulnerability: 0.8, encryption: 0.7, owasp: 0.8, jwt: 0.7, rbac: 0.6, audit: 0.6 },
  frontend: { ui: 0.9, css: 0.7, react: 0.8, login: 0.6, form: 0.6, component: 0.7, responsive: 0.6, accessibility: 0.5 },
  devops: { deploy: 0.9, ci: 0.8, cd: 0.8, docker: 0.8, infrastructure: 0.7, monitoring: 0.6, kubernetes: 0.5, terraform: 0.5 },
  marketer: { launch: 0.9, pricing: 0.8, marketing: 0.9, content: 0.7, positioning: 0.7, growth: 0.6, analytics: 0.5, seo: 0.5 },
};

/** Default role profile when getRoleProfile is unavailable */
function defaultProfile(role: string): Record<string, unknown> {
  return {
    role,
    decision_depth: 2,
    include_superseded: false,
    weights: {},
  };
}

/** Try to import getRoleProfile, fall back to default */
async function safeGetRoleProfile(role: string): Promise<Record<string, unknown>> {
  try {
    const mod = await import('@hipp0/core/roles.js');
    return (mod.getRoleProfile as unknown as (r: string) => Record<string, unknown>)(role);
  } catch {
    return defaultProfile(role);
  }
}

/** Edges to create between decisions (by title prefix match). */
const DEMO_EDGES: Array<{ from: string; to: string; rel: string }> = [
  { from: 'JWT authentication', to: 'Refresh token rotation', rel: 'requires' },
  { from: 'Use microservices', to: 'Event-driven communication', rel: 'requires' },
  { from: 'PostgreSQL as primary', to: 'Database connection pooling', rel: 'requires' },
  { from: 'React 19 with Server', to: 'Tailwind CSS with custom', rel: 'informs' },
  { from: 'Hono framework', to: 'Zod validation', rel: 'informs' },
  { from: 'Docker Compose', to: 'GitHub Actions CI/CD', rel: 'informs' },
  { from: 'Freemium model', to: 'Pricing: Free / Pro', rel: 'requires' },
  { from: 'Rate limiting', to: 'JWT authentication', rel: 'depends_on' },
  { from: 'Monorepo with Turborepo', to: 'Docker Compose', rel: 'informs' },
  { from: 'Blue-green deployments', to: 'Fly.io for production', rel: 'depends_on' },
  { from: 'Row Level Security', to: 'JWT authentication', rel: 'depends_on' },
  { from: 'Mobile-first responsive', to: 'React 19 with Server', rel: 'informs' },
];

/** Contradictions to seed. */
const DEMO_CONTRADICTIONS: Array<{ a: string; b: string; desc: string; score: number }> = [
  {
    a: 'GraphQL for client-facing API',
    b: 'Hono framework for all API routes',
    desc: 'GraphQL and Hono REST routes serve overlapping purposes for client-facing APIs. Using both may create confusion about which to use for new endpoints.',
    score: 0.72,
  },
  {
    a: 'Use microservices architecture',
    b: 'Monorepo with Turborepo',
    desc: 'Microservices typically imply separate repos per service for independent deployment, but a monorepo centralizes everything. These approaches have conflicting deployment philosophies.',
    score: 0.65,
  },
  {
    a: 'Dark mode primary, light mode as toggle',
    b: 'Landing page hero with live interactive demo',
    desc: 'A dark-mode-first app may clash with marketing expectations for a bright, inviting landing page hero section.',
    score: 0.48,
  },
];

/**
 * Update demo agent relevance profiles.
 * Called when project already exists to ensure weighted tags are current.
 */
async function updateDemoAgentProfiles(): Promise<void> {
  const db = getDb();
  let updated = 0;

  for (const agentName of Object.keys(DEMO_RELEVANCE_WEIGHTS)) {
    const weights = DEMO_RELEVANCE_WEIGHTS[agentName];
    try {
      // Get current profile
      const result = await db.query(
        'SELECT id, relevance_profile FROM agents WHERE project_id = ? AND name = ?',
        [DEMO_PROJECT_ID, agentName],
      );
      if (result.rows.length === 0) continue;

      const row = result.rows[0] as Record<string, unknown>;
      const agentId = row.id as string;
      let profile: Record<string, unknown>;
      try {
        profile = typeof row.relevance_profile === 'string'
          ? JSON.parse(row.relevance_profile)
          : (row.relevance_profile as Record<string, unknown>) ?? {};
      } catch {
        profile = {};
      }

      // Merge weights into profile
      profile.weights = weights;

      await db.query(
        'UPDATE agents SET relevance_profile = ? WHERE id = ?',
        [JSON.stringify(profile), agentId],
      );
      updated++;
    } catch (err) {
      console.warn(`[hipp0/demo] Failed to update profile for ${agentName}:`, (err as Error).message);
    }
  }

  if (updated > 0) {
    console.warn(`[hipp0/demo] Updated ${updated} demo agent relevance profiles`);
  }
}

export async function seedDemoProject(): Promise<void> {
  const db = getDb();
  const data = DEMO_DATA;

    // Check if demo project already exists
  try {
    const existing = await db.query(
      'SELECT id FROM projects WHERE id = ?',
      [DEMO_PROJECT_ID],
    );
    if (existing.rows.length > 0) {
      // Project exists — update agent profiles and return
      console.warn('[hipp0/demo] Demo project exists — updating agent profiles');
      await updateDemoAgentProfiles();
      return;
    }
  } catch {
    // Table might not exist yet; let it fail later if so
  }

  console.warn('[hipp0/demo] Seeding demo project...');

    // 1. Create demo project
  await db.query(
    `INSERT INTO projects (id, name, description, created_at)
     VALUES (?, ?, ?, ?)`,
    [
      DEMO_PROJECT_ID,
      'AI SaaS Platform (Demo)',
      'A realistic demo project showing how Hipp0 tracks architectural, security, frontend, backend, DevOps, and business decisions for an AI SaaS product.',
      new Date().toISOString(),
    ],
  );

    // 2. Create agents
  const agentIds: Record<string, string> = {};
  for (const agent of data.agents) {
    const id = randomUUID();
    agentIds[agent.name] = id;
    const profile = await safeGetRoleProfile(agent.role);
    // Override weights with demo-specific relevance profiles
    if (DEMO_RELEVANCE_WEIGHTS[agent.name]) {
      profile.weights = DEMO_RELEVANCE_WEIGHTS[agent.name];
    }
    await db.query(
      `INSERT INTO agents (id, project_id, name, role, relevance_profile, context_budget_tokens)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, DEMO_PROJECT_ID, agent.name, agent.role, JSON.stringify(profile), 50000],
    );
  }

    // 3. Create decisions
  const now = Date.now();
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  const decisionIds: Record<string, string> = {};

  for (let i = 0; i < data.decisions.length; i++) {
    const d = data.decisions[i];
    const id = randomUUID();
    decisionIds[d.title] = id;

    const offset = thirtyDays * (1 - i / data.decisions.length);
    const createdAt = new Date(now - offset).toISOString();
    const madeBy = d.affects[0] || 'architect';

    await db.query(
      `INSERT INTO decisions (id, project_id, title, description, reasoning, made_by, source, confidence, status, alternatives_considered, affects, tags, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, DEMO_PROJECT_ID, d.title, d.desc, d.reasoning, madeBy,
        'manual', d.confidence, 'active', JSON.stringify(d.alts),
        db.arrayParam(d.affects), db.arrayParam(d.tags), createdAt,
      ],
    );
  }

    // 4. Create decision edges
  let edgesCreated = 0;
  for (const edge of DEMO_EDGES) {
    const sourceTitle = Object.keys(decisionIds).find((t) => t.startsWith(edge.from));
    const targetTitle = Object.keys(decisionIds).find((t) => t.startsWith(edge.to));
    if (sourceTitle && targetTitle) {
      try {
        await db.query(
          `INSERT INTO decision_edges (id, source_id, target_id, relationship)
           VALUES (?, ?, ?, ?)`,
          [randomUUID(), decisionIds[sourceTitle], decisionIds[targetTitle], edge.rel],
        );
        edgesCreated++;
      } catch { /* Edge table might not exist or constraint violation */ }
    }
  }

    // 5. Create contradictions
  let contradictionsCreated = 0;
  for (const c of DEMO_CONTRADICTIONS) {
    const aTitle = Object.keys(decisionIds).find((t) => t.startsWith(c.a));
    const bTitle = Object.keys(decisionIds).find((t) => t.startsWith(c.b));
    if (aTitle && bTitle) {
      try {
        await db.query(
          `INSERT INTO contradictions (id, project_id, decision_a_id, decision_b_id, similarity_score, conflict_description, status)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [randomUUID(), DEMO_PROJECT_ID, decisionIds[aTitle], decisionIds[bTitle], c.score, c.desc, 'unresolved'],
        );
        contradictionsCreated++;
      } catch { /* Table may not exist */ }
    }
  }

  console.warn(
    `[hipp0/demo] Seeded: 1 project, ${data.agents.length} agents, ${data.decisions.length} decisions, ${edgesCreated} edges, ${contradictionsCreated} contradictions`,
  );
}
