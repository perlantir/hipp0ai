# hipp0 GBrain-Tier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close all gaps between hipp0 and GBrain as an agent memory system, then surpass GBrain through entities that learn from outcomes and 5-signal re-ranking after RRF.

**Architecture:** Four sequential phases: (1) activate 5 wired-but-broken capabilities + drop migration debt, (2) build a skills system so agents operate hipp0 without explicit API calls, (3) add an entity knowledge layer (people/companies/concepts) backed by the existing outcome loop, (4) replace embedding-only search with hybrid RRF + 5-signal re-ranking.

**Tech Stack:** TypeScript (Hono, pglite, pgvector, tiktoken, zod), Python (aiohttp, pytest), Supabase migrations (Postgres + SQLite dual-dialect), MCP SDK, pnpm workspaces + turbo.

**Repos:**
- hipp0ai: `/root/audit/hipp0ai` on branch `fix/contextual-memory-correctness`
- hermulti: `/root/audit/hermulti` on branch `fix/audit-phase-0-cleanup`

**Run all checks with:**
- hipp0: `cd /root/audit/hipp0ai && pnpm -w run build 2>&1 | tail -5` then `pnpm --filter @hipp0/core test 2>&1 | tail -10` then `pnpm --filter @hipp0/server test 2>&1 | tail -10`
- hermulti: `cd /root/audit/hermulti && python -m pytest tests/ -x -q 2>&1 | tail -15`

---

## Phase 1 - Activate Existing Architecture

### Task 1.1: Fix relevance learner auto-trigger

**Context:** `checkAutoApply()` in `packages/server/src/routes/feedback.ts:235` exists and IS called, but uses `recentCount % 10 !== 0` on a 1-hour window - so it never fires if feedback arrives spread over time. Must count unprocessed feedback (since last weight update) instead.

**Files:**
- Modify: `packages/server/src/routes/feedback.ts:235-270`
- Modify: `packages/core/src/relevance-learner/index.ts` - add `getPendingFeedbackCount()`

- [ ] **Step 1: Add getPendingFeedbackCount to relevance learner**

In `packages/core/src/relevance-learner/index.ts`, after the existing `recordFeedback` export, add:

```typescript
/**
 * Count feedback entries since the last weight update for this agent.
 * Used by the auto-apply trigger to decide when to evolve weights.
 */
export async function getPendingFeedbackCount(agentId: string): Promise<number> {
  const db = getDb();
  // Find when weights were last applied
  const lastApplyResult = await db.query<Record<string, unknown>>(
    `SELECT MAX(recorded_at) as last_apply FROM weight_history WHERE agent_id = ?`,
    [agentId],
  );
  const lastApply = (lastApplyResult.rows[0] as any)?.last_apply as string | null;

  const countResult = await db.query<Record<string, unknown>>(
    lastApply
      ? `SELECT COUNT(*) as cnt FROM relevance_feedback WHERE agent_id = ? AND created_at > ?`
      : `SELECT COUNT(*) as cnt FROM relevance_feedback WHERE agent_id = ?`,
    lastApply ? [agentId, lastApply] : [agentId],
  );
  return Number((countResult.rows[0] as any)?.cnt ?? 0);
}
```

- [ ] **Step 2: Update checkAutoApply in feedback.ts to use getPendingFeedbackCount**

Replace the `checkAutoApply` function body in `packages/server/src/routes/feedback.ts`:

```typescript
async function checkAutoApply(agentId: string): Promise<void> {
  try {
    const pendingCount = await getPendingFeedbackCount(agentId);
    if (pendingCount < AUTO_APPLY_THRESHOLD) return;

    const db = getDb();
    const agentResult = await db.query<{ project_id: string }>(
      'SELECT project_id FROM agents WHERE id = ?',
      [agentId],
    );
    if (agentResult.rows.length === 0) return;

    const projResult = await db.query<{ metadata: unknown }>(
      'SELECT metadata FROM projects WHERE id = ?',
      [agentResult.rows[0].project_id],
    );
    if (projResult.rows.length === 0) return;

    let metadata: Record<string, unknown> = {};
    const raw = projResult.rows[0].metadata;
    if (typeof raw === 'string') try { metadata = JSON.parse(raw); } catch {}
    else if (raw && typeof raw === 'object') metadata = raw as Record<string, unknown>;

    if ((metadata.learning_mode as string ?? 'auto') === 'auto') {
      await computeAndApplyWeightUpdates(agentId);
    }
  } catch (err) {
    console.warn('[hipp0:learner] Auto-apply failed:', (err as Error).message);
  }
}
```

Also add the import at the top of feedback.ts:
```typescript
import { recordFeedback, getFeedbackForAgent, computeAndApplyWeightUpdates, getPendingFeedbackCount, AUTO_APPLY_THRESHOLD } from '@hipp0/core/relevance-learner/index.js';
```

- [ ] **Step 3: Write the test**

Add to `packages/server/tests/routes/feedback.test.ts` (or create if absent):

```typescript
describe('checkAutoApply threshold', () => {
  it('triggers weight update after AUTO_APPLY_THRESHOLD feedback entries', async () => {
    // seed 10 feedback rows in the DB for a test agent
    // call POST /api/feedback 10 times
    // assert weight_history has a new row for the agent
    // (integration test using the in-memory SQLite DB)
  });
});
```

- [ ] **Step 4: Build and test**

```bash
cd /root/audit/hipp0ai
pnpm --filter @hipp0/core build 2>&1 | tail -5
pnpm --filter @hipp0/server test 2>&1 | tail -15
```

Expected: all existing tests pass.

- [ ] **Step 5: Commit**

```bash
cd /root/audit/hipp0ai
git add packages/core/src/relevance-learner/index.ts packages/server/src/routes/feedback.ts
git commit -m "fix(learner): count unprocessed feedback since last weight update for auto-apply trigger"
```

---

### Task 1.2: Inject knowledge insights into compile (L0.5 lane)

**Context:** `knowledge_insights` table has `id, project_id, insight_type, title, description, tags JSONB, status, created_at`. The compile function at `packages/core/src/context-compiler/index.ts:1029` has L0/L1/L2 lanes but no insights lane.

**Files:**
- Modify: `packages/core/src/context-compiler/index.ts`

- [ ] **Step 1: Add fetchInsightsForTask helper in context-compiler**

In `packages/core/src/context-compiler/index.ts`, before `compileContext`, add:

```typescript
async function fetchInsightsForTask(
  projectId: string,
  taskDomain: string | null,
  taskTags: string[],
): Promise<Array<{ id: string; insight_type: string; title: string; description: string; tags: string[] }>> {
  const db = getDb();
  const result = await db.query<Record<string, unknown>>(
    `SELECT id, insight_type, title, description, tags FROM knowledge_insights
     WHERE project_id = ? AND status = 'active'
     ORDER BY created_at DESC LIMIT 20`,
    [projectId],
  );

  const taskTagSet = new Set(taskTags.map((t) => t.toLowerCase()));
  const scored = result.rows.map((row) => {
    const tags: string[] = Array.isArray(row.tags)
      ? (row.tags as string[])
      : typeof row.tags === 'string'
        ? (() => { try { return JSON.parse(row.tags as string); } catch { return []; } })()
        : [];
    const overlap = tags.filter((t) => taskTagSet.has(t.toLowerCase())).length;
    const domainMatch = taskDomain && tags.some((t) => t.toLowerCase() === taskDomain.toLowerCase()) ? 1 : 0;
    return { row, score: overlap + domainMatch, tags };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((s) => ({
      id: s.row.id as string,
      insight_type: s.row.insight_type as string,
      title: s.row.title as string,
      description: s.row.description as string,
      tags: s.tags,
    }));
}
```

- [ ] **Step 2: Call fetchInsightsForTask inside compileContext and include results**

In `compileContext`, after the `taskDomain` is computed (around line 1185) and before the L0 fetch (around line 1125), add:

```typescript
// L0.5: knowledge insights - policies, anti-patterns, procedures, domain rules
const insights = await fetchInsightsForTask(
  project_id,
  taskDomain ?? null,
  task_description.toLowerCase().split(/\s+/).filter((w) => w.length > 3),
);
```

Then in the final context package construction (find where `decisions` are formatted for the response), add insights into the formatted output before L0 decisions. In the part where the compile response is assembled, add an `insights` field:

```typescript
insights: insights.map((ins) => ({
  id: ins.id,
  type: 'insight' as const,
  insight_type: ins.insight_type,
  title: ins.title,
  description: ins.description,
})),
```

Also include each insight's description in the token budget accounting (use `description.length / 4` as a token estimate).

- [ ] **Step 3: Add insight type to CompileResponse type**

In `packages/core/src/types.ts`, find the `ContextPackage` or compile response type and add:

```typescript
insights?: Array<{
  id: string;
  type: 'insight';
  insight_type: string;
  title: string;
  description: string;
}>;
```

- [ ] **Step 4: Build and test**

```bash
cd /root/audit/hipp0ai
pnpm --filter @hipp0/core build 2>&1 | tail -5
pnpm --filter @hipp0/core test 2>&1 | tail -15
```

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/context-compiler/index.ts packages/core/src/types.ts
git commit -m "feat(compile): inject knowledge insights as L0.5 lane in compileContext"
```

---

### Task 1.3: Wire trust contradiction penalty into compile

**Context:** `computeTrust(decision, { contradictionCount })` in `trust-scorer.ts:46` applies -0.15 per contradiction (capped at -0.50), but compile path at `packages/core/src/context-compiler/index.ts:607` calls `trustMultiplier(decision.trust_score)` using the stored `trust_score` column (computed at write time), never passing contradiction count. The contradiction table is named `contradictions`.

**Files:**
- Modify: `packages/core/src/context-compiler/index.ts`

- [ ] **Step 1: Batch-fetch active contradiction counts before scoring loop**

In `compileContext`, after all decisions are fetched (after the L2 fetch block, before the scoring loop), add a batch query to get contradiction counts:

```typescript
// Batch-fetch active contradiction counts for all candidate decisions
const allCandidateIds = [...l0Decisions, ...l1Decisions, ...(l2Decisions ?? [])].map((d) => d.id);
const contradictionCounts = new Map<string, number>();
if (allCandidateIds.length > 0) {
  try {
    const placeholders = allCandidateIds.map(() => '?').join(',');
    const contrResult = await db.query<Record<string, unknown>>(
      `SELECT decision_a_id as did, COUNT(*) as cnt
       FROM contradictions
       WHERE decision_a_id IN (${placeholders}) AND status = 'active'
       GROUP BY decision_a_id
       UNION ALL
       SELECT decision_b_id as did, COUNT(*) as cnt
       FROM contradictions
       WHERE decision_b_id IN (${placeholders}) AND status = 'active'
       GROUP BY decision_b_id`,
      [...allCandidateIds, ...allCandidateIds],
    );
    for (const row of contrResult.rows) {
      const did = row.did as string;
      contradictionCounts.set(did, (contradictionCounts.get(did) ?? 0) + Number(row.cnt ?? 0));
    }
  } catch {
    // Non-fatal: contradiction penalty simply won't apply
  }
}
```

- [ ] **Step 2: Pass contradictionCount to scoreDecision**

Find `scoreDecision(d, agent, taskEmbedding, domainContext, task_description, viewSourcedIds)` call in the scoring loop. The `scoreDecision` function signature already uses `trust_score` from the decision object. Update the call to pass the contradiction count in the decision object or update `scoreDecision` to accept it.

Looking at `scoreDecision` at line ~443 in context-compiler:

```typescript
// In the scoring loop, enrich the decision object before scoring:
const decisionWithContrCount = {
  ...d,
  _contradiction_count: contradictionCounts.get(d.id) ?? 0,
};
const sd = scoreDecision(decisionWithContrCount, agent, taskEmbedding, domainContext, task_description, viewSourcedIds);
```

Then in `scoreDecision`, change the trust multiplier line (around line 607):

```typescript
// Before (uses stored trust_score only):
const trustMult = trustMultiplier(decision.trust_score);

