from datetime import UTC, datetime
from typing import Annotated, Any
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Response, status
from shapely.geometry import Polygon
from supabase import Client

from src.contracts.generated import (
    Point,
    Room,
    RoomCreateRequest,
    RoomPolygon,
    RoomType,
    RoomUpdateRequest,
)
from src.core.auth import CurrentUser, get_current_user
from src.infrastructure.supabase import get_supabase_client
from src.modules.drawings.access import all_rows, first_row, get_drawing_for_user
from src.modules.rooms.service import (
    area_scale_to_m2,
    get_room_types,
    room_from_row,
    room_type_exists,
    row_points,
    stored_area_scale_to_m2,
    suggest_room_type,
    validate_polygon,
)

router = APIRouter(tags=["rooms"])


def _get_room_for_user(
    supabase: Client, room_id: UUID, current_user: CurrentUser
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Return (room, drawing) if the room exists and its drawing belongs to the user."""
    room = first_row(
        supabase.table("rooms").select("*").eq("id", str(room_id)).limit(1).execute()
    )
    if room is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Room not found"
        )

    drawing = get_drawing_for_user(supabase, str(room.get("drawing_id")), current_user)
    return room, drawing


def _unprocessable(detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=detail
    )


def _check_room_type(code: str | None) -> None:
    if code is None or not room_type_exists(code):
        raise _unprocessable("type must be a code from GET /room-types")


def _validated_polygon(polygon: RoomPolygon) -> tuple[list[Point], Polygon]:
    try:
        return polygon.root, validate_polygon(polygon.root)
    except ValueError as exc:
        raise _unprocessable(str(exc)) from exc


def _area_m2(supabase: Client, drawing: dict[str, Any], polygon: Polygon) -> float:
    scale = stored_area_scale_to_m2(drawing)
    if scale is None:
        rows = all_rows(
            supabase.table("rooms")
            .select("area, polygon")
            .eq("drawing_id", str(drawing["id"]))
            .execute()
        )
        scale = area_scale_to_m2(rows, drawing.get("units"))
    return round(polygon.area * scale, 4)


def _polygon_json(points: list[Point]) -> list[dict[str, float]]:
    return [{"x": point.x, "y": point.y} for point in points]


def _now() -> str:
    return datetime.now(UTC).isoformat()


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
        raise _unprocessable(
            "Provide at least one field: type, height, polygon or confirmed"
        )
    if "type" in changed:
        _check_room_type(payload.type)
    for field in ("polygon", "confirmed"):
        if field in changed and getattr(payload, field) is None:
            raise _unprocessable(f"{field} cannot be null")

    polygon = None
    if payload.polygon is not None:
        polygon = _validated_polygon(payload.polygon)

    _, drawing = _get_room_for_user(supabase, room_id, current_user)

    values: dict[str, Any] = {"updated_at": _now()}
    if "type" in changed:
        values["type"] = payload.type
        values["type_confirmed"] = True
    if "height" in changed:
        values["height"] = payload.height
    if polygon is not None:
        points, shape = polygon
        values["area"] = _area_m2(supabase, drawing, shape)
        values["polygon"] = _polygon_json(points)
    if "confirmed" in changed:
        values["confirmed"] = payload.confirmed

    updated = first_row(
        supabase.table("rooms").update(values).eq("id", str(room_id)).execute()
    )
    if updated is None:
        # The room was deleted after the access check, e.g. by reprocessing
        # the drawing (POST /drawings/{id}/process replaces its rooms).
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Room not found"
        )
    return room_from_row(updated)


@router.post(
    "/drawings/{drawing_id}/rooms",
    response_model=Room,
    status_code=status.HTTP_201_CREATED,
)
async def create_room(
    drawing_id: UUID,
    payload: RoomCreateRequest,
    supabase: Annotated[Client, Depends(get_supabase_client)],
    current_user: CurrentUser = Depends(get_current_user),
) -> Room:
    """Add a room outlined by hand by the engineer."""
    if payload.type is not None:
        _check_room_type(payload.type)
    points, shape = _validated_polygon(payload.polygon)

    drawing = get_drawing_for_user(supabase, drawing_id, current_user)

    now = _now()
    values: dict[str, Any] = {
        "id": str(uuid4()),
        "drawing_id": str(drawing_id),
        "name": payload.name,
        "type": payload.type or suggest_room_type(payload.name),
        "type_confirmed": payload.type is not None,
        "height": payload.height,
        "area": _area_m2(supabase, drawing, shape),
        "polygon": _polygon_json(points),
        "source": "manual",
        "confirmed": True,
        "created_at": now,
        "updated_at": now,
    }
    inserted = first_row(supabase.table("rooms").insert(values).execute())
    return room_from_row(inserted if inserted is not None else values)


@router.delete("/rooms/{room_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_room(
    room_id: UUID,
    supabase: Annotated[Client, Depends(get_supabase_client)],
    current_user: CurrentUser = Depends(get_current_user),
) -> Response:
    _get_room_for_user(supabase, room_id, current_user)

    # devices.room_id has no foreign key, so detach the devices explicitly.
    supabase.table("devices").update({"room_id": None}).eq(
        "room_id", str(room_id)
    ).execute()
    supabase.table("rooms").delete().eq("id", str(room_id)).execute()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/drawings/{drawing_id}/rooms/confirm", response_model=list[Room])
async def confirm_rooms(
    drawing_id: UUID,
    supabase: Annotated[Client, Depends(get_supabase_client)],
    current_user: CurrentUser = Depends(get_current_user),
) -> list[Room]:
    """Confirm the outlines of all rooms of the drawing."""
    get_drawing_for_user(supabase, drawing_id, current_user)

    rows = all_rows(
        supabase.table("rooms")
        .update({"confirmed": True, "updated_at": _now()})
        .eq("drawing_id", str(drawing_id))
        .execute()
    )
    return [room_from_row(row) for row in rows if len(row_points(row)) >= 3]
