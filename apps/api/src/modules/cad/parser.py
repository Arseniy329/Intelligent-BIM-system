import io
import math
import re
import uuid
from pathlib import Path
from typing import Any
from uuid import UUID

import ezdxf
from ezdxf.entities import LWPolyline
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import polygonize, unary_union

from src.contracts.generated import Point as ContractPoint
from src.contracts.generated import Room
from src.core.exceptions import (
    CADParsingError,
)
from src.modules.rooms.service import suggest_room_type

# Scale factors from INSUNITS to meters (length)
INSUNITS_SCALE_TO_METERS: dict[int, float] = {
    1: 0.0254,  # Inches
    2: 0.3048,  # Feet
    4: 0.001,  # Millimeters
    5: 0.01,  # Centimeters
    6: 1.0,  # Meters
}
DEFAULT_INSUNITS = 4  # Default to millimeters if missing
DEFAULT_UNNAMED_ROOM_NAME = "Без назви"

CODE_STRICT = r"(?:№\s*|#\s*|No\.?\s*)?(?:\d+[a-zA-Z]?|[A-Za-z]\d+|\d+[\.\-]\d+)"
CODE_ANY = (
    r"(?:№\s*|#\s*|No\.?\s*)?"
    r"(?:[A-Za-zА-Яа-яІіЇїЄє0-9]+(?:[\.\-][A-Za-zА-Яа-яІіЇїЄє0-9]+)*)"
)

EXPLICATION_PATTERN = re.compile(
    r"^\s*(?:"
    rf"({CODE_STRICT})\s*(?:[:\|\-\—\–\t]\s*|\s{{2,}}|\s+)"
    r"|"
    rf"({CODE_ANY})\s*(?:[:\|\-\—\–\t]\s*|\s{{2,}})"
    r")\s*([A-Za-zА-Яа-яІіЇїЄє][^\n\r\|]*?)"
    r"(?:\s*[\|\(].*|\s*[\d\.,]+\s*(?:m2|м2|м²|sqm|sq\s*m).*|\s*)$",
    re.IGNORECASE,
)
AREA_PATTERN = re.compile(
    r"(\d+[\.,]\d+|\d+)\s*(m2|м2|м²|sqm|sq\s*m)",
    re.IGNORECASE,
)

WALL_KEYWORDS = ("WALL", "СТІН", "ПЕРЕГОР", "СТЕН", "PARTITION")
OPENING_KEYWORDS = (
    "DOOR",
    "ДВЕР",
    "WINDOW",
    "ВІКН",
    "ОКН",
    "OPENING",
    "ПРОРІЗ",
    "ПРОЕМ",
    "GLAZ",
)


class ParsedRoomsList(list[Room]):
    """List of Room entities carrying the parsing source ('fire_rooms' or 'auto')."""

    def __init__(
        self, rooms: list[Room] | None = None, source: str = "fire_rooms"
    ) -> None:
        super().__init__(rooms or [])
        self.source = source


def get_length_scale(doc: ezdxf.document.Drawing | None) -> float:
    """Calculate scale factor from DXF units to meters (length)."""
    if doc is None:
        return INSUNITS_SCALE_TO_METERS[DEFAULT_INSUNITS]
    raw_units = doc.header.get("$INSUNITS", DEFAULT_INSUNITS)
    try:
        units_code = int(raw_units)
    except (ValueError, TypeError):
        units_code = DEFAULT_INSUNITS
    return INSUNITS_SCALE_TO_METERS.get(units_code, 0.001)


def get_area_multiplier(doc: ezdxf.document.Drawing) -> float:
    """Calculate area multiplier to convert DXF units to square meters (m²)."""
    return get_length_scale(doc) ** 2


