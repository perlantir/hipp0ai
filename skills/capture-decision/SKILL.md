---
name: capture-decision
version: 1.0.0
description: Record a decision with rationale, entity tags, and confidence.
triggers:
  - "we decided to"
  - "going with X"
  - "rejected Y because"
  - explicit architectural choice
mutating: true
tools: [hipp0_record_decision, hipp0_get_contradictions, hipp0_search_decisions]
---

# Capture Decision

Validate before recording.

## Pre-flight checks
1. Does the decision have a clear rationale (not just a title)?
2. Does it have at least one entity/agent tag?
3. Is it truly new, or restating an existing decision? Search first: `hipp0_search_decisions` with the title.
4. Check for immediate conflicts: `hipp0_get_contradictions` after recording.

## Record
```
hipp0_record_decision({
  title: "<clear statement of what was decided>",
  content: "<full rationale including alternatives considered>",
  made_by: "<agent name>",
  tags: ["<all affected entities and domains>"],
  confidence: "high|medium|low",
  affects: ["<agent names this decision affects>"]
})
```

## Post-record
If `hipp0_get_contradictions` returns any contradictions, surface them immediately.