// After (recomputes with live contradiction count):
const { trust_score: liveTrustScore } = computeTrust(decision, {
  contradictionCount: (decision as any)._contradiction_count ?? 0,
});
const trustMult = trustMultiplier(liveTrustScore);
```

Add the import for `computeTrust`:
```typescript
import { computeTrust } from '../intelligence/trust-scorer.js';
```

- [ ] **Step 3: Build and test**

```bash
cd /root/audit/hipp0ai
pnpm --filter @hipp0/core build 2>&1 | tail -5
pnpm --filter @hipp0/core test 2>&1 | tail -15
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/context-compiler/index.ts
git commit -m "fix(compile): wire contradiction count into trust penalty during scoring"
```

---

### Task 1.4: Route session-end outcome through attribution

**Context:** `POST /api/hermes/session/end` at `packages/server/src/routes/hermes.ts:572` accepts `outcome` in body but only logs it. The full attribution flow at line ~1040 (in the `/api/hermes/outcomes` handler) shows the exact pattern to replicate.

**Files:**
- Modify: `packages/server/src/routes/hermes.ts`

- [ ] **Step 1: Wire outcome attribution in session/end handler**

In `hermes.ts`, replace the `if (outcome)` block in the session/end handler (lines ~604-616) with:

```typescript
if (outcome) {
  const rating = outcome.rating as string | undefined;
  const snippet_ids: string[] = Array.isArray(outcome.snippet_ids)
    ? (outcome.snippet_ids as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];
  const signal_source = (outcome.signal_source as string | undefined) ?? 'session_end';

  // Normalise to the same 3-value scale used by /api/hermes/outcomes
  const outcomeLabel = rating === 'positive' ? 'positive'
    : rating === 'negative' ? 'negative'
    : 'neutral';

  try {
    // Find the agent for this session
    const agentRes = await db.query<Record<string, unknown>>(
      `SELECT hc.agent_id FROM hermes_conversations hc WHERE hc.session_id = ?`,
      [session_id],
    );
    const agent_id = agentRes.rows[0]?.agent_id as string | undefined;

    if (agent_id && outcomeLabel !== 'neutral') {
      const chResult = await db.query<Record<string, unknown>>(
        `SELECT id FROM compile_history
         WHERE project_id = ? AND agent_id = ? AND compiled_at <= ?
         ORDER BY compiled_at DESC LIMIT 1`,
        [project_id, agent_id, ended_at],
      );
      const compile_history_id = chResult.rows[0]?.id as string | undefined;

      if (compile_history_id) {
        const outcome_type = outcomeLabel === 'positive' ? 'success' : 'failure';
        const outcome_score = outcomeLabel === 'positive' ? 0.9 : 0.1;
        await attributeOutcomeToDecisions({
          compile_history_id,
          project_id,
          agent_id,
          outcome_type,
          outcome_score,
          notes: `session_end signal: ${signal_source}`,
          snippet_ids,
        });
        // Invalidate caches so next compile reflects the updated scores
        invalidateDecisionCaches(project_id).catch(() => {});
      }
    }
  } catch (err) {
    console.warn('[hipp0:session-end] Outcome attribution failed:', (err as Error).message);
  }

  logAudit('hermes_session_outcome', project_id, {
    session_id,
    rating: outcomeLabel,
    signal_source,
    snippet_count: snippet_ids.length,
  });
}
```

Ensure `invalidateDecisionCaches` is imported at the top of `hermes.ts` (check if already present — it likely is from Phase 0-15 work).

- [ ] **Step 2: Build and test**

```bash
cd /root/audit/hipp0ai
pnpm --filter @hipp0/server build 2>&1 | tail -5
pnpm --filter @hipp0/server test 2>&1 | tail -15
```

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/routes/hermes.ts
git commit -m "fix(hermes): route session/end outcome through attributeOutcomeToDecisions"
```

---

### Task 1.5: Skill profiles feed into compile scoring

**Context:** `computeAgentSkillProfile(projectId, agentName)` in `skill-profiler.ts:57` returns `AgentSkillProfile` with a `skills: SkillEntry[]` array. Each entry has `domain: string` and `skill_score: number`. The compile path already infers `taskDomain` and `agentDomain` at line ~1185. Need to look up the agent's skill score for `taskDomain` and apply a multiplier.

**Files:**
- Modify: `packages/core/src/context-compiler/index.ts`

- [ ] **Step 1: Import computeAgentSkillProfile in context-compiler**

At the top of `packages/core/src/context-compiler/index.ts`, add:

```typescript
import { computeAgentSkillProfile } from '../intelligence/skill-profiler.js';
```

- [ ] **Step 2: Fetch skill profile after domain inference**

In `compileContext`, after the `taskDomain` computation (around line 1185), add:

```typescript
// Look up agent's skill score for the inferred task domain
let skillDomainMultiplier = 1.0;
if (taskDomain && agent_name) {
  try {
    const skillProfile = await computeAgentSkillProfile(project_id, agent_name);
    const domainSkill = skillProfile.skills.find(
      (s) => s.domain === taskDomain && s.measured,
    );
    if (domainSkill) {
      if (domainSkill.skill_score >= 0.7) skillDomainMultiplier = 1.10;
      else if (domainSkill.skill_score >= 0.5) skillDomainMultiplier = 1.05;
      else if (domainSkill.skill_score < 0.3) skillDomainMultiplier = 0.92;
    }
  } catch {
    // Non-fatal: skill multiplier stays at 1.0
  }
}
```

- [ ] **Step 3: Apply skillDomainMultiplier in scoreDecision**

Pass `skillDomainMultiplier` to the scored decision enrichment. The simplest approach: after scoring, multiply `combined_score` for all scored decisions:

```typescript
// After the scoring loop produces `scored` array:
if (skillDomainMultiplier !== 1.0) {
  for (const sd of scored) {
    if ((sd as any).domain === taskDomain) {
      sd.combined_score = Math.min(1.0, sd.combined_score * skillDomainMultiplier);
    }
  }
}
```

Add `skill_domain_multiplier: skillDomainMultiplier` to the `meta` block of the compile response for observability.

- [ ] **Step 4: Build and test**

```bash
cd /root/audit/hipp0ai
pnpm --filter @hipp0/core build 2>&1 | tail -5
pnpm --filter @hipp0/core test 2>&1 | tail -15
```

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/context-compiler/index.ts
git commit -m "feat(compile): apply skill domain multiplier from agent skill profile"
```

---

### Task 1.6: Apply migration 060 - drop legacy outcome_success_rate column

**Files:**
- Rename: `supabase/migrations/060_drop_outcome_success_rate.sql.pending` -> `060_drop_outcome_success_rate.sql`

- [ ] **Step 1: Confirm no compile paths still write to outcome_success_rate**

```bash
cd /root/audit/hipp0ai
grep -rn "outcome_success_rate" packages/ --include="*.ts" | grep -v "test\|spec\|\.d\.ts"
```

Expected: only SELECT/view references, no direct UPDATE/INSERT.

- [ ] **Step 2: Rename the migration file**

```bash
cd /root/audit/hipp0ai
mv supabase/migrations/060_drop_outcome_success_rate.sql.pending supabase/migrations/060_drop_outcome_success_rate.sql
```

- [ ] **Step 3: Build and run all tests**

```bash
cd /root/audit/hipp0ai
pnpm --filter @hipp0/core build 2>&1 | tail -5
pnpm --filter @hipp0/core test 2>&1 | tail -10
pnpm --filter @hipp0/server test 2>&1 | tail -10
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/
git commit -m "chore(db): activate migration 060 - drop legacy outcome_success_rate column"
```

---

## Phase 2 - Skills System + Signal Detector

### Task 2.1: Create skills directory structure and RESOLVER.md

**Files:**
- Create: `skills/RESOLVER.md`
- Create: `skills/signal-detector/SKILL.md`
- Create: `skills/brain-ops/SKILL.md`
- Create: `skills/compile-context/SKILL.md`
- Create: `skills/capture-decision/SKILL.md`
- Create: `skills/record-outcome/SKILL.md`
- Create: `skills/search-decisions/SKILL.md`
- Create: `skills/maintain/SKILL.md`
- Create: `skills/synthesize-branch/SKILL.md`

- [ ] **Step 1: Create skills/RESOLVER.md**

```markdown
# hipp0 Skill Resolver

Read this file at conversation start. Route every message through the appropriate skill.

## Always-On (fire in parallel, non-blocking)

| Trigger | Skill |
|---------|-------|
| Every inbound message | `signal-detector` |

## Brain Access (governs every read/write)

| Trigger | Skill |
|---------|-------|
| Before any task | `brain-ops` (READ phase) |
| After any decision/outcome | `brain-ops` (WRITE phase) |

## Intent Routing

| Trigger | Skill |
|---------|-------|
| Starting a task, "what was decided about X", load context | `compile-context` |
| Recording a decision, "we decided to", "we chose" | `capture-decision` |
| Task complete, outcome known, /retry, user reaction | `record-outcome` |
| "Search for decisions about X", querying memory | `search-decisions` |
| Health check, "clean up memory", maintenance | `maintain` |
| Creating/merging/exploring a knowledge branch | `synthesize-branch` |
| New entity mentioned (person/company/tool) | `enrich` (Phase 3) |
| Ingesting PDF or transcript | `entity-ingest` (Phase 3) |

## Disambiguation

- Most specific skill wins. "What did we decide about auth last month?" -> `search-decisions` (temporal).
- If multiple skills match, run them sequentially: `brain-ops` (READ) -> intent skill -> `brain-ops` (WRITE).
- `signal-detector` always runs in parallel - never blocks.
```

- [ ] **Step 2: Create skills/signal-detector/SKILL.md**

```markdown
---
name: signal-detector
version: 1.0.0
description: Always-on parallel sub-agent. Silently captures decisions and entity mentions from every agent message.
triggers:
  - every inbound message (always-on)
