"""BIM-75: розміщення ручних сповіщувачів біля виходів і на шляхах евакуації."""

import math
import sys
import unittest
from pathlib import Path
from typing import Any

API_DIR = Path(__file__).resolve().parent.parent
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

from src.modules.placement.manual_call_points import (
    INSUFFICIENT_DATA,
    PLACED,
    REASON_EXITS_OUTSIDE,
    REASON_NO_EXITS,
    REASON_NO_RULE,
    REASON_NO_SCALE,
    WARNING_UNVERIFIED,
    CallPointExit,
    CallPointRoom,
    PlacedCallPoint,
    describe_call_point_outcome,
    place_manual_call_points,
    select_call_point_rule,
)

MM = 0.001  # креслення в міліметрах


def rect(x0: float, y0: float, x1: float, y1: float) -> tuple[tuple[float, float], ...]:
    return ((x0, y0), (x1, y0), (x1, y1), (x0, y1))


def room(
    room_id: str, kind: str, coords: tuple[tuple[float, float], ...]
) -> CallPointRoom:
    return CallPointRoom(id=room_id, name=room_id, type=kind, coords=coords)


def exit_at(exit_id: str, x: float, y: float) -> CallPointExit:
    return CallPointExit(id=exit_id, x=x, y=y)


def mcp_rule(
    code: str = "MANUAL_CALL_POINT_SPACING_DSTU",
    value: float = 30.0,
    status: str = "verified",
    offset: float | None = 1.0,
) -> dict[str, Any]:
    conditions: dict[str, Any] = {"place_at": ["exits", "evacuation_routes"]}
    if offset is not None:
        conditions["exit_offset_m"] = offset
    return {
        "id": f"uuid-{code}",
        "rule_id": code,
        "name": code,
        "device_type": "manual_call_point",
        "value_kind": "max_grid_spacing_m",
        "value": value,
        "conditions": conditions,
        "document": "ДСТУ EN 54-14:2021",
        "clause": "п. 6.6",
        "source_url": "https://uas.gov.ua/national-fund-of-regulatory-documents/692",
        "verification_status": status,
    }


def gaps_along_x(devices: list[PlacedCallPoint]) -> list[float]:
    xs = sorted(device.x for device in devices)
    return [b - a for a, b in zip(xs, xs[1:], strict=False)]


def corridor_40m() -> tuple[CallPointRoom, list[CallPointExit]]:
    return (
        room("corridor", "corridor", rect(0, 0, 40_000, 3_000)),
        [exit_at("e1", 0, 1_500), exit_at("e2", 40_000, 1_500)],
    )


class SelectRuleTests(unittest.TestCase):
    def test_takes_the_stricter_value_and_lists_the_other(self) -> None:
        rows = [
            mcp_rule("DBN", 50.0),
            mcp_rule("DSTU", 30.0),
            {"rule_id": "SMOKE", "device_type": "smoke_detector", "value": 9},
            {"rule_id": "LEGACY", "device_type": None, "value": 3},
        ]
        rule, others = select_call_point_rule(rows)
        assert rule is not None
        self.assertEqual((rule.rule_id, rule.max_spacing_m), ("DSTU", 30.0))
        self.assertEqual([r.rule_id for r in others], ["DBN"])

    def test_no_call_point_rules(self) -> None:
        rule, others = select_call_point_rule(
            [{"rule_id": "SMOKE", "device_type": "smoke_detector", "value": 9}]
        )
        self.assertIsNone(rule)
        self.assertEqual(others, [])

    def test_ignores_non_positive_values(self) -> None:
        rule, _ = select_call_point_rule([mcp_rule("ZERO", 0.0)])
        self.assertIsNone(rule)


