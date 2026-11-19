"""BIM-73: правило розміщення за висотою приміщення або зони."""

import sys
import unittest
from pathlib import Path
from typing import Any

API_DIR = Path(__file__).resolve().parent.parent
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

from src.modules.placement.service import (  # noqa: E402
    INSUFFICIENT_DATA,
    PLACED,
    REASON_NO_HEIGHT,
    RuleRecord,
    build_placement_targets,
    describe_outcome,
    effective_grid_step_m,
    place_targets,
    resolve_rule_for_height,
)

SCALE_MM = 0.001  # метрів в одній одиниці креслення (креслення в мм)


def rule_row(
    code: str,
    device_type: str,
    min_height: float | None,
    max_height: float | None,
    step: float,
    area: float | None,
    *,
    value_kind: str = "max_grid_spacing_m",
) -> dict[str, Any]:
    return {
        "id": f"uuid-{code}",
        "rule_id": code,
        "name": code,
        "device_type": device_type,
        "value_kind": value_kind,
        "room_types": [],
        "min_height_m": min_height,
        "max_height_m": max_height,
        "value": step,
        "conditions": {"max_protected_area_m2": area} if area else {},
        "document": "ДБН В.2.5-56:2014",
        "clause": "Додаток Б",
        "source_url": "https://example.com",
        "verification_status": "verified",
    }


# Значення зі звірки Дениса (BIM-169): крок, м; площа захисту, м².
CATALOG = [
    rule_row("SMOKE_GRID_HEIGHT_3_5", "smoke_detector", None, 3.5, 9.0, 80),
    rule_row("SMOKE_GRID_HEIGHT_3_5_6", "smoke_detector", 3.5, 6.0, 8.5, 70),
    rule_row("SMOKE_GRID_HEIGHT_6_10", "smoke_detector", 6.0, 10.0, 8.0, 65),
    rule_row("SMOKE_GRID_HEIGHT_10_12", "smoke_detector", 10.0, 12.0, 7.5, 55),
    rule_row("HEAT_GRID_HEIGHT_3_5", "heat_detector", None, 3.5, 5.0, 25),
    rule_row("HEAT_GRID_HEIGHT_3_5_6", "heat_detector", 3.5, 6.0, 4.5, 20),
    rule_row("HEAT_GRID_HEIGHT_6_9", "heat_detector", 6.0, 9.0, 4.0, 15),
    # Відстань до стіни — інший вид значення, у виборі кроку сітки не бере участі.
    rule_row(
        "SMOKE_WALL_HEIGHT_3_5_6",
        "smoke_detector",
        3.5,
        6.0,
        4.0,
        None,
        value_kind="max_wall_distance_m",
    ),
]


def rect_mm(
    x0_m: float, y0_m: float, x1_m: float, y1_m: float
) -> list[dict[str, float]]:
    """Прямокутник у мм за кутами в метрах."""
    return [
        {"x": x0_m * 1000, "y": y0_m * 1000},
        {"x": x1_m * 1000, "y": y0_m * 1000},
        {"x": x1_m * 1000, "y": y1_m * 1000},
        {"x": x0_m * 1000, "y": y1_m * 1000},
    ]


def room_row(
    room_id: str, height: float | None, *, width_m: float = 40, depth_m: float = 40
) -> dict[str, Any]:
    return {
        "id": room_id,
        "name": f"Room {room_id}",
        "type": "office",
        "height": height,
        "polygon": rect_mm(0, 0, width_m, depth_m),
    }


def zone_row(
    zone_id: str,
    room_id: str,
    height: float | None,
    polygon: list[dict[str, float]],
    name: str | None = None,
) -> dict[str, Any]:
    return {
        "id": zone_id,
        "room_id": room_id,
        "name": name,
        "height": height,
        "polygon": polygon,
    }


