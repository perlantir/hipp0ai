# H0C (Hipp0Condensed) Format Specification

H0C is an ultra-compact serialization format for compiled decision context. It achieves 12-18x token reduction vs full JSON while preserving all decision meaning: what was decided, who decided, relevance score, when, and domain.

## When to Use

| Format   | Use Case                                                   | Token Cost |
|----------|------------------------------------------------------------|------------|
| **JSON** | Default. Dashboard display, programmatic processing, debugging | Full       |
| **H0C**  | LLM context injection, token-constrained agents, bulk context | ~6-8% of JSON |
| **Markdown** | Human-readable reports, documentation, chat responses     | ~40-60% of JSON |

## Format Structure

An H0C payload consists of three sections:

### 1. Header

```
#H0C v2
#TAGS: 0=auth 1=security 2=jwt 3=database 4=api 5=middleware
---
```

- `#H0C v2` — format identifier and version
- `#TAGS:` — tag index mapping integers to tag names (deduplication)
- `---` — separator between header and decision lines

### 2. Decision Lines

Each decision is encoded on a single line:

```
[92|H|by:architect|Apr8] Use JWT with 15-min expiry | g:0,1,2 | Auth tokens with short-lived access
```

#### Field Reference

| Position       | Field        | Full Name        | Example     | Notes                            |
|---------------|-------------|------------------|-------------|----------------------------------|
| Bracket [0]   | score       | combined_score   | `92`        | Integer 0-100 (0.92 → 92)       |
| Bracket [1]   | confidence  | confidence       | `H`         | H=high, M=medium, L=low         |
| Bracket [2]   | by          | made_by          | `by:arch`   | Agent who made the decision      |
| Bracket [3]   | date        | created_at       | `Apr8`      | MonthDay compact format          |
| After bracket | title       | title            | `Use JWT...`| Truncated to 12 words max        |
| Segment 2     | g           | tags             | `g:0,1,2`   | Tag indices from #TAGS header    |
| Segment 3     | description | description      | text        | First sentence, 10 words max     |
| Segment 4     | r           | reasoning        | `r:text`    | Optional, only with includeReasoning |

### 3. Empty Format

When no decisions are present:
```
#H0C v2
---
(empty)
```

## Tag Deduplication

Tags are deduplicated across all decisions via a header index:

```
#TAGS: 0=auth 1=security 2=jwt 3=api 4=middleware
```

Each decision references tags by index:
- `g:0,1,2` means tags `auth`, `security`, `jwt`
- `g:3,4` means tags `api`, `middleware`

This eliminates redundant tag strings across decisions and reduces token count significantly when decisions share common tags.

## Decoding

### SDK Method

```typescript
import { Hipp0Client } from '@hipp0/sdk';

// Static method — no client instance needed
const decisions = Hipp0Client.decodeH0C(h0cString);
// Returns: DecodedDecision[]
```

### Core Library

```typescript
import { decodeH0C } from '@hipp0/core';

const decisions = decodeH0C(h0cString);
```

### Manual Parsing Rules

1. Split on newlines
2. Lines starting with `#` are headers — parse `#TAGS:` to build tag map
3. Skip `---` separator and `(empty)` marker
4. For each decision line, match `[meta] rest`:
   - Split meta on `|` → `[score, confidence, by:agent, date]`
   - Split rest on ` | ` → `[title, g:tags, description, r:reasoning?]`
   - Resolve tag indices via the `#TAGS` map
   - Expand: score/100, H→high, M→medium, L→low

### DecodedDecision Shape

```typescript
interface DecodedDecision {
  title: string;        // Decision title (may be truncated)
  score: number;        // 0.0 - 1.0 (expanded from integer)
  confidence: 'high' | 'medium' | 'low';
  made_by: string;      // Agent name
  date: string;         // Compact date string (e.g., "Apr8")
  tags: string[];       // Expanded tag names
  description: string;  // Summary (first sentence, ≤10 words)
  reasoning?: string;   // Optional reasoning hint
}
```

## Compression Ratio Expectations

| Decisions | Full JSON (tokens) | H0C (tokens) | Ratio  |
|-----------|-------------------|--------------|--------|
| 1         | ~200              | ~30          | ~7x    |
| 5         | ~1,000            | ~80          | ~12x   |
| 10        | ~2,000            | ~130         | ~15x   |
| 50        | ~10,000           | ~600         | ~17x   |
| 100       | ~20,000           | ~1,200       | ~17x   |

Ratios scale with decision count because the tag index amortizes across all decisions and per-decision overhead is fixed.

## API Usage

### Compile Route

```bash
# Default (JSON)
curl -X POST /api/compile -d '{"agent_name":"backend","project_id":"...","task_description":"..."}'

# H0C format
curl -X POST '/api/compile?format=h0c' -d '{"agent_name":"backend","project_id":"...","task_description":"..."}'

# Markdown format
curl -X POST '/api/compile?format=markdown' -d '{"agent_name":"backend","project_id":"...","task_description":"..."}'
```

Response headers for H0C:
- `X-Hipp0-Format: h0c`
- `X-Hipp0-Compression-Ratio: 14.2x`

### SDK

```typescript
const client = new Hipp0Client({ baseUrl: '...', apiKey: '...' });

// Request H0C format
const result = await client.compileContext({
  agent_name: 'backend',
  project_id: '...',
  task_description: '...',
  format: 'h0c',
});
```

### MCP Tool

```json
{
  "tool": "compile_context",
  "arguments": {
    "agent_name": "backend",
    "task_description": "Implement auth flow",
    "format": "h0c"
  }
}
```

## Annotated Example

Input (3 decisions as JSON): ~800 tokens

```json
[
  {
    "id": "dec-001",
    "title": "Use JWT with 15-min expiry",
    "description": "Chose JWT over session cookies for API auth. Tokens are self-contained and scale horizontally.",
    "reasoning": "Session cookies require sticky sessions or shared Redis. JWT is self-contained and scales horizontally without server-side state.",
    "made_by": "architect",
    "confidence": "high",
    "tags": ["auth", "security", "jwt"],
    "combined_score": 0.92,
    "created_at": "2026-04-08T01:29:38.121Z"
  }
]
```

H0C output: ~50 tokens

```
#H0C v2
#TAGS: 0=auth 1=security 2=jwt 3=api 4=middleware
---
[92|H|by:architect|Apr8] Use JWT with 15-min expiry | g:0,1,2 | Chose JWT over session cookies for API
[85|H|by:backend|Apr7] Hono middleware for JWT verification | g:0,3,4 | Verify on every protected route
[71|M|by:security|Apr6] Rate limit auth endpoints 100/min | g:0,3 | Prevent brute force
```

Compression: **~16x reduction**.
