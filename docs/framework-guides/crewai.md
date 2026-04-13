# CrewAI + Hipp0

CrewAI is great for building multi-agent teams. It's less great at remembering what those teams decided last Tuesday. Hipp0 fixes that by sitting underneath your Crew and quietly capturing every decision your agents make, then feeding the relevant ones back into their backstories the next time you run the crew.

This guide walks through everything: install, a working three-agent example, the full `Hipp0CrewCallback` API, how to filter what gets captured, and the things that break when you wire it up wrong.

![CrewAI dashboard with captured decisions](images/crewai-dashboard.png)

## What Hipp0 adds to CrewAI

Out of the box, CrewAI gives you `memory=True` which stores short-term context in a local vector DB. That's fine for a single run. Between runs, it forgets almost everything that mattered.

Hipp0 adds four things on top:

1. **Persistent decision memory across runs.** Every task output flows through the distillery, which extracts decisions (technology choices, trade-offs, rejected alternatives) and stores them in Postgres. Next run, they're still there.
2. **Role-scoped context.** When the architect asks "what have we decided about message queues?", the architect gets decisions ranked by relevance to the architect role. The reviewer gets decisions ranked for the reviewer role. Same underlying store, different views.
3. **Contradiction detection.** If the builder decides "use Redis Streams" after the architect already decided "use Kafka", Hipp0 flags the contradiction. You see it on the dashboard and in the `on_contradiction` event.
4. **Trust multipliers.** Decisions that have been referenced by downstream agents and survived multiple runs get boosted. Decisions that were overridden lose weight. This happens automatically.

None of this requires rewriting your Crew. You drop in one callback and optionally read context into your agent backstories.

## Install

```bash
pip install hipp0-memory hipp0-crewai crewai
```

You'll also want the CLI for local setup:

```bash
npm install -g @hipp0/cli
hipp0 init my-crew
cd my-crew
source .env
```

That writes `HIPP0_API_URL`, `HIPP0_API_KEY`, and `HIPP0_PROJECT_ID` to `.env`. Source it before running Python so the SDK can pick them up.

Supported versions:

- Python 3.10 or later
- CrewAI 0.28 or later (tested on 0.70)
- hipp0-memory 0.4 or later

If you want to pin, this is what's in the working example:

```
crewai>=0.70.0
hipp0-memory>=0.4.0
hipp0-crewai>=0.4.0
```

## Quick start

Here's a three-agent crew (architect, builder, reviewer) working on a real task. Copy this into `main.py`, set `OPENAI_API_KEY`, and run it. The second time you run it you'll see the agents reference decisions from the first run.

```python
"""
CrewAI + Hipp0: Software Architecture Team
Three agents collaborate. Hipp0 captures every decision automatically.
"""
import os
import sys

from crewai import Agent, Crew, Task
from hipp0_sdk import Hipp0Client
from hipp0_crewai import Hipp0CrewCallback


def main():
    api_url = os.environ.get("HIPP0_API_URL", "http://localhost:3100")
    api_key = os.environ.get("HIPP0_API_KEY", "")
    project_id = os.environ.get("HIPP0_PROJECT_ID", "")

    if not project_id:
        print("Error: HIPP0_PROJECT_ID not set. Run: hipp0 init my-project")
        sys.exit(1)

    client = Hipp0Client(base_url=api_url, api_key=api_key)
    hipp0_cb = Hipp0CrewCallback(client=client, project_id=project_id)

    # Compile past context for each agent, scoped to their role
    def get_context(agent_name: str, task_desc: str) -> str:
        try:
            result = client.compile_context(
                project_id=project_id,
                agent_name=agent_name,
                task_description=task_desc,
            )
            md = result.get("formatted_markdown", "")
            if md and "No relevant decisions" not in md:
                return f"\n\n--- Previous Decisions (from Hipp0) ---\n{md}"
        except Exception:
            pass
        return ""

    task_topic = "Design a real-time notification system for a SaaS platform"

    arch_context = get_context("architect", task_topic)
    build_context = get_context("builder", task_topic)
    review_context = get_context("reviewer", task_topic)

    architect = Agent(
        role="Software Architect",
        goal="Make clear, well-reasoned architecture decisions",
        backstory=(
            "You are a senior architect. Make explicit decisions about technology "
            "choices, patterns, and trade-offs. State each decision as: "
            "'DECISION: [title] - REASONING: [why]'"
            f"{arch_context}"
        ),
        verbose=True,
    )

    builder = Agent(
        role="Senior Developer",
        goal="Implement the architecture following established decisions",
        backstory=(
            "You are a senior developer. Follow the architect's decisions exactly. "
            "State implementation choices as: 'DECISION: [title] - REASONING: [why]'"
            f"{build_context}"
        ),
        verbose=True,
    )

    reviewer = Agent(
        role="Code Reviewer",
        goal="Review implementation against architecture decisions",
        backstory=(
            "You are a code reviewer. Check that the implementation follows all "
            "established decisions. Flag any contradictions. "
            "State findings as: 'DECISION: [title] - REASONING: [why]'"
            f"{review_context}"
        ),
        verbose=True,
    )

    design_task = Task(
        description=(
            f"Design the architecture for: {task_topic}\n\n"
            "Make at least 3 explicit decisions about:\n"
            "1. Communication protocol (WebSocket vs SSE vs polling)\n"
            "2. Message queue technology\n"
            "3. Delivery guarantees (at-least-once vs exactly-once)"
        ),
        agent=architect,
        expected_output="A list of architecture decisions with reasoning",
    )

    implement_task = Task(
        description=(
            f"Outline the implementation for: {task_topic}\n"
            "Cover components, data flow, and error handling. "
            "Reference the architect's decisions explicitly."
        ),
        agent=builder,
        expected_output="Implementation plan referencing architecture decisions",
    )

    review_task = Task(
        description=(
            f"Review the implementation plan for: {task_topic}\n"
            "Check: does it follow all architecture decisions? Any contradictions?"
        ),
        agent=reviewer,
        expected_output="Review findings with pass/fail for each decision",
    )

    crew = Crew(
        agents=[architect, builder, reviewer],
        tasks=[design_task, implement_task, review_task],
        verbose=True,
        task_callback=hipp0_cb.on_task_complete,
    )

    result = crew.kickoff()
    hipp0_cb.on_crew_complete(crew_output=str(result))

    print("Done. Run `hipp0 list` to see captured decisions.")


if __name__ == "__main__":
    main()
```

