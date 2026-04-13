/**
 * LongMemEval benchmark runner.
 *
 * Orchestrates ingestion + retrieval + scoring across a set of
 * `LongMemEvalCase` records. Designed to be resumable: partial results are
 * flushed to disk after every case, so a long run can be re-invoked with
 * the same `--output` path and it will pick up where it left off.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Hipp0Client } from '@hipp0/sdk';

import { LongMemEvalIngester, type IngesterOptions } from './ingester.js';
import { filterCases, loadDataset } from './loader.js';
import {
  computeAggregateScores,
  extractAnswerFromMarkdown,
  scoreCase,
} from './scorer.js';
import type {
  BenchmarkRunResult,
  LongMemEvalCase,
  LongMemEvalQuestionType,
  PerCaseResult,
} from './types.js';

export interface RunnerOptions {
  dataPath: string;
  hipp0Url: string;
  apiKey?: string;
  maxCases?: number | null;
  questionTypes?: LongMemEvalQuestionType[];
  outputPath: string;
  compileMaxTokens?: number;
  ingester?: IngesterOptions;
  hipp0Version?: string;
  useLlmExtraction?: boolean;
  /** Called after each case finishes so callers can show progress. */
  onCaseComplete?: (result: PerCaseResult, index: number, total: number) => void;
  /** Called when a case errors so the caller can surface it. */
  onCaseError?: (error: Error, testCase: LongMemEvalCase) => void;
}

const RUNNER_VERSION = '1.0';

/**
 * Load any existing results file at `outputPath` so runs can resume.
 */
function loadExistingResults(outputPath: string): BenchmarkRunResult | null {
  if (!fs.existsSync(outputPath)) return null;
  try {
    const raw = fs.readFileSync(outputPath, 'utf-8');
    const parsed = JSON.parse(raw) as BenchmarkRunResult;
    if (parsed.benchmark === 'longmemeval' && Array.isArray(parsed.per_case)) {
      return parsed;
    }
  } catch {
    /* corrupt previous run — start fresh */
  }
  return null;
}

function ensureDir(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function writeResults(outputPath: string, result: BenchmarkRunResult): void {
  ensureDir(outputPath);
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf-8');
}

/**
 * Run the benchmark end-to-end. Returns the final aggregated result.
 */
export async function runBenchmark(opts: RunnerOptions): Promise<BenchmarkRunResult> {
  const dataset = loadDataset(opts.dataPath);
  const cases = filterCases(dataset, {
    questionTypes: opts.questionTypes,
    limit: opts.maxCases ?? undefined,
  });

  if (cases.length === 0) {
    throw new Error(
      `No LongMemEval cases loaded from ${opts.dataPath}. ` +
        `Check the file format and any --question-type filter.`,
    );
  }

  const client = new Hipp0Client({
    baseUrl: opts.hipp0Url,
    apiKey: opts.apiKey,
  });

  const ingester = new LongMemEvalIngester(client, opts.ingester ?? {});

  // Resume support: skip any question_id we already scored in a prior run.
  const existing = loadExistingResults(opts.outputPath);
  const existingById = new Map<string, PerCaseResult>();
  if (existing) {
    for (const r of existing.per_case) existingById.set(r.question_id, r);
  }

  const perCase: PerCaseResult[] = [];

  const baseResult: BenchmarkRunResult = {
    benchmark: 'longmemeval',
    version: RUNNER_VERSION,
    run_date: new Date().toISOString(),
    hipp0_version: opts.hipp0Version ?? 'unknown',
    dataset_variant: dataset.variant,
    dataset_path: dataset.source_path,
    total_cases: cases.length,
    completed_cases: 0,
    overall: { precision_at_1: 0, recall_at_5: 0, f1: 0 },
    by_question_type: {},
    per_case: [],
    config: {
      hipp0_url: opts.hipp0Url,
      max_cases: opts.maxCases ?? null,
      compile_max_tokens: opts.compileMaxTokens ?? 4000,
      use_llm_extraction: !!opts.useLlmExtraction,
    },
  };

  for (let i = 0; i < cases.length; i++) {
    const testCase = cases[i]!;

    const cached = existingById.get(testCase.question_id);
    if (cached) {
      perCase.push(cached);
      baseResult.completed_cases = perCase.length;
      baseResult.per_case = perCase;
      opts.onCaseComplete?.(cached, i, cases.length);
      continue;
    }

    try {
      const result = await runSingleCase(client, ingester, testCase, opts);
      perCase.push(result);
      baseResult.completed_cases = perCase.length;
      baseResult.per_case = perCase;

      const scores = computeAggregateScores(perCase);
      baseResult.overall = scores.overall;
      baseResult.by_question_type = scores.byQuestionType;

      writeResults(opts.outputPath, baseResult);
      opts.onCaseComplete?.(result, i, cases.length);
    } catch (err) {
      const error = err as Error;
      // Record the failure as a per-case result so the run can still finish.
      const failed: PerCaseResult = {
        question_id: testCase.question_id,
        question_type: testCase.question_type,
        question: testCase.question,
        expected_answer: testCase.answer,
        extracted_answer: '',
        retrieved_context: '',
        correct: false,
        partial_credit: 0,
        ingestion_time_ms: 0,
        compile_time_ms: 0,
        total_time_ms: 0,
        project_id: '',
        error: error.message,
      };
      perCase.push(failed);
      baseResult.completed_cases = perCase.length;
      baseResult.per_case = perCase;
      writeResults(opts.outputPath, baseResult);
      opts.onCaseError?.(error, testCase);
    }
  }

  // Final aggregate pass.
  const scores = computeAggregateScores(perCase);
  baseResult.overall = scores.overall;
  baseResult.by_question_type = scores.byQuestionType;
  writeResults(opts.outputPath, baseResult);

  return baseResult;
}

async function runSingleCase(
  client: Hipp0Client,
  ingester: LongMemEvalIngester,
  testCase: LongMemEvalCase,
  opts: RunnerOptions,
): Promise<PerCaseResult> {
  const caseStarted = Date.now();

  // Step 1: ingest the haystack sessions into a fresh project.
  const ingestion = await ingester.ingestCase(testCase);

  // Step 2: ask Hipp0 to compile context for the question.
  const compileStart = Date.now();
  const pkg = await client.compileContext({
    agent_name: 'assistant',
    project_id: ingestion.project_id,
    task_description: testCase.question,
    max_tokens: opts.compileMaxTokens ?? 4000,
    format: 'markdown',
  });
  const compileElapsed = Date.now() - compileStart;

  const retrievedContext = pkg.formatted_markdown ?? '';
  const extractedAnswer = extractAnswerFromMarkdown(retrievedContext);

  // Step 3: score.
  const verdict = scoreCase(testCase, retrievedContext, extractedAnswer);

  return {
    question_id: testCase.question_id,
    question_type: testCase.question_type,
    question: testCase.question,
    expected_answer: testCase.answer,
    extracted_answer: extractedAnswer,
    retrieved_context: retrievedContext.slice(0, 4000), // keep result files a reasonable size
    correct: verdict.correct,
    partial_credit: verdict.partial_credit,
    ingestion_time_ms: ingestion.ingestion_time_ms,
    compile_time_ms: compileElapsed,
    total_time_ms: Date.now() - caseStarted,
    project_id: ingestion.project_id,
  };
}
