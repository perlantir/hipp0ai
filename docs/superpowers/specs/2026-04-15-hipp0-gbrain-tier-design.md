# hipp0 → GBrain-Tier Design Spec

**Date:** 2026-04-15  
**Repos:** `perlantir/hipp0ai` (TS monorepo) + `perlantir/hermulti` (Python Hermes agent)  
**Goal:** Make hipp0 categorically better than GBrain as a memory system for AI agents.  
**Baseline:** All Phase 0-15 audit fixes are applied. This spec builds on top of that baseline.

---

## Context

GBrain (garrytan/gbrain) is a production knowledge brain used by Garry Tan (YC president) to power his personal AI agents. It stores 17,888 pages, 4,383 people, 723 companies, runs 21 cron jobs. It is the current best public reference for an agent memory system.

hipp0 already surpasses GBrain in several dimensions: 5-signal scoring, outcome learning loop, trust scoring, temporal intelligence with decay, role-differentiated compilation, wing affinity, contradiction detection (0.92 F1), three-tier knowledge pipeline, and knowledge branching. GBrain has none of these.

GBrain has four things hipp0 lacks: (1) a hybrid search pipeline with RRF, (2) a compiled_truth/timeline entity structure, (3) an entity enrichment system (people, companies, ideas), and (4) a skills system that makes the brain agent-operable without explicit API calls.

This spec defines what to build to close those gaps while preserving and amplifying hipp0's existing advantages.

---

## Design Principle

**GBrain remembers. hipp0 learns.**

Everything added must exploit hipp0's learning loop. Entity pages enrich themselves AND improve based on outcomes. Skills get better as agents use them. The search layer benefits from 5-signal re-ranking after RRF. Every GBrain feature added to hipp0 becomes smarter than its GBrain equivalent because it connects to the outcome feedback path.

---

## Phase 1 - Activate Existing Architecture (2-3 days)

Five capabilities are fully implemented in hipp0 but never fire automatically. These are bugs, not missing features.

### 1.1 Relevance Learner Auto-Trigger

**File:** `packages/core/src/relevance-learner/index.ts`  
**Problem:** `AUTO_APPLY_THRESHOLD = 10` is defined but never checked. Feedback accumulates in `agent_feedback` but tag weights never evolve unless `computeAndApplyWeightUpdates` is called manually.  
**Fix:** In the feedback recording path (`POST /api/decisions/:id/feedback` in `packages/server/src/routes/decisions.ts`), after inserting feedback, count pending unprocessed entries for that agent. If count >= `AUTO_APPLY_THRESHOLD`, fire `computeAndApplyWeightUpdates` in a background job (same pattern as `invalidateDecisionCaches`).  
**Why it matters:** Signal B (tag matching, weight 0.15) will never improve without this. The entire relevance learning loop is dead.

### 1.2 Knowledge Insights Injected into Compile

**File:** `packages/core/src/context-compiler/index.ts`  
**Problem:** `knowledge_insights` table is populated by `promoteToInsights` (policies, anti-patterns, procedures, domain rules), but `compileContext` doesn't query it. Tier 3 knowledge is invisible to agents.  
**Fix:** Add a fourth priority lane to `compileContext` - L0.5 (between always-include L0 and scored L1). Query `knowledge_insights` filtered by `project_id` and the task's inferred domain. Score insights against the task using tag overlap only (no embedding needed - they're pre-distilled summaries). Include top 3 insights within the token budget before L1 decisions. Mark them distinctly in the compile response (`type: 'insight'`).  
**Why it matters:** Policies and anti-patterns detected by the system should influence every agent's behavior. Currently they don't.

### 1.3 Trust Contradiction Penalty Wired into Compile

