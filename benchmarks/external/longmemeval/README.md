# LongMemEval on Hipp0

This directory contains Hipp0's integration for the **LongMemEval** benchmark — the industry-standard evaluation for long-term memory in chat assistants.

- **Paper:** [LongMemEval: Benchmarking Chat Assistants on Long-Term Interactive Memory](https://arxiv.org/abs/2410.10813) (2024)
- **Upstream code:** https://github.com/xiaowu0162/LongMemEval
- **Dataset:** https://huggingface.co/datasets/xiaowu0162/longmemeval

LongMemEval tests five core memory abilities:

1. **Information extraction** — can the system pull specific facts out of a long history?
2. **Multi-session reasoning** — can it join evidence across multiple conversations?
3. **Knowledge update** — does it pick the _latest_ answer when the user's state changes?
4. **Temporal reasoning** — can it answer "when did X happen?" style questions?
5. **Abstention** — can it decline when the answer truly isn't in memory?

Top memory systems in 2025 score ~60–70% precision@1 on LongMemEval. This harness makes it trivial to reproduce those runs against Hipp0.

---

## 1. Download the dataset

```bash
# Hugging Face (recommended — fastest):
pip install -U "huggingface_hub[cli]"
mkdir -p data
huggingface-cli download xiaowu0162/longmemeval \
  --repo-type dataset \
  --local-dir data/longmemeval

# or via git:
git clone https://github.com/xiaowu0162/LongMemEval.git data/longmemeval-repo
cp data/longmemeval-repo/data/*.json data/
```

After download you should have three JSON files:

```
data/
  longmemeval_s.json       # short haystack (~500 cases, recommended for quick runs)
  longmemeval_m.json       # medium haystack (~500 cases, full benchmark)
  longmemeval_oracle.json  # oracle sessions only (debugging)
```

All three have the same per-case shape — any of them can be pointed at `--data-path`.

---

## 2. Start a Hipp0 server

```bash
# In a separate terminal:
pnpm build
pnpm --filter @hipp0/server dev
# Server listens on http://localhost:3100 by default.
```

Set a bearer key if your server requires auth:

```bash
export HIPP0_API_KEY=sk-your-key-here
```

---

## 3. Run the benchmark

```bash
# Quick smoke test: first 10 cases of longmemeval_s.
npx tsx benchmarks/external/longmemeval/cli.ts \
  --data-path ./data/longmemeval_s.json \
  --hipp0-url http://localhost:3100 \
  --max-cases 10 \
  --output benchmarks/results/external/longmemeval/smoke.json

# Full run on longmemeval_s:
npx tsx benchmarks/external/longmemeval/cli.ts \
  --data-path ./data/longmemeval_s.json \
  --output benchmarks/results/external/longmemeval/longmemeval_s.json

# Only run multi-session cases:
npx tsx benchmarks/external/longmemeval/cli.ts \
  --data-path ./data/longmemeval_s.json \
  --question-type multi-session \
  --output benchmarks/results/external/longmemeval/multi-session.json

# Exercise the full ingest pipeline (LLM distillery, requires OPENAI_API_KEY on the server):
npx tsx benchmarks/external/longmemeval/cli.ts \
  --data-path ./data/longmemeval_s.json \
  --use-distillery \
  --output benchmarks/results/external/longmemeval/distillery.json
```

Runs are **resumable**: if a run crashes, re-invoke with the same `--output` path and the harness will skip already-scored `question_id`s.

---

## 4. Interpret results

Results are written as JSON matching `BenchmarkRunResult` in [`types.ts`](./types.ts). Key fields:

```jsonc
{
  "benchmark": "longmemeval",
  "overall": {
    "precision_at_1": 0.72,
    "recall_at_5":    0.81,
    "f1":             0.76
  },
  "by_question_type": {
    "single-session-user":   { "precision_at_1": 0.85, "recall_at_5": 0.88, "f1": 0.86 },
    "multi-session":         { "precision_at_1": 0.68, "recall_at_5": 0.79, "f1": 0.73 },
    "knowledge-update":      { "precision_at_1": 0.71, "recall_at_5": 0.83, "f1": 0.76 },
    "temporal-reasoning":    { "precision_at_1": 0.62, "recall_at_5": 0.75, "f1": 0.68 },
    "abstention":            { "precision_at_1": 0.88, "recall_at_5": 0.88, "f1": 0.88 }
  },
  "per_case": [ /* detailed per-case timing and answers */ ]
}
```

**Scoring.** Precision@1 treats the top-ranked decision's description as the system's answer. Recall@5 checks whether the ground-truth answer appears anywhere in the top-5 decisions returned by `/api/compile`. F1 is the harmonic mean. Matching uses a three-tier strategy — exact, substring, and token-overlap fuzzy match at 0.6 — mirroring the upstream LongMemEval evaluator.

---

## 5. Harness design

```
benchmarks/external/longmemeval/
  cli.ts       # command-line entry point
  runner.ts    # orchestrates ingest -> compile -> score per case
  ingester.ts  # writes each session into a fresh Hipp0 project
  loader.ts    # parses longmemeval_{s,m,oracle}.json files
  scorer.ts    # normalization, match tiers, per-bucket aggregation
  types.ts     # shared interfaces
  README.md    # this file
```

Two ingestion modes:

- **Direct record (default):** each turn in a session becomes a Hipp0 decision. Deterministic, ~1–3 seconds per case, no LLM key required.
- **Distillery (`--use-distillery`):** each session is posted to `/api/capture` and the LLM distillery extracts decisions. Slower (~10–30 seconds/case) but exercises the full Hipp0 stack.

Both modes create three agents per project (`user`, `assistant`, `architect`) and one Hipp0 TaskSession per haystack session so the evidence retrieval sees realistic session boundaries.

---

## 6. Typechecking the harness

A local `tsconfig.json` is included so you can typecheck the harness in isolation:

```bash
npx tsc --noEmit -p benchmarks/external/longmemeval/tsconfig.json
```

---

## 7. Troubleshooting

- **`data path not found`** — download the dataset first (step 1) and point `--data-path` at the actual JSON file, not the directory.
- **`Network error: ECONNREFUSED`** — make sure a Hipp0 server is running and reachable at `--hipp0-url`.
- **Distillery runs time out** — bump `captureTimeoutMs` in `ingester.ts` or increase the distillery worker concurrency on the server.
- **Scores look flat at 0%** — check that the compiled markdown contains the expected answer substring. Use `jq '.per_case[0]' results.json` to inspect a single case's `retrieved_context` and `extracted_answer`.
