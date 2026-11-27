"""Deterministic fire-safety compliance audit engine (BIM-77).

Evaluates placed devices, room/zone geometry, exits, passages, and active rules
from ``public.rules`` to produce structured ``Finding`` objects aligned with
``packages/contracts``.
"""

from __future__ import annotations

import logging
import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any
from uuid import NAMESPACE_URL, UUID, uuid5

from shapely.geometry import LineString, Polygon
from shapely.geometry import Point as ShapelyPoint
from shapely.ops import unary_union
from supabase import Client

from src.contracts.generated import Finding, FindingRuleStatus, FindingSeverity
from src.contracts.norms import is_disallowed_document
from src.modules.drawings.access import all_rows
from src.modules.drawings.service import is_missing_schema_error, stored_unit_scale_m
from src.modules.placement.manual_call_points import (
    ROUTE_UNCONFIRMED,
    CallPointRoom,
    CallPointRule,
    _Network,
    _Room,
    _shortest_paths,
    exits_from_rows,
    passages_from_rows,
    place_manual_call_points,
    rooms_from_rows,
    select_call_point_rule,
)
from src.modules.placement.service import (
    SCOPE_REMAINDER,
    RuleRecord,
    _parse_float,
    _parse_optional_float,
    _protected_area_m2,
    _shoelace_area,
    _valid_shape,
    build_placement_targets,
    effective_grid_step_m,
    row_coords,
    row_height_m,
    select_rule_for_room,
)

logger = logging.getLogger(__name__)

DEFAULT_MIN_WALL_CLEARANCE_M = 0.5
COVERAGE_TOLERANCE_MIN_M2 = 0.05
COVERAGE_TOLERANCE_RATIO = 0.005

_DEVICE_TYPE_LABELS_UK: dict[str, str] = {
    "smoke_detector": "димових сповіщувачів",
    "heat_detector": "теплових сповіщувачів",
    "sounder": "пожежних оповіщувачів",
    "manual_call_point": "ручних сповіщувачів",
}


@dataclass(frozen=True)
class _DevicePoint:
    id: str
    type: str
    room_id: str | None
    x_m: float
    y_m: float


def _is_undefined_column_error(exc: Exception) -> bool:
    parts = [str(exc)]
    for attr in ("code", "message", "details", "hint"):
        val = getattr(exc, attr, None)
        if val is not None:
            parts.append(str(val))
    for arg in getattr(exc, "args", ()):
        parts.append(str(arg))
    return "42703" in " ".join(parts)


def _is_unavailable_schema_or_fake(exc: Exception) -> bool:
    return (
        isinstance(exc, KeyError)
        or is_missing_schema_error(exc)
        or _is_undefined_column_error(exc)
    )


def _safe_select_rows(
    supabase: Client,
    table_name: str,
    *,
    drawing_id: str | None = None,
) -> list[dict[str, Any]]:
    try:
        query = supabase.table(table_name).select("*")
        if drawing_id is not None:
            query = query.eq("drawing_id", drawing_id)
        response = query.execute()
    except Exception as exc:
        if _is_unavailable_schema_or_fake(exc):
            return []
        raise
    return all_rows(response)


def _finding_id(*parts: object) -> str:
    key = "|".join(str(part or "") for part in parts)
    return str(uuid5(NAMESPACE_URL, f"bim-finding:{key}"))


def _normalize_rule_status(raw_status: object) -> FindingRuleStatus:
    value = str(raw_status or "").strip().lower()
    if value == "verified":
        return FindingRuleStatus.verified
    return FindingRuleStatus.needs_review


def _is_rule_row_allowed(row: Mapping[str, object]) -> bool:
    document = row.get("document")
    if isinstance(document, str) and is_disallowed_document(document):
        return False
    source_url = row.get("source_url")
    if isinstance(source_url, str):
        lowered = source_url.lower()
        if any(suffix in lowered for suffix in (".ru", ".su", ".рф")):
            return False
    return True


def _filter_allowed_rules(
    rule_rows: Sequence[Mapping[str, object]],
) -> list[dict[str, Any]]:
    return [
        dict(row)
        for row in rule_rows
        if isinstance(row, Mapping) and _is_rule_row_allowed(row)
    ]


def _resolve_unit_scale_m(
    drawing_row: Mapping[str, Any] | None,
    room_rows: Sequence[Mapping[str, Any]],
    explicit_scale: float | None,
) -> float:
    if explicit_scale is not None and explicit_scale > 0:
        return explicit_scale
    if drawing_row is not None:
        stored = stored_unit_scale_m(dict(drawing_row))
        if stored is not None:
            return stored
        units_raw = (
            str(drawing_row.get("resolved_units") or drawing_row.get("units") or "")
            .strip()
            .lower()
        )
        if units_raw == "m":
            return 1.0
        if units_raw == "mm":
            return 0.001

    for room in room_rows:
        coords = row_coords(room)
        raw_area = room.get("area")
        shoelace = _shoelace_area(coords)
        if isinstance(raw_area, (int, float)) and float(raw_area) > 0 and shoelace > 0:
            scale = math.sqrt(float(raw_area) / shoelace)
            if scale > 0 and math.isfinite(scale):
                return scale
    return 0.001


def _parse_devices(
    device_rows: Sequence[Mapping[str, Any]], unit_scale_m: float
) -> list[_DevicePoint]:
    devices: list[_DevicePoint] = []
    for row in device_rows:
        dev_id = str(row.get("id") or "")
        if not dev_id:
            continue
        x_raw: float | None = None
        y_raw: float | None = None
        if row.get("x") is not None and row.get("y") is not None:
            try:
                x_raw = float(row["x"])
                y_raw = float(row["y"])
            except (TypeError, ValueError):
                pass
        elif isinstance(row.get("position"), Mapping):
            pos = row["position"]
            try:
                x_raw = float(pos["x"])
                y_raw = float(pos["y"])
            except (KeyError, TypeError, ValueError):
                pass
        if x_raw is None or y_raw is None:
            continue
        devices.append(
            _DevicePoint(
                id=dev_id,
                type=str(row.get("type") or "smoke_detector"),
                room_id=str(row["room_id"]) if row.get("room_id") else None,
                x_m=x_raw * unit_scale_m,
                y_m=y_raw * unit_scale_m,
            )
        )
    return devices


def _rule_ref(
    rule: RuleRecord | CallPointRule | None,
) -> tuple[str | None, str | None, str | None, FindingRuleStatus | None]:
    if rule is None:
        return None, None, None, None
    doc = (
        rule.document
        if rule.document and not is_disallowed_document(rule.document)
        else None
    )
    clause = rule.clause
    return rule.id, doc, clause, _normalize_rule_status(rule.status)


def _make_finding(
    *,
    drawing_uuid: UUID,
    key_parts: tuple[object, ...],
    severity: FindingSeverity,
    message: str,
    room_id: str | None = None,
    device_id: str | None = None,
    rule_id: str | None = None,
    document: str | None = None,
    clause: str | None = None,
    rule_status: FindingRuleStatus | None = None,
    conflict_details: dict[str, Any] | None = None,
    details: dict[str, Any] | None = None,
) -> Finding:
    return Finding(
        id=_finding_id(drawing_uuid, *key_parts),
        drawingId=drawing_uuid,
        roomId=room_id,
        deviceId=device_id,
        ruleId=rule_id,
        severity=severity,
        message=message,
        document=document,
        clause=clause,
        ruleStatus=rule_status,
        conflictDetails=conflict_details,
        details=details,
    )


