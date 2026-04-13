"""
hipp0.auto() - Zero-config auto-instrumentation for AI agent memory.

Usage
-----
    import hipp0_memory
    hipp0_memory.auto()

    # Your existing agent / LLM code works unchanged
    from openai import OpenAI
    client = OpenAI()
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": "Design the auth system"}],
    )
    # Behind the scenes:
    #   - Relevant Hipp0 context was prepended to the system message
    #   - The resulting conversation was sent to Hipp0's capture endpoint
    #     in a background thread for decision extraction.

Design principles
-----------------
* ZERO config beyond environment variables.
* NEVER block or add latency — capture runs in a daemon thread.
* NEVER crash user code — every hook is wrapped in try/except.
* NEVER patch twice — patching is idempotent.
* NEVER require optional LLM SDKs — if they're not installed, the
  corresponding patch is skipped silently.
"""

from __future__ import annotations

import logging
import os
import sys
import threading
from typing import Any, Optional

logger = logging.getLogger("hipp0.auto")

# ---------------------------------------------------------------------------
# Module-level state
# ---------------------------------------------------------------------------

_client: Any = None
_project_id: str = ""
_agent_name: str = "auto"
_enabled: bool = False
_inject_context: bool = True
_capture_conversations: bool = True

# Idempotency flags so auto() can be called multiple times safely.
_openai_patched: bool = False
_anthropic_patched: bool = False

# Remember originals so tests / advanced users can undo the patching.
_original_openai_create: Any = None
_original_openai_acreate: Any = None
_original_anthropic_create: Any = None
_original_anthropic_acreate: Any = None


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def auto(
    api_url: Optional[str] = None,
    api_key: Optional[str] = None,
    project_id: Optional[str] = None,
    agent_name: str = "auto",
    inject_context: bool = True,
    capture_conversations: bool = True,
) -> None:
    """Enable automatic decision capture and context injection.

    Call once at application startup. Configuration is read from environment
    variables if not passed explicitly:

    * ``HIPP0_API_URL``    — Hipp0 server URL (default ``http://localhost:3100``)
    * ``HIPP0_API_KEY``    — Optional bearer token
    * ``HIPP0_PROJECT_ID`` — Project UUID (required)

    Parameters
    ----------
    api_url, api_key, project_id:
        Override the corresponding environment variable.
    agent_name:
        Logical agent name attached to captured conversations (default ``"auto"``).
    inject_context:
        When ``True`` (default), prepend compiled Hipp0 context to the system
        message of every patched LLM call.
    capture_conversations:
        When ``True`` (default), fire-and-forget each completed conversation
        to Hipp0's capture endpoint in a background thread.
    """
    global _client, _project_id, _agent_name, _enabled
    global _inject_context, _capture_conversations

    url = api_url or os.environ.get("HIPP0_API_URL", "http://localhost:3100")
    key = api_key or os.environ.get("HIPP0_API_KEY", "")
    _project_id = project_id or os.environ.get("HIPP0_PROJECT_ID", "")
    _agent_name = agent_name
    _inject_context = inject_context
    _capture_conversations = capture_conversations

    if not _project_id:
        logger.warning(
            "hipp0.auto(): HIPP0_PROJECT_ID not set. Auto-capture disabled."
        )
        return

    try:
        from hipp0_sdk.client import Hipp0Client

        _client = Hipp0Client(base_url=url, api_key=key)
        _enabled = True
        logger.info(
            "hipp0.auto(): Enabled (project=%s..., url=%s)",
            _project_id[:8],
            url,
        )
    except Exception as e:  # pragma: no cover - defensive
        logger.warning("hipp0.auto(): Failed to initialize Hipp0Client: %s", e)
        _enabled = False
        return

    # Detect the agent framework the developer is using purely for
    # observability — does not change any behaviour.
    framework = _detect_framework()
    if framework:
        logger.info("hipp0.auto(): Detected agent framework: %s", framework)

    if inject_context or capture_conversations:
        _patch_openai()
        _patch_anthropic()


# ---------------------------------------------------------------------------
# Framework detection (observability-only)
# ---------------------------------------------------------------------------