class RequiredDataTests(unittest.TestCase):
    def test_no_exits_means_no_devices_and_a_message(self) -> None:
        corridor, _ = corridor_40m()
        outcome = place_manual_call_points(
            rooms=[corridor], exits=[], rule_rows=[mcp_rule()], unit_scale_m=MM
        )
        self.assertEqual(outcome.status, INSUFFICIENT_DATA)
        self.assertEqual(outcome.reason, "Позначте евакуаційні виходи")
        self.assertEqual(outcome.reason, REASON_NO_EXITS)
        self.assertEqual(outcome.devices, [])

    def test_no_exits_message_wins_over_missing_rule(self) -> None:
        corridor, _ = corridor_40m()
        outcome = place_manual_call_points(
            rooms=[corridor], exits=[], rule_rows=[], unit_scale_m=MM
        )
        self.assertEqual(outcome.reason, REASON_NO_EXITS)

    def test_no_rule(self) -> None:
        corridor, exits = corridor_40m()
        outcome = place_manual_call_points(
            rooms=[corridor], exits=exits, rule_rows=[], unit_scale_m=MM
        )
        self.assertEqual(outcome.status, INSUFFICIENT_DATA)
        self.assertEqual(outcome.reason, REASON_NO_RULE)
        self.assertEqual(outcome.devices, [])

    def test_unknown_scale(self) -> None:
        corridor, exits = corridor_40m()
        outcome = place_manual_call_points(
            rooms=[corridor], exits=exits, rule_rows=[mcp_rule()], unit_scale_m=None
        )
        self.assertEqual(outcome.reason, REASON_NO_SCALE)
        self.assertEqual(outcome.devices, [])

    def test_exit_outside_every_room_is_skipped(self) -> None:
        corridor, _ = corridor_40m()
        outcome = place_manual_call_points(
            rooms=[corridor],
            exits=[exit_at("far", 500_000, 500_000)],
            rule_rows=[mcp_rule()],
            unit_scale_m=MM,
        )
        self.assertEqual(outcome.status, INSUFFICIENT_DATA)
        self.assertEqual(outcome.reason, REASON_EXITS_OUTSIDE)
        self.assertEqual(outcome.skipped_exit_ids, ["far"])

    def test_one_good_exit_is_enough_to_place(self) -> None:
        corridor, _ = corridor_40m()
        outcome = place_manual_call_points(
            rooms=[corridor],
            exits=[exit_at("e1", 0, 1_500), exit_at("far", 500_000, 500_000)],
            rule_rows=[mcp_rule()],
            unit_scale_m=MM,
        )
        self.assertEqual(outcome.status, PLACED)
        self.assertEqual(outcome.skipped_exit_ids, ["far"])
        self.assertEqual(outcome.used_exit_ids, ["e1"])
        self.assertEqual(len(outcome.devices), 1)


class PlacementNearExitsTests(unittest.TestCase):
    def test_device_stands_inside_the_room_one_metre_from_the_exit(self) -> None:
        corridor, exits = corridor_40m()
        outcome = place_manual_call_points(
            rooms=[corridor],
            exits=exits[:1],
            rule_rows=[mcp_rule()],
            unit_scale_m=MM,
        )
        (device,) = outcome.devices
        self.assertAlmostEqual(device.x, 1_000, places=3)
        self.assertAlmostEqual(device.y, 1_500, places=3)
        self.assertEqual(device.room_id, "corridor")
        self.assertEqual(device.exit_id, "e1")

    def test_offset_comes_from_the_rule(self) -> None:
        corridor, exits = corridor_40m()
        outcome = place_manual_call_points(
            rooms=[corridor],
            exits=exits[:1],
            rule_rows=[mcp_rule(offset=0.6)],
            unit_scale_m=MM,
        )
        self.assertAlmostEqual(outcome.devices[0].x, 600, places=3)

    def test_every_exit_gets_a_device(self) -> None:
        corridor, exits = corridor_40m()
        outcome = place_manual_call_points(
            rooms=[corridor], exits=exits, rule_rows=[mcp_rule()], unit_scale_m=MM
        )
        at_exits = [d for d in outcome.devices if d.exit_id is not None]
        self.assertEqual({d.exit_id for d in at_exits}, {"e1", "e2"})

    def test_corridor_side_is_preferred_over_the_hall_side(self) -> None:
        corridor = room("corridor", "corridor", rect(0, 0, 20_000, 3_000))
        hall = room("hall", "hall", rect(0, 3_100, 20_000, 10_000))
        outcome = place_manual_call_points(
            rooms=[hall, corridor],
            exits=[exit_at("e1", 10_000, 3_050)],
            rule_rows=[mcp_rule()],
            unit_scale_m=MM,
        )
        self.assertEqual(outcome.devices[0].room_id, "corridor")

    def test_stairs_side_is_the_last_choice(self) -> None:
        stairs = room("stairs", "staircase", rect(20_000, 0, 24_000, 3_000))
        office = room("office", "office", rect(0, 0, 19_900, 3_000))
        outcome = place_manual_call_points(
            rooms=[stairs, office],
            exits=[exit_at("e1", 19_950, 1_500)],
            rule_rows=[mcp_rule()],
            unit_scale_m=MM,
        )
        self.assertEqual(outcome.devices[0].room_id, "office")


