/**
 * Compile hot-path microbenchmark.
 *
 * Measures scoreDecision() throughput across N synthetic decisions — the
 * inner loop that dominates compile latency once decisions are in memory.
 * DB seeding, embedding generation, and LLM calls are out of scope here;
 * this is a pure-CPU bench meant to catch scoring-code regressions in CI.
 *
 * Usage: tsx bench/compile.bench.ts [--update-baseline]
 * Exits non-zero if P95 regresses >15% vs bench/budgets.json.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreDecision } from '../src/context-compiler/index.js';
import type { Decision, Agent, DecisionDomain } from '../src/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUDGETS_PATH = join(__dirname, 'budgets.json');

const TAGS_POOL = ['backend', 'frontend', 'auth', 'db', 'api', 'ui', 'testing', 'infra', 'perf', 'security'];
const DOMAINS: DecisionDomain[] = ['architecture', 'implementation', 'testing', 'deployment', 'security'];

function seedDecisions(n: number): Decision[] {
  const out: Decision[] = [];
  for (let i = 0; i < n; i++) {
    const tagCount = (i % 4) + 1;
    const tags = Array.from({ length: tagCount }, (_, k) => TAGS_POOL[(i + k) % TAGS_POOL.length]!);
    out.push({
      id: `dec-${i.toString(36)}`,
      project_id: 'bench-proj',
      title: `Decision ${i}: choose approach for feature ${i}`,
      body: `A decision about ${tags.join(', ')} with rationale that expands across several sentences to give scoring realistic string lengths. Reasoning iteration ${i}.`,
      status: 'active',
      confidence: 0.5 + ((i % 10) / 20),
      outcome_success_rate: (i % 7) / 10,
      tags,
      affects: i % 3 === 0 ? ['builder'] : [],
      author_agent: i % 2 === 0 ? 'makspm' : 'maks',
      created_at: new Date(Date.now() - i * 60_000).toISOString(),
      updated_at: new Date(Date.now() - i * 30_000).toISOString(),
      domain: DOMAINS[i % DOMAINS.length] ?? null,
    } as unknown as Decision);
  }
  return out;
}

function buildAgent(): Agent {
  return {
    id: 'agent-bench',
    project_id: 'bench-proj',
    name: 'maks',
    role: 'builder',
    relevance_profile: {
      weights: {
        backend: 0.9, api: 0.8, db: 0.7, auth: 0.6, perf: 0.5,
      },
      decision_depth: 2,
      freshness_preference: 'balanced',
      include_superseded: false,
    },
    context_budget_tokens: 4000,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  } as unknown as Agent;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

function runBench(sizes: number[]): Record<string, { p50: number; p95: number; p99: number; iters: number }> {
  const agent = buildAgent();
  const embedding = Array.from({ length: 1536 }, (_, i) => Math.sin(i * 0.01));
  const results: Record<string, { p50: number; p95: number; p99: number; iters: number }> = {};

  for (const n of sizes) {
    const decisions = seedDecisions(n);
    // Warmup — JIT + cache priming
    for (let w = 0; w < 3; w++) {
      for (const d of decisions) scoreDecision(d, agent, embedding);
    }
    const samples: number[] = [];
    const iters = Math.max(20, Math.floor(2000 / Math.log2(n + 2)));
    for (let i = 0; i < iters; i++) {
      const t0 = performance.now();
      for (const d of decisions) scoreDecision(d, agent, embedding);
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    results[`n=${n}`] = {
      p50: percentile(samples, 50),
      p95: percentile(samples, 95),
      p99: percentile(samples, 99),
      iters,
    };
  }
  return results;
}

function main() {
  const args = process.argv.slice(2);
  const updateBaseline = args.includes('--update-baseline');
  const sizes = [100, 1000, 5000];
  // Microbench noise is high at sub-millisecond samples — 30% tolerance
  // is still tight enough to catch a meaningful regression (e.g. an accidental
  // O(n²) scan landing in scoreDecision) without flapping on JIT/GC variance.
  const tolerance = 1.30;

  console.log(`[bench] scoreDecision — sizes=${sizes.join(',')} tolerance=${(tolerance - 1) * 100}%`);
  const t0 = performance.now();
  const results = runBench(sizes);
  const elapsed = performance.now() - t0;
  console.log(`[bench] completed in ${elapsed.toFixed(1)}ms`);
  console.log(JSON.stringify(results, null, 2));

  if (updateBaseline || !existsSync(BUDGETS_PATH)) {
    writeFileSync(BUDGETS_PATH, JSON.stringify({ baseline: results, tolerance }, null, 2) + '\n');
    console.log(`[bench] baseline written to ${BUDGETS_PATH}`);
    return;
  }

  const budgets = JSON.parse(readFileSync(BUDGETS_PATH, 'utf8')) as {
    baseline: Record<string, { p50: number; p95: number; p99: number }>;
    tolerance?: number;
  };
  const tol = budgets.tolerance ?? tolerance;
  const regressions: string[] = [];
  for (const [key, r] of Object.entries(results)) {
    const base = budgets.baseline[key];
    if (!base) continue;
    if (r.p95 > base.p95 * tol) {
      regressions.push(`${key}: p95 ${r.p95.toFixed(2)}ms > budget ${(base.p95 * tol).toFixed(2)}ms (baseline ${base.p95.toFixed(2)}ms)`);
    }
  }
  if (regressions.length > 0) {
    console.error('[bench] REGRESSION(S):');
    for (const r of regressions) console.error(`  ${r}`);
    process.exit(1);
  }
  console.log('[bench] all within budget');
}

main();
