import pytest
from shapely.geometry import Point, Polygon

from src.modules.placement.service import (
    RuleRecord,
    place_devices_from_rule,
    select_rule_for_room,
)


def test_rectangle_room():
    room = [(0, 0), (10, 0), (10, 8), (0, 8)]
    rule = RuleRecord(
        id="rule-1",
        threshold=2.0,
        value_kind="max_grid_spacing_m",
    )

    devices = place_devices_from_rule(room, rule)

    assert len(devices) > 0
    assert all(device.x >= 1.0 for device in devices)
    assert all(device.x <= 9.0 for device in devices)
    assert all(device.y >= 1.0 for device in devices)
    assert all(device.y <= 7.0 for device in devices)

    xs = sorted(device.x for device in devices)
    ys = sorted(device.y for device in devices)

    assert max(xs) - min(xs) <= 8.0
    assert max(ys) - min(ys) <= 6.0


def test_l_shape_room():
    room = [(0, 0), (6, 0), (6, 2), (4, 2), (4, 6), (0, 6)]
    rule = RuleRecord(
        id="rule-2",
        threshold=2.0,
        value_kind="max_grid_spacing_m",
    )

    devices = place_devices_from_rule(room, rule)
    polygon = Polygon(room)

    assert len(devices) > 0
    assert all(polygon.covers(Point(device.x, device.y)) for device in devices)


def test_small_room_has_at_least_one_device():
    room = [(0, 0), (1.5, 0), (1.5, 1.5), (0, 1.5)]
    rule = RuleRecord(
        id="rule-3",
        threshold=4.0,
        value_kind="max_grid_spacing_m",
    )

    devices = place_devices_from_rule(room, rule)

    assert len(devices) >= 1
    assert all(device.rule_id == "rule-3" for device in devices)


def test_unit_mismatch_auto_scaling():
    # Coordinates are millimeters; the rule value is in meters.
    room = [(0, 0), (10000, 0), (10000, 8000), (0, 8000)]
    rule = RuleRecord(
        id="rule-mm",
        threshold=2.0,
        value_kind="max_grid_spacing_m",
    )

    devices = place_devices_from_rule(room, rule)

    assert 0 < len(devices) <= 50
    assert all(device.x >= 1000.0 for device in devices)
    assert all(device.y >= 1000.0 for device in devices)


def test_extreme_density_circuit_breaker():
    room = [(0, 0), (1_000_000, 0), (1_000_000, 1_000_000), (0, 1_000_000)]
    rule = RuleRecord(
        id="rule-extreme",
        threshold=1.0,
        value_kind="max_grid_spacing_m",
    )

    with pytest.raises(ValueError, match="Grid too dense"):
        place_devices_from_rule(room, rule)


def test_selects_spacing_rule_by_type_and_height():
    rules = [
        {
            "id": "test-rule-uuid",
            "rule_id": "SMOKE_GRID_TEST",
            "name": "Test smoke spacing rule",
            "device_type": "smoke_detector",
            "value_kind": "max_grid_spacing_m",
            "room_types": [],
            "min_height_m": None,
            "max_height_m": 3.5,
            "value": 9,
            "document": "Test standard",
            "clause": "Test clause",
            "source_url": "https://example.com/source",
            "verification_status": "verified",
        }
    ]

    rule = select_rule_for_room(
        rules,
        device_type="smoke_detector",
        room_type="office",
        room_height_m=3.0,
        value_kind="max_grid_spacing_m",
    )

    assert rule is not None
    assert rule.id == "test-rule-uuid"
    assert rule.threshold == 9
    assert rule.status == "verified"


def test_empty_grid_fallback_on_donut_polygon_avoids_hole():
    eps = 1e-6
    # 20x10 Hall with an 8x4 inner Office at (6, 3)-(14, 7)
    hall_coords = [
        (0.0, 0.0),
        (20.0, 0.0),
        (20.0, 10.0),
        (0.0, 10.0),
        (0.0, 5.0 + eps),
        (6.0, 5.0 + eps),
        (6.0, 7.0),
        (14.0, 7.0),
        (14.0, 3.0),
        (6.0, 3.0),
        (6.0, 5.0 - eps),
        (0.0, 5.0 - eps),
    ]
    hall_polygon = Polygon(hall_coords)
    office_polygon = Polygon([(6.0, 3.0), (14.0, 3.0), (14.0, 7.0), (6.0, 7.0)])
    rule = RuleRecord(
        id="rule-donut-fallback",
        threshold=12.0,
        value_kind="max_grid_spacing_m",
    )

    devices = place_devices_from_rule(hall_coords, rule)

    assert len(devices) >= 1
    for device in devices:
        device_point = Point(device.x, device.y)
        assert hall_polygon.covers(device_point)
        assert not office_polygon.contains(device_point)
        assert not office_polygon.covers(device_point)


def test_empty_grid_fallback_on_compact_donut_10x5_avoids_office():
    eps = 1e-6
    # 10x5 Hall with a 2x1 inner Office at (4, 2)-(6, 3)
    hall_coords = [
        (0.0, 0.0),
        (10.0, 0.0),
        (10.0, 5.0),
        (0.0, 5.0),
        (0.0, 2.5 + eps),
        (4.0, 2.5 + eps),
        (4.0, 3.0),
        (6.0, 3.0),
        (6.0, 2.0),
        (4.0, 2.0),
        (4.0, 2.5 - eps),
        (0.0, 2.5 - eps),
    ]
    hall_polygon = Polygon(hall_coords)
    office_polygon = Polygon([(4.0, 2.0), (6.0, 2.0), (6.0, 3.0), (4.0, 3.0)])
    rule = RuleRecord(
        id="rule-donut-10x5",
        threshold=6.0,
        value_kind="max_grid_spacing_m",
    )

    devices = place_devices_from_rule(hall_coords, rule)

    assert len(devices) >= 1
    for device in devices:
        device_point = Point(device.x, device.y)
        assert hall_polygon.covers(device_point)
        assert not office_polygon.covers(device_point)


def test_empty_grid_fallback_on_concave_l_shape_stays_inside():
    room = [(0.0, 0.0), (10.0, 0.0), (10.0, 2.0), (2.0, 2.0), (2.0, 10.0), (0.0, 10.0)]
    polygon = Polygon(room)
    rule = RuleRecord(
        id="rule-l-fallback",
        threshold=12.0,
        value_kind="max_grid_spacing_m",
    )

    devices = place_devices_from_rule(room, rule)

    assert len(devices) >= 1
    for device in devices:
        assert polygon.covers(Point(device.x, device.y))
