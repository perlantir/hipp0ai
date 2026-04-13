# OpenAI Agents + Hipp0

The OpenAI Agents SDK gives you a clean, minimal way to build agents around GPT-4o and friends. It has tools, handoffs, guardrails, and a tight `AgentHooks` protocol that lets you observe every lifecycle event. What it doesn't have is long-term memory — each run is a clean slate.

Hipp0 fills that gap. The `hipp0-openai-agents` package provides `Hipp0AgentHooks`, a drop-in lifecycle hook that captures decisions, injects past context into instructions, and logs every tool call as an artifact.

![OpenAI Agent decisions showing up in the dashboard](images/openai-agents-dashboard.png)

## What Hipp0 adds

OpenAI Agents lets you pass `hooks=` to any `Agent` or `Runner`. The hooks get called at `on_start`, `on_end`, `on_tool_call`, `on_tool_output`, and handoff events. Hipp0 uses these to:

1. **Inject past decisions as additional instructions.** Before the LLM runs, `on_start` calls `compile_context` and prepends the result to the agent's instructions. The agent sees "Previous Decisions" as part of its system prompt.
2. **Capture every completed run.** `on_end` ships the final output through the distillery. Decisions get extracted, scored, and stored.
3. **Log tool calls as artifacts.** `on_tool_call` and `on_tool_output` record every tool invocation. You can view these in the dashboard under Artifacts, or reference them from decisions.
4. **Track handoffs between agents.** When one agent hands off to another, Hipp0 records the handoff as a provenance edge so you can trace which agent made which decision.

All of this is automatic. You write your agent the same way you would without Hipp0 and add one parameter.

## Install

```bash
pip install hipp0-memory hipp0-openai-agents openai-agents
```

Bootstrap a project:

```bash
npm install -g @hipp0/cli
hipp0 init my-agent
cd my-agent
source .env
export OPENAI_API_KEY=sk-...
```

Version requirements:

- Python 3.10+
- openai-agents 0.0.12 or later
- hipp0-memory 0.4 or later

## Quick start

Here's an agent with tools, hooks, and a real task. It researches a topic, makes a decision, and the decision persists.

```python
"""
OpenAI Agents + Hipp0: Stateful Research Agent
"""
import os
import sys
import asyncio

from agents import Agent, Runner, function_tool
from hipp0_sdk import Hipp0Client
from hipp0_openai_agents import Hipp0AgentHooks


@function_tool
def search_web(query: str) -> str:
    """Search the web for information about a topic."""
    # In a real app this would call a real search API
    return f"[fake search results for: {query}]"


@function_tool
def check_pricing(service: str) -> str:
    """Check the monthly pricing for a cloud service."""
    prices = {
        "postgres": "$50/mo for 10GB",
        "clickhouse": "$150/mo for 100GB",
        "snowflake": "$300/mo minimum",
    }
    return prices.get(service.lower(), "Unknown service")


async def main():
    api_url = os.environ.get("HIPP0_API_URL", "http://localhost:3100")
    api_key = os.environ.get("HIPP0_API_KEY", "")
    project_id = os.environ.get("HIPP0_PROJECT_ID", "")

    if not project_id:
        print("Error: HIPP0_PROJECT_ID not set")
        sys.exit(1)

    client = Hipp0Client(base_url=api_url, api_key=api_key)

    hooks = Hipp0AgentHooks(
        client=client,
        project_id=project_id,
        agent_name="analyst",
        inject_context=True,
        capture_decisions=True,
        log_tool_calls=True,
    )

    agent = Agent(
        name="Data Infrastructure Analyst",
        instructions=(
            "You are a data infrastructure analyst. Given a question about "
            "databases or analytics, use your tools to research, then make a "
            "clear DECISION with REASONING and TRADE-OFFS. Always state "
            "decisions in that format."
        ),
        tools=[search_web, check_pricing],
        hooks=hooks,
    )

    task = " ".join(sys.argv[1:]) or "What database should we use for analytics?"

    print(f"Task: {task}\n")
    result = await Runner.run(agent, task)

    print("=" * 60)
    print(result.final_output)
    print("=" * 60)
    print("Decisions captured. Run `hipp0 list` to view.")


if __name__ == "__main__":
    asyncio.run(main())
```