def read_dxf_document(file_path: str | Path) -> ezdxf.document.Drawing:
    """Read a DXF file, ensuring proper DXF version header if missing.

    Many hand-crafted or exported DXFs omit $ACADVER in the HEADER section.
    Without $ACADVER, ezdxf defaults to AC1009 (AutoCAD R12), where LWPOLYLINE
    subclass markers (100 AcDbEntity) are ignored and layer attributes default to '0'.
    Injecting $ACADVER AC1015 (AutoCAD 2000) when missing ensures all modern
    entity types and layer definitions are preserved correctly.
    """
    path = Path(file_path)
    if not path.is_file():
        raise CADParsingError(f"DXF file not found: {file_path}")

    content: str | None = None
    for enc in ("utf-8", "cp1251", "cp1252", "latin-1"):
        try:
            content = path.read_text(encoding=enc)
            break
        except (UnicodeDecodeError, LookupError):
            continue

    if content is None:
        try:
            content = path.read_bytes().decode("utf-8", errors="replace")
        except Exception as exc:
            raise CADParsingError(
                f"Failed to read DXF file '{file_path}': {exc}"
            ) from exc

    if "$ACADVER" not in content:
        idx = content.find("HEADER")
        if idx != -1:
            eol = content.find("\n", idx)
            if eol != -1:
                content = (
                    content[: eol + 1] + "9\n$ACADVER\n1\nAC1015\n" + content[eol + 1 :]
                )
        else:
            content = (
                "0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1015\n0\nENDSEC\n" + content
            )

    try:
        return ezdxf.read(io.StringIO(content))
    except Exception as exc:
        raise CADParsingError(f"Failed to read DXF file '{file_path}': {exc}") from exc


def _is_wall_layer(name: str) -> bool:
    upper = name.upper()
    return any(k in upper for k in WALL_KEYWORDS)


def _is_opening_layer(name: str) -> bool:
    upper = name.upper()
    return any(k in upper for k in OPENING_KEYWORDS)


def _normalize_room_number(text: str) -> str:
    cleaned = text.strip()
    cleaned = re.sub(
        r"^(?:№|#|No\.?|кімн\.?|пом\.?)\s*", "", cleaned, flags=re.IGNORECASE
    )
    cleaned = re.sub(
        r"^(?:Room|Kімната|Приміщення)\s*", "", cleaned, flags=re.IGNORECASE
    )
    return cleaned.strip()


def _is_only_number(text: str) -> bool:
    cleaned = text.strip()
    cleaned = re.sub(r"^(?:№|#|No\.?)\s*", "", cleaned, flags=re.IGNORECASE)
    return bool(
        re.match(
            r"^\d+[a-zA-Zа-яА-ЯіІїЇєЄ]?$|^\d+[\.\-]\d+[a-zA-Zа-яА-ЯіІїЇєЄ]?$",
            cleaned,
        )
    )


def _is_area_string(text: str) -> bool:
    return bool(AREA_PATTERN.search(text))


def _parse_explication(msp: Any) -> dict[str, str]:
    """Extract text entities and map room numbers to names using regex."""
    explication_map: dict[str, str] = {}

    for entity in msp.query("TEXT MTEXT"):
        if entity.dxftype() == "MTEXT":
            content = (
                entity.plain_text()
                if hasattr(entity, "plain_text")
                else str(getattr(entity.dxf, "text", ""))
            )
        else:
            content = str(getattr(entity.dxf, "text", ""))

        if not content:
            continue

        content = content.replace(r"\P", "\n").replace(r"\p", "\n")
        for line in content.splitlines():
            line = line.strip()
            if not line:
                continue
            m = EXPLICATION_PATTERN.match(line)
            if m:
                raw_num = (m.group(1) or m.group(2)).strip()
                name = m.group(3).strip()
                norm_num = _normalize_room_number(raw_num)
                if norm_num and name:
                    explication_map[norm_num] = name
                    explication_map[norm_num.lower()] = name

    return explication_map


