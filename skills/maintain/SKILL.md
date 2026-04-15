---
name: maintain
version: 1.0.0
description: Run health checks on the decision graph and surface issues.
triggers:
  - "run health check"
  - "clean up memory"
  - "what decisions are stale"
mutating: false
tools: [hipp0_list_decisions, hipp0_get_contradictions, hipp0_search_decisions]
---

# Maintain

Check all health dimensions and report findings.

## Checks

1. **Orphaned decisions** - `hipp0_list_decisions` filtered by `tags: []` - decisions with no entity or agent tags
2. **Stale decisions** - decisions with `status: active` and `updated_at` > 90 days ago and no outcomes recorded
3. **Low-trust decisions** - decisions where trust_score < 0.4 (visible in scoring breakdown)
4. **Active contradictions** - `hipp0_get_contradictions` - list all unresolved contradictions
5. **Anti-patterns** - knowledge insights with `insight_type: anti_pattern` - patterns of repeated failure

## Report format
```
Health Report - <date>
Orphaned: N decisions (list titles)
Stale: N decisions (list titles)
Low-trust: N decisions (list titles)
Contradictions: N active (list pairs)
Anti-patterns: N detected (list titles)
Recommended actions: [...]
```
