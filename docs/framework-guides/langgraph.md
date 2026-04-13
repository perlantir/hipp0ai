# LangGraph + Hipp0

LangGraph is a library for building stateful, multi-step agents as graphs. It's great at modeling control flow but it leaves state persistence up to you. The built-in `MemorySaver` works for demos. `SqliteSaver` works for single-machine dev. Once you want multi-run memory, cross-thread context, and decision extraction, you need something bigger.

Hipp0 plugs into LangGraph in two places:

1. As a **checkpointer** (`Hipp0Checkpointer`) that persists graph state across runs and threads.
2. As a **context injector** (`inject_hipp0_context`) that pulls relevant past decisions into any node's state.

This guide walks through both, with a full working example of a research agent that remembers.

![LangGraph research agent remembering past decisions](images/langgraph-memory.png)

## What Hipp0 adds

LangGraph's native `MemorySaver` holds checkpoints in a Python dict. Lose the process, lose the memory. `SqliteSaver` helps but it doesn't extract anything — it just blobs out the state dict.

Hipp0 does four things that matter for stateful agents:

1. **Checkpoint persistence in Postgres** — survives restarts, works across processes, works on serverless.
2. **Cross-thread decision recall** — a decision made in `thread_id="user-a"` can inform a run under `thread_id="user-b"` if they're in the same project and role.
3. **Decision extraction** — your graph state gets sent through the distillery, which pulls out structured decisions automatically. No need to hand-parse LLM output.
4. **Context injection** — any node in your graph can call `inject_hipp0_context` to get role-scoped, task-scoped decisions ready to paste into a system prompt.

You can use either piece without the other. A lot of users start with just `inject_hipp0_context` and keep `MemorySaver` until they need persistence.

## Install

```bash
pip install hipp0-memory hipp0-langgraph langgraph langchain-openai
```

Set up a project with the CLI:

```bash
npm install -g @hipp0/cli
hipp0 init research-agent
cd research-agent
source .env
```

Version requirements:

- Python 3.10+
- langgraph 0.2 or later
- langchain-openai 0.1 or later (if you use OpenAI)
- hipp0-memory 0.4 or later

## Quick start

A stateful research agent that takes a question, loads past context from Hipp0, thinks, and records its decision. Copy this into `main.py` and run it.

```python
"""
LangGraph + Hipp0: Research Agent with Memory
A stateful agent that remembers decisions across sessions.
"""
import os
import sys
from typing import TypedDict

from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import StateGraph, END
from hipp0_sdk import Hipp0Client
from hipp0_langgraph import Hipp0Checkpointer, inject_hipp0_context


class AgentState(TypedDict):
    messages: list
    task: str
    context: str
    decision: str


def main():
    api_url = os.environ.get("HIPP0_API_URL", "http://localhost:3100")
    api_key = os.environ.get("HIPP0_API_KEY", "")
    project_id = os.environ.get("HIPP0_PROJECT_ID", "")

    if not project_id:
        print("Error: HIPP0_PROJECT_ID not set. Run: hipp0 init my-project")
        sys.exit(1)

    task = " ".join(sys.argv[1:]) if len(sys.argv) > 1 else "What DB for analytics?"

    client = Hipp0Client(base_url=api_url, api_key=api_key)
    llm = ChatOpenAI(model="gpt-4o-mini", temperature=0.3)

    checkpointer = Hipp0Checkpointer(
        client=client,
        project_id=project_id,
        agent_name="researcher",
    )

    def load_context(state: AgentState) -> AgentState:
        context = inject_hipp0_context(
            client=client,
            project_id=project_id,
            agent_name="researcher",
            task_description=state["task"],
        )
        if context and "No relevant decisions" not in context:
            print(f"  Loaded {len(context)} chars of past context")
        else:
            context = ""
        return {**state, "context": context}

    def think(state: AgentState) -> AgentState:
        system_prompt = (
            "You are a senior technical advisor. When asked a question, make a "
            "clear DECISION with reasoning. Format:\n\n"
            "DECISION: [clear statement]\n"
            "REASONING: [why this is right]\n"
            "TRADE-OFFS: [what we give up]\n"
        )

        if state["context"]:
            system_prompt += (
                "\n\nYou have access to previous decisions. Reference them when "
                "relevant and avoid contradictions.\n\n"
                f"--- Previous Decisions ---\n{state['context']}"
            )

        response = llm.invoke([
            SystemMessage(content=system_prompt),
            HumanMessage(content=state["task"]),
        ])
        return {**state, "decision": response.content, "messages": [response]}

    def save_decision(state: AgentState) -> AgentState:
        decision_text = state["decision"]
        title = state["task"][:100]

        for line in decision_text.split("\n"):
            if line.strip().upper().startswith("DECISION:"):
                title = line.split(":", 1)[1].strip()[:200]
                break

        client.record_decision(
            project_id=project_id,
            title=title,
            description=decision_text[:2000],
            reasoning=decision_text[:1000],
            made_by="researcher",
            tags=["research"],
            affects=["builder", "reviewer"],
        )
        print(f"  Saved: {title[:60]}...")
        return state

    graph = StateGraph(AgentState)
    graph.add_node("load_context", load_context)
    graph.add_node("think", think)
    graph.add_node("save_decision", save_decision)
    graph.set_entry_point("load_context")
    graph.add_edge("load_context", "think")
    graph.add_edge("think", "save_decision")
    graph.add_edge("save_decision", END)

    app = graph.compile(checkpointer=checkpointer)

    result = app.invoke(
        {"task": task, "messages": [], "context": "", "decision": ""},
        config={"configurable": {"thread_id": "main"}},
    )

    print("\n" + "=" * 60)
    print(result["decision"])


if __name__ == "__main__":
    main()
```

