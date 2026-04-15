---
name: entity-query
version: 1.0.0
description: Query entity pages by name or topic.
triggers:
  - "tell me about [person/company]"
  - "what do we know about [entity]"
mutating: false
tools: []
---

# Entity Query

1. Search: `GET /api/entities?project_id=&q=<name>&type=<type>`
2. If found, return `compiled_truth` as primary content.
3. Supplement with linked decisions: `GET /api/decisions?entity_slug=<slug>`
4. If entity not found, say so explicitly. Do not hallucinate entity information.
