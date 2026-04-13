# LangChain Integration

This guide shows how to integrate Hipp0 with LangChain. Hipp0 works as a persistent decision memory layer alongside LangChain's existing memory and tool systems — they solve different problems and complement each other.

LangChain's memory stores conversation history. Hipp0 stores *decisions* — structured records of what was decided, why, by whom, and what was rejected. Where LangChain memory helps an agent remember what was said, Hipp0 helps it remember what was *concluded*.

---

## Prerequisites

- Hipp0 server running (`docker compose up -d` or `hipp0 init my-project`)
- Python SDK installed: `cd python-sdk && pip install -e .`
- LangChain: `pip install langchain langchain-openai`

---

## Quick Start

```python
from langchain_openai import ChatOpenAI
from langchain.agents import create_tool_calling_agent, AgentExecutor
from langchain_core.tools import tool
from langchain_core.prompts import ChatPromptTemplate
from hipp0_sdk import Hipp0Client

hipp0 = Hipp0Client(
    base_url="http://localhost:3100",
    api_key="your-api-key",
    project_id="your-project-id",
)

@tool
def get_decision_context(task: str) -> str:
    """Get relevant past decisions before starting work on a task."""
    context = hipp0.compile(
        agent_name="langchain-agent",
        task_description=task,
    )
    return context.formatted_markdown or "No relevant decisions found."

@tool
def record_decision(title: str, description: str, reasoning: str, tags: str = "") -> str:
    """Record a decision made during this task."""
    hipp0.record_decision(
        title=title,
        description=description,
        reasoning=reasoning,
        made_by="langchain-agent",
        tags=tags.split(",") if tags else [],
        confidence="medium",
    )
    return f"Decision recorded: {title}"

tools = [get_decision_context, record_decision]
llm = ChatOpenAI(model="gpt-4o", temperature=0)

prompt = ChatPromptTemplate.from_messages([
    ("system", "You are a helpful engineering agent. Before starting any task, check for relevant past decisions. Record any significant decisions you make."),
    ("human", "{input}"),
    ("placeholder", "{agent_scratchpad}"),
])

agent = create_tool_calling_agent(llm, tools, prompt)
executor = AgentExecutor(agent=agent, tools=tools, verbose=True)

result = executor.invoke({"input": "Design the user authentication system."})
```

---

## Role-Differentiated Context

If you're running multiple LangChain agents with different roles, assign each a distinct agent name. Hipp0 will return different context per agent based on their role.

```python
# Architect agent
architect_context = hipp0.compile(
    agent_name="architect",
    task_description="design the auth system",
)

# Security agent — same task, different ranked results
security_context = hipp0.compile(
    agent_name="security",
    task_description="design the auth system",
)
```

Register agent roles so Hipp0 knows how to weight results:

```python
import requests

requests.post(
    "http://localhost:3100/api/projects/your-project-id/agents",
    headers={"Authorization": "Bearer your-api-key"},
    json={"name": "architect", "role": "builder"},
)

requests.post(
    "http://localhost:3100/api/projects/your-project-id/agents",
    headers={"Authorization": "Bearer your-api-key"},
    json={"name": "security", "role": "security"},
)
```

Available roles: `builder`, `reviewer`, `governor`, `design`, `analytics`, `security`, `ops`, `launch`, `blockchain`, `challenge`, `qa`, `docs`

---

## Using as a LangChain Memory Class

For deeper integration, use Hipp0 as a LangChain `BaseMemory` subclass:

```python
from langchain.memory import BaseMemory
from hipp0_sdk import Hipp0Client
from typing import Any, Dict, List

class Hipp0Memory(BaseMemory):
    hipp0: Any  # Hipp0Client
    agent_name: str
    memory_key: str = "decision_context"

    @property
    def memory_variables(self) -> List[str]:
        return [self.memory_key]

    def load_memory_variables(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        task = inputs.get("input", "")
        context = self.hipp0.compile(
            agent_name=self.agent_name,
            task_description=task,
        )
        return {self.memory_key: context.formatted_markdown or ""}

    def save_context(self, inputs: Dict[str, Any], outputs: Dict[str, Any]) -> None:
        # Optionally extract decisions from agent output
        # For automatic extraction, use the Distillery's passive capture
        pass

    def clear(self) -> None:
        pass

# Usage
hipp0_memory = Hipp0Memory(
    hipp0=hipp0,
    agent_name="langchain-agent",
)
```

---

## Session Memory for Multi-Step Chains

For LangChain chains that run multiple steps, use Hipp0's task sessions to maintain context across steps:

```python
# Start a session at the beginning of a chain
session = hipp0.create_session(
    task="implement user authentication end-to-end",
    agents=["architect", "builder", "reviewer"],
)
session_id = session.id

# Each chain step compiles with the session ID
def architect_step(task: str) -> str:
    context = hipp0.compile(
        agent_name="architect",
        task_description=task,
        task_session_id=session_id,
    )
    # ... architect work ...
    hipp0.record_step(
        session_id=session_id,
        agent_name="architect",
        task=task,
        output="Designed JWT-based auth with refresh token rotation.",
        status="complete",
    )
    return "Architecture complete"

def builder_step(task: str) -> str:
    # Builder sees architect's step output automatically
    context = hipp0.compile(
        agent_name="builder",
        task_description=task,
        task_session_id=session_id,
    )
    # context includes architect's prior step
    # ...
```

---

## Extracting Decisions from Chain Outputs

Use passive capture to automatically extract decisions from a completed chain's output:

```python
import requests

# After a chain run, submit the output for automatic decision extraction
response = requests.post(
    "http://localhost:3100/api/capture",
    headers={
        "Authorization": "Bearer your-api-key",
        "Content-Type": "application/json",
    },
    json={
        "agent_name": "langchain-agent",
        "project_id": "your-project-id",
        "conversation": chain_output,  # Full chain output as string
        "source": "api",
    },
)
capture_id = response.json()["capture_id"]
# Extracted decisions enter the review queue for approval
```

See [docs/distillery.md](../distillery.md) and [docs/passive-capture.md](../passive-capture.md).

---

## H0C Format for Token-Constrained Chains

If your chain has limited context window space, use the H0C compact format:

```python
context = hipp0.compile(
    agent_name="builder",
    task_description="implement auth",
    format="h0c",  # 10-12x token reduction
)

# Inject directly into your prompt
prompt = f"Past decisions:\n{context.h0c}\n\nTask: implement auth"
```

---

## Related Docs

- [Python SDK](../python-sdk.md) — full SDK reference
- [Distillery](../distillery.md) — auto-extract decisions from conversations
- [Passive Capture](../passive-capture.md) — submit transcripts for extraction
- [Super Brain](../super-brain.md) — multi-step session memory
- [H0C Format](../h0c-format.md) — compact context format
