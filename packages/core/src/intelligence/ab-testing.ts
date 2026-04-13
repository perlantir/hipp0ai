/**
 * Decision A/B Testing Framework
 *
 * Allows users to run experiments comparing two decisions to see which
 * produces better outcomes. Supports traffic splitting, result computation,
 * and statistical significance testing via z-test for proportions.
 */
import { getDb } from '../db/index.js';
import { randomUUID } from 'node:crypto';

//  Types 

export interface Experiment {
  id: string;
  project_id: string;
  name: string;
  decision_a_id: string;
  decision_b_id: string;
  traffic_split: number;
  status: 'running' | 'completed' | 'cancelled';
  winner: 'a' | 'b' | 'inconclusive' | null;
  started_at: string;
  ended_at: string | null;
  created_at: string;
}

export interface ExperimentGroupResult {
  compiles: number;
  outcomes: number;
  success_rate: number;
}

export interface ExperimentResults {
  experiment: Experiment;
  decision_a: ExperimentGroupResult;
  decision_b: ExperimentGroupResult;
  winner: 'a' | 'b' | 'inconclusive' | null;
  p_value: number | null;
  is_significant: boolean;
}

//  Helpers 

function parseExperiment(row: Record<string, unknown>): Experiment {
  return {
    id: row.id as string,
    project_id: row.project_id as string,
    name: row.name as string,
    decision_a_id: row.decision_a_id as string,
    decision_b_id: row.decision_b_id as string,
    traffic_split: Number(row.traffic_split ?? 0.5),
    status: row.status as Experiment['status'],
    winner: (row.winner as Experiment['winner']) ?? null,
    started_at: row.started_at as string,
    ended_at: (row.ended_at as string) ?? null,
    created_at: row.created_at as string,
  };
}

/**
 * Two-proportion z-test.
 * Returns the two-tailed p-value for the null hypothesis that p1 == p2.
 */
function zTestProportions(
  successes1: number,
  n1: number,
  successes2: number,
  n2: number,
): number {
  if (n1 === 0 || n2 === 0) return 1;
  const p1 = successes1 / n1;
  const p2 = successes2 / n2;
  const pPooled = (successes1 + successes2) / (n1 + n2);
  const se = Math.sqrt(pPooled * (1 - pPooled) * (1 / n1 + 1 / n2));
  if (se === 0) return 1;
  const z = (p1 - p2) / se;
  // Two-tailed p-value using a rational approximation of the normal CDF
  const pValue = 2 * (1 - normalCDF(Math.abs(z)));
  return pValue;
}

/**
 * Approximation of the standard normal CDF using Abramowitz & Stegun (formula 7.1.26).
 */
function normalCDF(x: number): number {
  if (x < -8) return 0;
  if (x > 8) return 1;
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const t = 1.0 / (1.0 + p * absX);
  const y =
    1.0 -
    ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX / 2);
  return 0.5 * (1.0 + sign * y);
}

//  Core Functions ─

/**
 * Create a new A/B experiment for two decisions in a project.
 */
export async function createExperiment(
  projectId: string,
  params: {
    name: string;
    decision_a_id: string;
    decision_b_id: string;
    traffic_split?: number;
    duration_days?: number;
  },
): Promise<Experiment> {
  const db = getDb();
  const id = randomUUID();
  const trafficSplit = Math.max(0, Math.min(1, params.traffic_split ?? 0.5));

  await db.query(
    `INSERT INTO decision_experiments
     (id, project_id, name, decision_a_id, decision_b_id, traffic_split, status, started_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'running', datetime('now'), datetime('now'))`,
    [id, projectId, params.name, params.decision_a_id, params.decision_b_id, trafficSplit],
  );

  const result = await db.query<Record<string, unknown>>(
    'SELECT * FROM decision_experiments WHERE id = ?',
    [id],
  );

  return parseExperiment(result.rows[0]);
}

/**
 * List all active (running) experiments for a project.
 */
export async function getActiveExperiments(projectId: string): Promise<Experiment[]> {
  const db = getDb();
  const result = await db.query<Record<string, unknown>>(
    `SELECT * FROM decision_experiments
     WHERE project_id = ? AND status = 'running'
     ORDER BY created_at DESC`,
    [projectId],
  );
  return result.rows.map(parseExperiment);
}

/**
 * Get all experiments for a project (any status).
 */
export async function getExperiments(projectId: string): Promise<Experiment[]> {
  const db = getDb();
  const result = await db.query<Record<string, unknown>>(
    `SELECT * FROM decision_experiments
     WHERE project_id = ?
     ORDER BY created_at DESC`,
    [projectId],
  );
  return result.rows.map(parseExperiment);
}

/**
 * Compute results for an experiment: compare outcomes between the two decision groups.
 *
 * For each decision (A and B), we count:
 * - Compiles: compile_history rows whose decision_ids JSON array includes that decision
 * - Outcomes: compile_outcomes rows for those compiles where task_completed = 1
 * - Success rate: outcomes / compiles
 *
 * A z-test for proportions determines statistical significance (p < 0.05).
 */
