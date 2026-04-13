#!/usr/bin/env npx tsx
/**
 * LongMemEval command-line entry point.
 *
 * Example:
 *   npx tsx benchmarks/external/longmemeval/cli.ts \
 *     --data-path ./data/longmemeval_s.json \
 *     --hipp0-url http://localhost:3100 \
 *     --api-key $HIPP0_API_KEY \
 *     --max-cases 10 \
 *     --output benchmarks/results/external/longmemeval/run.json
 */

import * as path from 'node:path';
import * as fs from 'node:fs';

import { runBenchmark, type RunnerOptions } from './runner.js';
import type { LongMemEvalQuestionType } from './types.js';

interface CliArgs {
  dataPath: string;
  hipp0Url: string;
  apiKey?: string;
  maxCases: number | null;
  output: string;
  questionTypes?: LongMemEvalQuestionType[];
  useDistillery: boolean;
  compileMaxTokens: number;
  help: boolean;
  hipp0Version: string;
}

const DEFAULTS: CliArgs = {
  dataPath: './data/longmemeval_s.json',
  hipp0Url: 'http://localhost:3100',
  apiKey: process.env.HIPP0_API_KEY,
  maxCases: null,
  output: 'benchmarks/results/external/longmemeval/latest.json',
  useDistillery: false,
  compileMaxTokens: 4000,
  help: false,
  hipp0Version: process.env.HIPP0_VERSION ?? 'unknown',
};

function printHelp(): void {
  const lines = [
    'LongMemEval runner for Hipp0',
    '',
    'Usage:',
    '  npx tsx benchmarks/external/longmemeval/cli.ts [options]',
    '',
    'Options:',
    '  --data-path <path>        Path to a LongMemEval JSON file',
    '                            (longmemeval_s.json, longmemeval_m.json, longmemeval_oracle.json)',
    '  --hipp0-url <url>         URL of a running Hipp0 server (default http://localhost:3100)',
    '  --api-key <key>           Hipp0 API key (falls back to $HIPP0_API_KEY)',
    '  --max-cases <n>           Only run the first N cases',
    '  --output <path>           Where to write results JSON',
    '  --question-type <type>    Only run this question_type (repeatable)',
    '  --use-distillery          Use /api/capture + LLM distillery instead of direct record',
    '  --compile-max-tokens <n>  Token budget for context compilation (default 4000)',
    '  --hipp0-version <ver>     Label the result file with a Hipp0 version string',
    '  --help                    Print this message',
    '',
    'Data download:',
    '  The dataset is available at https://huggingface.co/datasets/xiaowu0162/longmemeval',
    '  or via GitHub at https://github.com/xiaowu0162/LongMemEval',
    '',
  ];
  // eslint-disable-next-line no-console
  console.log(lines.join('\n'));
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { ...DEFAULTS, questionTypes: undefined };
  const qtypes: LongMemEvalQuestionType[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = argv[i + 1];
    switch (arg) {
      case '--data-path':
        args.dataPath = next!;
        i++;
        break;
      case '--hipp0-url':
        args.hipp0Url = next!;
        i++;
        break;
      case '--api-key':
        args.apiKey = next!;
        i++;
        break;
      case '--max-cases':
        args.maxCases = Number.parseInt(next!, 10);
        i++;
        break;
      case '--output':
        args.output = next!;
        i++;
        break;
      case '--question-type':
        qtypes.push(next as LongMemEvalQuestionType);
        i++;
        break;
      case '--use-distillery':
        args.useDistillery = true;
        break;
      case '--compile-max-tokens':
        args.compileMaxTokens = Number.parseInt(next!, 10);
        i++;
        break;
      case '--hipp0-version':
        args.hipp0Version = next!;
        i++;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        if (arg.startsWith('--')) {
          // eslint-disable-next-line no-console
          console.warn(`[longmemeval] unknown flag: ${arg}`);
        }
    }
  }
  if (qtypes.length > 0) args.questionTypes = qtypes;
  return args;
}

