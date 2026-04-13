/**
 * Shared types for the LongMemEval benchmark harness.
 */

export type LongMemEvalQuestionType =
  | 'single-session-user'
  | 'single-session-assistant'
  | 'single-session-preference'
  | 'multi-session'
  | 'knowledge-update'
  | 'temporal-reasoning'
  | 'abstention';

export interface LongMemEvalTurn {
  role: 'user' | 'assistant' | 'system';
  content: string;
  /** Optional timestamp (ISO string). Some splits include per-turn dates. */
  timestamp?: string;
  /** Marker used by the dataset to flag evidence turns. */
  has_answer?: boolean;
}

export type LongMemEvalSession = LongMemEvalTurn[];

/**
 * A single LongMemEval test case, as parsed from one of the dataset JSON files.
 *
 * The upstream dataset ships three files (`longmemeval_s.json`,
 * `longmemeval_m.json`, `longmemeval_oracle.json`). All three use the same
 * record shape described below; only the number of distractor sessions
 * (the "haystack") differs.
 */
export interface LongMemEvalCase {
  question_id: string;
  question_type: LongMemEvalQuestionType;
  question: string;
  answer: string;
  /** Parallel array to `haystack_sessions` — one timestamp per session. */
  haystack_dates: string[];
  /**
   * Parallel array to `haystack_sessions` — the session id the dataset
   * assigns to each conversation. Used by `answer_session_ids` to point at
   * the evidence sessions.
   */
  haystack_session_ids: string[];
  /** The conversation haystack this test case is evaluated over. */
  haystack_sessions: LongMemEvalSession[];
  /** Session ids that contain the evidence for the answer. */
  answer_session_ids: string[];
}

export interface LoadedDataset {
  source_path: string;
  variant: 'longmemeval_s' | 'longmemeval_m' | 'longmemeval_oracle' | 'unknown';
  cases: LongMemEvalCase[];
}

export interface IngestionResult {
  project_id: string;
  project_name: string;
  session_count: number;
  turn_count: number;
  decisions_created: number;
  ingestion_time_ms: number;
}

export interface CompileResult {
  formatted_markdown: string;
  decisions: Array<{
    id: string;
    title: string;
    description: string;
    made_by: string;
    score?: number;
  }>;
  decisions_considered: number;
  decisions_included: number;
  token_count: number;
  compile_time_ms: number;
}

export interface PerCaseResult {
  question_id: string;
  question_type: LongMemEvalQuestionType;
  question: string;
  expected_answer: string;
  extracted_answer: string;
  retrieved_context: string;
  correct: boolean;
  partial_credit: number;
  ingestion_time_ms: number;
  compile_time_ms: number;
  total_time_ms: number;
  project_id: string;
  error?: string;
}

export interface CategoryScores {
  question_type: LongMemEvalQuestionType;
  cases: number;
  precision_at_1: number;
  recall_at_5: number;
  f1: number;
}

export interface OverallScores {
  precision_at_1: number;
  recall_at_5: number;
  f1: number;
}

export interface BenchmarkRunResult {
  benchmark: 'longmemeval';
  version: string;
  run_date: string;
  hipp0_version: string;
  dataset_variant: string;
  dataset_path: string;
  total_cases: number;
  completed_cases: number;
  overall: OverallScores;
  by_question_type: Record<string, CategoryScores>;
  per_case: PerCaseResult[];
  config: {
    hipp0_url: string;
    max_cases: number | null;
    compile_max_tokens: number;
    use_llm_extraction: boolean;
  };
}
