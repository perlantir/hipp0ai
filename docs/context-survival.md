# Context Compression Survival + Session Prefetch

Two features that ensure continuity and speed in multi-agent task sessions.

## Context Compression Survival (Checkpoints)

### Problem

When an agent's context window fills up and gets trimmed, important decisions and reasoning are lost. The next compile for that agent starts fresh without knowledge of what was decided earlier in the session.

### Solution

Agents call `hipp0_save_before_trim` before their context is compressed. This saves a checkpoint containing a summary and important decision IDs. On the next compile for that agent+session, the checkpoint is automatically restored with a `[RESTORED FROM CHECKPOINT]` label.

### How It Works

1. Agent detects context is getting large and calls `hipp0_save_before_trim`
2. Checkpoint is stored in `session_checkpoints` table
3. On next compile with the same `task_session_id` + `agent_name`, the latest checkpoint is prepended to the compiled context
4. If multiple checkpoints exist, only the latest one is used

### MCP Tool

```
hipp0_save_before_trim
  session_id: string        — Task session ID
  agent_name: string        — Your agent name
  context_summary: string   — Summary of important context to preserve
  important_decisions: string[] — IDs of decisions to flag (optional)
```

### SDK Method

```typescript
await client.saveBeforeTrim({
  session_id: 'uuid',
  agent_name: 'architect',
  context_summary: 'We decided to use PostgreSQL for the main DB...',
  important_decisions: ['decision-uuid-1', 'decision-uuid-2'],
});
```

### API Endpoint

```
POST /api/tasks/session/:id/checkpoint
Body: { agent_name, context_summary, important_decisions }
Returns: { checkpoint_id, session_id, agent_name }
```

### When to Call save_before_trim

- Before your context window reaches capacity
- When you've accumulated significant reasoning that would be expensive to reconstruct
- After making critical decisions that downstream agents depend on
- Before a long-running operation that may cause context trimming

## Session Prefetch

### Problem

When a step completes, the next agent needs to compile context before starting work. This adds latency to the handoff between agents.

### Solution

After a step is recorded, the system automatically pre-compiles context for the top-ranked agents who haven't participated yet. When one of those agents calls compile, the result is returned instantly from cache.

### How It Works

1. Agent records a step via `POST /api/tasks/session/:id/step`
2. In the background (fire-and-forget), the system:
   - Runs team scoring to find top N candidate agents
   - Filters out agents who already participated
   - Pre-compiles context for each candidate
   - Stores results in the prefetch cache
3. When a candidate agent calls compile with the session ID, the prefetched result is returned immediately
4. Prefetch cache is invalidated when a new step is recorded

### Configuration

Settings are stored in project metadata and accessible via:

```
GET  /api/projects/:id/settings
PATCH /api/projects/:id/settings
```

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `prefetch_enabled` | boolean | `true` | Enable/disable prefetch |
| `prefetch_agent_count` | number | `3` | Number of agents to pre-compile for |

### Example: Disable Prefetch

```bash
curl -X PATCH /api/projects/$PROJECT_ID/settings \
  -d '{"prefetch_enabled": false}'
```

### Example: Increase Prefetch Count

```bash
curl -X PATCH /api/projects/$PROJECT_ID/settings \
  -d '{"prefetch_agent_count": 5}'
```

### Cache Behavior

- Prefetch results use the same TTL as regular compile cache (5 minutes)
- Cache key format: `prefetch:{session_id}:{agent_name}`
- Cache is invalidated (cleared) when a new step is recorded in the session
- A prefetch cache hit is consumed on use (deleted after first read)
- The compile response includes `prefetch_hit: true` when served from prefetch cache

### Graceful Degradation

- If prefetch is disabled, compile works normally (no prefetch, no cache check)
- If team scoring fails, prefetch is silently skipped
- If cache is unavailable, compile proceeds without prefetch
- Prefetch never blocks the step response
