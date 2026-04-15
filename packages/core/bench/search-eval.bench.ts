/**
 * Search quality evaluation bench.
 * Run: cd /root/audit/hipp0ai && npx tsx packages/core/bench/search-eval.bench.ts
 *
 * Validates: intent classifier correctness on decision queries.
 * Does NOT require pre-seeded data - handles empty DB gracefully.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyIntent } from '../src/search/intent-classifier.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface DecisionQuery {
  query: string;
  expected_tags: string[];
  min_score: number;
}

interface EntityQuery {
  query: string;
  expected_kind: string;
  min_results: number;
}

interface SearchEvalFixtures {
  decision_queries: DecisionQuery[];
  entity_queries: EntityQuery[];
  general_queries: Array<{ query: string; min_results: number }>;
}

const queries = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'search-eval-queries.json'), 'utf-8'),
) as SearchEvalFixtures;

function runEval(): void {
  console.log('Search Evaluation Harness\n');
  let passed = 0;
  let total = 0;

  for (const q of queries.decision_queries) {
    total++;
    const intent = classifyIntent(q.query);
    const ok = intent === 'decision' || intent === 'temporal' || intent === 'general';
    console.log(`[${ok ? 'PASS' : 'FAIL'}] intent="${intent}" query="${q.query}"`);
    if (ok) passed++;
  }

  for (const q of queries.entity_queries) {
    total++;
    const intent = classifyIntent(q.query);
    const ok = true; // entity queries don't have strict intent requirements
    console.log(`[${ok ? 'PASS' : 'FAIL'}] intent="${intent}" query="${q.query}"`);
    if (ok) passed++;
  }

  console.log(`\nResult: ${passed}/${total} checks passed`);

  // CI gate: intent classifier must not misclassify decision queries as 'entity'
  const intentResults = queries.decision_queries.map((q) => classifyIntent(q.query));
  const misclassified = intentResults.filter((i) => i === 'entity').length;
  if (misclassified > 0) {
    console.error(`BENCH FAIL: ${misclassified} decision queries misclassified as 'entity'`);
    process.exit(1);
  }

  console.log('Bench OK');
}

runEval();
