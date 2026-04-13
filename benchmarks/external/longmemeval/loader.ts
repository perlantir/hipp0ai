/**
 * LongMemEval dataset loader.
 *
 * Parses the JSON files shipped with xiaowu0162/LongMemEval and normalizes
 * them into typed `LongMemEvalCase` records that the ingester and runner
 * can consume directly. Handles the three canonical variants:
 *   - longmemeval_s.json       (~500 cases, short haystack)
 *   - longmemeval_m.json       (~500 cases, medium haystack)
 *   - longmemeval_oracle.json  (oracle sessions only)
 *
 * The loader is intentionally tolerant: the upstream format has shifted
 * slightly over releases (e.g. `haystack_session_ids` vs numeric indices),
 * so we coerce to our `LongMemEvalCase` shape rather than erroring.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  LoadedDataset,
  LongMemEvalCase,
  LongMemEvalQuestionType,
  LongMemEvalSession,
  LongMemEvalTurn,
} from './types.js';

const VARIANT_MAP: Record<string, LoadedDataset['variant']> = {
  longmemeval_s: 'longmemeval_s',
  longmemeval_m: 'longmemeval_m',
  longmemeval_oracle: 'longmemeval_oracle',
};

const KNOWN_QUESTION_TYPES: LongMemEvalQuestionType[] = [
  'single-session-user',
  'single-session-assistant',
  'single-session-preference',
  'multi-session',
  'knowledge-update',
  'temporal-reasoning',
  'abstention',
];

function detectVariant(filePath: string): LoadedDataset['variant'] {
  const base = path.basename(filePath).toLowerCase();
  for (const key of Object.keys(VARIANT_MAP)) {
    if (base.includes(key)) return VARIANT_MAP[key]!;
  }
  return 'unknown';
}

function coerceQuestionType(raw: unknown): LongMemEvalQuestionType {
  if (typeof raw !== 'string') return 'multi-session';
  const normalized = raw.trim().toLowerCase();
  const hit = KNOWN_QUESTION_TYPES.find((t) => t === normalized);
  if (hit) return hit;
  // Accept a few legacy variants.
  if (normalized === 'single_session_user') return 'single-session-user';
  if (normalized === 'single_session_assistant') return 'single-session-assistant';
  if (normalized === 'multi_session') return 'multi-session';
  if (normalized === 'knowledge_update') return 'knowledge-update';
  if (normalized === 'temporal_reasoning') return 'temporal-reasoning';
  return 'multi-session';
}

function coerceTurn(raw: unknown): LongMemEvalTurn | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const roleRaw = obj.role ?? obj.speaker ?? obj.author;
  const contentRaw = obj.content ?? obj.text ?? obj.message;
  if (typeof contentRaw !== 'string') return null;
  const role = (typeof roleRaw === 'string' ? roleRaw : 'user').toLowerCase();
  const normalizedRole: LongMemEvalTurn['role'] =
    role === 'assistant' ? 'assistant' : role === 'system' ? 'system' : 'user';
  const turn: LongMemEvalTurn = {
    role: normalizedRole,
    content: contentRaw,
  };
  if (typeof obj.timestamp === 'string') turn.timestamp = obj.timestamp;
  if (typeof obj.has_answer === 'boolean') turn.has_answer = obj.has_answer;
  return turn;
}

function coerceSession(raw: unknown): LongMemEvalSession {
  if (!Array.isArray(raw)) return [];
  const out: LongMemEvalSession = [];
  for (const item of raw) {
    const turn = coerceTurn(item);
    if (turn) out.push(turn);
  }
  return out;
}

function coerceCase(raw: unknown, index: number): LongMemEvalCase | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  const question_id =
    typeof obj.question_id === 'string'
      ? obj.question_id
      : typeof obj.id === 'string'
        ? obj.id
        : `case_${index}`;

  const question =
    typeof obj.question === 'string'
      ? obj.question
      : typeof obj.query === 'string'
        ? obj.query
        : '';

  const answer =
    typeof obj.answer === 'string'
      ? obj.answer
      : Array.isArray(obj.answer)
        ? (obj.answer as unknown[]).join(' | ')
        : '';

  if (!question || !answer) return null;

  const rawSessions = Array.isArray(obj.haystack_sessions) ? obj.haystack_sessions : [];
  const haystack_sessions: LongMemEvalSession[] = rawSessions.map((s) => coerceSession(s));

  const rawDates = Array.isArray(obj.haystack_dates) ? obj.haystack_dates : [];
  const haystack_dates: string[] = rawDates.map((d) => (typeof d === 'string' ? d : ''));

  const rawSessionIds = Array.isArray(obj.haystack_session_ids)
    ? obj.haystack_session_ids
    : Array.isArray(obj.session_ids)
      ? obj.session_ids
      : null;

  const haystack_session_ids: string[] = rawSessionIds
    ? rawSessionIds.map((v, i) => (typeof v === 'string' ? v : `session_${i}`))
    : haystack_sessions.map((_, i) => `session_${i}`);

  // Pad / truncate dates so they line up with sessions.
  while (haystack_dates.length < haystack_sessions.length) haystack_dates.push('');
  haystack_dates.length = haystack_sessions.length;

  const rawAnswerIds = Array.isArray(obj.answer_session_ids) ? obj.answer_session_ids : [];
  const answer_session_ids: string[] = rawAnswerIds.filter(
    (v): v is string => typeof v === 'string',
  );

  return {
    question_id,
    question_type: coerceQuestionType(obj.question_type),
    question,
    answer,
    haystack_dates,
    haystack_session_ids,
    haystack_sessions,
    answer_session_ids,
  };
}

/**
 * Parse raw JSON content into a LoadedDataset. Supports:
 *   - a top-level JSON array of case objects
 *   - a JSONL file (one case per line)
 *   - a top-level object with a `data` array
 */
