---
name: brain-ops
version: 1.0.0
description: Ambient READ->COMPILE->WRITE loop governing every agent interaction.
triggers:
  - before any task (READ phase)
  - after any decision or outcome (WRITE phase)
mutating: true
tools: [hipp0_compile_context, hipp0_record_decision, hipp0_my_wing_summary]
---

# Brain Ops

The ambient context membrane. Every agent interaction flows through this skill.

## READ Phase (before task)

1. Call `hipp0_compile_context` with the task summary as the query.
2. If the response includes `insights`, read them first - they are policies and anti-patterns the system has learned.
3. If the response includes contradictions, note them - do not act on a contradicted decision without awareness.
4. Include compiled context in your task context.

## WRITE Phase (after decision)

After recording any decision, verify:
- The decision has a clear `rationale` (not just a title)
- At least one `tag` names the entity or agent the decision affects (Iron Law)
- `confidence` is set

## WRITE Phase (after outcome)

After a task completes or a user reacts:
- Positive signal (user confirms, task succeeds) -> `record-outcome` skill with `rating: positive`
- Negative signal (/retry, tool-error rate high, user corrects) -> `record-outcome` with `rating: negative`
- Ambiguous -> `record-outcome` with `rating: neutral`

## Iron Law

Every recorded decision MUST tag all entities it affects. A decision about vendor X with no tag for X is invisible to entity-aware queries.
