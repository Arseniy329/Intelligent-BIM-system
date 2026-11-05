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