class TestResolveRuleForHeight(unittest.TestCase):
    def _decide(self, device_type: str, height: float | None) -> Any:
        return resolve_rule_for_height(
            CATALOG, device_type=device_type, room_type="office", height_m=height
        )

    def test_height_up_to_3_5_takes_step_and_area_from_rule(self) -> None:
        decision = self._decide("smoke_detector", 3.0)
        self.assertIsNone(decision.reason)
        rule = decision.rule
        self.assertIsNotNone(rule)
        assert rule is not None
        self.assertEqual(rule.rule_id, "SMOKE_GRID_HEIGHT_3_5")
        self.assertEqual(rule.threshold, 9.0)
        self.assertEqual(rule.max_protected_area_m2, 80.0)

    def test_different_heights_give_different_rules(self) -> None:
        cases = [
            ("smoke_detector", 3.0, "SMOKE_GRID_HEIGHT_3_5", 9.0),
            ("smoke_detector", 4.5, "SMOKE_GRID_HEIGHT_3_5_6", 8.5),
            ("smoke_detector", 8.0, "SMOKE_GRID_HEIGHT_6_10", 8.0),
            ("smoke_detector", 11.0, "SMOKE_GRID_HEIGHT_10_12", 7.5),
            ("heat_detector", 3.0, "HEAT_GRID_HEIGHT_3_5", 5.0),
            ("heat_detector", 5.0, "HEAT_GRID_HEIGHT_3_5_6", 4.5),
            ("heat_detector", 7.0, "HEAT_GRID_HEIGHT_6_9", 4.0),
        ]
        for device_type, height, expected_code, expected_step in cases:
            with self.subTest(device_type=device_type, height=height):
                rule = self._decide(device_type, height).rule
                assert rule is not None
                self.assertEqual(rule.rule_id, expected_code)
                self.assertEqual(rule.threshold, expected_step)

    def test_range_boundary_takes_stricter_rule(self) -> None:
        cases = [
            ("smoke_detector", 3.5, "SMOKE_GRID_HEIGHT_3_5_6"),
            ("smoke_detector", 6.0, "SMOKE_GRID_HEIGHT_6_10"),
            ("smoke_detector", 10.0, "SMOKE_GRID_HEIGHT_10_12"),
            ("smoke_detector", 12.0, "SMOKE_GRID_HEIGHT_10_12"),
            ("heat_detector", 3.5, "HEAT_GRID_HEIGHT_3_5_6"),
            ("heat_detector", 6.0, "HEAT_GRID_HEIGHT_6_9"),
            ("heat_detector", 9.0, "HEAT_GRID_HEIGHT_6_9"),
        ]
        for device_type, height, expected_code in cases:
            with self.subTest(device_type=device_type, height=height):
                rule = self._decide(device_type, height).rule
                assert rule is not None
                self.assertEqual(rule.rule_id, expected_code)

    def test_no_height_means_no_rule_and_no_default(self) -> None:
        for height in (None, 0, -1):
            with self.subTest(height=height):
                decision = self._decide("smoke_detector", height)
                self.assertIsNone(decision.rule)
                self.assertEqual(decision.reason, REASON_NO_HEIGHT)

    def test_height_outside_all_ranges_explains_which_height(self) -> None:
        cases = [
            ("smoke_detector", 12.5, "Немає правила для висоти 12.5 м"),
            ("smoke_detector", 13.0, "Немає правила для висоти 13 м"),
            ("heat_detector", 9.5, "Немає правила для висоти 9.5 м"),
        ]
        for device_type, height, expected_reason in cases:
            with self.subTest(device_type=device_type, height=height):
                decision = self._decide(device_type, height)
                self.assertIsNone(decision.rule)
                self.assertEqual(decision.reason, expected_reason)

    def test_changed_value_in_table_changes_rule_without_code_change(self) -> None:
        rows = [dict(row) for row in CATALOG]
        rows[0]["value"] = 7.0
        decision = resolve_rule_for_height(
            rows, device_type="smoke_detector", room_type=None, height_m=3.0
        )
        assert decision.rule is not None
        self.assertEqual(decision.rule.threshold, 7.0)


class TestEffectiveGridStep(unittest.TestCase):
    def test_area_limits_step(self) -> None:
        rule = RuleRecord(id="r", threshold=9.0, max_protected_area_m2=80.0)
        self.assertAlmostEqual(effective_grid_step_m(rule), 80**0.5)

    def test_step_is_kept_when_area_allows_it(self) -> None:
        rule = RuleRecord(id="r", threshold=5.0, max_protected_area_m2=36.0)
        self.assertEqual(effective_grid_step_m(rule), 5.0)

    def test_without_area_step_is_unchanged(self) -> None:
        self.assertEqual(effective_grid_step_m(RuleRecord(id="r", threshold=2.0)), 2.0)


