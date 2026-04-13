# Pattern Recommendations

Hipp0 proactively surfaces cross-project patterns during compile responses. When a task matches patterns observed across multiple projects, up to 2 relevant patterns are included alongside the scored decisions.

## How Patterns Are Surfaced

During the compile pipeline, after decisions are scored and finalized:

1. The compiler queries the `anonymous_patterns` table for active patterns above the confidence threshold
2. Each pattern is scored against the current task using:
   - **Tag overlap (60%)** — how many of the pattern's tags match the task's decision tags
   - **Description similarity (40%)** — keyword overlap between pattern titles and the task description
3. The top 2 patterns (maximum) with relevance > 0 are included in the response as `suggested_patterns`

This scoring is intentionally lighter than decision scoring (no persona match or embeddings) since patterns are cross-project observations, not project-specific decisions.

## Response Format

### JSON

```json
{
  "decisions": [...],
  "suggested_patterns": [
    {
      "pattern_id": "uuid",
      "title": "JWT tokens should use RS256 over HS256",
      "description": "3 projects independently chose RS256 for JWT signing",
      "confidence": 0.85,
      "source_count": 3,
      "relevance_score": 0.72
    }
  ]
}
```

### H0C Format

Patterns are appended after the decisions section:

```
#H0C v2
#TAGS: 0=auth 1=security 2=jwt
---
[92|H|backend|Apr1]JWT authentication strategy|g:0,1,2|Stateless auth
---PATTERNS---
[P|85|3src] RS256 over HS256 for JWT signing | Asymmetric signing preferred across projects
```

Format: `[P|confidence|source_count] title | description`

### Markdown Format

A "Suggested Patterns" section is appended after the decisions:

```markdown
## Suggested Patterns
- **RS256 over HS256 for JWT signing** (85% confidence, 3 projects) — Asymmetric signing preferred across projects
```

## Controls

### Project Setting

In project metadata (`PATCH /api/projects/:id`):

```json
{
  "metadata": {
    "pattern_recommendations": true,
    "min_pattern_confidence": 0.60
  }
}
```

- `pattern_recommendations` — Enable/disable pattern recommendations (default: `true`)
- `min_pattern_confidence` — Minimum confidence threshold for patterns (default: `0.60`)

### Per-Request Suppression

Add `?include_patterns=false` to the compile request to suppress patterns for a single request:

```
POST /api/compile?include_patterns=false
```

### Limits

- Maximum 2 patterns per compile response
- Minimum confidence: 0.60 (configurable)
- Only patterns from 3+ source projects are considered for divergence triggers

## Pattern Divergence — Evolution Engine

A new evolution trigger `pattern_divergence` fires when a project's decisions contradict a widely-adopted pattern:

- **Condition:** A decision contradicts a pattern with 3+ source projects and confidence > 0.70
- **Urgency:** medium
- **Example reasoning:** "3 other projects use RS256 for JWT signing. This project uses HS256. Consider aligning."

This trigger runs as part of `runEvolutionScan()` alongside the other 10 rule-based triggers.

## MCP Tool

The `hipp0_get_patterns` tool lists all patterns with optional filtering:

```
Parameters:
  tags: string[]       — Filter by tags
  domain: string       — Filter by domain
  min_confidence: number — Minimum confidence (0-1)
  limit: number        — Max results (1-50)
```

## SDK

The `compile()` method return type includes `suggested_patterns`:

```typescript
const result = await hipp0.compile({
  agentName: 'backend',
  taskDescription: 'Implement JWT authentication',
});

// result.suggested_patterns: SuggestedPattern[]
for (const pattern of result.suggested_patterns) {
  console.log(`${pattern.title} (${pattern.confidence})`);
}
```

## Backward Compatibility

- `suggested_patterns` is always present in the response (empty array when disabled or no match)
- Existing clients that don't read the field are unaffected
- The H0C `---PATTERNS---` section only appears when patterns exist
- The markdown "Suggested Patterns" section only appears when patterns exist