Run it:

```bash
export OPENAI_API_KEY=sk-...
python main.py "What database should we use for analytics?"
```

First run:

```
  No past decisions found
============================================================
DECISION: Use ClickHouse for the analytics store
REASONING: Columnar storage, sub-second aggregations...
TRADE-OFFS: More ops complexity than Postgres...
  Saved: Use ClickHouse for the analytics store...
```

Second run with a related question:

```bash
python main.py "Should we use the same DB for user events?"
```

```
  Loaded 847 chars of past context
============================================================
DECISION: Route user events into the existing ClickHouse cluster
REASONING: We already decided on ClickHouse for analytics (prev decision)...
```

The second decision references the first. That's the loop.

## Reference: Hipp0Checkpointer API

`Hipp0Checkpointer` is a drop-in replacement for `langgraph.checkpoint.memory.MemorySaver`. It implements the full `BaseCheckpointSaver` interface, so anything that accepts a checkpointer accepts this one.

### Constructor

```python
Hipp0Checkpointer(
    client: Hipp0Client,
    project_id: str,
    agent_name: str,
    namespace: Optional[str] = None,
    auto_extract_decisions: bool = True,
    checkpoint_ttl_days: Optional[int] = None,
    compression: str = "gzip",
)
```

Parameters:

- **`client`** — An initialized `Hipp0Client`. Required.
- **`project_id`** — The Hipp0 project to write to. Required.
- **`agent_name`** — The role this graph represents. Used for context scoping and decision attribution.
- **`namespace`** — Optional sub-scope. Useful for separating environments (`"prod"` vs `"staging"`) or users (`"user:alice"`).
- **`auto_extract_decisions`** — If `True` (default), every checkpoint's state is sent to the distillery for decision extraction. Set to `False` if you're calling `record_decision` manually and don't want duplicates.
- **`checkpoint_ttl_days`** — How long to keep raw checkpoint blobs. Decisions extracted from them persist forever; this just controls the raw state history. Default is 30.
- **`compression`** — `"gzip"` (default), `"zstd"`, or `"none"`. Checkpoints can get large, gzip is a reasonable default.

### `put(config, checkpoint, metadata, new_versions)`

Stores a checkpoint. LangGraph calls this at every node boundary by default. You don't normally call it yourself.

```python
checkpointer.put(
    config={"configurable": {"thread_id": "main"}},
    checkpoint={"v": 1, "ts": "...", "channel_values": {...}},
    metadata={"source": "loop", "step": 3, "writes": {...}},
    new_versions={"task": 2, "context": 1},
)
```

Returns the updated config dict with a new `checkpoint_id`.

### `get_tuple(config)`

Retrieves the most recent checkpoint for a given thread. Used by LangGraph to resume a graph.

```python
tuple_ = checkpointer.get_tuple({"configurable": {"thread_id": "main"}})
if tuple_:
    config, checkpoint, metadata, parent_config = tuple_
```

Returns `None` if no checkpoint exists for that thread.

### `list(config, filter=None, before=None, limit=None)`

Iterates over historical checkpoints for a thread. Useful for debugging or building time-travel UIs.

```python
for cp_tuple in checkpointer.list(
    {"configurable": {"thread_id": "main"}},
    limit=10,
):
    print(cp_tuple.checkpoint["ts"], cp_tuple.metadata.get("step"))
```

Supports filtering by metadata:

```python
checkpointer.list(config, filter={"source": "loop"})
```

### `put_writes(config, writes, task_id)`

Stores pending writes for a checkpoint. LangGraph uses this for interrupt/resume. You don't normally call it.

### `aput`, `aget_tuple`, `alist` (async variants)

All methods have async counterparts. Use these in async graphs:

