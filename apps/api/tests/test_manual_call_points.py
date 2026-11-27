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
    WARNING_EXITS_WITHOUT_ROOM,
    WARNING_PASSAGES_IGNORED,
    WARNING_ROUTE_UNCONFIRMED,
    WARNING_UNVERIFIED,
    CallPointExit,
    CallPointPassage,
    CallPointRoom,
    PlacedCallPoint,
    _Room,
    describe_call_point_outcome,
    passage_at_rooms,
    passage_room_pair,
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


def passage_at(
    passage_id: str,
    x: float,
    y: float,
    first: str | None = None,
    second: str | None = None,
) -> CallPointPassage:
    """Прохід із явною парою приміщень (як підтверджений інженером)."""
    return CallPointPassage(id=passage_id, x=x, y=y, room_a_id=first, room_b_id=second)


def door(
    rooms: list[CallPointRoom], passage_id: str, x: float, y: float
) -> CallPointPassage:
    """Двері з креслення: пару приміщень визначено з геометрії, як під час обробки."""
    pair = passage_room_pair((x, y), rooms, MM)
    assert pair is not None, f"door {passage_id} has no unique pair of rooms"
    return passage_at(passage_id, x, y, *pair)


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

        outcome = self.place(rooms, exits, [door(rooms, "door", 20_150, 1_500)])

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
        with_passage = self.place(rooms, exits, [door(rooms, "door", 20_150, 1_500)])

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
        with_passage = self.place(rooms, exits, [door(rooms, "open", 20_000, 1_500)])

        self.assertEqual(without.route_coverage, ROUTE_UNCONFIRMED)
        self.assertEqual(len(without.devices), 2)
        self.assertEqual(with_passage.route_coverage, ROUTE_CONFIRMED)
        self.assertGreater(len(with_passage.devices), 2)

    def test_route_through_a_passage_stays_inside_the_rooms(self) -> None:
        rooms, exits = two_corridors_behind_a_wall()
        outcome = self.place(rooms, exits, [door(rooms, "door", 20_150, 1_500)])

        checkers = [_inside_checker(item) for item in rooms]
        for device in outcome.devices:
            self.assertTrue(
                any(check(device.x, device.y) for check in checkers),
                f"device {device} is inside no room (in the wall gap)",
            )

    def test_passage_far_from_the_wall_does_not_connect_anything(self) -> None:
        rooms, exits = two_corridors_behind_a_wall()
        # З геометрії пари немає: перша точка всередині одного приміщення, друга далеко.
        self.assertIsNone(passage_room_pair((10_000, 1_500), rooms, MM))
        self.assertIsNone(passage_room_pair((20_150, 20_000), rooms, MM))
        passages = [
            passage_at("inside_west", 10_000, 1_500),
            passage_at("outside", 20_150, 20_000),
            # Навіть із парою прохід далеко від стін обох приміщень нічого не з'єднує.
            passage_at("far_with_pair", 20_150, 20_000, "west", "east"),
        ]

        outcome = self.place(rooms, exits, passages)

        self.assertEqual(outcome.route_coverage, ROUTE_UNCONFIRMED)
        self.assertEqual(len(outcome.devices), 2)
        self.assertEqual(outcome.used_passage_ids, [])
        self.assertEqual(
            outcome.ignored_passage_ids, ["inside_west", "outside", "far_with_pair"]
        )

    def test_passage_between_other_rooms_does_not_connect_these_ones(self) -> None:
        rooms = [
            room("a", "corridor", rect(0, 0, 20_000, 3_000)),
            room("b", "corridor", rect(20_300, 0, 40_300, 3_000)),
            room("c", "corridor", rect(40_600, 0, 60_600, 3_000)),
        ]
        door_ab = door(rooms, "ab", 20_150, 1_500)

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
            [door(rooms, "ab", 20_150, 1_500), door(rooms, "bc", 40_450, 1_500)],
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
            self.place(rooms, exits, [door(rooms, "door", 20_150, 1_500)])
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
                [hall, office], exits, [door([hall, office], "d", 10_150, 5_000)]
            ).route_coverage,
            ROUTE_CONFIRMED,
        )