Run it:

```bash
export OPENAI_API_KEY=sk-...
python main.py
```

First run output (trimmed):

```
Running crew: Design a real-time notification system for a SaaS platform
Hipp0 project: proj_01hxyz...

[Architect] DECISION: Use WebSocket - REASONING: Real-time bidirectional...
[Builder] DECISION: Redis Streams as queue - REASONING: Lower ops burden...
[Reviewer] DECISION: Approve with one caveat - REASONING: Missing DLQ...

Captured 7 decisions in Hipp0.
```

Run it a second time. You'll see:

```
  Loaded 1247 chars of past context from Hipp0
[Architect] Based on our previous decision to use WebSocket...
```

That's the loop. Check the dashboard at `http://localhost:3200` to see the decisions piling up.

![Decisions list view](images/crewai-decisions-list.png)

## Reference: Hipp0CrewCallback

The callback is the bridge between CrewAI's event stream and Hipp0's capture pipeline. You create one per crew and wire two methods into the Crew lifecycle.

### Constructor

```python
Hipp0CrewCallback(
    client: Hipp0Client,
    project_id: str,
    agent_name_map: Optional[Dict[str, str]] = None,
    capture_filter: Optional[Callable[[dict], bool]] = None,
    passive_only: bool = False,
    namespace: Optional[str] = None,
)
```

Parameters:

- **`client`** — An initialized `Hipp0Client`. Required.
- **`project_id`** — The project ID you got from `hipp0 init`. Required.
- **`agent_name_map`** — Override how CrewAI agent roles map to Hipp0 agent names. By default, `agent.role` is slugified (`"Software Architect"` becomes `"software-architect"`). Pass `{"Software Architect": "architect"}` to override.
- **`capture_filter`** — A function that takes an event dict and returns `True` to capture or `False` to skip. See the filtering section below.
- **`passive_only`** — If `True`, the callback only sends raw output to the distillery for later extraction. It does not call `record_decision`. Useful when you want the distillery to do all the extraction work on its own schedule.
- **`namespace`** — Optional namespace tag applied to all captured decisions. Use this to separate environments (`"prod"`, `"staging"`) or experiments (`"exp-retry-logic"`).

### Methods

**`on_task_complete(task_output)`** — Wire this into `Crew(task_callback=...)`. Fires after each task completes. Extracts decisions from `task_output.raw` and sends them to Hipp0 via the passive capture endpoint.

```python
crew = Crew(
    agents=[...],
    tasks=[...],
    task_callback=hipp0_cb.on_task_complete,
)
```

**`on_crew_complete(crew_output: str)`** — Call this after `crew.kickoff()` returns. Sends the full crew output to the distillery for a second pass of decision extraction. This catches decisions that span multiple tasks.

```python
result = crew.kickoff()
hipp0_cb.on_crew_complete(crew_output=str(result))
```

**`on_tool_use(tool_name: str, tool_input: dict, tool_output: str)`** — Optional. Call manually from a custom tool wrapper if you want tool usage recorded as events. CrewAI doesn't emit tool events natively in all versions.

