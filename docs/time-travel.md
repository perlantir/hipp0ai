# Time Travel

Time Travel lets you view historical graph state — what any agent's compiled context looked like at any point in the past — and compare it with the current state or any other historical snapshot.

## How It Works

Every context compilation is automatically saved as a **compile snapshot** in the `compile_history` table. Each snapshot records:

- `agent_id` / `agent_name` — which agent compiled
- `task_description` — what task prompted the compile
- `compiled_at` — timestamp of the compilation
- `total_decisions` — how many decisions were included
- `token_budget_used` — tokens consumed
- `context_hash` — hash for deduplication
- `decision_ids` — JSON array of included decision IDs
- `decision_scores` — JSON array of `{ id, title, combined_score }`

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/compile-history/:compileId` | Fetch a single historical compilation snapshot |
| `GET` | `/api/agents/:id/compile-history?limit=50` | List compilation history for an agent (max 200) |
| `POST` | `/api/compile/diff` | Diff two compilation snapshots |
| `POST` | `/api/compile/at` | Reconstruct context at a past timestamp |

## Viewing Historical State

### List Agent Compile History

```bash
curl "http://localhost:3100/api/agents/<AGENT_ID>/compile-history?limit=20" \
  -H "Authorization: Bearer <API_KEY>"
```

Returns a list of compile snapshots ordered by `compiled_at` descending.

### Reconstruct Context at a Past Date

```bash
curl -X POST http://localhost:3100/api/compile/at \
  -H "Authorization: Bearer <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "agent_name": "backend-agent",
    "project_id": "<PROJECT_ID>",
    "task_description": "implement auth",
    "as_of": "2026-03-01T00:00:00Z"
  }'
```

This endpoint:
1. Fetches decisions created on or before `as_of` that were either `active` or only superseded after `as_of`.
2. Looks up `weight_snapshots` to find the agent's scoring weights closest to but not after `as_of`.
3. Returns the reconstructed decision list and the historical weights, with `weights_source: 'snapshot' | 'current'`.

## Comparing Snapshots

### Diff Two Compilations

```bash
curl -X POST http://localhost:3100/api/compile/diff \
  -H "Authorization: Bearer <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "compile_id_a": "older-compile-uuid",
    "compile_id_b": "newer-compile-uuid"
  }'
```

Response:

```json
{
  "added_decisions": [
    { "id": "...", "title": "Use Redis caching", "score_b": 0.85 }
  ],
  "removed_decisions": [
    { "id": "...", "title": "Use in-memory cache", "score_a": 0.72 }
  ],
  "reranked_decisions": [
    {
      "id": "...",
      "title": "JWT auth strategy",
      "rank_a": 3,
      "rank_b": 1,
      "score_a": 0.65,
      "score_b": 0.88
    }
  ],
  "unchanged_count": 12
}
```

### Diff Categories

| Category | Meaning |
|----------|---------|
| `added_decisions` | Present in snapshot B but not in A |
| `removed_decisions` | Present in snapshot A but not in B |
| `reranked_decisions` | Present in both but at different ranks |
| `unchanged_count` | Decisions in both snapshots at the same rank |

## Dashboard

Access Time Travel at `#timetravel` in the dashboard. Features include:

- Browse compile history for any agent
- Diff two historical compile snapshots to see added/removed/re-ranked decisions
- Reconstruct what an agent's context looked like at any past date
- Visual comparison with score bars and rank change indicators