class PassageBindingTests(unittest.TestCase):
    """Прохід з'єднує рівно свою пару приміщень, а не всі контури біля точки."""

    # Двері A↔B стоять біля кута, де зверху підходить коридор C: усі три контури
    # ближче за 0,8 м до точки дверей. Раніше двері «з'єднували» і C.
    A = room("a", "corridor", rect(0, 0, 20_000, 3_000))
    B = room("b", "corridor", rect(20_300, 0, 40_300, 3_000))
    C = room("c", "corridor", rect(19_800, 3_300, 20_700, 15_000))
    DOOR_AB = (20_150, 2_900)

    def place(
        self,
        rooms: list[CallPointRoom],
        exits: list[CallPointExit],
        passages: list[CallPointPassage],
    ) -> Any:
        return place_manual_call_points(
            rooms=rooms,
            exits=exits,
            rule_rows=[mcp_rule()],
            unit_scale_m=MM,
            passages=passages,
        )

    def three_corridors(self) -> tuple[list[CallPointRoom], list[CallPointExit]]:
        return (
            [self.A, self.B, self.C],
            [
                exit_at("ea", 0, 1_500),
                exit_at("eb", 40_300, 1_500),
                exit_at("ec", 20_250, 15_000),
            ],
        )

    def test_all_three_contours_are_near_the_door(self) -> None:
        # Передумова сценарію: усі три приміщення в допуску проходу (0,8 м).
        for item in (self.A, self.B, self.C):
            self.assertLessEqual(_Room(item).boundary_distance(self.DOOR_AB), 800)

    def test_door_between_a_and_b_gets_exactly_that_pair(self) -> None:
        pair = passage_room_pair(self.DOOR_AB, [self.A, self.B, self.C], MM)

        assert pair is not None
        self.assertEqual(set(pair), {"a", "b"})

    def test_door_a_b_does_not_confirm_the_route_to_c(self) -> None:
        rooms, exits = self.three_corridors()
        passage = door(rooms, "ab", *self.DOOR_AB)

        outcome = self.place(rooms, exits, [passage])

        self.assertEqual(outcome.status, PLACED)
        self.assertEqual(outcome.route_coverage, ROUTE_UNCONFIRMED)
        self.assertEqual(outcome.used_passage_ids, ["ab"])
        self.assertEqual(outcome.ignored_passage_ids, [])
        self.assertEqual(outcome.unconnected_exit_ids, ["ec"])
        self.assertEqual(outcome.unconnected_room_names, ["c"])
        assert outcome.route_warning is not None
        self.assertTrue(outcome.route_warning.startswith(WARNING_ROUTE_UNCONFIRMED))
        self.assertIn("Приміщення: c", outcome.route_warning)
        # Між A і B шлях є (проміжний сповіщувач), до C — лише біля виходу.
        in_c = [d for d in outcome.devices if d.room_id == "c"]
        self.assertEqual([d.exit_id for d in in_c], ["ec"])

    def test_the_api_description_explains_the_unconnected_room(self) -> None:
        rooms, exits = self.three_corridors()
        described = describe_call_point_outcome(
            self.place(rooms, exits, [door(rooms, "ab", *self.DOOR_AB)])
        )

        # Не лише кількість сповіщувачів: статус і пояснення.
        self.assertEqual(described["status"], PLACED)
        self.assertEqual(described["route_coverage"], ROUTE_UNCONFIRMED)
        self.assertEqual(described["unconnected_exit_ids"], ["ec"])
        self.assertEqual(described["unconnected_rooms"], ["c"])
        self.assertEqual(described["passage_ids"], ["ab"])
        self.assertEqual(described["ignored_passage_ids"], [])
        self.assertIn("не підтверджено", described["route_warning"])
        self.assertIn("c", described["route_warning"])

    def test_c_is_connected_only_by_its_own_door(self) -> None:
        rooms, exits = self.three_corridors()
        door_ac = passage_at("ac", 19_900, 3_150, "a", "c")  # підтверджено інженером

        outcome = self.place(rooms, exits, [door(rooms, "ab", *self.DOOR_AB), door_ac])

        self.assertEqual(outcome.route_coverage, ROUTE_CONFIRMED)
        self.assertEqual(sorted(outcome.used_passage_ids), ["ab", "ac"])
        self.assertIsNone(outcome.route_warning)

    def test_door_with_two_possible_pairs_is_not_guessed(self) -> None:
        # Між коридорами A і C — вузька шахта B (0,2 м). Двері в стіні A дивляться
        # і на B, і на C (в допуску 0,8 м): з креслення не видно, яка пара справжня.
        a = room("a", "corridor", rect(0, 0, 20_000, 3_000))
        b = room("b", "corridor", rect(20_300, 0, 20_500, 3_000))
        c = room("c", "corridor", rect(20_800, 0, 40_800, 3_000))
        rooms = [a, b, c]
        exits = [exit_at("ea", 0, 1_500), exit_at("ec", 40_800, 1_500)]

        self.assertIsNone(passage_room_pair((20_150, 1_500), rooms, MM))
        unbound = passage_at("shaft_door", 20_150, 1_500)

        outcome = self.place(rooms, exits, [unbound])

        self.assertEqual(outcome.route_coverage, ROUTE_UNCONFIRMED)
        self.assertEqual(outcome.used_passage_ids, [])
        self.assertEqual(outcome.ignored_passage_ids, ["shaft_door"])
        self.assertEqual(outcome.unconnected_exit_ids, ["ec"])
        assert outcome.route_warning is not None
        self.assertIn(WARNING_PASSAGES_IGNORED, outcome.route_warning)
        self.assertEqual(len(outcome.devices), 2)  # лише біля виходів

        # Інженер підтвердив пару A↔B: з'єднано саме її, шлях до C недоведений.
        confirmed = self.place(
            rooms, exits, [passage_at("shaft_door", 20_150, 1_500, "a", "b")]
        )
        self.assertEqual(confirmed.used_passage_ids, ["shaft_door"])
        self.assertEqual(confirmed.ignored_passage_ids, [])
        self.assertEqual(confirmed.route_coverage, ROUTE_UNCONFIRMED)
        self.assertEqual(confirmed.unconnected_exit_ids, ["ec"])

        # Підтверджена пара A↔C з'єднує їх, і шлях доведено.
        through = self.place(
            rooms, exits, [passage_at("shaft_door", 20_150, 1_500, "a", "c")]
        )
        self.assertEqual(through.route_coverage, ROUTE_CONFIRMED)

    def test_passage_of_a_previous_parse_is_ignored(self) -> None:
        rooms, exits = two_corridors_behind_a_wall()
        # Приміщення зі старої обробки мали інші id: у новому кресленні їх немає.
        stale = passage_at("door", 20_150, 1_500, "old_west", "old_east")

        outcome = self.place(rooms, exits, [stale])

        self.assertEqual(outcome.route_coverage, ROUTE_UNCONFIRMED)
        self.assertEqual(outcome.used_passage_ids, [])
        self.assertEqual(outcome.ignored_passage_ids, ["door"])
        self.assertEqual(len(outcome.devices), 2)
        assert outcome.route_warning is not None
        self.assertIn(WARNING_PASSAGES_IGNORED, outcome.route_warning)

    def test_passage_whose_walls_moved_away_is_ignored(self) -> None:
        rooms, exits = two_corridors_behind_a_wall()
        passage = passage_at("door", 20_150, 1_500, "west", "east")
        # Інженер змінив контур: східний коридор відсунуто, двері лишились на місці.
        moved = [rooms[0], room("east", "corridor", rect(25_000, 0, 45_000, 3_000))]

        before = self.place(rooms, exits, [passage])
        after = self.place(
            moved, [exits[0], exit_at("e_east", 45_000, 1_500)], [passage]
        )

        self.assertEqual(before.route_coverage, ROUTE_CONFIRMED)
        self.assertEqual(after.route_coverage, ROUTE_UNCONFIRMED)
        self.assertEqual(after.ignored_passage_ids, ["door"])

    def test_passage_between_rooms_off_the_route_is_neither_used_nor_ignored(
        self,
    ) -> None:
        rooms, exits = two_corridors_behind_a_wall()
        office_a = room("office_a", "office", rect(0, 3_300, 10_000, 8_000))
        office_b = room("office_b", "office", rect(0, 8_300, 10_000, 12_000))
        everything = [*rooms, office_a, office_b]
        passage = door(everything, "office_door", 5_000, 8_150)

        outcome = self.place(everything, exits, [passage])

        self.assertEqual(outcome.used_passage_ids, [])
        self.assertEqual(outcome.ignored_passage_ids, [])
        self.assertEqual(outcome.route_coverage, ROUTE_UNCONFIRMED)

    def test_a_room_around_the_corner_does_not_hide_the_real_pair(self) -> None:
        # Без допуску на кут пара була б визначена лише для сусіднього контуру.
        rooms = [self.A, self.B, self.C]
        for x, y in ((20_150, 2_900), (20_150, 1_500), (20_150, 100)):
            pair = passage_room_pair((x, y), rooms, MM)
            assert pair is not None, (x, y)
            self.assertEqual(set(pair), {"a", "b"}, (x, y))

    def test_no_pair_without_a_wall_between_two_rooms(self) -> None:
        rooms = [self.A, self.B]
        # Усередині одного приміщення, далеко від стін і поза всіма приміщеннями.
        for point in ((10_000, 1_500), (20_150, 50_000), (-5_000, -5_000)):
            self.assertIsNone(passage_room_pair(point, rooms, MM), point)
        # Лише одне приміщення біля точки: другого боку немає.
        self.assertIsNone(passage_room_pair((100, 1_500), rooms, MM))

    def test_rooms_sharing_an_edge_get_a_pair_at_the_shared_wall(self) -> None:
        rooms = [
            room("west", "corridor", rect(0, 0, 20_000, 3_000)),
            room("east", "corridor", rect(20_000, 0, 40_000, 3_000)),
        ]
        pair = passage_room_pair((20_000, 1_500), rooms, MM)

        assert pair is not None
        self.assertEqual(set(pair), {"west", "east"})

    def test_pair_is_independent_of_the_room_order(self) -> None:
        rooms = [self.A, self.B, self.C]
        forward = passage_room_pair(self.DOOR_AB, rooms, MM)
        backward = passage_room_pair(self.DOOR_AB, list(reversed(rooms)), MM)

        assert forward is not None and backward is not None
        self.assertEqual(set(forward), set(backward))