def _detect_framework() -> Optional[str]:
    """Return the first known agent framework present in ``sys.modules``."""
    known = [
        ("crewai", "CrewAI"),
        ("langgraph", "LangGraph"),
        ("langchain", "LangChain"),
        ("llama_index", "LlamaIndex"),
        ("autogen", "AutoGen"),
        ("haystack", "Haystack"),
        ("semantic_kernel", "Semantic Kernel"),
        ("pydantic_ai", "Pydantic AI"),
    ]
    for mod_name, label in known:
        if mod_name in sys.modules:
            return label
    # Lightweight importlib probe for installed-but-not-imported frameworks
    try:
        import importlib.util

        for mod_name, label in known:
            if importlib.util.find_spec(mod_name) is not None:
                return label
    except Exception:
        pass
    return None


# ---------------------------------------------------------------------------
# Context compilation + async capture
# ---------------------------------------------------------------------------


def _compile_context(task: str) -> str:
    """Return compiled Hipp0 context for *task*, or empty string on failure."""
    if not _enabled or not _client or not _inject_context:
        return ""
    try:
        result = _client.compile_context(
            project_id=_project_id,
            agent_name=_agent_name,
            task_description=(task or "")[:500],
        )
        md = ""
        if isinstance(result, dict):
            md = result.get("formatted_markdown") or result.get("markdown") or ""
        if md and "No relevant decisions" not in md:
            return md
    except Exception as e:
        logger.debug("hipp0.auto(): context compile failed: %s", e)
    return ""


def _capture_async(conversation: str) -> None:
    """Fire-and-forget send of a conversation to the capture endpoint."""
    if not _enabled or not _client or not _capture_conversations:
        return
    if not conversation:
        return

    payload = {
        "project_id": _project_id,
        "agent_name": _agent_name,
        "content": conversation[:50000],
        "source": "auto",
    }

    def _send() -> None:
        try:
            # Prefer a public capture method if one exists, otherwise fall
            # back to the internal _post helper which is always available on
            # Hipp0Client.
            post = getattr(_client, "_post", None)
            if post is None:
                return
            post("/api/capture", payload)
        except Exception as e:
            logger.debug("hipp0.auto(): capture failed: %s", e)

    try:
        threading.Thread(target=_send, daemon=True).start()
    except Exception as e:  # pragma: no cover - defensive
        logger.debug("hipp0.auto(): could not spawn capture thread: %s", e)


# ---------------------------------------------------------------------------
# Helpers for message manipulation
# ---------------------------------------------------------------------------


def _inject_system_context(messages: Any, context_md: str) -> Any:
    """Return a new message list with *context_md* prepended to the system prompt.

    Works with both OpenAI-style ``[{"role": ..., "content": ...}]`` and
    Anthropic-style lists. Never mutates the caller's list.
    """
    if not context_md:
        return messages
    if not isinstance(messages, list):
        return messages

    header = (
        "## Relevant prior decisions (from Hipp0 memory)\n"
        f"{context_md}\n"
        "---\n"
    )

    new_messages = list(messages)
    # Find an existing system message (OpenAI convention only — for Anthropic
    # the system prompt lives on the top-level ``system`` kwarg).
    for i, m in enumerate(new_messages):
        if isinstance(m, dict) and m.get("role") == "system":
            existing = m.get("content", "")
            if isinstance(existing, str):
                merged = header + existing
            else:
                # content parts list: prepend a text part
                merged = [{"type": "text", "text": header}] + list(existing)
            new_messages[i] = {**m, "content": merged}
            return new_messages

    # No system message — insert one at the top.
    new_messages.insert(0, {"role": "system", "content": header})
    return new_messages


def _extract_last_user_task(messages: Any) -> str:
    """Pull the most recent user message text for context compilation."""
    if not isinstance(messages, list):
        return ""
    for m in reversed(messages):
        if not isinstance(m, dict):
            continue
        if m.get("role") != "user":
            continue
        content = m.get("content", "")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            parts = []
            for p in content:
                if isinstance(p, dict):
                    txt = p.get("text") or p.get("content") or ""
                    if isinstance(txt, str):
                        parts.append(txt)
                elif isinstance(p, str):
                    parts.append(p)
            return "\n".join(parts)
    return ""


def _serialize_conversation(messages: Any, response: Any) -> str:
    """Best-effort serialize request messages + assistant reply into plain text."""
    lines: list[str] = []

    if isinstance(messages, list):
        for m in messages:
            if isinstance(m, dict):
                role = m.get("role", "unknown")
                content = m.get("content", "")
                if isinstance(content, list):
                    parts = []
                    for p in content:
                        if isinstance(p, dict):
                            parts.append(str(p.get("text") or p.get("content") or ""))
                        else:
                            parts.append(str(p))
                    content = "\n".join(parts)
                lines.append(f"{role}: {content}")

    reply_text = _extract_response_text(response)
    if reply_text:
        lines.append(f"assistant: {reply_text}")

    return "\n\n".join(lines)


