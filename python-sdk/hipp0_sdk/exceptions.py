"""
Hipp0 SDK — Exceptions
======================
All SDK-specific exception types.
"""

from __future__ import annotations


class Hipp0Error(Exception):
    """Base class for all Hipp0 SDK errors."""


class Hipp0ApiError(Hipp0Error):
    """Raised when the Hipp0 API returns a non-2xx HTTP response."""

    def __init__(self, status_code: int, message: str, response_body: dict | None = None) -> None:
        self.status_code = status_code
        self.message = message
        self.response_body = response_body or {}
        super().__init__(f"HTTP {status_code}: {message}")


class Hipp0NotFoundError(Hipp0ApiError):
    """Raised on HTTP 404 responses."""


class Hipp0AuthError(Hipp0ApiError):
    """Raised on HTTP 401 / 403 responses."""


class Hipp0ValidationError(Hipp0ApiError):
    """Raised on HTTP 422 validation failures."""


class Hipp0ConnectionError(Hipp0Error):
    """Raised when the SDK cannot reach the Hipp0 server."""


__all__ = [
    "Hipp0Error",
    "Hipp0ApiError",
    "Hipp0NotFoundError",
    "Hipp0AuthError",
    "Hipp0ValidationError",
    "Hipp0ConnectionError",
]