```python
await checkpointer.aput(config, checkpoint, metadata, versions)
tuple_ = await checkpointer.aget_tuple(config)
async for cp in checkpointer.alist(config):
    ...
```

### `delete_thread(thread_id)`

Drops all checkpoints for a thread. Does *not* delete extracted decisions — those are permanent.

```python
checkpointer.delete_thread("main")
```

### `clear_namespace()`

Drops all checkpoints under the checkpointer's namespace. Also does not delete decisions.

```python
checkpointer = Hipp0Checkpointer(..., namespace="experiment-1")
# ... run some stuff ...
checkpointer.clear_namespace()
```

## Reference: inject_hipp0_context helper

`inject_hipp0_context` is a one-liner that calls `compile_context` and returns a ready-to-paste string. It's what you want inside a graph node that's about to call an LLM.

```python
from hipp0_langgraph import inject_hipp0_context

context_str = inject_hipp0_context(
    client=client,
    project_id=project_id,
    agent_name="researcher",
    task_description="Choose a vector database",

    # Optional tuning:
    max_tokens=2000,
    min_relevance=0.4,
    include_tags=["database", "infra"],
    exclude_tags=["deprecated"],
    time_window_days=60,
    format="markdown",  # or "plain" or "json"
)
```

Returns a string. If no decisions match, you get the literal `"No relevant decisions found"` — check for this before pasting into a prompt.

The function is a thin wrapper around `client.compile_context`. If you need the raw decision objects (not the formatted string), call `compile_context` directly.

### Typical usage inside a node

```python
def research_node(state: AgentState) -> AgentState:
    context = inject_hipp0_context(
        client=client,
        project_id=project_id,
        agent_name="researcher",
        task_description=state["task"],
    )

    prompt = f"""You are a research agent.

Previous decisions you should know about:
{context}

Current task: {state['task']}
"""
    response = llm.invoke(prompt)
    return {**state, "decision": response.content}
```

## Pattern: multi-turn conversations that remember across runs

A common LangGraph use case is a chat agent that keeps context across messages. With `MemorySaver` this works within a single process. Once you restart, the chat history is gone.

With `Hipp0Checkpointer`, the chat history persists:

```python
from langgraph.graph import StateGraph, END
from typing import TypedDict, Annotated
from langgraph.graph.message import add_messages

class ChatState(TypedDict):
    messages: Annotated[list, add_messages]

def chat_node(state: ChatState) -> ChatState:
    context = inject_hipp0_context(
        client=client,
        project_id=project_id,
        agent_name="chatbot",
        task_description=state["messages"][-1].content,
    )

    system = SystemMessage(content=f"You are a helpful assistant.\n\n{context}")
    response = llm.invoke([system] + state["messages"])
    return {"messages": [response]}

graph = StateGraph(ChatState)
graph.add_node("chat", chat_node)
graph.set_entry_point("chat")
graph.add_edge("chat", END)

checkpointer = Hipp0Checkpointer(
    client=client,
    project_id=project_id,
    agent_name="chatbot",
)

app = graph.compile(checkpointer=checkpointer)

# Day 1
app.invoke(
    {"messages": [HumanMessage(content="I'm building a SaaS for dentists.")]},
    config={"configurable": {"thread_id": "user-alice"}},
)

# Day 2 (process restarted)
app.invoke(
    {"messages": [HumanMessage(content="What were we talking about?")]},
    config={"configurable": {"thread_id": "user-alice"}},
)
# -> "You mentioned you're building a SaaS for dentists..."
```

The `thread_id` is the key. Same ID = same conversation, forever. Different ID = different conversation. A user-scoped bot typically uses `thread_id=f"user:{user_id}"`.

## Pattern: using Hipp0 as a graph memory adapter

If you already have a checkpointer you like (say, `SqliteSaver` for local state) and you *just* want Hipp0 for decision extraction, use `Hipp0MemoryAdapter` instead of `Hipp0Checkpointer`:

```python
from langgraph.checkpoint.sqlite import SqliteSaver
from hipp0_langgraph import Hipp0MemoryAdapter

sqlite_cp = SqliteSaver.from_conn_string("./checkpoints.db")
hipp0_adapter = Hipp0MemoryAdapter(
    client=client,
    project_id=project_id,
    agent_name="researcher",
)

# Run your graph with the sqlite checkpointer
app = graph.compile(checkpointer=sqlite_cp)

# After each run, feed the final state to Hipp0 for extraction
final_state = app.invoke({...}, config={...})
hipp0_adapter.capture_state(final_state, thread_id="main")
```

This gives you fast local persistence *and* long-term decision memory in Hipp0. The adapter is write-only — it doesn't read checkpoints back. For reads you'd use `compile_context` directly.

## Troubleshooting

### `ImportError: No module named 'langgraph.checkpoint'`