def _extract_response_text(response: Any) -> str:
    """Pull assistant text out of an OpenAI or Anthropic response object."""
    if response is None:
        return ""
    # OpenAI v1 ChatCompletion
    try:
        choices = getattr(response, "choices", None)
        if choices:
            first = choices[0]
            msg = getattr(first, "message", None)
            if msg is not None:
                content = getattr(msg, "content", None)
                if isinstance(content, str):
                    return content
                if isinstance(content, list):
                    return "\n".join(
                        str(getattr(p, "text", "") or (p.get("text", "") if isinstance(p, dict) else ""))
                        for p in content
                    )
    except Exception:
        pass
    # Anthropic Messages
    try:
        content = getattr(response, "content", None)
        if isinstance(content, list):
            parts = []
            for block in content:
                text = getattr(block, "text", None)
                if text is None and isinstance(block, dict):
                    text = block.get("text")
                if text:
                    parts.append(str(text))
            if parts:
                return "\n".join(parts)
    except Exception:
        pass
    # Last-resort string coercion
    try:
        return str(response)
    except Exception:
        return ""


# ---------------------------------------------------------------------------
# OpenAI patch (v1 client)
# ---------------------------------------------------------------------------


def _patch_openai() -> None:
    """Monkey-patch ``openai.resources.chat.completions.Completions.create``."""
    global _openai_patched, _original_openai_create, _original_openai_acreate

    if _openai_patched:
        return

    try:
        import openai  # noqa: F401
        from openai.resources.chat.completions import (  # type: ignore
            Completions,
        )
    except Exception:
        logger.debug("hipp0.auto(): openai not installed; skipping OpenAI patch")
        return

    try:
        _original_openai_create = Completions.create

        def _wrapped_create(self: Any, *args: Any, **kwargs: Any) -> Any:
            messages = kwargs.get("messages")
            try:
                if _inject_context and messages is not None:
                    task = _extract_last_user_task(messages)
                    ctx = _compile_context(task)
                    if ctx:
                        kwargs["messages"] = _inject_system_context(messages, ctx)
            except Exception as e:
                logger.debug("hipp0.auto(): openai inject failed: %s", e)

            response = _original_openai_create(self, *args, **kwargs)

            try:
                if _capture_conversations:
                    convo = _serialize_conversation(
                        kwargs.get("messages", messages), response
                    )
                    _capture_async(convo)
            except Exception as e:
                logger.debug("hipp0.auto(): openai capture failed: %s", e)

            return response

        Completions.create = _wrapped_create  # type: ignore[assignment]
    except Exception as e:
        logger.warning("hipp0.auto(): failed to patch OpenAI sync create: %s", e)
        return

    # Async client — best effort. Only patch if the class is present.
    try:
        from openai.resources.chat.completions import (  # type: ignore
            AsyncCompletions,
        )

        _original_openai_acreate = AsyncCompletions.create

        async def _wrapped_acreate(self: Any, *args: Any, **kwargs: Any) -> Any:
            messages = kwargs.get("messages")
            try:
                if _inject_context and messages is not None:
                    task = _extract_last_user_task(messages)
                    ctx = _compile_context(task)
                    if ctx:
                        kwargs["messages"] = _inject_system_context(messages, ctx)
            except Exception as e:
                logger.debug("hipp0.auto(): openai async inject failed: %s", e)

            response = await _original_openai_acreate(self, *args, **kwargs)

            try:
                if _capture_conversations:
                    convo = _serialize_conversation(
                        kwargs.get("messages", messages), response
                    )
                    _capture_async(convo)
            except Exception as e:
                logger.debug("hipp0.auto(): openai async capture failed: %s", e)

            return response

        AsyncCompletions.create = _wrapped_acreate  # type: ignore[assignment]
    except Exception as e:
        logger.debug("hipp0.auto(): async OpenAI patch skipped: %s", e)

    _openai_patched = True
    logger.info("hipp0.auto(): OpenAI client patched")


# ---------------------------------------------------------------------------
# Anthropic patch
# ---------------------------------------------------------------------------


