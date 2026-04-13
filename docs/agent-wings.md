# Agent Wings

Wings are domain-based groupings for agents. Each agent belongs to a wing, and the system learns cross-wing affinity scores over time based on relevance feedback. Wing-aware compilation boosts decisions from an agent's own wing, improving retrieval relevance.

## Concepts

- **Wing**: A named context space for an agent. Defaults to the agent's `made_by` name when not explicitly set on a decision.
- **Cross-wing affinity**: A learned weight (0.0–1.0) representing how relevant one wing's decisions are to another wing's agents.
- **Affinity learning**: Driven by relevance feedback — positive ratings increase cross-wing weights, negative ratings decrease them.

## How Affinity Learning Works

Affinity weights are updated incrementally as agents rate compiled decisions:

| Feedback Rating | Score | Weight Change |
|----------------|-------|---------------|
| `critical` | ≥ 4 | +0.05 |
| `useful` | ≥ 4 | +0.05 |
| `irrelevant` | ≤ 2 | -0.03 |

Weights are clamped to `[0.0, 1.0]`.

On a successful task outcome, all contributing wings receive an additional `+0.02` boost via `processWingOutcome`.

### Rebalance

The rebalance endpoint performs a full recomputation from all historical `relevance_feedback` rows, replacing incremental weights:

```bash
curl -X POST "http://localhost:3100/api/agents/<AGENT_NAME>/wing/rebalance?project_id=<PROJECT_ID>" \
  -H "Authorization: Bearer <API_KEY>"
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/agents/:name/wing?project_id=` | Wing stats for a specific agent |
| `GET` | `/api/projects/:id/wings` | All wings in a project with cross-reference strength |
| `POST` | `/api/agents/:name/wing/rebalance?project_id=` | Recalculate affinity from all historical feedback |

### Wing Stats Response

```json
{
  "wing": "backend",
  "decision_count": 42,
  "top_domains": ["auth", "api", "database", "caching", "security"],
  "cross_wing_connections": [
    { "wing": "frontend", "strength": 0.65 },
    { "wing": "devops", "strength": 0.45 }
  ]
}
```

## Types

```typescript
interface WingAffinity {
  cross_wing_weights: Record<string, number>;  // wing_name → 0.0–1.0
  last_recalculated: string;                   // ISO-8601
  feedback_count: number;
}
```

The `Agent` type includes:
- `wing?: string | null` — the agent's wing label
- `wing_affinity?: WingAffinity` — learned cross-wing weights

## Wing-Aware Compilation

During context compilation, decisions from the requesting agent's own wing receive a configurable boost (`own_wing_boost`, default `0.20`). This means an agent's own domain decisions rank higher without excluding cross-wing context.

The `computeWingSources` function categorizes compiled decisions into `own_wing` vs. other wing names for metadata reporting.

## Dashboard

View wings at `#wings` in the dashboard. The visualization shows:
- SVG relationship graph of cross-wing connection strength
- Per-wing top domains
- Agent membership per wing
