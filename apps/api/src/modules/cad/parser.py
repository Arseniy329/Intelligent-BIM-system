import uuid
from pathlib import Path
from uuid import UUID

import ezdxf
from ezdxf.entities import LWPolyline
from shapely.geometry import Point, Polygon

from src.contracts.generated import Point as ContractPoint
from src.contracts.generated import Room
from src.core.exceptions import (
    CADParsingError,
    LayerNotFoundError,
    NoValidContoursError,
)

# Scale factors from INSUNITS to meters (length)
INSUNITS_SCALE_TO_METERS: dict[int, float] = {
    1: 0.0254,  # Inches
    2: 0.3048,  # Feet
    4: 0.001,  # Millimeters
    5: 0.01,  # Centimeters
    6: 1.0,  # Meters
}
DEFAULT_INSUNITS = 4  # Default to millimeters if missing


def get_area_multiplier(doc: ezdxf.document.Drawing) -> float:
    """Calculate area multiplier to convert DXF units to square meters (m²)."""
    raw_units = doc.header.get("$INSUNITS", DEFAULT_INSUNITS)
    try:
        units_code = int(raw_units)
    except (ValueError, TypeError):
        units_code = DEFAULT_INSUNITS

    length_scale = INSUNITS_SCALE_TO_METERS.get(units_code, 0.001)
    return length_scale**2


def parse_dxf_rooms(
    file_path: str | Path,
    drawing_id: UUID | None = None,
) -> list[Room]:
    """Parse DXF file and extract Room entities from FIRE_ROOMS layer.

    Args:
        file_path: Path to the DXF file.
        drawing_id: Optional UUID of the drawing; generates a new one if not provided.

    Returns:
        List of parsed Room entities.

    Raises:
        CADParsingError: If file loading or DXF reading fails.
        LayerNotFoundError: If FIRE_ROOMS layer is missing.
        NoValidContoursError: If no valid closed contours are found on FIRE_ROOMS.
    """
    path = Path(file_path)
    if not path.is_file():
        raise CADParsingError(f"DXF file not found: {file_path}")

    try:
        doc = ezdxf.readfile(str(path))
    except Exception as exc:
        raise CADParsingError(f"Failed to read DXF file '{file_path}': {exc}") from exc

    # Determine area multiplier to square meters
    area_multiplier = get_area_multiplier(doc)

    # Validate that FIRE_ROOMS layer exists (case-insensitive check)
    target_layer = "FIRE_ROOMS"
    has_layer = any(layer.dxf.name.upper() == target_layer for layer in doc.layers)
    if not has_layer:
        raise LayerNotFoundError(
            f"Required layer '{target_layer}' not found in DXF file."
        )

    msp = doc.modelspace()

    # Extract all closed LWPOLYLINE entities strictly on the FIRE_ROOMS layer
    polylines: list[tuple[Polygon, list[tuple[float, float]]]] = []
    for entity in msp.query("LWPOLYLINE"):
        if not isinstance(entity, LWPolyline):
            continue
        if entity.dxf.layer.upper() != target_layer:
            continue
        if not entity.is_closed:
            continue

        points_2d = list(entity.get_points(format="xy"))
        if not points_2d:
            continue

        # Strip closing duplicate vertex if present
        if len(points_2d) > 3 and points_2d[0] == points_2d[-1]:
            coords = [(float(x), float(y)) for x, y in points_2d[:-1]]
        else:
            coords = [(float(x), float(y)) for x, y in points_2d]

        if len(coords) < 3:
            continue

        poly = Polygon(coords)
        if not poly.is_valid or poly.area <= 0:
            continue

        polylines.append((poly, coords))

    if not polylines:
        raise NoValidContoursError(
            f"No valid closed room contours found on layer '{target_layer}'."
        )

    # Extract all TEXT and MTEXT entities on the FIRE_ROOMS layer
    text_entries: list[tuple[Point, str]] = []
    for entity in msp.query("TEXT MTEXT"):
        if entity.dxf.layer.upper() != target_layer:
            continue

        if entity.dxftype() == "MTEXT":
            content = (
                entity.plain_text().strip()
                if hasattr(entity, "plain_text")
                else str(getattr(entity.dxf, "text", "")).strip()
            )
        else:
            content = str(getattr(entity.dxf, "text", "")).strip()

        if not content:
            continue

        insert = getattr(entity.dxf, "insert", (0.0, 0.0, 0.0))
        align = getattr(entity.dxf, "align_point", None)
        if align and (align[0] != 0.0 or align[1] != 0.0) and insert == (0.0, 0.0, 0.0):
            pt = Point(float(align[0]), float(align[1]))
        else:
            pt = Point(float(insert[0]), float(insert[1]))

        text_entries.append((pt, content))

    # Point-in-polygon matching and Room entity mapping
    resolved_drawing_id = drawing_id or uuid.uuid4()
    rooms: list[Room] = []

    for poly, coords in polylines:
        matched_name: str | None = None
        for pt, name in text_entries:
            if poly.contains(pt):
                matched_name = name
                break

        room_name = matched_name if matched_name else "Unknown Room"
        area_m2 = round(poly.area * area_multiplier, 4)

        contract_polygon = [ContractPoint(x=x, y=y) for x, y in coords]

        room = Room(
            id=str(uuid.uuid4()),
            drawingId=resolved_drawing_id,
            name=room_name,
            type=None,
            height=None,
            area=area_m2,
            polygon=contract_polygon,
        )
        rooms.append(room)

    return rooms


parse_dxf = parse_dxf_rooms
