from shapely.geometry import Point

from src.modules.placement.service import RuleRecord, place_devices_from_rule


def test_rectangle_room():
    room = [(0, 0), (10, 0), (10, 8), (0, 8)]
    rule = RuleRecord(id="rule-1", threshold=2.0)

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
    rule = RuleRecord(id="rule-2", threshold=2.0)

    devices = place_devices_from_rule(room, rule)

    assert len(devices) > 0
    for device in devices:
        point = Point(device.x, device.y)
        polygon = __import__("shapely.geometry").geometry.Polygon(room)
        assert (
            polygon.contains(point) or polygon.touches(point) or polygon.covers(point)
        )


def test_small_room_has_at_least_one_device():
    room = [(0, 0), (1.5, 0), (1.5, 1.5), (0, 1.5)]
    rule = RuleRecord(id="rule-3", threshold=4.0)

    devices = place_devices_from_rule(room, rule)

    assert len(devices) >= 1
    assert all(device.rule_id == "rule-3" for device in devices)


def test_unit_mismatch_auto_scaling():
    # 10m x 8m room represented in millimeters (10000 x 8000), threshold in meters (2.0)
    room = [(0, 0), (10000, 0), (10000, 8000), (0, 8000)]
    rule = RuleRecord(id="rule-mm", threshold=2.0)

    devices = place_devices_from_rule(room, rule)

    assert 0 < len(devices) <= 50
    assert all(device.x >= 1000.0 for device in devices)
    assert all(device.y >= 1000.0 for device in devices)


def test_extreme_density_circuit_breaker():
    # Enormous dimensions that exceed 5000 points even after scaling by 1000
    room = [(0, 0), (1_000_000, 0), (1_000_000, 1_000_000), (0, 1_000_000)]
    rule = RuleRecord(id="rule-extreme", threshold=1.0)

    import pytest

    with pytest.raises(ValueError, match="Grid too dense"):
        place_devices_from_rule(room, rule)