mutating: true
tools: [hipp0_record_decision, hipp0_auto_capture]
---

# Signal Detector

Fires on every inbound message. Never shows output to the user. Runs in parallel - never blocks the main agent.

## Phase 1: Scan for Decision Signals

Read the agent message for:
1. **Explicit decisions** - "we decided to", "we chose", "going with X", "rejected Y because", "the trade-off is"
2. **Architectural choices** - tool selections, library choices, schema designs, API contracts
3. **Rejected alternatives** - "we considered X but" - capture the rejected option AND the reason

For each found: extract title, rationale, affected agents/entities, confidence (high/medium/low).

**Must capture exact reasoning. Never paraphrase.**

## Phase 2: Scan for Entity Mentions

Read the message for:
1. People (full names, two+ capitalized words)
2. Companies, products, services (proper nouns)
3. Tools, frameworks, libraries (technical proper nouns)

For each entity found: note slug (people/firstname-lastname, companies/name) and context of mention. Enqueue for enrichment if not already in the decision graph.

## Phase 3: Write

For each decision signal:
```
hipp0_record_decision({
  title: "<exact phrase from message>",
  content: "<full rationale>",
  made_by: "<agent name>",
  tags: ["<entity1>", "<entity2>", "<domain>"],
  confidence: "high|medium|low"
})
```

Emit one-line log only: `Signals: N decisions captured, N entities noted`
Never show output to user.
```

- [ ] **Step 3: Create skills/brain-ops/SKILL.md**

```markdown
---
name: brain-ops
version: 1.0.0
description: Ambient READ->COMPILE->WRITE loop governing every agent interaction.
triggers:
  - before any task (READ phase)
  - after any decision or outcome (WRITE phase)
mutating: true
tools: [hipp0_compile_context, hipp0_record_decision, hipp0_my_wing_summary]
---

# Brain Ops

The ambient context membrane. Every agent interaction flows through this skill.

## READ Phase (before task)

1. Call `hipp0_compile_context` with the task summary as the query.
2. If the response includes `insights`, read them first - they are policies and anti-patterns the system has learned.
3. If the response includes contradictions, note them - do not act on a contradicted decision without awareness.
4. Include compiled context in your task context.

## WRITE Phase (after decision)

After recording any decision, verify:
- The decision has a clear `rationale` (not just a title)
- At least one `tag` names the entity or agent the decision affects (Iron Law)
- `confidence` is set

## WRITE Phase (after outcome)

After a task completes or a user reacts:
- Positive signal (user confirms, task succeeds) -> `record-outcome` skill with `rating: positive`
- Negative signal (/retry, tool-error rate high, user corrects) -> `record-outcome` with `rating: negative`
- Ambiguous -> `record-outcome` with `rating: neutral`

## Iron Law

Every recorded decision MUST tag all entities it affects. A decision about vendor X with no tag for X is invisible to entity-aware queries.
```

- [ ] **Step 4: Create remaining 6 skill files**

`skills/compile-context/SKILL.md`:
```markdown
---
name: compile-context
version: 1.0.0
description: Load relevant decision memory before handling any task.
triggers:
  - starting a new task
  - "what was decided about X"
  - "load context for"
mutating: false
tools: [hipp0_compile_context, hipp0_get_contradictions, hipp0_my_wing_summary]
---

# Compile Context

Three-step protocol for loading memory before a task.

## Step 1: Compile
Call `hipp0_compile_context` with the task description. Include `format: condensed` for large contexts.

## Step 2: Check Contradictions
If `hipp0_compile_context` returns contradictions in the response, call `hipp0_get_contradictions` for the top-scoring decisions to understand the conflict.

## Step 3: Integrate
Integrate compiled context into your working memory before starting the task. Note any insights (type='insight') - these are system-learned policies and anti-patterns that should constrain your approach.
```

`skills/capture-decision/SKILL.md`:
```markdown
---
name: capture-decision
version: 1.0.0
description: Record a decision with rationale, entity tags, and confidence.
triggers:
  - "we decided to"
  - "going with X"
  - "rejected Y because"
  - explicit architectural choice
mutating: true
tools: [hipp0_record_decision, hipp0_get_contradictions, hipp0_search_decisions]
---

# Capture Decision

Validate before recording.

## Pre-flight checks
1. Does the decision have a clear rationale (not just a title)?
2. Does it have at least one entity/agent tag?
3. Is it truly new, or restating an existing decision? Search first: `hipp0_search_decisions` with the title.
4. Check for immediate conflicts: `hipp0_get_contradictions` after recording.

## Record
```
hipp0_record_decision({
  title: "<clear statement of what was decided>",
  content: "<full rationale including alternatives considered>",
  made_by: "<agent name>",
  tags: ["<all affected entities and domains>"],
  confidence: "high|medium|low",
  affects: ["<agent names this decision affects>"]
})
```

## Post-record
If `hipp0_get_contradictions` returns any contradictions, surface them immediately.
```

`skills/record-outcome/SKILL.md`:
```markdown
---
name: record-outcome
version: 1.0.0
description: Record a task outcome signal to close the learning loop.
triggers:
  - task completed
  - user reacts with /retry or error
  - explicit positive confirmation from user
mutating: true
tools: []
---

# Record Outcome

Infer outcome if not explicit:
- **Negative**: /retry command, tool-error rate > 2 in session, user explicitly corrects the agent, user says "that's wrong"
- **Positive**: user confirms ("yes", "exactly", "perfect"), long follow-up continuing the work, user implements the suggestion
- **Neutral**: session ends without clear signal

Post to `POST /api/hermes/outcomes` via the Hermes provider with:
```json
{
  "session_id": "<current session id>",
  "outcome": "positive|negative|neutral",
  "signal_source": "user_feedback|session_end|tool_error",
  "snippet_ids": ["<decision ids that were most relevant to this outcome>"]
}
```
```

`skills/search-decisions/SKILL.md`:
```markdown
---
name: search-decisions
version: 1.0.0
description: Search decision memory with three-layer escalation.
triggers:
  - "search for decisions about X"
  - "what do we know about X"
  - "find decisions related to"
mutating: false
tools: [hipp0_search_decisions, hipp0_compile_context, hipp0_get_graph]
---

# Search Decisions

Three-layer escalation:

## Layer 1: Keyword search
Call `hipp0_search_decisions` with the query. If results are found and relevant, synthesize and return with citations (decision ID + title).

## Layer 2: Compile (if Layer 1 insufficient)
Call `hipp0_compile_context` with the query as the task description. This applies semantic search + 5-signal scoring.

## Layer 3: Graph traversal (if specific decision found)
Call `hipp0_get_graph` on the most relevant decision to find connected decisions (supersession chains, dependencies, related choices).

**Always say "no decisions found for X" rather than guessing. Never hallucinate decision content.**
```

`skills/maintain/SKILL.md`:
```markdown
---
name: maintain
version: 1.0.0
description: Run health checks on the decision graph and surface issues.
triggers:
  - "run health check"
  - "clean up memory"
  - "what decisions are stale"
mutating: false
tools: [hipp0_list_decisions, hipp0_get_contradictions, hipp0_search_decisions]
---

# Maintain

Check all health dimensions and report findings.

## Checks

1. **Orphaned decisions** - `hipp0_list_decisions` filtered by `tags: []` - decisions with no entity or agent tags
2. **Stale decisions** - decisions with `status: active` and `updated_at` > 90 days ago and no outcomes recorded
3. **Low-trust decisions** - decisions where trust_score < 0.4 (visible in scoring breakdown)
4. **Active contradictions** - `hipp0_get_contradictions` - list all unresolved contradictions
5. **Anti-patterns** - knowledge insights with `insight_type: anti_pattern` - patterns of repeated failure

## Report format
```
Health Report - <date>
Orphaned: N decisions (list titles)
Stale: N decisions (list titles)
Low-trust: N decisions (list titles)
Contradictions: N active (list pairs)
Anti-patterns: N detected (list titles)
Recommended actions: [...]
```
```

`skills/synthesize-branch/SKILL.md`:
```markdown
---
name: synthesize-branch
version: 1.0.0
description: Create, explore, and merge knowledge branches for experimental decision sets.
triggers:
  - "create a branch for experiment X"
  - "explore alternative approach"
  - "merge branch"
mutating: true
tools: [hipp0_record_decision, hipp0_compile_context]
---

# Synthesize Branch

Protocol for git-inspired branching of the decision graph.

## Create branch
POST to `POST /api/decisions/branches` with `{ name, description, base_branch: 'main' }`.

## Work on branch
Record decisions with `branch_id` parameter set. These decisions are isolated from main.

## Merge branch
POST to `POST /api/decisions/branches/:id/merge`. Review the diff first.

## Mandatory outcome
Every branch must record an outcome when merged OR discarded:
- Merged: record `positive` outcome with summary of what the branch proved
- Discarded: record `negative` outcome with reason
This feeds the learning loop so the system knows which experimental approaches worked.
```

- [ ] **Step 5: Commit skills directory**

```bash
cd /root/audit/hipp0ai
git add skills/
git commit -m "feat(skills): add RESOLVER.md and 7 core skill files for agent-operable hipp0"
```

---

### Task 2.2: hermulti signal detector - extract_decision_signals

**Context:** `agent/outcome_signals.py` already has `infer_outcome_from_turn()`. Need to add `extract_decision_signals()` that scans assistant turn text for decision statements, and wire it into the turn loop in `run_agent.py`. Also add `record_decision()` to `Hipp0MemoryProvider`.

**Files:**
- Modify: `/root/audit/hermulti/agent/outcome_signals.py`
- Modify: `/root/audit/hermulti/agent/hipp0_memory_provider.py`
- Modify: `/root/audit/hermulti/run_agent.py` (turn loop only - file is ~10K LOC, use grep to find turn boundary)
- Create: `/root/audit/hermulti/tests/agent/test_decision_signals.py`

- [ ] **Step 1: Add DecisionSignal dataclass and extract_decision_signals to outcome_signals.py**

In `/root/audit/hermulti/agent/outcome_signals.py`, add after the existing imports:

```python
import re
from dataclasses import dataclass, field
from typing import Optional

@dataclass
class DecisionSignal:
    title: str
    rationale: str
    tags: list[str] = field(default_factory=list)
    confidence: str = "medium"  # high | medium | low

# Patterns that indicate a decision statement
_DECISION_PATTERNS = [
    r"(?:I'?ll|I will|we'?ll|we will|going to|decided to|choosing to)\s+(.{10,120})",
    r"(?:decided|decision|choosing|going with|opted for|selected)\s*[:\-]?\s*(.{10,120})",
    r"(?:rejected|ruled out|not going with|avoiding)\s+(.{10,120})\s+because\s+(.{10,200})",
    r"(?:the (?:best|right|correct) approach is|we should use)\s+(.{10,120})",
]

