from datetime import UTC, datetime
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from supabase import Client

from src.contracts.generated import Room, RoomType, RoomUpdateRequest
from src.core.auth import CurrentUser, get_current_user
from src.infrastructure.supabase import get_supabase_client
from src.modules.rooms.service import get_room_types, room_from_row, room_type_exists

router = APIRouter(tags=["rooms"])


def _first_row(response: Any) -> dict[str, Any] | None:
    rows = getattr(response, "data", None)
    if isinstance(rows, list) and rows and isinstance(rows[0], dict):
        return rows[0]
    return None


def _get_room_for_user(
    supabase: Client, room_id: UUID, current_user: CurrentUser
) -> dict[str, Any]:
    """Return the room row if it exists and its drawing belongs to the user."""
    room = _first_row(
        supabase.table("rooms").select("*").eq("id", str(room_id)).limit(1).execute()
    )
    if room is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Room not found"
        )

    drawing = _first_row(
        supabase.table("drawings")
        .select("id, owner_id")
        .eq("id", str(room.get("drawing_id")))
        .limit(1)
        .execute()
    )
    if drawing is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Drawing not found"
        )

    if str(drawing.get("owner_id")) != current_user.id and current_user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")

    return room


@router.get("/room-types", response_model=list[RoomType])
async def list_room_types(
    current_user: CurrentUser = Depends(get_current_user),
) -> list[RoomType]:
    del current_user
    return list(get_room_types())


@router.patch("/rooms/{room_id}", response_model=Room)
async def update_room(
    room_id: UUID,
    payload: RoomUpdateRequest,
    supabase: Annotated[Client, Depends(get_supabase_client)],
    current_user: CurrentUser = Depends(get_current_user),
) -> Room:
    changed = payload.model_fields_set
    if not changed:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Provide at least one field: type or height",
        )
    if "type" in changed and (
        payload.type is None or not room_type_exists(payload.type)
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="type must be a code from GET /room-types",
        )

    _get_room_for_user(supabase, room_id, current_user)

    values: dict[str, Any] = {"updated_at": datetime.now(UTC).isoformat()}
    if "type" in changed:
        values["type"] = payload.type
        values["type_confirmed"] = True
    if "height" in changed:
        values["height"] = payload.height

    updated = _first_row(
        supabase.table("rooms").update(values).eq("id", str(room_id)).execute()
    )
    if updated is None:
        # The room was deleted after the access check, e.g. by reprocessing
        # the drawing (POST /drawings/{id}/process replaces its rooms).
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Room not found"
        )
    return room_from_row(updated)
