from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from shapely.geometry import Point, Polygon

# Статуси результату розміщення для приміщення або зони (BIM-73).
PLACED = "placed"
INSUFFICIENT_DATA = "insufficient_data"

REASON_NO_HEIGHT = "Не введено висоту"
REASON_BAD_OUTLINE = "Некоректний контур"

# Для цих видів значень «суворіше» означає «більше» (мінімальні вимоги).
# Для решти (максимальні крок/площа/відстань) суворіше — менше значення.
_STRICTER_IS_LARGER = frozenset({"min_sound_level_dba", "min_wall_clearance_m"})


def _parse_float(value: object) -> float:
    if isinstance(value, (int, float, str)):
        return float(value)
    raise ValueError("Expected a numeric value")


def _parse_optional_float(value: object) -> float | None:
    if value is None:
        return None
    return _parse_float(value)


def _protected_area_m2(row: Mapping[str, object]) -> float | None:
    """Максимальна площа захисту одним сповіщувачем з ``rules.conditions``."""
    conditions = row.get("conditions")
    if not isinstance(conditions, Mapping):
        return None
    try:
        area = _parse_optional_float(conditions.get("max_protected_area_m2"))
    except (TypeError, ValueError):
        return None
    return area if area is not None and area > 0 else None


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
    # Площа захисту одним сповіщувачем, м² (rules.conditions.max_protected_area_m2).
    max_protected_area_m2: float | None = None


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
    candidates: list[tuple[tuple[int, int, float], RuleRecord]] = []

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
            max_protected_area_m2=_protected_area_m2(row),
        )

        has_height_bounds = min_height is not None or max_height is not None
        strictness = value if value_kind in _STRICTER_IS_LARGER else -value

        # Порядок вибору:
        # 1) правила для конкретних типів приміщень;
        # 2) правила з обмеженням за висотою (конкретніші за загальні);
        # 3) суворіше значення. Межі діапазонів включно, тому на стику (напр.
        #    рівно 3,5 або 6,0 м) підходять два правила одразу — беремо суворіше,
        #    щоб не завищити крок сітки.
        specificity = (int(bool(room_types)), int(has_height_bounds), strictness)
        candidates.append((specificity, rule))

    if not candidates:
        return None

    candidates.sort(key=lambda candidate: candidate[0], reverse=True)
    return candidates[0][1]


def effective_grid_step_m(rule: RuleRecord) -> float:
    """Крок сітки, при якому виконуються і крок, і площа захисту з правила.

    У квадратній сітці один сповіщувач охоплює крок² м², тому крок не може
    перевищувати sqrt(площа захисту). Напр. 9,0 м і 80 м² → 8,94 м.
    """
    step = float(rule.threshold)
    area = rule.max_protected_area_m2
    if area is not None and area > 0:
        step = min(step, math.sqrt(area))
    return step


def place_devices_from_rule(
    room_coords: list[tuple[float, float]],
    rule: RuleRecord,
    unit_scale_m: float | None = None,
) -> list[DevicePlacement]:
    """Розставити сповіщувачі квадратною сіткою всередині контуру.

    ``unit_scale_m`` — метрів в одній одиниці креслення (``drawings.unit_scale_m``).
    Крок у правилі задано в метрах, тож за відомого масштабу він переводиться в
    одиниці креслення точно. Без масштабу лишається стара евристика для DXF у мм.
    """
    if rule.value_kind != "max_grid_spacing_m":
        raise ValueError(
            "This placement algorithm accepts only max_grid_spacing_m rules"
        )

    polygon = Polygon(room_coords)
    if polygon.is_empty or not polygon.is_valid:
        raise ValueError("Invalid or empty room polygon")

    step = effective_grid_step_m(rule)
    if step <= 0:
        raise ValueError("Rule value must be > 0")

    if unit_scale_m is not None:
        if unit_scale_m <= 0:
            raise ValueError("unit_scale_m must be > 0")
        step /= unit_scale_m

    min_x, min_y, max_x, max_y = polygon.bounds
    width = max_x - min_x
    height = max_y - min_y
    estimated_points = (width / step) * (height / step)

    if estimated_points > 5000:
        if unit_scale_m is not None:
            raise ValueError(
                f"Grid too dense. Rule value {step} is too small for room dimensions."
            )
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


# ── BIM-73: правило за висотою приміщення або зони ───────────────────────────


@dataclass
class RuleDecision:
    rule: RuleRecord | None
    reason: str | None = None


def resolve_rule_for_height(
    rules: Sequence[Mapping[str, object]],
    *,
    device_type: str,
    room_type: str | None,
    height_m: float | None,
    value_kind: str = "max_grid_spacing_m",
) -> RuleDecision:
    """Правило для висоти або причина, чому його не можна застосувати.

    Висоти немає — правила немає, причина «Не введено висоту». Висоти за
    замовчуванням не існує: невідома висота не підміняється числом.
    """
    if height_m is None or height_m <= 0:
        return RuleDecision(None, REASON_NO_HEIGHT)

    rule = select_rule_for_room(
        rules,
        device_type=device_type,
        room_type=room_type,
        room_height_m=height_m,
        value_kind=value_kind,
    )
    if rule is None:
        return RuleDecision(None, f"Немає правила для висоти {height_m:g} м")
    return RuleDecision(rule)


