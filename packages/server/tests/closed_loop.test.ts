// -----------------------------------------------------------------------------
// Phase 10 closed-loop integration test (hipp0 side).
//
// Mirrors tests/integration/test_closed_loop.py on the Hermes side.  Verifies
// the hipp0-side half of the chain:
//
//   1. Two decisions D1, D2 are seeded with near-identical relevance.
//   2. First /api/compile call establishes a baseline ordering.
//   3. hermes_outcomes is seeded with a positive signal referencing D1
//      (this is what Hipp0MemoryProvider.record_outcome() writes over the
//      wire — see HIPP0_REQUESTS.md §6 and migration 037). With sqlite/039
//      the decision_outcome_stats view is now defined on SQLite too, so
//      the hermes_outcomes rows feed the view-backed scoring path in the
//      exact same way they would on Postgres. Before the view was
//      SQLite-compatible this code path was unreachable in CI.
//   4. attributeOutcomeToDecisions() is invoked directly against the
//      compile_history row from step 2, which writes decision_outcomes rows
//      and updates outcome_success_rate / outcome_count on the decisions.
//   5. Second /api/compile call is made with the same task.  D1's
//      combined_score must be strictly higher than on the first call
//      via the single outcome_multiplier (the separate hermes trust
//      multiplier was removed — one reaction, one multiplier), and D1
//      must outrank D2.
//
// Uses a real in-memory SQLite DB — same pattern as hermes-e2e.test.ts.
// Only the distillery is stubbed (no network).
// -----------------------------------------------------------------------------

import crypto from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

vi.mock('@hipp0/core/distillery/index.js', async () => {
  const actual = await vi.importActual<typeof import('@hipp0/core/distillery/index.js')>(
    '@hipp0/core/distillery/index.js',
  );
  return {
    ...actual,
    distill: vi.fn(async () => ({
      decisions_extracted: 0,
      contradictions_found: 0,
      decisions: [],
      session_summary: undefined,
    })),
  };
});

vi.stubEnv('NODE_ENV', 'development');
vi.stubEnv('HIPP0_AUTH_REQUIRED', 'false');
vi.stubEnv('DATABASE_URL', '');

import { initDb, closeDb, getDb } from '@hipp0/core/db/index.js';
import type { DatabaseAdapter } from '@hipp0/core/db/adapter.js';
import { attributeOutcomeToDecisions } from '@hipp0/core/intelligence/outcome-memory.js';
import { createApp } from '../src/app.js';

const PROJECT_ID = crypto.randomUUID();
const AGENT_ID = crypto.randomUUID();
const AGENT_NAME = 'closed-loop-agent';
const D1 = crypto.randomUUID();
const D2 = crypto.randomUUID();
const SESSION_ID = crypto.randomUUID();
const TASK = 'Build authentication module for the API';

let app: ReturnType<typeof createApp>;
let db: DatabaseAdapter;

async function req(method: string, path: string, body?: unknown): Promise<Response> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json' };
  }
  return app.fetch(new Request(`http://localhost${path}`, init));
}

