# hipp0 Skill Resolver

Read this file at conversation start. Route every message through the appropriate skill.

## Always-On (fire in parallel, non-blocking)

| Trigger | Skill |
|---------|-------|
| Every inbound message | `signal-detector` |

## Brain Access (governs every read/write)

| Trigger | Skill |
|---------|-------|
| Before any task | `brain-ops` (READ phase) |
| After any decision/outcome | `brain-ops` (WRITE phase) |

## Intent Routing

| Trigger | Skill |
|---------|-------|
| Starting a task, "what was decided about X", load context | `compile-context` |
| Recording a decision, "we decided to", "we chose" | `capture-decision` |
| Task complete, outcome known, /retry, user reaction | `record-outcome` |
| "Search for decisions about X", querying memory | `search-decisions` |
| Health check, "clean up memory", maintenance | `maintain` |
| Creating/merging/exploring a knowledge branch | `synthesize-branch` |
| New entity mentioned (person/company/tool) | `enrich` (Phase 3) |
| Ingesting PDF or transcript | `entity-ingest` (Phase 3) |

## Disambiguation

- Most specific skill wins. "What did we decide about auth last month?" -> `search-decisions` (temporal).
- If multiple skills match, run them sequentially: `brain-ops` (READ) -> intent skill -> `brain-ops` (WRITE).
- `signal-detector` always runs in parallel - never blocks.
