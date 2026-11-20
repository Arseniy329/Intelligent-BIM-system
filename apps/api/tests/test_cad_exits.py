"""BIM-75: пошук евакуаційних виходів у DXF (шар EXITS або підпис «Вихід»)."""

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from typing import Any

API_DIR = Path(__file__).resolve().parent.parent
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

from src.modules.cad.exits import find_exit_points, is_exit_text

MM = 0.001  # креслення в міліметрах
M = 1.0  # креслення в метрах


class FakeEntity:
    """Мінімальна заміна сутності ezdxf: dxftype(), dxf.*, get_points()."""

    def __init__(self, kind: str, layer: str, **attrs: Any) -> None:
        self._kind = kind
        self._points = attrs.pop("points", [])
        self._plain = attrs.pop("plain", None)
        self.vertices = attrs.pop("vertices", [])
        self.start_point = attrs.pop("start_point", None)
        self.end_point = attrs.pop("end_point", None)
        self.dxf = SimpleNamespace(layer=layer, **attrs)

    def dxftype(self) -> str:
        return self._kind

    def get_points(self, format: str = "xy") -> list[tuple[float, float]]:
        return list(self._points)

    def plain_text(self) -> str:
        return self._plain or ""


def door_polyline(layer: str, x0: float, y0: float, x1: float, y1: float) -> FakeEntity:
    return FakeEntity(
        "LWPOLYLINE", layer, points=[(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    )


def text(value: str, x: float, y: float, layer: str = "TEXT") -> FakeEntity:
    return FakeEntity("TEXT", layer, text=value, insert=(x, y, 0.0))


class IsExitTextTests(unittest.TestCase):
    def test_recognises_exit_words(self) -> None:
        for value in ("Вихід", "ВИХІД", "Вихід / Exit", "Выход", "Exit", "Exit 1"):
            with self.subTest(value=value):
                self.assertTrue(is_exit_text(value))

    def test_ignores_words_that_only_contain_it(self) -> None:
        for value in ("Вихідний день", "Входи", "Office", "Кабінет 101", ""):
            with self.subTest(value=value):
                self.assertFalse(is_exit_text(value))


class FindExitPointsTests(unittest.TestCase):
    def test_door_on_exits_layer_is_an_exit(self) -> None:
        msp = [door_polyline("EXITS", 1000, 0, 1900, 100)]
        found = find_exit_points(msp, MM)
        self.assertEqual(len(found), 1)
        self.assertAlmostEqual(found[0].x, 1450)
        self.assertAlmostEqual(found[0].y, 50)
        self.assertEqual(found[0].origin, "layer")

    def test_exits_layer_name_is_case_insensitive_and_ukrainian(self) -> None:
        for layer in ("exits", "A-EXIT-DOOR", "ВИХОДИ_ВИХІД"):
            with self.subTest(layer=layer):
                found = find_exit_points([door_polyline(layer, 0, 0, 900, 100)], MM)
                self.assertEqual(len(found), 1)

    def test_label_next_to_door_marks_the_door(self) -> None:
        msp = [
            door_polyline("DOORS", 1000, 0, 1900, 100),
            text("Вихід", 1400, 800),
        ]
        found = find_exit_points(msp, MM)
        self.assertEqual(len(found), 1)
        self.assertAlmostEqual(found[0].x, 1450)
        self.assertEqual(found[0].name, "Вихід")
        self.assertEqual(found[0].origin, "label")

    def test_mtext_label_is_read_through_plain_text(self) -> None:
        label = FakeEntity(
            "MTEXT", "TEXT", plain="Вихід / Exit\nпожежний", insert=(1400, 800, 0.0)
        )
        msp = [door_polyline("A-DOOR", 1000, 0, 1900, 100), label]
        found = find_exit_points(msp, MM)
        self.assertEqual([item.name for item in found], ["Вихід / Exit"])

    def test_label_without_door_nearby_is_ignored(self) -> None:
        msp = [
            door_polyline("DOORS", 1000, 0, 1900, 100),
            text("Вихід", 9000, 9000),  # далеко від дверей
        ]
        self.assertEqual(find_exit_points(msp, MM), [])

    def test_label_is_matched_in_metres_for_a_metre_drawing(self) -> None:
        msp = [door_polyline("DOORS", 1.0, 0.0, 1.9, 0.1), text("Вихід", 1.4, 0.8)]
        self.assertEqual(len(find_exit_points(msp, M)), 1)
        far = [door_polyline("DOORS", 1.0, 0.0, 1.9, 0.1), text("Вихід", 1.4, 5.0)]
        self.assertEqual(find_exit_points(far, M), [])

    def test_window_with_label_is_not_an_exit(self) -> None:
        msp = [door_polyline("WINDOWS", 1000, 0, 1900, 100), text("Вихід", 1400, 800)]
        self.assertEqual(find_exit_points(msp, MM), [])

    def test_ordinary_doors_without_marking_are_not_exits(self) -> None:
        msp = [door_polyline("DOORS", 1000, 0, 1900, 100), text("Кабінет", 1400, 800)]
        self.assertEqual(find_exit_points(msp, MM), [])

    def test_leaf_and_swing_of_one_door_give_one_exit(self) -> None:
        leaf = FakeEntity("LINE", "EXITS", start=(1000, 0, 0), end=(1000, 900, 0))
        swing = FakeEntity(
            "ARC",
            "EXITS",
            center=(1000, 0, 0),
            start_point=(1000, 900, 0),
            end_point=(1900, 0, 0),
        )
        opening = door_polyline("EXITS", 1000, -50, 1900, 50)
        found = find_exit_points([leaf, swing, opening], MM)
        self.assertEqual(len(found), 1)

    def test_label_and_layer_for_the_same_door_are_merged_with_name(self) -> None:
        msp = [
            door_polyline("EXITS", 1000, 0, 1900, 100),
            text("Вихід", 1400, 800),
        ]
        found = find_exit_points(msp, MM)
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0].name, "Вихід")

    def test_two_distant_doors_give_two_exits(self) -> None:
        msp = [
            door_polyline("EXITS", 1000, 0, 1900, 100),
            door_polyline("EXITS", 20000, 0, 20900, 100),
        ]
        self.assertEqual(len(find_exit_points(msp, MM)), 2)

    def test_insert_block_on_exits_layer_uses_insertion_point(self) -> None:
        block = FakeEntity("INSERT", "EXITS", insert=(5000, 100, 0.0))
        found = find_exit_points([block], MM)
        self.assertEqual((found[0].x, found[0].y), (5000.0, 100.0))

    def test_empty_drawing_has_no_exits(self) -> None:
        self.assertEqual(find_exit_points([], MM), [])

    def test_unknown_scale_falls_back_to_millimetres(self) -> None:
        msp = [door_polyline("DOORS", 1000, 0, 1900, 100), text("Вихід", 1400, 800)]
        self.assertEqual(len(find_exit_points(msp, None)), 1)


if __name__ == "__main__":
    unittest.main()