**File:** `packages/core/src/intelligence/trust-scorer.ts` + `packages/core/src/context-compiler/index.ts`  
**Problem:** `computeTrust` has a `contradictionCount` parameter, but the compile path passes `undefined`. Contradiction penalty (−0.15 per contradiction, max −0.50) never fires.  
**Fix:** In `scoreDecision`, before calling `computeTrust`, query the `contradiction_pairs` table for the count of active contradictions involving this decision ID. Pass that count to `computeTrust`. Cache this count alongside the decision record to avoid per-decision queries (it's already recomputed on contradiction detection).  
**Why it matters:** Contradicted decisions should be penalized in compile output. Currently they aren't.

### 1.4 Session-End Outcome Routed Through Attribution

**File:** `packages/server/src/routes/hermes.ts`  
**Problem:** `POST /api/hermes/session/end` accepts an `outcome` payload but only logs it. It never calls `attributeOutcomeToDecisions`.  
**Fix:** Reuse the same attribution flow as `POST /api/hermes/outcomes`. After inserting the session-end record, find the compile_history entry for this session's agent + project, call `attributeOutcomeToDecisions` with a `snippet_ids` set derived from decisions included in any compile during this session. Fire cache invalidation.  
**Why it matters:** Session-end is a richer outcome signal than per-turn. If an agent finishes a session successfully, all the decisions it drew on should receive credit.

### 1.5 Skill Profiles Feed Into Compile

**File:** `packages/core/src/context-compiler/index.ts` + `packages/core/src/intelligence/skill-profiler.ts`  
**Problem:** `computeAgentSkillProfile` computes per-domain skill scores from outcome data but the compile path never uses them.  
**Fix:** In `compileContext`, after computing the task's inferred domain (already done for domain boost), look up the compiling agent's skill score for that domain. Apply a `skillDomainMultiplier`: score >= 0.7 → ×1.10, score >= 0.5 → ×1.05, score < 0.3 → ×0.92. This makes high-performing agents see more relevant decisions in their strong domains.  
**Why it matters:** The system already knows which agents are skilled in which domains. Compile output should reflect that.

### 1.6 Migration 060 - Drop Legacy Column

**File:** `supabase/migrations/060_drop_outcome_success_rate.sql.pending`  
**Problem:** `decisions.outcome_success_rate` legacy column still exists alongside the new `decision_outcome_stats` view. The 14-day live window has passed.  
**Fix:** Rename the `.pending` file to `.sql`, apply it, confirm all compile paths use the view.  
**Why it matters:** Eliminates dual-path code and the technical debt flag.

### Phase 1 Exit Criteria
- Feedback for agent X accumulates 10 entries → weights update automatically, confirmed in `agent_relevance_profiles`
- A policy insight (`type='policy'`) appears in a compile response for a matching task
- A contradicted decision gets a lower compile score than an identical non-contradicted decision
- Session-end with `outcome='positive'` → outcome rows written to `decision_outcomes`
- Migration 060 applied, all 500+ core tests + 178 server tests green

---

## Phase 2 - Skills System + Signal Detector (1 week)

This phase makes hipp0 agent-operable without explicit API calls - matching GBrain's usability model while encoding hipp0's unique workflows.

### 2.1 Skill Architecture

**New directory:** `skills/` at repo root (mirrors GBrain's layout)  
**New file:** `skills/RESOLVER.md` - the routing document

The resolver maps triggers to skill files. It is a markdown document read by an LLM agent - not code. The agent reads it at conversation start and routes every message through the appropriate skill.

```
RESOLVER.md structure:
- Always-on: signal-detector (every message, parallel)
- Brain access: brain-ops (every read or write)
- Specific intents → specific skills
```

**Skill file format:**
```yaml
---
name: compile-context
version: 1.0.0
description: Load relevant decision memory before handling any task
triggers:
  - starting a new task
  - agent asking what was decided about X
mutating: false
tools: [hipp0_compile_context, hipp0_my_wing_summary]
---
```
Followed by prose phases describing the workflow.

### 2.2 Core Skills

**`signal-detector`** (always-on, parallel, non-blocking)  
Fires on every inbound agent message. Captures two signal classes:
1. Original thinking - decisions, architectural choices, rejected alternatives, trade-offs. Must capture exact reasoning, not paraphrase. Routes to `hipp0_record_decision` or `hipp0_auto_capture`.
2. Entity mentions - people, companies, tools, frameworks mentioned in context. If not in the decision graph, note for enrichment via background job (same pattern as `invalidateDecisionCaches` - enqueue slug + source context, process asynchronously). If referenced in a decision, ensure the decision tags include them.

Emits one-line debug log: `Signals: N decisions captured, N entities noted`. Never shows output to user.

**`brain-ops`** (ambient governance)  
Defines the READ→COMPILE→WRITE loop:
- Before any task: call `hipp0_compile_context` with task summary
- After any decision: call `hipp0_record_decision`
- After any outcome: call `hipp0_record_outcome` (hermulti side) or `POST /api/hermes/outcomes`
- Iron Law: every recorded decision must tag all entities it affects

**`compile-context`** (explicit retrieval)  
Three-step protocol: compile → check for contradictions → inject insights. Returns structured context with scoring breakdown for debugging.

**`capture-decision`** (explicit recording)  
Validates before recording: decision must have a clear rationale, at least one affected entity/agent tag, and a confidence level. Checks for near-duplicates before inserting (calls `hipp0_get_contradictions` to catch immediate conflicts).

**`record-outcome`** (outcome signal)  
Infers outcome from turn context if not explicit: `/retry` or tool-error spike → negative; explicit confirmation or long follow-up → positive; otherwise neutral. Routes to the appropriate endpoint.

**`search-decisions`** (query)  
Three-layer search: keyword (FTS on title/rationale) → hybrid (vector + FTS via RRF after Phase 4) → graph (BFS from seed decisions). Synthesizes results with citations. Says "no decisions found for X" rather than hallucinating.

**`maintain`** (health)  
Health dimensions to check, extending Phase 1 system:
- Orphaned decisions (zero edges, not tagged to any agent)
- Stale decisions (>90 days unvalidated, outcome_success_rate unknown)
- Low-trust decisions (trust_score < 0.4) - flag for review
- Anti-patterns surfaced by knowledge pipeline - propose resolution
- Relevance weight drift (agent weights diverged >0.3 from defaults without corresponding outcome data)
- Embedding freshness (decisions without embeddings or embedded with old model)

**`synthesize-branch`** (knowledge management)  
Protocol for creating, exploring, and merging knowledge branches. Enforces: every branch experiment must record an outcome when merged or discarded.

### 2.3 Signal Detector Integration in hermulti

The hermulti Python agent also needs signal detection. After each turn, before `record_outcome`, the agent should scan the assistant's response for decision signals using `infer_outcome_from_turn` (already exists). Extend this to also extract explicit decision statements ("I'll use X", "decided to go with Y", "rejected Z because").

**New function:** `extract_decision_signals(turn_text) -> list[DecisionSignal]`  
**Location:** `agent/outcome_signals.py` (already exists, extend it)  
Routes detected decisions to `Hipp0MemoryProvider.record_decision()` (new method on the provider, wrapping `POST /api/decisions`).

### Phase 2 Exit Criteria
- `RESOLVER.md` and all 7 skill files committed to `skills/`
- An agent using hipp0 via MCP records decisions passively (no explicit API call) from a conversation transcript
- `maintain` skill run produces a health report with all dimension checks
- hermulti turn loop extracts at least one decision signal from a test conversation

---

## Phase 3 - Entity Knowledge Layer (2 weeks)

Adds what GBrain has for people, companies, and concepts - but with hipp0's learning loop underneath. Entities in hipp0 become smarter over time as outcomes flow in.

### 3.1 Data Model

**New migration:** `063_entity_pages.sql`

```sql
-- Entity pages (people, companies, concepts, sources, tools)
CREATE TABLE entity_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,           -- e.g. "people/jane-doe", "companies/openai"
  type TEXT NOT NULL,           -- person | company | concept | tool | source
  title TEXT NOT NULL,
  compiled_truth TEXT,          -- synthesized current-state prose with citations
  trust_score FLOAT DEFAULT 0.5,
  tier INTEGER DEFAULT 3,       -- 1 (high priority) | 2 (moderate) | 3 (low)
  mention_count INTEGER DEFAULT 0,
  frontmatter JSONB DEFAULT '{}',
  content_hash TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(project_id, slug)
);

-- Timeline entries (append-only evidence log per entity)
CREATE TABLE entity_timeline_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id UUID NOT NULL REFERENCES entity_pages(id) ON DELETE CASCADE,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  source TEXT NOT NULL,         -- meeting | email | decision | outcome | external_api
  summary TEXT NOT NULL,
  detail TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Raw provenance (API payloads separate from compiled truth)
CREATE TABLE entity_raw_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id UUID NOT NULL REFERENCES entity_pages(id) ON DELETE CASCADE,
  source TEXT NOT NULL,         -- perplexity | proxycurl | crustdata | user_statement
  data JSONB NOT NULL,
  fetched_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(entity_id, source)
);

-- Chunks for hybrid search (compiled_truth and timeline chunked separately)
-- NOTE: embedding column follows the same DB-adapter pattern as decision_embeddings:
-- pgvector vector(1536) on Postgres, TEXT (base64 JSON) on SQLite with in-process cosine fallback.
-- HNSW index is Postgres-only; SQLite uses full-scan cosine (acceptable at test scale).
CREATE TABLE entity_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id UUID NOT NULL REFERENCES entity_pages(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  chunk_source TEXT NOT NULL,   -- compiled_truth | timeline
  content TEXT NOT NULL,
  embedding vector(1536),       -- NULL until embedding job runs
  model TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(entity_id, chunk_index)
);
CREATE INDEX idx_entity_chunks_embedding ON entity_chunks
  USING hnsw (embedding vector_cosine_ops);

-- Entity ↔ Decision links (when a decision mentions or affects an entity)
CREATE TABLE entity_decision_links (
  entity_id UUID NOT NULL REFERENCES entity_pages(id) ON DELETE CASCADE,
  decision_id UUID NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  link_type TEXT NOT NULL,      -- affects | references | superseded_by | informed_by
  PRIMARY KEY (entity_id, decision_id, link_type)
);

-- Outcome → Entity feedback (hipp0's differentiator: entities learn)
CREATE TABLE entity_outcome_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id UUID NOT NULL REFERENCES entity_pages(id) ON DELETE CASCADE,
  outcome_type TEXT NOT NULL,   -- positive | negative | partial
  source TEXT NOT NULL,         -- hermes_outcome | session_end | manual
  context TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

**The key differentiator:** `entity_outcome_signals` table. When a decision linked to an entity gets a positive or negative outcome, that signal propagates to the entity. Over time, the entity's `trust_score` and `tier` are adjusted by outcome history - not just mention count. A vendor that produces bad outcomes gets demoted. GBrain's tier system is mention-count only.

### 3.2 Enrichment Service

**New file:** `packages/core/src/intelligence/entity-enricher.ts`

**Tier logic (improved over GBrain):**
- Tier 1: 8+ mentions OR meeting/voice source OR outcome_signal count >= 3 (outcome-driven, not just mention-driven)
- Tier 2: 3-7 mentions across 2+ sources OR linked to 3+ decisions
- Tier 3: default

**External enrichment integrations (configurable, BYOK):**
- Perplexity (web search) - all tiers, used first
- Proxycurl (LinkedIn) - Tier 1-2 people
- Crustdata (company data) - Tier 1 companies
- Optional: Brave, Exa, Clearbit

**Notability gate:** Before creating any entity page, check mention count >= 2 AND at least one of: linked to a decision, appeared in a meeting, referenced by a user statement. Single-mention entities from ambient text are not created.

**Enrichment protocol:**
1. Brain-first check: search existing entity pages before any external API call
2. Extract: facts AND texture (beliefs, preferences, trajectory) from source text
3. External APIs: tier-scaled effort, raw responses saved to `entity_raw_data`
4. Write: CREATE (new page + first timeline entry) or UPDATE (new timeline entry + conditional compiled_truth rewrite)
5. Link: create `entity_decision_links` for all decisions that reference this entity
6. Back-propagate: if entity has recent outcome signals, recompute `trust_score`

**`compiled_truth` rewrite policy:**
- ONLY rewrite when: new information contradicts existing state, Tier 1 entity gets new substantial data, or entity hasn't been synthesized in 30+ days
- Timeline entries are ALWAYS append-only - never rewritten
- Rewrite must cite all timeline entries it synthesizes

### 3.3 Entity Compile Integration

Entity pages become a first-class input to `compileContext`.

In `packages/core/src/context-compiler/index.ts`, add an `entityContext` lane:
- For each agent tag and task keyword, find linked entity pages
- For people/companies: include `compiled_truth` summary (max 200 tokens per entity)
- For tools/concepts: include compiled_truth only if decision score > 0.6 for a decision linking to that entity
- Total entity context budget: 20% of total token budget (before decisions)
- Score entities by: mention_count (0.3 weight) + linked_decision_avg_score (0.4) + trust_score (0.3)

### 3.4 Entity Skills

Add three new skills to `skills/`:

**`enrich`** - full enrichment protocol per entity, called when signal-detector notes a new entity or when `maintain` finds thin entity pages

**`entity-query`** - search entity pages by name or topic, return compiled_truth with timeline highlights and linked decisions

**`entity-ingest`** - ingest a URL, PDF, or transcript and extract entity mentions, creating/updating entity pages for each

### 3.5 Media Ingestion (basic)

Scope limited to highest-value formats:
- **PDF** → extract text → run signal-detector over text → capture decisions + entity mentions
- **Meeting transcript** → split by speaker → run signal-detector per speaker block → capture decisions + create/update entity pages for all attendees

Audio/video transcription (GBrain uses AssemblyAI) is deferred - transcription is expensive and transcripts can be passed directly.

### Phase 3 Exit Criteria
- `063_entity_pages.sql` migration clean on both Postgres and SQLite
- Create entity page for a person mentioned in 3 decisions → see their compiled_truth in a compile response
- Post a negative outcome on a decision linked to that entity → entity's `trust_score` decreases
- Enrich a Tier 1 entity via Perplexity → `entity_raw_data` populated, `compiled_truth` updated with citations
- PDF ingest → decisions captured + entity pages created for mentioned people/companies

---

## Phase 4 - Search Layer Upgrade (1 week)

Replace hipp0's current embedding-only search with a hybrid retrieval pipeline matching GBrain's quality, then surpassing it with 5-signal re-ranking.

### 4.1 Hybrid Search Pipeline

**New file:** `packages/core/src/search/hybrid.ts`

**Stage 1 - Parallel execution:**
- Keyword: PostgreSQL FTS tsvector with `ts_rank_cd` (weighted: title A, rationale B, content C)
- Vector: pgvector HNSW cosine on `decision_embeddings` and `entity_chunks`
- Both fire simultaneously via `Promise.all`

**Stage 2 - RRF Fusion:**
```typescript
score = sum(1 / (60 + rank))  // K=60, standard RRF
```
Normalize to 0-1 by dividing by observed max.

**Stage 3 - 5-Signal Re-ranking (hipp0's differentiator over GBrain):**
After RRF, run the existing `scoreDecision` pipeline on the fused result set. GBrain stops at cosine re-scoring. hipp0 applies all 5 signals + 8 multipliers. This is the key difference: RRF gives you a good baseline; 5-signal scoring makes it agent-personalized.

**Stage 4 - Deduplication:**
- Top 3 results per entity/decision by score
- Jaccard similarity dedup (>0.80 threshold)
- Type diversity: no type > 60% of results
- compiled_truth guarantee: if a high-scoring entity has no compiled_truth result, inject one

### 4.2 Intent Classifier

**New file:** `packages/core/src/search/intent-classifier.ts`

Zero-latency regex classifier mapping query text to retrieval mode:
- `decision | temporal | entity | general`

```
decision → "what was decided", "why did we", "what's the status of"
temporal → "last week", "in March", "since we started", "before we"
entity → person name, company name, tool name (capitalized proper nouns)
general → default
```

`decision` → FTS-heavy RRF (2.0x FTS boost), decisions only  
`temporal` → disable compiled_truth boost, include timeline entries, date-range filter  
`entity` → entity pages first, decisions second  
`general` → standard RRF, decisions + entities mixed  

### 4.3 Query Expansion

**Optional** (requires an LLM call - off by default in CI):  
For queries >= 4 words, use Claude Haiku-4-5 to generate 2 alternative phrasings. Embed all 3, search all 3, merge via RRF before Stage 3. Cache expansion results keyed on query hash (5-minute TTL).

### 4.4 Evaluation Harness

**New file:** `packages/core/src/search/eval.ts`  
**New file:** `packages/core/bench/search-eval.bench.ts`

Ground-truth query sets (authored as part of Phase 4 implementation, committed to `packages/core/bench/fixtures/search-eval-queries.json`):
- 20 decision retrieval queries with expected decision IDs and relevance grades (0/1/2)
- 10 entity queries with expected entity slugs
- 5 cross-type queries (query expects both decisions and entities)

These are seeded from a deterministic test database (`packages/core/bench/fixtures/seed.sql`) so CI results are reproducible.

Metrics: Precision@5, Recall@5, MRR, nDCG@5 (graded relevance). Runs in CI via `pnpm bench`. Fails if nDCG@5 drops below 0.75 for decision queries or 0.70 for entity queries.

### 4.5 MCP Tool Update

`hipp0_search_decisions` tool updated to use the hybrid pipeline. Add `hipp0_search` tool (combined decisions + entity pages in one call). Deprecate the standalone vector-only search path in the SDK.

### Phase 4 Exit Criteria
- `hipp0_search` returns decisions AND entity pages from one call
- Intent classifier routes "what did we decide about auth last month?" → `temporal` mode with date filter
- nDCG@5 >= 0.75 on the 20-query decision eval set
- nDCG@5 >= 0.70 on the 10-query entity eval set
- CI bench job fails on intentional retrieval regression

---

## Architecture Overview

```
Agent message
  |
  +-- signal-detector (parallel, always-on)
  |       +-- capture decisions -> hipp0_record_decision
  |       +-- note entities -> entity enrichment queue (background job)
  |
  +-- brain-ops (governs every interaction)
        +-- BEFORE task: compile_context
        |       +-- entity context lane (20% budget)
        |       +-- knowledge insights lane (L0.5)
        |       +-- decision scoring lane (5 signals + 8 multipliers)
        |       +-- hybrid search backend (Phase 4)
        |
        +-- AFTER decision: capture-decision
        |       +-- signal-detector auto-capture
        |
        +-- AFTER outcome: record-outcome
                +-- attributeOutcomeToDecisions (weighted, snippet-intersected)
                +-- entity_outcome_signals (propagate to linked entities)
                +-- relevance learner auto-trigger (if threshold crossed)
```

---

## What Makes hipp0 Better Than GBrain (Summary)

| GBrain has | hipp0 will match |
|---|---|
| Hybrid RRF search | ✅ Phase 4 |
| compiled_truth / timeline split | ✅ Phase 3 |
| Entity enrichment (tiered) | ✅ Phase 3 |
| External API enrichment | ✅ Phase 3 |
| Skills system + RESOLVER | ✅ Phase 2 |
| Signal-detector always-on | ✅ Phase 2 |
| Maintenance health checks | ✅ Phase 2 |
| PDF / transcript ingest | ✅ Phase 3 |

| hipp0 has (GBrain has none of this) | Phase |
|---|---|
| 5-signal scoring → personalized compile | now |
| Outcome learning loop (per-decision attribution) | now (Phase 1 completes it) |
| Trust as epistemic signal (is this still true?) | now |
| Temporal intelligence (decay, scopes, supersession) | now |
| Role-differentiated compilation | now |
| Wing affinity (cross-domain learned weights) | now |
| Contradiction detection (0.92 F1) | now |
| Three-tier knowledge pipeline | now |
| Knowledge branching | now |
| **Entities that learn from outcomes** | Phase 3 |
| **5-signal re-ranking after RRF** | Phase 4 |
| **Relevance weights that auto-evolve from feedback** | Phase 1 |

---

## Ordering Rationale

Phase 1 first - activating existing architecture costs almost nothing and immediately improves system quality. Phase 2 before Phase 3 - agents need the skills interface to productively create entity pages; manual API calls won't scale. Phase 3 before Phase 4 - search upgrade is most valuable when there's entity + decision content to retrieve. Phase 4 last - it's infrastructure that improves everything else, so it's most impactful when the content model is complete.

---

## Out of Scope

- Audio/video transcription (high cost, low uniqueness - transcripts can be passed directly)
- ChatGPT / OAuth 2.1 remote MCP (GBrain's roadmap item, not a priority)
- Citation-fixer cron (GBrain-specific; hipp0's approach is contradiction detection, which is stronger)
- Multi-tenant entity sharing (future work, not in this spec)