def _matching_rule_candidates(
    rules: Sequence[Mapping[str, object]],
    *,
    device_type: str,
    room_type: str | None,
    room_height_m: float | None,
    value_kind: str,
) -> list[tuple[bool, float | None, float | None, RuleRecord]]:
    """Return matching rules filtered to highest room_type specificity."""
    normalized_room_type = (room_type or "").strip().casefold()
    matched: list[tuple[bool, float | None, float | None, RuleRecord]] = []

    for row in rules:
        if str(row.get("device_type") or "") != device_type:
            continue
        if str(row.get("value_kind") or "") != value_kind:
            continue
        raw_room_types = row.get("room_types") or []
        if not isinstance(raw_room_types, (list, tuple)):
            continue
        room_types = [str(item).strip() for item in raw_room_types if str(item).strip()]
        if room_types and (
            not normalized_room_type
            or normalized_room_type not in {item.casefold() for item in room_types}
        ):
            continue
        try:
            value = _parse_float(row.get("value"))
            min_h = _parse_optional_float(row.get("min_height_m"))
            max_h = _parse_optional_float(row.get("max_height_m"))
        except (TypeError, ValueError):
            continue
        if value <= 0:
            continue
        if min_h is not None or max_h is not None:
            if room_height_m is None:
                continue
            if min_h is not None and room_height_m < min_h:
                continue
            if max_h is not None and room_height_m > max_h:
                continue
        database_id = str(row.get("id") or "")
        if not database_id:
            continue
        record = RuleRecord(
            id=database_id,
            threshold=value,
            status=str(row.get("verification_status") or "needs_review"),
            rule_id=str(row.get("rule_id") or database_id),
            name=str(row.get("name") or ""),
            device_type=device_type,
            value_kind=value_kind,
            document=str(row["document"]) if row.get("document") is not None else None,
            clause=str(row["clause"]) if row.get("clause") is not None else None,
            source_url=(
                str(row["source_url"]) if row.get("source_url") is not None else None
            ),
            max_protected_area_m2=_protected_area_m2(row),
        )
        matched.append((bool(room_types), min_h, max_h, record))

    if any(item[0] for item in matched):
        return [item for item in matched if item[0]]
    return matched


def _heights_genuinely_overlap(
    min_a: float | None,
    max_a: float | None,
    min_b: float | None,
    max_b: float | None,
) -> bool:
    """True when two height intervals overlap on more than a single boundary point."""
    lo = max(min_a if min_a is not None else 0.0, min_b if min_b is not None else 0.0)
    hi = min(
        max_a if max_a is not None else math.inf,
        max_b if max_b is not None else math.inf,
    )
    return lo < hi - 1e-9


def _unit_for_value_kind(value_kind: str) -> str:
    if value_kind == "max_protected_area_m2":
        return "м²"
    if value_kind == "min_sound_level_dba":
        return "дБА"
    return "м"


def _format_rule_citation(
    doc: str | None,
    clause: str | None,
    value: float,
    value_kind: str,
    area_m2: float | None = None,
) -> str:
    doc_label = doc or "Документ не вказано"
    clause_label = clause if clause else "пункт не вказано"
    unit = _unit_for_value_kind(value_kind)
    parts = f"{doc_label} ({clause_label}) = {value:g} {unit}"
    if area_m2 is not None and area_m2 > 0:
        parts += f" / {area_m2:g} м²"
    return parts


def _detect_rule_conflicts(
    rules: Sequence[Mapping[str, object]],
    *,
    drawing_uuid: UUID,
    device_type: str,
    room_type: str | None,
    room_height_m: float | None,
    value_kind: str,
    selected_rule: RuleRecord | CallPointRule,
    room_id: str | None,
    emitted_conflict_keys: set[tuple[str, str, tuple[str, ...]]],
) -> list[Finding]:
    candidates = _matching_rule_candidates(
        rules,
        device_type=device_type,
        room_type=room_type,
        room_height_m=room_height_m,
        value_kind=value_kind,
    )
    if len(candidates) < 2:
        return []

    winner_entry = next(
        (item for item in candidates if item[3].id == selected_rule.id), None
    )
    if winner_entry is None:
        return []
    _, win_min_h, win_max_h, winner = winner_entry
    win_doc = (winner.document or "").strip().casefold()

    conflicting: list[RuleRecord] = []
    for _, min_h, max_h, other in candidates:
        if other.id == winner.id:
            continue
        other_doc = (other.document or "").strip().casefold()
        if not win_doc or not other_doc or other_doc == win_doc:
            continue
        if not _heights_genuinely_overlap(win_min_h, win_max_h, min_h, max_h):
            continue
        differs_value = abs(other.threshold - winner.threshold) > 1e-6
        differs_area = (
            other.max_protected_area_m2 is not None
            and winner.max_protected_area_m2 is not None
            and abs(other.max_protected_area_m2 - winner.max_protected_area_m2) > 1e-6
        )
        if differs_value or differs_area:
            conflicting.append(other)

    if not conflicting:
        return []

    all_involved = [winner, *conflicting]
    rule_ids_key = tuple(sorted(rule.id for rule in all_involved))
    dedupe_key = (device_type, value_kind, rule_ids_key)
    if dedupe_key in emitted_conflict_keys:
        return []
    emitted_conflict_keys.add(dedupe_key)

    label = _DEVICE_TYPE_LABELS_UK.get(device_type, device_type)
    citations = " vs ".join(
        _format_rule_citation(
            r.document,
            r.clause,
            r.threshold,
            value_kind,
            r.max_protected_area_m2,
        )
        for r in all_involved
    )
    unit = _unit_for_value_kind(value_kind)
    message = (
        f"Конфлікт норм для {label}: {citations}. "
        f"Застосовано суворіше значення: {winner.threshold:g} {unit}."
    )
    rule_id, doc, clause, rule_status = _rule_ref(winner)
    conflict_details = {
        "deviceType": device_type,
        "valueKind": value_kind,
        "appliedRuleId": winner.id,
        "rules": [
            {
                "id": r.id,
                "ruleId": r.rule_id,
                "document": r.document,
                "clause": r.clause,
                "value": r.threshold,
                "maxProtectedAreaM2": r.max_protected_area_m2,
                "verificationStatus": _normalize_rule_status(r.status).value,
            }
            for r in all_involved
        ],
    }
    return [
        _make_finding(
            drawing_uuid=drawing_uuid,
            key_parts=("rule_conflict", device_type, value_kind, *rule_ids_key),
            severity=FindingSeverity.rule_conflict,
            message=message,
            room_id=room_id,
            rule_id=rule_id,
            document=doc,
            clause=clause,
            rule_status=rule_status,
            conflict_details=conflict_details,
        )
    ]


