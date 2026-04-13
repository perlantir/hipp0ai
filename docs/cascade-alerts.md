# Cascade Alerts

When a decision is superseded, reverted, or modified, Hipp0 traces the dependency graph to identify all downstream impacts and notifies affected agents. This ensures that changes don't silently break dependent decisions.

## How Upstream Changes Propagate

### 1. Dependency Graph Traversal

When a decision changes, `findCascadeImpact` performs a breadth-first search through the `decision_edges` table, following `requires` relationship edges up to **5 levels deep**.

Each impacted decision is classified as:
- **Direct** (depth = 1) — immediately depends on the changed decision
- **Transitive** (depth > 1) — depends on a decision that depends on the changed decision

### 2. Notification Creation

For each cascade impact, `notifyCascade` creates notifications:

| Depth | Urgency | Recipients |
|-------|---------|------------|
| 1 (direct) | `high` | All agents listed in `affected_agents` for the impacted decision |
| > 1 (transitive) | `medium` | All agents listed in `affected_agents` for the impacted decision |
| Any | `critical` | All agents with `role = 'governor'` in the project (full chain summary) |

### 3. Subscription-Based Propagation

In parallel, the Change Propagator handles subscription-based notifications:

Agents can subscribe to topics:
- `tag:<name>` — notify when any decision with this tag changes
- `tag:*` — notify on any tag change
- `decision:<uuid>` — notify when a specific decision changes

Subscription events: `update`, `supersede`, `revert`, `contradict`

High-priority subscriptions can upgrade the urgency of notifications.

### 4. Cache Invalidation

After creating notifications, the system invalidates cached context compilation entries that contained the changed decision, ensuring subsequent compiles reflect the updated graph.

## Urgency Levels by Event

| Urgency | Events |
|---------|--------|
| `critical` / `high` | `decision_superseded`, `decision_reverted`, `contradiction_detected`, `blocked` |
| `medium` | `assumption_invalidated`, `dependency_changed` |
| `low` | `decision_created`, `decision_updated`, `artifact_updated`, `unblocked` |

## Cascade Impact Type

```typescript
interface CascadeImpact {
  decision_id: string;
  decision_title: string;
  depth: number;           // 1 = direct, >1 = transitive
  path: string[];          // chain of decision titles from source to impact
  impact: 'direct' | 'transitive';
  affected_agents: string[];
}

interface CascadeResult {
  changed_decision_id: string;
  changed_decision_title: string;
  impacts: CascadeImpact[];
  total_affected: number;
}
```

## Notification Flow

```
Decision Changed (supersede/revert)
    │
    ├─→ findCascadeImpact (BFS, max depth 5)
    │       │
    │       └─→ notifyCascade
    │               ├─→ Notifications for affected agents (high/medium urgency)
    │               └─→ Notifications for governor agents (critical urgency)
    │
    ├─→ propagateChange (subscription-based)
    │       ├─→ Match subscriptions (tag:*, tag:<name>, decision:<uuid>)
    │       ├─→ Create subscriber notifications
    │       └─→ Invalidate context cache
    │
    └─→ dispatchWebhooks (decision_superseded / decision_reverted)
```

## Dashboard

View cascade alerts and notifications at `#notifications` in the dashboard. The notification feed shows:
- Urgency badges (critical, high, medium, low)
- Source decision and impact chain
- Mark-as-read actions
- Navigation shortcuts to affected decisions

The `#impact` (Impact Analysis) view lets you preview cascade impacts before making changes — see which agents and decisions would be affected if a decision is modified.
