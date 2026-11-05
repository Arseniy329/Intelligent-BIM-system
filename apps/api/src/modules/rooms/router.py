from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from supabase import Client

from src.core.auth import CurrentUser, get_current_user
from src.infrastructure.supabase import get_supabase_client
from src.modules.rooms.service import get_room_types, room_type_exists

router = APIRouter(tags=["rooms"])


class RoomUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: str | None = None
    height: float | None = Field(default=None, gt=0)


class RoomUpdateResponse(BaseModel):
    id: str
    drawingId: str
    type: str
    height: float | None


@router.get("/room-types")
async def list_room_types(
    current_user: CurrentUser = Depends(get_current_user),
) -> list[dict[str, Any]]:
    del current_user
    return get_room_types()


@router.patch("/rooms/{room_id}", response_model=RoomUpdateResponse)
async def update_room(
    room_id: str,
    payload: RoomUpdateRequest,
    current_user: CurrentUser = Depends(get_current_user),
    supabase: Client = Depends(get_supabase_client),
) -> RoomUpdateResponse:
    changed_fields = payload.model_fields_set
    if not changed_fields:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Provide at least one field: type or height",
        )

    if "type" in changed_fields:
        if payload.type is None or not room_type_exists(payload.type):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="type must be a code from GET /room-types",
            )

    room_result = (
        supabase.table("rooms")
        .select("*")
        .eq("id", room_id)
        .single()
        .execute()
    )
    room_data = room_result.data

    if not isinstance(room_data, dict):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Room not found",
        )

    drawing_id = room_data.get("drawing_id")
    if not drawing_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Room has no drawing",
        )

    drawing_result = (
        supabase.table("drawings")
        .select("owner_id")
        .eq("id", str(drawing_id))
        .single()
        .execute()
    )
    drawing_data = drawing_result.data

    if not isinstance(drawing_data, dict):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Drawing not found",
        )

    if (
        str(drawing_data.get("owner_id")) != str(current_user.id)
        and current_user.role != "admin"
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden",
        )

    update_values: dict[str, Any] = {}
    if "type" in changed_fields:
        update_values["type"] = payload.type
        update_values["type_confirmed"] = True
    if "height" in changed_fields:
        update_values["height"] = payload.height

    supabase.table("rooms").update(update_values).eq("id", room_id).execute()

    return RoomUpdateResponse(
        id=str(room_data["id"]),
        drawingId=str(drawing_id),
        type=str(update_values.get("type", room_data.get("type") or "unknown")),
        height=update_values.get("height", room_data.get("height")),
    )