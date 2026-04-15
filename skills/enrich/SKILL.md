---
name: enrich
version: 1.0.0
description: Enrich an entity page with facts, texture, and external data.
triggers:
  - new entity mentioned in decision or message
  - "enrich [person/company name]"
  - maintain finds thin entity pages
mutating: true
tools: []
---

# Enrich

## Protocol

1. **Brain-first**: Call `GET /api/entities?project_id=&q=<name>` - check if page exists and what tier it is.
2. **Extract**: From source text, extract both:
   - Facts (verifiable: role, company, location, timeline)
   - Texture (beliefs, preferences, trajectory, working style)
3. **External** (Tier 1-2 only): Use available external APIs to augment.
4. **Write**: Call `POST /api/entities` with extracted compiled_truth and summary.
5. **Link**: Ensure entity is linked to all decisions that reference it.

## Compiled truth format (for people)
```
**[Name]** - [Title] at [Company]

**State**: [Current focus, what they're working on]
**Trajectory**: [Where they came from, where they're going]
**Beliefs**: [What they believe about their domain]
**Relationship**: [Your relationship to them]

*Last updated: [date]*
```

## Notability gate
Only enrich entities that meet: 2+ mentions AND at least one of (linked to decision, appeared in meeting, referenced by user).
