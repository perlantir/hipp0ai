# Authentication

Hipp0 uses API key authentication for all REST API requests. Every request must include a valid API key in the `Authorization` header unless auth is explicitly disabled for local development.

---

## How It Works

API keys are scoped to a project. Each project has one or more API keys. A request with a valid key gets access to that project's data — decisions, agents, compile results, webhooks, and settings.

Keys are stored hashed in the database. Hipp0 never returns the raw key value after creation.

---

## Getting Your API Key

On first startup, Hipp0 auto-creates a default project and API key. Retrieve it:

```bash
# Step 1: Get your project ID
curl http://localhost:3100/api/projects

# Step 2: Get the API key for that project
curl http://localhost:3100/api/api-keys?project_id=<PROJECT_ID>
```

---

## Using the API Key

Include it in every request:

```bash
Authorization: Bearer <YOUR_API_KEY>
```

Example:

```bash
curl http://localhost:3100/api/compile \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer nx_a8f3k2m9x7p4q1w6' \
  -d '{"agent_name": "builder", "task_description": "...", "project_id": "..."}'
```

---

## Creating Additional Keys

```bash
POST /api/projects/:project_id/api-keys
Authorization: Bearer <EXISTING_KEY>
Content-Type: application/json

{
  "name": "ci-pipeline",
  "description": "Used by GitHub Actions for automated decision imports"
}
```

Returns the key value once — copy it immediately, it won't be shown again.

---

## Listing Keys

```bash
GET /api/projects/:project_id/api-keys
Authorization: Bearer <API_KEY>
```

Returns key metadata (name, created date, last used) but not the key values.

---

## Revoking a Key

```bash
DELETE /api/projects/:project_id/api-keys/:key_id
Authorization: Bearer <API_KEY>
```

Revocation is immediate. Any requests using the revoked key will receive a `401 Unauthorized`.

---

## Auth Enforcement Modes

Controlled by the `HIPP0_AUTH_REQUIRED` environment variable:

| Value | Behavior |
|-------|----------|
| `true` (default) | All requests require a valid API key |
| `false` | Auth checks are skipped — for local development only |

**Never set `HIPP0_AUTH_REQUIRED=false` in production.** This disables all access control.

```bash
# .env (local dev only)
HIPP0_AUTH_REQUIRED=false
```

---

## MCP Authentication

When using MCP tools (Claude Desktop, Cursor, etc.), set the API key in the MCP server environment:

```json
{
  "mcpServers": {
    "hipp0": {
      "command": "node",
      "args": ["./packages/mcp/dist/index.js"],
      "env": {
        "HIPP0_API_URL": "http://localhost:3100",
        "HIPP0_API_KEY": "your-api-key",
        "HIPP0_PROJECT_ID": "your-project-id"
      }
    }
  }
}
```

---

## SDK Authentication

### TypeScript

```typescript
const client = new Hipp0Client({
  baseUrl: 'http://localhost:3100',
  apiKey: process.env.HIPP0_API_KEY,
  projectId: process.env.HIPP0_PROJECT_ID,
});
```

### Python

```python
client = Hipp0Client(
    base_url="http://localhost:3100",
    api_key=os.environ["HIPP0_API_KEY"],
    project_id=os.environ["HIPP0_PROJECT_ID"],
)
```

Store keys in environment variables — never hardcode them in source files.

---

## Webhook Signing

Outbound webhooks use HMAC-SHA256 signing, not API keys. Each webhook has its own signing secret. See [docs/webhooks.md](webhooks.md) for verification details.

---

## Related Docs

- [Self-Hosting](self-hosting.md) — production deployment and security hardening
- [Webhooks](webhooks.md) — HMAC signing for outbound events
- [MCP Setup](mcp-setup.md) — MCP client configuration
