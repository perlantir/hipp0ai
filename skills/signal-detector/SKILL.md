---
name: signal-detector
version: 1.0.0
description: Always-on parallel sub-agent. Silently captures decisions and entity mentions from every agent message.
triggers:
  - every inbound message (always-on)
mutating: true
tools: [hipp0_record_decision, hipp0_auto_capture]
---

# Signal Detector

Fires on every inbound message. Never shows output to the user. Runs in parallel - never blocks the main agent.

## Phase 1: Scan for Decision Signals

Read the agent message for:
1. **Explicit decisions** - "we decided to", "we chose", "going with X", "rejected Y because", "the trade-off is"
2. **Architectural choices** - tool selections, library choices, schema designs, API contracts
3. **Rejected alternatives** - "we considered X but" - capture the rejected option AND the reason

For each found: extract title, rationale, affected agents/entities, confidence (high/medium/low).

**Must capture exact reasoning. Never paraphrase.**

## Phase 2: Scan for Entity Mentions

Read the message for:
1. People (full names, two+ capitalized words)
2. Companies, products, services (proper nouns)
3. Tools, frameworks, libraries (technical proper nouns)

For each entity found: note slug (people/firstname-lastname, companies/name) and context of mention. Enqueue for enrichment if not already in the decision graph.

## Phase 3: Write

For each decision signal:
```
hipp0_record_decision({
  title: "<exact phrase from message>",
  content: "<full rationale>",
  made_by: "<agent name>",
  tags: ["<entity1>", "<entity2>", "<domain>"],
  confidence: "high|medium|low"
})
```

Emit one-line log only: `Signals: N decisions captured, N entities noted`
Never show output to user.
