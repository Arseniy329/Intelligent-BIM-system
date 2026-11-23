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
    ROUTE_CONFIRMED,
    ROUTE_NOT_APPLICABLE,
    ROUTE_UNCONFIRMED,
    WARNING_ROUTE_UNCONFIRMED,
    WARNING_UNVERIFIED,
    CallPointExit,
    CallPointPassage,
    CallPointRoom,
    PlacedCallPoint,
    _Room,
    describe_call_point_outcome,
    passages_from_rows,
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


def passage_at(passage_id: str, x: float, y: float) -> CallPointPassage:
    return CallPointPassage(id=passage_id, x=x, y=y)


def two_corridors_behind_a_wall() -> tuple[list[CallPointRoom], list[CallPointExit]]:
    """Два коридори з контурами на відстані 0,3 м (суцільна стіна), вихід у кожному."""
    return (
        [
            room("west", "corridor", rect(0, 0, 20_000, 3_000)),
            room("east", "corridor", rect(20_300, 0, 40_300, 3_000)),
        ],
        [exit_at("e_west", 0, 1_500), exit_at("e_east", 40_300, 1_500)],
    )


class RouteNeedsAPassageTests(unittest.TestCase):
    """Близькі контури не доводять проходу: без дверей шляху між приміщеннями немає."""

    def place(
        self,
        rooms: list[CallPointRoom],
        exits: list[CallPointExit],
        passages: list[CallPointPassage] | None = None,
    ) -> Any:
        return place_manual_call_points(
            rooms=rooms,
            exits=exits,
            rule_rows=[mcp_rule()],
            unit_scale_m=MM,
            passages=passages,
        )

    def test_two_corridors_behind_a_solid_wall_are_not_connected(self) -> None:
        rooms, exits = two_corridors_behind_a_wall()

        outcome = self.place(rooms, exits)

        # Сповіщувачі біля виходів лишаються, але шляху між ними ніхто не довів.
        self.assertEqual(outcome.status, PLACED)
        self.assertEqual(len(outcome.devices), 2)
        self.assertTrue(all(device.exit_id for device in outcome.devices))
        self.assertEqual(outcome.route_coverage, ROUTE_UNCONFIRMED)
        self.assertEqual(outcome.unconnected_exit_ids, ["e_east"])
        self.assertEqual(outcome.unconnected_room_names, ["east"])
        assert outcome.route_warning is not None
        self.assertTrue(outcome.route_warning.startswith(WARNING_ROUTE_UNCONFIRMED))
        self.assertIn("east", outcome.route_warning)
        self.assertEqual(outcome.used_passage_ids, [])

    def test_same_contours_with_a_confirmed_passage_get_the_route(self) -> None:
        rooms, exits = two_corridors_behind_a_wall()

        outcome = self.place(rooms, exits, [passage_at("door", 20_150, 1_500)])

        self.assertEqual(outcome.status, PLACED)
        self.assertEqual(outcome.route_coverage, ROUTE_CONFIRMED)
        self.assertIsNone(outcome.route_warning)
        self.assertEqual(outcome.unconnected_exit_ids, [])
        self.assertEqual(outcome.used_passage_ids, ["door"])
        # 40 м між виходами: потрібен проміжний сповіщувач, відстані ≤ 30 м.
        self.assertGreater(len(outcome.devices), 2)
        self.assertTrue(all(gap <= 30_000 for gap in gaps_along_x(outcome.devices)))

    def test_pair_of_fixtures_differs_only_by_the_passage(self) -> None:
        rooms, exits = two_corridors_behind_a_wall()

        without = self.place(rooms, exits)
        with_passage = self.place(rooms, exits, [passage_at("door", 20_150, 1_500)])

        self.assertEqual(len(without.devices), 2)
        self.assertGreater(len(with_passage.devices), len(without.devices))
        self.assertEqual(
            (without.route_coverage, with_passage.route_coverage),
            (ROUTE_UNCONFIRMED, ROUTE_CONFIRMED),
        )

    def test_rooms_sharing_an_edge_are_not_connected_without_a_passage(self) -> None:
        rooms = [
            room("west", "corridor", rect(0, 0, 20_000, 3_000)),
            room("east", "corridor", rect(20_000, 0, 40_000, 3_000)),
        ]
        exits = [exit_at("a", 0, 1_500), exit_at("b", 40_000, 1_500)]

        without = self.place(rooms, exits)
        with_passage = self.place(rooms, exits, [passage_at("open", 20_000, 1_500)])

        self.assertEqual(without.route_coverage, ROUTE_UNCONFIRMED)
        self.assertEqual(len(without.devices), 2)
        self.assertEqual(with_passage.route_coverage, ROUTE_CONFIRMED)
        self.assertGreater(len(with_passage.devices), 2)

    def test_route_through_a_passage_stays_inside_the_rooms(self) -> None:
        rooms, exits = two_corridors_behind_a_wall()
        outcome = self.place(rooms, exits, [passage_at("door", 20_150, 1_500)])

        checkers = [_inside_checker(item) for item in rooms]
        for device in outcome.devices:
            self.assertTrue(
                any(check(device.x, device.y) for check in checkers),
                f"device {device} is inside no room (in the wall gap)",
            )

    def test_passage_far_from_the_wall_does_not_connect_anything(self) -> None:
        rooms, exits = two_corridors_behind_a_wall()
        passages = [
            passage_at("inside_west", 10_000, 1_500),  # біля одного приміщення
            passage_at("outside", 20_150, 20_000),  # далеко від обох
        ]

        outcome = self.place(rooms, exits, passages)

        self.assertEqual(outcome.route_coverage, ROUTE_UNCONFIRMED)
        self.assertEqual(len(outcome.devices), 2)
        self.assertEqual(outcome.used_passage_ids, [])

    def test_passage_between_other_rooms_does_not_connect_these_ones(self) -> None:
        rooms = [
            room("a", "corridor", rect(0, 0, 20_000, 3_000)),
            room("b", "corridor", rect(20_300, 0, 40_300, 3_000)),
            room("c", "corridor", rect(40_600, 0, 60_600, 3_000)),
        ]
        door_ab = passage_at("ab", 20_150, 1_500)

        a_to_b = self.place(
            rooms, [exit_at("a", 0, 1_500), exit_at("b", 40_300, 1_500)], [door_ab]
        )
        a_to_c = self.place(
            rooms, [exit_at("a", 0, 1_500), exit_at("c", 60_600, 1_500)], [door_ab]
        )

        self.assertEqual(a_to_b.route_coverage, ROUTE_CONFIRMED)
        self.assertEqual(a_to_c.route_coverage, ROUTE_UNCONFIRMED)
        self.assertEqual(a_to_c.unconnected_exit_ids, ["c"])
        self.assertEqual(len(a_to_c.devices), 2)

    def test_chain_of_rooms_is_connected_through_two_passages(self) -> None:
        rooms = [
            room("a", "corridor", rect(0, 0, 20_000, 3_000)),
            room("b", "corridor", rect(20_300, 0, 40_300, 3_000)),
            room("c", "corridor", rect(40_600, 0, 60_600, 3_000)),
        ]
        outcome = self.place(
            rooms,
            [exit_at("a", 0, 1_500), exit_at("c", 60_600, 1_500)],
            [passage_at("ab", 20_150, 1_500), passage_at("bc", 40_450, 1_500)],
        )

        self.assertEqual(outcome.route_coverage, ROUTE_CONFIRMED)
        self.assertEqual(sorted(outcome.used_passage_ids), ["ab", "bc"])
        self.assertTrue(all(gap <= 30_000 for gap in gaps_along_x(outcome.devices)))

    def test_exits_of_the_same_room_need_no_passage(self) -> None:
        corridor, exits = corridor_40m()
        outcome = self.place([corridor], exits)

        self.assertEqual(outcome.route_coverage, ROUTE_CONFIRMED)
        self.assertIsNone(outcome.route_warning)

    def test_single_exit_has_no_route_to_confirm(self) -> None:
        corridor, _ = corridor_40m()
        outcome = self.place([corridor], [exit_at("only", 0, 1_500)])

        self.assertEqual(outcome.status, PLACED)
        self.assertEqual(len(outcome.devices), 1)
        self.assertEqual(outcome.route_coverage, ROUTE_NOT_APPLICABLE)
        self.assertIsNone(outcome.route_warning)

    def test_unconfirmed_route_is_part_of_the_client_status(self) -> None:
        rooms, exits = two_corridors_behind_a_wall()
        described = describe_call_point_outcome(self.place(rooms, exits))

        # status — розміщення біля виходів; route_coverage — окремо шляхи між ними.
        self.assertEqual(described["status"], PLACED)
        self.assertEqual(described["device_count"], 2)
        self.assertEqual(described["route_coverage"], ROUTE_UNCONFIRMED)
        self.assertIn("не підтверджено", described["route_warning"])
        self.assertEqual(described["unconnected_exit_ids"], ["e_east"])
        self.assertEqual(described["unconnected_rooms"], ["east"])
        self.assertIsNone(described["warning"])  # правило перевірене

    def test_confirmed_route_has_no_route_warning_in_the_description(self) -> None:
        rooms, exits = two_corridors_behind_a_wall()
        described = describe_call_point_outcome(
            self.place(rooms, exits, [passage_at("door", 20_150, 1_500)])
        )

        self.assertEqual(described["route_coverage"], ROUTE_CONFIRMED)
        self.assertIsNone(described["route_warning"])
        self.assertEqual(described["unconnected_exit_ids"], [])
        self.assertEqual(described["passage_ids"], ["door"])

    def test_exit_rooms_of_different_types_also_need_a_passage(self) -> None:
        hall = room("hall", "hall", rect(0, 0, 10_000, 10_000))
        office = room("office", "office", rect(10_300, 0, 20_300, 10_000))
        exits = [exit_at("h", 0, 5_000), exit_at("o", 20_300, 5_000)]

        self.assertEqual(
            self.place([hall, office], exits).route_coverage, ROUTE_UNCONFIRMED
        )
        self.assertEqual(
            self.place(
                [hall, office], exits, [passage_at("d", 10_150, 5_000)]
            ).route_coverage,
            ROUTE_CONFIRMED,
        )


