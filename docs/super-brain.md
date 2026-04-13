# Super Brain

The Super Brain is Hipp0's multi-step intelligence layer. It wraps the core context compiler in a session-aware pipeline that accumulates reasoning across agent steps, routes tasks to the right agents, and produces a holistic view of team-level decision state.

It's what separates Hipp0 from a simple memory store: the graph doesn't just answer individual queries, it tracks what's happening across a full agent session and gets smarter as work progresses.

---

## Four Phases

### Phase 1: Session Memory

**What it does:** Tracks multi-step reasoning within a task session. Each step an agent takes is recorded — what it did, what it learned, what it plans next. Step 5 has full visibility into everything from steps 1–4.

**Why it matters:** Without session memory, every agent call starts cold. With it, context accumulates. A reviewer in step 4 knows what the architect decided in step 1 without being told explicitly.

**How it works:**
1. Agent calls `POST /api/tasks/sessions` to start a session
2. Each agent step calls `POST /api/tasks/sessions/:id/steps` to record progress
3. On the next compile within the same session, prior step outputs are prepended to the context package
4. If a context window fills up, agents can call `hipp0_save_before_trim` to checkpoint critical reasoning — see [docs/context-survival.md](context-survival.md)

---

### Phase 2: Role-Differentiated Compilation

**What it does:** Different agents get different context for the same query. Same task, different results — automatically shaped by each agent's role.

**Why it matters:** A security agent asking about an auth system should see security decisions ranked high. A frontend agent asking the same question should see UI decisions first. Naive RAG returns the same results for both.

**How it works:**
Each agent has a persona profile with per-signal scoring weights. The `personaMatch` signal boosts decisions that align with the requesting agent's role domain. Wing affinity further adjusts weights based on which agent group produced the decision and how useful past compilations have been.

The result: 100% agent differentiation in benchmarks vs 0% for naive RAG (see [docs/benchmarks.md](benchmarks.md)).

---

### Phase 3: Orchestrator Mode

**What it does:** Produces a team-level view when an orchestrator asks "what should the team do next?" Returns a holistic synthesis: which agents are relevant, which decisions conflict, what the recommended action sequence is.

**Why it matters:** Orchestrators need to route tasks. Without this, they'd have to manually track who has context on what. Orchestrator mode does that reasoning automatically.

**How to use it:**

```bash
POST /api/compile
{
  "agent_name": "pm",
  "task_description": "plan the next sprint",
  "project_id": "<PROJECT_ID>",
  "orchestrator_mode": true
}
```

**Response includes:**
- `recommended_action` — what the team should do next
- `action_reason` — why
- `team_scores` — each agent's relevance score for the current task
- `suggested_next_agent` — who should act first
- `conflicts` — any contradictions in the current decision graph

**Agent Decision Protocol actions:**

| Action | Meaning |
|--------|---------|
| `PROCEED` | Strong fit — start immediately using compiled context |
| `PROCEED_WITH_NOTE` | Can contribute, but flag another agent for review |
| `SKIP` | Not the right agent for this task |
| `OVERRIDE_TO` | Hand off to a different agent |
| `ASK_FOR_CLARIFICATION` | Information is missing — return what's needed |

---

### Phase 4: Playground

**What it does:** Interactive dashboard environment for exploring how the Super Brain works. Pick an agent, type a task, see exactly which decisions are returned and why — including a full scoring breakdown per decision.

See [docs/playground.md](playground.md) for a full guide.

---

## MCP Tools

Two dedicated MCP tools handle orchestrator flow:

### `hipp0_follow_orchestrator`

Call this when your agent agrees with the Brain's suggested next agent. It records the acceptance and returns pre-compiled context for the next agent — reducing latency on the handoff.

```
hipp0_follow_orchestrator
  session_id: string     — The active task session ID
  agent_name: string     — Your agent name (the one accepting the suggestion)
```

### `hipp0_override_orchestrator`

Call this when your agent disagrees with the Brain's suggestion. Records the override with a reason — Hipp0 learns from these disagreements and adjusts future suggestions.

```
hipp0_override_orchestrator
  session_id: string        — The active task session ID
  agent_name: string        — Your agent name
  preferred_agent: string   — Who you think should go next
  reason: string            — Why you're overriding
```

---

## Session Lifecycle

```
Start session
POST /api/tasks/sessions
→ returns session_id

Agent A works
POST /api/tasks/sessions/:id/steps
{ agent_name: "architect", output: "...", status: "complete" }

Agent B picks up
POST /api/compile
{ agent_name: "builder", task_description: "...", task_session_id: session_id }
→ context includes Agent A's step output automatically

Session ends
PATCH /api/tasks/sessions/:id
{ status: "complete" }
```

---

## When to Use Orchestrator Mode vs Standard Compile

| Scenario | Use |
|----------|-----|
| Single agent working on a defined task | Standard `POST /api/compile` |
| Agent needs to know what the team has decided | Standard compile with session memory |
| Orchestrator routing tasks across multiple agents | Orchestrator mode |
| Debugging why an agent got certain context | Playground |

---

## Related Docs

- [Agent Decision Protocol](agent-protocol.md) — full action table and response handling
- [Context Survival & Checkpoints](context-survival.md) — preserve reasoning across context window trims
- [Playground](playground.md) — interactive exploration of scoring
- [Agent Wings](agent-wings.md) — how agent groupings affect scoring