def _maybe_unverified_finding(
    *,
    drawing_uuid: UUID,
    rule: RuleRecord | CallPointRule,
    room_id: str | None,
    emitted_unverified: set[tuple[str, str | None]],
) -> Finding | None:
    status = _normalize_rule_status(rule.status)
    if status == FindingRuleStatus.verified:
        return None
    key = (rule.id, room_id)
    if key in emitted_unverified:
        return None
    emitted_unverified.add(key)
    rule_id, doc, clause, rule_status = _rule_ref(rule)
    rule_label = rule.name or rule.rule_id
    return _make_finding(
        drawing_uuid=drawing_uuid,
        key_parts=("unverified_rule", rule.id, room_id or ""),
        severity=FindingSeverity.warning,
        message=(
            f"Правило «{rule_label}» потребує перевірки "
            f"({doc or 'норматив не вказано'})"
        ),
        room_id=room_id,
        rule_id=rule_id,
        document=doc,
        clause=clause,
        rule_status=rule_status,
    )


def _scale_coords(
    coords: Sequence[tuple[float, float]], scale: float
) -> list[tuple[float, float]]:
    return [(x * scale, y * scale) for x, y in coords]


def _distance_to_boundary(poly: Polygon, point: tuple[float, float]) -> float:
    pt = ShapelyPoint(point)
    min_dist = float(poly.exterior.distance(pt))
    for interior in poly.interiors:
        min_dist = min(min_dist, float(interior.distance(pt)))
    return min_dist


def _max_inscribed_clearance(poly: Polygon) -> float:
    """Approximate maximum clearance from walls inside ``poly``."""
    min_x, min_y, max_x, max_y = poly.bounds
    width = max_x - min_x
    height = max_y - min_y
    if width <= 0 or height <= 0:
        return 0.0
    rep = poly.representative_point()
    best = _distance_to_boundary(poly, (rep.x, rep.y))
    steps = 12
    for ix in range(steps):
        for iy in range(steps):
            cx = min_x + (ix + 0.5) * width / steps
            cy = min_y + (iy + 0.5) * height / steps
            pt = ShapelyPoint(cx, cy)
            if poly.covers(pt):
                best = max(best, _distance_to_boundary(poly, (cx, cy)))
    return best


def _max_distance_to_points(
    poly: Polygon, points: Sequence[tuple[float, float]]
) -> float:
    """Maximum distance from sampled points in ``poly`` to nearest detector."""
    if not points:
        return math.inf
    sample_points: list[tuple[float, float]] = list(poly.exterior.coords)
    coords = list(poly.exterior.coords)
    for a, b in zip(coords, coords[1:], strict=False):
        seg_len = math.hypot(b[0] - a[0], b[1] - a[1])
        parts = max(2, min(16, int(math.ceil(seg_len / 1.0))))
        for k in range(1, parts):
            t = k / parts
            sample_points.append((a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])))

    min_x, min_y, max_x, max_y = poly.bounds
    nx = max(6, min(20, int(math.ceil((max_x - min_x) / 1.0))))
    ny = max(6, min(20, int(math.ceil((max_y - min_y) / 1.0))))
    for ix in range(nx):
        for iy in range(ny):
            cx = min_x + (ix + 0.5) * (max_x - min_x) / nx
            cy = min_y + (iy + 0.5) * (max_y - min_y) / ny
            if poly.covers(ShapelyPoint(cx, cy)):
                sample_points.append((cx, cy))

    max_dist = 0.0
    for sx, sy in sample_points:
        nearest = min(math.hypot(sx - px, sy - py) for px, py in points)
        if nearest > max_dist:
            max_dist = nearest
    return max_dist


def _max_mst_edge(
    points: Sequence[tuple[float, float]], poly: Polygon | None = None
) -> float:
    """Maximum edge length in the Minimum Spanning Tree of ``points``."""
    count = len(points)
    if count < 2:
        return 0.0

    poly_buf = poly.buffer(0.05) if poly is not None else None
    edges: list[tuple[int, float, int, int]] = []
    for i in range(count):
        for j in range(i + 1, count):
            dist = math.hypot(points[i][0] - points[j][0], points[i][1] - points[j][1])
            inside = 0
            if poly_buf is not None:
                line = LineString([points[i], points[j]])
                inside = 0 if poly_buf.covers(line) else 1
            edges.append((inside, dist, i, j))
    edges.sort()

    parent = list(range(count))

    def find(node: int) -> int:
        while parent[node] != node:
            parent[node] = parent[parent[node]]
            node = parent[node]
        return node

    max_edge = 0.0
    for _, dist, i, j in edges:
        ra, rb = find(i), find(j)
        if ra != rb:
            parent[ra] = rb
            if dist > max_edge:
                max_edge = dist
    return max_edge


def _min_pairwise_distance(points: Sequence[tuple[float, float]]) -> float:
    if len(points) < 2:
        return math.inf
    return min(
        math.hypot(points[i][0] - points[j][0], points[i][1] - points[j][1])
        for i in range(len(points))
        for j in range(i + 1, len(points))
    )


def _max_wall_segment_distance(
    poly: Polygon, points: Sequence[tuple[float, float]]
) -> float:
    """Maximum distance from any non-trivial wall segment to nearest detector."""
    if not points:
        return math.inf
    det_shapely = [ShapelyPoint(p) for p in points]
    coords = list(poly.exterior.coords)
    max_wall_dist = 0.0
    for a, b in zip(coords, coords[1:], strict=False):
        if math.hypot(b[0] - a[0], b[1] - a[1]) < 0.1:
            continue
        segment = LineString([a, b])
        nearest = min(float(segment.distance(det)) for det in det_shapely)
        if nearest > max_wall_dist:
            max_wall_dist = nearest
    return max_wall_dist


def _resolve_min_wall_clearance(
    rules: Sequence[Mapping[str, object]],
    *,
    device_type: str,
    room_type: str | None,
    height_m: float,
    wall_rule: RuleRecord | None,
    grid_rule: RuleRecord,
) -> tuple[float, RuleRecord]:
    clearance_rule = select_rule_for_room(
        rules,
        device_type=device_type,
        room_type=room_type,
        room_height_m=height_m,
        value_kind="min_wall_clearance_m",
    )
    if clearance_rule is not None:
        return clearance_rule.threshold, clearance_rule

    for candidate in (wall_rule, grid_rule):
        if candidate is None:
            continue
        for row in rules:
            if str(row.get("id") or "") != candidate.id:
                continue
            conditions = row.get("conditions")
            if isinstance(conditions, Mapping):
                raw_min = _parse_optional_float(conditions.get("min_wall_clearance_m"))
                if raw_min is not None and raw_min > 0:
                    return raw_min, candidate

    return DEFAULT_MIN_WALL_CLEARANCE_M, wall_rule or grid_rule


