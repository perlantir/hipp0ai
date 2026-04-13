# Playground

The Playground is the interactive dashboard view for exploring how Hipp0's brain works. Pick an agent, type a task, and see exactly which decisions are returned and why — including a full scoring breakdown for each result.

It's the fastest way to understand why an agent is getting certain context, tune your scoring parameters, and verify that your decision graph is behaving as expected.

Open it at: `http://localhost:3200/#playground`

---

## Two Modes

### Classic Mode

Direct compile — standard `POST /api/compile` with full scoring output. Use this when you want to:
- Test a specific agent + task combination
- See the raw scoring breakdown
- Verify a decision is showing up correctly
- Compare context across two agents for the same task

**How to use:**
1. Select an agent from the dropdown
2. Type a task description
3. Click **Compile**
4. Results appear with each decision ranked by combined score, a breakdown of all 5 signal scores, and a natural-language explanation of why each decision was included

You can adjust the score threshold slider to see what gets included vs excluded at different cutoffs.

### Super Brain Mode

Multi-step session exploration — simulates a full agent session from start to finish. Use this to:
- See how context accumulates across multiple agent steps
- Test orchestrator mode recommendations
- Verify session memory is working correctly
- Demo Hipp0 to new team members

**How to use:**
1. Select a starting agent
2. Choose one of the 4 built-in demo scenarios, or type a custom task
3. Click **Run Step**
4. See what the agent receives, then advance to the next agent
5. Watch how context evolves across steps — each agent's compiled context includes prior step outputs

**Built-in demo scenarios:**
- **Auth system design** — architect → builder → security reviewer → governor
- **Database migration** — PM → architect → builder → QA
- **API integration** — builder → reviewer → security
- **Multi-agent contradiction** — demonstrates contradiction detection across conflicting decisions

---

## Scoring Breakdown

For each decision in the results, the Playground shows:

| Signal | Weight | Score | Description |
|--------|--------|-------|-------------|
| Direct Affect | 0.30 | 0.0–1.0 | Does this decision directly affect the agent's domain? |
| Persona Match | 0.25 | 0.0–1.0 | How well does this decision align with the agent's role? |
| Semantic Similarity | 0.25 | 0.0–1.0 | Embedding cosine similarity between decision and task |
| Tag Match | 0.20 | 0.0–1.0 | Stemmed tag overlap between decision tags and task context |
| Temporal | tie-break | 0.0–1.0 | Freshness score — higher for recent, validated decisions |

**Combined score** = sum of (signal score × signal weight)

Tie-breaking on temporal means if two decisions have the same combined score, the fresher one ranks higher.

---

## Parameter Tuning

In Classic mode, you can adjust:

- **Score threshold** — minimum combined score to include a decision (default: 0.3)
- **Max decisions** — cap on how many results to return (default: 20)
- **Namespace filter** — limit results to a specific namespace
- **Format** — see results in JSON, Markdown, or H0C format

Changes apply immediately on the next compile. This is useful for finding the right threshold for your specific agent team and decision graph.

---

## Context Compare

Use the **Compare** tab to run two compiles side-by-side:
- Same task, two different agents
- Same agent, two different tasks
- Same agent + task, with and without a namespace filter

Diff view highlights which decisions appear in one but not the other, and shows score differences for decisions in both.

---

## Team Score View

The **Team Score** tab shows agent relevance rankings for a given task — which agents are most relevant, in what order, and why. This is what Orchestrator mode uses internally to generate routing suggestions.

Useful for:
- Verifying your agent roles are configured correctly
- Understanding why the orchestrator suggests a particular agent
- Finding agents with unexpected high/low relevance

---

## Related Docs

- [Super Brain](super-brain.md) — how the multi-step session works
- [Architecture](architecture.md) — how the 5-signal scoring pipeline works
- [Benchmarks](benchmarks.md) — reproducible scoring tests
- [H0C Format](h0c-format.md) — compact output format
