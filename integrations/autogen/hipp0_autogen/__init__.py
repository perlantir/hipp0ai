"""
hipp0-autogen
=============
Microsoft AutoGen integration for the Hipp0 multi-agent memory platform.

Exports
-------
Hipp0AutoGenMemory
    Memory backend for AutoGen agents that compiles context from Hipp0,
    buffers messages for periodic distillation, and creates session summaries.
"""

from .memory import Hipp0AutoGenMemory

__version__ = "0.1.0"

__all__ = [
    "Hipp0AutoGenMemory",
]
