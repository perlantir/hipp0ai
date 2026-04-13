# Temporal Intelligence

Hipp0's temporal intelligence system manages time-bounded decisions, staleness detection, confidence decay, and auto-supersession. Decisions aren't just relevant by content — they're relevant by when they were made and how long they remain valid.

## Temporal Scopes

Every decision has a `temporal_scope` that defines its expected lifetime:

| Scope | Description |
|-------|-------------|
| `permanent` | Long-lived decisions (architecture choices, policies) |
| `sprint` | Valid for a sprint or iteration |
| `experiment` | Temporary experiments that may be reverted |
| `deprecated` | Phased-out decisions kept for historical context |

Decisions can also have explicit time bounds:
- `valid_from` — ISO date when the decision takes effect
- `valid_until` — ISO date when the decision expires (null = no expiry)

## Freshness Scoring

Decision freshness decays exponentially over time:

| Decision State | Half-Life |
|---------------|-----------|
| Validated (has `validated_at`) | 30 days |
| Unvalidated | 7 days |

**Formula**: `f(t) = 2^(-t / half_life)`

A decision validated yesterday has freshness ~0.98. An unvalidated decision from 14 days ago has freshness ~0.25.

### Effective Confidence

Each decision has a `confidence_decay_rate` (per-day exponential rate). Effective confidence at time `t` is:

```
effective_confidence = nominal_confidence × e^(-decay_rate × age_days)
```

## Staleness Detection

`getTemporalFlags(decision)` returns human-readable warning strings:

| Condition | Flag |
|-----------|------|
| Unvalidated and > 14 days old | `"Unvalidated for 14+ days"` |
| `validated_at` is > 60 days ago | `"Stale — not validated in 60+ days"` |
| Status is `superseded` | `"Superseded"` |
| Effective confidence < 0.25 | `"Low effective confidence"` |

These flags are surfaced in the dashboard and compile responses.

## Score Blending

Compile requests can specify a `freshness_preference` to control how freshness influences ranking:

| Preference | Relevance Weight | Freshness Weight |
|------------|-----------------|-----------------|
| `recent_first` | 55% | 45% |
| `validated_first` | 85% | 15% |
| `balanced` (default) | 70% | 30% |

**Formula**: `blended = relevance × weight_r + freshness × weight_f`

## Auto-Supersede

When a new decision includes a `supersedes_id`, Hipp0 automatically:

1. Sets the old decision's `status = 'superseded'` and `superseded_by = <new_id>`
2. Fires `propagateChange` with event `decision_superseded` (notifies subscribed agents)
3. Dispatches webhooks with event `decision_superseded`
4. Runs `findCascadeImpact` to alert downstream dependents

## `what_changed` / Diff API

Use the compile diff endpoint to see what changed between two compilation snapshots:

```bash
curl -X POST http://localhost:3100/api/compile/diff \
  -H "Authorization: Bearer <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{ "compile_id_a": "uuid-1", "compile_id_b": "uuid-2" }'
```

Response:

```json
{
  "added_decisions": [{ "id": "...", "title": "...", "score_b": 0.85 }],
  "removed_decisions": [{ "id": "...", "title": "...", "score_a": 0.72 }],
  "reranked_decisions": [{ "id": "...", "title": "...", "rank_a": 3, "rank_b": 1, "score_a": 0.65, "score_b": 0.88 }],
  "unchanged_count": 12
}
```

## Validation

Mark a decision as validated to reset its freshness clock:

```bash
curl -X POST http://localhost:3100/api/decisions/<ID>/validate \
  -H "Authorization: Bearer <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{ "source": "quarterly-review" }'
```

This sets `validated_at = NOW()` and records the `validation_source`.

## Core Functions

| Function | Purpose |
|----------|---------|
| `computeFreshness(decision, now?)` | Exponential decay freshness score in [0,1] |
| `computeEffectiveConfidence(decision, now?)` | Nominal confidence x decay factor |
| `getTemporalFlags(decision, now?)` | Human-readable warning strings |
| `validateDecision(decisionId, source)` | Sets `validated_at = NOW()` |
| `blendScores(relevance, freshness, preference)` | Weighted blend by preference |
