# Hipp0 — Product North Star

**This document is the permanent reference for every product decision on Hipp0.** If a feature, commit, or scope change conflicts with what's below, the document wins, not the commit. Re-read this before any major decision.

---

## One-sentence definition

**Hipp0 is the shared memory layer that captures what every agent on a team does, distills it into small self-contained snippets, and delivers the right snippet to the right agent at the exact moment they need it — so agents never lose context and users never have to repeat themselves.**

---

## The non-negotiables (the founder's own words)

These five rules are locked. Every phase of the build is judged against them.

1. **Snippet quality better than any competitor.** The core value is the quality of the distilled memory and how well it's retrieved and delivered. If snippets are mediocre, the product is mediocre. Snippet quality is ruthlessly prioritized over feature breadth.

2. **Apple-simple install — one command, zero questions.** Setup takes under two minutes from "I want to try this" to "I'm seeing my own data in the dashboard." Any friction point that adds a question the user has to answer manually is a bug.

3. **If we can't do it great, we don't do it.** Feature breadth is explicitly the enemy. Every capability we ship is best-in-class. Every feature that can't hit that bar gets cut, hidden behind a Labs flag, or deferred entirely.

4. **Cross-agent context bridging is the core magic.** When one agent learns something, every other agent who needs it gets it — automatically, without the user repeating themselves and without the agent having to ask. If a user tells the design agent "I want a minimalist homepage with a split-screen hero," later when the same user asks the development agent to build a homepage, the development agent already knows about the split-screen hero. This is the marquee feature and the single biggest differentiator.

5. **Insanely simple to use, insanely performant.** The product has to work like an iPhone: obvious, fast, forgiving. A non-technical person who already uses other AI tools should be able to install and use Hipp0 without reading documentation. Every interaction is sub-second where possible.

---

## The "own your core" principle

Hipp0 does not depend on any other AI infrastructure product for its core functionality.

**Locked decisions:**

- **No Mem0, no Zep, no Letta, no Supermemory as dependencies.** These are competitors in the same category. Building on them would cap our quality at their ceiling, put our roadmap at their mercy, and tell the market we're a wrapper.
- **No LangGraph, no CrewAI, no AutoGen as foundations.** These are orchestration frameworks that serve a minority of the agent market. We ship integrations with them (adapters in `integrations/`) but Hipp0 core does not depend on any of them.
- **Commodity infrastructure is fine.** PostgreSQL + pgvector for storage, OpenAI/Anthropic/Cohere for embeddings and distillation LLM calls, Docker for packaging. These are compute utilities, not competitors.

**The test for any new dependency**: if the vendor disappeared tomorrow, could Hipp0 still ship its core promise? If no, don't add the dependency.

---

## Target user

**Day-one user**: a developer or technical founder running 3 or more AI agents across one or more agent tools (Claude Code, Cursor, OpenClaw, Aider, CrewAI, custom SDK-built agents). They feel the pain of repeating themselves and watching agents contradict each other. They're technical enough to run a Docker command. They're not necessarily framework-savvy — the wizard handles that.

**Day-thirty user**: the same person, plus anyone on their team who uses AI tools. They visit the Hipp0 dashboard to see what the team has decided, find contradictions, and compile context for tasks. They don't install anything — the first person did.

**Not the target (yet)**:
- Non-technical users who have never installed anything
- Enterprise teams with compliance requirements
- Hosted SaaS customers (v2 problem)
- Solo chatbot developers (Mem0/Zep serves them well)

---

## Anti-goals (what we explicitly don't build)

These are decisions, not oversights. Do not add them back without updating this doc first.

- **No multi-tenancy or team-of-humans features in v1.** One user, their agents, their instance. Team features wait for v2.
- **No pricing, billing, subscriptions.** Open source / self-hosted only.
- **No native mobile apps.** PWA only. iOS and Android compiled apps are v2+.
- **No generic "AI observability" dashboards** (token counts, latency graphs, cost charts as the primary surface). We're not Langfuse. We might show some of this in Settings → LLM but it's never a main view.
- **No agent-building features.** We don't help users build agents. We help agents they already have work together. If a user doesn't have agents, we point them at Claude Code / Cursor / CrewAI.
- **No workflow orchestration.** We don't tell agents what to do next. LangGraph and CrewAI do that. We're the memory layer underneath, not the orchestrator above.
- **No decision graph visualization as a primary feature.** The current graph view is pretty but not load-bearing. Simple lists + search beat pretty graphs at the "do this well" bar.
- **No governance / approval / policy / compliance features.** Enterprise stuff, v2+.
- **No A/B experiments, what-if simulators, knowledge branches, community patterns as primary surfaces.** They stay in code behind a Labs flag. Maybe they matter in v2.
- **No agent evaluation leaderboards, scorecards, or "HR" features.** Interesting category, not our positioning.
- **No real-time multi-user editing of the dashboard.** Over-engineered for day one.

---

## The single metric that matters

If we have to pick one measurement to judge the product, it's:

**"When a user asks an agent to do something, does that agent already know everything the team has learned that's relevant, without the user having to repeat or reference it?"**

If yes → product is working.
If no → product has failed its core promise.

Every phase of the build is in service of this metric.

---

## How to use this document

- **Before starting a new feature**: confirm it's in line with the non-negotiables and not in the anti-goals list.
- **When scope creep happens**: re-read section 5 (Insanely simple) and section 3 (If we can't do it great).
- **When tempted by a shortcut dependency**: re-read "own your core."
- **When the dashboard starts to feel busy again**: re-read the anti-goals list.
- **When making a roadmap decision**: ask "does this increase the chance the single metric improves?" If not, don't do it.

This doc is versioned in git at `docs/PRODUCT_NORTH_STAR.md`. Changes require an explicit commit with a clear rationale in the message. Don't edit casually.

**Last updated**: initial version, April 2026.
