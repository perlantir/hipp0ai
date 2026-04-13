"""
hipp0-langgraph -- Context Injection
=====================================
Helper to inject Hipp0 compiled context into LangGraph node functions.

Usage::

    from hipp0_sdk import Hipp0Client
    from hipp0_langgraph import inject_hipp0_context

    client = Hipp0Client()

    def my_node(state):
        context = inject_hipp0_context(
            client=client,
            project_id="proj-123",
            agent_name="builder",
            task_description=state["task"],
        )
        # Prepend context to the agent's system message
        return {"messages": [SystemMessage(content=context)] + state["messages"]}
"""

from __future__ import annotations

import logging
from typing import Any

from hipp0_sdk import Hipp0Client
from hipp0_sdk.exceptions import Hipp0Error

logger = logging.getLogger(__name__)


def inject_hipp0_context(
    client: Hipp0Client,
    project_id: str,
    agent_name: str,
    task_description: str,
    max_tokens: int | None = None,
    session_id: str | None = None,
) -> str:
    """
    Compile context from Hipp0 for use in a LangGraph node.

    Returns the compiled markdown context string, or an empty string
    if the compile fails.

    Parameters
    ----------
    client : Hipp0Client
        An initialised Hipp0 client.
    project_id : str
        Hipp0 project ID.
    agent_name : str
        The agent requesting context.
    task_description : str
        What the agent is working on.
    max_tokens : int, optional
        Token budget for the context window.
    session_id : str, optional
        Session ID for session-aware compilation.
    """
    try:
        result = client.compile_context(
            project_id=project_id,
            agent_name=agent_name,
            task_description=task_description,
            max_tokens=max_tokens,
            task_session_id=session_id,
        )
        return result.get("formatted_markdown", "")
    except Hipp0Error as exc:
        logger.warning("inject_hipp0_context failed: %s", exc)
        return ""
