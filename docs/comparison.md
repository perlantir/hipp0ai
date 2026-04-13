# How Hipp0 Compares

A detailed comparison of Hipp0 against other AI memory systems: Mem0, Supermemory, Zep, and LangMem. For the summary table, see the [README](../README.md#how-hipp0-compares).

> Comparison based on publicly available documentation as of April 2026. Features may have changed. We encourage you to verify against each project's latest docs.

---

## Architecture: Decision Graph vs Embedding Store

Most AI memory systems follow the same pattern: store conversation chunks, generate embeddings, and retrieve by cosine similarity. This is fast to implement but treats memory as a flat vector space — every query gets back the "most similar" text regardless of who is asking or why.

Hipp0 takes a fundamentally different approach. Instead of storing raw conversations, it stores **structured decisions** — records of what was decided, why, by whom, with what confidence, and how they connect to other decisions via typed edges (`requires`, `contradicts`, `supersedes`, `relates_to`). This forms a **decision graph**, not an embedding store.

| Aspect | Hipp0 | Mem0 / LangMem / Supermemory | Zep |
|--------|-------|------------------------------|-----|
| Storage model | Decision graph with typed edges | Flat embedding store | Temporal knowledge graph |
| Unit of memory | Structured decision | Chat message / extracted fact | Conversation + entity relationships |
| Relationships | Explicit edges (requires, contradicts, supersedes) | None (similarity only) | Entity relationships via graph |
| Query model | 5-signal scored compilation | Nearest-neighbor embedding search | Graph traversal + embedding |

Supermemory provides a developer-focused memory API with container-based isolation, but the underlying storage model remains embedding-based without the typed edge relationships that enable Hipp0's contradiction detection and dependency cascades.

Zep's temporal knowledge graph is the closest to Hipp0's approach — it does model relationships between entities and understands time. However, it focuses on user/entity relationships rather than team-level decision tracking with role-differentiated retrieval.

---

## Scoring: 5 Signals vs Cosine Similarity

When you ask most memory systems "what's relevant?", they compute `cosine_similarity(query_embedding, memory_embedding)` and return the top-k results. This works well for single-agent chatbots but produces identical results for every agent.

Hipp0's scoring engine combines five signals:

1. **directAffect** — does this decision directly impact the current task?
2. **tagMatch** — do the decision's tags overlap with the query context? (exact, substring, and stemmed matching)
3. **personaMatch** — does the decision align with the requesting agent's role and domain?
4. **semanticSimilarity** — embedding-based similarity (the only signal most systems use)
5. **temporal** — is this decision fresh, stale, or expired? Exponential decay with configurable half-lives

Each agent can have different signal weights, and wing affinity learning adjusts these weights based on relevance feedback. The result: a security agent and a frontend agent asking about the same codebase get completely different, role-appropriate context.

Zep uses two retrieval signals (graph relationships and embedding similarity), which is more than pure embedding systems but fewer than Hipp0's five. Supermemory and Mem0 rely on embedding similarity alone.

---

## Multi-Agent Support

This is where the differences are starkest.

| System | Multi-agent support | How it works |
|--------|-------------------|--------------|
| **Hipp0** | Full role differentiation | Each agent has a persona, wing assignment, and per-signal weights. Context compilation produces different ranked results per agent. Benchmark-proven: 100% differentiation score vs 0% for naive RAG. |
| **Mem0** | Basic user/session scoping | Memory can be scoped to a `user_id`, but all queries against that scope return the same results regardless of who is asking. No role-based ranking. |
| **Supermemory** | None | Single-user memory system with container-based isolation. No agent-role differentiation in retrieval. |
| **Zep** | Basic user scoping | User-level memory with entity relationships. No agent-role differentiation in retrieval. |
| **LangMem** | None | Single-agent memory persistence across sessions. No multi-agent coordination. |

Hipp0's **Super Brain** adds cross-agent session memory: Agent B can see Agent A's actual output from earlier in the same workflow, with structured decision protocol signals (`PROCEED`, `OVERRIDE_TO`, `ASK_FOR_CLARIFICATION`).

---

## Compression Formats

Token efficiency matters when you're compiling context for LLM calls. Every token in the context window costs money and competes with the actual task prompt.

| System | Format | Compression | Details |
|--------|--------|-------------|---------|
| **Hipp0** | H0C (Hipp0 Compressed) | 10-12x (production) | Custom binary-inspired format. Encodes decisions with single-char field markers, pipe delimiters, severity flags. Lossless for decision content. See [H0C format spec](h0c-format.md). |
| **Supermemory** | None | 1x (raw) | Returns memories as plain text or JSON. |
| **Mem0** | None | 1x (raw) | Returns memories as plain text. Claims 90% token reduction vs full conversation replay, but that compares against including entire chat history — not against structured compression. |
| **Zep** | None | 1x (raw) | Returns assembled context as plain text. |
| **LangMem** | None | 1x (raw) | Returns memories as plain text. |

H0C compression example:

```
D|auth-jwt|high|backend|Use JWT for stateless API auth|T:auth,security|C:0.95
D|refresh-rotate|high|backend|Implement refresh token rotation|T:auth,tokens|R:auth-jwt
```

vs equivalent JSON at ~10x the token count.

---

## Self-Hosting

| System | Self-hosted | Details |
|--------|------------|---------|
| **Hipp0** | ✅ Fully self-hosted, free forever | Docker Compose with PostgreSQL + pgvector. No usage limits, no cloud dependency. Apache 2.0. |
| **Mem0** | ❌ Cloud only | Primary offering is the managed cloud platform at app.mem0.ai. Open-source version previously available but cloud is the focus. |
| **Supermemory** | ⚠️ Partial | Some self-hosting options available but the primary offering is the managed API. |
| **Zep** | ✅ Self-hosted available | Open-source with Docker deployment. MIT license. Cloud option also available. |
| **LangMem** | ✅ Self-hosted | Runs against your own storage backends. MIT license. |

---

## Autonomous Evolution

Hipp0's evolution engine proactively surfaces problems before they cause failures. It analyzes decision patterns — staleness, contradictions, low confidence, missing coverage — and generates improvement proposals. The engine operates in two modes:

- **Rule-based** (default, no LLM cost): Pattern matching against configurable thresholds for staleness, contradiction density, confidence gaps, and coverage holes.
- **LLM-enhanced** (optional): Uses Claude to generate natural-language proposals with deeper reasoning about why a decision needs attention.

No other system in this comparison offers autonomous self-improvement. Mem0, Supermemory, Zep, and LangMem store memories passively — they grow but never self-correct.

---

## Cross-Project Pattern Learning

Hipp0's pattern library captures proven approaches that work across projects. When the evolution engine or manual curation identifies a decision pattern that succeeds repeatedly (e.g., "JWT refresh token rotation with sliding window"), it can be saved as a reusable pattern and recommended to new projects facing similar decisions.

This is distinct from Supermemory's container isolation, which keeps memories separated. Hipp0's namespace isolation keeps project data separated while still enabling opt-in cross-project pattern sharing.

---

## Namespace Isolation

| System | Isolation model | Details |
|--------|----------------|---------|
| **Hipp0** | Multi-scope namespaces | Project-level, team-level, and agent-level scoping. Decisions can be scoped to specific namespaces while patterns can be shared across them. |
| **Mem0** | User/session scoping | Basic scoping by user_id or session_id. |
| **Supermemory** | Containers | Container-based memory isolation. Clean separation but no cross-container pattern sharing. |
| **Zep** | User-level | Scoped to individual users. |
| **LangMem** | None | Single namespace per deployment. |

---

## When to Use Alternatives

We believe in being honest about trade-offs. Hipp0 is not the right choice for every use case.

**Use Mem0 if:**
- You have a single-agent chatbot that needs to remember user preferences across sessions
- You want the simplest possible integration (pip install + 3 lines of code)
- You need a managed cloud service with minimal operational overhead
- Your memory needs are limited to "remember what the user said"

**Use Supermemory if:**
- You want a developer-friendly memory API with container-based isolation
- You need built-in smart forgetting without managing temporal scopes yourself
- You prefer a managed service with a clean REST API
- You don't need multi-agent role differentiation

**Use Zep if:**
- You need entity-relationship modeling (e.g., "user X works at company Y")
- You want temporal awareness without building a full decision graph
- You prefer a self-hosted option with enterprise compliance capabilities

**Use LangMem if:**
- You're already deep in the LangChain/LangGraph ecosystem
- You need basic memory persistence for a single agent
- You want MIT-licensed simplicity

**Use Hipp0 if:**
- You have multi-agent teams that need different context for the same task
- You're tracking decisions (architectural choices, policy changes, design rationale) — not just conversations
- You need contradiction detection, temporal intelligence, and self-improving retrieval
- You want full control with self-hosted deployment and no usage limits
- You need structured cross-agent session memory (Super Brain)
- You want autonomous evolution that surfaces problems before they cause failures
- You need cross-project pattern learning to share proven approaches

The core question is: **are you building a chatbot with memory, or an agent team with shared intelligence?** For the former, simpler tools may be a better fit. For the latter, Hipp0 was built specifically for that problem.

---

## Links

- [Mem0](https://mem0.ai) — [GitHub](https://github.com/mem0ai/mem0) — [Docs](https://docs.mem0.ai)
- [Supermemory](https://supermemory.ai) — [Docs](https://docs.supermemory.ai)
- [Zep](https://getzep.com) — [GitHub](https://github.com/getzep/zep) — [Docs](https://help.getzep.com)
- [LangMem](https://github.com/langchain-ai/langmem) — [Docs](https://langchain-ai.github.io/langmem/)