@dataclass
class PlacementTarget:
    """Те, для чого розміщуємо: приміщення без зон або одна зона приміщення."""

    room_id: str | None
    zone_id: str | None
    room_name: str
    zone_name: str | None
    room_type: str | None
    height_m: float | None
    coords: list[tuple[float, float]]


@dataclass
class PlacementOutcome:
    target: PlacementTarget
    status: str
    reason: str | None = None
    rule: RuleRecord | None = None
    devices: list[DevicePlacement] = field(default_factory=list)


def row_coords(row: Mapping[str, Any]) -> list[tuple[float, float]]:
    """Контур ``polygon`` рядка rooms / room_zones як список (x, y)."""
    coords: list[tuple[float, float]] = []
    raw_polygon = row.get("polygon")
    if isinstance(raw_polygon, list):
        for point in raw_polygon:
            if isinstance(point, dict) and "x" in point and "y" in point:
                coords.append((float(point["x"]), float(point["y"])))
            elif isinstance(point, (list, tuple)) and len(point) >= 2:
                coords.append((float(point[0]), float(point[1])))
    return coords


def row_height_m(row: Mapping[str, Any]) -> float | None:
    """Висота з рядка rooms / room_zones; None, якщо не задана або некоректна."""
    raw = row.get("height")
    if raw is None:
        return None
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return None
    return value if value > 0 else None


def build_placement_targets(
    room_rows: Sequence[Mapping[str, Any]],
    zone_rows: Sequence[Mapping[str, Any]],
) -> list[PlacementTarget]:
    """Скласти перелік об'єктів розміщення.

    Приміщення з зонами розміщується окремо по кожній зоні за висотою зони
    (висота самого приміщення тоді не використовується). Приміщення без зон —
    за своєю висотою.
    """
    zones_by_room: dict[str, list[Mapping[str, Any]]] = {}
    for zone in zone_rows:
        zones_by_room.setdefault(str(zone.get("room_id")), []).append(zone)

    targets: list[PlacementTarget] = []
    for room in room_rows:
        room_id = str(room["id"]) if room.get("id") else None
        room_name = str(room.get("name") or "").strip() or (room_id or "")
        room_type = str(room["type"]) if room.get("type") else None

        zones = zones_by_room.get(room_id or "", [])
        if zones:
            for index, zone in enumerate(zones, start=1):
                targets.append(
                    PlacementTarget(
                        room_id=room_id,
                        zone_id=str(zone["id"]) if zone.get("id") else None,
                        room_name=room_name,
                        zone_name=str(zone.get("name") or "").strip()
                        or f"Зона {index}",
                        room_type=room_type,
                        height_m=row_height_m(zone),
                        coords=row_coords(zone),
                    )
                )
            continue

        coords = row_coords(room)
        if len(coords) < 3:
            continue
        targets.append(
            PlacementTarget(
                room_id=room_id,
                zone_id=None,
                room_name=room_name,
                zone_name=None,
                room_type=room_type,
                height_m=row_height_m(room),
                coords=coords,
            )
        )
    return targets


def place_targets(
    targets: Sequence[PlacementTarget],
    rules: Sequence[Mapping[str, object]],
    *,
    device_type: str = "smoke_detector",
    unit_scale_m: float | None = None,
) -> list[PlacementOutcome]:
    """Розмістити сповіщувачі для кожного об'єкта за правилом для його висоти.

    Об'єкт без висоти або без правила для висоти не отримує приладів і має
    статус «недостатньо даних» з причиною; на решту це не впливає.
    """
    outcomes: list[PlacementOutcome] = []
    for target in targets:
        if len(target.coords) < 3:
            outcomes.append(
                PlacementOutcome(target, INSUFFICIENT_DATA, REASON_BAD_OUTLINE)
            )
            continue

        decision = resolve_rule_for_height(
            rules,
            device_type=device_type,
            room_type=target.room_type,
            height_m=target.height_m,
        )
        if decision.rule is None:
            outcomes.append(
                PlacementOutcome(target, INSUFFICIENT_DATA, decision.reason)
            )
            continue

        devices = place_devices_from_rule(
            target.coords, decision.rule, unit_scale_m=unit_scale_m
        )
        outcomes.append(
            PlacementOutcome(target, PLACED, rule=decision.rule, devices=list(devices))
        )
    return outcomes


def describe_outcome(outcome: PlacementOutcome) -> dict[str, Any]:
    """Результат розміщення для відповіді API (POST /drawings/{id}/place)."""
    target = outcome.target
    rule = outcome.rule
    return {
        "room_id": target.room_id,
        "zone_id": target.zone_id,
        "name": target.room_name,
        "zone_name": target.zone_name,
        "height_m": target.height_m,
        "status": outcome.status,
        "reason": outcome.reason,
        "device_count": len(outcome.devices),
        "rule": None
        if rule is None
        else {
            "id": rule.id,
            "rule_id": rule.rule_id,
            "name": rule.name,
            "grid_step_m": rule.threshold,
            "protected_area_m2": rule.max_protected_area_m2,
            "applied_step_m": effective_grid_step_m(rule),
            "document": rule.document,
            "clause": rule.clause,
            "verification_status": rule.status,
        },
    }
