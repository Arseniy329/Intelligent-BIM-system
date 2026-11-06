"""Shared row lookup and owner/admin check for drawing-scoped endpoints."""

from typing import Any
from uuid import UUID

from fastapi import HTTPException, status
from supabase import Client

from src.core.auth import CurrentUser


def first_row(response: Any) -> dict[str, Any] | None:
    rows = getattr(response, "data", None)
    if isinstance(rows, list) and rows and isinstance(rows[0], dict):
        return rows[0]
    return None


def all_rows(response: Any) -> list[dict[str, Any]]:
    rows = getattr(response, "data", None)
    if not isinstance(rows, list):
        return []
    return [row for row in rows if isinstance(row, dict)]


def get_drawing_for_user(
    supabase: Client, drawing_id: UUID | str, current_user: CurrentUser
) -> dict[str, Any]:
    """Return the drawing row if it exists and belongs to the user (or user is admin).

    Uses ``.limit(1)`` instead of ``.single()``: the latter raises on a missing
    row, which would surface as a 500 instead of a 404.
    """
    drawing = first_row(
        supabase.table("drawings")
        .select("id, owner_id, status, units")
        .eq("id", str(drawing_id))
        .limit(1)
        .execute()
    )
    if drawing is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Drawing not found"
        )

    if str(drawing.get("owner_id")) != current_user.id and current_user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")

    return drawing