def _bridge_gaps(segments: list[LineString], max_gap: float) -> list[LineString]:
    """Bridge gaps between dangling endpoints, vertices, and nearby segments."""
    if not segments or max_gap <= 0:
        return segments

    def pt_key(pt: tuple[float, float]) -> tuple[float, float]:
        return (round(pt[0], 3), round(pt[1], 3))

    existing_edges: set[tuple[tuple[float, float], tuple[float, float]]] = set()
    for s in segments:
        k1 = pt_key((s.coords[0][0], s.coords[0][1]))
        k2 = pt_key((s.coords[-1][0], s.coords[-1][1]))
        existing_edges.add((min(k1, k2), max(k1, k2)))

    endpoint_counts: dict[tuple[float, float], int] = {}
    all_vertices: set[tuple[float, float]] = set()
    for s in segments:
        p1 = (s.coords[0][0], s.coords[0][1])
        p2 = (s.coords[-1][0], s.coords[-1][1])
        all_vertices.add(p1)
        all_vertices.add(p2)
        endpoint_counts[pt_key(p1)] = endpoint_counts.get(pt_key(p1), 0) + 1
        endpoint_counts[pt_key(p2)] = endpoint_counts.get(pt_key(p2), 0) + 1

    dangling: list[tuple[float, float]] = []
    seen_dangling: set[tuple[float, float]] = set()
    for s in segments:
        for pt in (
            (s.coords[0][0], s.coords[0][1]),
            (s.coords[-1][0], s.coords[-1][1]),
        ):
            k = pt_key(pt)
            if endpoint_counts.get(k, 0) == 1 and k not in seen_dangling:
                pt_geom = Point(pt)
                touches_interior = any(
                    seg.distance(pt_geom) < 1e-4
                    and 1e-4 < seg.project(pt_geom) < (seg.length - 1e-4)
                    for seg in segments
                )
                if not touches_interior:
                    seen_dangling.add(k)
                    dangling.append(pt)

    result = list(segments)

    # Pass 1: candidate pairs between dangling endpoints
    candidate_pairs: list[tuple[float, int, int]] = []
    for i in range(len(dangling)):
        for j in range(i + 1, len(dangling)):
            p = dangling[i]
            q = dangling[j]
            edge = (min(pt_key(p), pt_key(q)), max(pt_key(p), pt_key(q)))
            if edge in existing_edges:
                continue
            dist = math.hypot(p[0] - q[0], p[1] - q[1])
            if 1e-4 < dist <= max_gap:
                candidate_pairs.append((dist, i, j))

    candidate_pairs.sort(key=lambda item: item[0])

    bridged_indices: set[int] = set()
    for _dist, i, j in candidate_pairs:
        if i in bridged_indices or j in bridged_indices:
            continue
        bridged_indices.add(i)
        bridged_indices.add(j)
        result.append(LineString([dangling[i], dangling[j]]))

    # Pass 2: remaining dangling endpoints to any existing vertex
    for i, p in enumerate(dangling):
        if i in bridged_indices:
            continue
        best_v: tuple[float, float] | None = None
        best_dist = max_gap
        for v in all_vertices:
            if pt_key(p) == pt_key(v):
                continue
            edge = (min(pt_key(p), pt_key(v)), max(pt_key(p), pt_key(v)))
            if edge in existing_edges:
                continue
            dist = math.hypot(p[0] - v[0], p[1] - v[1])
            if 1e-4 < dist <= best_dist:
                best_dist = dist
                best_v = v
        if best_v is not None:
            result.append(LineString([p, best_v]))
            bridged_indices.add(i)

    # Pass 3: remaining dangling endpoints to T-junction projection on segments
    for i, p in enumerate(dangling):
        if i in bridged_indices:
            continue
        pt = Point(p)
        best_proj: tuple[float, float] | None = None
        best_dist = max_gap
        for s in segments:
            dist = s.distance(pt)
            if 1e-4 < dist <= best_dist:
                proj_dist = s.project(pt)
                proj_pt = s.interpolate(proj_dist)
                if 1e-4 < proj_dist < (s.length - 1e-4):
                    best_dist = dist
                    best_proj = (proj_pt.x, proj_pt.y)
        if best_proj is not None:
            result.append(LineString([p, best_proj]))
            bridged_indices.add(i)

    return result


def _extract_text_entries(msp: Any) -> list[tuple[Point, str]]:
    """Extract (Point, first_line_text) entries from TEXT and MTEXT entities."""
    text_entries: list[tuple[Point, str]] = []
    if msp is None:
        return text_entries

    for entity in msp.query("TEXT MTEXT"):
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

        content = content.replace(r"\P", "\n").replace(r"\p", "\n")
        first_line = next(
            (line.strip() for line in content.splitlines() if line.strip()), ""
        )
        if not first_line:
            continue

        insert = getattr(entity.dxf, "insert", (0.0, 0.0, 0.0))
        align = getattr(entity.dxf, "align_point", None)
        if align and (align[0] != 0.0 or align[1] != 0.0) and insert == (0.0, 0.0, 0.0):
            pt = Point(float(align[0]), float(align[1]))
        else:
            pt = Point(float(insert[0]), float(insert[1]))

        text_entries.append((pt, first_line))

    return text_entries


