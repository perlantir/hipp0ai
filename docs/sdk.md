# TypeScript SDK

`@hipp0/sdk` is the official TypeScript client for Hipp0. It wraps the REST API with typed methods, handles authentication, and provides a clean interface for the most common agent workflows.

> **Pre-release:** `@hipp0/sdk` is not yet published to npm. Install locally from the repo while the package is in pre-release.

---

## Installation

### From the Hipp0 repo (current)

```bash
cd /path/to/hipp0
pnpm install
pnpm --filter @hipp0/sdk build
```

Then in your project:

```json
{
  "dependencies": {
    "@hipp0/sdk": "file:/path/to/hipp0/packages/sdk"
  }
}
```

### From npm (coming soon)

```bash
npm install @hipp0/sdk
```

---

## Initialization

```typescript
import { Hipp0Client } from '@hipp0/sdk';

const hipp0 = new Hipp0Client({
  baseUrl: 'http://localhost:3100',  // Your Hipp0 server URL
  apiKey: 'your-api-key',            // From GET /api/api-keys
  projectId: 'your-project-id',      // From GET /api/projects
});
```

---

## Core Methods

### `compile(options)` — Get context for an agent

The primary method. Pass an agent name and task, get back a ranked context package.

```typescript
const context = await hipp0.compile({
  agent_name: 'builder',
  task_description: 'implement the payment service',
});

// context.decisions — ranked array of relevant past decisions
// context.recommended_action — PROCEED | SKIP | OVERRIDE_TO | ...
// context.action_reason — why
// context.formatted_markdown — ready-to-inject context block
```

**With session memory:**

```typescript
const context = await hipp0.compile({
  agent_name: 'reviewer',
  task_description: 'review the payment service implementation',
  task_session_id: sessionId,  // Links this compile to the session
});
// Prior agent steps are automatically prepended to context
```

**With namespace filtering:**

```typescript
const context = await hipp0.compile({
  agent_name: 'security',
  task_description: 'audit the auth flow',
  namespace: 'auth',  // Only returns auth-scoped + global decisions
});
```

---

### `recordDecision(decision)` — Save a decision

```typescript
await hipp0.recordDecision({
  title: 'Use JWT for API auth',
  description: 'All API endpoints use Bearer token authentication via JWT.',
  reasoning: 'Stateless, scales horizontally, works with any client.',
  made_by: 'architect',
  affects: ['builder', 'reviewer', 'security'],
  tags: ['auth', 'api', 'security'],
  confidence: 'high',
  alternatives_considered: [
    { option: 'Session cookies', rejected_reason: 'Requires sticky sessions, breaks horizontal scaling' }
  ],
});
```

**Full options:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | Yes | Short description of the decision |
| `description` | string | Yes | What was decided |
| `reasoning` | string | No | Why this decision was made |
| `made_by` | string | Yes | Agent or human name |
| `affects` | string[] | No | Agent or component names impacted |
| `tags` | string[] | No | Domain taxonomy labels |
| `confidence` | `'high' \| 'medium' \| 'low'` | No | Default: `'medium'` |
| `namespace` | string | No | Scope to a domain (see [namespaces.md](namespaces.md)) |
| `alternatives_considered` | `{option, rejected_reason}[]` | No | What was rejected |
| `assumptions` | string[] | No | Assumed conditions |
| `open_questions` | string[] | No | Unresolved questions |
| `status` | `'active' \| 'pending'` | No | `'pending'` puts it in the review queue |

---

### `searchDecisions(query)` — Semantic search

```typescript
const results = await hipp0.searchDecisions({
  query: 'authentication token strategy',
  limit: 10,
});

// results.decisions — ranked by relevance
```

---

### `createSession()` — Start a task session

```typescript
const session = await hipp0.createSession({
  task: 'implement user authentication',
  agents: ['architect', 'builder', 'reviewer'],
});

// session.id — use as task_session_id in compile calls
```

---

### `recordStep(sessionId, step)` — Record an agent step

```typescript
await hipp0.recordStep(session.id, {
  agent_name: 'architect',
  task: 'design the auth system',
  output: 'Decided on JWT with 15-min access tokens and 7-day refresh tokens.',
  status: 'complete',
  decisions_made: [decisionId],
});
```

---

### `saveBeforeTrim(options)` — Checkpoint before context trim

Call this before your agent's context window gets trimmed. Saves a checkpoint that gets automatically restored on the next compile in the same session.

```typescript
await hipp0.saveBeforeTrim({
  session_id: session.id,
  agent_name: 'builder',
  context_summary: 'We chose JWT for auth, PostgreSQL for storage, and Redis for caching.',
  important_decisions: [authDecisionId, storageDecisionId],
});
```

See [docs/context-survival.md](context-survival.md) for the full context checkpoint guide.

---

### `submitFeedback(compileId, feedback)` — Rate compiled context

```typescript
await hipp0.submitFeedback(context.compile_id, {
  decision_id: 'decision-uuid',
  rating: 'useful',  // 'critical' | 'useful' | 'irrelevant'
});
```

Feedback drives wing affinity learning — decisions rated `irrelevant` get downweighted for this agent, `critical` decisions get boosted.

---

## H0C Format

For token-constrained agents, request the compact H0C format instead of full JSON:

```typescript
const context = await hipp0.compile({
  agent_name: 'builder',
  task_description: 'implement refresh token rotation',
  format: 'h0c',  // Returns 10-12x token reduction vs JSON
});

// context.h0c — compact string, inject directly into agent context
```

See [docs/h0c-format.md](h0c-format.md) for format specification.

---

## Error Handling

```typescript
import { Hipp0Error, Hipp0AuthError, Hipp0NotFoundError } from '@hipp0/sdk';

try {
  const context = await hipp0.compile({ agent_name: 'builder', task_description: '...' });
} catch (err) {
  if (err instanceof Hipp0AuthError) {
    // Invalid or missing API key
  } else if (err instanceof Hipp0NotFoundError) {
    // Project or agent not found
  } else if (err instanceof Hipp0Error) {
    console.error(err.status, err.message);
  }
}
```

---

## TypeScript Types

Key types exported from `@hipp0/sdk`:

```typescript
import type {
  Decision,
  CompileResult,
  CompileOptions,
  RecordDecisionOptions,
  TaskSession,
  TaskStep,
  AgentFeedback,
  RecommendedAction,
} from '@hipp0/sdk';
```

---

## Related Docs

- [Python SDK](python-sdk.md)
- [MCP Setup](mcp-setup.md) — use Hipp0 tools from Claude Desktop, Cursor, or any MCP client
- [CLI](cli.md) — command-line interface
- [API Reference](api-reference.md) — full REST API if you prefer direct HTTP
