# API Reference

The Hipp0 REST API is built with [Hono](https://hono.dev) and runs on port 3100 by default.

**Base URL:** `http://localhost:3100`

---

## Authentication

All endpoints accept an optional Bearer token. Set `HIPP0_API_KEY` in `.env` and pass it with requests:

```
Authorization: Bearer <your-api-key>
```

When `HIPP0_API_KEY` is unset, authentication is disabled (development mode). In production, always set a secret and pass it with all requests.

---

## Error Envelope

All error responses use a consistent JSON envelope:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Decision not found: abc-123",
    "details": null
  }
}
```

### Error codes

| HTTP Status | Code | Description |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Missing or invalid request fields |
| 401 | `UNAUTHORIZED` | Missing or invalid bearer token |
| 404 | `NOT_FOUND` | Requested resource does not exist |
| 409 | `CONFLICT` | Duplicate resource (e.g. agent name already used in project) |
| 422 | `UNPROCESSABLE_ENTITY` | Request is valid but cannot be processed |
| 429 | `RATE_LIMITED` | Too many requests |
| 500 | `INTERNAL_ERROR` | Unexpected server error |

---

## Health

### GET /api/health

Returns server health status. No authentication required.

**Response 200**
```json
{
  "status": "ok",
  "version": "0.1.0",
  "timestamp": "2026-04-03T04:00:00.000Z"
}
```

```bash
curl http://localhost:3100/api/health
```

---

## Projects

### POST /api/projects

Create a new project.

**Request body**
```json
{
  "name": "my-project",
  "description": "Optional description",
  "metadata": {}
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | ✓ | Project name |
| `description` | string | — | Free-text description |
| `metadata` | object | — | Arbitrary JSON metadata |

**Response 201**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "my-project",
  "description": "Optional description",
  "created_at": "2026-04-03T04:00:00.000Z",
  "updated_at": "2026-04-03T04:00:00.000Z",
  "metadata": {}
}
```

```bash
curl -X POST http://localhost:3100/api/projects \
  -H "Content-Type: application/json" \
  -d '{"name": "my-project"}'
```

---

### GET /api/projects/:id

Fetch a project by ID.

**Response 200** — Project object (same shape as POST response)

```bash
curl http://localhost:3100/api/projects/550e8400-e29b-41d4-a716-446655440000
```

---

### GET /api/projects/:id/stats

Returns decision counts, agent counts, and recent audit activity.

**Response 200**
```json
{
  "total_decisions": 42,
  "active_decisions": 38,
  "superseded_decisions": 3,
  "pending_decisions": 1,
  "total_agents": 5,
  "total_artifacts": 12,
  "total_sessions": 18,
  "unresolved_contradictions": 2,
  "total_edges": 61,
  "recent_activity": [
    {
      "id": "uuid",
      "event_type": "decision_created",
      "agent_id": "uuid",
      "project_id": "uuid",
      "decision_id": "uuid",
      "details": {},
      "created_at": "2026-04-03T04:00:00.000Z"
    }
  ]
}
```

```bash
curl http://localhost:3100/api/projects/$PROJECT_ID/stats
```

---

### GET /api/projects/:id/graph

Returns the full decision graph for a project (all nodes and edges).

**Response 200**
```json
{
  "nodes": [ /* Decision[] */ ],
  "edges": [ /* DecisionEdge[] */ ]
}
```

```bash
curl http://localhost:3100/api/projects/$PROJECT_ID/graph
```

---

## Agents

### POST /api/projects/:projectId/agents

Register an agent within a project.

**Request body**
```json
{
  "name": "alice",
  "role": "architect",
  "context_budget_tokens": 50000,
  "relevance_profile": {
    "weights": {
      "architecture": 1.0,
      "api": 0.9,
      "database": 0.8
    },
    "decision_depth": 3,
    "freshness_preference": "balanced",
    "include_superseded": true
  }
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | ✓ | Unique agent name within project |
| `role` | string | ✓ | Role key (`architect`, `builder`, etc.) or custom string |
| `context_budget_tokens` | integer | — | Token budget (default 50000) |
| `relevance_profile` | object | — | Override the role template's profile |

If `relevance_profile` is omitted, the built-in role template for `role` is used. If no template matches, the `builder` template is used as a fallback.

**Response 201** — Agent object

```json
{
  "id": "uuid",
  "project_id": "uuid",
  "name": "alice",
  "role": "architect",
  "relevance_profile": {
    "weights": {"architecture": 1.0, "api": 0.9, ...},
    "decision_depth": 3,
    "freshness_preference": "balanced",
    "include_superseded": true
  },
  "context_budget_tokens": 50000,
  "created_at": "...",
  "updated_at": "..."
}
```

```bash
curl -X POST http://localhost:3100/api/projects/$PROJECT_ID/agents \
  -H "Content-Type: application/json" \
  -d '{"name": "alice", "role": "architect"}'
```

---

### GET /api/projects/:projectId/agents

List all agents in a project.

**Response 200** — `Agent[]`

---

## Decisions

### POST /api/projects/:projectId/decisions

Record a new decision.

**Request body**
```json
{
  "title": "Use PostgreSQL as primary database",
  "description": "All persistent state lives in PostgreSQL 17.",
  "reasoning": "Team familiarity, strong JSON support, pgvector for embeddings.",
  "made_by": "alice",
  "source": "manual",
  "confidence": "high",
  "status": "active",
  "supersedes_id": null,
  "alternatives_considered": [
    {"option": "MongoDB", "rejected_reason": "No built-in vector search"}
  ],
  "affects": ["builder", "ops"],
  "tags": ["database", "architecture"],
  "assumptions": ["Cloud provider supports PostgreSQL 17"],
  "open_questions": ["What backup frequency is needed?"],
  "dependencies": [],
  "confidence_decay_rate": 0.0,
  "metadata": {}
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `title` | string | ✓ | Short decision title |
| `description` | string | ✓ | What was decided |
| `reasoning` | string | ✓ | Why this decision was made |
| `made_by` | string | ✓ | Agent or human name |
| `source` | enum | — | `manual` (default), `auto_distilled`, `imported` |
| `confidence` | enum | — | `high` (default), `medium`, `low` |
| `status` | enum | — | `active` (default), `superseded`, `reverted`, `pending` |
| `supersedes_id` | UUID | — | ID of decision this replaces |
| `alternatives_considered` | array | — | `[{option, rejected_reason}]` |
| `affects` | string[] | — | Component or agent names affected |
| `tags` | string[] | — | Domain taxonomy labels |
| `assumptions` | string[] | — | Assumed conditions |
| `open_questions` | string[] | — | Unresolved questions |
| `dependencies` | string[] | — | Decision IDs or external deps |
| `confidence_decay_rate` | float | — | Daily freshness decay multiplier (default 0.0) |
| `metadata` | object | — | Arbitrary JSON |

**Response 201** — Full `Decision` object including auto-generated `id`, `created_at`, `updated_at`, and `embedding`.

```bash
curl -X POST http://localhost:3100/api/projects/$PROJECT_ID/decisions \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Use PostgreSQL",
    "description": "PostgreSQL 17 is the primary database.",
    "reasoning": "Team expertise and pgvector support.",
    "made_by": "alice",
    "tags": ["database"],
    "affects": ["builder"]
  }'