def _has_room_label(texts: list[str]) -> bool:
    """Check if any text in the list represents a room name or identifier."""
    for t in texts:
        if _is_area_string(t):
            continue
        if EXPLICATION_PATTERN.match(t):
            return True
        if not _is_only_number(t):
            return True
        if _is_only_number(t):
            return True
    return False


def _extract_walls_and_bridge_gaps(
    msp: Any,
    max_gap: float | None = None,
) -> list[LineString]:
    """Fetch entities from WALL layers, extract segments, and bridge gaps."""
    all_layers: set[str] = set()
    doc = getattr(msp, "doc", None)
    if doc is not None:
        all_layers = {layer.dxf.name for layer in doc.layers}

    has_wall_layer = any(_is_wall_layer(name) for name in all_layers)
    length_scale = get_length_scale(doc)

    segments: list[LineString] = []
    open_loops: list[tuple[tuple[float, float], tuple[float, float], float]] = []

    for entity in msp.query("LINE LWPOLYLINE POLYLINE ARC"):
        layer = getattr(entity.dxf, "layer", "")
        if has_wall_layer:
            if not (_is_wall_layer(layer) or _is_opening_layer(layer)):
                continue
        else:
            layer_upper = layer.upper()
            if any(
                ign in layer_upper
                for ign in (
                    "DEFPOINTS",
                    "TEXT",
                    "DIM",
                    "DIMENSION",
                    "HATCH",
                    "TITLE",
                    "BORDER",
                    "FRAME",
                )
            ):
                continue

        dxftype = entity.dxftype()
        if dxftype == "LINE":
            p1 = (float(entity.dxf.start.x), float(entity.dxf.start.y))
            p2 = (float(entity.dxf.end.x), float(entity.dxf.end.y))
            if math.hypot(p2[0] - p1[0], p2[1] - p1[1]) > 1e-4:
                segments.append(LineString([p1, p2]))

        elif dxftype == "LWPOLYLINE":
            pts = list(entity.get_points(format="xy"))
            for i in range(len(pts) - 1):
                p1 = (float(pts[i][0]), float(pts[i][1]))
                p2 = (float(pts[i + 1][0]), float(pts[i + 1][1]))
                if math.hypot(p2[0] - p1[0], p2[1] - p1[1]) > 1e-4:
                    segments.append(LineString([p1, p2]))
            is_closed = getattr(entity, "is_closed", False)
            if len(pts) >= 3:
                p0 = (float(pts[0][0]), float(pts[0][1]))
                p_end = (float(pts[-1][0]), float(pts[-1][1]))
                dist = math.hypot(p_end[0] - p0[0], p_end[1] - p0[1])
                if is_closed:
                    if dist > 1e-4:
                        segments.append(LineString([p_end, p0]))
                else:
                    open_loops.append((p_end, p0, dist))

        elif dxftype == "POLYLINE":
            v_pts = [
                (float(v.dxf.location.x), float(v.dxf.location.y))
                for v in entity.vertices
            ]
            for i in range(len(v_pts) - 1):
                p1 = v_pts[i]
                p2 = v_pts[i + 1]
                if math.hypot(p2[0] - p1[0], p2[1] - p1[1]) > 1e-4:
                    segments.append(LineString([p1, p2]))
            is_closed = getattr(entity, "is_closed", False)
            if len(v_pts) >= 3:
                p0 = v_pts[0]
                p_end = v_pts[-1]
                dist = math.hypot(p_end[0] - p0[0], p_end[1] - p0[1])
                if is_closed:
                    if dist > 1e-4:
                        segments.append(LineString([p_end, p0]))
                else:
                    open_loops.append((p_end, p0, dist))

        elif dxftype == "ARC":
            if _is_opening_layer(layer):
                p1 = (float(entity.start_point.x), float(entity.start_point.y))
                p2 = (float(entity.end_point.x), float(entity.end_point.y))
                if math.hypot(p2[0] - p1[0], p2[1] - p1[1]) > 1e-4:
                    segments.append(LineString([p1, p2]))
            else:
                try:
                    arc_pts = list(entity.flattening(0.05))
                    for i in range(len(arc_pts) - 1):
                        p1 = (float(arc_pts[i][0]), float(arc_pts[i][1]))
                        p2 = (float(arc_pts[i + 1][0]), float(arc_pts[i + 1][1]))
                        if math.hypot(p2[0] - p1[0], p2[1] - p1[1]) > 1e-4:
                            segments.append(LineString([p1, p2]))
                except Exception:
                    pass

    if not segments:
        return []

    max_coord = max(
        max(abs(pt[0]), abs(pt[1]))
        for s in segments
        for pt in (s.coords[0], s.coords[-1])
    )
    if max_coord < 500 and length_scale < 0.1:
        length_scale = 1.0

    if max_gap is None:
        max_gap = 3.1 / length_scale

    if max_gap <= 0:
        return segments

    for p_end, p0, dist in open_loops:
        is_collinear = abs(p0[0] - p_end[0]) < 1e-3 or abs(p0[1] - p_end[1]) < 1e-3
        if (is_collinear and 1e-4 < dist <= max_gap) or (
            1e-4 < dist <= min(max_gap, 0.1 / length_scale)
        ):
            segments.append(LineString([p_end, p0]))

    return _bridge_gaps(segments, max_gap)


