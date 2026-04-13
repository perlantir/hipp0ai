# Python SDK

`hipp0-sdk` is the official Python client for Hipp0. It wraps the REST API with a clean interface for the most common agent workflows.

> **Pre-release:** `hipp0-sdk` is not yet published to PyPI. Install locally from the repo while the package is in pre-release.

---

## Installation

### From the Hipp0 repo (current)

```bash
cd /path/to/hipp0/python-sdk
pip install -e .
```

### From PyPI (coming soon)

```bash
pip install hipp0-sdk
```

---

## Initialization

```python
from hipp0_sdk import Hipp0Client

hipp0 = Hipp0Client(
    base_url="http://localhost:3100",
    api_key="your-api-key",
    project_id="your-project-id",
)
```

---

## Core Methods

### `compile(options)` — Get context for an agent

```python
context = hipp0.compile(
    agent_name="builder",
    task_description="implement the payment service",
)

# context.decisions — ranked list of relevant past decisions
# context.recommended_action — PROCEED | SKIP | OVERRIDE_TO | ...
# context.action_reason — why
# context.formatted_markdown — ready-to-inject context block
```

**With session memory:**

```python
context = hipp0.compile(
    agent_name="reviewer",
    task_description="review the payment service",
    task_session_id=session_id,
)
```

**With namespace filtering:**

```python
context = hipp0.compile(
    agent_name="security",
    task_description="audit the auth flow",
    namespace="auth",
)
```

---

### `record_decision(decision)` — Save a decision

```python
hipp0.record_decision(
    title="Use JWT for API auth",
    description="All API endpoints use Bearer token authentication via JWT.",
    reasoning="Stateless, scales horizontally, works with any client.",
    made_by="architect",
    affects=["builder", "reviewer", "security"],
    tags=["auth", "api", "security"],
    confidence="high",
    alternatives_considered=[
        {"option": "Session cookies", "rejected_reason": "Requires sticky sessions"}
    ],
)
```

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `title` | str | Yes | Short description of the decision |
| `description` | str | Yes | What was decided |
| `reasoning` | str | No | Why this decision was made |
| `made_by` | str | Yes | Agent or human name |
| `affects` | list[str] | No | Agent or component names impacted |
| `tags` | list[str] | No | Domain taxonomy labels |
| `confidence` | str | No | `'high'`, `'medium'`, or `'low'` |
| `namespace` | str | No | Domain scope |
| `alternatives_considered` | list[dict] | No | Rejected options with reasons |
| `status` | str | No | `'pending'` puts it in the review queue |

---

### `search_decisions(query)` — Semantic search

```python
results = hipp0.search_decisions(
    query="authentication token strategy",
    limit=10,
)

for decision in results.decisions:
    print(decision.title, decision.combined_score)
```

---

### `create_session(options)` — Start a task session

```python
session = hipp0.create_session(
    task="implement user authentication",
    agents=["architect", "builder", "reviewer"],
)
# session.id — use as task_session_id in compile calls
```

---

### `record_step(session_id, step)` — Record an agent step

```python
hipp0.record_step(
    session_id=session.id,
    agent_name="architect",
    task="design the auth system",
    output="Decided on JWT with 15-min access tokens and 7-day refresh tokens.",
    status="complete",
    decisions_made=[decision_id],
)
```

---

### `save_before_trim(options)` — Checkpoint before context trim

```python
hipp0.save_before_trim(
    session_id=session.id,
    agent_name="builder",
    context_summary="We chose JWT for auth, PostgreSQL for storage.",
    important_decisions=[auth_decision_id],
)
```

See [docs/context-survival.md](context-survival.md).

---

### `submit_feedback(compile_id, feedback)` — Rate compiled context

```python
hipp0.submit_feedback(
    compile_id=context.compile_id,
    decision_id="decision-uuid",
    rating="useful",  # 'critical' | 'useful' | 'irrelevant'
)
```

---

## H0C Format

For token-constrained agents:

```python
context = hipp0.compile(
    agent_name="builder",
    task_description="implement refresh token rotation",
    format="h0c",
)
# context.h0c — compact string, 10-12x token reduction vs JSON
```

---

## Using with LangChain

```python
from hipp0_sdk import Hipp0Client
from langchain_core.tools import tool

hipp0 = Hipp0Client(
    base_url="http://localhost:3100",
    api_key="your-api-key",
    project_id="your-project-id",
)

@tool
def get_decision_context(task: str) -> str:
    """Get relevant past decisions for a task."""
    context = hipp0.compile(agent_name="agent", task_description=task)
    return context.formatted_markdown

@tool
def record_decision(title: str, description: str, reasoning: str) -> str:
    """Record a decision made during this task."""
    hipp0.record_decision(
        title=title,
        description=description,
        reasoning=reasoning,
        made_by="agent",
        confidence="medium",
    )
    return f"Decision recorded: {title}"
```

See [docs/framework-guides/langchain.md](framework-guides/langchain.md) for a full LangChain integration guide.

---

## Using with CrewAI

```python
from crewai_tools import BaseTool
from hipp0_sdk import Hipp0Client

hipp0 = Hipp0Client(
    base_url="http://localhost:3100",
    api_key="your-api-key",
    project_id="your-project-id",
)

class Hipp0ContextTool(BaseTool):
    name: str = "get_decision_context"
    description: str = "Get relevant past decisions before starting work."

    def _run(self, task: str) -> str:
        context = hipp0.compile(agent_name="crewai-agent", task_description=task)
        return context.formatted_markdown
```

See [docs/framework-guides/crewai.md](framework-guides/crewai.md) for the full CrewAI guide.

---

## Error Handling

```python
from hipp0_sdk.exceptions import Hipp0Error, Hipp0AuthError, Hipp0NotFoundError

try:
    context = hipp0.compile(agent_name="builder", task_description="...")
except Hipp0AuthError:
    # Invalid or missing API key
    pass
except Hipp0NotFoundError:
    # Project or agent not found
    pass
except Hipp0Error as e:
    print(e.status, e.message)
```

---

## Related Docs

- [TypeScript SDK](sdk.md)
- [MCP Setup](mcp-setup.md)
- [CLI](cli.md)
- [Framework Guides](framework-guides/) — LangChain, CrewAI, AutoGen, OpenAI Agents
- [API Reference](api-reference.md)
