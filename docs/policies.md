# Policies & Governance

Hipp0's policy engine lets you define rules that govern how decisions are created, modified, and used. Policies catch violations before they cause downstream problems — blocking invalid decisions, warning on risky patterns, and maintaining an audit trail of every infraction.

---

## What Policies Do

A policy is a rule that runs when a decision is created or updated. When triggered, a policy can:

- **Block** — prevent the decision from being saved
- **Warn** — allow the decision but flag it and notify governor agents

Violations are logged with the triggering decision, the violated policy, severity, and evidence. All violations are visible in the `#violations` dashboard view.

---

## Creating a Policy

```bash
POST /api/projects/:project_id/policies
Authorization: Bearer <API_KEY>
Content-Type: application/json

{
  "name": "Require reasoning for high-confidence decisions",
  "description": "Any decision marked high confidence must include a reasoning field.",
  "rule_type": "block",
  "condition": {
    "field": "confidence",
    "operator": "equals",
    "value": "high"
  },
  "requirement": {
    "field": "reasoning",
    "operator": "not_empty"
  },
  "severity": "high",
  "enabled": true
}
```

---

## Policy Fields

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Short label for the policy |
| `description` | string | What the policy enforces and why |
| `rule_type` | `'block' \| 'warn'` | What happens when the policy triggers |
| `condition` | object | When to apply the rule (optional — if omitted, applies to all decisions) |
| `requirement` | object | What must be true for the decision to pass |
| `severity` | `'critical' \| 'high' \| 'medium' \| 'low'` | Determines notification urgency |
| `enabled` | boolean | Toggle without deleting |

---

## Condition Operators

| Operator | Description |
|----------|-------------|
| `equals` | Field value matches exactly |
| `not_equals` | Field value does not match |
| `contains` | Field (array or string) contains the value |
| `not_empty` | Field is present and non-empty |
| `is_empty` | Field is missing or empty |

---

## Example Policies

### Require security review for auth decisions

```json
{
  "name": "Auth decisions require security tag",
  "rule_type": "block",
  "condition": {
    "field": "tags",
    "operator": "contains",
    "value": "auth"
  },
  "requirement": {
    "field": "tags",
    "operator": "contains",
    "value": "security-reviewed"
  },
  "severity": "high"
}
```

### Warn on decisions with no affected agents

```json
{
  "name": "Decisions should declare affected agents",
  "rule_type": "warn",
  "requirement": {
    "field": "affects",
    "operator": "not_empty"
  },
  "severity": "low"
}
```

### Block deprecated namespace decisions

```json
{
  "name": "Block new decisions in deprecated namespace",
  "rule_type": "block",
  "condition": {
    "field": "namespace",
    "operator": "equals",
    "value": "legacy-api"
  },
  "requirement": {
    "field": "status",
    "operator": "not_equals",
    "value": "active"
  },
  "severity": "medium"
}
```

---

## Listing Policies

```bash
GET /api/projects/:project_id/policies
```

Returns all policies with their current enabled state and violation counts.

---

## Enabling and Disabling

```bash
PATCH /api/projects/:project_id/policies/:policy_id
{ "enabled": false }
```

Disabling a policy stops it from running on new decisions. It does not retroactively clear existing violations.

---

## Violations

### Viewing violations

```bash
GET /api/projects/:project_id/violations
```

Each violation record includes:

| Field | Description |
|-------|-------------|
| `decision_id` | The decision that triggered the violation |
| `policy_id` | The policy that was violated |
| `severity` | critical / high / medium / low |
| `evidence` | What specifically triggered the rule |
| `resolved` | Whether the violation has been addressed |
| `resolved_at` | When it was resolved |
| `resolved_by` | Who resolved it |

### Resolving a violation

```bash
PATCH /api/projects/:project_id/violations/:violation_id
{ "resolved": true, "resolution_note": "Added security-reviewed tag after review." }
```

### Dashboard

The `#violations` view shows all open violations sorted by severity, with inline links to the triggering decision and tools to resolve directly.

---

## Notifications

When a policy violation occurs:
- **Block violations** — the API returns a 422 with the policy name and evidence. The decision is not saved.
- **Warn violations** — the decision is saved, a violation record is created, and governor-role agents receive a notification at the policy's configured severity level.

---

## Related Docs

- [Cascade Alerts](cascade-alerts.md) — how changes propagate to affected agents
- [Review Queue](review-queue.md) — decisions pending human approval
- [Agent Wings](agent-wings.md) — governor role and notification targeting
