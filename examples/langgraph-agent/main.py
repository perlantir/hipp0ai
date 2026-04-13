"""
LangGraph + Hipp0 Example: Research Agent with Memory
=====================================================
A stateful agent that remembers decisions across sessions.
Hipp0 provides the memory layer - no Redis or external DB needed.

Usage:
    npx @hipp0/cli init research-agent && cd research-agent && source .env
    pip install langgraph langchain-openai hipp0-memory hipp0-langgraph
    export OPENAI_API_KEY=sk-...
    python main.py "What database should we use for analytics?"
"""

import os
import sys
from typing import Annotated, TypedDict

from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import StateGraph, END
from hipp0_sdk import Hipp0Client
from hipp0_langgraph import Hipp0Checkpointer, inject_hipp0_context


# State definition
class AgentState(TypedDict):
    messages: list
    task: str
    context: str
    decision: str


def main():
    # Connect to Hipp0
    api_url = os.environ.get("HIPP0_API_URL", "http://localhost:3100")
    api_key = os.environ.get("HIPP0_API_KEY", "")
    project_id = os.environ.get("HIPP0_PROJECT_ID", "")

    if not project_id:
        print("Error: HIPP0_PROJECT_ID not set. Run: npx @hipp0/cli init my-project")
        sys.exit(1)

    task = " ".join(sys.argv[1:]) if len(sys.argv) > 1 else "What technology stack should we use?"

    client = Hipp0Client(base_url=api_url, api_key=api_key)
    llm = ChatOpenAI(model="gpt-4o-mini", temperature=0.3)

    # Hipp0 checkpointer - persists graph state across runs
    checkpointer = Hipp0Checkpointer(
        client=client,
        project_id=project_id,
        agent_name="researcher",
    )

    # Node: Load context from Hipp0
    def load_context(state: AgentState) -> AgentState:
        context = inject_hipp0_context(
            client=client,
            project_id=project_id,
            agent_name="researcher",
            task_description=state["task"],
        )
        if context and "No relevant decisions" not in context:
            print(f"\n  Loaded {len(context)} chars of past context from Hipp0")
        else:
            print("\n  No past decisions found - starting fresh")
            context = ""
        return {**state, "context": context}

    # Node: Think and decide
    def think(state: AgentState) -> AgentState:
        system_prompt = (
            "You are a senior technical advisor. When asked a question, make a "
            "clear DECISION with reasoning. Format your response as:\n\n"
            "DECISION: [clear statement of the decision]\n"
            "REASONING: [why this is the right choice]\n"
            "TRADE-OFFS: [what we're giving up]\n"
        )

        if state["context"]:
            system_prompt += (
                "\n\nYou have access to previous decisions from this project. "
                "Reference them when relevant and avoid contradicting them "
                "unless you have a strong reason.\n\n"
                f"--- Previous Decisions ---\n{state['context']}"
            )

        response = llm.invoke([
            SystemMessage(content=system_prompt),
            HumanMessage(content=state["task"]),
        ])

        return {**state, "decision": response.content, "messages": [response]}

    # Node: Save decision to Hipp0
    def save_decision(state: AgentState) -> AgentState:
        try:
            # Extract title from the decision text
            decision_text = state["decision"]
            title = state["task"][:100]

            # Look for "DECISION:" line
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
                tags=["research", "architecture"],
                affects=["builder", "reviewer"],
            )
            print(f"  Decision saved to Hipp0: {title[:60]}...")
        except Exception as e:
            print(f"  Warning: Could not save decision: {e}")

        return state

    # Build the graph
    graph = StateGraph(AgentState)
    graph.add_node("load_context", load_context)
    graph.add_node("think", think)
    graph.add_node("save_decision", save_decision)

    graph.set_entry_point("load_context")
    graph.add_edge("load_context", "think")
    graph.add_edge("think", "save_decision")
    graph.add_edge("save_decision", END)

    app = graph.compile(checkpointer=checkpointer)

    # Run
    print(f"\n{'='*60}")
    print(f"Task: {task}")
    print(f"Project: {project_id}")
    print(f"{'='*60}")

    result = app.invoke(
        {"task": task, "messages": [], "context": "", "decision": ""},
        config={"configurable": {"thread_id": "main"}},
    )

    print(f"\n{'='*60}")
    print("RESULT:")
    print(f"{'='*60}")
    print(result["decision"])
    print(f"\n{'='*60}")
    print("Decision saved! Run again with a related question to see memory in action.")
    print(f"  hipp0 list          # view all decisions")
    print(f"  hipp0 compile researcher \"your question\"  # see what context the agent gets")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