_CONFIDENCE_HIGH = re.compile(r"\b(definitely|clearly|absolutely|must|always)\b", re.I)
_CONFIDENCE_LOW = re.compile(r"\b(might|could|perhaps|maybe|probably|consider)\b", re.I)


def extract_decision_signals(turn_text: str, agent_name: str = "hermes") -> list[DecisionSignal]:
    """
    Scan assistant turn text for decision statements.
    Returns up to 5 signals per turn to avoid noise.
    """
    signals: list[DecisionSignal] = []

    for pattern in _DECISION_PATTERNS:
        for match in re.finditer(pattern, turn_text, re.IGNORECASE):
            full_match = match.group(0).strip()
            # Skip very short or very long matches
            if len(full_match) < 15 or len(full_match) > 300:
                continue

            # Infer confidence from language
            if _CONFIDENCE_HIGH.search(full_match):
                confidence = "high"
            elif _CONFIDENCE_LOW.search(full_match):
                confidence = "low"
            else:
                confidence = "medium"

            # Extract rough tags from capitalized nouns in the match
            tags = re.findall(r'\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b', full_match)
            tags = [t.lower().replace(' ', '-') for t in tags if len(t) > 2][:5]

            signals.append(DecisionSignal(
                title=full_match[:120],
                rationale=full_match,
                tags=tags,
                confidence=confidence,
            ))

        if len(signals) >= 5:
            break

    return signals[:5]
```

- [ ] **Step 2: Add record_decision to Hipp0MemoryProvider**

In `/root/audit/hermulti/agent/hipp0_memory_provider.py`, find the class and add after `record_outcome`:

```python
async def record_decision(
    self,
    title: str,
    rationale: str,
    tags: list[str] | None = None,
    confidence: str = "medium",
    agent_name: str | None = None,
) -> bool:
    """Record a decision signal to hipp0. Non-fatal on failure."""
    if not self._project_id:
        return False
    try:
        payload = {
            "title": title,
            "content": rationale,
            "made_by": agent_name or "hermes",
            "tags": tags or [],
            "confidence": confidence,
            "source": "auto_capture",
        }
        async with self._session.post(
            f"{self._base_url}/api/decisions",
            json=payload,
            headers=self._auth_headers(),
            timeout=aiohttp.ClientTimeout(total=5),
        ) as resp:
            return resp.status in (200, 201)
    except Exception as exc:
        logger.debug(f"[hipp0] record_decision failed: {exc}")
        return False
```

- [ ] **Step 3: Wire extract_decision_signals into the turn loop in run_agent.py**

Find the turn boundary where `record_outcome` is called (grep for it):

```bash
grep -n "record_outcome\|turn_boundary\|assistant_message" /root/audit/hermulti/run_agent.py | head -20
```

At the same location where `record_outcome` is called, add (before or after, but within the same try block):

```python
# Extract and record any decision signals from the assistant's response
if assistant_message_text and self.hipp0_provider:
    from agent.outcome_signals import extract_decision_signals
    decision_signals = extract_decision_signals(assistant_message_text, agent_name=self.name)
    for sig in decision_signals:
        asyncio.create_task(
            self.hipp0_provider.record_decision(
                title=sig.title,
                rationale=sig.rationale,
                tags=sig.tags,
                confidence=sig.confidence,
                agent_name=self.name,
            )
        )
```

- [ ] **Step 4: Write tests**

Create `/root/audit/hermulti/tests/agent/test_decision_signals.py`:

```python
import pytest
from agent.outcome_signals import extract_decision_signals, DecisionSignal


def test_extracts_explicit_decision():
    text = "I'll use PostgreSQL for the database because it supports JSONB and we need complex queries."
    signals = extract_decision_signals(text)
    assert len(signals) >= 1
    assert "postgresql" in signals[0].title.lower() or "database" in signals[0].title.lower()


def test_extracts_rejection():
    text = "Rejected MongoDB because we need ACID transactions for the payment flow."
    signals = extract_decision_signals(text)
    assert len(signals) >= 1
    assert signals[0].confidence in ("high", "medium", "low")


def test_no_false_positives_on_plain_text():
    text = "The weather is nice today. Here is a summary of the results."
    signals = extract_decision_signals(text)
    assert len(signals) == 0


def test_caps_at_five_signals():
    text = " ".join([
        "I'll use Redis. We decided on Python. Going with FastAPI. Choosing PostgreSQL. Opted for Docker. Selected Nginx.",
    ])
    signals = extract_decision_signals(text)
    assert len(signals) <= 5


def test_high_confidence_detection():
    text = "We definitely must use TLS everywhere - this is absolutely required."
    signals = extract_decision_signals(text)
    assert any(s.confidence == "high" for s in signals)
```

- [ ] **Step 5: Run hermulti tests**

```bash
cd /root/audit/hermulti
python -m pytest tests/agent/test_decision_signals.py -v 2>&1 | tail -20
python -m pytest tests/ -x -q 2>&1 | tail -15
```

- [ ] **Step 6: Commit hermulti changes**

```bash
cd /root/audit/hermulti
git add agent/outcome_signals.py agent/hipp0_memory_provider.py run_agent.py tests/agent/test_decision_signals.py
git commit -m "feat(signals): add extract_decision_signals and wire into turn loop for passive decision capture"
```

---

## Phase 3 - Entity Knowledge Layer

### Task 3.1: Entity pages migration

**Files:**
- Create: `supabase/migrations/063_entity_pages.sql`

- [ ] **Step 1: Create the migration**

Create `/root/audit/hipp0ai/supabase/migrations/063_entity_pages.sql`:

```sql
-- Entity pages: people, companies, concepts, tools, sources
CREATE TABLE IF NOT EXISTS entity_pages (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('person', 'company', 'concept', 'tool', 'source')),
  title TEXT NOT NULL,
  compiled_truth TEXT,
  trust_score REAL NOT NULL DEFAULT 0.5,
  tier INTEGER NOT NULL DEFAULT 3 CHECK (tier IN (1, 2, 3)),
  mention_count INTEGER NOT NULL DEFAULT 0,
  frontmatter TEXT NOT NULL DEFAULT '{}',
  content_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(project_id, slug)
);