async function loadOra(): Promise<((text: string) => {
  start: () => { succeed: (t?: string) => void; fail: (t?: string) => void; text: string };
}) | null> {
  try {
    const mod = (await import('ora')) as { default: (text: string) => unknown };
    return mod.default as unknown as (text: string) => {
      start: () => { succeed: (t?: string) => void; fail: (t?: string) => void; text: string };
    };
  } catch {
    return null;
  }
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  if (!fs.existsSync(args.dataPath)) {
    // eslint-disable-next-line no-console
    console.error(`[longmemeval] data path not found: ${args.dataPath}`);
    // eslint-disable-next-line no-console
    console.error(
      '  Download from https://huggingface.co/datasets/xiaowu0162/longmemeval and re-run with --data-path.',
    );
    process.exitCode = 1;
    return;
  }

  const output = path.resolve(args.output);
  const ora = await loadOra();
  let activeSpinner: ReturnType<ReturnType<NonNullable<typeof ora>>['start']> | null = null;

  const runnerOpts: RunnerOptions = {
    dataPath: args.dataPath,
    hipp0Url: args.hipp0Url,
    apiKey: args.apiKey,
    maxCases: args.maxCases,
    outputPath: output,
    questionTypes: args.questionTypes,
    compileMaxTokens: args.compileMaxTokens,
    hipp0Version: args.hipp0Version,
    ingester: {
      useDistillery: args.useDistillery,
    },
    onCaseComplete: (result, index, total) => {
      if (activeSpinner) {
        const status = result.correct ? 'ok' : result.error ? 'err' : 'miss';
        activeSpinner.succeed(
          `[${index + 1}/${total}] ${result.question_id} · ${result.question_type} · ${status} · ${formatMs(result.total_time_ms)}`,
        );
      } else {
        // eslint-disable-next-line no-console
        console.log(
          `[${index + 1}/${total}] ${result.question_id} ${result.question_type} ${result.correct ? 'OK' : 'MISS'} ${formatMs(result.total_time_ms)}`,
        );
      }
      if (ora && index + 1 < total) {
        activeSpinner = ora(`running case ${index + 2}/${total}`).start();
      } else {
        activeSpinner = null;
      }
    },
    onCaseError: (error, testCase) => {
      if (activeSpinner) {
        activeSpinner.fail(`[${testCase.question_id}] ${error.message}`);
        activeSpinner = null;
      } else {
        // eslint-disable-next-line no-console
        console.error(`[longmemeval] case ${testCase.question_id} failed: ${error.message}`);
      }
    },
  };

  // eslint-disable-next-line no-console
  console.log(`[longmemeval] data=${args.dataPath}`);
  // eslint-disable-next-line no-console
  console.log(`[longmemeval] hipp0=${args.hipp0Url}`);
  // eslint-disable-next-line no-console
  console.log(`[longmemeval] output=${output}`);
  // eslint-disable-next-line no-console
  console.log(
    `[longmemeval] mode=${args.useDistillery ? 'distillery (LLM extraction)' : 'direct record (fast)'}`,
  );

  if (ora) {
    activeSpinner = ora('running case 1').start();
  }

  const result = await runBenchmark(runnerOpts);

  if (activeSpinner) {
    activeSpinner.succeed('done');
    activeSpinner = null;
  }

  // eslint-disable-next-line no-console
  console.log('');
  // eslint-disable-next-line no-console
  console.log('=== LongMemEval Results ===');
  // eslint-disable-next-line no-console
  console.log(`  Cases:       ${result.completed_cases}/${result.total_cases}`);
  // eslint-disable-next-line no-console
  console.log(`  Precision@1: ${(result.overall.precision_at_1 * 100).toFixed(1)}%`);
  // eslint-disable-next-line no-console
  console.log(`  Recall@5:    ${(result.overall.recall_at_5 * 100).toFixed(1)}%`);
  // eslint-disable-next-line no-console
  console.log(`  F1:          ${(result.overall.f1 * 100).toFixed(1)}%`);
  // eslint-disable-next-line no-console
  console.log('');
  // eslint-disable-next-line no-console
  console.log('  By question type:');
  for (const [qt, scores] of Object.entries(result.by_question_type)) {
    // eslint-disable-next-line no-console
    console.log(
      `    ${qt.padEnd(28)} n=${String(scores.cases).padStart(3)}  P@1=${(scores.precision_at_1 * 100).toFixed(1)}%  R@5=${(scores.recall_at_5 * 100).toFixed(1)}%  F1=${(scores.f1 * 100).toFixed(1)}%`,
    );
  }
  // eslint-disable-next-line no-console
  console.log('');
  // eslint-disable-next-line no-console
  console.log(`  Results written to ${output}`);
}

main().catch((err: Error) => {
  // eslint-disable-next-line no-console
  console.error('[longmemeval] fatal:', err.stack ?? err.message);
  process.exitCode = 1;
});