export function parseDatasetContent(
  content: string,
  sourcePath: string,
): LoadedDataset {
  const trimmed = content.trim();
  if (!trimmed) {
    return { source_path: sourcePath, variant: detectVariant(sourcePath), cases: [] };
  }

  let rawCases: unknown[] = [];

  if (trimmed.startsWith('[')) {
    rawCases = JSON.parse(trimmed) as unknown[];
  } else if (trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (Array.isArray(parsed.data)) {
      rawCases = parsed.data as unknown[];
    } else if (Array.isArray(parsed.cases)) {
      rawCases = parsed.cases as unknown[];
    } else {
      // Fall back: treat it as a single case.
      rawCases = [parsed];
    }
  } else {
    // JSONL fallback.
    rawCases = trimmed
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as unknown);
  }

  const cases: LongMemEvalCase[] = [];
  for (let i = 0; i < rawCases.length; i++) {
    const parsed = coerceCase(rawCases[i], i);
    if (parsed) cases.push(parsed);
  }

  return {
    source_path: sourcePath,
    variant: detectVariant(sourcePath),
    cases,
  };
}

/**
 * Load a LongMemEval dataset file from disk.
 */
export function loadDataset(filePath: string): LoadedDataset {
  const absolute = path.resolve(filePath);
  if (!fs.existsSync(absolute)) {
    throw new Error(
      `LongMemEval dataset not found at ${absolute}. ` +
        `Download from https://github.com/xiaowu0162/LongMemEval ` +
        `or https://huggingface.co/datasets/xiaowu0162/longmemeval and point --data-path at the JSON file.`,
    );
  }
  const content = fs.readFileSync(absolute, 'utf-8');
  return parseDatasetContent(content, absolute);
}

/** Utility: filter a loaded dataset by question_type or question_id. */
export function filterCases(
  dataset: LoadedDataset,
  opts: { questionTypes?: LongMemEvalQuestionType[]; ids?: string[]; limit?: number },
): LongMemEvalCase[] {
  let cases = dataset.cases;
  if (opts.questionTypes?.length) {
    const set = new Set(opts.questionTypes);
    cases = cases.filter((c) => set.has(c.question_type));
  }
  if (opts.ids?.length) {
    const set = new Set(opts.ids);
    cases = cases.filter((c) => set.has(c.question_id));
  }
  if (opts.limit !== undefined && opts.limit >= 0) {
    cases = cases.slice(0, opts.limit);
  }
  return cases;
}
