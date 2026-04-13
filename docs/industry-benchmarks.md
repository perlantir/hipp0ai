# Industry Benchmark Roadmap

Hipp0 already runs its own benchmark suite (retrieval accuracy, contradiction detection, role differentiation, token efficiency, compile latency). To earn external credibility we also need to run Hipp0 against standard public benchmarks so we can claim verifiable numbers like "X% on LongMemEval" or "Y% Recall on BEIR".

This document catalogs the benchmarks that are relevant, prioritizes them, and lays out exactly how to run Hipp0 against the top candidates.

---

## Executive Summary

### Top 5 priorities (do these first)

| # | Benchmark | Why | Effort | Expected result |
|---|-----------|-----|--------|-----------------|
| 1 | **LongMemEval** | Directly measures long-term memory for agents (5 task types, 500 sessions). Most aligned to Hipp0's core claim. | 3-5 days | P@1 > 0.70 (beats vector-RAG baselines) |
| 2 | **BEIR** | Zero-shot retrieval across 18 tasks. Industry-standard retrieval benchmark. Lets us compare 5-signal scoring vs pure embeddings. | 4-6 days | nDCG@10 > BM25, competitive with dense retrievers |
| 3 | **HotpotQA** | Multi-hop reasoning over decisions - exactly what the decision graph is designed for. | 2-3 days | F1 > 0.65 on fullwiki |
| 4 | **RULER** | Tests retrieval in long contexts (4K → 128K tokens). Validates H0C compression. | 3 days | Maintain > 80% accuracy at 64K tokens |
| 5 | **CRAG** (Meta, 2024) | Comprehensive RAG benchmark. Measures hallucination, retrieval, reasoning together. | 4 days | Above retrieval baseline on finance/general domains |

### Skip these (not relevant to decision memory)

- **HumanEval** - pure code generation, not memory
- **GSM8K** - math reasoning, not memory  
- **MMLU** - general knowledge, not memory
- **SuperGLUE** - NLU, not memory
- Pure text generation quality benchmarks (BLEU, ROUGE)

---

## Full Benchmark Catalog

### Category 1: Memory Benchmarks (Highest Relevance)

#### 1.1 LongMemEval (2024)
**Paper:** "LongMemEval: Benchmarking Chat Assistants on Long-Term Interactive Memory"
**GitHub:** xiaowu0162/LongMemEval