```

---

### GET /api/projects/:projectId/decisions

List decisions with optional filters.

**Query parameters**

| Parameter | Type | Description |
|---|---|---|
| `status` | enum | Filter by `active`, `superseded`, `reverted`, or `pending` |
| `tags` | string | Comma-separated tag list (decisions must have at least one) |
| `made_by` | string | Filter by agent name |
| `limit` | integer | Max results (default 50) |
| `offset` | integer | Pagination offset (default 0) |

**Response 200** — `Decision[]`

```bash
curl "http://localhost:3100/api/projects/$PROJECT_ID/decisions?status=active&tags=database,architecture&limit=20"
```

---

### GET /api/decisions/:id

Fetch a single decision by ID.

**Response 200** — `Decision` object

```bash
curl http://localhost:3100/api/decisions/$DECISION_ID
```

---

### PATCH /api/decisions/:id

Update mutable fields of a decision. Partial updates are supported — only provided fields are changed. Embedding is regenerated automatically if `title`, `description`, `reasoning`, `tags`, or `affects` change.

**Request body** — any subset of decision fields

```json
{
  "confidence": "medium",
  "open_questions": ["Is the backup strategy defined?", "What is the max DB size?"],
  "tags": ["database", "architecture", "compliance"]
}
```

**Response 200** — Updated `Decision` object

```bash
curl -X PATCH http://localhost:3100/api/decisions/$DECISION_ID \
  -H "Content-Type: application/json" \
  -d '{"status": "pending", "open_questions": ["Waiting for compliance review"]}'
```

---

### POST /api/decisions/:id/supersede

Create a new decision that supersedes an existing one. This is a single atomic operation that:
1. Creates the new decision.
2. Marks the old decision as `superseded`.
3. Creates a `supersedes` edge from new → old.

**Request body** — same fields as `POST /api/projects/:id/decisions`

**Response 201**
```json
{
  "newDecision": { /* full Decision object */ },
  "oldDecision": { /* old Decision with status='superseded' */ }
}
```

```bash
curl -X POST http://localhost:3100/api/decisions/$OLD_DECISION_ID/supersede \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Use CockroachDB instead of PostgreSQL",
    "description": "Switching to CockroachDB for global distribution.",
    "reasoning": "Horizontal scaling requirements emerged from load testing.",
    "made_by": "alice",
    "tags": ["database", "architecture"],
    "affects": ["builder", "ops"]
  }'
```

---

### POST /api/projects/:projectId/decisions/search

Semantic search over decisions using vector similarity.

**Request body**
```json
{
  "query": "how do we handle authentication?",
  "limit": 10
}
```

**Response 200** — `Decision[]` ordered by semantic similarity

```bash
curl -X POST http://localhost:3100/api/projects/$PROJECT_ID/decisions/search \
  -H "Content-Type: application/json" \
  -d '{"query": "database connection pooling strategy", "limit": 5}'
