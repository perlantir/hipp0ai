# Webhooks

Hipp0 supports outbound webhooks to notify external services when decision lifecycle events occur. Webhooks are configured per-project and support multiple delivery platforms.

## Setup

### Create a Webhook

```bash
curl -X POST http://localhost:3100/api/projects/<PROJECT_ID>/webhooks \
  -H "Authorization: Bearer <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Slack Notifications",
    "url": "https://hooks.slack.com/services/...",
    "platform": "slack",
    "events": ["decision_created", "contradiction_detected"],
    "enabled": true,
    "secret": "optional-hmac-secret"
  }'
```

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/projects/:id/webhooks` | List all webhooks for a project |
| `POST` | `/api/projects/:id/webhooks` | Create a new webhook |
| `PATCH` | `/api/projects/:id/webhooks/:whId` | Update a webhook (partial) |
| `DELETE` | `/api/projects/:id/webhooks/:whId` | Delete a webhook |
| `POST` | `/api/projects/:id/webhooks/:whId/test` | Send a test ping |

## Event Types

| Event | Trigger |
|-------|---------|
| `decision_created` | A new decision is recorded (or approved from review queue) |
| `decision_superseded` | A decision is superseded by a newer one |
| `decision_reverted` | A decision is reverted/rejected |
| `contradiction_detected` | The system detects conflicting decisions |
| `distillery_completed` | A distillery extraction session finishes |
| `scan_completed` | A GitHub import scan completes |

## Payload Format

All webhook deliveries use a standard envelope:

```json
{
  "event": "decision_created",
  "project_id": "uuid",
  "timestamp": "2026-04-08T12:00:00.000Z",
  "data": {
    "id": "decision-uuid",
    "title": "Use JWT for auth",
    "made_by": "backend-agent",
    "tags": ["auth", "security"],
    "confidence": "high"
  }
}
```

### Platform-Specific Formatting

| Platform | Format |
|----------|--------|
| `generic` | Raw JSON payload as shown above |
| `slack` | Slack Block Kit message with formatted sections |
| `discord` | Discord embed with title, description, and color-coded fields |
| `telegram` | Telegram Bot API `sendMessage` (requires `bot_token` and `chat_id` in metadata) |

## HMAC Signing

When a `secret` is configured on a webhook, each delivery includes an `X-Hipp0-Signature` header containing an HMAC-SHA256 signature of the request body.

To verify:

```javascript
const crypto = require('crypto');
const signature = crypto
  .createHmac('sha256', webhookSecret)
  .update(rawBody)
  .digest('hex');
const isValid = signature === receivedSignature;
```

## Retry Behavior

Webhook delivery is **best-effort with no automatic retries**:

- Each delivery has a **5-second timeout** (via `AbortController`).
- All webhooks for an event are delivered concurrently using `Promise.allSettled`.
- Failed deliveries are logged as warnings but do not throw or block the originating request.
- Use the **test ping** endpoint to verify connectivity before enabling a webhook for production events.

## Configuration Fields

| Field | Type | Max Length | Description |
|-------|------|-----------|-------------|
| `name` | string | 200 | Display label |
| `url` | string | 2000 | Delivery URL |
| `platform` | enum | — | `generic`, `slack`, `discord`, `telegram` |
| `events` | string[] | — | Which events to subscribe to |
| `enabled` | boolean | — | Toggle delivery without deleting |
| `secret` | string | 500 | HMAC-SHA256 signing key |
| `metadata` | object | — | Platform-specific extras (e.g., `bot_token`, `chat_id` for Telegram) |

## Dashboard

Manage webhooks from the dashboard at `#webhooks`. The UI provides:
- CRUD for webhook configurations
- Event type selection
- Test-send button to verify connectivity
- Enable/disable toggles
