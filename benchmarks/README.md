# Hipp0 Decision Memory Benchmarks

A reproducible benchmark suite measuring retrieval accuracy, contradiction detection, role differentiation, and token efficiency for multi-agent decision memory systems.

## Quick Start

```bash
npx tsx benchmarks/runner.ts --suite all
```

Results are written to `benchmarks/results/latest.md` and `benchmarks/results/latest.json`.

### External benchmarks

In addition to the internal suites below, Hipp0 integrates with public, peer-reviewed memory benchmarks under [`benchmarks/external/`](./external):

- **[LongMemEval](./external/longmemeval/README.md)** — the standard long-term memory benchmark (5 abilities, ~500 cases). Run with:

  ```bash
  npx tsx benchmarks/external/longmemeval/cli.ts \
    --data-path ./data/longmemeval_s.json \
    --output benchmarks/results/external/longmemeval/run.json
  ```

  Results are written to `benchmarks/results/external/longmemeval/`. See [`docs/benchmarks/longmemeval.md`](../docs/benchmarks/longmemeval.md) for the full setup and target scores.

Additional external benchmarks (BEIR, HotpotQA, RULER, CRAG) are on the roadmap in [`docs/industry-benchmarks.md`](../docs/industry-benchmarks.md).

## Suites

### Suite 1: Role-Specific Retrieval Accuracy

**Dataset:** `datasets/role-retrieval.json` — 100 test cases, 50 candidate decisions

Tests whether the 5-signal scoring engine returns the right decisions for a given agent and task. Each test case specifies an agent (backend, frontend, security, devops, testing, orchestrator), a task description, and ground truth labels for which of the 50 candidate decisions are relevant.

**Metrics:**
- **Recall@5** — % of ground truth decisions found in the top 5 results
- **Recall@10** — % found in the top 10
- **Precision@5** — % of top 5 results that are actually relevant
- **MRR** (Mean Reciprocal Rank) — average of 1/rank for the first relevant result

Compared against a naive TF-IDF baseline that ignores agent role, domain, and wing affinity.

### Suite 2: Contradiction Detection

**Dataset:** `datasets/contradiction-detection.json` — 50 test cases

Tests whether the system correctly identifies contradictions, compatible decisions, and supersessions. Includes edge cases: direct contradictions (JWT vs sessions), partial contradictions, supersessions (Node 18 → Node 22), compatible-but-similar decisions, and cross-domain false positives.

**Metrics:**
- **Precision** — of predicted contradictions, how many are actually contradictions
- **Recall** — of actual contradictions, how many were detected
- **F1 Score** — harmonic mean of precision and recall

### Suite 3: Role Differentiation

**Dataset:** `datasets/role-differentiation.json` — 30 test cases

Tests whether different agents get different context for the same task. A backend engineer and a security auditor reviewing the same authentication code should receive different top-5 decisions reflecting their different expertise.

**Metrics:**
- **Differentiation Score** — % of test cases where top-5 results differ between agents
- **Overlap@5** — average number of shared decisions in top-5 (lower = better differentiation)

Naive RAG returns identical results for both agents (it's text-only), so any score > 0% demonstrates role awareness.

### Suite 4: Token Efficiency

**Dataset:** `datasets/token-efficiency.json` — 20 test cases (5–50 decisions each)

Measures the compression ratio of Hipp0Condensed (H0C) format versus full JSON. Tests across varying decision counts to show how compression scales.

**Metrics:**
- **Compression Ratio** — full JSON tokens / H0C tokens per test case
- **Average, median, min, max** ratios across all test cases

### Suite 5: Compile Latency

**Dataset:** `datasets/latency-scenarios.json` — 20 test cases

Measures how fast the 5-signal scoring + ranking pipeline executes across varying conditions:

- **Decision count** — 5, 10, 25, 50, 100, 200, 500 decisions
- **Tag complexity** — 2 tags (simple) to 10 tags (complex) per decision
- **Description length** — short (~20 words) vs long (~200 words)
- **Agent profile complexity** — simple role string vs full profile with 20 weighted tags

Each scenario runs 10 iterations. Reports min, max, P50, P95, P99 latency, and per-decision cost.

**Metrics:**
- **P50 / P95 / P99** — percentile compile times in milliseconds
- **Per-decision cost** — P50 time / decision count (measures scaling)
- **Overall average** — mean P50 across all scenarios

No server or database required — runs the same in-memory scoring as the other suites.

## Methodology

### Scoring Algorithm

The benchmark implements the same 5-signal scoring algorithm used in `@hipp0/core`:

1. **Tag overlap** (35%) — how well decision tags match task keywords, with synonym expansion
2. **Role match** (15%) — boost if the decision was made by the same agent
3. **Domain relevance** (15%) — boost if the decision's domain matches the task domain
4. **Confidence weight** (10%) — high=1.0, medium=0.7, low=0.4
5. **Description overlap** (25%) — keyword overlap between task and decision text

Plus cross-reference boost (+0.08), own-wing boost (+0.20), domain match boost (+0.05), and recency boosts (7-day: +0.05, 30-day: +0.02).

### Configurable Parameters

Scoring behavior can be tuned without code changes via two JSON config files in `benchmarks/config/`:

- **`synonyms.json`** — Bidirectional synonym pairs for tag matching (e.g., `auth` ↔ `authentication`, `k8s` ↔ `kubernetes`). Both directions are applied automatically during tag overlap scoring. Add domain-specific synonyms to improve retrieval for your use case.
- **`scoring-params.json`** — Tunable scoring weights and boosts: signal weights, cross-reference boost, recency boosts, domain match boost, own-wing boost, minimum score threshold, and more. Edit and re-run benchmarks to see the effect.

### Naive RAG Baseline

The baseline (`baselines/naive-rag.ts`) uses TF-IDF cosine similarity between the task description and each decision's text. No role awareness, no domain boost, no agent affinity — purely text similarity. This represents what a basic RAG system would achieve.

### Reproducibility

- All test data is static JSON — no randomness in the datasets
- The scoring algorithm is deterministic — same input always produces same output
- Results can be regenerated by anyone with access to the repo

## Run Options

```bash
# Run all suites
npx tsx benchmarks/runner.ts --suite all

# Run individual suites
npx tsx benchmarks/runner.ts --suite retrieval
npx tsx benchmarks/runner.ts --suite contradiction
npx tsx benchmarks/runner.ts --suite differentiation
npx tsx benchmarks/runner.ts --suite efficiency
npx tsx benchmarks/runner.ts --suite latency
```

## Interpreting Results

| Metric | Good | Excellent |
|--------|------|-----------|
| Recall@5 | > 60% | > 80% |
| Precision@5 | > 50% | > 70% |
| MRR | > 0.70 | > 0.85 |
| Contradiction F1 | > 0.70 | > 0.85 |
| Differentiation | > 70% | > 85% |
| Compression Ratio | > 5x | > 10x |
| P95 (50 decisions) | < 50ms | < 20ms |
| P95 (500 decisions) | < 200ms | < 100ms |
| Per-decision cost | < 1ms | < 0.5ms |

The key insight is the **Delta** column — how much Hipp0's multi-signal scoring improves over naive text retrieval. A large delta validates the value of role-aware, domain-aware, affinity-learning retrieval.