def _evaluate_mcp_findings(
    *,
    drawing_uuid: UUID,
    room_rows: Sequence[Mapping[str, Any]],
    exit_rows: Sequence[Mapping[str, Any]],
    passage_rows: Sequence[Mapping[str, Any]],
    mcp_devices: Sequence[_DevicePoint],
    valid_rules: Sequence[Mapping[str, Any]],
    unit_scale_m: float,
    emitted_conflict_keys: set[tuple[str, str, tuple[str, ...]]],
    emitted_unverified: set[tuple[str, str | None]],
) -> list[Finding]:
    findings: list[Finding] = []
    rule_dicts = [dict(r) for r in valid_rules]
    mcp_rule, alternatives = select_call_point_rule(rule_dicts)
    if mcp_rule is None:
        if mcp_devices or exit_rows:
            findings.append(
                _make_finding(
                    drawing_uuid=drawing_uuid,
                    key_parts=("mcp", "no_rule"),
                    severity=FindingSeverity.insufficient_data,
                    message=(
                        "Відсутнє правило розміщення для ручних пожежних сповіщувачів "
                        "(manual_call_point)"
                    ),
                )
            )
        return findings

    selected_as_record = RuleRecord(
        id=mcp_rule.id,
        threshold=mcp_rule.max_spacing_m,
        status=mcp_rule.status,
        rule_id=mcp_rule.rule_id,
        name=mcp_rule.name,
        device_type="manual_call_point",
        value_kind="max_grid_spacing_m",
        document=mcp_rule.document,
        clause=mcp_rule.clause,
        source_url=mcp_rule.source_url,
    )
    findings.extend(
        _detect_rule_conflicts(
            valid_rules,
            drawing_uuid=drawing_uuid,
            device_type="manual_call_point",
            room_type=None,
            room_height_m=None,
            value_kind="max_grid_spacing_m",
            selected_rule=selected_as_record,
            room_id=None,
            emitted_conflict_keys=emitted_conflict_keys,
        )
    )
    unverified = _maybe_unverified_finding(
        drawing_uuid=drawing_uuid,
        rule=mcp_rule,
        room_id=None,
        emitted_unverified=emitted_unverified,
    )
    if unverified is not None:
        findings.append(unverified)

    rule_id, doc, clause, rule_status = _rule_ref(mcp_rule)
    del alternatives

    if not exit_rows:
        findings.append(
            _make_finding(
                drawing_uuid=drawing_uuid,
                key_parts=("mcp", "missing_exits"),
                severity=FindingSeverity.insufficient_data,
                message=(
                    "Не позначено евакуаційні виходи для перевірки ручних пожежних "
                    "сповіщувачів"
                ),
                rule_id=rule_id,
                document=doc,
                clause=clause,
                rule_status=rule_status,
            )
        )
        return findings

    cp_rooms = rooms_from_rows([dict(r) for r in room_rows])
    cp_exits = exits_from_rows([dict(e) for e in exit_rows])
    cp_passages = passages_from_rows([dict(p) for p in passage_rows])

    cp_outcome = place_manual_call_points(
        rooms=cp_rooms,
        exits=cp_exits,
        rule_rows=rule_dicts,
        unit_scale_m=unit_scale_m,
        passages=cp_passages,
    )
    if cp_outcome.route_coverage == ROUTE_UNCONFIRMED:
        findings.append(
            _make_finding(
                drawing_uuid=drawing_uuid,
                key_parts=("mcp", "route_unconfirmed"),
                severity=FindingSeverity.insufficient_data,
                message=cp_outcome.route_warning
                or "Шлях евакуації між виходами не підтверджено",
                rule_id=rule_id,
                document=doc,
                clause=clause,
                rule_status=rule_status,
            )
        )

    if not mcp_devices:
        findings.append(
            _make_finding(
                drawing_uuid=drawing_uuid,
                key_parts=("mcp", "none_placed"),
                severity=FindingSeverity.critical,
                message="Біля евакуаційних виходів відсутні ручні пожежні сповіщувачі",
                rule_id=rule_id,
                document=doc,
                clause=clause,
                rule_status=rule_status,
            )
        )
        return findings

    exit_proximity_m = max(5.0, (mcp_rule.exit_offset_m or 1.0) + 3.0)
    for exit_row in cp_exits:
        ex_m = (exit_row.x * unit_scale_m, exit_row.y * unit_scale_m)
        nearest_mcp = min(
            math.hypot(ex_m[0] - d.x_m, ex_m[1] - d.y_m) for d in mcp_devices
        )
        if nearest_mcp > exit_proximity_m:
            findings.append(
                _make_finding(
                    drawing_uuid=drawing_uuid,
                    key_parts=("mcp", "exit_uncovered", exit_row.id),
                    severity=FindingSeverity.critical,
                    message=(
                        f"Біля евакуаційного виходу «{exit_row.name or exit_row.id}» "
                        "відсутній ручний пожежний сповіщувач"
                    ),
                    rule_id=rule_id,
                    document=doc,
                    clause=clause,
                    rule_status=rule_status,
                )
            )

    if len(mcp_devices) < 2:
        return findings

    # Перевіряємо максимальну відстань між сусідніми ручними сповіщувачами
    # вздовж підтверджених шляхів евакуації (у метрах).
    scaled_rooms = [
        _Room(
            CallPointRoom(
                id=r.id,
                name=r.name,
                type=r.type,
                coords=tuple(_scale_coords(r.coords, unit_scale_m)),
            )
        )
        for r in cp_rooms
    ]
    if not scaled_rooms:
        return findings

    network = _Network(scaled_rooms)
    mcp_node_ids: list[int] = []
    for dev in mcp_devices:
        pt = (dev.x_m, dev.y_m)
        room = network.room_at(pt)
        if room is None:
            room = min(scaled_rooms, key=lambda rm: rm.boundary_distance(pt))
            pt = network.snap_into_room(pt, 0.15)
        mcp_node_ids.append(network.add_node(pt, room.room.id))

    for room in scaled_rooms:
        network.add_node(room.interior_point(), room.room.id)
        for wp in room.inward_reflex_points(0.15):
            network.add_node(wp, room.room.id)

    by_id = network.by_id
    for passage in cp_passages:
        pt = (passage.x * unit_scale_m, passage.y * unit_scale_m)
        first = by_id.get(passage.room_a_id) if passage.room_a_id else None
        second = by_id.get(passage.room_b_id) if passage.room_b_id else None
        if (
            first is None
            or second is None
            or first is second
            or first.boundary_distance(pt) > 0.8
            or second.boundary_distance(pt) > 0.8
        ):
            continue
        n1 = network.add_node(network.snap_into_room(pt, 0.25), first.room.id)
        n2 = network.add_node(network.snap_into_room(pt, 0.25), second.room.id)
        network.add_link(n1, n2)

    paths = _shortest_paths(network, mcp_node_ids)
    # Будуємо MST у межах кожної зв'язної компоненти шляхів між РПС.
    edges: list[tuple[float, int, int]] = []
    for i, node_a in enumerate(mcp_node_ids):
        dists = paths[node_a][0]
        for j in range(i + 1, len(mcp_node_ids)):
            node_b = mcp_node_ids[j]
            if node_b in dists:
                edges.append((dists[node_b], i, j))
    edges.sort()

    parent = list(range(len(mcp_devices)))

    def find(idx: int) -> int:
        while parent[idx] != idx:
            parent[idx] = parent[parent[idx]]
            idx = parent[idx]
        return idx

    max_mcp_gap = 0.0
    for dist, i, j in edges:
        ra, rb = find(i), find(j)
        if ra != rb:
            parent[ra] = rb
            if dist > max_mcp_gap:
                max_mcp_gap = dist

    if max_mcp_gap > mcp_rule.max_spacing_m + 1e-4:
        findings.append(
            _make_finding(
                drawing_uuid=drawing_uuid,
                key_parts=("mcp", "spacing_exceeded"),
                severity=FindingSeverity.critical,
                message=(
                    f"Відстань між ручними пожежними сповіщувачами вздовж шляху "
                    f"евакуації становить {max_mcp_gap:.1f} м, що перевищує норму "
                    f"{mcp_rule.max_spacing_m:g} м"
                ),
                rule_id=rule_id,
                document=doc,
                clause=clause,
                rule_status=rule_status,
                details={
                    "measuredSpacingM": round(max_mcp_gap, 3),
                    "maxSpacingM": mcp_rule.max_spacing_m,
                },
            )
        )

    return findings