class PassageRowsTests(unittest.TestCase):
    def test_rows_without_coordinates_are_skipped(self) -> None:
        passages = passages_from_rows(
            [
                {"id": "p1", "x": 10, "y": 20, "name": "Двері"},
                {"id": "p2", "x": None, "y": 5},
                {"id": "p3", "x": "abc", "y": 5},
                {"id": "p4", "x": "7.5", "y": "8"},
            ]
        )

        self.assertEqual(
            passages,
            [
                CallPointPassage("p1", 10.0, 20.0, "Двері"),
                CallPointPassage("p4", 7.5, 8.0, None),
            ],
        )


class RoomSegmentTests(unittest.TestCase):
    """Відрізок «лежить у приміщенні» перевіряється точно, а не вибіркою точок."""

    # Г-подібне приміщення: вирізаний кут (10..20, 10..20).
    L_SHAPE = room(
        "l", "corridor", ((0, 0), (20, 0), (20, 10), (10, 10), (10, 20), (0, 20))
    )

    def test_segment_inside_and_along_the_wall_is_covered(self) -> None:
        shape = _Room(self.L_SHAPE)
        self.assertTrue(shape.covers_segment((1, 1), (19, 9)))
        self.assertTrue(shape.covers_segment((0, 0), (20, 0)))  # уздовж стіни
        self.assertTrue(shape.covers_segment((1, 19), (9, 1)))

    def test_segment_across_the_notch_is_not_covered(self) -> None:
        shape = _Room(self.L_SHAPE)
        self.assertFalse(shape.covers_segment((19, 9), (9, 19)))  # зрізає виріз
        self.assertFalse(shape.covers_segment((1, 19), (19, 9)))

    def test_segment_touching_a_reflex_corner_from_inside_is_covered(self) -> None:
        shape = _Room(self.L_SHAPE)
        self.assertTrue(shape.covers_segment((5, 15), (15, 5)))  # через кут (10, 10)

    def test_segment_leaving_through_a_thin_wall_is_not_covered(self) -> None:
        wall = room("w", "corridor", ((0, 0), (10, 0), (10, 3), (0, 3)))
        shape = _Room(wall)
        self.assertFalse(shape.covers_segment((5, 1), (14, 1)))  # кінець поза кімнатою


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
