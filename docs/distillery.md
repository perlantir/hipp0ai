# Distillery

The Distillery is Hipp0's LLM-powered extraction pipeline. It takes raw text — conversation transcripts, GitHub PR descriptions, meeting notes, any unstructured input — and extracts structured decisions that go directly into your decision graph.

Instead of manually recording every decision, you feed the Distillery a conversation and it does the work: identifying what was decided, who decided it, why, what alternatives were rejected, and which agents are affected.

---

## What It Produces

For each piece of text, the Distillery extracts:

- **Title** — short description of what was decided
- **Description** — what the decision is
- **Reasoning** — why this decision was made
- **Made by** — which agent or person made it
- **Tags** — domain labels (auth, security, infrastructure, etc.)
- **Affects** — which agents or components are impacted
- **Confidence** — `low` (all auto-extracted decisions start here, pending human review)
- **Alternatives considered** — what was rejected and why, if mentioned

Extracted decisions are marked `source: 'auto_distilled'` and `confidence: 'low'`. They enter the review queue for human approval before becoming active in the graph. See [docs/review-queue.md](review-queue.md).

---

## Three Entry Points

### 1. Passive Capture API

Submit a raw conversation transcript and get decisions extracted asynchronously.

```bash
POST /api/capture
{
  "agent_name": "architect",
  "project_id": "your-project-id",
  "conversation": "Full conversation text...",
  "source": "openclaw"
}
```

Returns immediately with a `capture_id`. Check status:

```bash
GET /api/capture/:capture_id
```

Full reference: [docs/passive-capture.md](passive-capture.md)

### 2. GitHub Import Wizard

The Import Wizard connects to GitHub via Octokit, scans merged PRs, and runs each PR through the Distillery pipeline. PR titles, descriptions, labels, reviewers, and file paths are all inputs to extraction.

Supports:
- One-time import with preview before committing
- Permanent webhook-driven sync (decisions extracted automatically on each merged PR)

Full guide: [docs/github-integration.md](github-integration.md)

### 3. Ask Anything / Distill Ask

The `POST /api/distill/ask` endpoint powers the Ask Anything dashboard view. It runs natural-language queries over your full decision graph, using the Distillery's LLM pipeline to synthesize answers from matching decisions.

```bash
POST /api/distill/ask
{
  "question": "Why did we choose PostgreSQL over MongoDB?",
  "project_id": "your-project-id"
}
```

---

## Model Configuration

The Distillery uses Claude (Anthropic) by default. Requires `ANTHROPIC_API_KEY` in your environment.

You can override the model:

```bash
# In .env
HIPP0_LLM_MODEL=claude-opus-4-6
DISTILLERY_PROVIDER=anthropic
```

If you want to use OpenRouter (recommended for flexibility):

```bash
OPENROUTER_API_KEY=sk-or-v1-...
DISTILLERY_PROVIDER=openrouter
HIPP0_LLM_MODEL=anthropic/claude-haiku-4-5
```

OpenRouter gives access to 200+ models through a single key. The Distillery works with any model that handles structured JSON output reliably.

---

## Deduplication

Before adding extracted decisions to the graph, the Distillery checks for near-duplicates using a combination of:
- Title similarity
- Tag overlap
- Semantic embedding comparison

If a near-duplicate is found, the new decision is flagged for review with a note indicating the potential overlap. You can merge, keep both, or discard.

---

## Contradiction Detection

As part of extraction, the Distillery runs each new decision against the existing graph for contradictions. If a conflict is detected (e.g., one decision says "use JWT" and another says "use session cookies"), both are flagged and a notification goes to governor-role agents.

Contradiction F1: 0.92 — see [docs/benchmarks.md](benchmarks.md) for methodology.

---

## Enabling Auto-Capture

Auto-capture runs the Distillery automatically on conversation submissions. Disabled by default.

```bash
PATCH /api/projects/:id/settings
{ "auto_capture": true }
```

When enabled, any conversation submitted to `POST /api/capture` triggers extraction without requiring a manual call. Useful when integrating Hipp0 with agent frameworks that log conversations automatically.

---

## Session Summarization

At the end of a task session, the Distillery can generate a summary of decisions made during that session:

```bash
POST /api/tasks/sessions/:id/summarize
```

Returns a structured summary with key decisions, outcome, and any open questions — useful for audit trails and handoff documentation.

---

## What Requires an LLM Key

| Feature | Requires LLM |
|---------|-------------|
| Passive capture / auto-extraction | Yes |
| GitHub PR decision extraction | Yes |
| Ask Anything (`/api/distill/ask`) | Yes |
| Semantic embeddings (smarter ranking) | Yes (OpenAI key) |
| Core compile (without semantic signals) | No |
| Review queue, webhooks, cascade alerts | No |

Hipp0 works without any API key. The LLM-powered features are opt-in.

---

## Related Docs

- [Passive Capture](passive-capture.md) — API reference for conversation submission
- [GitHub Integration](github-integration.md) — PR scanning and permanent sync
- [Review Queue](review-queue.md) — approving and rejecting extracted decisions
- [Pattern Recommendations](pattern-recommendations.md) — cross-project insights surfaced during compile
