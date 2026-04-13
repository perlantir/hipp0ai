# Community Insights

Community Insights surfaces cross-project patterns during context compilation. When a task matches patterns observed across multiple Hipp0 projects, relevant patterns appear alongside your scored decisions as `suggested_patterns`.

The idea: if three separate teams have independently converged on the same approach to a problem, that's a signal worth surfacing to a fourth team facing the same situation.

---

## How It Works

Pattern extraction runs weekly across all projects. It's anonymized — only structural signal is collected (decision types, tag combinations, confidence distributions, scope patterns). No decision titles, descriptions, or reasoning text leaves your project.

When you compile context:
1. The compiler queries the `anonymous_patterns` table for active patterns above the confidence threshold
2. Each pattern is scored against your current task using tag overlap (60%) and description similarity (40%)
3. The top 2 most relevant patterns (if any) are appended to the compile response as `suggested_patterns`

Pattern scoring is lighter than decision scoring intentionally — it doesn't use persona match or embeddings because patterns are cross-project observations, not project-specific decisions.

---

## What a Pattern Looks Like

In a compile response:

```json
{
  "decisions": [...],
  "suggested_patterns": [
    {
      "pattern_id": "uuid",
      "title": "JWT tokens should use RS256 over HS256",
      "description": "3 projects independently chose RS256 for JWT signing after evaluating HS256.",
      "confidence": 0.85,
      "source_count": 3,
      "relevance_score": 0.72
    }
  ]
}
```

In H0C format, patterns appear after the decisions section:

```
---PATTERNS---
[P|85|3src] RS256 over HS256 for JWT signing | Asymmetric signing preferred across projects
```

In Markdown output:

```markdown
## Suggested Patterns
- **RS256 over HS256 for JWT signing** (85% confidence, 3 projects) — Asymmetric signing preferred across projects
```

---

## Enabling and Disabling

Community Insights is enabled by default. Disable per project:

```bash
PATCH /api/projects/:project_id/settings
{
  "metadata": {
    "pattern_recommendations": false
  }
}
```

When disabled, no patterns are surfaced in compile responses, and your project's decisions are not included in the cross-project pattern extraction analysis.

---

## Confidence Threshold

Control how strong a pattern has to be before it's surfaced:

```bash
PATCH /api/projects/:project_id/settings
{
  "metadata": {
    "pattern_recommendations": true,
    "min_pattern_confidence": 0.70
  }
}
```

Default threshold: `0.60`. A pattern at 0.60 confidence means roughly 60% of sampled projects with similar decisions converged on the same approach.

Higher threshold = fewer, stronger patterns. Lower threshold = more patterns, potentially noisier.

---

## Pattern Freshness

Patterns have a freshness score that decays over time, similar to individual decisions. Patterns that haven't been reinforced by recent project data are automatically downweighted and eventually archived.

Pattern confidence also tracks the `source_count` — how many projects contributed data. A pattern from 2 projects (minimum threshold) is weaker than one from 8 projects.

---

## Privacy

What is collected for pattern extraction:
- Tag combinations from decisions
- Temporal scope distributions
- Confidence level patterns
- Decision relationship types (requires, contradicts, supersedes)

What is **never** collected:
- Decision titles
- Decision descriptions or reasoning
- Agent names
- Project names or identifiers
- Any text content from decisions

The extraction process produces abstract structural patterns only. There is no way to reconstruct any individual decision from the pattern data.

---

## Related Docs

- [Pattern Recommendations](pattern-recommendations.md) — detailed API reference for the `suggested_patterns` field
- [Background Workers](background-workers.md) — when the pattern extraction worker runs
- [Temporal Intelligence](temporal-intelligence.md) — how pattern freshness scoring works