def _polygonize_and_filter(
    segments: list[LineString],
    min_area_m2: float = 0.5,
    area_multiplier: float = 1.0,
    msp: Any = None,
    text_entries: list[tuple[Point, str]] | None = None,
) -> list[Polygon]:
    """Polygonize segments, discard largest bounding polygon and small artifacts."""
    if not segments:
        return []

    if text_entries is None and msp is not None:
        text_entries = _extract_text_entries(msp)

    noded = unary_union(segments)
    raw_polys = list(polygonize(noded))
    if not raw_polys:
        return []

    valid_polys: list[Polygon] = []
    for poly in raw_polys:
        if not poly.is_valid or poly.area <= 0:
            continue
        area_m2 = poly.area * area_multiplier
        if area_m2 < min_area_m2:
            continue
        valid_polys.append(poly)

    if not valid_polys:
        return []

    if len(valid_polys) > 1:
        largest = max(valid_polys, key=lambda p: p.area)
        others = [p for p in valid_polys if p is not largest]
        is_bounding = False
        if len(others) >= 1:
            envelope_shell = Polygon(largest.exterior)
            encloses_all = all(envelope_shell.contains(p.centroid) for p in others)
            if encloses_all or (
                len(largest.interiors) > 0
                and all(largest.contains(p.centroid) for p in others)
            ):
                # A polygon is an envelope only if:
                # (a) It has NO room text/identifier of its own; AND
                # (b) Its exterior boundary encompasses all other detected rooms.
                has_own_label = False
                if text_entries:
                    texts_in_largest = [
                        text for pt, text in text_entries if largest.contains(pt)
                    ]
                    has_own_label = _has_room_label(texts_in_largest)

                if not has_own_label:
                    is_bounding = True

        if is_bounding:
            valid_polys = others

    return valid_polys


def _extract_fire_rooms_polylines(
    msp: Any, target_layer: str
) -> list[tuple[Polygon, list[tuple[float, float]]]]:
    """Extract closed LWPOLYLINE contours on FIRE_ROOMS layer."""
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

    return polylines


def _build_fire_rooms(
    polylines: list[tuple[Polygon, list[tuple[float, float]]]],
    msp: Any,
    target_layer: str,
    resolved_drawing_id: UUID,
    area_multiplier: float,
) -> ParsedRoomsList:
    """Build Room entities from FIRE_ROOMS closed polylines."""
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

    rooms = ParsedRoomsList(source="fire_rooms")
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
            type=suggest_room_type(room_name),
            height=None,
            area=area_m2,
            polygon=contract_polygon,
        )
        object.__setattr__(room, "source", "fire_rooms")
        rooms.append(room)

    return rooms


