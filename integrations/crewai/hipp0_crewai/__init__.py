"""
hipp0-crewai
============
CrewAI integration for the Hipp0 multi-agent memory platform.

Exports
-------
Hipp0CrewMemory
    CrewAI memory backend that compiles context from Hipp0 and sends task
    outputs to the distillery.

Hipp0CrewCallback
    Task and crew lifecycle callback that captures outputs and creates
    Hipp0 session summaries automatically.
"""

from .callback import Hipp0CrewCallback
from .memory import Hipp0CrewMemory

__version__ = "0.1.0"

__all__ = [
    "Hipp0CrewMemory",
    "Hipp0CrewCallback",
]