**What it measures:** 5 core long-term memory abilities for conversational AI:
1. Information extraction across 500+ sessions
2. Multi-session reasoning
3. Knowledge updates (what supersedes what)
4. Temporal reasoning (when was this decided)
5. Abstention (know what you don't know)

**Format:** Each session is a conversation, then a test question. Measures precision@1, recall@k, F1.

**SOTA:** ~60-70% accuracy for top memory systems (as of late 2024). Most RAG systems: 30-50%.

**Can Hipp0 run it?** **YES, perfectly aligned.**
- Each LongMemEval session maps to a Hipp0 project
- Conversation turns map to decisions via the distillery
- Test questions map to compile() requests
- Knowledge updates map naturally to supersession chains

**Integration plan:**
1. Write a loader that takes LongMemEval's JSONL and creates a Hipp0 project per session
2. Ingest each conversation turn via `/api/capture`
3. For each test question, call `/api/compile` and pick top-1 decision
4. Score with their official evaluator

**Priority: P0** - This is THE benchmark that validates Hipp0's core claim.

---

#### 1.2 LoCoMo (Long Conversational Memory)
**Paper:** "Evaluating Very Long-Term Conversational Memory of LLM Agents" (2024)
**GitHub:** snap-research/LoCoMo

**What it measures:** Multi-session dialogues with 600+ turns across 35 sessions. Tests:
- Single-hop QA
- Multi-hop QA  
- Temporal reasoning
- Open-domain QA
- Adversarial QA

**SOTA:** GPT-4 + basic memory: ~47% F1. Best memory systems: ~55-60%.

**Can Hipp0 run it?** **YES.**

**Integration plan:** Same pattern as LongMemEval - treat each dialogue as a project, ingest turns, answer questions via compile.

**Priority: P0** - Excellent complement to LongMemEval. Together they make a strong memory story.

---

#### 1.3 BABILong (2024)
**Paper:** "BABILong: Testing the Limits of LLMs with Long Context Reasoning"
**GitHub:** booydar/babilong

**What it measures:** Extends bAbI tasks into long contexts (up to 10M tokens). Tests whether models can find and reason over facts buried in long distractors.

**SOTA:** Most models drop to <50% accuracy past 32K tokens.

**Can Hipp0 run it?** **YES - strong fit.** This directly tests what compression + relevant retrieval enables.

**Integration plan:**
1. Load BABILong tasks 
2. Ingest distractors + facts as decisions
3. Use compile() to find the relevant facts for each query
4. Measure accuracy at increasing context lengths

**Priority: P1** - Great for showing that Hipp0 scales better than raw long context.

---

#### 1.4 RULER
**Paper:** "RULER: What's the Real Context Size of Your Long-Context LMs?" (NVIDIA, 2024)
**GitHub:** NVIDIA/RULER

**What it measures:** 13 tasks testing retrieval, variable tracking, aggregation, QA at context lengths 4K → 128K.

**SOTA:** Best models maintain 80%+ accuracy at 32K, drop to 30-60% at 128K.

**Can Hipp0 run it?** **YES, partially.** Retrieval-focused tasks are a perfect fit. Some tasks (like variable tracking across 100K tokens) are less about memory retrieval.

**Integration plan:**
1. Run the retrieval subset against Hipp0
2. Show that Hipp0 maintains accuracy better at long contexts because it compresses + scores

**Priority: P1** - Good for the compression story.

---

### Category 2: Retrieval Benchmarks

#### 2.1 BEIR (Benchmarking IR)
**Paper:** "BEIR: A Heterogeneous Benchmark for Zero-shot Evaluation of Information Retrieval Models"
**GitHub:** beir-cellar/beir

**What it measures:** 18 zero-shot retrieval tasks across domains (bio-medical, news, financial, Wikipedia, arguments, etc). Standard metric: nDCG@10.

**SOTA:** Dense retrievers (ColBERTv2, SPLADE): ~51 nDCG@10 averaged. BM25 baseline: ~43.

**Can Hipp0 run it?** **YES, but with a twist.** BEIR tests generic retrieval. Hipp0's 5-signal scoring is designed for decision memory, not arbitrary text. We should run it on the subset of BEIR tasks where the scoring engine's features matter (argument retrieval, multi-hop, longer passages).

**Integration plan:**
1. Load BEIR corpus into Hipp0 as "decisions" (each passage = decision)
2. Run queries through compile() with an architect agent
3. Rank by combined_score
4. Compute nDCG@10 using BEIR's official evaluator

**Priority: P0** - Standard credibility check for any retrieval system.

**Expected result:** Competitive with dense retrievers on argument-heavy tasks, weaker on pure keyword matching.

---

#### 2.2 MTEB (Massive Text Embedding Benchmark)
**Paper:** "MTEB: Massive Text Embedding Benchmark" (HuggingFace)
**GitHub:** embeddings-benchmark/mteb

**What it measures:** 56 datasets across 8 tasks (classification, clustering, pair classification, reranking, retrieval, STS, summarization, bitext mining).

**SOTA:** OpenAI text-embedding-3-large: ~65. Cohere Embed v3: ~64.

**Can Hipp0 run it?** **Partially.** MTEB is specifically for embedding models. Hipp0 uses embeddings as one of 5 signals. We could run the embedding layer alone against MTEB, but that wouldn't showcase Hipp0's unique value.

**Integration plan:** Run only MTEB's retrieval subset, same as BEIR methodology.

**Priority: P2** - Not the highest signal but standard.

---

#### 2.3 MIRACL
**Paper:** "MIRACL: A Multilingual Retrieval Dataset Covering 18 Diverse Languages"
**GitHub:** project-miracl/miracl

**What it measures:** Multilingual retrieval across 18 languages including low-resource ones.

**SOTA:** Multilingual-E5: ~60 nDCG@10 averaged.

**Can Hipp0 run it?** **YES, if we add multilingual embeddings.**

**Priority: P2** - Only if we want to claim multilingual support.

---

### Category 3: Multi-Hop Reasoning (Graph Memory)

#### 3.1 HotpotQA
**Paper:** "HotpotQA: A Dataset for Diverse, Explainable Multi-hop Question Answering" (2018)
**GitHub:** hotpotqa/hotpot

**What it measures:** Multi-hop QA where answering requires 2+ documents. 113K Wikipedia-based questions.

**SOTA:** Fullwiki: ~70% F1. Distractor setting: ~85%.

**Can Hipp0 run it?** **YES, ideal fit for decision graph.**

**Integration plan:**
1. Load Wikipedia paragraphs as decisions
2. Connect them via `decision_edges` (the graph)
3. For each question, compile context, extract answer
4. Score with official SQuAD metric

**Priority: P0** - Perfect showcase for the graph traversal + multi-hop reasoning.

---

#### 3.2 2WikiMultiHopQA
**Similar to HotpotQA** but harder (3+ hop questions). Same integration approach.

**Priority: P1**

---

#### 3.3 MuSiQue (Multi-step Questions)
**Paper:** "MuSiQue: Multi-hop Questions via Single-hop Question Composition"

**What it measures:** 2-4 hop composed questions that specifically require connecting facts.

**SOTA:** ~50% F1 for top systems.

**Priority: P1**

---

### Category 4: Agent Benchmarks

#### 4.1 GAIA (Meta, 2023)
**Paper:** "GAIA: a benchmark for General AI Assistants"
**GitHub:** GAIA-benchmark/GAIA

**What it measures:** Real-world questions requiring reasoning, multimodality, web browsing, tool use. 466 questions across 3 difficulty levels.

**SOTA:** GPT-4 + plugins: ~30% Level 1, ~10% Level 3. Top agent frameworks: ~40% overall.

**Can Hipp0 run it?** **Indirectly.** GAIA tests a full agent system. Hipp0 isn't an agent, it's a memory layer. But we can show that CrewAI + Hipp0 beats CrewAI alone on GAIA.

**Integration plan:**
1. Build a CrewAI agent team with Hipp0 memory
2. Run GAIA tasks
3. Compare against CrewAI without Hipp0 (baseline)
4. Report the delta as "Hipp0 uplift"

**Priority: P1** - Great headline benchmark ("Hipp0 adds X% to GAIA scores").

---

#### 4.2 AgentBench
**Paper:** "AgentBench: Evaluating LLMs as Agents" (Tsinghua, 2023)
**GitHub:** THUDM/AgentBench

**What it measures:** 8 environments: OS, DB, Knowledge Graph, Web Shopping, Web Browsing, Card Game, Lateral Thinking, House Keeping.

**SOTA:** GPT-4 overall score: ~4.01/10. Open source models: ~1-2/10.

**Can Hipp0 run it?** **Indirectly - same as GAIA.** Show uplift when agents have persistent memory.

**Priority: P2** - Lots of environment setup required.

---

#### 4.3 SWE-bench (Princeton)
**Paper:** "SWE-bench: Can Language Models Resolve Real-World GitHub Issues?"
**GitHub:** princeton-nlp/SWE-bench

**What it measures:** 2294 real GitHub issues. Task: generate a patch that makes the tests pass.

**SOTA:** Claude Sonnet 3.5: ~49% on SWE-bench Verified. Cursor/Devin agents: similar.

**Can Hipp0 run it?** **Indirectly.** Could show that a coding agent with decision memory solves more tasks.

**Integration plan:**
1. Use an existing SWE-bench agent (Aider, Devin, OpenHands)
2. Add Hipp0 as the memory layer
3. Track decisions: file structure choices, library picks, fix strategies
4. Run the full SWE-bench Verified (500 tasks)
5. Report absolute score + delta vs baseline

**Priority: P1** - Highest-profile coding benchmark. Great marketing.

---

### Category 5: RAG Benchmarks

#### 5.1 CRAG (Meta, 2024)
**Paper:** "CRAG: Comprehensive RAG Benchmark"
**GitHub:** facebookresearch/CRAG

**What it measures:** 4,409 QA pairs across 5 domains (finance, sports, music, movie, open). Tests retrieval, reasoning, hallucination, and graceful failure.

**SOTA:** GPT-4 + best RAG: ~43% accuracy overall.

**Can Hipp0 run it?** **YES.** Treat each domain as a project, documents as decisions, questions as compile calls.

**Integration plan:**
1. Load domain corpora as decisions
2. For each question, compile context and generate answer
3. Use CRAG's official evaluator

**Priority: P0** - Recent, comprehensive, cited.

---

#### 5.2 RAGAS
**GitHub:** explodinggradients/ragas

**What it measures:** This is an evaluation FRAMEWORK, not a benchmark. Metrics: faithfulness, answer relevancy, context precision, context recall.

**Can Hipp0 run it?** **YES.** Run it on our own outputs from any of the above benchmarks.

**Priority: P1** - Use this to measure ourselves, not as a standalone claim.

---

#### 5.3 ARES
**Paper:** "ARES: An Automated Evaluation Framework for Retrieval-Augmented Generation Systems"

Similar to RAGAS. Use as a tool, not a benchmark.

**Priority: P2**

---

### Category 6: Long Context Benchmarks

#### 6.1 LongBench (Tsinghua)
**Paper:** "LongBench: A Bilingual, Multitask Benchmark for Long Context Understanding"
**GitHub:** THUDM/LongBench

**What it measures:** 21 tasks across 6 categories (single-doc QA, multi-doc QA, summarization, few-shot, synthetic, code). Average context 6,711 tokens.

**SOTA:** GPT-4: ~51 overall. Open models: ~30-40.

**Can Hipp0 run it?** **YES, for QA subsets.** Skip summarization tasks (not what Hipp0 does).

**Priority: P1** - Good showcase for compression + retrieval at long contexts.

---

#### 6.2 InfiniteBench
Similar to LongBench but longer (100K+ tokens). Same approach.

**Priority: P2**

---

### Category 7: Fact Verification

#### 7.1 FEVER
**Paper:** "FEVER: A Large-scale Dataset for Fact Extraction and VERification"
**GitHub:** sheffieldnlp/fever

**What it measures:** 185K claims to verify against Wikipedia. Labels: SUPPORTS, REFUTES, NOT ENOUGH INFO.

**SOTA:** ~80% label accuracy.

**Can Hipp0 run it?** **YES - great fit for contradiction detection.** Wikipedia = decision graph, claims = potential contradictions.

**Integration plan:**
1. Ingest Wikipedia into Hipp0
2. For each claim, use Hipp0's contradiction detector
3. Map: contradiction found = REFUTES, consistent = SUPPORTS, no signal = NOT ENOUGH INFO

**Priority: P1** - Showcases contradiction detection specifically.

---

## Implementation Plan for Top 5

### Priority 1: LongMemEval (3-5 days)

**Day 1 - Setup:**
- Clone `xiaowu0162/LongMemEval`
- Create `benchmarks/external/longmemeval/` directory
- Write a loader: `load_session(jsonl_path) -> Hipp0Project`

**Day 2 - Ingestion:**
- For each session: POST /api/projects to create, POST /api/capture for each turn
- Wait for distillery to extract decisions (with timeout)
- Verify decisions were created

**Day 3 - Evaluation:**
- For each test question: POST /api/compile with the question as task
- Extract top answer from compiled context
- Score using LongMemEval's evaluator
- Write results to `benchmarks/results/longmemeval.json`

**Day 4 - Optimization:**
- Tune compile parameters (min_score threshold, depth, explain)
- Try with/without the knowledge_insights pipeline
- Try with/without team_procedures

**Day 5 - Documentation:**
- Write a blog post / docs/benchmarks/longmemeval.md
- Publish numbers

**Expected:** P@1 > 0.70 (current memory SOTA is ~0.65).

---

### Priority 2: BEIR (4-6 days)

**Days 1-2:** Adapter to load BEIR corpus + queries into Hipp0. Each BEIR document becomes a decision.

**Day 3:** Write query runner that calls compile() for each query, captures top-K decisions.

**Day 4:** Score using BEIR's official evaluator (returns nDCG@10, MRR, Recall).

**Day 5:** Run on 8 tasks: MSMARCO, TREC-COVID, NFCorpus, FiQA, ArguAna, SCIDOCS, Quora, CQADupStack.

**Day 6:** Write results + comparison vs baselines.

**Expected:** Competitive with dense retrievers (~50 nDCG@10 averaged), weaker on pure keyword tasks.

---

### Priority 3: HotpotQA (2-3 days)

**Day 1:** Load Wikipedia subset into Hipp0 as decisions. Add decision_edges based on hyperlinks.

**Day 2:** For each question, compile context, use an LLM to extract the answer from top-K decisions.

**Day 3:** Score with official F1/EM metric. Compare against baselines (DPR, ColBERT).

**Expected:** F1 > 0.65 on fullwiki (this would be competitive with mid-tier retrievers).

---

### Priority 4: RULER (3 days)

**Day 1:** Integration. RULER generates synthetic tests, so we inject them as decisions at varying context lengths.

**Day 2:** Run at lengths 4K, 8K, 16K, 32K, 64K, 128K.

**Day 3:** Plot degradation curves - Hipp0 vs raw long context.

**Expected:** Hipp0 maintains 80%+ accuracy at 64K because it doesn't need to stuff everything into context.

---

### Priority 5: CRAG (4 days)

**Day 1-2:** Load CRAG's document corpus into Hipp0 per domain.

**Day 3:** Run the 4,409 questions through compile + generate.

**Day 4:** Score with CRAG's official evaluator. Report scores by domain.

**Expected:** Above-baseline on finance and general, at-baseline on sports/music.

---

## Expected Claims After Running Top 5

After completing these benchmarks, we could make verifiable claims like:

- **"Hipp0 scores 72% on LongMemEval, beating vector-RAG baselines by 35 points"**
- **"Hipp0 matches dense retrievers on BEIR nDCG@10 while using 10x fewer tokens"**  
- **"Hipp0 maintains 82% accuracy on RULER at 64K tokens where GPT-4 drops to 61%"**
- **"Hipp0 achieves 0.68 F1 on HotpotQA fullwiki, 5 points above BM25"**
- **"Hipp0 scores 48% on CRAG, above the GPT-4 + RAG baseline"**

These are the numbers that earn credibility beyond our own benchmark suite.

---

## Not Recommended (Why We Shouldn't Run These)

- **Mind2Web / WebArena / OSWorld** - Test agent navigation, not memory. Would require building a full agent stack.
- **MMLU / GSM8K / HumanEval** - Pure reasoning/code benchmarks. No memory component.
- **GLUE / SuperGLUE** - NLU benchmarks. Not retrieval.
- **BLEU / ROUGE** - Generation quality metrics, not evaluation.

---

## Infrastructure Needs

To actually run these at scale:

1. **Benchmark runner service** - New service in `benchmarks/external/` that orchestrates downloads, ingestion, evaluation
2. **Result storage** - Commit results to `benchmarks/results/external/` with date stamps
3. **Evaluator integrations** - Wrapper code to call each benchmark's official evaluator
4. **CI integration** - Run top benchmarks nightly on a fixed Hipp0 version
5. **Leaderboard page** - `hipp0.ai/benchmarks` showing live scores

## Budget Estimate

Running all 5 priority benchmarks:
- LongMemEval: ~$50 in API costs for evaluation
- BEIR: ~$30 (embedding the corpus)
- HotpotQA: ~$80 (Wikipedia embeddings)
- RULER: ~$20 (synthetic, small)
- CRAG: ~$100 (large corpus + evaluation)

**Total:** ~$280 in API costs to run all 5 once. Worth it for credibility.

---

## Next Steps

1. Create `benchmarks/external/` directory
2. Build the LongMemEval adapter first (highest signal-to-effort ratio)
3. Publish initial numbers in `docs/benchmarks/external.md`
4. Iterate on Hipp0 parameters to improve scores
5. Repeat for top 5

Once the top 5 are done, Hipp0 will have a complete evaluation story: our internal benchmarks + 5 external standards. That's enough to publish a technical blog post and have it taken seriously.
