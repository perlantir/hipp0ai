# Outcomes Tracking

Outcomes let you record the result of a task and link it back to the decisions that were compiled for that task. Over time, this creates a feedback loop: Hipp0 learns which decisions tend to lead to successful outcomes and which don't, improving future context compilation.

---

## How It Works

1. An agent compiles context before a task — the compile response includes a `compile_id`
2. The agent completes the task
3. The outcome is recorded with the `compile_id` and a result rating
4. Hipp0 links the outcome to the decisions that were included in that compile
5. The feedback drives long-term scoring adjustments for those decisions

---

## Recording an Outcome

```bash
POST /api/outcomes
Authorization: Bearer <API_KEY>
Content-Type: application/json

{
  "compile_id": "compile-uuid",
  "agent_name": "builder",
  "task": "implement JWT refresh token rotation",
  "result": "success",
  "notes": "Implemented without issues. The JWT decision was directly applicable.",
  "decision_ratings": [
    { "decision_id": "dec-uuid-1", "rating": "critical" },
    { "decision_id": "dec-uuid-2", "rating": "useful" },
    { "decision_id": "dec-uuid-3", "rating": "irrelevant" }
  ]
}
```

---

## Outcome Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `compile_id` | UUID | Yes | The compile that preceded this task |
| `agent_name` | string | Yes | Which agent completed the task |
| `task` | string | Yes | What the task was |
| `result` | string | Yes | `'success'`, `'partial'`, or `'failure'` |
| `notes` | string | No | Free-text notes on what happened |
| `decision_ratings` | array | No | Per-decision ratings from the compile |

---

## Decision Ratings

Rating individual decisions from a compile is optional but valuable. Each rating feeds directly into the wing affinity learning system.

| Rating | Effect |
|--------|--------|
| `critical` | Strongly boosts this decision's weight for this agent's role |
| `useful` | Modestly boosts this decision's weight |
| `irrelevant` | Reduces this decision's weight for this agent's role |

Over time, decisions that consistently rate `irrelevant` for a particular role get deprioritized in that agent's compiled context. Decisions that consistently rate `critical` rise to the top.

---

## SDK Usage

### TypeScript

```typescript
await hipp0.recordOutcome({
  compileId: context.compile_id,
  agentName: 'builder',
  task: 'implement JWT refresh token rotation',
  result: 'success',
  notes: 'Implemented without issues.',
  decisionRatings: [
    { decisionId: 'dec-uuid-1', rating: 'critical' },
    { decisionId: 'dec-uuid-2', rating: 'useful' },
  ],
});
```

### Python

```python
hipp0.record_outcome(
    compile_id=context.compile_id,
    agent_name="builder",
    task="implement JWT refresh token rotation",
    result="success",
    notes="Implemented without issues.",
    decision_ratings=[
        {"decision_id": "dec-uuid-1", "rating": "critical"},
        {"decision_id": "dec-uuid-2", "rating": "useful"},
    ],
)
```

---

## Viewing Outcomes

### Dashboard

`#outcomes` view shows all recorded outcomes with:
- Task description and result
- Agent that recorded it
- Linked decisions (expandable)
- Impact score — how much this outcome shifted scoring weights

### API

```bash
GET /api/projects/:project_id/outcomes?limit=50
```

```bash
GET /api/projects/:project_id/outcomes?agent=builder&result=failure
```

Filter by agent, result type, or date range.

---

## Impact Analysis

From the `#impact` view, selecting a decision shows not just its dependencies but its outcome history — how many tasks that used this decision succeeded vs failed. This gives you a ground-truth signal beyond feedback ratings.

---

## Related Docs

- [Agent Wings](agent-wings.md) — how ratings drive affinity weight learning
- [Relevance Feedback](agent-wings.md#feedback-loop) — per-compile feedback
- [Weekly Digest](weekly-digest.md) — outcome trends included in the digest