class SpacingAlongRoutesTests(unittest.TestCase):
    def test_long_corridor_gets_intermediate_devices(self) -> None:
        corridor, exits = corridor_40m()
        outcome = place_manual_call_points(
            rooms=[corridor], exits=exits, rule_rows=[mcp_rule()], unit_scale_m=MM
        )
        self.assertEqual(outcome.status, PLACED)
        self.assertEqual(len(outcome.devices), 3)
        middle = [d for d in outcome.devices if d.exit_id is None]
        self.assertAlmostEqual(middle[0].x, 20_000, places=3)
        self.assertEqual(middle[0].room_id, "corridor")

    def test_distance_between_neighbours_never_exceeds_the_rule(self) -> None:
        corridor, exits = corridor_40m()
        for max_spacing in (30.0, 20.0, 15.0, 9.0, 5.0):
            with self.subTest(max_spacing=max_spacing):
                outcome = place_manual_call_points(
                    rooms=[corridor],
                    exits=exits,
                    rule_rows=[mcp_rule(value=max_spacing)],
                    unit_scale_m=MM,
                )
                limit = max_spacing / MM
                self.assertTrue(
                    all(gap <= limit + 1e-6 for gap in gaps_along_x(outcome.devices)),
                    gaps_along_x(outcome.devices),
                )

    def test_value_is_taken_from_the_rule_not_from_code(self) -> None:
        corridor, exits = corridor_40m()
        counts = {}
        for max_spacing in (50.0, 30.0, 10.0):
            outcome = place_manual_call_points(
                rooms=[corridor],
                exits=exits,
                rule_rows=[mcp_rule(value=max_spacing)],
                unit_scale_m=MM,
            )
            counts[max_spacing] = len(outcome.devices)
        self.assertEqual(counts[50.0], 2)  # 38 м між виходами < 50 м
        self.assertEqual(counts[30.0], 3)
        self.assertEqual(counts[10.0], 5)

    def test_short_route_needs_no_intermediate_devices(self) -> None:
        corridor = room("corridor", "corridor", rect(0, 0, 20_000, 3_000))
        outcome = place_manual_call_points(
            rooms=[corridor],
            exits=[exit_at("e1", 0, 1_500), exit_at("e2", 20_000, 1_500)],
            rule_rows=[mcp_rule()],
            unit_scale_m=MM,
        )
        self.assertEqual(len(outcome.devices), 2)

    def test_stricter_of_two_conflicting_norms_is_used(self) -> None:
        corridor, exits = corridor_40m()
        outcome = place_manual_call_points(
            rooms=[corridor],
            exits=exits,
            rule_rows=[mcp_rule("DBN", 50.0), mcp_rule("DSTU", 30.0)],
            unit_scale_m=MM,
        )
        assert outcome.rule is not None
        self.assertEqual(outcome.rule.rule_id, "DSTU")
        self.assertEqual(len(outcome.devices), 3)
        self.assertEqual([r.rule_id for r in outcome.alternative_rules], ["DBN"])

    def test_same_result_for_a_drawing_in_metres(self) -> None:
        corridor = room("corridor", "corridor", rect(0, 0, 40, 3))
        outcome = place_manual_call_points(
            rooms=[corridor],
            exits=[exit_at("e1", 0, 1.5), exit_at("e2", 40, 1.5)],
            rule_rows=[mcp_rule()],
            unit_scale_m=1.0,
        )
        self.assertEqual(len(outcome.devices), 3)
        self.assertAlmostEqual(outcome.devices[0].x, 1.0, places=6)

    def test_bent_corridor_route_follows_the_corridor(self) -> None:
        # Г-подібний коридор шириною 3 м: вертикальне плече 20 м, горизонтальне 30 м.
        bent = room(
            "corridor",
            "corridor",
            (
                (0, 0),
                (30_000, 0),
                (30_000, 3_000),
                (3_000, 3_000),
                (3_000, 20_000),
                (0, 20_000),
            ),
        )
        outcome = place_manual_call_points(
            rooms=[bent],
            exits=[exit_at("top", 1_500, 20_000), exit_at("right", 30_000, 1_500)],
            rule_rows=[mcp_rule()],
            unit_scale_m=MM,
        )
        self.assertEqual(outcome.status, PLACED)
        self.assertEqual(len(outcome.devices), 3)
        checker = _inside_checker(bent)
        for device in outcome.devices:
            self.assertTrue(checker(device.x, device.y), (device.x, device.y))
        middle = next(d for d in outcome.devices if d.exit_id is None)
        # Пряма між виходами проходить поза коридором; середня точка — у плечі.
        self.assertGreater(middle.x, 3_000)
        points = sorted(
            ((d.x, d.y) for d in outcome.devices), key=lambda p: -p[1] + p[0]
        )
        for a, b in zip(points, points[1:], strict=False):
            self.assertLessEqual(math.hypot(a[0] - b[0], a[1] - b[1]), 30_000)

    def test_two_exits_of_one_hall_are_connected_inside_the_hall(self) -> None:
        hall = room("hall", "hall", rect(0, 0, 60_000, 10_000))
        outcome = place_manual_call_points(
            rooms=[hall],
            exits=[exit_at("w", 0, 5_000), exit_at("e", 60_000, 5_000)],
            rule_rows=[mcp_rule()],
            unit_scale_m=MM,
        )
        self.assertEqual(len(outcome.devices), 3)  # 58 м між виходами → 2 відрізки
        self.assertTrue(all(gap <= 30_000 for gap in gaps_along_x(outcome.devices)))

    def test_exits_in_separate_buildings_are_not_joined(self) -> None:
        west = room("west", "corridor", rect(0, 0, 40_000, 3_000))
        east = room("east", "corridor", rect(500_000, 0, 540_000, 3_000))
        outcome = place_manual_call_points(
            rooms=[west, east],
            exits=[exit_at("a", 0, 1_500), exit_at("b", 540_000, 1_500)],
            rule_rows=[mcp_rule()],
            unit_scale_m=MM,
        )
        self.assertEqual(len(outcome.devices), 2)

    def test_three_exits_along_one_corridor_are_chained(self) -> None:
        corridor = room("corridor", "corridor", rect(0, 0, 100_000, 3_000))
        outcome = place_manual_call_points(
            rooms=[corridor],
            exits=[
                exit_at("a", 0, 1_500),
                exit_at("b", 50_000, 0),
                exit_at("c", 100_000, 1_500),
            ],
            rule_rows=[mcp_rule()],
            unit_scale_m=MM,
        )
        self.assertTrue(all(gap <= 30_000 for gap in gaps_along_x(outcome.devices)))
        self.assertGreaterEqual(len(outcome.devices), 5)


