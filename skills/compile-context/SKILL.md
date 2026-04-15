---
name: compile-context
version: 1.0.0
description: Load relevant decision memory before handling any task.
triggers:
  - starting a new task
  - "what was decided about X"
  - "load context for"
mutating: false
tools: [hipp0_compile_context, hipp0_get_contradictions, hipp0_my_wing_summary]
---

# Compile Context

Three-step protocol for loading memory before a task.

## Step 1: Compile
Call `hipp0_compile_context` with the task description. Include `format: condensed` for large contexts.

## Step 2: Check Contradictions
If `hipp0_compile_context` returns contradictions in the response, call `hipp0_get_contradictions` for the top-scoring decisions to understand the conflict.

## Step 3: Integrate
Integrate compiled context into your working memory before starting the task. Note any insights (type='insight') - these are system-learned policies and anti-patterns that should constrain your approach.
