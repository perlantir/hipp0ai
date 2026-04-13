"""
hipp0-langchain
===============
LangChain / LangGraph integration for the Hipp0 multi-agent memory platform.

Exports
-------
Hipp0Memory
    LangChain ``BaseMemory`` that compiles context from Hipp0 on every chain
    invocation and sends conversation turns to the distillery.

Hipp0CallbackHandler
    ``BaseCallbackHandler`` that automatically captures LLM, chain, and tool
    outputs and ships them to the Hipp0 distillery.

Hipp0Checkpointer
    LangGraph ``BaseCheckpointSaver`` that persists checkpoints as Hipp0
    session summaries.
"""

try:
    import langchain_core  # noqa: F401
except ImportError:
    raise ImportError(
        "hipp0-langchain requires langchain-core>=0.3.0. "
        "Install it with: pip install langchain-core"
    )

from .callback import Hipp0CallbackHandler
from .checkpointer import Hipp0Checkpointer
from .memory import Hipp0Memory

__version__ = "0.1.0"

__all__ = [
    "Hipp0Memory",
    "Hipp0CallbackHandler",
    "Hipp0Checkpointer",
]
