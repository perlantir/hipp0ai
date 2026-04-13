/**
 * Naive RAG Baseline — simple TF-IDF word-overlap retriever.
 *
 * No role awareness, no domain boost, no 5-signal scoring.
 * Uses term frequency / inverse document frequency as a proxy
 * for embedding similarity, returning top-K by score alone.
 */

export interface NaiveDecision {
  id: string;
  title: string;
  description: string;
  tags: string[];
  [key: string]: unknown;
}

interface ScoredResult {
  id: string;
  score: number;
}

/** Tokenize text into lowercase alpha-numeric tokens. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

/** Build a term-frequency map for a token list. */
function termFrequency(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const token of tokens) {
    tf.set(token, (tf.get(token) ?? 0) + 1);
  }
  // Normalize by total tokens
  const total = tokens.length || 1;
  for (const [k, v] of tf) {
    tf.set(k, v / total);
  }
  return tf;
}

/** Compute inverse document frequency from a corpus of token lists. */
function inverseDocumentFrequency(corpus: string[][]): Map<string, number> {
  const docCount = corpus.length;
  const df = new Map<string, number>();
  for (const tokens of corpus) {
    const unique = new Set(tokens);
    for (const token of unique) {
      df.set(token, (df.get(token) ?? 0) + 1);
    }
  }
  const idf = new Map<string, number>();
  for (const [term, count] of df) {
    idf.set(term, Math.log((docCount + 1) / (count + 1)) + 1);
  }
  return idf;
}

/** Compute TF-IDF vector as a Map<term, weight>. */
function tfidfVector(tf: Map<string, number>, idf: Map<string, number>): Map<string, number> {
  const vec = new Map<string, number>();
  for (const [term, freq] of tf) {
    vec.set(term, freq * (idf.get(term) ?? 1));
  }
  return vec;
}

/** Cosine similarity between two sparse TF-IDF vectors. */
function cosineSimilaritySparse(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (const [term, wa] of a) {
    dot += wa * (b.get(term) ?? 0);
    magA += wa * wa;
  }
  for (const [, wb] of b) {
    magB += wb * wb;
  }

  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Naive RAG retriever: rank candidate decisions by TF-IDF cosine similarity
 * to the task description. No role awareness at all.
 */
export function naiveRetrieve(
  task: string,
  candidates: NaiveDecision[],
  topK: number = 10,
): ScoredResult[] {
  // Build corpus: each decision's text = title + description + tags
  const corpusTokens: string[][] = [];
  for (const d of candidates) {
    const text = `${d.title} ${d.description} ${d.tags.join(' ')}`;
    corpusTokens.push(tokenize(text));
  }

  // Add the query to corpus for IDF computation
  const queryTokens = tokenize(task);
  const allDocs = [...corpusTokens, queryTokens];
  const idf = inverseDocumentFrequency(allDocs);

  // Build query TF-IDF vector
  const queryTF = termFrequency(queryTokens);
  const queryVec = tfidfVector(queryTF, idf);

  // Score each candidate
  const scored: ScoredResult[] = candidates.map((d, i) => {
    const docTF = termFrequency(corpusTokens[i]!);
    const docVec = tfidfVector(docTF, idf);
    return {
      id: d.id,
      score: cosineSimilaritySparse(queryVec, docVec),
    };
  });

  // Sort descending by score, return top-K
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

/**
 * Run the naive RAG baseline on role-retrieval test cases.
 * Returns per-case results with the same metrics the main runner computes.
 */
export function naiveRetrievalBenchmark(
  candidates: NaiveDecision[],
  testCases: Array<{
    id: string;
    task: string;
    ground_truth_relevant: string[];
    ground_truth_irrelevant: string[];
  }>,
): {
  recall_at_5: number;
  recall_at_10: number;
  precision_at_5: number;
  mrr: number;
} {
  let totalRecall5 = 0;
  let totalRecall10 = 0;
  let totalPrecision5 = 0;
  let totalMRR = 0;

  for (const tc of testCases) {
    const results5 = naiveRetrieve(tc.task, candidates, 5);
    const results10 = naiveRetrieve(tc.task, candidates, 10);

    const retrieved5 = new Set(results5.map((r) => r.id));
    const retrieved10 = new Set(results10.map((r) => r.id));
    const relevant = new Set(tc.ground_truth_relevant);

    // Recall@5
    let hits5 = 0;
    for (const id of relevant) {
      if (retrieved5.has(id)) hits5++;
    }
    totalRecall5 += relevant.size > 0 ? hits5 / relevant.size : 0;

    // Recall@10
    let hits10 = 0;
    for (const id of relevant) {
      if (retrieved10.has(id)) hits10++;
    }
    totalRecall10 += relevant.size > 0 ? hits10 / relevant.size : 0;

    // Precision@5
    let precHits = 0;
    for (const id of retrieved5) {
      if (relevant.has(id)) precHits++;
    }
    totalPrecision5 += results5.length > 0 ? precHits / results5.length : 0;

    // MRR — reciprocal rank of first relevant result in top-10
    let rr = 0;
    for (let i = 0; i < results10.length; i++) {
      if (relevant.has(results10[i]!.id)) {
        rr = 1 / (i + 1);
        break;
      }
    }
    totalMRR += rr;
  }

  const n = testCases.length || 1;
  return {
    recall_at_5: totalRecall5 / n,
    recall_at_10: totalRecall10 / n,
    precision_at_5: totalPrecision5 / n,
    mrr: totalMRR / n,
  };
}

/**
 * Run naive RAG on role-differentiation cases.
 * Returns overlap metrics showing naive RAG doesn't differentiate roles.
 */
export function naiveDifferentiationBenchmark(
  candidates: NaiveDecision[],
  testCases: Array<{
    id: string;
    task: string;
    agent_a: { name: string; role: string };
    agent_b: { name: string; role: string };
  }>,
): {
  differentiation_score: number;
  avg_overlap_at_5: number;
} {
  let differentiatedCount = 0;
  let totalOverlap = 0;

  for (const tc of testCases) {
    // Naive RAG returns the SAME results for both agents — it's task-only
    const resultsA = naiveRetrieve(tc.task, candidates, 5);
    const resultsB = naiveRetrieve(tc.task, candidates, 5);

    const setA = new Set(resultsA.map((r) => r.id));
    const setB = new Set(resultsB.map((r) => r.id));

    let overlap = 0;
    for (const id of setA) {
      if (setB.has(id)) overlap++;
    }

    totalOverlap += overlap;
    if (overlap < 5) differentiatedCount++; // Different if not all overlap
  }

  const n = testCases.length || 1;
  return {
    differentiation_score: differentiatedCount / n,
    avg_overlap_at_5: totalOverlap / n,
  };
}
