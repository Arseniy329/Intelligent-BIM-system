"""Manual device editing on a processed drawing (BIM-120).

Every change regenerates the result DXF so the download matches the plan.
"""

from typing import Annotated, Any
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Response, status
from supabase import Client

from src.contracts.generated import (
    Device,
    DeviceCreateRequest,
    DeviceUpdateRequest,
    Point,
    Type,
)
from src.core.auth import CurrentUser, get_current_user
from src.infrastructure.supabase import get_supabase_client
from src.modules.drawings.access import first_row, get_drawing_for_user
from src.modules.drawings.service import generate_and_upload_result_dxf

router = APIRouter(tags=["devices"])

DEVICE_LAYER = "SYS_FIRE_SENSORS"
EDITABLE_DRAWING_STATUS = "processed"


def device_from_row(row: dict[str, Any]) -> Device:
    """Map a ``public.devices`` row to the shared Device contract."""
    try:
        device_type = Type(str(row.get("type")))
    except ValueError:
        device_type = Type.smoke_detector
    return Device(
        id=str(row["id"]),
        drawingId=UUID(str(row["drawing_id"])),
        roomId=str(row["room_id"]) if row.get("room_id") else None,
        type=device_type,
        position=Point(x=float(row["x"]), y=float(row["y"])),
        layer=str(row.get("layer") or DEVICE_LAYER),
    )


def _get_editable_drawing(
    supabase: Client, drawing_id: UUID | str, current_user: CurrentUser
) -> dict[str, Any]:
    drawing = get_drawing_for_user(supabase, drawing_id, current_user)
    if drawing.get("status") != EDITABLE_DRAWING_STATUS:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Devices can be edited only when the drawing status is 'processed'",
        )
    return drawing


def _get_device_for_user(
    supabase: Client, device_id: UUID, current_user: CurrentUser
) -> dict[str, Any]:
    device = first_row(
        supabase.table("devices")
        .select("*")
        .eq("id", str(device_id))
        .limit(1)
        .execute()
    )
    if device is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Device not found"
        )
    _get_editable_drawing(supabase, str(device.get("drawing_id")), current_user)
    return device


def _check_room_in_drawing(
    supabase: Client, room_id: UUID | None, drawing_id: str
) -> None:
    if room_id is None:
        return
    room = first_row(
        supabase.table("rooms")
        .select("id")
        .eq("id", str(room_id))
        .eq("drawing_id", drawing_id)
        .limit(1)
        .execute()
    )
    if room is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="roomId must be a room of the same drawing",
        )


def _regenerate_result(supabase: Client, drawing_id: str) -> None:
    try:
        generate_and_upload_result_dxf(drawing_id, supabase)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Device change saved, but result DXF regeneration failed",
        ) from exc


@router.post(
    "/drawings/{drawing_id}/devices",
    response_model=Device,
    status_code=status.HTTP_201_CREATED,
)
async def create_device(
    drawing_id: UUID,
    payload: DeviceCreateRequest,
    supabase: Annotated[Client, Depends(get_supabase_client)],
    current_user: CurrentUser = Depends(get_current_user),
) -> Device:
    _get_editable_drawing(supabase, drawing_id, current_user)
    _check_room_in_drawing(supabase, payload.roomId, str(drawing_id))

    values: dict[str, Any] = {
        "id": str(uuid4()),
        "drawing_id": str(drawing_id),
        "room_id": str(payload.roomId) if payload.roomId else None,
        "rule_id": None,
        "type": payload.type.value,
        "layer": DEVICE_LAYER,
        "x": payload.position.x,
        "y": payload.position.y,
    }
    inserted = first_row(supabase.table("devices").insert(values).execute())
    _regenerate_result(supabase, str(drawing_id))
    return device_from_row(inserted if inserted is not None else values)


@router.patch("/devices/{device_id}", response_model=Device)
async def update_device(
    device_id: UUID,
    payload: DeviceUpdateRequest,
    supabase: Annotated[Client, Depends(get_supabase_client)],
    current_user: CurrentUser = Depends(get_current_user),
) -> Device:
    changed = payload.model_fields_set
    if not changed:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Provide at least one field: type, position or roomId",
        )
    for field in ("type", "position"):
        if field in changed and getattr(payload, field) is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"{field} cannot be null",
            )

    device = _get_device_for_user(supabase, device_id, current_user)
    drawing_id = str(device["drawing_id"])

    values: dict[str, Any] = {}
    if payload.type is not None:
        values["type"] = payload.type.value
    if payload.position is not None:
        values["x"] = payload.position.x
        values["y"] = payload.position.y
    if "roomId" in changed:
        _check_room_in_drawing(supabase, payload.roomId, drawing_id)
        values["room_id"] = str(payload.roomId) if payload.roomId else None

    updated = first_row(
        supabase.table("devices").update(values).eq("id", str(device_id)).execute()
    )
    _regenerate_result(supabase, drawing_id)
    return device_from_row(updated if updated is not None else {**device, **values})


@router.delete("/devices/{device_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_device(
    device_id: UUID,
    supabase: Annotated[Client, Depends(get_supabase_client)],
    current_user: CurrentUser = Depends(get_current_user),
) -> Response:
    device = _get_device_for_user(supabase, device_id, current_user)

    supabase.table("devices").delete().eq("id", str(device_id)).execute()
    _regenerate_result(supabase, str(device["drawing_id"]))
    return Response(status_code=status.HTTP_204_NO_CONTENT)