**`capture_decision(title: str, reasoning: str, made_by: str, **kwargs)`** — Skip the auto-extraction and record a decision directly. Useful for deterministic decisions made outside an LLM call.

```python
hipp0_cb.capture_decision(
    title="Use PostgreSQL for primary store",
    reasoning="ACID guarantees required for billing data",
    made_by="architect",
    tags=["database", "billing"],
    affects=["builder", "reviewer"],
)
```

### Event types

The callback emits these events to Hipp0's `/events` endpoint:

| Event type | When it fires | What gets stored |
|---|---|---|
| `crew.task_started` | Task begins | Task description, agent name |
| `crew.task_completed` | Task finishes | Full task output, duration |
| `crew.crew_completed` | `crew.kickoff()` returns | Full crew output |
| `crew.decision_captured` | A decision is extracted | Title, reasoning, agent, tags |
| `crew.contradiction` | A decision contradicts a prior one | Both decision IDs, similarity score |

You can tail these live with `hipp0 events --follow`.

## Reference: Injecting past context into agent backstories

CrewAI agents take a `backstory` string. Hipp0 gives you two ways to add relevant past decisions to it:

### Option 1: `compile_context` into backstory (recommended)

This is what the quick start does. Before creating the agent, call `client.compile_context` and concatenate the result into the backstory:

```python
context_result = client.compile_context(
    project_id=project_id,
    agent_name="architect",
    task_description="Design the notification system",
    max_tokens=2000,           # cap the context size
    min_relevance=0.4,         # only decisions above this relevance
    include_contradictions=True,
)

past_context = context_result.get("formatted_markdown", "")

architect = Agent(
    role="Software Architect",
    goal="...",
    backstory=f"You are a senior architect...\n\n{past_context}",
)
```

The `formatted_markdown` string is already structured with headings, reasoning, and timestamps. It drops straight into a backstory.

### Option 2: Agent-level memory backend

If you prefer CrewAI's native memory slot, pass `Hipp0CrewMemory` (a thin adapter):

```python
from hipp0_crewai import Hipp0CrewMemory

mem = Hipp0CrewMemory(
    client=client,
    project_id=project_id,
    agent_name="architect",
)

architect = Agent(
    role="Software Architect",
    goal="...",
    backstory="You are a senior architect...",
    memory=mem,
)
```

CrewAI will call `mem.search(query)` internally when the agent asks its memory a question. This approach is cleaner but less predictable — you don't control *when* the memory is queried. Most users prefer Option 1.

## Advanced: filtering which decisions get captured

Sometimes you don't want every task output going to Hipp0. Maybe a task is exploratory and shouldn't pollute the decision log. Maybe you're in a dev loop and don't want noise.

Pass a `capture_filter` to the callback:

```python
def should_capture(event: dict) -> bool:
    # Skip tasks marked experimental
    if event.get("task_metadata", {}).get("experimental"):
        return False
    # Skip outputs shorter than 200 chars (usually error messages)
    if len(event.get("output", "")) < 200:
        return False
    # Skip tasks from the dev-loop namespace
    if event.get("namespace") == "dev-loop":
        return False
    return True

hipp0_cb = Hipp0CrewCallback(
    client=client,
    project_id=project_id,
    capture_filter=should_capture,
)
```

The filter runs synchronously before the event is queued, so keep it fast. No network calls.

For the opposite — capturing *everything* including tool use and internal messages — set the environment variable `HIPP0_CAPTURE_VERBOSE=1`. This disables the default output-length threshold.

## Advanced: using compile_context with specific agents

`compile_context` supports several parameters that let you tune what each agent sees:

```python
result = client.compile_context(
    project_id=project_id,
    agent_name="architect",

    # What we're working on right now (drives relevance scoring)
    task_description="Choose between GraphQL and REST for the public API",

    # Only pull decisions from the last 30 days
    time_window_days=30,

    # Include decisions tagged with any of these
    include_tags=["api", "architecture", "public-interface"],

    # Exclude decisions tagged with any of these
    exclude_tags=["experimental", "dev-loop"],

    # How large the returned markdown can be
    max_tokens=3000,

    # Return decisions from other agents that affect this one
    include_upstream=True,

    # Return decisions made by this agent that affect others
    include_downstream=False,

    # Include contradiction warnings inline
    include_contradictions=True,
)
```

The return value is a dict:

```python
{
    "formatted_markdown": "## Past Decisions\n### Use PostgreSQL...",
    "decisions": [
        {"id": "dec_01h...", "title": "...", "relevance": 0.87, ...},
        ...
    ],
    "total_tokens": 1842,
    "contradictions_found": 0,
    "trust_multiplier_debug": {...},  # if HIPP0_DEBUG=1
}
```