export async function getExperimentResults(experimentId: string): Promise<ExperimentResults> {
  const db = getDb();

  // Fetch the experiment
  const expResult = await db.query<Record<string, unknown>>(
    'SELECT * FROM decision_experiments WHERE id = ?',
    [experimentId],
  );
  if (expResult.rows.length === 0) {
    throw new Error(`Experiment ${experimentId} not found`);
  }
  const experiment = parseExperiment(expResult.rows[0]);

  // Count compiles that included decision A
  const compilesA = await db.query<Record<string, unknown>>(
    `SELECT COUNT(*) as cnt FROM compile_history
     WHERE project_id = ? AND decision_ids LIKE ?
     AND compiled_at >= ?`,
    [experiment.project_id, `%${experiment.decision_a_id}%`, experiment.started_at],
  );

  // Count compiles that included decision B
  const compilesB = await db.query<Record<string, unknown>>(
    `SELECT COUNT(*) as cnt FROM compile_history
     WHERE project_id = ? AND decision_ids LIKE ?
     AND compiled_at >= ?`,
    [experiment.project_id, `%${experiment.decision_b_id}%`, experiment.started_at],
  );

  // Count successful outcomes for decision A compiles
  const outcomesA = await db.query<Record<string, unknown>>(
    `SELECT COUNT(*) as cnt FROM compile_outcomes co
     JOIN compile_history ch ON ch.id = co.compile_history_id
     WHERE ch.project_id = ? AND ch.decision_ids LIKE ?
     AND ch.compiled_at >= ?
     AND co.task_completed = 1`,
    [experiment.project_id, `%${experiment.decision_a_id}%`, experiment.started_at],
  );

  // Count successful outcomes for decision B compiles
  const outcomesB = await db.query<Record<string, unknown>>(
    `SELECT COUNT(*) as cnt FROM compile_outcomes co
     JOIN compile_history ch ON ch.id = co.compile_history_id
     WHERE ch.project_id = ? AND ch.decision_ids LIKE ?
     AND ch.compiled_at >= ?
     AND co.task_completed = 1`,
    [experiment.project_id, `%${experiment.decision_b_id}%`, experiment.started_at],
  );

  const nA = parseInt(String(compilesA.rows[0]?.cnt ?? '0'), 10);
  const nB = parseInt(String(compilesB.rows[0]?.cnt ?? '0'), 10);
  const sA = parseInt(String(outcomesA.rows[0]?.cnt ?? '0'), 10);
  const sB = parseInt(String(outcomesB.rows[0]?.cnt ?? '0'), 10);

  const rateA = nA > 0 ? sA / nA : 0;
  const rateB = nB > 0 ? sB / nB : 0;

  // Statistical test
  let pValue: number | null = null;
  let isSignificant = false;
  let winner: 'a' | 'b' | 'inconclusive' | null = null;

  if (nA > 0 && nB > 0) {
    pValue = zTestProportions(sA, nA, sB, nB);
    isSignificant = pValue < 0.05;
    if (isSignificant) {
      winner = rateA > rateB ? 'a' : rateA < rateB ? 'b' : 'inconclusive';
    } else {
      winner = 'inconclusive';
    }
  }

  return {
    experiment,
    decision_a: { compiles: nA, outcomes: sA, success_rate: Math.round(rateA * 10000) / 10000 },
    decision_b: { compiles: nB, outcomes: sB, success_rate: Math.round(rateB * 10000) / 10000 },
    winner: experiment.status === 'completed' ? experiment.winner : winner,
    p_value: pValue !== null ? Math.round(pValue * 10000) / 10000 : null,
    is_significant: isSignificant,
  };
}

/**
 * Resolve an experiment by declaring a winner and marking it complete.
 */
export async function resolveExperiment(
  experimentId: string,
  winner: 'a' | 'b' | 'inconclusive',
): Promise<Experiment> {
  const db = getDb();

  await db.query(
    `UPDATE decision_experiments
     SET status = 'completed', winner = ?, ended_at = datetime('now')
     WHERE id = ? AND status = 'running'`,
    [winner, experimentId],
  );

  const result = await db.query<Record<string, unknown>>(
    'SELECT * FROM decision_experiments WHERE id = ?',
    [experimentId],
  );
  if (result.rows.length === 0) {
    throw new Error(`Experiment ${experimentId} not found`);
  }

  return parseExperiment(result.rows[0]);
}

/**
 * Traffic split resolver: given an active experiment and a random value [0, 1),
 * determine which decision to serve.
 * Returns 'a' if random < traffic_split, otherwise 'b'.
 */
export function resolveTrafficSplit(experiment: Experiment): 'a' | 'b' {
  const rand = Math.random();
  return rand < experiment.traffic_split ? 'a' : 'b';
}
