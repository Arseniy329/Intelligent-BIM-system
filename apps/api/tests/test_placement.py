import sys
import unittest
from pathlib import Path

from shapely.geometry import Point, Polygon

API_DIR = Path(__file__).resolve().parent.parent
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

from src.modules.placement.service import (
    RuleRecord,
    place_devices_from_rule,
    select_rule_for_room,
)


class TestPlacement(unittest.TestCase):
    def test_rectangle_room(self) -> None:
        room = [(0.0, 0.0), (10.0, 0.0), (10.0, 8.0), (0.0, 8.0)]
        rule = RuleRecord(
            id="rule-1",
            threshold=2.0,
            value_kind="max_grid_spacing_m",
        )

        devices = place_devices_from_rule(room, rule)

        self.assertGreater(len(devices), 0)
        self.assertTrue(all(device.x >= 1.0 for device in devices))
        self.assertTrue(all(device.x <= 9.0 for device in devices))
        self.assertTrue(all(device.y >= 1.0 for device in devices))
        self.assertTrue(all(device.y <= 7.0 for device in devices))

        xs = sorted(device.x for device in devices)
        ys = sorted(device.y for device in devices)

        self.assertLessEqual(max(xs) - min(xs), 8.0)
        self.assertLessEqual(max(ys) - min(ys), 6.0)

    def test_l_shape_room(self) -> None:
        room = [(0.0, 0.0), (6.0, 0.0), (6.0, 2.0), (4.0, 2.0), (4.0, 6.0), (0.0, 6.0)]
        rule = RuleRecord(
            id="rule-2",
            threshold=2.0,
            value_kind="max_grid_spacing_m",
        )

        devices = place_devices_from_rule(room, rule)
        polygon = Polygon(room)

        self.assertGreater(len(devices), 0)
        self.assertTrue(
            all(polygon.covers(Point(device.x, device.y)) for device in devices)
        )

    def test_small_room_has_at_least_one_device(self) -> None:
        room = [(0.0, 0.0), (1.5, 0.0), (1.5, 1.5), (0.0, 1.5)]
        rule = RuleRecord(
            id="rule-3",
            threshold=4.0,
            value_kind="max_grid_spacing_m",
        )

        devices = place_devices_from_rule(room, rule)

        self.assertGreaterEqual(len(devices), 1)
        self.assertTrue(all(device.rule_id == "rule-3" for device in devices))

    def test_unit_mismatch_auto_scaling(self) -> None:
        # Coordinates are millimeters; the rule value is in meters.
        room = [(0.0, 0.0), (10000.0, 0.0), (10000.0, 8000.0), (0.0, 8000.0)]
        rule = RuleRecord(
            id="rule-mm",
            threshold=2.0,
            value_kind="max_grid_spacing_m",
        )

        devices = place_devices_from_rule(room, rule)

        self.assertGreater(len(devices), 0)
        self.assertLessEqual(len(devices), 50)
        self.assertTrue(all(device.x >= 1000.0 for device in devices))
        self.assertTrue(all(device.y >= 1000.0 for device in devices))

    def test_extreme_density_circuit_breaker(self) -> None:
        room = [
            (0.0, 0.0),
            (1_000_000.0, 0.0),
            (1_000_000.0, 1_000_000.0),
            (0.0, 1_000_000.0),
        ]
        rule = RuleRecord(
            id="rule-extreme",
            threshold=1.0,
            value_kind="max_grid_spacing_m",
        )

        with self.assertRaisesRegex(ValueError, "Grid too dense"):
            place_devices_from_rule(room, rule)

    def test_selects_spacing_rule_by_type_and_height(self) -> None:
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

        self.assertIsNotNone(rule)
        if rule is None:
            self.fail("Expected a matching RuleRecord")
        self.assertEqual(rule.id, "test-rule-uuid")
        self.assertEqual(rule.threshold, 9)
        self.assertEqual(rule.status, "verified")

    def test_empty_grid_fallback_on_donut_polygon_avoids_hole(self) -> None:
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

        self.assertGreaterEqual(len(devices), 1)
        for device in devices:
            device_point = Point(device.x, device.y)
            self.assertTrue(hall_polygon.covers(device_point))
            self.assertFalse(office_polygon.contains(device_point))
            self.assertFalse(office_polygon.covers(device_point))

    def test_empty_grid_fallback_on_compact_donut_10x5_avoids_office(self) -> None:
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

        self.assertGreaterEqual(len(devices), 1)
        for device in devices:
            device_point = Point(device.x, device.y)
            self.assertTrue(hall_polygon.covers(device_point))
            self.assertFalse(office_polygon.covers(device_point))

    def test_empty_grid_fallback_on_concave_l_shape_stays_inside(self) -> None:
        room = [
            (0.0, 0.0),
            (10.0, 0.0),
            (10.0, 2.0),
            (2.0, 2.0),
            (2.0, 10.0),
            (0.0, 10.0),
        ]
        polygon = Polygon(room)
        rule = RuleRecord(
            id="rule-l-fallback",
            threshold=12.0,
            value_kind="max_grid_spacing_m",
        )

        devices = place_devices_from_rule(room, rule)

        self.assertGreaterEqual(len(devices), 1)
        for device in devices:
            self.assertTrue(polygon.covers(Point(device.x, device.y)))


if __name__ == "__main__":
    unittest.main()
