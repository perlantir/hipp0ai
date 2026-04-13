# Dashboard

The Hipp0 dashboard is a React app running on port 3200. It gives you a full visual interface for your decision graph — exploring decisions, testing context compilation, managing agent sessions, reviewing imports, and monitoring system health.

Open it at: `http://localhost:3200` (or your server's IP after deployment)

Use `Ctrl+K` to open the command palette and jump to any view instantly.

---

## Where to Start

If you just deployed Hipp0 for the first time, go here in order:

1. **[Playground](#playground)** — see how the brain works before adding real data
2. **[Import Wizard](#import-wizard)** — pull in decisions from GitHub or a JSON file
3. **[Decision Graph](#decision-graph)** — visualize what you've imported
4. **[Compile Tester](#compile-tester)** — verify each agent gets the right context

---

## View Reference

### Main Views

#### Playground (`#playground`)
Interactive brain explorer. Pick an agent, type a task, see exactly which decisions are returned and why — including full scoring breakdowns. Two modes: Classic (direct compile) and Super Brain (multi-step session). See [docs/playground.md](playground.md).

#### Decision Graph (`#graph`)
D3 force-directed graph of all decisions, edges, and statuses. Nodes are decisions, edges show relationships (`requires`, `contradicts`, `supersedes`, etc.). Click any node to see decision details. Filter by tag, status, or namespace.

#### Timeline (`#timeline`)
Chronological list of all decisions with validation sources and status badges. Shows which decisions were manually created, auto-distilled, or imported from GitHub. Sort by date, confidence, or status.

#### Contradictions (`#contradictions`)
Lists all detected contradictions — pairs of decisions that conflict. Each row shows both decisions, the conflict type, and inline resolve/dismiss actions. New contradictions are automatically detected when decisions are created or updated.

#### Context Compare (`#context`)
Side-by-side context comparison for two agents on the same task. Highlights decisions that appear in one agent's context but not the other — useful for verifying role differentiation is working correctly.

#### Search (`#search`)
Full-text and semantic search across all decisions. Supports natural language queries. Results are ranked by relevance to your query using the same scoring pipeline as compile.

#### Impact Analysis (`#impact`)
Dependency chain visualization. Select a decision and see every other decision that depends on it, up to 5 levels deep. Shows what would be affected if this decision changed. Powered by the same BFS traversal as Cascade Alerts.

#### Sessions (`#sessions`)
Paginated history of all agent task sessions. Expand any session to see its steps, which agents participated, what decisions were made, and the session outcome.

#### Compile Tester (`#compile-tester`)
On-demand compile with full output — scored decisions, explanation text, recommended action, and team scores. Supports time-travel mode (compile as of a past date). Diff view compares two compiles side by side.

#### Review Queue (`#review-queue`)
Pending decisions inbox — decisions flagged for human review before becoming active. Shows source (auto-distilled, imported, or manually marked pending), confidence, and any deduplication flags. Approve, reject, or edit inline.

#### Ask Anything (`#ask-anything`)
Natural-language chat interface over your decision graph. Ask questions like "Why did we choose PostgreSQL?" or "What auth decisions have we made?" Powered by the Distillery's `/api/distill/ask` endpoint.

#### Evolution (`#evolution`)
AI-generated improvement proposals for underperforming decisions — stale, low-signal, contradicted, or orphaned. Apply, dismiss, or defer each proposal. See [docs/evolution.md](evolution.md).

#### What-If (`#whatif`)
Hypothetical decision modification with live score preview. Change a decision's fields and see how it would affect its compile ranking — without actually saving the change. Useful for tuning decisions before committing.

#### Live Tasks (`#live-tasks`)
Real-time active session dashboard. Shows currently running agent sessions with status, current step, and elapsed time. Pause or resume sessions from here.

#### Team Score (`#team-score`)
Agent relevance leaderboard for a given task. Shows which agents are most relevant, in what order, and why. This is the view of what Orchestrator mode uses to generate routing suggestions.

#### Collab Room (`#collab-room`)
Real-time multi-agent collaboration room with WebSocket messaging. Supports presence tracking, typing indicators, and `@mention` autocomplete. Agents from any platform (Claude, OpenClaw, CrewAI, custom) can join the same room.

#### Wings (`#wings`)
Agent wing visualization with cross-wing affinity graph. Shows which agents are grouped together, their affinity scores, and how feedback has shifted weights over time. See [docs/agent-wings.md](agent-wings.md).

---

### Integration Views

#### Import (`#import`)
Drag-and-drop bulk import from JSON or CSV. Preview decisions before committing. Detects and flags near-duplicates against your existing graph.

#### Import Wizard (`#import-wizard`)
5-phase guided import from GitHub or files. For GitHub: connect via Octokit, scan merged PRs, extract decisions via the Distillery, preview, and commit. Includes a permanent sync setup wizard for webhook-driven continuous import. See [docs/github-integration.md](github-integration.md).

#### Connectors (`#connectors`)
Manage external data source connections — databases, folders, webhooks, Git repositories. Configure what Hipp0 monitors for automatic decision extraction.

#### Webhooks (`#webhooks`)
Create and manage outbound webhooks. Configure event types, delivery targets, signing secrets, and retry behavior. Test-send from the UI before going live. See [docs/webhooks.md](webhooks.md).

#### Time Travel (`#timetravel`)
Historical compile browsing. Select any past date and see what any agent's compiled context looked like at that point. Diff view shows what changed between two snapshots. See [docs/time-travel.md](time-travel.md).

---

### Monitoring Views

#### Token Usage (`#token-usage`)
Daily decision and compile activity charts with trend visualization. Shows how actively the graph is being used over time.

#### Alerts (`#notifications`)
System notification feed — cascade alerts, contradiction detections, policy violations, staleness warnings. Mark as read individually or in bulk.

#### Health (`#stats`)
Project health overview with monitoring cards: total decisions, active agents, compile latency, contradiction count, stale decision count. Alert feed for recent issues.

#### Outcomes (`#outcomes`)
Task outcome tracking linked to compiled decisions. Record the result of a task, link it to the decisions that were compiled for it, and track which decisions led to good vs poor outcomes over time. See [docs/outcomes.md](outcomes.md).

#### Weekly Digest (`#digest`)
Aggregated weekly health report. Covers new decisions, resolved contradictions, stale decision counts, and evolution proposals generated. See [docs/weekly-digest.md](weekly-digest.md).

#### Policies (`#policies`)
Governance policy management — create block/warn rules, enable/disable policies, see violation counts. See [docs/policies.md](policies.md).

#### Violations (`#violations`)
Policy violation log with severity, evidence, and resolution status. Resolve violations inline with a note.

---

### Settings Views

#### Pricing (`#pricing`)
Subscription plan comparison — Free, Pro, Enterprise. Feature limits and pricing per tier.

#### Billing (`#billing`)
Subscription status, usage counters (compiles, asks, decisions against plan limits), and invoice history via Stripe customer portal.

---

## Keyboard Shortcuts

Press `?` anywhere in the dashboard to see all keyboard shortcuts.

Key shortcuts:
- `Ctrl+K` — open command palette, jump to any view
- `G` then `H` — go to Health
- `G` then `T` — go to Timeline
- `G` then `P` — go to Playground
- `G` then `R` — go to Review Queue
- `/` — focus search

---

## Related Docs

- [Playground](playground.md) — detailed guide to the Playground view
- [Evolution Engine](evolution.md) — how improvement proposals work
- [Policies](policies.md) — governance and violation tracking
- [Time Travel](time-travel.md) — historical graph state