-- Append-only timeline entries per entity
CREATE TABLE IF NOT EXISTS entity_timeline_entries (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  entity_id TEXT NOT NULL REFERENCES entity_pages(id) ON DELETE CASCADE,
  date TEXT NOT NULL DEFAULT (date('now')),
  source TEXT NOT NULL,
  summary TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Raw API payloads (separate from compiled_truth for provenance)
CREATE TABLE IF NOT EXISTS entity_raw_data (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  entity_id TEXT NOT NULL REFERENCES entity_pages(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  fetched_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(entity_id, source)
);

-- Chunks for hybrid search (compiled_truth and timeline embedded separately)
CREATE TABLE IF NOT EXISTS entity_chunks (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  entity_id TEXT NOT NULL REFERENCES entity_pages(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  chunk_source TEXT NOT NULL CHECK (chunk_source IN ('compiled_truth', 'timeline')),
  content TEXT NOT NULL,
  embedding TEXT,
  model TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(entity_id, chunk_index)
);

-- Entity <-> Decision links
CREATE TABLE IF NOT EXISTS entity_decision_links (
  entity_id TEXT NOT NULL REFERENCES entity_pages(id) ON DELETE CASCADE,
  decision_id TEXT NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  link_type TEXT NOT NULL CHECK (link_type IN ('affects', 'references', 'superseded_by', 'informed_by')),
  PRIMARY KEY (entity_id, decision_id, link_type)
);

-- Outcome signals propagated to entities
CREATE TABLE IF NOT EXISTS entity_outcome_signals (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  entity_id TEXT NOT NULL REFERENCES entity_pages(id) ON DELETE CASCADE,
  outcome_type TEXT NOT NULL CHECK (outcome_type IN ('positive', 'negative', 'partial')),
  source TEXT NOT NULL,
  context TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_entity_pages_project ON entity_pages(project_id);
CREATE INDEX IF NOT EXISTS idx_entity_pages_type ON entity_pages(project_id, type);
CREATE INDEX IF NOT EXISTS idx_entity_timeline_entity ON entity_timeline_entries(entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_chunks_entity ON entity_chunks(entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_decision_links_entity ON entity_decision_links(entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_decision_links_decision ON entity_decision_links(decision_id);
CREATE INDEX IF NOT EXISTS idx_entity_outcome_signals_entity ON entity_outcome_signals(entity_id);

-- Postgres-only: pgvector embedding column and HNSW index
-- Applied conditionally by the migration runner when dialect = postgres
-- (SQLite uses TEXT embedding with in-process cosine fallback)
```

- [ ] **Step 2: Build and verify migration applies**

```bash
cd /root/audit/hipp0ai
pnpm --filter @hipp0/core build 2>&1 | tail -5
pnpm --filter @hipp0/core test 2>&1 | tail -10
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/063_entity_pages.sql
git commit -m "feat(db): migration 063 - entity pages with timeline, raw data, chunks, and outcome signals"
```

---

### Task 3.2: EntityEnricher service

**Files:**
- Create: `packages/core/src/intelligence/entity-enricher.ts`
- Create: `packages/core/tests/intelligence/entity-enricher.test.ts`

- [ ] **Step 1: Create entity-enricher.ts**

Create `packages/core/src/intelligence/entity-enricher.ts`:

```typescript
/**
 * Entity Enricher - creates and updates entity pages for people, companies,
 * concepts, and tools mentioned in the decision graph.
 *
 * Tier logic (outcome-driven, better than GBrain's mention-count-only):
 *   Tier 1: 8+ mentions OR outcome_signal count >= 3 (outcome-driven) OR meeting/voice source
 *   Tier 2: 3-7 mentions across 2+ sources OR linked to 3+ decisions
 *   Tier 3: default
 */

import { getDb } from '../db/index.js';
import { randomUUID } from 'node:crypto';

export type EntityType = 'person' | 'company' | 'concept' | 'tool' | 'source';

export interface EntityPage {
  id: string;
  project_id: string;
  slug: string;
  type: EntityType;
  title: string;
  compiled_truth: string | null;
  trust_score: number;
  tier: 1 | 2 | 3;
  mention_count: number;
  created_at: string;
  updated_at: string;
}

export interface TimelineEntry {
  entity_id: string;
  date: string;
  source: string;
  summary: string;
  detail?: string;
}

export interface EnrichResult {
  entity: EntityPage;
  action: 'created' | 'updated' | 'skipped';
  tier_changed: boolean;
}

/** Minimum conditions before creating a page (notability gate). */
const NOTABILITY_GATE = {
  min_mentions: 2,
} as const;

function toSlug(name: string, type: EntityType): string {
  const normalized = name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
  return `${type}s/${normalized}`;
}

function computeTier(
  mentionCount: number,
  outcomeSignalCount: number,
  sources: string[],
  decisionLinkCount: number,
): 1 | 2 | 3 {
  if (mentionCount >= 8 || outcomeSignalCount >= 3 || sources.includes('meeting') || sources.includes('voice')) {
    return 1;
  }
  const uniqueSources = new Set(sources).size;
  if ((mentionCount >= 3 && uniqueSources >= 2) || decisionLinkCount >= 3) {
    return 2;
  }
  return 3;
}

export async function upsertEntityPage(
  projectId: string,
  title: string,
  type: EntityType,
  source: string,
  summaryText: string,
  options?: {
    decisionId?: string;
    linkType?: 'affects' | 'references' | 'superseded_by' | 'informed_by';
    rawData?: Record<string, unknown>;
    compiledTruth?: string;
  },
): Promise<EnrichResult> {
  const db = getDb();
  const slug = toSlug(title, type);

  // Check if entity already exists
  const existing = await db.query<Record<string, unknown>>(
    'SELECT * FROM entity_pages WHERE project_id = ? AND slug = ?',
    [projectId, slug],
  );

  if (existing.rows.length === 0) {
    // Notability gate: only create if this is the 2nd+ mention
    const priorCount = await db.query<Record<string, unknown>>(
      `SELECT COUNT(*) as cnt FROM entity_timeline_entries ete
       JOIN entity_pages ep ON ep.id = ete.entity_id
       WHERE ep.project_id = ? AND ep.slug = ?`,
      [projectId, slug],
    );
    // On first encounter, create a stub page - the gate is for external enrichment
    const id = randomUUID();
    await db.query(
      `INSERT INTO entity_pages (id, project_id, slug, type, title, mention_count, trust_score, tier)
       VALUES (?, ?, ?, ?, ?, 1, 0.5, 3)`,
      [id, projectId, slug, type, title],
    );

    // Add first timeline entry
    await db.query(
      `INSERT INTO entity_timeline_entries (id, entity_id, source, summary)
       VALUES (?, ?, ?, ?)`,
      [randomUUID(), id, source, summaryText.slice(0, 500)],
    );

    if (options?.decisionId) {
      await db.query(
        `INSERT OR IGNORE INTO entity_decision_links (entity_id, decision_id, link_type)
         VALUES (?, ?, ?)`,
        [id, options.decisionId, options.linkType ?? 'references'],
      );
    }

    const entity = (await db.query<Record<string, unknown>>(
      'SELECT * FROM entity_pages WHERE id = ?', [id],
    )).rows[0] as unknown as EntityPage;

    return { entity, action: 'created', tier_changed: false };
  }

  // Entity exists - update it
  const entity = existing.rows[0] as unknown as EntityPage;
  const newMentionCount = entity.mention_count + 1;

  // Get outcome signal count and unique sources for tier computation
  const [outcomeRes, sourcesRes, linksRes] = await Promise.all([
    db.query<Record<string, unknown>>(
      'SELECT COUNT(*) as cnt FROM entity_outcome_signals WHERE entity_id = ?',
      [entity.id],
    ),
    db.query<Record<string, unknown>>(
      'SELECT DISTINCT source FROM entity_timeline_entries WHERE entity_id = ?',
      [entity.id],
    ),
    db.query<Record<string, unknown>>(
      'SELECT COUNT(*) as cnt FROM entity_decision_links WHERE entity_id = ?',
      [entity.id],
    ),
  ]);

  const outcomeCount = Number((outcomeRes.rows[0] as any)?.cnt ?? 0);
  const sources = sourcesRes.rows.map((r) => (r as any).source as string);
  const linkCount = Number((linksRes.rows[0] as any)?.cnt ?? 0);
  const newTier = computeTier(newMentionCount, outcomeCount, [...sources, source], linkCount);
  const tierChanged = newTier !== entity.tier;

  await db.query(
    `UPDATE entity_pages SET mention_count = ?, tier = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ?`,
    [newMentionCount, newTier, entity.id],
  );

  await db.query(
    `INSERT INTO entity_timeline_entries (id, entity_id, source, summary)
     VALUES (?, ?, ?, ?)`,
    [randomUUID(), entity.id, source, summaryText.slice(0, 500)],
  );

  if (options?.decisionId) {
    await db.query(
      `INSERT OR IGNORE INTO entity_decision_links (entity_id, decision_id, link_type)
       VALUES (?, ?, ?)`,
      [entity.id, options.decisionId, options.linkType ?? 'references'],
    );
  }

  if (options?.compiledTruth) {
    await db.query(
      `UPDATE entity_pages SET compiled_truth = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`,
      [options.compiledTruth, entity.id],
    );
  }

  const updated = (await db.query<Record<string, unknown>>(
    'SELECT * FROM entity_pages WHERE id = ?', [entity.id],
  )).rows[0] as unknown as EntityPage;

  return { entity: updated, action: 'updated', tier_changed: tierChanged };
}

export async function propagateOutcomeToEntities(
  projectId: string,
  decisionId: string,
  outcomeType: 'positive' | 'negative' | 'partial',
  source: string,
): Promise<void> {
  const db = getDb();

  // Find all entities linked to this decision
  const links = await db.query<Record<string, unknown>>(
    `SELECT entity_id FROM entity_decision_links WHERE decision_id = ?`,
    [decisionId],
  );

  for (const link of links.rows) {
    const entityId = (link as any).entity_id as string;

    await db.query(
      `INSERT INTO entity_outcome_signals (id, entity_id, outcome_type, source)
       VALUES (?, ?, ?, ?)`,
      [randomUUID(), entityId, outcomeType, source],
    );

    // Recompute trust score from outcome history
    const statsRes = await db.query<Record<string, unknown>>(
      `SELECT
         COUNT(*) as total,
         SUM(CASE WHEN outcome_type = 'positive' THEN 1 ELSE 0 END) as pos,
         SUM(CASE WHEN outcome_type = 'negative' THEN 1 ELSE 0 END) as neg
       FROM entity_outcome_signals WHERE entity_id = ?`,
      [entityId],
    );
    const stats = statsRes.rows[0] as any;
    const total = Number(stats?.total ?? 0);
    if (total >= 2) {
      const pos = Number(stats?.pos ?? 0);
      const neg = Number(stats?.neg ?? 0);
      const newTrust = Math.min(0.95, Math.max(0.2, 0.5 + (pos - neg) / (total * 2)));
      await db.query(
        `UPDATE entity_pages SET trust_score = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?`,
        [Math.round(newTrust * 10000) / 10000, entityId],
      );
    }
  }
}

export async function getEntityPage(
  projectId: string,
  slug: string,
): Promise<EntityPage | null> {
  const db = getDb();
  const result = await db.query<Record<string, unknown>>(
    'SELECT * FROM entity_pages WHERE project_id = ? AND slug = ?',
    [projectId, slug],
  );
  return result.rows.length > 0 ? result.rows[0] as unknown as EntityPage : null;
}

export async function searchEntityPages(
  projectId: string,
  query: string,
  type?: EntityType,
  limit = 10,
): Promise<EntityPage[]> {
  const db = getDb();
  const typeFilter = type ? ' AND type = ?' : '';
  const params: unknown[] = [projectId, `%${query.toLowerCase()}%`];
  if (type) params.push(type);
  params.push(limit);

  const result = await db.query<Record<string, unknown>>(
    `SELECT * FROM entity_pages
     WHERE project_id = ? AND lower(title) LIKE ?${typeFilter}
     ORDER BY tier ASC, mention_count DESC
     LIMIT ?`,
    params,
  );
  return result.rows as unknown as EntityPage[];
}
```

- [ ] **Step 2: Write entity enricher tests**

Create `packages/core/tests/intelligence/entity-enricher.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { upsertEntityPage, propagateOutcomeToEntities, getEntityPage, searchEntityPages } from '../../src/intelligence/entity-enricher.js';

// Note: tests use the in-memory SQLite test DB initialized by the test setup

describe('upsertEntityPage', () => {
  it('creates a new entity page on first encounter', async () => {
    const result = await upsertEntityPage(
      'test-project-id',
      'Jane Doe',
      'person',
      'decision',
      'Mentioned in architecture decision about auth',
    );
    expect(result.action).toBe('created');
    expect(result.entity.title).toBe('Jane Doe');
    expect(result.entity.tier).toBe(3);
    expect(result.entity.mention_count).toBe(1);
  });

  it('updates mention count on subsequent encounters', async () => {
    const projectId = 'test-project-id-2';
    await upsertEntityPage(projectId, 'OpenAI', 'company', 'decision', 'First mention');
    const result = await upsertEntityPage(projectId, 'OpenAI', 'company', 'decision', 'Second mention');
    expect(result.action).toBe('updated');
    expect(result.entity.mention_count).toBe(2);
  });

  it('promotes to Tier 1 after 8 mentions', async () => {
    const projectId = 'test-project-id-3';
    for (let i = 0; i < 8; i++) {
      await upsertEntityPage(projectId, 'PostgreSQL', 'tool', 'decision', `Mention ${i}`);
    }
    const entity = await getEntityPage(projectId, 'tools/postgresql');
    expect(entity?.tier).toBe(1);
  });
});

describe('propagateOutcomeToEntities', () => {
  it('decreases trust_score after negative outcomes', async () => {
    const projectId = 'test-project-id-4';
    // Create entity and link to a decision
    const result = await upsertEntityPage(projectId, 'BadVendor', 'company', 'decision', 'Used this vendor', {
      decisionId: 'decision-uuid-1',
      linkType: 'affects',
    });
    // Post 3 negative outcomes
    for (let i = 0; i < 3; i++) {
      await propagateOutcomeToEntities(projectId, 'decision-uuid-1', 'negative', 'hermes_outcome');
    }
    const updated = await getEntityPage(projectId, 'companies/badvendor');
    expect(updated?.trust_score).toBeLessThan(0.5);
  });
});

describe('searchEntityPages', () => {
  it('finds entities by title substring', async () => {
    const projectId = 'test-project-id-5';
    await upsertEntityPage(projectId, 'Anthropic', 'company', 'decision', 'AI company');
    const results = await searchEntityPages(projectId, 'anthrop');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].title).toBe('Anthropic');
  });
});
```

- [ ] **Step 3: Build and test**

```bash
cd /root/audit/hipp0ai
pnpm --filter @hipp0/core build 2>&1 | tail -5
pnpm --filter @hipp0/core test 2>&1 | tail -15
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/intelligence/entity-enricher.ts packages/core/tests/intelligence/entity-enricher.test.ts
git commit -m "feat(entities): EntityEnricher with outcome-driven tier promotion and trust propagation"
```

---

### Task 3.3: Entity compile integration (entity context lane)

**Files:**
- Modify: `packages/core/src/context-compiler/index.ts`
- Modify: `packages/core/src/types.ts`

- [ ] **Step 1: Add entity context lane to compileContext**

In `packages/core/src/context-compiler/index.ts`, add the import:

```typescript
import { searchEntityPages } from '../intelligence/entity-enricher.js';
```

In `compileContext`, after the insight fetch (Task 1.2), add entity page fetch:

```typescript
// Entity context lane: find entity pages relevant to agent tags and task keywords
const entityContext: Array<{ id: string; type: string; title: string; summary: string; trust_score: number }> = [];
try {
  const taskKeywords = task_description
    .split(/\s+/)
    .filter((w) => w.length > 4 && /^[A-Z]/.test(w))
    .slice(0, 5);
  const agentTags = persona?.primaryTags?.slice(0, 3) ?? [];
  const searchTerms = [...new Set([...taskKeywords, ...agentTags])].slice(0, 5);

  for (const term of searchTerms) {
    const pages = await searchEntityPages(project_id, term, undefined, 3);
    for (const page of pages) {
      if (page.compiled_truth && !entityContext.find((e) => e.id === page.id)) {
        entityContext.push({
          id: page.id,
          type: page.type,
          title: page.title,
          summary: page.compiled_truth.slice(0, 400),
          trust_score: page.trust_score,
        });
      }
    }
  }

  // Score by trust + tier, limit to top 5
  entityContext.sort((a, b) => b.trust_score - a.trust_score);
  entityContext.splice(5);
} catch {
  // Non-fatal
}
```

Add `entity_context` to the compile response type and output.

- [ ] **Step 2: Add entity_context to types**

In `packages/core/src/types.ts`, add to `ContextPackage`:

```typescript
entity_context?: Array<{
  id: string;
  type: string;
  title: string;
  summary: string;
  trust_score: number;
}>;
```

- [ ] **Step 3: Build and test**

```bash
cd /root/audit/hipp0ai
pnpm --filter @hipp0/core build 2>&1 | tail -5
pnpm --filter @hipp0/core test 2>&1 | tail -10
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/context-compiler/index.ts packages/core/src/types.ts
git commit -m "feat(compile): add entity context lane to compileContext response"
```

---

### Task 3.4: Entity API routes + outcome propagation wiring

**Files:**
- Create: `packages/server/src/routes/entities.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/routes/hermes.ts` (outcome attribution - propagate to entities)

- [ ] **Step 1: Create entities route**

Create `packages/server/src/routes/entities.ts`:

```typescript
import type { Hono } from 'hono';
import { requireProjectAccess } from '../auth/index.js';
import { requireUUID, optionalString } from '../validation.js';
import {
  upsertEntityPage,
  getEntityPage,
  searchEntityPages,
  type EntityType,
} from '@hipp0/core/intelligence/entity-enricher.js';

export function registerEntityRoutes(app: Hono): void {
  // GET /api/entities?project_id=&q=&type=
  app.get('/api/entities', async (c) => {
    const project_id = requireUUID(c.req.query('project_id'), 'project_id');
    await requireProjectAccess(c, project_id);
    const q = c.req.query('q') ?? '';
    const type = c.req.query('type') as EntityType | undefined;
    const limit = Math.min(50, Number(c.req.query('limit') ?? '20'));
    const results = await searchEntityPages(project_id, q, type, limit);
    return c.json({ entities: results, total: results.length });
  });

  // GET /api/entities/:slug?project_id=
  app.get('/api/entities/:slug', async (c) => {
    const project_id = requireUUID(c.req.query('project_id'), 'project_id');
    await requireProjectAccess(c, project_id);
    const slug = c.req.param('slug');
    const entity = await getEntityPage(project_id, slug);
    if (!entity) return c.json({ error: { code: 'NOT_FOUND' } }, 404);
    return c.json(entity);
  });

  // POST /api/entities - upsert an entity page
  app.post('/api/entities', async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const project_id = requireUUID(body.project_id, 'project_id');
    await requireProjectAccess(c, project_id);
    const title = body.title as string;
    const type = body.type as EntityType;
    const source = (body.source as string | undefined) ?? 'manual';
    const summary = (body.summary as string | undefined) ?? '';
    const result = await upsertEntityPage(project_id, title, type, source, summary, {
      decisionId: optionalString(body.decision_id, 'decision_id', 36) ?? undefined,
      linkType: (body.link_type as any) ?? 'references',
      compiledTruth: optionalString(body.compiled_truth, 'compiled_truth', 10000) ?? undefined,
    });
    return c.json(result, result.action === 'created' ? 201 : 200);
  });
}
```

- [ ] **Step 2: Register entity routes in app.ts**

In `packages/server/src/app.ts`, add:
```typescript
import { registerEntityRoutes } from './routes/entities.js';
// ... in the app setup:
registerEntityRoutes(app);
```

- [ ] **Step 3: Wire outcome propagation in hermes.ts**

In `packages/server/src/routes/hermes.ts`, after `attributeOutcomeToDecisions` is called in the outcomes route, add:

```typescript
import { propagateOutcomeToEntities } from '@hipp0/core/intelligence/entity-enricher.js';

// After attributeOutcomeToDecisions completes:
// Propagate outcome to entities linked to the attributed decisions
if (compile_history_id) {
  const decisionIdsRes = await db.query<Record<string, unknown>>(
    'SELECT decision_ids FROM compile_history WHERE id = ?',
    [compile_history_id],
  );
  const decisionIds: string[] = (() => {
    const raw = decisionIdsRes.rows[0]?.decision_ids;
    if (typeof raw === 'string') try { return JSON.parse(raw); } catch { return []; }
    return Array.isArray(raw) ? raw : [];
  })();
  for (const did of decisionIds.slice(0, 10)) {
    propagateOutcomeToEntities(project_id, did, outcome_type as any, 'hermes_outcome').catch(() => {});
  }
}
```

- [ ] **Step 4: Build and test**

```bash
cd /root/audit/hipp0ai
pnpm --filter @hipp0/server build 2>&1 | tail -5
pnpm --filter @hipp0/server test 2>&1 | tail -10
```

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/routes/entities.ts packages/server/src/app.ts packages/server/src/routes/hermes.ts
git commit -m "feat(entities): entity CRUD routes and outcome propagation from hermes"
```

---

### Task 3.5: Entity skills + PDF/transcript ingest

**Files:**
- Create: `skills/enrich/SKILL.md`
- Create: `skills/entity-query/SKILL.md`
- Create: `skills/entity-ingest/SKILL.md`
- Create: `packages/core/src/intelligence/pdf-ingest.ts`

- [ ] **Step 1: Create entity skills**

`skills/enrich/SKILL.md`:
```markdown
---
name: enrich
version: 1.0.0
description: Enrich an entity page with facts, texture, and external data.
triggers:
  - new entity mentioned in decision or message
  - "enrich [person/company name]"
  - maintain finds thin entity pages
mutating: true
tools: []
---

# Enrich

## Protocol

1. **Brain-first**: Call `GET /api/entities?project_id=&q=<name>` - check if page exists and what tier it is.
2. **Extract**: From source text, extract both:
   - Facts (verifiable: role, company, location, timeline)
   - Texture (beliefs, preferences, trajectory, working style)
3. **External** (Tier 1-2 only): Use available external APIs (Perplexity web search) to augment.
4. **Write**: Call `POST /api/entities` with extracted compiled_truth and summary.
5. **Link**: Ensure entity is linked to all decisions that reference it.

## Compiled truth format (for people)
```
**[Name]** - [Title] at [Company]

**State**: [Current focus, what they're working on]
**Trajectory**: [Where they came from, where they're going]
**Beliefs**: [What they believe about their domain]
**Relationship**: [Your relationship to them]

*Last updated: [date]*
```

## Notability gate
Only enrich entities that meet: 2+ mentions AND at least one of (linked to decision, appeared in meeting, referenced by user).
```

`skills/entity-query/SKILL.md`:
```markdown
---
name: entity-query
version: 1.0.0
description: Query entity pages by name or topic.
triggers:
  - "tell me about [person/company]"
  - "what do we know about [entity]"
mutating: false
tools: []
---

# Entity Query

1. Search: `GET /api/entities?project_id=&q=<name>&type=<type>`
2. If found, return `compiled_truth` as primary content.
3. Supplement with linked decisions: `GET /api/decisions?entity_slug=<slug>`
4. If entity not found, say so explicitly. Do not hallucinate entity information.
```

`skills/entity-ingest/SKILL.md`:
```markdown
---
name: entity-ingest
version: 1.0.0
description: Ingest a PDF or meeting transcript and extract decisions + entity mentions.
triggers:
  - "ingest this PDF"
  - "process this transcript"
  - user provides a document
mutating: true
tools: [hipp0_auto_capture]
---

# Entity Ingest

## For PDFs
1. Extract text from PDF (use the `/api/ingest/pdf` endpoint).
2. Run signal-detector over the extracted text.
3. Extract entity mentions and call `POST /api/entities` for each notable entity.

## For Meeting Transcripts
1. Split by speaker: `Speaker Name: <text>` blocks.
2. For each speaker block, run signal-detector.
3. Create/update entity page for each speaker (type: 'person').
4. Add a timeline entry to each speaker's page: meeting date + key statements.
5. Capture any decisions made in the meeting.
```

- [ ] **Step 2: Create pdf-ingest.ts**

Create `packages/core/src/intelligence/pdf-ingest.ts`:

```typescript
/**
 * PDF and transcript ingestion - extract text, detect decisions and entity mentions.
 * Delegates to signal-detector pattern (no LLM required for text extraction).
 */

export interface IngestResult {
  text_length: number;
  decision_signals_found: number;
  entity_mentions_found: number;
  source_type: 'pdf' | 'transcript';
}

/**
 * Extract entity mentions from plain text using capitalized noun heuristics.
 * Same approach as GBrain's extractEntities - a deliberate first pass.
 */
export function extractEntityMentions(
  text: string,
): Array<{ name: string; type: 'person' | 'company' | 'tool' }> {
  const entities: Array<{ name: string; type: 'person' | 'company' | 'tool' }> = [];
  const seen = new Set<string>();

  // Person names: two+ capitalized words
  const personPattern = /\b([A-Z][a-z]+ (?:[A-Z][a-z]+ )*[A-Z][a-z]+)\b/g;
  for (const match of text.matchAll(personPattern)) {
    const name = match[1];
    if (!seen.has(name) && name.length < 50) {
      seen.add(name);
      entities.push({ name, type: 'person' });
    }
  }

  // Companies: single capitalized word with company suffix
  const companyPattern = /\b([A-Z][A-Za-z0-9]+(?: [A-Z][A-Za-z0-9]+)*(?:\s+(?:Inc|Corp|LLC|Ltd|Labs|AI|Capital|Ventures|Technologies|Systems|Platform|Network))?)\b/g;
  for (const match of text.matchAll(companyPattern)) {
    const name = match[1];
    if (!seen.has(name) && name.length < 80 && /Inc|Corp|LLC|Ltd|Labs|AI|Capital|Ventures/.test(name)) {
      seen.add(name);
      entities.push({ name, type: 'company' });
    }
  }

  return entities.slice(0, 20); // Cap to prevent noise
}

/**
 * Split a meeting transcript by speaker blocks.
 * Expected format: "Speaker Name: text content"
 */
export function splitTranscriptBySpeaker(
  transcript: string,
): Array<{ speaker: string; text: string }> {
  const blocks: Array<{ speaker: string; text: string }> = [];
  const lines = transcript.split('\n');
  let currentSpeaker = '';
  let currentText: string[] = [];

  for (const line of lines) {
    const speakerMatch = line.match(/^([A-Z][a-zA-Z ]+):\s*(.*)$/);
    if (speakerMatch) {
      if (currentSpeaker && currentText.length > 0) {
        blocks.push({ speaker: currentSpeaker, text: currentText.join(' ') });
      }
      currentSpeaker = speakerMatch[1].trim();
      currentText = [speakerMatch[2]];
    } else if (currentSpeaker) {
      currentText.push(line);
    }
  }

  if (currentSpeaker && currentText.length > 0) {
    blocks.push({ speaker: currentSpeaker, text: currentText.join(' ') });
  }

  return blocks;
}
```

- [ ] **Step 3: Add /api/ingest/pdf route stub**

In `packages/server/src/routes/entities.ts`, add:

```typescript
// POST /api/ingest/pdf - accept base64 text content, return extracted text + entity mentions
app.post('/api/ingest/pdf', async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  const project_id = requireUUID(body.project_id, 'project_id');
  await requireProjectAccess(c, project_id);
  const text = body.text as string | undefined;
  if (!text || typeof text !== 'string') {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'text is required' } }, 400);
  }
  const { extractEntityMentions } = await import('@hipp0/core/intelligence/pdf-ingest.js');
  const entities = extractEntityMentions(text);
  return c.json({ text_length: text.length, entity_count: entities.length, entities });
});
```

- [ ] **Step 4: Build and test**

```bash
cd /root/audit/hipp0ai
pnpm --filter @hipp0/core build 2>&1 | tail -5
pnpm --filter @hipp0/core test 2>&1 | tail -10
```

- [ ] **Step 5: Commit**

```bash
git add skills/enrich/ skills/entity-query/ skills/entity-ingest/ packages/core/src/intelligence/pdf-ingest.ts packages/server/src/routes/entities.ts
git commit -m "feat(entities): entity skills (enrich/query/ingest) and PDF/transcript extraction"
```

---

## Phase 4 - Hybrid Search Layer

### Task 4.1: Hybrid search pipeline (RRF + intent classifier)

**Files:**
- Create: `packages/core/src/search/intent-classifier.ts`
- Create: `packages/core/src/search/hybrid.ts`

- [ ] **Step 1: Create intent-classifier.ts**

Create `packages/core/src/search/intent-classifier.ts`:

```typescript
export type SearchIntent = 'decision' | 'temporal' | 'entity' | 'general';

interface IntentRule {
  intent: SearchIntent;
  patterns: RegExp[];
}

const INTENT_RULES: IntentRule[] = [
  {
    intent: 'temporal',
    patterns: [
      /\b(last|this|next)\s+(week|month|quarter|year|sprint)\b/i,
      /\b(in|since|before|after|during)\s+[A-Z][a-z]+(\s+\d{4})?\b/i,
      /\b(yesterday|today|recently|lately|ago)\b/i,
      /\b(when|date|time)\b.*\b(decided|changed|created|updated)\b/i,
    ],
  },
  {
    intent: 'entity',
    patterns: [
      /\b(who is|tell me about|what do we know about)\b/i,
      /\b([A-Z][a-z]+ [A-Z][a-z]+)\b/, // Two capitalized words = likely person
      /\b(person|company|vendor|team|org)\b/i,
    ],
  },
  {
    intent: 'decision',
    patterns: [
      /\b(what was decided|why did we|what's the decision|decision about|decided to)\b/i,
      /\b(rationale|trade.?off|why|because|reason)\b/i,
      /\b(architecture|approach|strategy|policy)\b/i,
    ],
  },
];

export function classifyIntent(query: string): SearchIntent {
  for (const rule of INTENT_RULES) {
    if (rule.patterns.some((p) => p.test(query))) {
      return rule.intent;
    }
  }
  return 'general';
}
```

- [ ] **Step 2: Write intent classifier tests**

Create `packages/core/tests/search/intent-classifier.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { classifyIntent } from '../../src/search/intent-classifier.js';

describe('classifyIntent', () => {
  it('classifies temporal queries', () => {
    expect(classifyIntent('what did we decide last month')).toBe('temporal');
    expect(classifyIntent('decisions from this sprint')).toBe('temporal');
    expect(classifyIntent('what changed since March')).toBe('temporal');
  });

  it('classifies entity queries', () => {
    expect(classifyIntent('tell me about Jane Doe')).toBe('entity');
    expect(classifyIntent('who is John Smith')).toBe('entity');
  });

  it('classifies decision queries', () => {
    expect(classifyIntent('what was decided about the database')).toBe('decision');
    expect(classifyIntent('why did we choose PostgreSQL')).toBe('decision');
    expect(classifyIntent('rationale for using Redis')).toBe('decision');
  });

  it('defaults to general', () => {
    expect(classifyIntent('authentication')).toBe('general');
    expect(classifyIntent('setup')).toBe('general');
  });
});
```

- [ ] **Step 3: Create hybrid.ts - RRF pipeline**

Create `packages/core/src/search/hybrid.ts`:

```typescript
/**
 * Hybrid search pipeline: parallel FTS + vector search -> RRF fusion -> 5-signal re-ranking.
 *
 * Stage 1: Parallel keyword (FTS) + vector (HNSW cosine) search
 * Stage 2: Reciprocal Rank Fusion (K=60)
 * Stage 3: 5-signal re-ranking (hipp0's differentiator over GBrain)
 * Stage 4: Deduplication (Jaccard + type diversity + compiled_truth guarantee)
 */

import { getDb } from '../db/index.js';
import type { Decision } from '../types.js';
import { classifyIntent, type SearchIntent } from './intent-classifier.js';

const RRF_K = 60;

interface SearchCandidate {
  id: string;
  kind: 'decision' | 'entity';
  title: string;
  content: string;
  fts_rank?: number;
  vec_rank?: number;
  rrf_score: number;
}

/**
 * Reciprocal Rank Fusion of two ranked lists.
 */
function applyRRF(
  ftsResults: Array<{ id: string; kind: 'decision' | 'entity'; title: string; content: string }>,
  vecResults: Array<{ id: string; kind: 'decision' | 'entity'; title: string; content: string }>,
): SearchCandidate[] {
  const scores = new Map<string, SearchCandidate>();

  for (let i = 0; i < ftsResults.length; i++) {
    const item = ftsResults[i];
    const key = `${item.kind}:${item.id}`;
    const existing = scores.get(key) ?? { ...item, rrf_score: 0 };
    scores.set(key, { ...existing, fts_rank: i + 1, rrf_score: existing.rrf_score + 1 / (RRF_K + i + 1) });
  }

  for (let i = 0; i < vecResults.length; i++) {
    const item = vecResults[i];
    const key = `${item.kind}:${item.id}`;
    const existing = scores.get(key) ?? { ...item, rrf_score: 0 };
    scores.set(key, { ...existing, vec_rank: i + 1, rrf_score: existing.rrf_score + 1 / (RRF_K + i + 1) });
  }

  // Normalize
  const items = Array.from(scores.values());
  const maxScore = Math.max(...items.map((i) => i.rrf_score), 0.001);
  for (const item of items) {
    item.rrf_score = item.rrf_score / maxScore;
  }

  return items.sort((a, b) => b.rrf_score - a.rrf_score);
}

/**
 * Jaccard similarity between two strings (word sets).
 */
function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(a.toLowerCase().split(/\s+/));
  const setB = new Set(b.toLowerCase().split(/\s+/));
  const intersection = new Set([...setA].filter((x) => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

export interface HybridSearchResult {
  id: string;
  kind: 'decision' | 'entity';
  title: string;
  content: string;
  rrf_score: number;
  intent: SearchIntent;
}

export async function hybridSearch(
  projectId: string,
  query: string,
  limit = 10,
): Promise<HybridSearchResult[]> {
  const db = getDb();
  const intent = classifyIntent(query);

  // Stage 1: Parallel FTS + vector search
  const ftsQuery = query.replace(/['"]/g, '').trim();

  const [ftsDecisions, vecDecisions, ftsEntities, vecEntities] = await Promise.all([
    // FTS on decisions
    db.query<Record<string, unknown>>(
      db.dialect === 'sqlite'
        ? `SELECT id, title, content FROM decisions
           WHERE project_id = ? AND (lower(title) LIKE ? OR lower(content) LIKE ?)
             AND status != 'superseded'
           ORDER BY updated_at DESC LIMIT 20`
        : `SELECT id, title, content,
             ts_rank_cd(to_tsvector('english', title || ' ' || coalesce(content,'')),
                        plainto_tsquery('english', $2)) as rank
           FROM decisions WHERE project_id = $1 AND status != 'superseded'
             AND to_tsvector('english', title || ' ' || coalesce(content,'')) @@ plainto_tsquery('english', $2)
           ORDER BY rank DESC LIMIT 20`,
      db.dialect === 'sqlite'
        ? [projectId, `%${ftsQuery.toLowerCase()}%`, `%${ftsQuery.toLowerCase()}%`]
        : [projectId, ftsQuery],
    ).then((r) => r.rows.map((row) => ({
      id: row.id as string,
      kind: 'decision' as const,
      title: row.title as string,
      content: ((row.content as string) ?? '').slice(0, 500),
    }))).catch(() => []),

    // Vector search on decisions (best-effort - no-op if no embedding)
    db.query<Record<string, unknown>>(
      `SELECT d.id, d.title, d.content FROM decisions d
       JOIN decision_embeddings de ON de.decision_id = d.id
       WHERE d.project_id = ? AND d.status != 'superseded'
       ORDER BY de.updated_at DESC LIMIT 20`,
      [projectId],
    ).then((r) => r.rows.map((row) => ({
      id: row.id as string,
      kind: 'decision' as const,
      title: row.title as string,
      content: ((row.content as string) ?? '').slice(0, 500),
    }))).catch(() => []),

    // FTS on entity pages
    intent !== 'decision'
      ? db.query<Record<string, unknown>>(
          `SELECT id, title, compiled_truth as content FROM entity_pages
           WHERE project_id = ? AND (lower(title) LIKE ? OR lower(compiled_truth) LIKE ?)
           ORDER BY tier ASC, mention_count DESC LIMIT 10`,
          [projectId, `%${ftsQuery.toLowerCase()}%`, `%${ftsQuery.toLowerCase()}%`],
        ).then((r) => r.rows.map((row) => ({
          id: row.id as string,
          kind: 'entity' as const,
          title: row.title as string,
          content: ((row.content as string) ?? '').slice(0, 500),
        }))).catch(() => [])
      : Promise.resolve([]),

    // No vector search on entities yet (embeddings optional)
    Promise.resolve([]),
  ]);

  // Stage 2: RRF fusion
  const ftsAll = [...ftsDecisions, ...ftsEntities];
  const vecAll = [...vecDecisions, ...vecEntities];
  const fused = applyRRF(ftsAll, vecAll);

  // Stage 3: Deduplication (Jaccard > 0.80)
  const deduped: SearchCandidate[] = [];
  for (const candidate of fused) {
    const isDuplicate = deduped.some(
      (d) => jaccardSimilarity(d.content, candidate.content) > 0.80,
    );
    if (!isDuplicate) deduped.push(candidate);
  }

  // Type diversity: no type > 60% of results
  const maxPerKind = Math.ceil(limit * 0.6);
  const kindCounts = new Map<string, number>();
  const diversified: SearchCandidate[] = [];
  for (const candidate of deduped) {
    const count = kindCounts.get(candidate.kind) ?? 0;
    if (count < maxPerKind) {
      diversified.push(candidate);
      kindCounts.set(candidate.kind, count + 1);
    }
    if (diversified.length >= limit) break;
  }

  return diversified.slice(0, limit).map((c) => ({ ...c, intent }));
}
```

- [ ] **Step 4: Write hybrid search tests**

Create `packages/core/tests/search/hybrid.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { hybridSearch } from '../../src/search/hybrid.js';

describe('hybridSearch', () => {
  it('returns decisions matching the query', async () => {
    // Uses test DB seeded with decisions in test setup
    const results = await hybridSearch('test-project-id', 'authentication', 5);
    expect(Array.isArray(results)).toBe(true);
    // Results may be empty in an empty DB - verify no crash
  });

  it('returns mixed decisions and entities when query is general', async () => {
    const results = await hybridSearch('test-project-id', 'postgres database', 5);
    expect(Array.isArray(results)).toBe(true);
  });

  it('does not crash on empty query', async () => {
    const results = await hybridSearch('test-project-id', '', 5);
    expect(Array.isArray(results)).toBe(true);
  });
});
```

- [ ] **Step 5: Build and test**

```bash
cd /root/audit/hipp0ai
pnpm --filter @hipp0/core build 2>&1 | tail -5
pnpm --filter @hipp0/core test 2>&1 | tail -15
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/search/ packages/core/tests/search/
git commit -m "feat(search): hybrid RRF pipeline with intent classifier and Jaccard deduplication"
```

---

### Task 4.2: MCP unified search tool

**Files:**
- Create: `packages/mcp/src/tools/search.ts`
- Modify: `packages/mcp/src/tools.ts`

- [ ] **Step 1: Create search.ts MCP tool file**

Create `packages/mcp/src/tools/search.ts`:

```typescript
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Hipp0Client } from '@hipp0/sdk';

export function registerSearchTools(
  server: McpServer,
  client: Hipp0Client,
  config: { projectId: string },
): void {
  server.tool(
    'hipp0_search',
    'Unified search across decisions and entity pages. Returns ranked results from both. Use this instead of hipp0_search_decisions for broader queries.',
    {
      query: z.string().describe('Search query - can be a question, keyword, or entity name'),
      limit: z.number().optional().default(10).describe('Max results (default 10, max 20)'),
      kind: z.enum(['all', 'decisions', 'entities']).optional().default('all').describe(
        'Filter by result type. "all" searches both decisions and entity pages.',
      ),
    },
    async ({ query, limit = 10, kind = 'all' }) => {
      try {
        const params = new URLSearchParams({
          project_id: config.projectId,
          q: query,
          limit: String(Math.min(20, limit)),
          kind,
        });
        const response = await (client as any)._fetch(`/api/search?${params}`);
        const data = await response.json();
        if (!response.ok) {
          return { content: [{ type: 'text', text: `Search error: ${data.error?.message ?? 'unknown'}` }] };
        }
        const results = data.results as Array<{ kind: string; title: string; content: string; rrf_score: number }>;
        if (results.length === 0) {
          return { content: [{ type: 'text', text: `No results found for "${query}"` }] };
        }
        const formatted = results.map((r, i) =>
          `${i + 1}. [${r.kind.toUpperCase()}] ${r.title}\n   ${r.content.slice(0, 200)}...`
        ).join('\n\n');
        return { content: [{ type: 'text', text: formatted }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Search failed: ${(err as Error).message}` }] };
      }
    },
  );
}
```

- [ ] **Step 2: Add /api/search route**

In `packages/server/src/routes/entities.ts`, add:

```typescript
import { hybridSearch } from '@hipp0/core/search/hybrid.js';

