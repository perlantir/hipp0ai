# LongMemEval

LongMemEval is the first external benchmark integrated into Hipp0. It measures long-term memory in chat assistants across five dimensions: information extraction, multi-session reasoning, knowledge updates, temporal reasoning, and abstention. See the paper ["LongMemEval: Benchmarking Chat Assistants on Long-Term Interactive Memory"](https://arxiv.org/abs/2410.10813) (Wu et al., 2024) for the full methodology.

The integration lives in [`benchmarks/external/longmemeval/`](../../benchmarks/external/longmemeval/README.md).

## Why it matters

Hipp0's core claim is that a multi-signal decision memory beats naive vector RAG on _long-horizon_ tasks — exactly what LongMemEval stresses. Running Hipp0 against LongMemEval produces a single, peer-reviewed number we can cite alongside our internal suite.

Target scores:

| Metric | Floor | Target |
|---|---|---|
| Overall precision@1 | 0.55 (beats naive RAG baseline) | ≥ 0.70 (matches published SOTA) |
| Multi-session F1 | 0.50 | ≥ 0.70 |
| Knowledge-update P@1 | 0.50 | ≥ 0.70 |
| Temporal reasoning P@1 | 0.40 | ≥ 0.60 |
| Abstention P@1 | 0.70 | ≥ 0.85 |

## Quick start

```bash
# 1. Download the dataset (see benchmarks/external/longmemeval/README.md for full instructions)
mkdir -p data
huggingface-cli download xiaowu0162/longmemeval \
  --repo-type dataset --local-dir data/longmemeval

# 2. Start a Hipp0 server
pnpm --filter @hipp0/server dev

# 3. Run a quick 10-case smoke test
npx tsx benchmarks/external/longmemeval/cli.ts \
  --data-path ./data/longmemeval/longmemeval_s.json \
  --max-cases 10 \
  --output benchmarks/results/external/longmemeval/smoke.json
```

## Full run

```bash
# ~500 cases against longmemeval_s with the fast direct-record ingestion path
npx tsx benchmarks/external/longmemeval/cli.ts \
  --data-path ./data/longmemeval/longmemeval_s.json \
  --hipp0-version 0.1.3 \
  --output benchmarks/results/external/longmemeval/longmemeval_s.json

# Same, but exercising the full /api/capture + distillery pipeline (needs OPENAI_API_KEY
# configured on the Hipp0 server)
npx tsx benchmarks/external/longmemeval/cli.ts \
  --data-path ./data/longmemeval/longmemeval_s.json \
  --use-distillery \
  --hipp0-version 0.1.3 \
  --output benchmarks/results/external/longmemeval/longmemeval_s_distillery.json
```

Runs are resumable — re-invoke with the same `--output` and the harness picks up where it left off.

## What the harness does

For each test case:

1. **Ingest** — create a fresh Hipp0 project with three agents (`user`, `assistant`, `architect`), then walk every haystack session and either (a) write each turn as a decision via `POST /api/projects/:id/decisions` (direct mode, default) or (b) post the transcript to `POST /api/capture` and poll the distillery (`--use-distillery`).
2. **Compile** — call `POST /api/compile` with `agent_name="assistant"` and `task_description=<question>`, using the markdown format.
3. **Extract** — pull the top-ranked decision's description out of the compiled markdown as the candidate answer. (A `--use-llm-extraction` flag is reserved for a future LLM-in-the-loop mode.)
4. **Score** — compare the extracted answer against the ground truth using exact / substring / token-overlap fuzzy matching.

Per-case results include ingestion time, compile time, total time, the first 4 KB of retrieved context, the expected answer, and the extracted answer so failures are debuggable.

## Output format

See [`types.ts`](../../benchmarks/external/longmemeval/types.ts) — the `BenchmarkRunResult` interface. Results JSON includes:

- `overall.{precision_at_1, recall_at_5, f1}`
- `by_question_type` with the same three metrics per LongMemEval category
- `per_case[]` with full timing and retrieved context for every case
- `config` echoing the flags the run was invoked with

## Reproducing published numbers

LongMemEval's own leaderboard uses the `longmemeval_s.json` split. To reproduce numbers for publication:

1. Use `--use-distillery` so the full Hipp0 stack is under test.
2. Run the full split (no `--max-cases`).
3. Set `--hipp0-version` to the exact tag so the result file is self-describing.
4. Archive the resulting JSON under `benchmarks/results/external/longmemeval/` and reference it in release notes.

## Known limitations

- **Heuristic answer extraction.** Precision@1 depends on how good our "top decision = answer" heuristic is. A planned follow-up will add an optional OpenAI call to extract a single short answer from the compiled context before scoring — closer to how the upstream evaluator works when the model under test is an LLM wrapper.
- **Direct-record mode** bypasses the distillery, so it measures retrieval quality under "perfect" ingestion. Numbers will generally look _better_ than a distillery run; use `--use-distillery` for end-to-end claims.
- **Rate limiting.** The harness is sequential per case. Parallelization will require server-side rate-limit headers on `/api/capture` — planned once we standardize the capture quota.

## Related docs

- [`benchmarks/README.md`](../../benchmarks/README.md) — internal benchmark suite overview
- [`docs/industry-benchmarks.md`](../industry-benchmarks.md) — roadmap for BEIR / HotpotQA / RULER / CRAG
- [`benchmarks/external/longmemeval/README.md`](../../benchmarks/external/longmemeval/README.md) — harness-level README