def _build_auto_rooms(
    polygons: list[Polygon],
    msp: Any,
    explication_map: dict[str, str],
    resolved_drawing_id: UUID,
    area_multiplier: float,
    text_entries: list[tuple[Point, str]] | None = None,
) -> ParsedRoomsList:
    """Build Room entities from automatically polygonized contours."""
    if text_entries is None:
        text_entries = _extract_text_entries(msp)

    rooms = ParsedRoomsList(source="auto")
    for poly in polygons:
        texts_in_poly = [text for pt, text in text_entries if poly.contains(pt)]

        matched_name: str | None = None

        # 1. Direct explication pattern (e.g. "101 | Office")
        for t in texts_in_poly:
            m = EXPLICATION_PATTERN.match(t)
            if m:
                matched_name = m.group(3).strip()
                break

        # 2. Check if any text is an explicit room name (NOT only a number, NOT an area)
        if not matched_name:
            for t in texts_in_poly:
                if not _is_only_number(t) and not _is_area_string(t):
                    matched_name = t
                    break

        # 3. If only numbers were found, look up in explication_map
        if not matched_name:
            for t in texts_in_poly:
                if _is_only_number(t):
                    norm = _normalize_room_number(t)
                    if norm in explication_map:
                        matched_name = explication_map[norm]
                        break
                    if norm.lower() in explication_map:
                        matched_name = explication_map[norm.lower()]
                        break

        if matched_name:
            name: str | None = matched_name
            room_type: str | None = suggest_room_type(matched_name)
        else:
            name = DEFAULT_UNNAMED_ROOM_NAME
            room_type = None

        coords = [(float(x), float(y)) for x, y in poly.exterior.coords[:-1]]
        contract_polygon = [ContractPoint(x=x, y=y) for x, y in coords]
        area_m2 = round(poly.area * area_multiplier, 4)

        room = Room(
            id=str(uuid.uuid4()),
            drawingId=resolved_drawing_id,
            name=name,
            type=room_type,
            height=None,
            area=area_m2,
            polygon=contract_polygon,
        )
        object.__setattr__(room, "source", "auto")
        rooms.append(room)

    return rooms


def parse_dxf_rooms(
    file_path: str | Path,
    drawing_id: UUID | None = None,
) -> list[Room]:
    """Parse DXF file and extract Room entities.

    Tries fast path on FIRE_ROOMS layer first. If missing or without valid contours,
    falls back to automatic wall polygonization, gap bridging, and explication parsing.

    Args:
        file_path: Path to the DXF file.
        drawing_id: Optional UUID of the drawing; generates a new one if not provided.

    Returns:
        List of parsed Room entities.

    Raises:
        CADParsingError: If file loading fails, or no rooms can be found.
    """
    path = Path(file_path)
    if not path.is_file():
        raise CADParsingError(f"DXF file not found: {file_path}")

    doc = read_dxf_document(path)

    area_multiplier = get_area_multiplier(doc)
    msp = doc.modelspace()
    resolved_drawing_id = drawing_id or uuid.uuid4()

    # 1. Fast path: check for closed polylines on FIRE_ROOMS
    target_layer = "FIRE_ROOMS"
    has_fire_layer = any(layer.dxf.name.upper() == target_layer for layer in doc.layers)

    if has_fire_layer:
        fire_polylines = _extract_fire_rooms_polylines(msp, target_layer)
        if fire_polylines:
            return _build_fire_rooms(
                fire_polylines,
                msp,
                target_layer,
                resolved_drawing_id,
                area_multiplier,
            )

    # 2. Fallback path: Automatic wall polygonization (Option A)
    segments = _extract_walls_and_bridge_gaps(msp)
    text_entries = _extract_text_entries(msp)
    filtered_polygons = _polygonize_and_filter(
        segments,
        min_area_m2=0.5,
        area_multiplier=area_multiplier,
        text_entries=text_entries,
    )
    if not filtered_polygons:
        raise CADParsingError("Приміщення не знайдено")

    explication_map = _parse_explication(msp)
    rooms = _build_auto_rooms(
        filtered_polygons,
        msp,
        explication_map,
        resolved_drawing_id,
        area_multiplier,
        text_entries=text_entries,
    )
    if not rooms:
        raise CADParsingError("Приміщення не знайдено")

    return rooms


parse_dxf = parse_dxf_rooms
