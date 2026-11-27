"""Room zones (BIM-73): parts of one room with their own ceiling height.

A room with an uneven ceiling is split into zones. Each zone keeps its own
outline and height; devices are placed per zone (see
``src.modules.placement.service.build_placement_targets``).
"""

from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field
from shapely.geometry import Polygon

from src.contracts.generated import Point, RoomPolygon
from src.modules.placement.service import ZONE_INSIDE_TOLERANCE_RATIO
from src.modules.rooms.service import row_points

# Допуск виходу контуру зони за контур приміщення — частка більшого розміру
# приміщення (відхилення прив'язки до країв при ручному накресленні). Єдине
# значення і для створення зони, і для розміщення (placement.service).
INSIDE_TOLERANCE_RATIO = ZONE_INSIDE_TOLERANCE_RATIO
# Дозволене перекриття зон — частка площі меншої з двох зон.
OVERLAP_TOLERANCE_RATIO = 0.01


class RoomZone(BaseModel):
    id: UUID
    roomId: UUID
    drawingId: UUID
    name: str | None = None
    height: float | None = Field(
        default=None, description="Висота стелі зони, м. null — недостатньо даних."
    )
    area: float = Field(..., ge=0, description="Площа зони, м².")
    polygon: list[Point]


class RoomZoneCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, max_length=200)
    height: float | None = Field(default=None, gt=0, le=100)
    polygon: RoomPolygon


class RoomZoneUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, max_length=200)
    height: float | None = Field(default=None, gt=0, le=100)
    polygon: RoomPolygon | None = None


def zone_from_row(row: dict[str, Any]) -> RoomZone:
    """Map a ``public.room_zones`` row to the API model."""
    raw_height = row.get("height")
    height = float(raw_height) if raw_height is not None else None
    return RoomZone(
        id=UUID(str(row["id"])),
        roomId=UUID(str(row["room_id"])),
        drawingId=UUID(str(row["drawing_id"])),
        name=row.get("name"),
        height=height if height is not None and height > 0 else None,
        area=float(row.get("area") or 0.0),
        polygon=row_points(row),
    )


def _shape_from_points(points: list[Point]) -> Polygon | None:
    if len(points) < 3:
        return None
    shape = Polygon([(point.x, point.y) for point in points])
    return shape if shape.is_valid and shape.area > 0 else None


def check_zone_geometry(
    zone_shape: Polygon,
    room_row: dict[str, Any],
    sibling_rows: list[dict[str, Any]],
    exclude_zone_id: str | None = None,
) -> None:
    """Check that a zone lies inside its room and does not overlap other zones.

    Raises ValueError with a client-facing message.
    """
    room_shape = _shape_from_points(row_points(room_row))
    if room_shape is None:
        raise ValueError("room has no valid outline to place a zone in")

    min_x, min_y, max_x, max_y = room_shape.bounds
    tolerance = max(max_x - min_x, max_y - min_y) * INSIDE_TOLERANCE_RATIO
    if not room_shape.buffer(tolerance).covers(zone_shape):
        raise ValueError("zone must lie inside its room")

    for sibling in sibling_rows:
        if exclude_zone_id is not None and str(sibling.get("id")) == exclude_zone_id:
            continue
        other = _shape_from_points(row_points(sibling))
        if other is None:
            continue
        overlap = zone_shape.intersection(other).area
        if overlap > OVERLAP_TOLERANCE_RATIO * min(zone_shape.area, other.area):
            raise ValueError("zones of one room must not overlap")