beforeAll(async () => {
  db = await initDb({ dialect: 'sqlite', sqlitePath: ':memory:' });
  app = createApp();

  // Project
  await db.query(
    `INSERT INTO projects (id, name, description) VALUES (?, ?, ?)`,
    [PROJECT_ID, 'closed-loop', 'Phase 10 closed-loop test'],
  );

  // Agent — builder role so affects=["builder"] will match.
  // relevance_profile must be the full shape or parseAgent's JSON parse skips
  // the defaults branch and profile.weights comes back undefined.
  const relevanceProfile = JSON.stringify({
    weights: { auth: 0.8, api: 0.6 },
    decision_depth: 2,
    freshness_preference: 'balanced',
    include_superseded: false,
  });
  await db.query(
    `INSERT INTO agents (id, project_id, name, role, relevance_profile)
     VALUES (?, ?, ?, ?, ?)`,
    [AGENT_ID, PROJECT_ID, AGENT_NAME, 'builder', relevanceProfile],
  );

  // Two decisions with distinct content (compile dedupes identical titles)
  // but identical scoring signals (same tags, affects, made_by, confidence)
  // so their baseline combined_score is effectively equal and any trust/
  // outcome multiplier shift cleanly flips the ordering.
  const decisionCols = [
    'project_id', 'title', 'description', 'reasoning', 'made_by',
    'confidence', 'status', 'tags', 'affects',
  ];
  // Intentionally MEDIUM confidence and tangential tags so the baseline
  // combined_score stays well below the 1.0 ceiling — leaves headroom for
  // the trust/outcome multipliers to produce a visible delta on recompile.
  const d1Values = [
    PROJECT_ID,
    'JWT authentication',
    'Use JWT bearer tokens for the API auth flow.',
    'Stateless auth fits the API module well.',
    'architect',
    'medium',
    'active',
    JSON.stringify(['legacy']),
    JSON.stringify(['other-agent']),
  ];
  const d2Values = [
    PROJECT_ID,
    'Session cookie authentication',
    'Use server-side session cookies for the API auth flow.',
    'Cookies survive page reloads on the API module.',
    'architect',
    'medium',
    'active',
    JSON.stringify(['legacy']),
    JSON.stringify(['other-agent']),
  ];
  await db.query(
    `INSERT INTO decisions (id, ${decisionCols.join(', ')})
     VALUES (?, ${decisionCols.map(() => '?').join(', ')})`,
    [D1, ...d1Values],
  );
  await db.query(
    `INSERT INTO decisions (id, ${decisionCols.join(', ')})
     VALUES (?, ${decisionCols.map(() => '?').join(', ')})`,
    [D2, ...d2Values],
  );
});

afterAll(async () => {
  await closeDb();
});

type DecisionResponse = {
  id: string;
  combined_score: number;
  scoring_breakdown: {
    combined: number;
    outcome_multiplier: number;
    trust_multiplier: number;
  };
};