```

---

### GET /api/decisions/:id/graph

Returns the decision subgraph rooted at the given decision.

**Query parameters**

| Parameter | Type | Description |
|---|---|---|
| `depth` | integer | Traversal depth (default 2, max 5) |

**Response 200**
```json
{
  "nodes": [ /* Decision[] */ ],
  "edges": [ /* DecisionEdge[] */ ]
}
```

```bash
curl "http://localhost:3100/api/decisions/$DECISION_ID/graph?depth=3"
```

---

### GET /api/decisions/:id/impact

Analyse the downstream impact of a decision.

**Response 200**
```json
{
  "decision": { /* Decision */ },
  "downstream_decisions": [ /* Decision[] */ ],
  "affected_agents": [ /* Agent[] */ ],
  "cached_contexts_invalidated": 3,
  "blocking_decisions": [ /* Decision[] */ ],
  "supersession_chain": [ /* Decision[] */ ]
}
```

```bash
curl http://localhost:3100/api/decisions/$DECISION_ID/impact
```

---

## Decision Edges

### POST /api/decisions/:decisionId/edges

Create an edge between two decisions.

**Request body**
```json
{
  "target_id": "uuid-of-target-decision",
  "relationship": "requires",
  "description": "Requires the database decision to be active",
  "strength": 1.0
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `target_id` | UUID | ✓ | Target decision ID |
| `relationship` | enum | ✓ | One of: `supersedes`, `requires`, `informs`, `blocks`, `contradicts`, `enables`, `depends_on`, `refines`, `reverts` |
| `description` | string | — | Human-readable edge description |
| `strength` | float | — | Edge strength 0..1 (default 1.0) |

**Response 201** — `DecisionEdge` object

```bash
curl -X POST http://localhost:3100/api/decisions/$DECISION_A/edges \
  -H "Content-Type: application/json" \
  -d '{
    "target_id": "'$DECISION_B'",
    "relationship": "requires",
    "strength": 0.9
  }'
```

---

### GET /api/decisions/:decisionId/edges

List all edges connected to a decision (as source or target).

**Response 200** — `DecisionEdge[]`

---

### DELETE /api/edges/:id

Delete an edge by ID.

**Response 200**
```json
{"deleted": true, "id": "edge-uuid"}
```

---

## Artifacts

### POST /api/projects/:projectId/artifacts

Record a new artifact.

**Request body**
```json
{
  "name": "auth-service.ts",
  "path": "src/services/auth-service.ts",
  "artifact_type": "code",
  "description": "JWT authentication service implementation",
  "content_summary": "Implements login, token refresh, and logout endpoints",
  "produced_by": "builder-agent",
  "related_decision_ids": ["uuid-1", "uuid-2"],
  "metadata": {}
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | ✓ | Artifact name |
| `artifact_type` | enum | ✓ | `spec`, `code`, `design`, `report`, `config`, `documentation`, `test`, `other` |
| `produced_by` | string | ✓ | Agent or human name |
| `path` | string | — | File system path |
| `description` | string | — | Human description |
| `content_summary` | string | — | Content summary for context compilation |
| `related_decision_ids` | UUID[] | — | Decisions this artifact implements |
| `metadata` | object | — | Arbitrary JSON |

**Response 201** — `Artifact` object

---

### GET /api/projects/:projectId/artifacts

List all artifacts in a project.

**Response 200** — `Artifact[]`

---

## Context Compiler

### POST /api/compile

Compile a ranked context package for an agent. Agents call this at the start of every task.

**Request body**
```json
{
  "agent_name": "alice",
  "project_id": "uuid",
  "task_description": "Implement the user authentication service",
  "max_tokens": 50000,
  "include_superseded": false,
  "session_lookback_days": 7
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `agent_name` | string | ✓ | Name of the requesting agent |
| `project_id` | UUID | ✓ | Project scope |
| `task_description` | string | ✓ | Natural-language task description (used for embedding) |
| `max_tokens` | integer | — | Token budget override (defaults to agent's `context_budget_tokens`) |
| `include_superseded` | boolean | — | Include superseded decisions (defaults to agent's profile setting) |
| `session_lookback_days` | integer | — | How many days of session history to include (default 7) |

**Response 200**
```json
{
  "agent": {"name": "alice", "role": "architect"},
  "task": "Implement the user authentication service",
  "compiled_at": "2026-04-03T04:00:00.000Z",
  "token_count": 12500,
  "budget_used_pct": 25,
  "decisions": [ /* ScoredDecision[] */ ],
  "artifacts": [ /* ScoredArtifact[] */ ],
  "notifications": [ /* Notification[] */ ],
  "recent_sessions": [ /* SessionSummary[] */ ],
  "formatted_markdown": "# Context for alice (architect)\n...",
  "formatted_json": "{...}",
  "decisions_considered": 42,
  "decisions_included": 8,
  "relevance_threshold_used": 0,
  "compilation_time_ms": 145
}
```

`ScoredDecision` extends `Decision` with:
```json
{
  "relevance_score": 0.72,
  "freshness_score": 0.95,
  "combined_score": 0.72,
  "scoring_breakdown": {
    "direct_affect": 0.40,
    "tag_matching": 0.15,
    "role_relevance": 0.075,
    "semantic_similarity": 0.095,
    "status_penalty": 1.0,
    "freshness": 0.95,
    "combined": 0.72
  }
}
```

```bash
curl -X POST http://localhost:3100/api/compile \
  -H "Content-Type: application/json" \
  -d '{
    "agent_name": "alice",
    "project_id": "'$PROJECT_ID'",
    "task_description": "Design the authentication system"
  }' | jq -r .formatted_markdown
```

---

## Distillery

### POST /api/projects/:projectId/distill

Extract decisions from a raw conversation transcript.

**Request body**
```json
{
  "conversation_text": "User: Use JWT for auth...\nAssistant: Agreed. HS256 for internal services...",
  "session_id": "optional-uuid",
  "agent_name": "alice"
}
```

**Response 200**
```json
{
  "decisions_extracted": 3,
  "contradictions_found": 0,
  "decisions": [ /* Decision[] */ ],
  "session_summary": null
}
```

```bash
curl -X POST http://localhost:3100/api/projects/$PROJECT_ID/distill \
  -H "Content-Type: application/json" \
  -d '{
    "conversation_text": "We decided to use Redis for session cache with 24h TTL.",
    "agent_name": "alice"
  }'
```

---

### POST /api/projects/:projectId/distill/session

Same as `/distill` but also creates a `SessionSummary` record linking all extracted decisions.

**Additional request fields**
```json
{
  "topic": "Authentication design session"
}
```

**Response 200** — same as `/distill` but `session_summary` is populated.

---

## Sessions

### POST /api/projects/:projectId/sessions

Create a session summary record.

**Request body**
```json
{
  "agent_name": "alice",
  "topic": "Authentication service design",
  "summary": "Designed the JWT auth service with Redis session cache.",
  "decision_ids": ["uuid-1", "uuid-2"],
  "artifact_ids": [],
  "assumptions": ["Redis will be available in production"],
  "open_questions": ["How should token revocation work?"],
  "lessons_learned": ["HS256 is sufficient for internal services"],
  "raw_conversation_hash": "sha256-hash-of-raw-text",
  "extraction_model": "claude-3-5-sonnet",
  "extraction_confidence": 0.92
}
```

**Response 201** — `SessionSummary` object

---

### GET /api/projects/:projectId/sessions

List session summaries for a project.

**Response 200** — `SessionSummary[]`

---

## Notifications

### GET /api/agents/:agentId/notifications

Get notifications for an agent.

**Query parameters**

| Parameter | Description |
|---|---|
| `unread` | `true` to return only unread notifications |

**Response 200** — `Notification[]`

```json
[
  {
    "id": "uuid",
    "agent_id": "uuid",
    "decision_id": "uuid",
    "notification_type": "decision_superseded",
    "message": "The database choice has been superseded. Your implementation may need updating.",
    "role_context": "Check if your implementation aligns with this change.",
    "urgency": "high",
    "read_at": null,
    "created_at": "2026-04-03T04:00:00.000Z"
  }
]
```

```bash
curl "http://localhost:3100/api/agents/$AGENT_ID/notifications?unread=true"
```

---

### PATCH /api/notifications/:id/read

Mark a notification as read.

**Response 200** — Updated `Notification` object

```bash
curl -X PATCH http://localhost:3100/api/notifications/$NOTIFICATION_ID/read
```

---

## Subscriptions

### POST /api/agents/:agentId/subscriptions

Subscribe an agent to a topic.

**Request body**
```json
{
  "topic": "authentication",
  "notify_on": ["update", "supersede", "revert", "contradict"],
  "priority": "high"
}
```

**Response 201** — `Subscription` object

---

### GET /api/agents/:agentId/subscriptions

List all subscriptions for an agent.

**Response 200** — `Subscription[]`

---

### DELETE /api/subscriptions/:id

Remove a subscription.

**Response 200**
```json
{"deleted": true, "id": "subscription-uuid"}
```

---

## Contradictions

### GET /api/projects/:projectId/contradictions

List detected contradictions.

**Query parameters**

| Parameter | Description |
|---|---|
| `status` | `unresolved`, `resolved`, or `dismissed` |

**Response 200**
```json
[
  {
    "id": "uuid",
    "project_id": "uuid",
    "decision_a_id": "uuid",
    "decision_b_id": "uuid",
    "similarity_score": 0.94,
    "conflict_description": "Both decisions describe the caching strategy but contradict each other on TTL.",
    "status": "unresolved",
    "resolved_by": null,
    "resolution": null,
    "detected_at": "2026-04-03T04:00:00.000Z",
    "resolved_at": null
  }
]
```

---

### PATCH /api/contradictions/:id

Resolve or dismiss a contradiction.

**Request body**
```json
{
  "status": "resolved",
  "resolved_by": "alice",
  "resolution": "Decision A was superseded by Decision B. No conflict remains."
}
```

**Response 200** — Updated `Contradiction` object

---

## Feedback

### POST /api/feedback

Record relevance feedback for a decision.

**Request body**
```json
{
  "agent_id": "uuid",
  "decision_id": "uuid",
  "compile_request_id": "optional-hash",
  "was_useful": true,
  "usage_signal": "referenced"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `agent_id` | UUID | ✓ | Agent providing feedback |
| `decision_id` | UUID | ✓ | Decision being rated |
| `was_useful` | boolean | ✓ | Was this decision helpful? |
| `usage_signal` | enum | — | `referenced`, `ignored`, `contradicted`, `built_upon` |
| `compile_request_id` | string | — | Task hash from the compile response |

**Response 201** — `RelevanceFeedback` object

```bash
curl -X POST http://localhost:3100/api/feedback \
  -H "Content-Type: application/json" \
  -d '{
    "agent_id": "'$AGENT_ID'",
    "decision_id": "'$DECISION_ID'",
    "was_useful": true,
    "usage_signal": "built_upon"
  }'
```

---

## Audit Log

### GET /api/projects/:projectId/audit

Retrieve audit log entries for a project.

**Query parameters**

| Parameter | Description |
|---|---|
| `event_type` | Filter by event type (e.g. `decision_created`, `context_compiled`) |
| `limit` | Max entries to return (default 50) |

**Response 200** — `AuditEntry[]`

```json
[
  {
    "id": "uuid",
    "event_type": "context_compiled",
    "agent_id": "uuid",
    "project_id": "uuid",
    "decision_id": null,
    "details": {
      "agent_name": "alice",
      "task_description": "Design auth system",
      "decisions_considered": 42,
      "decisions_included": 8,
      "token_count": 12500,
      "compilation_time_ms": 145
    },
    "created_at": "2026-04-03T04:00:00.000Z"
  }
]
```

---

## API Keys

### POST /api/projects/:projectId/api-keys

Create an API key scoped to a project.

**Request body**
```json
{
  "name": "ci-pipeline",
  "scopes": ["read", "write"]
}
```

**Response 201**
```json
{
  "id": "uuid",
  "key": "nx_live_...",
  "name": "ci-pipeline",
  "scopes": ["read", "write"],
  "created_at": "..."
}
```

> The full key is only returned once. Store it securely.

---

### DELETE /api/api-keys/:id

Revoke an API key.

**Response 200**
```json
{"revoked": true, "id": "key-uuid"}
```

---

## Per-Agent API Keys

Per-agent keys scope every request to a single agent inside a project. Raw keys are minted as `h0_agent_<32 hex>` and only the hash is stored after creation.

### POST /api/projects/:id/agents/:agentId/keys

Create a per-agent key. The raw key is returned **exactly once**.

**Request body**
```json
{
  "name": "production-ci-bot",
  "scopes": ["read", "write"]
}
```

**Response 201**
```json
{
  "id": "uuid",
  "key": "h0_agent_3f2a…",
  "name": "production-ci-bot",
  "agent_id": "uuid",
  "project_id": "uuid",
  "scopes": ["read", "write"],
  "warning": "Store this key securely. It will not be shown again."
}
```

---

### GET /api/projects/:id/agents/:agentId/keys

List per-agent keys (hash prefix, name, scopes, `last_used_at`, `created_at`).

**Response 200**
```json
{
  "keys": [
    { "id": "uuid", "name": "production-ci-bot", "prefix": "h0_agent_3f2a", "last_used_at": "2026-04-10T08:15:00Z" }
  ]
}
```

---

### DELETE /api/projects/:id/agents/:agentId/keys/:keyId

Revoke a per-agent key.

**Response 200**
```json
{"revoked": true, "id": "key-uuid"}
```

---

## Decision Feedback (Thumbs Up/Down)

High-signal feedback on whether a specific decision helped when it showed up in a compile. Feeds the relevance learner and, when negative, flags decisions for the review queue.

### POST /api/projects/:id/feedback

Record a rating for a specific decision.

**Request body**
```json
{
  "decision_id": "uuid",
  "agent_name": "alice",
  "rating": "positive",
  "usage_signal": "used",
  "comment": "Used this as the source of truth for the auth flow.",
  "compile_request_id": "optional-uuid",
  "rated_by": "human:alice@team.io"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `decision_id` | UUID | ✓ | Decision being rated |
| `agent_name` | string | ✓ | Who saw the decision in their compile |
| `rating` | enum | ✓ | `positive`, `negative`, or `neutral` |
| `usage_signal` | enum | — | `used`, `mentioned`, `ignored`, `misleading` |
| `comment` | string | — | Max 5000 chars |
| `compile_request_id` | UUID | — | Link feedback to a specific compile |
| `rated_by` | string | — | Free-text rater identifier |

**Response 201**
```json
{ "recorded": true }
```

---

### POST /api/projects/:id/decisions/:decisionId/feedback

Same payload as above with `decision_id` pulled from the URL — convenient for dashboards.

---

### GET /api/projects/:id/decisions/:decisionId/feedback

Aggregate summary for a decision.

**Response 200**
```json
{
  "decision_id": "uuid",
  "project_id": "uuid",
  "total": 14,
  "positive": 11,
  "negative": 2,
  "neutral": 1,
  "net_score": 9,
  "score_ratio": 0.846,
  "recent_comments": [
    { "rating": "positive", "comment": "Saved me 2 hours.", "rated_by": "alice", "created_at": "2026-04-10T08:15:00Z" }
  ]
}
```

---

### GET /api/projects/:id/feedback/top-rated

Top decisions by net positive feedback.

**Query params:** `agent_name` (optional), `limit` (default 20, max 200).

---

### GET /api/projects/:id/feedback/flagged

Decisions with negative feedback ≥ positive feedback — candidates for the review queue.

---

## Project Templates

Four pre-built templates seed agents, tags, and decisions for common project types: SaaS backend, ML pipeline, documentation site, mobile app.

### GET /api/templates

List every template.

**Response 200**
```json
{
  "templates": [
    { "id": "saas-backend", "name": "SaaS Backend", "description": "…", "tags": ["api","auth"], "agent_count": 5, "decision_count": 12 },
    { "id": "ml-pipeline",  "name": "ML Pipeline",  "description": "…", "tags": ["ml","data"],  "agent_count": 4, "decision_count": 10 }
  ]
}
```

---

### GET /api/templates/:id

Return a single template's full spec (all agents, decisions, metadata).

---

### POST /api/projects/:id/apply-template

Seed an empty project from a template.

**Request body**
```json
{ "template_id": "saas-backend" }
```

**Response 200**
```json
{
  "success": true,
  "template": { "id": "saas-backend", "name": "SaaS Backend" },
  "agents_created": 5,
  "decisions_created": 12
}
```

---

## Cost Tracking & Budgets

Every distillery LLM call is recorded in `llm_usage` with a computed USD cost. Projects can cap daily spend; when hit, further extractions are **skipped**, not failed.

### GET /api/projects/:id/cost/usage

Today's usage plus comparison buckets (yesterday / week / month) and a trend percentage.

**Response 200**
```json
{
  "today":     { "total_cost_usd": 1.23, "total_tokens": 45000, "call_count": 12 },
  "yesterday": { "total_cost_usd": 0.91, "total_tokens": 32000, "call_count": 9 },
  "week":      { "total_cost_usd": 6.44 },
  "month":     { "total_cost_usd": 23.10 },
  "trend_pct": 35.16
}
```

---

### GET /api/projects/:id/cost/history?days=30

Time-series, zero-filled, most recent first. `days` must be 1-365.

**Response 200**
```json
{
  "days": 30,
  "series": [
    { "date": "2026-04-10", "cost_usd": 1.23, "tokens": 45000, "call_count": 12 },
    { "date": "2026-04-09", "cost_usd": 0.91, "tokens": 32000, "call_count": 9 }
  ],
  "total_cost_usd": 23.10,
  "total_calls": 234
}
```

---

### GET /api/projects/:id/cost/budget

Current budget status.

**Response 200**
```json
{
  "cap_usd": 5.00,
  "spent_today_usd": 1.23,
  "remaining_usd": 3.77,
  "unlimited": false,
  "source": "project"
}
```

`remaining_usd` is `null` when there is no cap. `source` is `"project"` (set via this endpoint) or `"env"` (inherited from `HIPP0_DAILY_BUDGET_USD`).

---

### PUT /api/projects/:id/cost/budget

Set or clear the daily cap.

**Request body**
```json
{ "daily_usd": 10 }
```

- `{ "daily_usd": null }` or `{ "clear": true }` clears the cap and falls back to `HIPP0_DAILY_BUDGET_USD`.
- Optional `per_operation` sub-caps can be provided as `{ "per_operation": { "distill": 2.50 } }`.

**Response 200**
```json
{
  "budget": { "daily_usd": 10 },
  "status": {
    "cap_usd": 10,
    "spent_today_usd": 1.23,
    "remaining_usd": 8.77,
    "unlimited": false,
    "source": "project"
  }
}
```

---

## Connectors — Notion / Linear / Slack

Pulls content from an upstream SaaS into the distillery and imports extracted decisions. Tokens are provided per-request (body, `X-Connector-Token` header, or `Authorization: Bearer`) and never persisted.

### Notion

#### GET /api/projects/:id/connectors/notion/pages

List pages that the supplied token can see. Optional `?database_id=…` filters to a specific database.

**Response 200** — `{ "pages": [ { "id": "uuid", "title": "…", "url": "…" } ] }`

#### POST /api/projects/:id/connectors/notion/sync

Fetch pages, run the distillery, and write extracted decisions to the project.

**Request body**
```json
{
  "token": "secret_abc…",
  "database_id": "optional-uuid",
  "limit": 50
}
```

**Response 200** — `{ "status": "ok", "pages_scanned": 32, "decisions_found": 17, "decisions_imported": 14 }`

#### POST /api/projects/:id/connectors/notion/preview

Same inputs as `/sync` but never writes — returns the extracted decisions for review.

---

### Linear

#### GET /api/projects/:id/connectors/linear/issues

List issues. Optional `?team_id=…&state_type=backlog|started|completed|cancelled`.

#### POST /api/projects/:id/connectors/linear/sync

**Request body**
```json
{
  "token": "lin_api_…",
  "team_id": "optional-uuid",
  "state_type": "completed",
  "limit": 25
}
```

**Response 200** — `{ "status": "ok", "issues_scanned": 25, "decisions_found": 9, "decisions_imported": 8 }`

#### POST /api/projects/:id/connectors/linear/preview

Dry run.

---

### Slack

#### GET /api/projects/:id/connectors/slack/channels

List channels the bot/user token can see.

#### POST /api/projects/:id/connectors/slack/sync

**Request body**
```json
{
  "token": "xoxb-…",
  "channel_id": "C0123456789",
  "since": "2026-04-01T00:00:00Z",
  "limit": 500
}
```

`channel_id` is required. `since` defaults to 30 days ago.

**Response 200** — `{ "status": "ok", "messages_scanned": 480, "decisions_found": 12, "decisions_imported": 12 }`

#### POST /api/projects/:id/connectors/slack/preview

Dry run.

---

### Unified Preview

#### POST /api/projects/:id/connectors/:source/preview

`source` is `notion`, `linear`, or `slack`. Returns `{ source, preview: [...], stats: {...} }`.

---

## Insights Pipeline

Three-tier knowledge pipeline: raw traces → facts → distilled insights (procedures, policies, anti-patterns, domain rules).

### POST /api/projects/:id/insights/generate

Run the pipeline. Creates insights from the accumulated facts, filtered by confidence threshold.

**Response 200**
```json
{
  "insights_created": 4,
  "facts_processed": 87,
  "elapsed_ms": 2310
}
```

### GET /api/projects/:id/insights

List insights for a project.

**Query params:** `status` (`active`, `superseded`), `kind` (`procedure`, `policy`, `anti_pattern`, `domain_rule`), `limit`, `offset`.

### PATCH /api/projects/:id/insights/:insightId

Update status, confidence, or metadata of an insight.

---

## Reflection & Traces

Automated self-improvement cycles — dedup, contradiction detection, skill updates, evolution scans, insight generation.

### POST /api/projects/:id/reflect

Run a reflection cycle.

**Request body**
```json
{ "type": "hourly" }
```

Valid types: `hourly`, `daily`, `weekly`. Returns the list of sub-tasks run and their results.

### GET /api/projects/:id/reflections

List prior reflection runs.

### POST /api/projects/:id/traces

Record a raw trace event (tool_call, api_response, error, observation, artifact_created, code_change).

**Request body**
```json
{
  "kind": "tool_call",
  "actor": "builder-agent",
  "payload": { "tool": "git", "args": ["log", "--oneline"] },
  "tags": ["git"]
}
```

### GET /api/projects/:id/traces

List traces with optional `kind` filter.

### POST /api/projects/:id/traces/distill

Run `distillTraces` over accumulated traces to mine implicit decisions.

### GET /api/scheduler/status

Return the scheduler state (`enabled`, `next_run_at`, `active_projects`).

### POST /api/scheduler/trigger

Manually trigger a pass over all active projects. Admin-only.

---

## Knowledge Branches

Git-style forks of the decision graph.

### POST /api/projects/:id/branches

Create a new branch from the current graph state.

**Request body** — `{ "name": "experiment-cockroach", "base_branch": "main" }`

### GET /api/projects/:id/branches

List branches.

### GET /api/projects/:id/branches/:branchId/diff

Return the diff between a branch and its base (added, removed, modified decisions and edges).

### POST /api/projects/:id/branches/:branchId/merge

Merge a branch back into its base.

### DELETE /api/projects/:id/branches/:branchId

Delete a branch.

---

## Experiments (Decision A/B Testing)

### POST /api/projects/:id/experiments

Start a head-to-head experiment comparing two decisions.

**Request body**
```json
{
  "decision_a_id": "uuid",
  "decision_b_id": "uuid",
  "hypothesis": "B ships faster than A",
  "metric": "outcome_success_rate",
  "min_samples": 30
}
```

### GET /api/projects/:id/experiments

List experiments.

### GET /api/projects/:id/experiments/:experimentId

Return experiment state, observed metrics, and z-test statistical significance.

### POST /api/projects/:id/experiments/:experimentId/resolve

Declare a winner (`decision_a`, `decision_b`, or `inconclusive`).

---

## Team Procedures

Auto-extracted reusable team workflows from `compile_history`.

### GET /api/projects/:id/procedures

List extracted procedures.

### POST /api/projects/:id/procedures/extract

Re-run the extraction over recent compile history.

### GET /api/projects/:id/procedures/suggest?task=…

Suggest the best-matching procedure for a task description.

### POST /api/projects/:id/procedures/:procedureId/executions

Record that a procedure was executed (feeds into the success-rate signal).

---

## Memory Analytics

### GET /api/projects/:id/analytics/health

Team health metrics: decision velocity, contradiction rate, feedback health, outcome coverage.

### GET /api/projects/:id/analytics/trends?days=30

Trend over time for the headline metrics.

### GET /api/projects/:id/analytics/digest/latest

The most recent weekly digest.

### POST /api/projects/:id/analytics/digest/generate

Generate a new digest (on-demand, outside the schedule).

### GET /api/projects/:id/analytics/digests

List all prior digests.

### POST /api/projects/:id/digest/delivery

Configure delivery channels (email, Slack webhook, generic webhook).

**Request body**
```json
{
  "channel": "email",
  "target": "team@example.com",
  "frequency": "weekly"
}
```

### GET /api/projects/:id/digest/delivery

List delivery configs for the project.

### DELETE /api/projects/:id/digest/delivery/:configId

Remove a delivery config.

### POST /api/projects/:id/digest/send

Send the latest digest to all configured channels immediately.

---

## Simulation & What-If

### POST /api/simulation/preview

Preview the effect of a single proposed decision on the current graph.

### POST /api/simulation/historical

Run a proposed decision against the historical graph and measure outcome deltas.

### POST /api/simulation/apply

Commit a previewed simulation as real decisions.

### POST /api/simulation/predict-impact

Predict success rate, risk factors, and affected agents for a proposed decision based on similar past decisions.

**Request body**
```json
{
  "project_id": "uuid",
  "decision": {
    "title": "Move to Kafka",
    "tags": ["infrastructure","messaging"],
    "affects": ["builder","ops"]
  }
}
```

### POST /api/simulation/multi-change

Multi-decision what-if — evaluate a batch of proposed decisions together.

### POST /api/simulation/cascade

Propagate a decision through `decision_edges` up to 3 levels deep and return every downstream decision affected.

### POST /api/simulation/rollback

Given a decision ID, compute which downstream changes would need to be rolled back if the decision itself were reverted.

---

## Shared Patterns (Network Effects)

### GET /api/shared-patterns

List community patterns. Auth-free, read-only.

### GET /api/shared-patterns/community-stats

Aggregate counts (total patterns, projects contributing, patterns per domain).

### GET /api/projects/:id/suggested-patterns

Suggest community patterns relevant to the current project's tag distribution.

### POST /api/projects/:id/patterns/:patternId/adopt

Adopt a community pattern into the project's own memory.

### POST /api/projects/:id/patterns/share

Share a locally discovered pattern back to the community (anonymized).

---

## Collaboration — Comments, Approvals, Annotations

### Comments

#### GET /api/projects/:id/decisions/:decisionId/comments

List threaded comments on a decision.

#### POST /api/projects/:id/decisions/:decisionId/comments

**Request body** — `{ "body": "Looks great.", "author": "alice", "parent_id": "optional-uuid" }`

#### PATCH /api/projects/:id/decisions/:decisionId/comments/:commentId

Edit a comment (author-only).

#### DELETE /api/projects/:id/decisions/:decisionId/comments/:commentId

Delete a comment (soft delete, preserves thread).

#### GET /api/projects/:id/comments/recent

Recent comments across all decisions.

### Approvals

#### POST /api/projects/:id/decisions/:decisionId/approvals

Create an approval request.

**Request body**
```json
{
  "requested_by": "alice",
  "approvers": ["bob", "carol"],
  "reason": "Breaking auth flow change"
}
```

#### GET /api/projects/:id/decisions/:decisionId/approvals

List approvals for a decision.

#### POST /api/projects/:id/approvals/:approvalId/approve

Approve an approval request.

#### POST /api/projects/:id/approvals/:approvalId/reject

Reject an approval request.

#### GET /api/projects/:id/approvals/pending

All pending approvals across the project.

### Annotations

#### GET /api/projects/:id/decisions/:decisionId/annotations

List inline annotations on a decision.

#### POST /api/projects/:id/decisions/:decisionId/annotations

**Request body** — `{ "field": "reasoning", "start": 42, "end": 128, "note": "Check this.", "author": "alice" }`

#### PATCH /api/projects/:id/annotations/:annotationId

Update an annotation.

#### DELETE /api/projects/:id/annotations/:annotationId

Delete an annotation.

---

## Playground

Routes mounted when `HIPP0_PLAYGROUND_ENABLED=true`. Each session is an ephemeral sandboxed SQLite database with 50 pre-seeded decisions across 6 agents.

### POST /api/playground/sessions

Create a fresh session. Returns `{ session_id, expires_at, agents: [...] }`.

### GET /api/playground/sessions/:sessionId

Session metadata.

### GET /api/playground/scenarios

List the 5 canned scenarios (role differentiation, contradictions, team procedures, impact prediction, skill profiling).

### POST /api/playground/:sessionId/compile

Run a scoped compile against the playground session — same shape as `/api/compile`.

### POST /api/playground/:sessionId/compare

Run two compiles with different parameters and return them side-by-side.

### GET /api/playground/stats

Global aggregate stats across all active playground sessions.

---

## Compile — Query Parameters

On top of the body fields documented above, `/api/compile` accepts these query parameters:

| Param | Value | Description |
|---|---|---|
| `format` | `h0c` | Return the H0C 8-10x compressed format |
| `format` | `ultra` | Return the H0C Ultra 20-33x compressed format |
| `explain` | `true` | Attach contrastive "why A beat B" explanations (zero LLM cost) |
| `pretty` | `true` | Requires `explain=true`. Rewrites the deterministic explanations into plain-English prose using the LLM. The deterministic version is always preserved so both can be displayed. |
| `namespace` | `<name>` | Filter to a single namespace |
| `include_patterns` | `false` | Suppress community pattern recommendations |

---

## WebSocket — Real-Time Event Stream

### GET /ws/events

Upgrade to a WebSocket that streams memory events for a project.

**Query params**

| Param | Required | Description |
|---|---|---|
| `project_id` | ✓ | Project to subscribe to |
| `api_key` | ✓ | A valid API key with access to the project |

**Initial frame**
```json
{ "type": "connected", "project_id": "uuid", "timestamp": "2026-04-10T08:15:00Z" }
```

**Subsequent frames** — `MemoryEvent` objects:

```json
{
  "type": "decision_created",
  "project_id": "uuid",
  "decision_id": "uuid",
  "actor": "alice",
  "payload": { "title": "…", "tags": ["…"] },
  "timestamp": "2026-04-10T08:15:00Z"
}
```

Event types include: `decision_created`, `decision_updated`, `decision_superseded`, `decision_reverted`, `contradiction_detected`, `contradiction_resolved`, `outcome_recorded`, `context_compiled`, `comment_added`, `approval_requested`, `approval_approved`, `approval_rejected`, `experiment_resolved`, `reflection_completed`.

The `@hipp0/sdk` package exposes `Hipp0EventStream` for typed access from TypeScript.

