from __future__ import annotations

from dataclasses import dataclass

from shapely.geometry import Point, Polygon


@dataclass
class RuleRecord:
    id: str
    threshold: float
    status: str = "needs_review"


@dataclass
class DevicePlacement:
    x: float
    y: float
    rule_id: str


def place_devices_from_rule(
    room_coords: list[tuple[float, float]],
    rule: RuleRecord,
) -> list[DevicePlacement]:
    polygon = Polygon(room_coords)

    if polygon.is_empty:
        raise ValueError("Empty polygon")

    step = float(rule.threshold)
    if step <= 0:
        raise ValueError("Rule threshold must be > 0")

    min_x, min_y, max_x, max_y = polygon.bounds
    width = max_x - min_x
    height = max_y - min_y

    estimated_points = (width / step) * (height / step)

    if estimated_points > 5000:
        # Obvious unit mismatch (e.g. m vs mm). Auto-correct by scaling step by 1000.
        step *= 1000.0
        estimated_points = (width / step) * (height / step)

        # If it's STILL too dense, fail fast instead of hanging the server.
        if estimated_points > 5000:
            raise ValueError(
                f"Grid too dense. Threshold {step} is too small for room dimensions."
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
            candidate = Point(x, y)
            if (
                polygon.contains(candidate)
                or polygon.covers(candidate)
                or polygon.touches(candidate)
            ):
                devices.append(
                    DevicePlacement(
                        x=float(x),
                        y=float(y),
                        rule_id=str(rule.id),
                    )
                )

    if not devices:
        centroid = polygon.centroid
        devices.append(
            DevicePlacement(
                x=float(centroid.x),
                y=float(centroid.y),
                rule_id=str(rule.id),
            )
        )

    return devices


generate_devices_for_polygon = place_devices_from_rule