class ConfirmedPairTests(unittest.TestCase):
    """Пара, яку називає інженер: обидва приміщення існують і стіна біля проходу."""

    def test_existing_distinct_rooms_at_the_wall_are_accepted(self) -> None:
        rooms, _ = two_corridors_behind_a_wall()
        self.assertTrue(passage_at_rooms((20_150, 1_500), ("west", "east"), rooms, MM))

    def test_same_missing_or_far_rooms_are_rejected(self) -> None:
        rooms, _ = two_corridors_behind_a_wall()
        point = (20_150, 1_500)
        self.assertFalse(passage_at_rooms(point, ("west", "west"), rooms, MM))
        self.assertFalse(passage_at_rooms(point, ("west", "nowhere"), rooms, MM))
        self.assertFalse(
            passage_at_rooms((20_150, 50_000), ("west", "east"), rooms, MM)
        )


class ExitsWithoutARoomTests(unittest.TestCase):
    """Вихід поза приміщеннями не лишається непоміченим у загальному статусі."""

    def place(self, rooms: list[CallPointRoom], exits: list[CallPointExit]) -> Any:
        return place_manual_call_points(
            rooms=rooms, exits=exits, rule_rows=[mcp_rule()], unit_scale_m=MM
        )

    def test_two_linked_exits_and_a_third_outside_any_room_are_not_confirmed(
        self,
    ) -> None:
        corridor, exits = corridor_40m()
        ghost = CallPointExit("ghost", 500_000, 500_000, "Запасний вихід")

        outcome = self.place([corridor], [*exits, ghost])

        self.assertEqual(outcome.status, PLACED)
        self.assertEqual(outcome.skipped_exit_ids, ["ghost"])
        self.assertEqual(outcome.used_exit_ids, ["e1", "e2"])
        # Два виходи з'єднані, але шлях до третього не перевірено.
        self.assertEqual(outcome.route_coverage, ROUTE_UNCONFIRMED)
        self.assertEqual(outcome.unconnected_exit_ids, ["ghost"])
        self.assertEqual(outcome.skipped_exit_names, ["Запасний вихід"])
        assert outcome.route_warning is not None
        self.assertIn(WARNING_EXITS_WITHOUT_ROOM, outcome.route_warning)
        self.assertIn("Запасний вихід", outcome.route_warning)

    def test_the_api_description_says_which_exit_is_not_confirmed(self) -> None:
        corridor, exits = corridor_40m()
        ghost = CallPointExit("ghost", 500_000, 500_000)

        described = describe_call_point_outcome(self.place([corridor], [*exits, ghost]))

        self.assertEqual(described["route_coverage"], ROUTE_UNCONFIRMED)
        self.assertEqual(described["skipped_exit_ids"], ["ghost"])
        self.assertEqual(described["skipped_exit_names"], ["ghost"])
        self.assertEqual(described["unconnected_exit_ids"], ["ghost"])
        self.assertIn(WARNING_EXITS_WITHOUT_ROOM, described["route_warning"])
        self.assertEqual(described["exit_ids"], ["e1", "e2"])

    def test_one_placed_exit_and_one_outside_is_unconfirmed_not_not_applicable(
        self,
    ) -> None:
        corridor, _ = corridor_40m()
        ghost = CallPointExit("ghost", 500_000, 500_000)

        outcome = self.place([corridor], [exit_at("only", 0, 1_500), ghost])

        self.assertEqual(outcome.status, PLACED)
        self.assertEqual(outcome.route_coverage, ROUTE_UNCONFIRMED)
        self.assertEqual(outcome.unconnected_exit_ids, ["ghost"])

    def test_a_disconnected_room_and_an_outside_exit_are_both_reported(self) -> None:
        rooms, exits = two_corridors_behind_a_wall()
        ghost = CallPointExit("ghost", 500_000, 500_000)

        outcome = self.place(rooms, [*exits, ghost])

        self.assertEqual(outcome.route_coverage, ROUTE_UNCONFIRMED)
        self.assertEqual(outcome.unconnected_exit_ids, ["e_east", "ghost"])
        assert outcome.route_warning is not None
        self.assertIn(WARNING_ROUTE_UNCONFIRMED, outcome.route_warning)
        self.assertIn(WARNING_EXITS_WITHOUT_ROOM, outcome.route_warning)

    def test_all_exits_connected_and_inside_rooms_stay_confirmed(self) -> None:
        corridor, exits = corridor_40m()
        outcome = self.place([corridor], exits)

        self.assertEqual(outcome.skipped_exit_ids, [])
        self.assertEqual(outcome.route_coverage, ROUTE_CONFIRMED)
        self.assertIsNone(outcome.route_warning)


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

    def test_room_pair_is_read_and_a_missing_one_stays_empty(self) -> None:
        passages = passages_from_rows(
            [
                {"id": "p1", "x": 1, "y": 2, "room_a_id": "ra", "room_b_id": "rb"},
                {"id": "p2", "x": 1, "y": 2, "room_a_id": None, "room_b_id": None},
                {"id": "p3", "x": 1, "y": 2},
            ]
        )

        self.assertEqual(
            [(p.room_a_id, p.room_b_id) for p in passages],
            [("ra", "rb"), (None, None), (None, None)],
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