def _patch_anthropic() -> None:
    """Monkey-patch ``anthropic.resources.messages.Messages.create``."""
    global _anthropic_patched, _original_anthropic_create, _original_anthropic_acreate

    if _anthropic_patched:
        return

    try:
        import anthropic  # noqa: F401
        from anthropic.resources.messages import Messages  # type: ignore
    except Exception:
        logger.debug("hipp0.auto(): anthropic not installed; skipping Anthropic patch")
        return

    def _inject_anthropic_system(kwargs: dict, ctx: str) -> None:
        """Prepend *ctx* to Anthropic's top-level ``system`` parameter."""
        if not ctx:
            return
        header = (
            "## Relevant prior decisions (from Hipp0 memory)\n"
            f"{ctx}\n"
            "---\n"
        )
        existing = kwargs.get("system")
        if existing is None:
            kwargs["system"] = header
        elif isinstance(existing, str):
            kwargs["system"] = header + existing
        elif isinstance(existing, list):
            kwargs["system"] = [{"type": "text", "text": header}] + list(existing)

    try:
        _original_anthropic_create = Messages.create

        def _wrapped_create(self: Any, *args: Any, **kwargs: Any) -> Any:
            messages = kwargs.get("messages")
            try:
                if _inject_context:
                    task = _extract_last_user_task(messages)
                    ctx = _compile_context(task)
                    if ctx:
                        _inject_anthropic_system(kwargs, ctx)
            except Exception as e:
                logger.debug("hipp0.auto(): anthropic inject failed: %s", e)

            response = _original_anthropic_create(self, *args, **kwargs)

            try:
                if _capture_conversations:
                    convo = _serialize_conversation(messages, response)
                    _capture_async(convo)
            except Exception as e:
                logger.debug("hipp0.auto(): anthropic capture failed: %s", e)

            return response

        Messages.create = _wrapped_create  # type: ignore[assignment]
    except Exception as e:
        logger.warning("hipp0.auto(): failed to patch Anthropic sync create: %s", e)
        return

    # Async client — best effort.
    try:
        from anthropic.resources.messages import AsyncMessages  # type: ignore

        _original_anthropic_acreate = AsyncMessages.create

        async def _wrapped_acreate(self: Any, *args: Any, **kwargs: Any) -> Any:
            messages = kwargs.get("messages")
            try:
                if _inject_context:
                    task = _extract_last_user_task(messages)
                    ctx = _compile_context(task)
                    if ctx:
                        _inject_anthropic_system(kwargs, ctx)
            except Exception as e:
                logger.debug("hipp0.auto(): anthropic async inject failed: %s", e)

            response = await _original_anthropic_acreate(self, *args, **kwargs)

            try:
                if _capture_conversations:
                    convo = _serialize_conversation(messages, response)
                    _capture_async(convo)
            except Exception as e:
                logger.debug("hipp0.auto(): anthropic async capture failed: %s", e)

            return response

        AsyncMessages.create = _wrapped_acreate  # type: ignore[assignment]
    except Exception as e:
        logger.debug("hipp0.auto(): async Anthropic patch skipped: %s", e)

    _anthropic_patched = True
    logger.info("hipp0.auto(): Anthropic client patched")


# ---------------------------------------------------------------------------
# Public helpers for tests / advanced users
# ---------------------------------------------------------------------------


def is_enabled() -> bool:
    """Return ``True`` if :func:`auto` successfully initialised the client."""
    return _enabled


def disable() -> None:
    """Undo all monkey-patching and disable capture. Primarily for tests."""
    global _openai_patched, _anthropic_patched, _enabled

    if _openai_patched:
        try:
            from openai.resources.chat.completions import (  # type: ignore
                Completions,
            )

            if _original_openai_create is not None:
                Completions.create = _original_openai_create  # type: ignore[assignment]
            try:
                from openai.resources.chat.completions import (  # type: ignore
                    AsyncCompletions,
                )

                if _original_openai_acreate is not None:
                    AsyncCompletions.create = _original_openai_acreate  # type: ignore[assignment]
            except Exception:
                pass
        except Exception:
            pass
        _openai_patched = False

    if _anthropic_patched:
        try:
            from anthropic.resources.messages import Messages  # type: ignore

            if _original_anthropic_create is not None:
                Messages.create = _original_anthropic_create  # type: ignore[assignment]
            try:
                from anthropic.resources.messages import AsyncMessages  # type: ignore

                if _original_anthropic_acreate is not None:
                    AsyncMessages.create = _original_anthropic_acreate  # type: ignore[assignment]
            except Exception:
                pass
        except Exception:
            pass
        _anthropic_patched = False

    _enabled = False
