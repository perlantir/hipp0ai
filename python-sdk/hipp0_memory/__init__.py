"""Hipp0 Memory — zero-config decision memory for multi-agent teams."""

from hipp0_sdk.client import Hipp0Client
from .server import Hipp0Server
from .auto import auto

_server = None

def init(db_path="./hipp0.db", port=3100):
    """Start Hipp0 with zero config. One line."""
    global _server
    _server = Hipp0Server(db_path=db_path, port=port)
    _server.start()
    return Hipp0Client(
        base_url=f"http://localhost:{port}",
        api_key=_server.api_key
    )

def stop():
    """Stop the running Hipp0 server."""
    global _server
    if _server:
        _server.stop()
        _server = None
