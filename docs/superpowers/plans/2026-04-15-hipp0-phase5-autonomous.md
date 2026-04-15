# Phase 5 Implementation Plan: Operational Parity + Autonomous Skills

> **For agentic workers:** Execute task-by-task. Each task ends with build/test verification + a commit.

**Goal:** Close the three remaining operational gaps vs GBrain: (1) real vector search, (2) automated entity enrichment, (3) auto-executing skill dispatcher.

**Repos:**
- hipp0ai: `/root/audit/hipp0ai` on `fix/contextual-memory-correctness`
- hermulti: `/root/audit/hermulti` on `fix/audit-phase-0-cleanup`

---

## 5.1 Vector Search (hipp0)

### Task 5.1.1: Embedding provider module

**File:** `packages/core/src/intelligence/embedding-provider.ts` (new)

Create a provider abstraction:

```typescript
export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
  readonly dimensions: number;
  readonly model: string;
}

export function getEmbeddingProvider(): EmbeddingProvider | null {
  const provider = process.env.HIPP0_EMBEDDING_PROVIDER ?? 'off';
  if (provider === 'off') return null;
  if (provider === 'openai') return new OpenAIEmbeddingProvider();
  throw new Error(`Unknown embedding provider: ${provider}`);
}

class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = 1536;
  readonly model = 'text-embedding-3-small';
  private readonly apiKey = process.env.OPENAI_API_KEY ?? '';
  async embed(texts: string[]): Promise<number[][]> {
    if (!this.apiKey) throw new Error('OPENAI_API_KEY not set');
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, input: texts }),
    });
    if (!res.ok) throw new Error(`OpenAI embeddings failed: ${res.status}`);
    const data = await res.json() as { data: Array<{ embedding: number[] }> };
    return data.data.map(d => d.embedding);
  }
}

export function cosineSim(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i]*a[i]; nb += b[i]*b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
}
```

**Commit:** `feat(embeddings): provider abstraction with OpenAI implementation`

### Task 5.1.2: Embed on decision write

Find the decision insert path in `packages/server/src/routes/decisions.ts`. After successful insert, fire-and-forget embed → update `decisions.embedding` column (exists for Postgres) + insert into `decision_embeddings` table (SQLite fallback with TEXT storage).

**Commit:** `feat(embeddings): embed decisions on write (fire-and-forget, non-fatal)`

### Task 5.1.3: Backfill script

**File:** `packages/core/scripts/backfill-embeddings.ts` (new)

Selects `decisions WHERE embedding IS NULL LIMIT 1000`, embeds in batches of 100, updates.

**Commit:** `chore(embeddings): backfill script for existing decisions`

### Task 5.1.4: Real vector stage in hybridSearch

Update `packages/core/src/search/hybrid.ts` vector stage:
- Embed query at search time
- Fetch candidate embeddings, compute cosine in-process (SQLite) or use `<=>` (Postgres)
- Rank by cosine similarity, not by `updated_at`

**Commit:** `feat(search): real cosine vector search in hybrid pipeline`

### Task 5.1.5: Tests

Test provider abstraction (mock fetch), cosineSim, vector stage integration.

**Commit:** `test(embeddings): provider, cosine, and vector stage tests`

---

## 5.2 Entity Enrichment (hipp0)

### Task 5.2.1: Enrichment provider module

**File:** `packages/core/src/intelligence/entity-enrichment-provider.ts` (new)

```typescript
export interface EnrichmentProvider {
  enrich(title: string, type: string, context: string): Promise<{ compiledTruth: string; factsJson: Record<string, unknown> } | null>;
}

export function getEnrichmentProvider(): EnrichmentProvider | null {
  const provider = process.env.HIPP0_ENRICHMENT_PROVIDER ?? 'off';
  if (provider === 'off') return null;
  if (provider === 'openai') return new OpenAIEnrichmentProvider();
  if (provider === 'perplexity') return new PerplexityEnrichmentProvider();
  return null;
}
```

Each implementation prompts the LLM with a structured schema: State / Trajectory / Beliefs / Relationship.

**Commit:** `feat(enrichment): entity enrichment provider with OpenAI + Perplexity backends`

### Task 5.2.2: Enrichment job

**File:** `packages/core/src/cron/enrich-entities.ts` (new)

`enrichStaleEntities(projectId, { maxEntities = 5, minTier = 2 })`:
- SELECT entities where tier <= minTier AND (compiled_truth IS NULL OR updated_at < now - 7d)
- For each: call enrichment provider, update `compiled_truth`
- Log cost + rate-limit

**Commit:** `feat(enrichment): enrichStaleEntities job with rate limiting`

### Task 5.2.3: API route + cost governor

**File:** `packages/server/src/routes/entities.ts` (modify)