You're on a pre-0.2 LangGraph. `BaseCheckpointSaver` moved to `langgraph.checkpoint.base` in 0.2. Upgrade:

```bash
pip install --upgrade "langgraph>=0.2.0"
```

If you're stuck on an older LangGraph for some reason, `hipp0-langgraph==0.3.*` has compatibility shims.

### `TypeError: Cannot find langgraph.checkpoint.base.BaseCheckpointSaver`

Same root cause. Also happens if two LangGraph versions are installed side-by-side (virtualenv + user install). `pip list | grep langgraph` — you should see exactly one entry.

### Checkpoints saved but `get_tuple` returns None

The `thread_id` you're reading doesn't match the one you wrote. LangGraph treats `thread_id` as opaque — typos give you empty reads silently.

Confirm what's in there:

```python
for cp in checkpointer.list({"configurable": {"thread_id": "main"}}, limit=5):
    print(cp)
```

Nothing printed? Try `list` without the thread filter:

```python
# This lists all checkpoints under this agent_name + project
for cp in checkpointer.list({"configurable": {}}, limit=20):
    print(cp.config, cp.metadata.get("step"))
```

You'll see the actual thread IDs that were used.

### Graph runs but decisions aren't captured

`auto_extract_decisions` might be off, or the distillery can't find anything structured in your state. The distillery looks for:

- `AIMessage` content with `DECISION:` / `REASONING:` markers
- State keys matching `decision`, `choice`, `conclusion`
- Text that matches the heuristic extractor (longer paragraphs with clear claims)

If your graph state is just raw LLM calls without any structure, the extractor won't find anything. Add a `record_decision` call in a sink node:

```python
def save_node(state):
    client.record_decision(
        project_id=project_id,
        title=extract_title(state["output"]),
        reasoning=state["output"],
        made_by="researcher",
    )
    return state
```

### `inject_hipp0_context` always returns "No relevant decisions"

Three usual causes:

1. **Wrong project_id.** Decisions are scoped per project. `echo $HIPP0_PROJECT_ID` and compare to the dashboard.
2. **`min_relevance` too high.** Default is 0.4. If your task description doesn't overlap semantically with stored decisions, nothing matches. Try `min_relevance=0.2` temporarily.
3. **Embeddings aren't running.** The server needs an embedding provider. Check logs: `docker logs hipp0-server | grep -i embed`. If you see "No embedding provider configured", set `HIPP0_EMBEDDING_PROVIDER=openai` or `local` and restart.

### `Hipp0Checkpointer.put()` is slow

Checkpointing at every node boundary can be slow if your state is large. A few fixes:

- **Compress harder.** `Hipp0Checkpointer(..., compression="zstd")`.
- **Checkpoint less often.** Use `interrupt_before` / `interrupt_after` to checkpoint only at specific nodes.
- **Shrink state.** Don't keep the full conversation history in state if you don't need it. Use a summary instead.
- **Run the server locally.** If the checkpointer is making HTTP calls over the internet for every node, that dominates latency. Point `HIPP0_API_URL` at a local or same-region Hipp0.

### `async` graph hangs on checkpointer call

You're using sync methods (`put`, `get_tuple`) inside an async graph. Switch to the async variants (`aput`, `aget_tuple`):

```python
# LangGraph will auto-select the right method if you compile with:
app = graph.compile(checkpointer=checkpointer)
result = await app.ainvoke(state, config=config)  # uses async methods
```

Not `app.invoke`. That's the sync path.

### Decisions appear under the wrong agent

Check `agent_name` on the checkpointer *and* on `inject_hipp0_context`. They should match for the same role. A common bug:

```python
checkpointer = Hipp0Checkpointer(..., agent_name="researcher")

# Later:
context = inject_hipp0_context(..., agent_name="research")  # typo!
```

Hipp0 treats `"researcher"` and `"research"` as different agents, so the context lookup silently returns nothing relevant.

### Multiple graphs sharing state

If you have two graphs that should share decisions (say, a "planner" and an "executor"), use the same `project_id` but different `agent_name`. Decisions made by the planner will show up in the executor's `inject_hipp0_context` calls when you set `include_upstream=True`.

```python
context = inject_hipp0_context(
    client=client,
    project_id=project_id,
    agent_name="executor",
    task_description=task,
    include_upstream=True,  # pulls planner's decisions
)
```

Don't share the same `agent_name` across graphs with different roles — you'll get noisy, misattributed context.

## Next steps

- [CrewAI guide](crewai.md) — the same patterns but for multi-agent crews
- [OpenAI Agents guide](openai-agents.md) — single-agent hook-based capture
- [Troubleshooting](../troubleshooting.md) — everything else that can break
- [Compile context deep dive](../super-brain.md) — how the 5-signal scoring works
