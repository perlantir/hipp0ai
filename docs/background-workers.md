# Background Workers

Hipp0 runs several background workers that maintain the health and intelligence of your decision graph automatically. These run on a schedule without any manual intervention once Hipp0 is deployed.

---

## Workers Overview

| Worker | Schedule | What It Does |
|--------|----------|--------------|
| Staleness Cron | Daily | Flags decisions that have passed their freshness threshold |
| Weekly Digest | Weekly (configurable) | Generates the project health digest |
| Evolution Worker | Daily (configurable) | Analyzes the graph for improvement opportunities |
| Pattern Extraction | Weekly | Extracts cross-project patterns from anonymized decision data |
| Embedding Backfill | On demand | Generates embeddings for decisions that don't have them yet |

---

## Staleness Cron

**Schedule:** Daily at 2am UTC (configurable)

Scans all active decisions and applies freshness scoring based on:
- Time since creation or last validation (`confidence_decay_rate` per decision)
- Whether the decision has been validated since creation
- The decision's temporal scope (`permanent`, `sprint`, `experiment`, `deprecated`)

Decisions that cross the staleness threshold are:
1. Flagged with `staleness_status: 'stale'`
2. Excluded from the top positions in compile results (temporal signal score drops)
3. Added to the Evolution Engine's candidates list
4. Included in the next weekly digest

**Configuring decay rates:**

Each decision has an individual `confidence_decay_rate` field (per-day). Defaults:

| Temporal Scope | Default Half-Life |
|----------------|-------------------|
| `permanent` | No decay |
| `sprint` | 14 days |
| `experiment` | 7 days |
| `deprecated` | Immediately stale |

Override per decision:

```bash
PATCH /api/decisions/:id
{ "confidence_decay_rate": 0.02 }  # ~50 day half-life
```

**Validating a decision to reset its staleness:**

```bash
POST /api/decisions/:id/validate
Authorization: Bearer <API_KEY>
{ "validated_by": "architect", "note": "Still accurate as of Q2 review." }
```

---

## Weekly Digest Worker

**Schedule:** Monday at 6am UTC (configurable)

Generates the project health digest. See [docs/weekly-digest.md](weekly-digest.md) for what's included and how to configure the schedule.

---

## Evolution Worker

**Schedule:** Daily at 3am UTC (configurable)

Analyzes the decision graph for improvement opportunities. Generates proposals for decisions that are stale, low-signal, contradicted, or orphaned. See [docs/evolution.md](evolution.md) for proposal types and how to act on them.

LLM-assisted proposals require `ANTHROPIC_API_KEY` or `OPENROUTER_API_KEY`. Rule-based proposals run without any LLM key.

---

## Pattern Extraction Worker

**Schedule:** Weekly (Sunday at 4am UTC)

Analyzes decisions across all projects (anonymized) to identify recurring patterns — approaches that multiple projects have independently converged on. Extracted patterns surface as `suggested_patterns` in compile responses.

Patterns are stored in the `anonymous_patterns` table. Only structural patterns are extracted (decision types, tag combinations, confidence levels) — no decision content, titles, or descriptions leave your project.

**Disabling cross-project patterns:**

```bash
PATCH /api/projects/:project_id/settings
{
  "metadata": {
    "pattern_recommendations": false
  }
}
```

See [docs/pattern-recommendations.md](pattern-recommendations.md).

---

## Monitoring Worker Health

### Dashboard

The `#stats` health view shows:
- Last run time for each worker
- Whether the last run succeeded or errored
- How many decisions were processed in the last run

### API

```bash
GET /api/projects/:project_id/workers/status
```

```json
{
  "staleness_cron": {
    "last_run": "2026-04-09T02:00:00Z",
    "status": "success",
    "decisions_processed": 142,
    "decisions_flagged": 7
  },
  "digest_worker": {
    "last_run": "2026-04-07T06:00:00Z",
    "status": "success"
  },
  "evolution_worker": {
    "last_run": "2026-04-09T03:00:00Z",
    "status": "success",
    "proposals_generated": 4
  },
  "pattern_extraction": {
    "last_run": "2026-04-06T04:00:00Z",
    "status": "success",
    "patterns_updated": 12
  }
}
```

### Logs

```bash
docker compose logs server | grep "\[worker\]"
```

Each worker logs its start, completion, and any errors with the `[worker]` prefix.

---

## Manual Triggers

Run any worker on demand:

```bash
POST /api/projects/:project_id/workers/staleness/run
POST /api/projects/:project_id/workers/evolution/run
POST /api/projects/:project_id/workers/digest/run
POST /api/projects/:project_id/workers/patterns/run
```

All return immediately — the worker runs asynchronously.

---

## Configuration

```bash
# .env
WORKER_STALENESS_SCHEDULE="0 2 * * *"     # Daily at 2am UTC (cron format)
WORKER_DIGEST_SCHEDULE="0 6 * * 1"        # Monday at 6am UTC
WORKER_EVOLUTION_SCHEDULE="0 3 * * *"     # Daily at 3am UTC
WORKER_PATTERNS_SCHEDULE="0 4 * * 0"      # Sunday at 4am UTC
WORKERS_ENABLED=true                       # Set false to disable all workers
```

---

## Related Docs

- [Temporal Intelligence](temporal-intelligence.md) — staleness thresholds and freshness scoring
- [Evolution Engine](evolution.md) — improvement proposals
- [Weekly Digest](weekly-digest.md) — health report generation
- [Pattern Recommendations](pattern-recommendations.md) — cross-project pattern surfacing