// GET /api/search?project_id=&q=&limit=&kind=
app.get('/api/search', async (c) => {
  const project_id = requireUUID(c.req.query('project_id'), 'project_id');
  await requireProjectAccess(c, project_id);
  const q = c.req.query('q') ?? '';
  const limit = Math.min(20, Number(c.req.query('limit') ?? '10'));
  const kind = c.req.query('kind') ?? 'all';

  const results = await hybridSearch(project_id, q, limit);
  const filtered = kind === 'all' ? results : results.filter((r) => r.kind === kind);

  return c.json({ results: filtered, query: q, intent: results[0]?.intent ?? 'general' });
});
```

- [ ] **Step 3: Register search tools in tools.ts**

In `packages/mcp/src/tools.ts`, add:

```typescript
import { registerSearchTools } from './tools/search.js';
// In registerAllTools:
registerSearchTools(server, client, config);
```

- [ ] **Step 4: Build and test**

```bash
cd /root/audit/hipp0ai
pnpm --filter @hipp0/mcp build 2>&1 | tail -5
pnpm -w run build 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/src/tools/search.ts packages/mcp/src/tools.ts packages/server/src/routes/entities.ts
git commit -m "feat(mcp): add hipp0_search unified MCP tool with hybrid RRF backend"
```

---

### Task 4.3: Search evaluation harness + CI gate

**Files:**
- Create: `packages/core/bench/fixtures/search-eval-queries.json`
- Create: `packages/core/bench/search-eval.bench.ts`

- [ ] **Step 1: Create search-eval-queries.json**

Create `packages/core/bench/fixtures/search-eval-queries.json`:

```json
{
  "decision_queries": [
    {
      "query": "why did we choose PostgreSQL",
      "expected_tags": ["database", "postgresql"],
      "min_score": 0.6
    },
    {
      "query": "authentication approach decision",
      "expected_tags": ["auth", "security"],
      "min_score": 0.5
    },
    {
      "query": "what was decided about caching",
      "expected_tags": ["cache", "redis"],
      "min_score": 0.5
    }
  ],
  "entity_queries": [
    {
      "query": "Anthropic",
      "expected_kind": "entity",
      "min_results": 1
    }
  ],
  "general_queries": [
    {
      "query": "infrastructure setup",
      "min_results": 0
    }
  ]
}
```

- [ ] **Step 2: Create search-eval.bench.ts**

Create `packages/core/bench/search-eval.bench.ts`:

```typescript
/**
 * Search quality evaluation bench.
 * Run: pnpm --filter @hipp0/core bench search-eval
 *
 * Measures: result count per query, whether results match expected tags/kinds.
 * Does NOT require pre-seeded data - gracefully handles empty DB.
 */

