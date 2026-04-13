# Evolution Engine

The Evolution Engine surfaces improvement proposals for decisions that aren't performing well. Instead of waiting for agents to manually flag stale or low-signal decisions, the engine proactively analyzes the decision graph and generates concrete suggestions for what to update, merge, or retire.

---

## What It Evaluates

The Evolution Engine looks for decisions that match any of these patterns:

- **Low feedback scores** — consistently rated `irrelevant` by agents who receive it in compiled context
- **Stale without validation** — decisions that have gone past their staleness threshold with no updates or validation
- **Superseded but not cleaned up** — decisions marked superseded that still have active dependencies pointing at them
- **High contradiction count** — decisions involved in multiple unresolved contradictions
- **Low confidence, high impact** — `confidence: low` decisions that appear in many compile responses
- **Orphaned decisions** — decisions with no tags, no affects, and low compile relevance over time

---

## How Proposals Are Generated

For each flagged decision, the engine generates a proposal. Proposals are a combination of:

**Rule-based analysis** — deterministic patterns (staleness dates, feedback counts, contradiction links) that don't require an LLM.

**LLM-assisted proposals** — when an LLM key is configured (`ANTHROPIC_API_KEY` or `OPENROUTER_API_KEY`), the engine sends flagged decisions to Claude with the surrounding graph context to generate natural-language improvement recommendations.

LLM assistance is optional. Rule-based proposals run without any API key.

---

## Proposal Types

| Type | Description |
|------|-------------|
| `update` | The decision content is outdated — proposal includes suggested new reasoning or description |
| `merge` | Two decisions are near-duplicates — proposal suggests combining them |
| `retire` | The decision is no longer relevant — proposal suggests archiving it |
| `validate` | The decision needs review — proposal asks a specific agent to confirm it's still accurate |
| `split` | The decision covers too much scope — proposal suggests breaking it into two focused decisions |
| `retag` | The tags don't reflect current usage — proposal suggests updated tags based on how the decision is being used |

---

## Accessing Proposals

### Dashboard

Open the `#evolution` view. Proposals are listed by priority with:
- The affected decision
- Proposal type and description
- Why the engine flagged it (evidence)
- Action buttons: Apply, Dismiss, or Defer

### API

```bash
GET /api/projects/:project_id/evolution
```

Returns all active proposals sorted by priority.

```json
[
  {
    "id": "prop-uuid",
    "decision_id": "dec-uuid",
    "decision_title": "Use JWT for API auth",
    "proposal_type": "validate",
    "description": "This decision hasn't been validated in 47 days. The auth strategy may have changed.",
    "evidence": {
      "days_since_validation": 47,
      "feedback_ratings": { "irrelevant": 3, "useful": 1 }
    },
    "priority": "high",
    "created_at": "2026-04-09T00:00:00Z"
  }
]
```

---

## Acting on Proposals

### Apply

Applying a proposal updates the decision directly with the suggested changes. For LLM-generated proposals, the suggested content is pre-filled — you can edit before applying.

```bash
POST /api/evolution/:proposal_id/apply
{ "confirmed": true }
```

### Dismiss

Dismiss a proposal if it's not relevant. Dismissed proposals don't reappear for 30 days.

```bash
POST /api/evolution/:proposal_id/dismiss
{ "reason": "Decision was recently reviewed and is still accurate." }
```

### Defer

Mark a proposal for later review without dismissing it.

```bash
POST /api/evolution/:proposal_id/defer
{ "until": "2026-05-01" }
```

---

## Triggering Evolution Analysis

The evolution engine runs automatically as a background worker on a configurable schedule. Default: daily.

To run it manually:

```bash
POST /api/projects/:project_id/evolution/run
```

This queues a fresh analysis pass and returns immediately. Check `GET /api/projects/:project_id/evolution` for results after a few seconds.

---

## Configuration

```bash
PATCH /api/projects/:project_id/settings
{
  "evolution": {
    "enabled": true,
    "run_schedule": "daily",         // 'daily' | 'weekly' | 'manual'
    "llm_proposals": true,           // Use LLM for richer proposals (requires API key)
    "min_days_stale": 30,            // Flag decisions older than this
    "min_irrelevant_count": 3        // Flag after this many 'irrelevant' ratings
  }
}
```

---

## Related Docs

- [Temporal Intelligence](temporal-intelligence.md) — staleness detection and freshness scoring
- [Relevance Feedback](agent-wings.md) — how ratings drive affinity weights
- [Review Queue](review-queue.md) — human approval flow for pending decisions