class RuleStatusTests(unittest.TestCase):
    def test_unverified_rule_is_flagged_in_the_result(self) -> None:
        corridor, exits = corridor_40m()
        outcome = place_manual_call_points(
            rooms=[corridor],
            exits=exits,
            rule_rows=[mcp_rule(status="needs_review")],
            unit_scale_m=MM,
        )
        self.assertEqual(outcome.status, PLACED)
        self.assertEqual(outcome.warning, WARNING_UNVERIFIED)
        self.assertEqual(outcome.warning, "Розміщено за неперевіреним правилом")
        described = describe_call_point_outcome(outcome)
        self.assertEqual(described["rule"]["verification_status"], "needs_review")
        self.assertEqual(described["warning"], WARNING_UNVERIFIED)

    def test_verified_rule_has_no_warning(self) -> None:
        corridor, exits = corridor_40m()
        outcome = place_manual_call_points(
            rooms=[corridor], exits=exits, rule_rows=[mcp_rule()], unit_scale_m=MM
        )
        self.assertIsNone(outcome.warning)

    def test_description_shape(self) -> None:
        corridor, exits = corridor_40m()
        outcome = place_manual_call_points(
            rooms=[corridor],
            exits=exits,
            rule_rows=[mcp_rule("DSTU", 30.0), mcp_rule("DBN", 50.0)],
            unit_scale_m=MM,
        )
        described = describe_call_point_outcome(outcome)
        self.assertEqual(described["status"], PLACED)
        self.assertEqual(described["device_type"], "manual_call_point")
        self.assertEqual(described["device_count"], 3)
        self.assertEqual(described["exit_ids"], ["e1", "e2"])
        self.assertEqual(described["rule"]["rule_id"], "DSTU")
        self.assertEqual(described["rule"]["max_spacing_m"], 30.0)
        self.assertEqual(described["rule"]["clause"], "п. 6.6")
        self.assertEqual(described["alternative_rules"][0]["rule_id"], "DBN")

    def test_description_of_a_missing_exits_case(self) -> None:
        corridor, _ = corridor_40m()
        outcome = place_manual_call_points(
            rooms=[corridor], exits=[], rule_rows=[mcp_rule()], unit_scale_m=MM
        )
        described = describe_call_point_outcome(outcome)
        self.assertEqual(described["status"], INSUFFICIENT_DATA)
        self.assertEqual(described["reason"], "Позначте евакуаційні виходи")
        self.assertEqual(described["device_count"], 0)
        self.assertIsNone(described["rule"])


def _inside_checker(room_: CallPointRoom):
    ring = list(room_.coords)

    def inside(x: float, y: float) -> bool:
        result = False
        for i in range(len(ring)):
            x1, y1 = ring[i]
            x2, y2 = ring[(i + 1) % len(ring)]
            if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
                result = not result
        return result

    return inside


if __name__ == "__main__":
    unittest.main()
