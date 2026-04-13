"""
CrewAI + Hipp0 Example: Software Architecture Team
===================================================
Three agents collaborate on architecture decisions. Hipp0 captures every
decision and compiles role-specific context for each agent automatically.

Usage:
    npx @hipp0/cli init arch-team && cd arch-team && source .env
    pip install crewai hipp0-memory hipp0-crewai
    export OPENAI_API_KEY=sk-...
    python main.py
"""

import os
import sys

from crewai import Agent, Crew, Task
from hipp0_sdk import Hipp0Client
from hipp0_crewai import Hipp0CrewCallback


def main():
    # Connect to Hipp0 (reads from .env via source)
    api_url = os.environ.get("HIPP0_API_URL", "http://localhost:3100")
    api_key = os.environ.get("HIPP0_API_KEY", "")
    project_id = os.environ.get("HIPP0_PROJECT_ID", "")

    if not project_id:
        print("Error: HIPP0_PROJECT_ID not set. Run: npx @hipp0/cli init my-project")
        sys.exit(1)

    client = Hipp0Client(base_url=api_url, api_key=api_key)

    # Create Hipp0 callback - auto-captures decisions from agent outputs
    hipp0_cb = Hipp0CrewCallback(client=client, project_id=project_id)

    # Compile past context for each agent (role-specific)
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

    # Define the task we're working on
    task_topic = "Design a real-time notification system for a SaaS platform"

    # Build role-specific context from past decisions
    arch_context = get_context("architect", task_topic)
    build_context = get_context("builder", task_topic)
    review_context = get_context("reviewer", task_topic)

    # Define agents
    architect = Agent(
        role="Software Architect",
        goal="Make clear, well-reasoned architecture decisions",
        backstory=(
            "You are a senior architect. Make explicit decisions about technology "
            "choices, patterns, and trade-offs. State each decision clearly with "
            "the format: 'DECISION: [title] - REASONING: [why]'"
            f"{arch_context}"
        ),
        verbose=True,
    )

    builder = Agent(
        role="Senior Developer",
        goal="Implement the architecture following established decisions",
        backstory=(
            "You are a senior developer. Follow the architect's decisions exactly. "
            "When you make implementation choices, state them as: "
            "'DECISION: [title] - REASONING: [why]'"
            f"{build_context}"
        ),
        verbose=True,
    )

    reviewer = Agent(
        role="Code Reviewer",
        goal="Review implementation against architecture decisions",
        backstory=(
            "You are a code reviewer. Check that the implementation follows all "
            "established architecture decisions. Flag any contradictions. "
            "State findings as: 'DECISION: [title] - REASONING: [why]'"
            f"{review_context}"
        ),
        verbose=True,
    )

    # Define tasks
    design_task = Task(
        description=(
            f"Design the architecture for: {task_topic}\n\n"
            "Make at least 3 explicit decisions about:\n"
            "1. Communication protocol (WebSocket vs SSE vs polling)\n"
            "2. Message queue technology\n"
            "3. Delivery guarantees (at-least-once vs exactly-once)\n\n"
            "Format each decision clearly."
        ),
        agent=architect,
        expected_output="A list of architecture decisions with reasoning",
    )

    implement_task = Task(
        description=(
            f"Based on the architecture decisions, outline the implementation for: {task_topic}\n\n"
            "Cover:\n"
            "1. Key components and their responsibilities\n"
            "2. Data flow between components\n"
            "3. Error handling strategy\n\n"
            "Reference the architect's decisions explicitly."
        ),
        agent=builder,
        expected_output="Implementation plan referencing architecture decisions",
    )

    review_task = Task(
        description=(
            f"Review the implementation plan for: {task_topic}\n\n"
            "Check:\n"
            "1. Does it follow all architecture decisions?\n"
            "2. Are there any contradictions with past decisions?\n"
            "3. Any missing error handling or edge cases?\n\n"
            "Flag any issues found."
        ),
        agent=reviewer,
        expected_output="Review findings with pass/fail for each decision",
    )

    # Run the crew
    crew = Crew(
        agents=[architect, builder, reviewer],
        tasks=[design_task, implement_task, review_task],
        verbose=True,
        task_callback=hipp0_cb.on_task_complete,
    )

    print(f"\n{'='*60}")
    print(f"Running crew: {task_topic}")
    print(f"Hipp0 project: {project_id}")
    print(f"{'='*60}\n")

    result = crew.kickoff()

    # Send full conversation to Hipp0 for decision extraction
    hipp0_cb.on_crew_complete(crew_output=str(result))

    print(f"\n{'='*60}")
    print("Done! Decisions have been captured in Hipp0.")
    print(f"Run again to see agents use past context.")
    print(f"\nView decisions: hipp0 list")
    print(f"Compile context: hipp0 compile architect \"{task_topic}\"")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