Run it:

```bash
python main.py "Should we use Snowflake or ClickHouse for analytics?"
```

First run output (trimmed):

```
Task: Should we use Snowflake or ClickHouse for analytics?

[Hipp0] No past decisions found
[tool] check_pricing(service="snowflake") -> "$300/mo minimum"
[tool] check_pricing(service="clickhouse") -> "$150/mo for 100GB"

DECISION: Use ClickHouse
REASONING: Lower cost at our data volume and stronger columnar performance.
TRADE-OFFS: Higher ops burden than managed Snowflake.

[Hipp0] Captured 1 decision
```

Second run:

```bash
python main.py "Should we self-host ClickHouse or use ClickHouse Cloud?"
```

```
[Hipp0] Loaded 412 chars of past context
[tool] check_pricing(service="clickhouse") -> "$150/mo for 100GB"

DECISION: Use ClickHouse Cloud
REASONING: We already decided on ClickHouse (see prior decision). Cloud
version removes the ops burden we flagged as the main trade-off.
```

The second decision directly references the first. The dashboard shows the provenance edge.

## Reference: Hipp0AgentHooks API

`Hipp0AgentHooks` implements the full `AgentHooks` protocol from the OpenAI Agents SDK. You pass it to `Agent(hooks=...)` or to `Runner(hooks=...)` — the latter lets one hook instance cover multiple agents in a handoff chain.

### Constructor

```python
Hipp0AgentHooks(
    client: Hipp0Client,
    project_id: str,
    agent_name: str,
    inject_context: bool = True,
    capture_decisions: bool = True,
    log_tool_calls: bool = True,
    context_max_tokens: int = 2000,
    context_min_relevance: float = 0.4,
    namespace: Optional[str] = None,
    on_decision_captured: Optional[Callable] = None,
)
```

Parameters:

- **`client`** — An initialized `Hipp0Client`. Required.
- **`project_id`** — Hipp0 project ID. Required.
- **`agent_name`** — The agent's role for scoping decisions. Doesn't have to match `Agent.name` but usually does.
- **`inject_context`** — If `True`, prepend compiled context to the agent's instructions at run start. Default `True`.
- **`capture_decisions`** — If `True`, send the final output through the distillery at run end. Default `True`.
- **`log_tool_calls`** — If `True`, record every tool call and tool output as an event in Hipp0. Default `True`.
- **`context_max_tokens`** — Budget for the injected context. Default 2000. Larger values give the agent more history but eat your token budget.
- **`context_min_relevance`** — Decisions scored below this are excluded from injection. Default 0.4.
- **`namespace`** — Optional sub-scope for separating experiments.
- **`on_decision_captured`** — A callback fired whenever a decision is extracted. Signature: `(decision: dict) -> None`. Useful for wiring your own logging or Slack notifications.

### `async on_start(context, agent)`

Fires when a run begins, before the first LLM call. Default behavior:

1. Call `compile_context(agent_name, task_description=context.input)`.
2. If decisions come back, prepend them to `agent.instructions` on a *copy* of the agent (the original is untouched).
3. Record an `agent.run_started` event in Hipp0.

If you override this, call `super().on_start(context, agent)` first to keep context injection.

```python
class CustomHooks(Hipp0AgentHooks):
    async def on_start(self, context, agent):
        agent = await super().on_start(context, agent)
        print(f"Starting with {len(agent.instructions)} chars of instructions")
        return agent
```

### `async on_end(context, agent, output)`

Fires when the run completes successfully. Default behavior:

1. Send `output.final_output` to the distillery for decision extraction.
2. Record an `agent.run_completed` event with the output, duration, and token usage.
3. Call `on_decision_captured` for each extracted decision.

Returns nothing. The output is not modified.

### `async on_tool_call(context, agent, tool, tool_input)`

Fires right before a tool is invoked. Records `agent.tool_called` with the tool name and input.

If you want to filter or redact tool inputs before they hit Hipp0, override this:

```python
class RedactingHooks(Hipp0AgentHooks):
    async def on_tool_call(self, context, agent, tool, tool_input):
        safe_input = {**tool_input}
        if "api_key" in safe_input:
            safe_input["api_key"] = "[REDACTED]"
        await super()._record_tool_call(agent, tool, safe_input)
```

### `async on_tool_output(context, agent, tool, output)`

Fires after a tool returns. Records `agent.tool_output` with the output payload.

Tool outputs are stored as artifacts in Hipp0. You can reference them from decisions by artifact ID, which lets you trace "this decision was based on these tool results".

### `async on_handoff(context, source_agent, target_agent)`

Fires when one agent hands off to another. Records a provenance edge in Hipp0 linking decisions made before the handoff to decisions made after. This is how Hipp0 builds the multi-agent decision graph.

### `async on_error(context, agent, error)`

Fires on any exception during the run. Records an `agent.run_errored` event with the exception type and message. Does *not* re-raise — the SDK handles that.

### Event types produced

| Event | Fires on | Payload |
|---|---|---|
| `agent.run_started` | Run begins | agent_name, input, instructions_length |
| `agent.run_completed` | Run ends ok | output, duration_ms, tokens |
| `agent.run_errored` | Exception | error_type, error_message |
| `agent.tool_called` | Before tool invoke | tool_name, tool_input |
| `agent.tool_output` | After tool returns | tool_name, output |
| `agent.handoff` | Handoff between agents | source, target, reason |

Watch them stream with `hipp0 events --follow`.

## Reference: Context injection as additional instructions

The way Hipp0 injects past decisions into an OpenAI Agent is by modifying the `instructions` the LLM sees. It doesn't touch your agent's original `instructions` field — it constructs a new, extended instructions string for that run only.

What the LLM ends up seeing is roughly:

```
<Your original instructions>

--- Relevant Previous Decisions (from Hipp0) ---

## Use ClickHouse for analytics store
**Agent:** analyst
**When:** 2025-03-14
**Reasoning:** Columnar storage handles our workload best...
**Tags:** database, analytics

## Use managed cloud for infra
**Agent:** architect
**When:** 2025-03-10
**Reasoning:** We don't have the ops capacity to self-host...
**Tags:** infra, ops

--- End of Previous Decisions ---
```

You can customize the injection format by passing a `context_formatter`:

```python
def my_formatter(decisions: list) -> str:
    lines = ["Past decisions you should respect:"]
    for d in decisions:
        lines.append(f"- {d['title']}")
    return "\n".join(lines)

hooks = Hipp0AgentHooks(
    client=client,
    project_id=project_id,
    agent_name="analyst",
    context_formatter=my_formatter,
)
```

If no decisions match, nothing is injected — the agent runs with its original instructions unchanged.

### Disabling injection per-run

If you want the hooks for capture but *not* for injection on a specific run:

```python
hooks = Hipp0AgentHooks(..., inject_context=True)  # default on
hooks.skip_next_injection = True
await Runner.run(agent, task)  # runs without context injection
# Next run will inject again
```

Useful for things like "first message of a new thread should ignore history".

## Pattern: tool output as artifact

Tool outputs can be big — a web search might return 50KB of HTML. Stuffing that into every decision is wasteful. Hipp0 stores tool outputs as *artifacts* (first-class objects with their own IDs) and references them from decisions.

With `log_tool_calls=True` (the default), every tool output gets an artifact ID automatically. The distillery then links any decision that came from that tool call to the artifact.

Query by artifact:

```bash
hipp0 artifacts list --project $HIPP0_PROJECT_ID
hipp0 artifacts get art_01h... # see the raw tool output
```

Or from the dashboard, click any decision and scroll to "Source Artifacts".

To attach a custom artifact to a decision manually:

```python
artifact = client.create_artifact(
    project_id=project_id,
    name="pricing-analysis.csv",
    content=csv_data,
    mime_type="text/csv",
    kind="data",
)

client.record_decision(
    project_id=project_id,
    title="Use tier-2 pricing",
    reasoning="See analysis",
    made_by="analyst",
    artifact_ids=[artifact["id"]],
)
```