class TestPlaceTargets(unittest.TestCase):
    def _place(
        self, rooms: list[dict[str, Any]], zones: list[dict[str, Any]] | None = None
    ) -> list[Any]:
        return place_targets(
            build_placement_targets(rooms, zones or []),
            CATALOG,
            device_type="smoke_detector",
            unit_scale_m=SCALE_MM,
        )

    def test_two_identical_rooms_of_different_height_get_different_step(self) -> None:
        low, high = self._place([room_row("low", 3.0), room_row("high", 11.0)])

        self.assertEqual(low.status, PLACED)
        self.assertEqual(high.status, PLACED)
        assert low.rule is not None and high.rule is not None
        self.assertEqual(low.rule.rule_id, "SMOKE_GRID_HEIGHT_3_5")
        self.assertEqual(high.rule.rule_id, "SMOKE_GRID_HEIGHT_10_12")
        self.assertGreater(
            effective_grid_step_m(low.rule), effective_grid_step_m(high.rule)
        )
        # Те саме приміщення 40×40 м: менший крок — більше приладів.
        self.assertGreater(len(high.devices), len(low.devices))

    def test_step_is_converted_to_drawing_units(self) -> None:
        (outcome,) = self._place([room_row("a", 3.0)])
        xs = sorted({round(device.x, 3) for device in outcome.devices})
        assert outcome.rule is not None
        expected_mm = effective_grid_step_m(outcome.rule) / SCALE_MM
        self.assertGreater(len(xs), 1)
        self.assertAlmostEqual(xs[1] - xs[0], expected_mm, places=2)

    def test_room_without_height_gets_no_devices(self) -> None:
        no_height, with_height = self._place([room_row("a", None), room_row("b", 3.0)])

        self.assertEqual(no_height.status, INSUFFICIENT_DATA)
        self.assertEqual(no_height.reason, REASON_NO_HEIGHT)
        self.assertEqual(no_height.devices, [])
        self.assertIsNone(no_height.rule)
        # Інше приміщення це не зачіпає.
        self.assertEqual(with_height.status, PLACED)
        self.assertGreater(len(with_height.devices), 0)

    def test_height_outside_rule_ranges_is_insufficient_data_with_reason(self) -> None:
        (outcome,) = self._place([room_row("a", 13.0)])

        self.assertEqual(outcome.status, INSUFFICIENT_DATA)
        self.assertEqual(outcome.reason, "Немає правила для висоти 13 м")
        self.assertEqual(outcome.devices, [])

    def test_room_with_two_zones_of_different_height(self) -> None:
        room = room_row("room", None)
        zones = [
            zone_row("z1", "room", 3.0, rect_mm(0, 0, 40, 20), name="Низька"),
            zone_row("z2", "room", 11.0, rect_mm(0, 20, 40, 40), name="Висока"),
        ]
        low, high = self._place([room], zones)

        self.assertEqual((low.target.zone_id, high.target.zone_id), ("z1", "z2"))
        self.assertEqual(low.target.room_id, "room")
        self.assertEqual(low.status, PLACED)
        self.assertEqual(high.status, PLACED)
        assert low.rule is not None and high.rule is not None
        self.assertNotEqual(low.rule.id, high.rule.id)
        # Кожен прилад лежить у межах своєї зони.
        self.assertTrue(all(device.y <= 20_000 for device in low.devices))
        self.assertTrue(all(device.y >= 20_000 for device in high.devices))

    def test_zone_without_height_is_insufficient_others_are_placed(self) -> None:
        room = room_row("room", 3.0)  # висота приміщення зонам не підставляється
        zones = [
            zone_row("z1", "room", 3.0, rect_mm(0, 0, 40, 20)),
            zone_row("z2", "room", None, rect_mm(0, 20, 40, 40)),
        ]
        placed, missing = self._place([room], zones)

        self.assertEqual(placed.status, PLACED)
        self.assertGreater(len(placed.devices), 0)
        self.assertEqual(missing.status, INSUFFICIENT_DATA)
        self.assertEqual(missing.reason, REASON_NO_HEIGHT)
        self.assertEqual(missing.devices, [])

    def test_room_with_zones_is_not_placed_as_a_whole(self) -> None:
        room = room_row("room", 3.0)
        zones = [zone_row("z1", "room", 3.0, rect_mm(0, 0, 20, 40))]
        targets = build_placement_targets([room], zones)

        self.assertEqual(len(targets), 1)
        self.assertEqual(targets[0].zone_id, "z1")

    def test_targets_for_rooms_without_zones_and_default_zone_name(self) -> None:
        rooms = [
            room_row("a", 3.0),
            room_row("b", 3.0),
            {"id": "broken", "name": "No outline", "height": 3.0, "polygon": []},
        ]
        zones = [zone_row("z1", "b", 3.0, rect_mm(0, 0, 10, 10))]
        targets = build_placement_targets(rooms, zones)

        self.assertEqual(
            [(t.room_id, t.zone_id) for t in targets], [("a", None), ("b", "z1")]
        )
        self.assertIsNone(targets[0].zone_name)
        self.assertEqual(targets[1].zone_name, "Зона 1")

    def test_describe_outcome_for_placed_and_insufficient(self) -> None:
        placed, missing = self._place([room_row("a", 3.0), room_row("b", None)])

        placed_info = describe_outcome(placed)
        self.assertEqual(placed_info["status"], PLACED)
        self.assertIsNone(placed_info["reason"])
        self.assertEqual(placed_info["device_count"], len(placed.devices))
        self.assertEqual(placed_info["height_m"], 3.0)
        rule_info = placed_info["rule"]
        self.assertEqual(rule_info["rule_id"], "SMOKE_GRID_HEIGHT_3_5")
        self.assertEqual(rule_info["grid_step_m"], 9.0)
        self.assertEqual(rule_info["protected_area_m2"], 80.0)
        self.assertAlmostEqual(rule_info["applied_step_m"], 80**0.5)
        self.assertEqual(rule_info["verification_status"], "verified")

        missing_info = describe_outcome(missing)
        self.assertEqual(missing_info["status"], INSUFFICIENT_DATA)
        self.assertEqual(missing_info["reason"], REASON_NO_HEIGHT)
        self.assertEqual(missing_info["device_count"], 0)
        self.assertIsNone(missing_info["rule"])


if __name__ == "__main__":
    unittest.main()
