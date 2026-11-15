from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from shapely.geometry import Point, Polygon


def _parse_float(value: object) -> float:
    if isinstance(value, (int, float, str)):
        return float(value)
    raise ValueError("Expected a numeric value")


def _parse_optional_float(value: object) -> float | None:
    if value is None:
        return None
    return _parse_float(value)


@dataclass
class RuleRecord:
    # UUID public.rules.id; також використовується як devices.rule_id.
    id: str
    threshold: float
    status: str = "needs_review"
    rule_id: str = ""
    name: str = ""
    device_type: str = ""
    value_kind: str = "max_grid_spacing_m"
    document: str | None = None
    clause: str | None = None
    source_url: str | None = None


@dataclass
class DevicePlacement:
    x: float
    y: float
    rule_id: str


def select_rule_for_room(
    rules: Sequence[Mapping[str, object]],
    *,
    device_type: str,
    room_type: str | None,
    room_height_m: float | None,
    value_kind: str = "max_grid_spacing_m",
) -> RuleRecord | None:
    """Select the most specific applicable rule from Supabase rows."""
    normalized_room_type = (room_type or "").strip().casefold()
    candidates: list[tuple[tuple[int, float], RuleRecord]] = []

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
            min_height = _parse_optional_float(row.get("min_height_m"))
            max_height = _parse_optional_float(row.get("max_height_m"))
        except (TypeError, ValueError):
            continue

        if value <= 0:
            continue

        # Якщо правило має обмеження висоти, але висота невідома,
        # це правило не вважається відповідним.
        if min_height is not None or max_height is not None:
            if room_height_m is None:
                continue
            if min_height is not None and room_height_m < min_height:
                continue
            if max_height is not None and room_height_m > max_height:
                continue

        database_id = str(row.get("id") or "")
        if not database_id:
            continue

        rule = RuleRecord(
            id=database_id,
            threshold=value,
            status=str(row.get("verification_status") or "needs_review"),
            rule_id=str(row.get("rule_id") or database_id),
            name=str(row.get("name") or ""),
            device_type=device_type,
            value_kind=value_kind,
            document=(
                str(row["document"]) if row.get("document") is not None else None
            ),
            clause=(str(row["clause"]) if row.get("clause") is not None else None),
            source_url=(
                str(row["source_url"]) if row.get("source_url") is not None else None
            ),
        )

        if min_height is not None and max_height is not None:
            height_range = max_height - min_height
        else:
            height_range = float("inf")

        specificity = (int(bool(room_types)), -height_range)
        candidates.append((specificity, rule))

    if not candidates:
        return None

    candidates.sort(key=lambda candidate: candidate[0], reverse=True)
    return candidates[0][1]


def place_devices_from_rule(
    room_coords: list[tuple[float, float]],
    rule: RuleRecord,
) -> list[DevicePlacement]:
    if rule.value_kind != "max_grid_spacing_m":
        raise ValueError(
            "This placement algorithm accepts only max_grid_spacing_m rules"
        )

    polygon = Polygon(room_coords)
    if polygon.is_empty or not polygon.is_valid:
        raise ValueError("Invalid or empty room polygon")

    step = float(rule.threshold)
    if step <= 0:
        raise ValueError("Rule value must be > 0")

    min_x, min_y, max_x, max_y = polygon.bounds
    width = max_x - min_x
    height = max_y - min_y
    estimated_points = (width / step) * (height / step)

    if estimated_points > 5000:
        # Legacy DXF support: coordinates may be in millimeters.
        step *= 1000.0
        estimated_points = (width / step) * (height / step)
        if estimated_points > 5000:
            raise ValueError(
                f"Grid too dense. Rule value {step} is too small for room dimensions."
            )

    offset = step / 2.0
    xs: list[float] = []
    x = min_x + offset
    while x + offset <= max_x:
        xs.append(x)
        x += step

    ys: list[float] = []
    y = min_y + offset
    while y + offset <= max_y:
        ys.append(y)
        y += step

    devices: list[DevicePlacement] = []
    for x in xs:
        for y in ys:
            if polygon.covers(Point(x, y)):
                devices.append(
                    DevicePlacement(
                        x=float(x),
                        y=float(y),
                        rule_id=rule.id,
                    )
                )

    if not devices:
        fallback_point = polygon.representative_point()
        if not (polygon.contains(fallback_point) or polygon.covers(fallback_point)):
            raise ValueError("Unable to place fallback device inside room polygon")
        devices.append(
            DevicePlacement(
                x=float(fallback_point.x),
                y=float(fallback_point.y),
                rule_id=rule.id,
            )
        )

    return [device for device in devices if polygon.covers(Point(device.x, device.y))]


generate_devices_for_polygon = place_devices_from_rule
