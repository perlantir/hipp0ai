"""
hipp0-langgraph -- Checkpoint Saver
====================================
A LangGraph ``BaseCheckpointSaver`` that persists graph state to Hipp0
session summaries.

Usage::

    from hipp0_sdk import Hipp0Client
    from hipp0_langgraph import Hipp0Checkpointer
    from langgraph.graph import StateGraph

    client = Hipp0Client()
    checkpointer = Hipp0Checkpointer(
        client=client,
        project_id="proj-123",
        agent_name="orchestrator",
    )

    graph = StateGraph(MyState)
    # ... add nodes / edges ...
    app = graph.compile(checkpointer=checkpointer)
    result = app.invoke({"input": "Design the auth flow"}, config={"configurable": {"thread_id": "t1"}})
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any, Iterator

from hipp0_sdk import Hipp0Client
from hipp0_sdk.exceptions import Hipp0Error

try:
    from langchain_core.runnables import RunnableConfig
except ImportError as exc:
    raise ImportError(
        "langchain-core is required. Install: pip install langchain-core>=0.3.0"
    ) from exc

try:
    from langgraph.checkpoint.base import (
        BaseCheckpointSaver,
        Checkpoint,
        CheckpointMetadata,
        CheckpointTuple,
        get_checkpoint_id,
    )
except ImportError as exc:
    raise ImportError(
        "langgraph-checkpoint is required. Install: pip install langgraph-checkpoint>=2.0.0"
    ) from exc

logger = logging.getLogger(__name__)

_CHECKPOINT_TAG = "langgraph-checkpoint"


class Hipp0Checkpointer(BaseCheckpointSaver):
    """
    LangGraph checkpoint saver backed by Hipp0 session summaries.

    Each ``put`` serialises the LangGraph checkpoint to JSON and stores it
    as a Hipp0 session summary.  Each ``get`` queries the most recent
    session summary for the thread and deserialises it.

    Parameters
    ----------
    client : Hipp0Client
        An initialised Hipp0 client.
    project_id : str
        Hipp0 project ID.
    agent_name : str
        Agent name for context compilation.
    task_description : str
        Default task description for context compilation.
    """

    def __init__(
        self,
        client: Hipp0Client,
        project_id: str,
        agent_name: str,
        task_description: str = "Continue the current task.",
    ) -> None:
        super().__init__()
        self.client = client
        self.project_id = project_id
        self.agent_name = agent_name
        self.task_description = task_description

    def get_tuple(self, config: RunnableConfig) -> CheckpointTuple | None:
        """Retrieve the most recent checkpoint for the given thread."""
        thread_id = (config.get("configurable") or {}).get("thread_id")
        checkpoint_id = get_checkpoint_id(config)

        try:
            sessions = self.client.list_session_summaries(
                project_id=self.project_id,
                agent_name=self.agent_name,
                limit=50,
            )
        except Hipp0Error as exc:
            logger.warning("Hipp0Checkpointer.get_tuple: %s", exc)
            return None

        candidates = [
            s for s in sessions
            if s.get("metadata", {}).get("thread_id") == thread_id
            and _CHECKPOINT_TAG in s.get("metadata", {}).get("tags", [])
        ]
        if not candidates:
            return None

        if checkpoint_id:
            candidates = [
                c for c in candidates
                if c.get("metadata", {}).get("checkpoint_id") == checkpoint_id
            ]
            if not candidates:
                return None

        latest = candidates[-1]
        return self._to_tuple(latest, config)

    def list(
        self,
        config: RunnableConfig,
        *,
        filter: dict[str, Any] | None = None,
        before: RunnableConfig | None = None,
        limit: int | None = None,
    ) -> Iterator[CheckpointTuple]:
        """Yield all checkpoints for the given thread, newest first."""
        thread_id = (config.get("configurable") or {}).get("thread_id")
        try:
            sessions = self.client.list_session_summaries(
                project_id=self.project_id,
                agent_name=self.agent_name,
                limit=limit or 100,
            )
        except Hipp0Error as exc:
            logger.warning("Hipp0Checkpointer.list: %s", exc)
            return

        for session in reversed(sessions):
            meta = session.get("metadata", {})
            if meta.get("thread_id") != thread_id:
                continue
            if _CHECKPOINT_TAG not in meta.get("tags", []):
                continue
            tup = self._to_tuple(session, config)
            if tup is not None:
                yield tup

    def put(
        self,
        config: RunnableConfig,
        checkpoint: Checkpoint,
        metadata: CheckpointMetadata,
        new_versions: dict[str, Any],
    ) -> RunnableConfig:
        """Persist a LangGraph checkpoint as a Hipp0 session summary."""
        thread_id = (config.get("configurable") or {}).get("thread_id")
        checkpoint_id = checkpoint.get("id")

        channel_values = checkpoint.get("channel_values", {})
        decision_ids = channel_values.get("decisions", [])
        if isinstance(decision_ids, str):
            decision_ids = [decision_ids]

        summary = " | ".join([
            f"LangGraph checkpoint for thread '{thread_id}'",
            f"Checkpoint ID: {checkpoint_id}",
            f"Step: {metadata.get('step', '?')}",
        ])

        try:
            self.client.create_session_summary(
                project_id=self.project_id,
                agent_name=self.agent_name,
                summary=summary,
                decision_ids=decision_ids or None,
                ended_at=datetime.now(tz=timezone.utc).isoformat(),
                metadata={
                    "thread_id": thread_id,
                    "checkpoint_id": checkpoint_id,
                    "tags": [_CHECKPOINT_TAG],
                    "checkpoint_payload": json.dumps(checkpoint, default=str),
                    "langgraph_metadata": metadata,
                },
            )
        except Hipp0Error as exc:
            logger.warning("Hipp0Checkpointer.put: %s", exc)

        return {
            **config,
            "configurable": {
                **(config.get("configurable") or {}),
                "checkpoint_id": checkpoint_id,
                "thread_id": thread_id,
            },
        }

    def _to_tuple(self, session: dict[str, Any], config: RunnableConfig) -> CheckpointTuple | None:
        meta = session.get("metadata", {})
        payload = meta.get("checkpoint_payload", "")
        if not payload:
            return None
        try:
            checkpoint: Checkpoint = json.loads(payload)
        except json.JSONDecodeError:
            return None

        return CheckpointTuple(
            config={
                **config,
                "configurable": {
                    **(config.get("configurable") or {}),
                    "thread_id": meta.get("thread_id", ""),
                    "checkpoint_id": meta.get("checkpoint_id", ""),
                },
            },
            checkpoint=checkpoint,
            metadata=meta.get("langgraph_metadata", {}),
            parent_config=None,
        )
