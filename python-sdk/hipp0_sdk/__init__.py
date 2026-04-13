"""
hipp0-sdk
=========
Official Python SDK for the Hipp0 multi-agent memory and decision platform.

Quick start::

    from hipp0_sdk import Hipp0Client

    client = Hipp0Client(base_url="http://localhost:3100", api_key="my-key")

    project = client.create_project("My Project")
    decision = client.create_decision(
        project_id=project["id"],
        title="Use PostgreSQL",
        description="Primary data store will be PostgreSQL.",
        reasoning="Team expertise and excellent JSONB support.",
        made_by="architect-agent",
    )
    context = client.compile_context(
        project_id=project["id"],
        agent_name="coder-agent",
        task_description="Implement the user authentication service.",
    )
"""

from .client import Hipp0Client
from .exceptions import (
    Hipp0ApiError,
    Hipp0AuthError,
    Hipp0ConnectionError,
    Hipp0Error,
    Hipp0NotFoundError,
    Hipp0ValidationError,
)
from .types import (
    Agent,
    Artifact,
    ContextPackage,
    Contradiction,
    Decision,
    DecisionEdge,
    DistilleryResult,
    FeedbackRecord,
    GraphResult,
    ImpactAnalysis,
    Notification,
    Project,
    SessionSummary,
    Subscription,
)

__version__ = "0.1.0"

__all__ = [
    # Client
    "Hipp0Client",
    # Exceptions
    "Hipp0Error",
    "Hipp0ApiError",
    "Hipp0NotFoundError",
    "Hipp0AuthError",
    "Hipp0ValidationError",
    "Hipp0ConnectionError",
    # Types
    "Project",
    "Agent",
    "Decision",
    "DecisionEdge",
    "GraphResult",
    "Artifact",
    "SessionSummary",
    "Notification",
    "Subscription",
    "Contradiction",
    "ContextPackage",
    "DistilleryResult",
    "ImpactAnalysis",
    "FeedbackRecord",
]
