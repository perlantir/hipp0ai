# Benchmarks

Hipp0 includes a reproducible benchmark suite that measures retrieval accuracy, contradiction detection, role differentiation, token efficiency, and compile latency against a naive RAG baseline. All benchmarks run entirely offline — no API keys or external services needed.

## Running Benchmarks

### All Suites

```bash
npx tsx benchmarks/runner.ts --suite all
```

### Individual Suites

```bash
npx tsx benchmarks/runner.ts --suite retrieval
npx tsx benchmarks/runner.ts --suite contradiction
npx tsx benchmarks/runner.ts --suite differentiation
npx tsx benchmarks/runner.ts --suite efficiency
npx tsx benchmarks/runner.ts --suite latency
```

Results are written to:
- `benchmarks/results/latest.json` — machine-readable results
- `benchmarks/results/latest.md` — formatted markdown report

## Benchmark Suites

### Suite 1: Retrieval Accuracy

Measures Recall@5, Recall@10, Precision@5, and MRR for Hipp0's 5-signal scoring engine vs. a naive RAG baseline (cosine similarity only).

**Test data**: `benchmarks/datasets/role-retrieval.json` — query/candidate pairs with ground-truth relevance labels.

### Suite 2: Contradiction Detection

Measures Precision, Recall, and F1 for detecting contradictions and supersession relationships between decisions.

**Test data**: `benchmarks/datasets/contradiction-detection.json`

### Suite 3: Role Differentiation

Measures whether different agent roles receive meaningfully different context for the same task. Reports differentiation score (% of queries where agents get different top-5 results) and average overlap@5.

**Test data**: `benchmarks/datasets/role-differentiation.json`

### Suite 4: Token Efficiency

Measures the compression ratio of Hipp0's H0C condensed format vs. full JSON representation.

**Test data**: `benchmarks/datasets/token-efficiency.json`

### Suite 5: Compile Latency

Measures compile performance at varying decision counts (10 to 500). Reports min, max, P50, P95, P99, and per-decision timing across 10 iterations per scenario.

**Test data**: `benchmarks/datasets/latency-scenarios.json`

## The 5-Signal Scoring Pipeline

The benchmark suite mirrors the production scoring pipeline from `@hipp0/core`:

| Signal | Default Weight | Description |
|--------|---------------|-------------|
| `tag_overlap` | 0.35 | Tag hits against task words (with synonym expansion) |
| `role_match` | 0.15 | Whether `made_by === agentName` |
| `domain_relevance` | 0.15 | Task domain vs. decision domain match |
| `confidence` | 0.10 | high=1.0, medium=0.7, low=0.4 |
| `description_overlap` | 0.25 | Content keyword overlap with task |

Additional adjustments:
- `cross_reference_boost` (+0.08) — boost when a related decision matches the task
- `own_wing_boost` (+0.20) — boost for decisions from the requesting agent's wing
- `domain_match_boost` (+0.05) — extra boost for exact domain match
- `recency_boost_7d` (+0.05) — boost for decisions ≤ 7 days old
- `recency_boost_30d` (+0.02) — boost for decisions ≤ 30 days old
- `minimum_score_threshold` (0.15) — decisions below this are filtered out

## Configuration

### Scoring Parameters

Edit `benchmarks/config/scoring-params.json` to tune weights:

```json
{
  "signal_weights": {
    "tag_overlap": 0.35,
    "role_match": 0.15,
    "domain_relevance": 0.15,
    "confidence": 0.10,
    "description_overlap": 0.25
  },
  "cross_reference_boost": 0.08,
  "domain_mismatch_penalty": 0.0,
  "recency_boost_7d": 0.05,
  "recency_boost_30d": 0.02,
  "minimum_score_threshold": 0.15,
  "own_wing_boost": 0.20,
  "domain_match_boost": 0.05,
  "role_semantic_cap": 0.10
}
```

### Synonyms

Edit `benchmarks/config/synonyms.json` to add synonym pairs for tag matching:

```json
[
  ["auth", "authentication"],
  ["ws", "websocket"],
  ["db", "database"]
]
```

Both directions are applied automatically.

## Adding Custom Suites

1. Create a new dataset file in `benchmarks/datasets/`.
2. Add your suite logic to `benchmarks/runner.ts` following the existing pattern:
   - Define test cases with inputs and expected outputs.
   - Score using the 5-signal pipeline or your custom scorer.
   - Return results in the standard `{ suite, metrics, details }` format.
3. Register the suite name in the runner's suite map.
4. Run with `--suite <your-suite-name>`.

## Interpreting Results

| Metric | Good | Needs Work |
|--------|------|------------|
| Recall@5 | > 60% | < 40% |
| Precision@5 | > 60% | < 40% |
| MRR | > 0.85 | < 0.70 |
| Contradiction F1 | > 0.85 | < 0.70 |
| Differentiation | > 80% | < 50% |
| Compression | > 10x | < 5x |
| P95 Latency (500 dec) | < 50ms | > 100ms |

## Key Files

| File | Description |
|------|-------------|
| `benchmarks/runner.ts` | Main benchmark runner |
| `benchmarks/baselines/naive-rag.ts` | Naive RAG baseline implementation |
| `benchmarks/config/scoring-params.json` | Tunable scoring weights |
| `benchmarks/config/synonyms.json` | Synonym pairs for tag matching |
| `benchmarks/datasets/` | Test case datasets |
| `benchmarks/results/` | Output directory (JSON + Markdown) |
