"""Room-type catalog, room-type suggestion (BIM-71) and room outline helpers (BIM-120).

The catalog lives in ``room_types.json`` (source: Confluence «11. Типи приміщень
для класифікації»). Adding a type or an example name there changes suggestions
on the next processing run without touching this code.
"""

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any
from uuid import UUID

from shapely.geometry import Polygon

from src.contracts.generated import Point, Room, RoomType, Source

ROOM_TYPES_PATH = Path(__file__).with_name("room_types.json")
UNKNOWN_ROOM_TYPE = "unknown"

# DXF area unit -> m², used only when no room of the drawing has a known area.
# Millimetres are the default, as in the parser (INSUNITS missing -> mm).
UNITS_AREA_TO_M2: dict[str, float] = {"mm": 1e-6, "m": 1.0}
DEFAULT_AREA_TO_M2 = UNITS_AREA_TO_M2["mm"]

_BRACKETS_RE = re.compile(r"\([^)]*\)")
# Splits on anything that is not a letter or digit, including "_" and "|".
_TOKEN_SPLIT_RE = re.compile(r"[\W_]+", re.UNICODE)


@lru_cache
def get_room_types() -> tuple[RoomType, ...]:
    """Load and validate the room-type catalog."""
    raw = json.loads(ROOM_TYPES_PATH.read_text(encoding="utf-8"))
    if not isinstance(raw, list):
        raise ValueError("Room type catalog must be a JSON list")

    room_types = tuple(RoomType.model_validate(item) for item in raw)
    codes = [room_type.code for room_type in room_types]
    if len(codes) != len(set(codes)):
        raise ValueError("Room type codes in the catalog must be unique")
    if UNKNOWN_ROOM_TYPE not in codes:
        raise ValueError(f"Room type catalog must contain '{UNKNOWN_ROOM_TYPE}'")
    return room_types


def room_type_exists(code: str) -> bool:
    return any(room_type.code == code for room_type in get_room_types())


def _tokens(value: str) -> tuple[str, ...]:
    """Normalize a name into comparable words.

    Drops text in brackets ("Kitchen (16.0m2)") and any word containing a digit
    (room numbers, areas), so "Office_1" and "101 | Main_Corridor | 24.0 m2"
    compare as "office" and "main corridor".
    """
    without_brackets = _BRACKETS_RE.sub(" ", value.casefold())
    return tuple(
        token
        for token in _TOKEN_SPLIT_RE.split(without_brackets)
        if token and not any(char.isdigit() for char in token)
    )


def _contains(haystack: tuple[str, ...], needle: tuple[str, ...]) -> bool:
    size = len(needle)
    return any(
        haystack[index : index + size] == needle
        for index in range(len(haystack) - size + 1)
    )


def suggest_room_type(room_name: str | None) -> str:
    """Suggest a catalog code for a room name, or 'unknown' if nothing matches.

    1. Exact match of the normalized name with a normalized example.
    2. Otherwise the longest example found as whole words inside the name
       ("Кабінет директора" -> office). Ties keep catalog order.
    """
    name_tokens = _tokens(room_name or "")
    if not name_tokens:
        return UNKNOWN_ROOM_TYPE

    best_code = UNKNOWN_ROOM_TYPE
    best_length = 0
    for room_type in get_room_types():
        for example in room_type.examples:
            example_tokens = _tokens(example)
            if not example_tokens:
                continue
            if example_tokens == name_tokens:
                return room_type.code
            if len(example_tokens) > best_length and _contains(
                name_tokens, example_tokens
            ):
                best_code = room_type.code
                best_length = len(example_tokens)
    return best_code


def row_points(row: dict[str, Any]) -> list[Point]:
    """Read the ``polygon`` column of a ``public.rooms`` row."""
    points: list[Point] = []
    raw_polygon = row.get("polygon")
    if isinstance(raw_polygon, list):
        for point in raw_polygon:
            if isinstance(point, dict) and "x" in point and "y" in point:
                points.append(Point(x=float(point["x"]), y=float(point["y"])))
            elif isinstance(point, (list, tuple)) and len(point) >= 2:
                points.append(Point(x=float(point[0]), y=float(point[1])))
    return points


def room_from_row(row: dict[str, Any]) -> Room:
    """Map a ``public.rooms`` row to the shared Room contract."""
    raw_height = row.get("height")
    height = float(raw_height) if raw_height is not None else None

    raw_source = row.get("source")
    source = (
        Source(raw_source) if raw_source in {item.value for item in Source} else None
    )
    raw_confirmed = row.get("confirmed")

    return Room(
        id=str(row["id"]),
        drawingId=UUID(str(row["drawing_id"])),
        name=row.get("name"),
        type=row.get("type"),
        height=height if height is not None and height > 0 else None,
        area=float(row.get("area") or 0.0),
        polygon=row_points(row),
        source=source,
        confirmed=bool(raw_confirmed) if raw_confirmed is not None else None,
    )


def validate_polygon(points: list[Point]) -> Polygon:
    """Check a room outline from a request and return it as a shapely polygon.

    Raises ValueError with a client-facing message if the outline is unusable.
    """
    coords = [(point.x, point.y) for point in points]
    if len(coords) < 3:
        raise ValueError("polygon must have at least 3 points")
    if len(set(coords)) != len(coords):
        raise ValueError(
            "polygon points must be unique; do not repeat the first point at the end"
        )
    polygon = Polygon(coords)
    if not polygon.is_valid or polygon.area <= 0:
        raise ValueError("polygon must be a valid outline without self-intersections")
    return polygon


def stored_area_scale_to_m2(drawing: dict[str, Any]) -> float | None:
    """m² per square drawing unit from ``drawings.unit_scale_m``, if it is set.

    The parser stores the $INSUNITS length scale there when the drawing is
    processed (migration 007), so it survives deleting every room.
    """
    try:
        length_scale = float(drawing.get("unit_scale_m") or 0.0)
    except (TypeError, ValueError):
        return None
    return length_scale**2 if length_scale > 0 else None


def area_scale_to_m2(rows: list[dict[str, Any]], drawing_units: str | None) -> float:
    """Fallback for drawings without ``unit_scale_m`` (processed before 007).

    Taken from the first room with a known area, so it matches the INSUNITS
    scaling the parser used. Falls back to ``drawings.units`` (mm by default).
    """
    for row in rows:
        try:
            area = float(row.get("area") or 0.0)
        except (TypeError, ValueError):
            continue
        coords = [(point.x, point.y) for point in row_points(row)]
        if area <= 0 or len(coords) < 3:
            continue
        polygon_area = Polygon(coords).area
        if polygon_area > 0:
            return area / polygon_area
    return UNITS_AREA_TO_M2.get(drawing_units or "", DEFAULT_AREA_TO_M2)
