# Weekly Digest

The Weekly Digest is an automatically generated health report that summarizes what happened in your decision graph over the past 7 days. It surfaces trends, flags problems, and gives you a quick read on whether your agent team's memory is staying healthy.

View it in the dashboard at `#digest`, or receive it via webhook.

---

## What's in the Digest

Each weekly digest covers:

| Section | Description |
|---------|-------------|
| **New decisions** | Count and list of decisions created this week, broken down by source (manual, auto-distilled, imported) |
| **Decisions validated** | Decisions that were reviewed and confirmed as still accurate |
| **Contradictions resolved** | Contradictions that were addressed or dismissed |
| **Contradictions opened** | New conflicts detected this week |
| **Stale decision count** | Decisions now past their staleness threshold with no recent validation |
| **Evolution proposals** | New improvement proposals generated this week, by type |
| **Policy violations** | Violations triggered this week, by severity |
| **Top agents by activity** | Which agents recorded the most decisions and compiles |
| **Compile performance** | P95 compile latency for the week vs prior week |

---

## Severity Levels

Each digest item is tagged with a severity level:

| Severity | Meaning |
|----------|---------|
| `critical` | Requires immediate attention — e.g., spike in contradictions, auth decisions going stale |
| `high` | Should be addressed this week |
| `medium` | Worth reviewing but not urgent |
| `info` | Informational — positive signals or neutral activity |

---

## Generating a Digest

### Automatically

The digest runs as a background worker on a weekly schedule (default: Monday at 6am UTC). No configuration needed — it runs automatically once Hipp0 is deployed.

### Manually

Trigger a digest on demand:

```bash
POST /api/projects/:project_id/digest/generate
Authorization: Bearer <API_KEY>
```

Returns immediately. The digest is available via `GET` after a few seconds.

### Fetching the Latest Digest

```bash
GET /api/projects/:project_id/digest/latest
Authorization: Bearer <API_KEY>
```

```json
{
  "generated_at": "2026-04-07T06:00:00Z",
  "period_start": "2026-03-31T00:00:00Z",
  "period_end": "2026-04-07T00:00:00Z",
  "summary": {
    "new_decisions": 14,
    "validated": 6,
    "contradictions_resolved": 2,
    "contradictions_opened": 1,
    "stale_decisions": 7,
    "evolution_proposals": 4,
    "policy_violations": 0
  },
  "insights": [
    {
      "severity": "high",
      "message": "7 decisions are past their staleness threshold. Review the #timeline view and validate or supersede them."
    },
    {
      "severity": "info",
      "message": "14 new decisions recorded — highest weekly count in 4 weeks."
    }
  ]
}
```

---

## Digest via Webhook

To receive the digest as a webhook payload, create a webhook with the `digest_generated` event type:

```bash
POST /api/projects/:project_id/webhooks
{
  "url": "https://your-endpoint.com/hipp0-digest",
  "events": ["digest_generated"],
  "secret": "your-signing-secret"
}
```

The payload is the full digest JSON, signed with HMAC-SHA256. See [docs/webhooks.md](webhooks.md).

---

## Configuration

```bash
PATCH /api/projects/:project_id/settings
{
  "digest": {
    "enabled": true,
    "schedule": "monday",     // 'monday' | 'sunday' | 'daily'
    "time_utc": "06:00",
    "include_sections": [     // omit to include all
      "new_decisions",
      "contradictions",
      "stale_decisions",
      "evolution_proposals",
      "policy_violations"
    ]
  }
}
```

---

## Related Docs

- [Evolution Engine](evolution.md) — improvement proposals surfaced in the digest
- [Policies](policies.md) — violation tracking included in digest
- [Temporal Intelligence](temporal-intelligence.md) — how staleness is calculated
- [Webhooks](webhooks.md) — receiving the digest as a webhook
