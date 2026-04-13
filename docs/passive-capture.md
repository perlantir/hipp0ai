# Passive Decision Capture

Automatically extract decisions from agent conversations without manual intervention.

## Overview

Passive capture lets you submit raw conversation transcripts from any agent platform (OpenClaw, Telegram, Slack, or API) and have Hipp0 automatically:

1. Extract decisions using the distillery pipeline
2. Flag them with `source: 'auto_capture'` and `confidence: 'low'`
3. Add them to the review queue for human approval
4. Fire a `capture_completed` webhook when done

Extraction runs asynchronously — the API returns immediately with a `capture_id` for status tracking.

## Enabling Auto-Capture

Auto-capture is disabled by default. Enable it per-project via settings:

```bash
curl -X PATCH http://localhost:3100/api/projects/{project_id}/settings \
  -H "Content-Type: application/json" \
  -d '{"auto_capture": true}'
```

Note: Explicit API calls to `POST /api/capture` work even when `auto_capture` is `false`.

## API Reference

### Submit a Capture

```
POST /api/capture
```

**Request Body:**

```json
{
  "agent_name": "maks",
  "project_id": "550e8400-e29b-41d4-a716-446655440000",
  "conversation": "Full conversation text here...",
  "session_id": "optional-session-uuid",
  "source": "openclaw"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `agent_name` | string | Yes | Name of the agent whose conversation this is |
| `project_id` | UUID | Yes | Project to capture decisions into |
| `conversation` | string | Yes | Full conversation text (max 500KB) |
| `session_id` | UUID | No | Link captured decisions to an existing task session |
| `source` | string | No | Platform source: `openclaw`, `telegram`, `slack`, `api` (default: `api`) |

**Response (202 Accepted):**

```json
{
  "capture_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "processing"
}
```

### Check Capture Status

```
GET /api/capture/{capture_id}
```

**Response:**

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "completed",
  "extracted_decision_count": 3,
  "extracted_decision_ids": [
    "dec-uuid-1",
    "dec-uuid-2",
    "dec-uuid-3"
  ],
  "error_message": null,
  "created_at": "2026-04-08T10:30:00.000Z",
  "completed_at": "2026-04-08T10:30:05.000Z"
}
```

Status values:
- `processing` — extraction is running
- `completed` — decisions extracted successfully
- `failed` — extraction failed (check `error_message`)

### List Project Captures

```
GET /api/projects/{project_id}/captures?limit=50&offset=0
```

Returns an array of capture entries with status and decision counts.

## MCP Tool

Agents can call `hipp0_auto_capture` after completing work to submit their conversation for extraction:

```
Tool: hipp0_auto_capture
Input:
  agent_name: "maks"
  conversation: "Full conversation text..."
  project_id: "optional, uses default"
  session_id: "optional task session ID"
  source: "api"
```

Returns: `capture_id` for tracking.

## Review Queue Flow

Captured decisions follow this flow:

1. **Extraction** — Distillery pipeline extracts decisions from the conversation
2. **Flagging** — Decisions are marked with:
   - `source: 'auto_capture'`
   - `confidence: 'low'`
   - `status: 'pending'`
   - `review_status: 'pending_review'`
3. **Review Queue** — Decisions appear in the project's review queue (`GET /api/projects/{id}/review-queue`)
4. **Approval/Rejection** — Humans approve or reject via:
   - `POST /api/decisions/{id}/approve` — activates the decision
   - `POST /api/decisions/{id}/reject` — soft-deletes the decision

## Dashboard

The Import page includes a "Capture History" section showing:

- Recent captures with status badges (processing/completed/failed)
- Extracted decision count per capture
- Source platform indicator
- Direct link to the review queue for captured decisions

## Webhooks

When extraction completes, a `capture_completed` webhook is fired with:

```json
{
  "event": "capture_completed",
  "project_id": "...",
  "timestamp": "...",
  "data": {
    "capture_id": "...",
    "decisions_extracted": 3,
    "decision_ids": ["...", "...", "..."],
    "agent_name": "maks"
  }
}
```

Configure webhooks via `POST /api/projects/{id}/webhooks` with `capture_completed` in the events array.

## Token Cost Considerations

Each capture runs the full distillery pipeline, which includes:

- **LLM extraction** — 1 API call to extract decisions from conversation text
- **Deduplication** — comparison against existing decisions (may use embeddings)
- **Contradiction detection** — checks for conflicts with existing decisions
- **Session summary** — generates a conversation summary

Estimated cost per capture depends on conversation length:
- Short conversations (~1K tokens): ~2-3K tokens processed
- Medium conversations (~5K tokens): ~8-10K tokens processed
- Long conversations (~20K+ tokens): ~25-30K tokens processed

To manage costs:
- Enable `auto_capture` only for projects that need it
- Use the explicit API endpoint rather than always-on capture
- Monitor capture frequency via the dashboard