Artifacts survive forever by default. They're cheap — stored compressed in Postgres.

## Troubleshooting

### `ImportError: cannot import name 'AgentHooks' from 'agents'`

You're on an old version of `openai-agents`. `AgentHooks` was added in 0.0.10. Upgrade:

```bash
pip install --upgrade "openai-agents>=0.0.12"
```

If you're stuck on an older version, `hipp0-openai-agents==0.3.*` has a compatibility shim that uses the older `on_step` callback protocol.

### `TypeError: Hipp0AgentHooks.on_start() missing 1 required positional argument: 'agent'`

You're mixing sync and async. The OpenAI Agents SDK calls hooks with `await`. Make sure your subclasses use `async def`:

```python
class MyHooks(Hipp0AgentHooks):
    async def on_start(self, context, agent):  # NOT def on_start
        return await super().on_start(context, agent)
```

### Context isn't being injected

Check these in order:

1. **`inject_context=True`?** If you passed `False`, no injection happens.
2. **Any decisions in the project?** `hipp0 list --project $HIPP0_PROJECT_ID`. Empty? Nothing to inject.
3. **`context_min_relevance` too high?** The default 0.4 can be strict. Try 0.2 temporarily.
4. **Task description length.** `compile_context` uses the run's input as the task description. If your input is one word ("hi"), embeddings have nothing to match against. Longer inputs work better.

Turn on debug mode:

```python
import logging
logging.getLogger("hipp0_openai_agents").setLevel(logging.DEBUG)
```

You'll see exactly what the hook is doing at every step.

### Decisions captured but tool calls aren't logged

`log_tool_calls=True`? And are you actually using tools? Only `function_tool`-decorated functions and built-in tools trigger hooks. Raw function calls bypass the hooks entirely.

Also check if you're using `Runner.run_sync` instead of `Runner.run`. Some versions of the SDK don't fully fire hooks in sync mode. Prefer `await Runner.run(agent, task)`.

### Handoffs aren't creating provenance edges

Handoffs need both agents to share the same `Hipp0AgentHooks` instance. If each agent has its own hooks, the edge isn't recorded because the target hook doesn't know about the source hook's run.

Correct:

```python
hooks = Hipp0AgentHooks(client=client, project_id=project_id, agent_name="router")

agent_a = Agent(name="A", ..., hooks=hooks)
agent_b = Agent(name="B", ..., hooks=hooks)
# Or pass hooks once to the Runner
await Runner.run(agent_a, task, hooks=hooks)
```

Wrong:

```python
hooks_a = Hipp0AgentHooks(..., agent_name="a")
hooks_b = Hipp0AgentHooks(..., agent_name="b")
agent_a = Agent(..., hooks=hooks_a)
agent_b = Agent(..., hooks=hooks_b)
# Handoff from A to B won't link
```

### Agent runs fine but nothing shows up in the dashboard

Same checks as the other guides:

1. **Server running?** `curl http://localhost:3100/health`.
2. **`project_id` correct?** `echo $HIPP0_PROJECT_ID` vs dashboard Settings.
3. **Events reaching the server?** Tail events: `hipp0 events --follow`. Run the agent. You should see `agent.run_started`, tool calls, `agent.run_completed`. If you see *nothing*, the hook isn't wired — double-check you passed `hooks=hooks` to `Agent(...)` or `Runner.run(...)`.

### `on_end` raises but the run output says success

By default, exceptions inside hook methods are swallowed by the SDK — you get a warning in the logs but the run continues. If you want hook failures to fail the run:

```python
hooks = Hipp0AgentHooks(..., fail_on_error=True)
```

Debug mode also helps here:

```bash
export HIPP0_DEBUG=1
python main.py
```

You'll see the full stack trace from any hook exception.

## Next steps

- [CrewAI guide](crewai.md) — multi-agent crews
- [LangGraph guide](langgraph.md) — stateful graphs
- [Troubleshooting](../troubleshooting.md) — everything else
- [Artifacts and provenance](../h0c-format.md) — how decisions reference artifacts