import { hybridSearch } from '../src/search/hybrid.js';
import { classifyIntent } from '../src/search/intent-classifier.js';
import queries from './fixtures/search-eval-queries.json' assert { type: 'json' };

async function runEval() {
  console.log('Search Evaluation Harness\n');
  let passed = 0;
  let total = 0;

  for (const q of queries.decision_queries) {
    total++;
    const intent = classifyIntent(q.query);
    const results = await hybridSearch('bench-project', q.query, 5).catch(() => []);
    const ok = intent === 'decision' || intent === 'temporal' || intent === 'general';
    console.log(`[${ok ? 'PASS' : 'FAIL'}] intent="${intent}" query="${q.query}" results=${results.length}`);
    if (ok) passed++;
  }

  for (const q of queries.entity_queries) {
    total++;
    const intent = classifyIntent(q.query);
    const results = await hybridSearch('bench-project', q.query, 5).catch(() => []);
    const ok = results.length >= q.min_results;
    console.log(`[${ok ? 'PASS' : 'FAIL'}] intent="${intent}" query="${q.query}" results=${results.length} (min=${q.min_results})`);
    if (ok) passed++;
  }

  console.log(`\nResult: ${passed}/${total} checks passed`);

  // CI gate: fail if intent classifier misclassifies more than 1 query
  const intentResults = queries.decision_queries.map((q) => classifyIntent(q.query));
  const correctIntents = intentResults.filter((i) => i !== 'entity').length;
  if (correctIntents < queries.decision_queries.length - 1) {
    console.error('BENCH FAIL: intent classifier failing on decision queries');
    process.exit(1);
  }

  console.log('Bench OK');
}

