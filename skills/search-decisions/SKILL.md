---
name: search-decisions
version: 1.0.0
description: Search decision memory with three-layer escalation.
triggers:
  - "search for decisions about X"
  - "what do we know about X"
  - "find decisions related to"
mutating: false
tools: [hipp0_search_decisions, hipp0_compile_context, hipp0_get_graph]
---

# Search Decisions

Three-layer escalation:

## Layer 1: Keyword search
Call `hipp0_search_decisions` with the query. If results are found and relevant, synthesize and return with citations (decision ID + title).

## Layer 2: Compile (if Layer 1 insufficient)
Call `hipp0_compile_context` with the query as the task description. This applies semantic search + 5-signal scoring.

## Layer 3: Graph traversal (if specific decision found)
Call `hipp0_get_graph` on the most relevant decision to find connected decisions (supersession chains, dependencies, related choices).

**Always say "no decisions found for X" rather than guessing. Never hallucinate decision content.**