describe('Closed loop — hermes_outcomes + attribution boosts D1 combined_score', () => {
  // We assert on the *pre-normalization* combined score (available as
  // scoring_breakdown.combined) AND the outcome_multiplier, because the
  // final combined_score is re-scaled so the top decision is always 0.95.
  // See context-compiler/index.ts ~L285 (TARGET_MAX = 0.95 normalization).
  const firstRaw: Record<string, number> = {};
  const firstMult: Record<string, { outcome: number; trust: number }> = {};
  let firstCompileHistoryId: string;

  it('1. First /api/compile returns both decisions with neutral multipliers', async () => {
    // debug:true bypasses the compile response cache so the second call after
    // attribution sees fresh scoring instead of the stale first-call payload.
    const res = await req('POST', '/api/compile?format=json', {
      agent_name: AGENT_NAME,
      project_id: PROJECT_ID,
      task_description: TASK,
      debug: true,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      compile_request_id: string;
      decisions: DecisionResponse[];
    };
    firstCompileHistoryId = body.compile_request_id;

    const byId = new Map(body.decisions.map((d) => [d.id, d]));
    expect(byId.has(D1)).toBe(true);
    expect(byId.has(D2)).toBe(true);

    for (const did of [D1, D2]) {
      const d = byId.get(did)!;
      firstRaw[did] = d.scoring_breakdown.combined;
      firstMult[did] = {
        outcome: d.scoring_breakdown.outcome_multiplier,
        trust: d.scoring_breakdown.trust_multiplier,
      };
      // Baseline: no outcomes, no hermes reactions — multipliers are neutral.
      expect(firstMult[did].outcome).toBe(1.0);
    }
  });

  it('2. Seed hermes_outcomes with positive signal referencing D1', async () => {
    // Direct DB write mirrors what POST /api/hermes/outcomes persists.
    await db.query(
      `INSERT INTO hermes_outcomes
       (id, project_id, session_id, outcome, snippet_ids_json, signal_source)
       VALUES (?, ?, ?, 'positive', ?, 'turn_heuristic')`,
      [crypto.randomUUID(), PROJECT_ID, SESSION_ID, JSON.stringify([D1])],
    );
    // A few more positive rows so the small-sample dampening (n/10) gives a
    // visible multiplier — single-row net=1.0 * 0.1 dampening is too small.
    for (let i = 0; i < 9; i++) {
      await db.query(
        `INSERT INTO hermes_outcomes
         (id, project_id, session_id, outcome, snippet_ids_json, signal_source)
         VALUES (?, ?, ?, 'positive', ?, 'turn_heuristic')`,
        [crypto.randomUUID(), PROJECT_ID, SESSION_ID, JSON.stringify([D1])],
      );
    }

    const check = await db.query<Record<string, unknown>>(
      `SELECT COUNT(*) AS n FROM hermes_outcomes WHERE project_id = ?`,
      [PROJECT_ID],
    );
    expect(Number((check.rows[0] as { n: number }).n)).toBe(10);
  });

  it('3. attributeOutcomeToDecisions writes decision_outcomes for D1 and D2', async () => {
    const n = await attributeOutcomeToDecisions({
      compile_history_id: firstCompileHistoryId,
      project_id: PROJECT_ID,
      agent_id: AGENT_ID,
      outcome_type: 'success',
      outcome_score: 0.95,
      task_session_id: SESSION_ID,
      notes: 'closed-loop test',
    });
    // Both decisions participated in the first compile, so both get attributed.
    expect(n).toBeGreaterThanOrEqual(2);

    const outRows = await db.query<Record<string, unknown>>(
      `SELECT decision_id FROM decision_outcomes WHERE project_id = ?`,
      [PROJECT_ID],
    );
    const attributed = new Set(outRows.rows.map((r) => r.decision_id as string));
    expect(attributed.has(D1)).toBe(true);
    expect(attributed.has(D2)).toBe(true);

    // Bias: add extra success outcomes directly for D1 only so its cached
    // outcome_success_rate stays high while D2's stays neutral-ish.  This
    // mirrors the real-world case where only D1 gets repeatedly reinforced.
    for (let i = 0; i < 5; i++) {
      await db.query(
        `INSERT INTO decision_outcomes
         (id, decision_id, project_id, agent_id, outcome_type, outcome_score)
         VALUES (?, ?, ?, ?, 'success', 0.95)`,
        [crypto.randomUUID(), D1, PROJECT_ID, AGENT_ID],
      );
    }
    // Recompute aggregates on D1 so the UPDATE on the decisions row lands.
    const { recomputeOutcomeAggregates } = await import(
      '@hipp0/core/intelligence/outcome-memory.js'
    );
    await recomputeOutcomeAggregates(D1);

    const d1Row = await db.query<Record<string, unknown>>(
      `SELECT outcome_count, outcome_success_rate FROM decisions WHERE id = ?`,
      [D1],
    );
    expect(Number(d1Row.rows[0].outcome_count)).toBeGreaterThanOrEqual(5);
    expect(Number(d1Row.rows[0].outcome_success_rate)).toBeGreaterThan(0.5);
  });

  it('4. Second /api/compile — D1 raw score and multipliers reflect the attribution', async () => {
    // compileContext maintains its own context_cache table keyed by
    // (agent_id, task_hash).  Purge it so the second call actually
    // re-runs scoring against the now-updated decisions.outcome_* columns.
    await db.query(`DELETE FROM context_cache`);

    const res = await req('POST', '/api/compile?format=json', {
      agent_name: AGENT_NAME,
      project_id: PROJECT_ID,
      task_description: TASK,
      debug: true,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      decisions: DecisionResponse[];
    };
    const byId = new Map(body.decisions.map((d) => [d.id, d]));
    const secondD1 = byId.get(D1);
    const secondD2 = byId.get(D2);
    expect(secondD1).toBeDefined();
    expect(secondD2).toBeDefined();

    // Core assertion #1: D1's outcome_multiplier is now ABOVE 1.0 (it was 1.0
    // on the first compile) — proof attributeOutcomeToDecisions wrote the
    // decision_outcomes rows and recomputeOutcomeAggregates propagated the
    // success_rate/count back onto the decisions row.
    expect(secondD1!.scoring_breakdown.outcome_multiplier).toBeGreaterThan(
      firstMult[D1].outcome,
    );
    expect(secondD1!.scoring_breakdown.outcome_multiplier).toBeGreaterThan(1.0);

    // Core assertion #2: D1's pre-normalization combined score went up.
    // With the double-multiply fix, this now reflects the single
    // outcome_multiplier path only. The view-backed and column-backed
    // paths should produce equivalent results since migration 061 aligned
    // their semantics (raw rate, 90-day window).
    expect(secondD1!.scoring_breakdown.combined).toBeGreaterThan(firstRaw[D1]);

    // Core assertion #2b: outcome_source attribution is populated for D1 —
    // either 'view' (hermes_outcomes via decision_outcome_stats on SQLite
    // thanks to migration sqlite/039) or 'column' (legacy path). Must not
    // be 'none' since we seeded well over MIN_OUTCOMES_FOR_EFFECT rows.
    expect(secondD1!.scoring_breakdown.outcome_source).toBeDefined();
    expect(['view', 'column']).toContain(secondD1!.scoring_breakdown.outcome_source);

    // Core assertion #3: D2 is unaffected at best, penalized at worst — we
    // seeded no positive outcomes for D2, and attributeOutcomeToDecisions
    // wrote a single dampened-attribution outcome for it which skews the
    // success_rate slightly below neutral.
    expect(secondD2!.scoring_breakdown.outcome_multiplier).toBeLessThanOrEqual(
      firstMult[D2].outcome,
    );

    // Core assertion #4: D1 now outranks D2.  The final combined_score is
    // normalized (top -> 0.95) so compare either the raw breakdown.combined
    // or the ordering in the response array.
    expect(secondD1!.scoring_breakdown.combined).toBeGreaterThan(
      secondD2!.scoring_breakdown.combined,
    );
    const d1Idx = body.decisions.findIndex((d) => d.id === D1);
    const d2Idx = body.decisions.findIndex((d) => d.id === D2);
    expect(d1Idx).toBeLessThan(d2Idx);
  });

  it('5. invalidateDecisionCaches evicts context_cache rows (not just Redis)', async () => {
    // Regression guard for the Phase 1 bug: before the fix,
    // invalidateDecisionCaches only cleared Redis/in-memory key/value
    // entries with the compile:/stats:/agents: prefixes. The actual
    // compile cache lives in the context_cache table (keyed on
    // agent_id+task_hash, 1h TTL) and nothing on the compile read path
    // touched Redis — so a hermes reaction could not re-rank until the
    // row naturally expired. This test seeds a context_cache row and
    // verifies invalidateDecisionCaches() removes it.
    const fakeCacheId = crypto.randomUUID();
    await db.query(
      `INSERT INTO context_cache
         (id, agent_id, task_hash, compiled_context,
          decision_ids_included, artifact_ids_included, token_count,
          compiled_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now', '+1 hour'))`,
      [
        fakeCacheId,
        AGENT_ID,
        'test-task-hash',
        JSON.stringify({ decisions: [] }),
        JSON.stringify([]),
        JSON.stringify([]),
        0,
      ],
    );

    const before = await db.query<Record<string, unknown>>(
      `SELECT COUNT(*) AS n FROM context_cache WHERE id = ?`,
      [fakeCacheId],
    );
    expect(Number((before.rows[0] as { n: number }).n)).toBe(1);

    const { invalidateDecisionCaches } = await import('../src/cache/redis.js');
    await invalidateDecisionCaches(PROJECT_ID);

    const after = await db.query<Record<string, unknown>>(
      `SELECT COUNT(*) AS n FROM context_cache WHERE id = ?`,
      [fakeCacheId],
    );
    expect(Number((after.rows[0] as { n: number }).n)).toBe(0);
  });

  it('6. POST /api/decisions/:id/outcomes/reset clears trust for a decision', async () => {
    // Verify the reset-trust UX endpoint: by this point in the suite D1 has
    // many decision_outcomes rows (from step 3's biasing loop) and a batch
    // of hermes_outcomes rows (from step 2b's seeding). Reset wipes both,
    // zeros the legacy column, and invalidates compile caches.
    const beforeDec = await db.query<Record<string, unknown>>(
      `SELECT COUNT(*) AS n FROM decision_outcomes WHERE decision_id = ?`,
      [D1],
    );
    expect(Number((beforeDec.rows[0] as { n: number }).n)).toBeGreaterThan(0);
    const beforeHermes = await db.query<Record<string, unknown>>(
      `SELECT COUNT(*) AS n FROM hermes_outcomes
       WHERE project_id = ? AND snippet_ids_json LIKE ?`,
      [PROJECT_ID, '%' + D1 + '%'],
    );
    expect(Number((beforeHermes.rows[0] as { n: number }).n)).toBeGreaterThan(0);

    const res = await req('POST', `/api/decisions/${D1}/outcomes/reset`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      decision_id: string;
      decision_outcomes_deleted: number;
      hermes_outcomes_deleted: number;
    };
    expect(body.decision_id).toBe(D1);
    expect(body.decision_outcomes_deleted).toBeGreaterThan(0);
    expect(body.hermes_outcomes_deleted).toBeGreaterThan(0);

    const afterDec = await db.query<Record<string, unknown>>(
      `SELECT COUNT(*) AS n FROM decision_outcomes WHERE decision_id = ?`,
      [D1],
    );
    expect(Number((afterDec.rows[0] as { n: number }).n)).toBe(0);
    const afterHermes = await db.query<Record<string, unknown>>(
      `SELECT COUNT(*) AS n FROM hermes_outcomes
       WHERE project_id = ? AND snippet_ids_json LIKE ?`,
      [PROJECT_ID, '%' + D1 + '%'],
    );
    expect(Number((afterHermes.rows[0] as { n: number }).n)).toBe(0);

    const colRow = await db.query<Record<string, unknown>>(
      `SELECT outcome_count, outcome_success_rate FROM decisions WHERE id = ?`,
      [D1],
    );
    expect(Number(colRow.rows[0].outcome_count)).toBe(0);
  });

  it('7. attributeOutcomeToDecisions intersects with snippet_ids when provided', async () => {
    // Regression guard for the attribution-intersection fix: a thumbs-up
    // on a single snippet must NOT reward every decision in the cited
    // compile_history — only the decisions whose ids appear in
    // snippet_ids. The /api/hermes/outcomes route passes the validated
    // client-sent snippet_ids into attributeOutcomeToDecisions, which
    // restricts writes to the intersection.
    const baselineRows = await db.query<Record<string, unknown>>(
      `SELECT COUNT(*) AS n FROM decision_outcomes WHERE project_id = ? AND notes = ?`,
      [PROJECT_ID, 'intersection-test'],
    );
    expect(Number((baselineRows.rows[0] as { n: number }).n)).toBe(0);

    // Attribute only D1 even though the compile_history referenced both.
    const n = await attributeOutcomeToDecisions({
      compile_history_id: firstCompileHistoryId,
      project_id: PROJECT_ID,
      agent_id: AGENT_ID,
      outcome_type: 'success',
      outcome_score: 0.95,
      notes: 'intersection-test',
      snippet_ids: [D1],
    });
    expect(n).toBe(1);

    const rows = await db.query<Record<string, unknown>>(
      `SELECT decision_id FROM decision_outcomes
       WHERE project_id = ? AND notes = ?`,
      [PROJECT_ID, 'intersection-test'],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].decision_id).toBe(D1);
  });
});