def _evaluate_sounder_for_target(
    *,
    drawing_uuid: UUID,
    room_id: str,
    zone_id: str | None,
    zone_label: str | None,
    room_type: str | None,
    height_m: float | None,
    target_poly_m: Polygon,
    target_area_m2: float,
    target_sounders: Sequence[_DevicePoint],
    valid_rules: Sequence[Mapping[str, Any]],
    emitted_conflict_keys: set[tuple[str, str, tuple[str, ...]]],
    emitted_unverified: set[tuple[str, str | None]],
) -> list[Finding]:
    findings: list[Finding] = []
    sounder_rule = select_rule_for_room(
        valid_rules,
        device_type="sounder",
        room_type=room_type,
        room_height_m=height_m,
        value_kind="max_grid_spacing_m",
    )
    if sounder_rule is None:
        sounder_rule = select_rule_for_room(
            valid_rules,
            device_type="sounder",
            room_type=room_type,
            room_height_m=height_m,
            value_kind="min_sound_level_dba",
        )
    if sounder_rule is None:
        return findings

    findings.extend(
        _detect_rule_conflicts(
            valid_rules,
            drawing_uuid=drawing_uuid,
            device_type="sounder",
            room_type=room_type,
            room_height_m=height_m,
            value_kind=sounder_rule.value_kind,
            selected_rule=sounder_rule,
            room_id=room_id,
            emitted_conflict_keys=emitted_conflict_keys,
        )
    )
    unverified = _maybe_unverified_finding(
        drawing_uuid=drawing_uuid,
        rule=sounder_rule,
        room_id=room_id,
        emitted_unverified=emitted_unverified,
    )
    if unverified is not None:
        findings.append(unverified)

    rule_id, doc, clause, rule_status = _rule_ref(sounder_rule)
    suffix = f" ({zone_label})" if zone_label else ""
    if not target_sounders:
        findings.append(
            _make_finding(
                drawing_uuid=drawing_uuid,
                key_parts=("sounder", "missing", room_id, zone_id or ""),
                severity=FindingSeverity.critical,
                message=f"У приміщенні{suffix} відсутній пожежний оповіщувач",
                room_id=room_id,
                rule_id=rule_id,
                document=doc,
                clause=clause,
                rule_status=rule_status,
            )
        )
        return findings

    if sounder_rule.value_kind == "max_grid_spacing_m" and len(target_sounders) >= 1:
        pts = [(d.x_m, d.y_m) for d in target_sounders]
        step_m = effective_grid_step_m(sounder_rule)
        r_cov = step_m * math.sqrt(2.0) / 2.0
        covered = unary_union([ShapelyPoint(p).buffer(r_cov) for p in pts])
        uncovered = target_poly_m.difference(covered)
        if not uncovered.is_empty and uncovered.area > max(
            COVERAGE_TOLERANCE_MIN_M2, target_area_m2 * COVERAGE_TOLERANCE_RATIO
        ):
            max_dist = _max_distance_to_points(target_poly_m, pts)
            findings.append(
                _make_finding(
                    drawing_uuid=drawing_uuid,
                    key_parts=("sounder", "coverage", room_id, zone_id or ""),
                    severity=FindingSeverity.critical,
                    message=(
                        f"Неповне покриття приміщення{suffix} оповіщувачами: "
                        f"відстань {max_dist:.2f} м перевищує допустимий радіус "
                        f"{r_cov:.2f} м"
                    ),
                    room_id=room_id,
                    rule_id=rule_id,
                    document=doc,
                    clause=clause,
                    rule_status=rule_status,
                )
            )
    return findings


