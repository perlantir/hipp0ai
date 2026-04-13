# Namespace Isolation

Namespaces scope decisions so that compile requests can filter by domain. This keeps agent context focused and avoids noise from unrelated decisions.

## How it works

Every decision has an optional `namespace` field (a short string like `"auth"`, `"infra"`, `"frontend"`). When namespace is `null` (the default), the decision is **global** and always included in compile results regardless of any namespace filter.

### Filtering

When you pass a `namespace` parameter to compile:
- Decisions matching that namespace are included
- Global decisions (namespace = null) are **always** included
- Decisions from other namespaces are excluded

Multiple namespaces can be specified as a comma-separated string: `"auth,security"`.

When no namespace filter is set, **all** decisions are returned (backward compatible).

## Assigning namespaces

### At creation time

Pass `namespace` when creating a decision:

```json
POST /api/projects/:id/decisions
{
  "title": "Use JWT with 15-min expiry",
  "description": "...",
  "made_by": "architect",
  "namespace": "auth"
}
```

### Updating a single decision

```json
PATCH /api/decisions/:id
{
  "namespace": "auth"
}
```

Set to `null` to make a decision global again.

### Bulk assignment

```json
POST /api/decisions/bulk-namespace
{
  "decision_ids": ["uuid-1", "uuid-2", "uuid-3"],
  "namespace": "infra"
}
```

## Listing namespaces

```
GET /api/projects/:id/namespaces
```

Returns all namespaces with decision counts:

```json
[
  { "namespace": "auth", "count": 12 },
  { "namespace": "infra", "count": 8 },
  { "namespace": "frontend", "count": 5 }
]
```

## Compile with namespace

### API

```json
POST /api/compile
{
  "agent_name": "security",
  "project_id": "...",
  "task_description": "Review auth token rotation",
  "namespace": "auth"
}
```

Or via query parameter: `POST /api/compile?namespace=auth,security`

### SDK

```typescript
const ctx = await hipp0.compile({
  agentName: 'security',
  taskDescription: 'Review auth token rotation',
  namespace: 'auth',
});
```

### MCP

The `hipp0_compile_context` tool accepts an optional `namespace` parameter.
The `hipp0_record_decision` tool accepts an optional `namespace` parameter.

## H0C format

Namespaced decisions include an `ns:` indicator in the metadata bracket:

```
[92|H|architect|Apr8|ns:auth] Use JWT with 15-min expiry|g:0,1,2|Short-lived access tokens
```

Global decisions (no namespace) omit the `ns:` indicator.

## Examples

### Per-feature scoping

Assign `"auth"`, `"payments"`, `"notifications"` to keep feature-team decisions isolated. An auth engineer compiling context gets auth + global decisions only.

### Per-team scoping

Use `"backend"`, `"frontend"`, `"mobile"` so each team's compile sees relevant decisions without cross-team noise.

### Work vs personal

For individual developers managing multiple projects in a single Hipp0 instance, use `"work"` and `"personal"` namespaces.