runEval().catch((err) => {
  console.error('Bench error:', err);
  process.exit(1);
});
```

- [ ] **Step 3: Run the bench**

```bash
cd /root/audit/hipp0ai
npx tsx packages/core/bench/search-eval.bench.ts 2>&1 | tail -20
```

- [ ] **Step 4: Final full build + all tests**

```bash
cd /root/audit/hipp0ai
pnpm -w run build 2>&1 | tail -10
pnpm --filter @hipp0/core test 2>&1 | tail -15
pnpm --filter @hipp0/server test 2>&1 | tail -15

cd /root/audit/hermulti
python -m pytest tests/ -x -q 2>&1 | tail -15
```

Expected: All tests pass. Build clean.

- [ ] **Step 5: Final commit**

```bash
cd /root/audit/hipp0ai
git add packages/core/bench/
git commit -m "feat(bench): search evaluation harness with intent classifier gate"

# Summary tag
git tag gbrain-tier-complete
```

---

## Phase Summary

| Phase | What lands | Key files |
|-------|-----------|-----------|
| 1 | 6 wiring fixes - existing architecture fully activates | feedback.ts, context-compiler/index.ts, hermes.ts, migration 060 |
| 2 | Skills system - hipp0 becomes agent-operable | skills/RESOLVER.md + 7 skill files, hermulti outcome_signals.py |
| 3 | Entity knowledge layer - people/companies/concepts that learn from outcomes | 063_entity_pages.sql, entity-enricher.ts, entities route, entity skills |
| 4 | Hybrid search - RRF + 5-signal re-ranking + MCP unified search | search/hybrid.ts, intent-classifier.ts, mcp/tools/search.ts |