def _evaluate_detector_target(
    *,
    drawing_uuid: UUID,
    room_id: str,
    zone_id: str | None,
    zone_label: str | None,
    room_type: str | None,
    height_m: float | None,
    target_poly_m: Polygon,
    target_area_m2: float,
    target_detectors: Sequence[_DevicePoint],
    valid_rules: Sequence[Mapping[str, Any]],
    emitted_conflict_keys: set[tuple[str, str, tuple[str, ...]]],
    emitted_unverified: set[tuple[str, str | None]],
) -> list[Finding]:
    findings: list[Finding] = []
    suffix = f" ({zone_label})" if zone_label else ""

    if height_m is None or height_m <= 0:
        findings.append(
            _make_finding(
                drawing_uuid=drawing_uuid,
                key_parts=("missing_height", room_id, zone_id or ""),
                severity=FindingSeverity.insufficient_data,
                message=(
                    f"Не введено висоту приміщення{suffix}"
                    if zone_label
                    else "Не введено висоту приміщення"
                ),
                room_id=room_id,
            )
        )
        return findings

    smoke_devs = [d for d in target_detectors if d.type == "smoke_detector"]
    heat_devs = [d for d in target_detectors if d.type == "heat_detector"]
    if heat_devs and not smoke_devs:
        primary_type = "heat_detector"
        checked_devs = heat_devs
    else:
        primary_type = "smoke_detector"
        checked_devs = smoke_devs or heat_devs

    grid_rule = select_rule_for_room(
        valid_rules,
        device_type=primary_type,
        room_type=room_type,
        room_height_m=height_m,
        value_kind="max_grid_spacing_m",
    )
    if grid_rule is None:
        findings.append(
            _make_finding(
                drawing_uuid=drawing_uuid,
                key_parts=("missing_rule", primary_type, room_id, zone_id or ""),
                severity=FindingSeverity.insufficient_data,
                message=(
                    f"Відсутнє правило розміщення ({primary_type}) для висоти "
                    f"{height_m:g} м{suffix}"
                ),
                room_id=room_id,
            )
        )
        return findings

    findings.extend(
        _detect_rule_conflicts(
            valid_rules,
            drawing_uuid=drawing_uuid,
            device_type=primary_type,
            room_type=room_type,
            room_height_m=height_m,
            value_kind="max_grid_spacing_m",
            selected_rule=grid_rule,
            room_id=room_id,
            emitted_conflict_keys=emitted_conflict_keys,
        )
    )
    unverified_grid = _maybe_unverified_finding(
        drawing_uuid=drawing_uuid,
        rule=grid_rule,
        room_id=room_id,
        emitted_unverified=emitted_unverified,
    )
    if unverified_grid is not None:
        findings.append(unverified_grid)

    wall_rule = select_rule_for_room(
        valid_rules,
        device_type=primary_type,
        room_type=room_type,
        room_height_m=height_m,
        value_kind="max_wall_distance_m",
    )
    if wall_rule is not None:
        findings.extend(
            _detect_rule_conflicts(
                valid_rules,
                drawing_uuid=drawing_uuid,
                device_type=primary_type,
                room_type=room_type,
                room_height_m=height_m,
                value_kind="max_wall_distance_m",
                selected_rule=wall_rule,
                room_id=room_id,
                emitted_conflict_keys=emitted_conflict_keys,
            )
        )
        unverified_wall = _maybe_unverified_finding(
            drawing_uuid=drawing_uuid,
            rule=wall_rule,
            room_id=room_id,
            emitted_unverified=emitted_unverified,
        )
        if unverified_wall is not None:
            findings.append(unverified_wall)

    rule_id, doc, clause, rule_status = _rule_ref(grid_rule)

    if not checked_devs:
        findings.append(
            _make_finding(
                drawing_uuid=drawing_uuid,
                key_parts=("detector", "missing", primary_type, room_id, zone_id or ""),
                severity=FindingSeverity.critical,
                message=f"У приміщенні{suffix} відсутні пожежні сповіщувачі",
                room_id=room_id,
                rule_id=rule_id,
                document=doc,
                clause=clause,
                rule_status=rule_status,
            )
        )
        return findings

    pts = [(d.x_m, d.y_m) for d in checked_devs]
    max_area = grid_rule.max_protected_area_m2
    if max_area is not None and max_area > 0:
        area_per_dev = target_area_m2 / len(pts)
        if area_per_dev > max_area + 1e-6:
            findings.append(
                _make_finding(
                    drawing_uuid=drawing_uuid,
                    key_parts=(
                        "detector",
                        "area",
                        primary_type,
                        room_id,
                        zone_id or "",
                    ),
                    severity=FindingSeverity.critical,
                    message=(
                        f"Площа на один сповіщувач у приміщенні{suffix} становить "
                        f"{area_per_dev:.1f} м², що перевищує норму {max_area:g} м²"
                    ),
                    room_id=room_id,
                    rule_id=rule_id,
                    document=doc,
                    clause=clause,
                    rule_status=rule_status,
                    details={
                        "areaPerDeviceM2": round(area_per_dev, 2),
                        "maxProtectedAreaM2": max_area,
                    },
                )
            )

    step_m = effective_grid_step_m(grid_rule)
    r_cov = step_m * math.sqrt(2.0) / 2.0
    covered_union = unary_union([ShapelyPoint(p).buffer(r_cov) for p in pts])
    uncovered = target_poly_m.difference(covered_union)
    coverage_complete = uncovered.is_empty or uncovered.area <= max(
        COVERAGE_TOLERANCE_MIN_M2, target_area_m2 * COVERAGE_TOLERANCE_RATIO
    )

    if not coverage_complete:
        max_uncov_dist = _max_distance_to_points(target_poly_m, pts)
        findings.append(
            _make_finding(
                drawing_uuid=drawing_uuid,
                key_parts=(
                    "detector",
                    "coverage",
                    primary_type,
                    room_id,
                    zone_id or "",
                ),
                severity=FindingSeverity.critical,
                message=(
                    f"Неповне покриття приміщення{suffix} сповіщувачами: максимальна "
                    f"відстань до сповіщувача {max_uncov_dist:.2f} м перевищує "
                    f"допустимий радіус {r_cov:.2f} м (непокрита площа "
                    f"{uncovered.area:.1f} м²)"
                ),
                room_id=room_id,
                rule_id=rule_id,
                document=doc,
                clause=clause,
                rule_status=rule_status,
                details={
                    "maxUncoveredDistanceM": round(max_uncov_dist, 3),
                    "effectiveCoverageRadiusM": round(r_cov, 3),
                    "uncoveredAreaM2": round(float(uncovered.area), 3),
                },
            )
        )

    if len(pts) >= 2:
        max_edge = _max_mst_edge(pts, target_poly_m)
        if max_edge > grid_rule.threshold + 1e-4:
            findings.append(
                _make_finding(
                    drawing_uuid=drawing_uuid,
                    key_parts=(
                        "detector",
                        "spacing",
                        primary_type,
                        room_id,
                        zone_id or "",
                    ),
                    severity=FindingSeverity.critical,
                    message=(
                        f"Крок між сусідніми сповіщувачами у приміщенні{suffix} "
                        f"становить {max_edge:.2f} м, що перевищує норму "
                        f"{grid_rule.threshold:g} м"
                    ),
                    room_id=room_id,
                    rule_id=rule_id,
                    document=doc,
                    clause=clause,
                    rule_status=rule_status,
                    details={
                        "measuredSpacingM": round(max_edge, 3),
                        "maxGridSpacingM": grid_rule.threshold,
                    },
                )
            )

    max_wall_threshold: float | None = None
    wall_ref_rule = wall_rule or grid_rule
    if wall_rule is not None:
        max_wall_threshold = wall_rule.threshold
    elif not coverage_complete:
        max_wall_threshold = 0.5 * grid_rule.threshold

    if max_wall_threshold is not None:
        max_wall_dist = _max_wall_segment_distance(target_poly_m, pts)
        if max_wall_dist > max_wall_threshold + 1e-4:
            w_id, w_doc, w_clause, w_status = _rule_ref(wall_ref_rule)
            findings.append(
                _make_finding(
                    drawing_uuid=drawing_uuid,
                    key_parts=(
                        "detector",
                        "wall_dist",
                        primary_type,
                        room_id,
                        zone_id or "",
                    ),
                    severity=FindingSeverity.critical,
                    message=(
                        f"Відстань від стіни до найближчого сповіщувача у "
                        f"приміщенні{suffix} становить {max_wall_dist:.2f} м, що "
                        f"перевищує норму {max_wall_threshold:g} м"
                    ),
                    room_id=room_id,
                    rule_id=w_id,
                    document=w_doc,
                    clause=w_clause,
                    rule_status=w_status,
                    details={
                        "maxWallDistanceM": round(max_wall_dist, 3),
                        "limitM": max_wall_threshold,
                    },
                )
            )

    min_clearance, clearance_ref_rule = _resolve_min_wall_clearance(
        valid_rules,
        device_type=primary_type,
        room_type=room_type,
        height_m=height_m,
        wall_rule=wall_rule,
        grid_rule=grid_rule,
    )
    if _max_inscribed_clearance(target_poly_m) >= min_clearance:
        c_id, c_doc, c_clause, c_status = _rule_ref(clearance_ref_rule)
        for dev in checked_devs:
            wall_dist = _distance_to_boundary(target_poly_m, (dev.x_m, dev.y_m))
            if wall_dist < min_clearance - 1e-4:
                findings.append(
                    _make_finding(
                        drawing_uuid=drawing_uuid,
                        key_parts=("detector", "min_clearance", dev.id, room_id),
                        severity=FindingSeverity.warning,
                        message=(
                            f"Порушено мінімальний відступ сповіщувача від стіни у "
                            f"приміщенні{suffix}: "
                            f"{wall_dist:.2f} м < {min_clearance:g} м"
                        ),
                        room_id=room_id,
                        device_id=dev.id,
                        rule_id=c_id,
                        document=c_doc,
                        clause=c_clause,
                        rule_status=c_status,
                        details={
                            "wallClearanceM": round(wall_dist, 3),
                            "minWallClearanceM": min_clearance,
                        },
                    )
                )

    if coverage_complete and len(pts) >= 2:
        min_area_per_det = (
            max_area if (max_area is not None and max_area > 0) else (step_m * step_m)
        )
        expected_max_count = math.ceil(target_area_m2 / min_area_per_det) + 1
        min_pair_dist = _min_pairwise_distance(pts)
        if len(pts) > expected_max_count or min_pair_dist < 0.5 * step_m - 1e-4:
            findings.append(
                _make_finding(
                    drawing_uuid=drawing_uuid,
                    key_parts=(
                        "detector",
                        "redundant",
                        primary_type,
                        room_id,
                        zone_id or "",
                    ),
                    severity=FindingSeverity.warning,
                    message=(
                        f"Надлишок приладів у приміщенні{suffix}: розміщено "
                        f"{len(pts)} сповіщувачів для площі {target_area_m2:.1f} м² "
                        f"(мінімальна відстань між приладами {min_pair_dist:.2f} м)"
                    ),
                    room_id=room_id,
                    rule_id=rule_id,
                    document=doc,
                    clause=clause,
                    rule_status=rule_status,
                    details={
                        "deviceCount": len(pts),
                        "expectedMaxCount": expected_max_count,
                        "minPairwiseDistanceM": round(min_pair_dist, 3),
                    },
                )
            )

    return findings


