# GitHub Deep Integration

Bidirectional linking between Hipp0 decisions and GitHub pull requests.

## Features

- **PR Reference Scanning** — Automatically detects `H0-<uuid>` (and legacy `DG-<uuid>`) and `Implements: "title"` patterns in PR descriptions
- **Relevant Decision Comments** — Posts a table of related decisions on new PRs based on changed file analysis
- **Merge Status Tracking** — Updates link status when PRs are merged or closed
- **Supersede Notifications** — Warns linked PRs when a decision is superseded
- **Manual Linking** — Link any PR/issue to a decision from the dashboard

## Setup

### 1. Create a GitHub App

1. Go to **Settings > Developer settings > GitHub Apps > New GitHub App**
2. Configure permissions:
   - **Repository permissions:**
     - Pull requests: Read & Write (to post comments)
     - Contents: Read (to analyze changed files)
   - **Subscribe to events:**
     - Pull request
3. Generate a private key (PEM file)
4. Install the app on your organization/repositories
5. Note the **App ID** and **Installation ID** from the app settings

### 2. Configure Hipp0

Add the following to your `.env` file:

```bash
# GitHub Deep Integration
HIPP0_GITHUB_APP_ID=123456
HIPP0_GITHUB_APP_PRIVATE_KEY=<base64-encoded PEM>
HIPP0_GITHUB_APP_INSTALLATION_ID=78901234
HIPP0_GITHUB_WEBHOOK_SECRET=your-webhook-secret
HIPP0_GITHUB_DEFAULT_PROJECT_ID=<uuid>
HIPP0_DASHBOARD_URL=http://localhost:3200
```

To base64-encode your PEM key:

```bash
base64 -w 0 < your-app.private-key.pem
```

### 3. Configure Webhook

In your GitHub App settings, set the webhook URL to:

```
https://your-hipp0-instance.com/api/webhooks/github
```

Set the webhook secret to match `HIPP0_GITHUB_WEBHOOK_SECRET`.

### 4. Restart Hipp0

```bash
docker compose restart server
```

## Referencing Decisions in PRs

### By UUID

Include `H0-<uuid>` anywhere in your PR description:

```
This PR addresses H0-a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

### By Title

Use `Implements:` or `Refs:` with the exact decision title in quotes:

```
Implements: "Use PostgreSQL for session storage"
Refs: "Migrate auth to JWT tokens"
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/decisions/:id/links` | Get all links for a decision |
| GET | `/api/projects/:id/links` | Get all links for a project |
| POST | `/api/decisions/:id/links` | Manually create a link |
| DELETE | `/api/links/:id` | Remove a link |
| GET | `/api/projects/:id/github/status` | GitHub connection status |

### Create Link

```bash
curl -X POST /api/decisions/<id>/links \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "github",
    "external_id": "owner/repo#47",
    "external_url": "https://github.com/owner/repo/pull/47",
    "link_type": "implements",
    "title": "Add auth middleware"
  }'
```

### Link Types

| Type | Meaning |
|------|---------|
| `implements` | PR implements this decision |
| `references` | PR references this decision |
| `created_by` | Decision was created from this PR |
| `validates` | PR validates/tests this decision |
| `affects` | PR affects systems related to this decision |
