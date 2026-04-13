"""
hipp0-openai-agents
===================
OpenAI Agents SDK integration for the Hipp0 multi-agent memory platform.

Exports
-------
Hipp0AgentHooks
    Lifecycle hooks (``on_start``, ``on_end``, ``on_tool_output``,
    ``on_handoff``) that compile Hipp0 context, capture tool outputs, and
    send conversations to the distillery automatically.
"""

from .hooks import Hipp0AgentHooks

__version__ = "0.1.0"

__all__ = [
    "Hipp0AgentHooks",
]
