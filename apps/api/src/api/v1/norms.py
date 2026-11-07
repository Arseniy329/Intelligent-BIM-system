"""FastAPI router for norms search (BIM-163).

Re-exports norms router for API v1 routing.
"""

from src.modules.norms.router import lookup_norms, router

__all__ = ["lookup_norms", "router"]

