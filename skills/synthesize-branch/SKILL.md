---
name: synthesize-branch
version: 1.0.0
description: Create, explore, and merge knowledge branches for experimental decision sets.
triggers:
  - "create a branch for experiment X"
  - "explore alternative approach"
  - "merge branch"
mutating: true
tools: [hipp0_record_decision, hipp0_compile_context]
---

# Synthesize Branch

Protocol for git-inspired branching of the decision graph.

## Create branch
POST to `POST /api/decisions/branches` with `{ name, description, base_branch: 'main' }`.

## Work on branch
Record decisions with `branch_id` parameter set. These decisions are isolated from main.

## Merge branch
POST to `POST /api/decisions/branches/:id/merge`. Review the diff first.

## Mandatory outcome
Every branch must record an outcome when merged OR discarded:
- Merged: record `positive` outcome with summary of what the branch proved
- Discarded: record `negative` outcome with reason
This feeds the learning loop so the system knows which experimental approaches worked.