If you only need the top 3 most relevant decisions for a prompt budget:

```python
result = client.compile_context(..., max_decisions=3)
top_3 = result["decisions"]
for d in top_3:
    print(f"- {d['title']} (relevance={d['relevance']:.2f})")
```

### Per-task context instead of per-agent

You can also compile context scoped to a specific task description rather than an agent:

```python
context_for_this_task = client.compile_context(
    project_id=project_id,
    agent_name="builder",  # still required for trust scoring
    task_description=implement_task.description,
)
```

This is useful when one agent handles multiple task types and you want context that's specific to each task.

## Troubleshooting

### `ImportError: cannot import name 'Hipp0CrewCallback'`

You installed `hipp0-crewai` but not the right version. Some older releases named it `Hipp0Callback`. Upgrade:

```bash
pip install --upgrade hipp0-crewai>=0.4.0
```

Also confirm the Python env is the one running your script. A common foot-gun is installing into system Python and running inside a venv, or vice versa.

### `Hipp0CrewCallback is not callable`

You passed the callback *instance* where CrewAI expected a method reference. This is wrong:

```python
Crew(..., task_callback=hipp0_cb)  # wrong
```

This is right:

```python
Crew(..., task_callback=hipp0_cb.on_task_complete)
```

CrewAI calls `task_callback(task_output)` directly and the instance isn't callable.

### No decisions appear in the dashboard after running

Three things to check in order:

1. **Is the server actually running?** `curl http://localhost:3100/health` should return `{"status":"ok"}`. If not, start it with `docker compose up -d` or `hipp0 server start`.
2. **Is the project ID right?** `echo $HIPP0_PROJECT_ID` and confirm it matches what the dashboard shows under Settings. A mismatch means decisions are going to a different project.
3. **Did the task output actually contain decisions?** If the agent just said "sure, I'll help!" there's nothing to extract. Look at the task output: does it have the structured format the example enforces (`DECISION: ... REASONING: ...`)? If not, the distillery has nothing to work with.

Run `hipp0 events --follow` in another terminal while the crew runs. You should see events streaming in real time. If you don't see `crew.task_completed` events, the callback isn't wired up.

### Decisions are captured but contradictions aren't detected

Contradictions require embedding similarity above a threshold (default 0.82). If you see two decisions that look contradictory but no warning:

1. Check the embedding provider is set: `echo $HIPP0_EMBEDDING_PROVIDER` should be `openai` or `local`.
2. Check the decisions are in the same project and namespace. Cross-project contradictions are not flagged.
3. Lower the threshold with `HIPP0_CONTRADICTION_THRESHOLD=0.75`.

You can also force a re-check: `hipp0 reanalyze --project $HIPP0_PROJECT_ID`.

### `compile_context` returns "No relevant decisions" even though decisions exist

The `task_description` you passed doesn't overlap semantically with any stored decision. Relevance scoring uses embeddings — if your task says "pick a font" and all your decisions are about databases, you'll get nothing back.

Diagnose:

```bash
hipp0 compile architect "pick a font" --debug
```

The `--debug` flag shows the top-20 scored decisions and their relevance. If the top score is under 0.3, there's no real overlap. If it's over 0.5 but still filtered out, your `min_relevance` is too high. Lower it:

```python
result = client.compile_context(..., min_relevance=0.2)
```

### Every run creates duplicate decisions

You're probably running `on_crew_complete` on the same output twice, or you have both `task_callback` and a manual `on_task_complete` call. The callback is idempotent on the same event ID but you can still double-submit if you construct two events for the same output.

Quick test — check if duplicates have different IDs:

```bash
hipp0 list --limit 20 --format json | jq '.[] | {id, title, created_at}'
```

If titles match but IDs differ, it's double-submission. Remove the manual call and rely on `task_callback`.

### Crew runs fine locally but drops decisions in CI

CI likely has a shorter timeout than your local run. The distillery call is async but the initial event POST isn't — if the Hipp0 server takes longer than your HTTP timeout, the callback swallows the error and moves on. Check the server logs for `POST /events` entries.

Bump the client timeout:

```python
client = Hipp0Client(base_url=api_url, api_key=api_key, timeout=30)
```

And confirm the CI runner can reach the server. A common issue: Hipp0 running on `localhost:3100` in CI where `localhost` refers to the job container, not the host.

## Next steps

- [LangGraph guide](langgraph.md) — stateful graphs with Hipp0 as checkpointer
- [OpenAI Agents guide](openai-agents.md) — the `AgentHooks` integration
- [Troubleshooting guide](../troubleshooting.md) — everything that can go wrong
- [Dashboard tour](../dashboard.md) — see your captured decisions
