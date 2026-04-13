# hipp0-langgraph

Hipp0 integration for [LangGraph](https://langchain-ai.github.io/langgraph/) - persistent decision memory and checkpointing for LangGraph agents.

## Installation

```bash
pip install hipp0-langgraph
```

## Usage

### Checkpointer

```python
from hipp0_sdk import Hipp0Client
from hipp0_langgraph import Hipp0Checkpointer
from langgraph.graph import StateGraph

client = Hipp0Client(base_url="http://localhost:3100")
checkpointer = Hipp0Checkpointer(
    client=client,
    project_id="your-project-id",
    agent_name="orchestrator",
)

graph = StateGraph(MyState)
# ... add nodes / edges ...
app = graph.compile(checkpointer=checkpointer)
```

### Context Injection

```python
from hipp0_langgraph import inject_hipp0_context

def my_node(state):
    context = inject_hipp0_context(
        client=client,
        project_id="your-project-id",
        agent_name="builder",
        task_description=state["task"],
    )
    # Use context in your agent's system message
    return {"context": context, **state}
```