def evaluate_drawing_findings(
    *,
    drawing_id: str,
    drawing_row: Mapping[str, Any] | None = None,
    room_rows: Sequence[Mapping[str, Any]],
    device_rows: Sequence[Mapping[str, Any]],
    rule_rows: Sequence[Mapping[str, Any]],
    zone_rows: Sequence[Mapping[str, Any]] = (),
    exit_rows: Sequence[Mapping[str, Any]] = (),
    passage_rows: Sequence[Mapping[str, Any]] = (),
    unit_scale_m: float | None = None,
) -> list[Finding]:
    """Evaluate all fire-safety compliance checks for a drawing layout."""
    drawing_uuid = UUID(str(drawing_id))
    scale = _resolve_unit_scale_m(drawing_row, room_rows, unit_scale_m)
    valid_rules = _filter_allowed_rules(rule_rows)
    devices = _parse_devices(device_rows, scale)

    findings: list[Finding] = []
    emitted_conflict_keys: set[tuple[str, str, tuple[str, ...]]] = set()
    emitted_unverified: set[tuple[str, str | None]] = set()

    room_polys_m: dict[str, Polygon] = {}
    for room in room_rows:
        room_id = str(room.get("id") or "")
        if not room_id:
            continue
        poly = _valid_shape(_scale_coords(row_coords(room), scale))
        if poly is not None:
            room_polys_m[room_id] = poly

    # Прив'язуємо точкові прилади до приміщень (за room_id або за геометрією).
    room_devices: dict[str, list[_DevicePoint]] = {
        str(room["id"]): [] for room in room_rows if room.get("id")
    }
    for dev in devices:
        if dev.type == "manual_call_point":
            continue
        if dev.room_id and dev.room_id in room_devices:
            room_poly = room_polys_m.get(dev.room_id)
            if room_poly is not None and not room_poly.buffer(0.05).covers(
                ShapelyPoint(dev.x_m, dev.y_m)
            ):
                findings.append(
                    _make_finding(
                        drawing_uuid=drawing_uuid,
                        key_parts=("device_outside_room", dev.id, dev.room_id),
                        severity=FindingSeverity.warning,
                        message=(
                            "Прилад розташовано поза межами контуру "
                            "призначеного приміщення"
                        ),
                        room_id=dev.room_id,
                        device_id=dev.id,
                    )
                )
            else:
                room_devices[dev.room_id].append(dev)
            continue

        pt = ShapelyPoint(dev.x_m, dev.y_m)
        for rid, rpoly in room_polys_m.items():
            if rpoly.buffer(0.05).covers(pt):
                room_devices[rid].append(dev)
                break

    zones_by_room: dict[str, list[Mapping[str, Any]]] = {}
    for zone in zone_rows:
        zones_by_room.setdefault(str(zone.get("room_id") or ""), []).append(zone)

    for room in room_rows:
        room_id = str(room.get("id") or "")
        if not room_id:
            continue
        room_type_raw = room.get("type")
        room_type = (
            str(room_type_raw).strip() if isinstance(room_type_raw, str) else None
        )
        if not room_type or room_type.casefold() == "unknown":
            findings.append(
                _make_finding(
                    drawing_uuid=drawing_uuid,
                    key_parts=("missing_type", room_id),
                    severity=FindingSeverity.insufficient_data,
                    message="Не визначено тип приміщення",
                    room_id=room_id,
                )
            )
            effective_room_type: str | None = None
        else:
            effective_room_type = room_type

        if "confirmed" in room and room["confirmed"] is False:
            findings.append(
                _make_finding(
                    drawing_uuid=drawing_uuid,
                    key_parts=("unconfirmed_room", room_id),
                    severity=FindingSeverity.warning,
                    message="Контур приміщення не підтверджено інженером",
                    room_id=room_id,
                )
            )

        room_poly_m = room_polys_m.get(room_id)
        if room_poly_m is None:
            findings.append(
                _make_finding(
                    drawing_uuid=drawing_uuid,
                    key_parts=("invalid_polygon", room_id),
                    severity=FindingSeverity.insufficient_data,
                    message="Некоректний або порожній контур приміщення",
                    room_id=room_id,
                )
            )
            continue

        devs_in_room = room_devices.get(room_id, [])
        point_detectors = [
            d for d in devs_in_room if d.type in ("smoke_detector", "heat_detector")
        ]
        sounders = [d for d in devs_in_room if d.type == "sounder"]

        room_zones = zones_by_room.get(room_id, [])
        if room_zones:
            targets = build_placement_targets([room], room_zones)
            for target in targets:
                if target.scope == SCOPE_REMAINDER:
                    findings.append(
                        _make_finding(
                            drawing_uuid=drawing_uuid,
                            key_parts=("remainder_no_height", room_id),
                            severity=FindingSeverity.insufficient_data,
                            message=(
                                "Не введено висоту приміщення для непокритої "
                                f"зонами частини: {target.skip_reason}"
                            ),
                            room_id=room_id,
                        )
                    )
                    continue
                if target.skip_reason is not None:
                    findings.append(
                        _make_finding(
                            drawing_uuid=drawing_uuid,
                            key_parts=("zone_skip", room_id, target.zone_id or ""),
                            severity=FindingSeverity.insufficient_data,
                            message=target.skip_reason,
                            room_id=room_id,
                        )
                    )
                    continue
                zone_poly_m = _valid_shape(_scale_coords(target.coords, scale))
                if zone_poly_m is None:
                    findings.append(
                        _make_finding(
                            drawing_uuid=drawing_uuid,
                            key_parts=(
                                "zone_invalid_poly",
                                room_id,
                                target.zone_id or "",
                            ),
                            severity=FindingSeverity.insufficient_data,
                            message=(
                                "Некоректний контур зони "
                                f"({target.zone_name or 'зона'})"
                            ),
                            room_id=room_id,
                        )
                    )
                    continue
                zone_buf = zone_poly_m.buffer(0.05)
                zone_detectors = [
                    d
                    for d in point_detectors
                    if zone_buf.covers(ShapelyPoint(d.x_m, d.y_m))
                ]
                zone_sounders = [
                    d for d in sounders if zone_buf.covers(ShapelyPoint(d.x_m, d.y_m))
                ]
                findings.extend(
                    _evaluate_detector_target(
                        drawing_uuid=drawing_uuid,
                        room_id=room_id,
                        zone_id=target.zone_id,
                        zone_label=target.zone_name,
                        room_type=effective_room_type,
                        height_m=target.height_m,
                        target_poly_m=zone_poly_m,
                        target_area_m2=float(zone_poly_m.area),
                        target_detectors=zone_detectors,
                        valid_rules=valid_rules,
                        emitted_conflict_keys=emitted_conflict_keys,
                        emitted_unverified=emitted_unverified,
                    )
                )
                findings.extend(
                    _evaluate_sounder_for_target(
                        drawing_uuid=drawing_uuid,
                        room_id=room_id,
                        zone_id=target.zone_id,
                        zone_label=target.zone_name,
                        room_type=effective_room_type,
                        height_m=target.height_m,
                        target_poly_m=zone_poly_m,
                        target_area_m2=float(zone_poly_m.area),
                        target_sounders=zone_sounders,
                        valid_rules=valid_rules,
                        emitted_conflict_keys=emitted_conflict_keys,
                        emitted_unverified=emitted_unverified,
                    )
                )
        else:
            room_height = row_height_m(room)
            room_area_m2 = float(room_poly_m.area)
            findings.extend(
                _evaluate_detector_target(
                    drawing_uuid=drawing_uuid,
                    room_id=room_id,
                    zone_id=None,
                    zone_label=None,
                    room_type=effective_room_type,
                    height_m=room_height,
                    target_poly_m=room_poly_m,
                    target_area_m2=room_area_m2,
                    target_detectors=point_detectors,
                    valid_rules=valid_rules,
                    emitted_conflict_keys=emitted_conflict_keys,
                    emitted_unverified=emitted_unverified,
                )
            )
            findings.extend(
                _evaluate_sounder_for_target(
                    drawing_uuid=drawing_uuid,
                    room_id=room_id,
                    zone_id=None,
                    zone_label=None,
                    room_type=effective_room_type,
                    height_m=room_height,
                    target_poly_m=room_poly_m,
                    target_area_m2=room_area_m2,
                    target_sounders=sounders,
                    valid_rules=valid_rules,
                    emitted_conflict_keys=emitted_conflict_keys,
                    emitted_unverified=emitted_unverified,
                )
            )

    mcp_devices = [d for d in devices if d.type == "manual_call_point"]
    findings.extend(
        _evaluate_mcp_findings(
            drawing_uuid=drawing_uuid,
            room_rows=room_rows,
            exit_rows=exit_rows,
            passage_rows=passage_rows,
            mcp_devices=mcp_devices,
            valid_rules=valid_rules,
            unit_scale_m=scale,
            emitted_conflict_keys=emitted_conflict_keys,
            emitted_unverified=emitted_unverified,
        )
    )

    return findings


