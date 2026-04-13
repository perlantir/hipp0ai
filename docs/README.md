# Hipp0 Documentation

Every documentation page, grouped by what you're trying to do. New users should start with [Getting Started](getting-started.md); operators should start with [Self-Hosting](self-hosting.md); developers integrating Hipp0 into an agent should start with a [Framework Guide](framework-guides/) and the [API Reference](api-reference.md).

---

## Getting Started

| Document | One-line description |
|---|---|
| [Getting Started](getting-started.md) | Install, spin up your first project, record a decision, run a compile. |
| [Quickstart](quickstart.md) | A shorter five-minute walkthrough for people in a hurry. |
| [CLI](cli.md) | `hipp0 init`, `compile`, `record`, `import`, `migrate`, and friends. |
| [Dashboard](dashboard.md) | Tour of the web dashboard, onboarding checklist, live events, and exports. |
| [Playground](playground.md) | Ephemeral sandboxed demo at hipp0.ai/playground. |
| [Comparison](comparison.md) | How Hipp0 compares to Mem0, Zep, LangMem, and naive RAG. |

---

## Framework Guides

Copy-paste-ready integrations for every supported framework. All of these live under [framework-guides/](framework-guides/).

| Document | One-line description |
|---|---|
| [CrewAI](framework-guides/crewai.md) | `Hipp0CrewCallback`, task callbacks, per-agent memory injection. |
| [LangGraph](framework-guides/langgraph.md) | `Hipp0Checkpointer` and `inject_hipp0_context` for stateful graphs. |
| [LangChain](framework-guides/langchain.md) | Memory and retriever wrappers for chains. |
| [AutoGen](framework-guides/autogen.md) | Memory adapter for `GroupChat` and multi-agent orchestration. |
| [OpenAI Agents](framework-guides/openai-agents.md) | `Hipp0AgentHooks` for the OpenAI Agents SDK. |

---

## API Reference

| Document | One-line description |
|---|---|
| [API Reference](api-reference.md) | REST API: projects, decisions, compile, distill, feedback, simulation, connectors, WebSocket, etc. |
| [OpenAPI Spec](openapi.json) | Machine-readable OpenAPI 3 document for the API. |
| [TypeScript SDK](sdk.md) | `@hipp0/sdk` method reference. |
| [Python SDK](python-sdk.md) | `hipp0-memory` method reference. |
| [MCP Setup](mcp-setup.md) | Wire Hipp0 into Claude Desktop, Cursor, Windsurf, or any MCP client. |
| [GitHub Integration](github-integration.md) | Scan PRs, extract decisions, persistent webhook sync. |
| [Webhooks](webhooks.md) | Outbound webhook events and payload shapes. |

---

## Core Concepts

| Document | One-line description |
|---|---|
| [Architecture](architecture.md) | End-to-end system design, component internals, data flow. |
| [H0C Format](h0c-format.md) | 8-10x and 20-33x token-compressed context format. |
| [Storage](storage.md) | Postgres + pgvector schema and SQLite parity. |
| [Distillery](distillery.md) | LLM-powered decision extraction pipeline. |
| [Super Brain](super-brain.md) | Multi-step session memory and orchestrator mode. |
| [Agent Protocol](agent-protocol.md) | PROCEED / SKIP / OVERRIDE_TO / ASK_FOR_CLARIFICATION. |
| [Agent Wings](agent-wings.md) | Agent role templates and wing affinity learning. |
| [Namespaces](namespaces.md) | Domain scoping for multi-team projects. |
| [Context Survival](context-survival.md) | How decisions stay relevant across compactions. |
| [Temporal Intelligence](temporal-intelligence.md) | Freshness weighting and confidence decay. |
| [Time Travel](time-travel.md) | Point-in-time reads of the decision graph. |
| [Evolution](evolution.md) | Graph-level decision evolution detection. |
| [Outcomes](outcomes.md) | Tracking decision outcomes and feeding scores back. |
| [Passive Capture](passive-capture.md) | Auto-extract from agent conversations via `/api/capture`. |
| [Policies](policies.md) | Enforce rules on decisions with block/warn actions. |
| [Review Queue](review-queue.md) | Approve or reject pending decisions before they go live. |
| [Collab Rooms](collab-rooms.md) | Real-time shared editing rooms for human curators. |
| [Community Insights](community-insights.md) | Cross-project pattern sharing and opt-in network effects. |
| [Pattern Recommendations](pattern-recommendations.md) | How recommended patterns are selected for a compile. |
| [Weekly Digest](weekly-digest.md) | Email/Slack digest pipeline. |
| [Cascade Alerts](cascade-alerts.md) | Propagation alerts when upstream decisions change. |

---

## Deployment & Operations

| Document | One-line description |
|---|---|
| [Self-Hosting](self-hosting.md) | Docker, Caddy/nginx reverse proxy, TLS, backups, scaling. |
| [Authentication](authentication.md) | Supabase auth, API keys, per-agent keys, RLS. |
| [Background Workers](background-workers.md) | Scheduled reflection worker, BullMQ, cron-style jobs. |
| [Observability](observability.md) | OpenTelemetry spans, metrics, dashboards, alerts. |
| [Benchmarks](benchmarks.md) | How to run the benchmark suite and interpret results. |
| [Migration](MIGRATION.md) | Upgrading between Hipp0 versions and schema changes. |

---

## Troubleshooting

| Document | One-line description |
|---|---|
| [Troubleshooting](troubleshooting.md) | Real errors with root cause + fix, organized by category. |
| [TROUBLESHOOTING (legacy)](TROUBLESHOOTING.md) | Older troubleshooting notes, kept for link stability. |

---

## Contributing & Community

See the repo root for contributor-facing docs:

- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — how to open issues, PRs, and run the test suite.
- [`CODE_OF_CONDUCT.md`](../CODE_OF_CONDUCT.md) — community guidelines.
- [`SECURITY.md`](../SECURITY.md) — how to report vulnerabilities.
- [`CLAUDE.md`](../CLAUDE.md) — instructions for AI coding agents working on this repo.
