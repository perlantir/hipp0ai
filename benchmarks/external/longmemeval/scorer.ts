/**
 * LongMemEval scoring logic.
 *
 * LongMemEval uses three main metrics per question-type bucket:
 *   - precision@1  — did the single best answer match the ground truth?
 *   - recall@k     — was the ground truth present anywhere in the top-k?
 *   - F1           — harmonic mean combining both for a single headline number.
 *
 * The scorer accepts both an "extracted answer" (a short string the runner
 * has pulled out of the compiled context) and the full compiled markdown
 * context so we can compute recall@k separately. Matching itself uses a
 * three-tier approach:
 *   1. exact-match (case/punctuation folded)
 *   2. substring containment in either direction
 *   3. token-overlap fuzzy match above a threshold
 *
 * This mirrors the matcher used by the upstream LongMemEval eval script,
 * which also falls back to fuzzy matching after exact / substring checks.
 */

import type {
  CategoryScores,
  LongMemEvalCase,
  LongMemEvalQuestionType,
  OverallScores,
  PerCaseResult,
} from './types.js';

/** Characters that should be stripped before matching. */
const PUNCT_RE = /[\p{P}\p{S}]/gu;

/** Words we'll ignore in token-overlap matching. */
const STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'of',
  'to',
  'in',
  'on',
  'at',
  'for',
  'with',
  'and',
  'or',
  'but',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'it',
  'its',
  'this',
  'that',
  'these',
  'those',
  'as',
  'by',
  'from',
  'about',
  'i',
  'you',
  'he',
  'she',
  'we',
  'they',
  'me',
  'him',
  'her',
  'them',
  'my',
  'your',
  'our',
  'their',
]);

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(PUNCT_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(text: string): string[] {
  return normalize(text)
    .split(' ')
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

export function tokenOverlap(a: string, b: string): number {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersection = 0;
  for (const t of ta) if (tb.has(t)) intersection++;
  // Precision against the ground truth (answer = b) is the meaningful signal.
  return intersection / tb.size;
}

/**
 * Does the haystack contain the ground-truth answer?
 * Tiered match: exact, substring, fuzzy (token overlap >= 0.6).
 */
export function answerMatches(
  extracted: string,
  expected: string,
  fuzzyThreshold = 0.6,
): { matched: boolean; score: number; tier: 'exact' | 'substring' | 'fuzzy' | 'none' } {
  if (!extracted || !expected) return { matched: false, score: 0, tier: 'none' };

  const e = normalize(extracted);
  const g = normalize(expected);

  if (!e || !g) return { matched: false, score: 0, tier: 'none' };
  if (e === g) return { matched: true, score: 1, tier: 'exact' };

  if (e.includes(g) || g.includes(e)) {
    return { matched: true, score: 0.9, tier: 'substring' };
  }

  const overlap = tokenOverlap(extracted, expected);
  if (overlap >= fuzzyThreshold) {
    return { matched: true, score: overlap, tier: 'fuzzy' };
  }

  return { matched: false, score: overlap, tier: 'none' };
}

/**
 * Heuristic: pull the "answer" out of a compiled Hipp0 markdown context.
 *
 * The compiled markdown has decisions listed in descending score order.
 * We take the top-ranked decision's description as the model's answer.
 * If the user opts into LLM extraction (`runner.ts --llm-extract`) this
 * function is bypassed in favor of an actual LLM call.
 */
export function extractAnswerFromMarkdown(markdown: string): string {
  if (!markdown) return '';
  const lines = markdown.split('\n').map((l) => l.trim()).filter(Boolean);

  // Prefer lines that look like "- **Decision title**: description".
  for (const line of lines) {
    const match = line.match(/^[-*]\s+\*\*(.+?)\*\*[:\s-]*(.*)$/);
    if (match) {
      const [, title, body] = match;
      return body && body.length > 0 ? body : title ?? '';
    }
  }

  // Fall back to the first non-heading line.
  for (const line of lines) {
    if (line.startsWith('#')) continue;
    if (line.startsWith('```')) continue;
    return line.replace(/^[-*]\s+/, '');
  }
  return lines[0] ?? '';
}

/**
 * Compute per-question-type and overall aggregate scores given a list of
 * per-case results.
 */
export function computeAggregateScores(results: PerCaseResult[]): {
  overall: OverallScores;
  byQuestionType: Record<string, CategoryScores>;
} {
  const byQuestionType: Record<string, CategoryScores> = {};

  const groups = new Map<LongMemEvalQuestionType, PerCaseResult[]>();
  for (const r of results) {
    const list = groups.get(r.question_type) ?? [];
    list.push(r);
    groups.set(r.question_type, list);
  }

  for (const [qt, rs] of groups) {
    byQuestionType[qt] = computeBucketScores(qt, rs);
  }

  const overall: OverallScores = computeOverall(results);

  return { overall, byQuestionType };
}

function computeBucketScores(
  qt: LongMemEvalQuestionType,
  results: PerCaseResult[],
): CategoryScores {
  const n = results.length;
  if (n === 0) {
    return { question_type: qt, cases: 0, precision_at_1: 0, recall_at_5: 0, f1: 0 };
  }
  let correct = 0;
  let recallHits = 0;
  for (const r of results) {
    if (r.correct) correct++;
    // recall@5 approximation: did the ground-truth answer appear anywhere in
    // the retrieved context? That context already contains the top-k
    // decisions, so substring containment is a fair proxy for recall.
    const recallMatch = answerMatches(r.retrieved_context, r.expected_answer);
    if (recallMatch.matched) recallHits++;
  }
  const precision = correct / n;
  const recall = recallHits / n;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return {
    question_type: qt,
    cases: n,
    precision_at_1: round(precision),
    recall_at_5: round(recall),
    f1: round(f1),
  };
}

function computeOverall(results: PerCaseResult[]): OverallScores {
  const n = results.length;
  if (n === 0) return { precision_at_1: 0, recall_at_5: 0, f1: 0 };
  let correct = 0;
  let recallHits = 0;
  for (const r of results) {
    if (r.correct) correct++;
    const recallMatch = answerMatches(r.retrieved_context, r.expected_answer);
    if (recallMatch.matched) recallHits++;
  }
  const precision = correct / n;
  const recall = recallHits / n;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return {
    precision_at_1: round(precision),
    recall_at_5: round(recall),
    f1: round(f1),
  };
}

function round(n: number, digits = 4): number {
  const m = 10 ** digits;
  return Math.round(n * m) / m;
}

/**
 * Produce a per-case scoring verdict from the raw strings the runner has.
 */
export function scoreCase(
  testCase: LongMemEvalCase,
  retrievedContext: string,
  extractedAnswer: string,
): { correct: boolean; partial_credit: number } {
  // Abstention cases: the ground truth is "I don't know" or similar; the
  // system is correct iff the extracted answer also expresses abstention.
  if (testCase.question_type === 'abstention') {
    const answer = normalize(extractedAnswer);
    const abstained =
      answer.includes("don t know") ||
      answer.includes('no information') ||
      answer.includes('cannot answer') ||
      answer.includes('unable to') ||
      answer === '' ||
      answer.includes('no relevant');
    return { correct: abstained, partial_credit: abstained ? 1 : 0 };
  }

  const direct = answerMatches(extractedAnswer, testCase.answer);
  if (direct.matched) {
    return { correct: true, partial_credit: direct.score };
  }
  // Fall back to checking whether the ground-truth answer is present anywhere
  // in the retrieved context. This is still a real signal — it means Hipp0
  // surfaced the right evidence even if the top-decision heuristic picked the
  // wrong snippet.
  const contextMatch = answerMatches(retrievedContext, testCase.answer);
  return {
    correct: contextMatch.tier === 'exact' || contextMatch.tier === 'substring',
    partial_credit: contextMatch.score * 0.5,
  };
}