def _finding_to_db_row(finding: Finding, *, include_details: bool) -> dict[str, Any]:
    row: dict[str, Any] = {
        "id": finding.id,
        "drawing_id": str(finding.drawingId),
        "room_id": finding.roomId,
        "device_id": finding.deviceId,
        "rule_id": finding.ruleId,
        "severity": finding.severity.value,
        "message": finding.message,
        "document": finding.document,
        "clause": finding.clause,
        "rule_status": finding.ruleStatus.value if finding.ruleStatus else None,
    }
    if include_details:
        row["conflict_details"] = finding.conflictDetails
        row["details"] = finding.details
    return row


def _persist_findings(
    supabase: Client, drawing_id: str, findings: Sequence[Finding]
) -> None:
    """Persist findings to ``public.findings`` when the table is migrated."""
    try:
        supabase.table("findings").delete().eq("drawing_id", drawing_id).execute()
    except Exception as exc:
        if _is_unavailable_schema_or_fake(exc):
            logger.debug("Skipping findings delete for %s: %s", drawing_id, exc)
            return
        raise

    if not findings:
        return

    full_rows = [_finding_to_db_row(item, include_details=True) for item in findings]
    try:
        supabase.table("findings").insert(full_rows).execute()
        return
    except Exception as exc:
        if not _is_unavailable_schema_or_fake(exc):
            raise
        logger.debug(
            "Retrying findings insert without details columns for %s: %s",
            drawing_id,
            exc,
        )

    core_rows = [_finding_to_db_row(item, include_details=False) for item in findings]
    try:
        supabase.table("findings").insert(core_rows).execute()
    except Exception as exc:
        if _is_unavailable_schema_or_fake(exc):
            logger.debug("Skipping findings insert for %s: %s", drawing_id, exc)
            return
        raise


def evaluate_and_persist_findings(
    supabase: Client,
    drawing_id: str,
    *,
    drawing_row: Mapping[str, Any] | None = None,
    persist: bool = True,
) -> list[Finding]:
    """Load drawing state from Supabase, compute findings, and persist safely."""
    resolved_drawing = drawing_row
    if resolved_drawing is None:
        rows = _safe_select_rows(supabase, "drawings")
        resolved_drawing = next(
            (r for r in rows if str(r.get("id")) == str(drawing_id)), None
        )

    room_rows = _safe_select_rows(supabase, "rooms", drawing_id=drawing_id)
    device_rows = _safe_select_rows(supabase, "devices", drawing_id=drawing_id)
    zone_rows = _safe_select_rows(supabase, "room_zones", drawing_id=drawing_id)
    exit_rows = _safe_select_rows(supabase, "exits", drawing_id=drawing_id)
    passage_rows = _safe_select_rows(supabase, "passages", drawing_id=drawing_id)
    rule_rows = _safe_select_rows(supabase, "rules")

    findings = evaluate_drawing_findings(
        drawing_id=drawing_id,
        drawing_row=resolved_drawing,
        room_rows=room_rows,
        device_rows=device_rows,
        rule_rows=rule_rows,
        zone_rows=zone_rows,
        exit_rows=exit_rows,
        passage_rows=passage_rows,
    )
    if persist:
        _persist_findings(supabase, drawing_id, findings)
    return findings