Add `POST /api/entities/enrich` — triggers job for caller's project. Daily budget gate via env `HIPP0_ENRICHMENT_DAILY_USD_CAP`.

**Commit:** `feat(enrichment): POST /api/entities/enrich with daily budget cap`

### Task 5.2.4: Tests

Mock enrichment provider. Verify: tier filtering, staleness filtering, cost gating.

**Commit:** `test(enrichment): entity enrichment job tests`

---

## 5.3 Skill Dispatcher (hermulti, Tier B)

### Task 5.3.1: SkillLoader

**File:** `agent/skills/loader.py` (new)

Parses `skills/RESOLVER.md` (table rows) + each `skills/<name>/SKILL.md` (YAML frontmatter + body). Returns `list[Skill]`.

**Data classes:**
```python
@dataclass
class Skill:
    name: str
    version: str
    description: str
    triggers: list[str]
    mutating: bool
    tools: list[str]
    body: str  # The full markdown body after frontmatter
```

Reads from `HIPP0_SKILLS_DIR` env (default: `/root/audit/hipp0ai/skills`).

**Commit:** `feat(skills): SkillLoader parses RESOLVER.md + SKILL.md files`

### Task 5.3.2: TriggerMatcher

**File:** `agent/skills/matcher.py` (new)

```python
class TriggerMatcher:
    def __init__(self, skills: list[Skill]): ...
    def match(self, event: SkillEvent) -> list[Skill]:
        """Return skills whose triggers match the event."""
```

Event types: `inbound_message`, `outbound_message`, `pre_task`, `post_decision`, `post_outcome`.

Regex matching first (cheap). Optional LLM classifier for ambiguous events (gated by env var).

**Commit:** `feat(skills): TriggerMatcher with regex matching + LLM-classifier option`

### Task 5.3.3: SkillRunner

**File:** `agent/skills/runner.py` (new)

```python
class SkillRunner:
    def __init__(self, llm_client, hipp0_provider): ...
    async def run(self, skill: Skill, event: SkillEvent) -> SkillResult:
        """Build prompt from skill.body + event context. Call LLM. Parse JSON output. Dispatch tool calls."""
```

The LLM is asked to return JSON like:
```json
{
  "actions": [
    {"type": "record_decision", "args": {"title": "...", "rationale": "...", "tags": [...], "confidence": "..."}},
    {"type": "record_outcome", "args": {"session_id": "...", "outcome": "positive", "signal_source": "..."}},
    {"type": "log", "message": "..."}
  ]
}
```

Each action maps to a method on `hipp0_provider`.

**Commit:** `feat(skills): SkillRunner executes skills via LLM with structured output`

### Task 5.3.4: SkillDispatcher

**File:** `agent/skills/dispatcher.py` (new)

```python
class SkillDispatcher:
    def __init__(self, skills_dir: str | None = None, llm_client=None, hipp0_provider=None): ...
    async def dispatch(self, event: SkillEvent) -> list[SkillResult]:
        """Match + run matched skills in parallel (fire-and-forget for non-mutating, awaited for mutating)."""
    
    async def close(self): ...
```

Enforces: `signal-detector` always runs in parallel (fire-and-forget). `brain-ops` READ runs BEFORE other skills. `brain-ops` WRITE runs AFTER.

Cost governed via `CostGovernor`. Disabled if `HIPP0_SKILL_DISPATCHER=off` (default: on if OPENAI/ANTHROPIC key present).

**Commit:** `feat(skills): SkillDispatcher orchestrates match + run with priority ordering`

### Task 5.3.5: Turn loop integration

**File:** `run_agent.py` (modify ~line 10074 region where record_outcome is called)

Replace the regex-only `extract_decision_signals` call with `dispatcher.dispatch(SkillEvent(type='outbound_message', text=assistant_message_text, ...))`.

Keep regex extractor as fallback if dispatcher disabled.

**Commit:** `feat(skills): wire SkillDispatcher into turn loop, retire regex signal detector as fallback`

### Task 5.3.6: Tests

- `test_loader.py` — parses fixture skill files
- `test_matcher.py` — regex triggers, disambiguation
- `test_runner.py` — mocks LLM, verifies action dispatch
- `test_dispatcher.py` — end-to-end with fake LLM + fake provider

**Commit:** `test(skills): SkillLoader/Matcher/Runner/Dispatcher test suite`

---

## Final verification

```bash
cd /root/audit/hipp0ai && pnpm --filter @hipp0/core build && pnpm --filter @hipp0/server build && pnpm --filter @hipp0/mcp build
cd /root/audit/hermulti && python3 -m pytest tests/agent/ tests/integration/ -q
```

Tag: `git tag gbrain-operational-parity`
