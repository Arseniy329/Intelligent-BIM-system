"""BIM-75: API виходів і проходів, збереження з DXF та ручні сповіщувачі в /place."""

import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any
from unittest.mock import patch
from uuid import uuid4

import ezdxf
from fastapi.testclient import TestClient

API_DIR = Path(__file__).resolve().parent.parent
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

from src.core.auth import CurrentUser, get_current_user
from src.infrastructure.supabase import get_supabase_client
from src.main import app
from src.modules.drawings.router import (
    EXIT_DETECTION_FAILED,
    EXIT_DETECTION_OK,
    WARNING_EXIT_DETECTION_FAILED,
    _save_dxf_layout,
)
from tests.fakes import FakeTable, fake_replace_dxf_layout, fake_supabase


def rect_mm(x0: float, y0: float, x1: float, y1: float) -> list[dict[str, float]]:
    return [
        {"x": x0, "y": y0},
        {"x": x1, "y": y0},
        {"x": x1, "y": y1},
        {"x": x0, "y": y1},
    ]


def call_point_rule(
    code: str, value: float, status: str = "verified"
) -> dict[str, Any]:
    return {
        "id": str(uuid4()),
        "rule_id": code,
        "name": code,
        "device_type": "manual_call_point",
        "value_kind": "max_grid_spacing_m",
        "room_types": [],
        "min_height_m": None,
        "max_height_m": None,
        "value": value,
        "conditions": {"exit_offset_m": 1.0},
        "document": "ДСТУ EN 54-14:2021",
        "clause": "п. 6.6",
        "verification_status": status,
    }


class ExitsTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.user_id = str(uuid4())
        self.drawing_id = str(uuid4())
        self.room_id = str(uuid4())
        self.current_user = CurrentUser(id=self.user_id, role="engineer")

        # Коридор 40 × 3 м (креслення в мм) висотою 3 м.
        self.room_row: dict[str, Any] = {
            "id": self.room_id,
            "drawing_id": self.drawing_id,
            "name": "Main_Corridor",
            "type": "corridor",
            "height": 3.0,
            "area": 120.0,
            "polygon": rect_mm(0, 0, 40_000, 3_000),
            "source": "auto",
        }
        self.rooms_table = FakeTable([self.room_row])
        self.exits_table = FakeTable([])
        self.passages_table = FakeTable([])
        self.drawings_table = FakeTable(
            [
                {
                    "id": self.drawing_id,
                    "owner_id": self.user_id,
                    "units": "mm",
                    "unit_scale_m": 0.001,
                    "status": "processing",
                }
            ]
        )
        self.devices_table = FakeTable([])
        self.dstu_rule = call_point_rule("MANUAL_CALL_POINT_SPACING_DSTU", 30.0)
        self.dbn_rule = call_point_rule("MANUAL_CALL_POINT_SPACING_DBN", 50.0)
        self.smoke_rule = {
            "id": str(uuid4()),
            "rule_id": "SMOKE_GRID_HEIGHT_3_5",
            "name": "smoke",
            "device_type": "smoke_detector",
            "value_kind": "max_grid_spacing_m",
            "room_types": [],
            "min_height_m": None,
            "max_height_m": 3.5,
            "value": 9.0,
            "conditions": {"max_protected_area_m2": 80},
            "verification_status": "verified",
        }
        self.rules_table = FakeTable([self.smoke_rule, self.dstu_rule, self.dbn_rule])
        self.tables = {
            "rooms": self.rooms_table,
            "room_zones": FakeTable([]),
            "exits": self.exits_table,
            "passages": self.passages_table,
            "drawings": self.drawings_table,
            "devices": self.devices_table,
            "rules": self.rules_table,
        }
        self.supabase = fake_supabase(
            self.tables,
            rpc={"replace_dxf_layout": fake_replace_dxf_layout(self.tables)},
        )

        app.dependency_overrides[get_current_user] = lambda: self.current_user
        app.dependency_overrides[get_supabase_client] = lambda: self.supabase
        self.client = TestClient(app)

    def tearDown(self) -> None:
        app.dependency_overrides.clear()

    def add_exit(
        self,
        x: float,
        y: float,
        source: str = "dxf",
        created_at: str = "2026-11-20T10:00:00+00:00",
    ) -> dict[str, Any]:
        row = {
            "id": str(uuid4()),
            "drawing_id": self.drawing_id,
            "room_id": self.room_id,
            "name": None,
            "x": x,
            "y": y,
            "source": source,
            "created_at": created_at,
        }
        self.exits_table.rows.append(row)
        return row

    def add_passage(
        self,
        x: float,
        y: float,
        source: str = "manual",
        created_at: str = "2026-11-20T10:00:00+00:00",
    ) -> dict[str, Any]:
        row = {
            "id": str(uuid4()),
            "drawing_id": self.drawing_id,
            "name": None,
            "x": x,
            "y": y,
            "source": source,
            "created_at": created_at,
        }
        self.passages_table.rows.append(row)
        return row


class TestExitsApi(ExitsTestCase):
    def test_engineer_marks_a_door_as_an_exit(self) -> None:
        response = self.client.post(
            f"/api/v1/drawings/{self.drawing_id}/exits",
            json={"position": {"x": 0, "y": 1_500}, "name": "Вихід 1"},
        )

        self.assertEqual(response.status_code, 201, response.text)
        body = response.json()
        self.assertEqual(body["source"], "manual")
        self.assertEqual(body["roomId"], self.room_id)
        self.assertEqual(body["position"], {"x": 0.0, "y": 1_500.0})
        self.assertEqual(body["name"], "Вихід 1")
        self.assertEqual(body["drawingId"], self.drawing_id)
        (stored,) = self.exits_table.rows
        self.assertEqual(stored["source"], "manual")
        self.assertEqual(stored["room_id"], self.room_id)

    def test_exit_far_from_rooms_is_saved_without_a_room(self) -> None:
        response = self.client.post(
            f"/api/v1/drawings/{self.drawing_id}/exits",
            json={"position": {"x": 900_000, "y": 900_000}},
        )

        self.assertEqual(response.status_code, 201, response.text)
        self.assertIsNone(response.json()["roomId"])

    def test_list_returns_exits_from_dxf_and_manual_ones(self) -> None:
        self.add_exit(0, 1_500, "dxf", "2026-11-20T10:00:00+00:00")
        self.add_exit(40_000, 1_500, "manual", "2026-11-20T11:00:00+00:00")
        other = {**self.exits_table.rows[0], "id": str(uuid4()), "drawing_id": "x"}
        self.exits_table.rows.append(other)

        response = self.client.get(f"/api/v1/drawings/{self.drawing_id}/exits")

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(
            [(e["source"], e["position"]["x"]) for e in response.json()],
            [("dxf", 0.0), ("manual", 40_000.0)],
        )

    def test_invalid_body_is_rejected(self) -> None:
        url = f"/api/v1/drawings/{self.drawing_id}/exits"
        for payload in (
            {},
            {"position": {"x": 1}},
            {"position": {"x": 1, "y": 2}, "a": 1},
        ):
            with self.subTest(payload=payload):
                self.assertEqual(self.client.post(url, json=payload).status_code, 422)
        self.assertEqual(self.exits_table.rows, [])

    def test_unknown_drawing_is_404(self) -> None:
        response = self.client.get(f"/api/v1/drawings/{uuid4()}/exits")
        self.assertEqual(response.status_code, 404)

    def test_foreign_drawing_is_403(self) -> None:
        self.drawings_table.rows[0]["owner_id"] = str(uuid4())
        url = f"/api/v1/drawings/{self.drawing_id}/exits"

        self.assertEqual(self.client.get(url).status_code, 403)
        body = {"position": {"x": 0, "y": 0}}
        self.assertEqual(self.client.post(url, json=body).status_code, 403)
        self.assertEqual(self.exits_table.rows, [])

    def test_delete_exit(self) -> None:
        exit_row = self.add_exit(0, 1_500)

        response = self.client.delete(f"/api/v1/exits/{exit_row['id']}")

        self.assertEqual(response.status_code, 204)
        self.assertEqual(self.exits_table.rows, [])
        self.assertEqual(
            self.client.delete(f"/api/v1/exits/{exit_row['id']}").status_code, 404
        )

    def test_delete_foreign_exit_is_403(self) -> None:
        exit_row = self.add_exit(0, 1_500)
        self.drawings_table.rows[0]["owner_id"] = str(uuid4())

        response = self.client.delete(f"/api/v1/exits/{exit_row['id']}")

        self.assertEqual(response.status_code, 403)
        self.assertEqual(len(self.exits_table.rows), 1)


class TestPlaceManualCallPoints(ExitsTestCase):
    def place(self) -> Any:
        with patch(
            "src.modules.drawings.router.generate_and_upload_result_dxf",
            return_value="result.dxf",
        ):
            return self.client.post(f"/api/v1/drawings/{self.drawing_id}/place")

    def call_point_rows(self) -> list[dict[str, Any]]:
        return [
            row
            for row in self.devices_table.inserts
            if row["type"] == "manual_call_point"
        ]

    def test_no_exits_means_no_manual_call_points_and_a_message(self) -> None:
        response = self.place()

        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()["manual_call_points"]
        self.assertEqual(result["status"], "insufficient_data")
        self.assertEqual(result["reason"], "Позначте евакуаційні виходи")
        self.assertEqual(result["device_count"], 0)
        self.assertEqual(self.call_point_rows(), [])
        # Автоматичні сповіщувачі розміщуються як і раніше.
        (placement,) = response.json()["placements"]
        self.assertEqual(placement["status"], "placed")
        self.assertTrue(
            any(r["type"] == "smoke_detector" for r in self.devices_table.inserts)
        )

    def test_manual_call_points_at_exits_and_along_the_corridor(self) -> None:
        self.add_exit(0, 1_500, "dxf")
        self.add_exit(40_000, 1_500, "manual")

        response = self.place()

        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()["manual_call_points"]
        self.assertEqual(result["status"], "placed")
        self.assertEqual(result["device_count"], 3)
        self.assertEqual(result["rule"]["rule_id"], "MANUAL_CALL_POINT_SPACING_DSTU")
        self.assertEqual(result["rule"]["max_spacing_m"], 30.0)
        self.assertEqual(
            [r["rule_id"] for r in result["alternative_rules"]],
            ["MANUAL_CALL_POINT_SPACING_DBN"],
        )

        rows = self.call_point_rows()
        self.assertEqual(len(rows), 3)
        for row in rows:
            self.assertEqual(row["layer"], "SYS_FIRE_MCP")
            self.assertEqual(row["rule_id"], self.dstu_rule["id"])
            self.assertEqual(row["room_id"], self.room_id)
            self.assertEqual(row["drawing_id"], self.drawing_id)
        xs = sorted(row["x"] for row in rows)
        self.assertTrue(all(b - a <= 30_000 for a, b in zip(xs, xs[1:], strict=False)))

    def test_spacing_is_read_from_the_rules_table(self) -> None:
        self.add_exit(0, 1_500)
        self.add_exit(40_000, 1_500)
        self.dstu_rule["value"] = 10.0

        response = self.place()

        self.assertEqual(response.json()["manual_call_points"]["device_count"], 5)
        xs = sorted(row["x"] for row in self.call_point_rows())
        self.assertTrue(all(b - a <= 10_000 for a, b in zip(xs, xs[1:], strict=False)))

    def test_unverified_rule_is_flagged_in_the_result(self) -> None:
        self.add_exit(0, 1_500)
        self.dstu_rule["verification_status"] = "needs_review"

        result = self.place().json()["manual_call_points"]

        self.assertEqual(result["status"], "placed")
        self.assertEqual(result["warning"], "Розміщено за неперевіреним правилом")
        self.assertEqual(result["rule"]["verification_status"], "needs_review")

    def test_replacing_placement_removes_old_manual_call_points(self) -> None:
        self.add_exit(0, 1_500)
        self.devices_table.rows.append(
            {
                "id": str(uuid4()),
                "drawing_id": self.drawing_id,
                "type": "manual_call_point",
            }
        )

        self.place()

        self.assertEqual(len(self.devices_table.deleted), 1)

    def test_no_manual_call_point_rule_gives_a_reason(self) -> None:
        self.add_exit(0, 1_500)
        self.rules_table.rows[:] = [self.smoke_rule]

        result = self.place().json()["manual_call_points"]

        self.assertEqual(result["status"], "insufficient_data")
        self.assertEqual(result["reason"], "Немає правила для ручних сповіщувачів")
        self.assertEqual(self.call_point_rows(), [])


class TestPassagesApi(ExitsTestCase):
    def test_engineer_confirms_a_passage(self) -> None:
        response = self.client.post(
            f"/api/v1/drawings/{self.drawing_id}/passages",
            json={"position": {"x": 20_150, "y": 1_500}, "name": " Двері 1 "},
        )

        self.assertEqual(response.status_code, 201, response.text)
        body = response.json()
        self.assertEqual(body["source"], "manual")
        self.assertEqual(body["name"], "Двері 1")
        self.assertEqual(body["position"], {"x": 20_150, "y": 1_500})
        self.assertEqual(self.passages_table.rows[0]["source"], "manual")

    def test_list_returns_dxf_and_manual_passages(self) -> None:
        self.add_passage(1, 1, "dxf", "2026-11-20T10:00:00+00:00")
        self.add_passage(2, 2, "manual", "2026-11-20T11:00:00+00:00")

        response = self.client.get(f"/api/v1/drawings/{self.drawing_id}/passages")

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(
            [(item["position"]["x"], item["source"]) for item in response.json()],
            [(1.0, "dxf"), (2.0, "manual")],
        )

    def test_invalid_body_is_rejected(self) -> None:
        url = f"/api/v1/drawings/{self.drawing_id}/passages"
        for body in (
            {},
            {"position": {"x": 1}},
            {"position": {"x": 1, "y": 2}, "z": 1},
        ):
            with self.subTest(body=body):
                self.assertEqual(self.client.post(url, json=body).status_code, 422)

    def test_unknown_and_foreign_drawing(self) -> None:
        self.assertEqual(
            self.client.get(f"/api/v1/drawings/{uuid4()}/passages").status_code, 404
        )
        self.drawings_table.rows[0]["owner_id"] = str(uuid4())
        self.assertEqual(
            self.client.get(f"/api/v1/drawings/{self.drawing_id}/passages").status_code,
            403,
        )

    def test_delete_passage(self) -> None:
        passage = self.add_passage(5, 5)

        response = self.client.delete(f"/api/v1/passages/{passage['id']}")

        self.assertEqual(response.status_code, 204)
        self.assertEqual(self.passages_table.rows, [])
        self.assertEqual(
            self.client.delete(f"/api/v1/passages/{passage['id']}").status_code, 404
        )

    def test_delete_foreign_passage_is_403(self) -> None:
        passage = self.add_passage(5, 5)
        self.drawings_table.rows[0]["owner_id"] = str(uuid4())

        response = self.client.delete(f"/api/v1/passages/{passage['id']}")

        self.assertEqual(response.status_code, 403)
        self.assertEqual(len(self.passages_table.rows), 1)


class TestPlaceRouteNeedsPassage(ExitsTestCase):
    """Два коридори з однаковими контурами: різниця лише в підтвердженому проході."""

    def setUp(self) -> None:
        super().setUp()
        # Східний коридор через суцільну стіну 0,3 м від західного (рядок rooms
        # setUp-а — західний коридор 0..40 м; звужуємо його до 0..20 м).
        self.room_row["polygon"] = rect_mm(0, 0, 20_000, 3_000)
        self.east_id = str(uuid4())
        self.rooms_table.rows.append(
            {
                "id": self.east_id,
                "drawing_id": self.drawing_id,
                "name": "East_Corridor",
                "type": "corridor",
                "height": 3.0,
                "area": 60.0,
                "polygon": rect_mm(20_300, 0, 40_300, 3_000),
                "source": "auto",
            }
        )
        self.add_exit(0, 1_500, "dxf")
        self.add_exit(40_300, 1_500, "manual")

    def place(self) -> dict[str, Any]:
        with patch(
            "src.modules.drawings.router.generate_and_upload_result_dxf",
            return_value="result.dxf",
        ):
            response = self.client.post(f"/api/v1/drawings/{self.drawing_id}/place")
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["manual_call_points"]

    def test_without_a_passage_only_exit_devices_and_a_visible_warning(self) -> None:
        result = self.place()

        # Розміщення біля виходів не скасовано, але клієнт бачить, що шлях не доведено.
        self.assertEqual(result["status"], "placed")
        self.assertEqual(result["device_count"], 2)
        self.assertEqual(result["route_coverage"], "unconfirmed")
        self.assertIn("не підтверджено", result["route_warning"])
        self.assertIn("East_Corridor", result["route_warning"])
        self.assertEqual(len(result["unconnected_exit_ids"]), 1)
        self.assertEqual(result["unconnected_rooms"], ["East_Corridor"])
        self.assertEqual(result["passage_ids"], [])
        rows = [
            r for r in self.devices_table.inserts if r["type"] == "manual_call_point"
        ]
        self.assertEqual(len(rows), 2)

    def test_manual_passage_confirms_the_route(self) -> None:
        passage = self.add_passage(20_150, 1_500, "manual")

        result = self.place()

        self.assertEqual(result["status"], "placed")
        self.assertEqual(result["route_coverage"], "confirmed")
        self.assertIsNone(result["route_warning"])
        self.assertEqual(result["passage_ids"], [passage["id"]])
        self.assertGreater(result["device_count"], 2)
        rows = [
            r for r in self.devices_table.inserts if r["type"] == "manual_call_point"
        ]
        xs = sorted(row["x"] for row in rows)
        self.assertTrue(all(b - a <= 30_000 for a, b in zip(xs, xs[1:], strict=False)))

    def test_passage_from_the_dxf_confirms_the_route_too(self) -> None:
        self.add_passage(20_150, 1_500, "dxf")

        self.assertEqual(self.place()["route_coverage"], "confirmed")

    def test_removing_the_passage_brings_the_warning_back(self) -> None:
        passage = self.add_passage(20_150, 1_500, "manual")
        self.assertEqual(self.place()["route_coverage"], "confirmed")

        self.client.delete(f"/api/v1/passages/{passage['id']}")

        self.assertEqual(self.place()["route_coverage"], "unconfirmed")


class TestSaveLayoutFromDxf(ExitsTestCase):
    """Обробка креслення: виходи й проходи з DXF зберігаються атомарно."""

    def make_dxf(self, directory: Path) -> Path:
        doc = ezdxf.new("R2010")
        doc.layers.add("EXITS")
        doc.layers.add("DOORS")
        msp = doc.modelspace()
        # Двері на шарі EXITS у лівій стіні коридору.
        msp.add_lwpolyline(
            [(-100, 1_000), (100, 1_000), (100, 2_000), (-100, 2_000)],
            close=True,
            dxfattribs={"layer": "EXITS"},
        )
        # Звичайні двері з підписом «Вихід» у правій стіні.
        msp.add_lwpolyline(
            [(39_900, 1_000), (40_100, 1_000), (40_100, 2_000), (39_900, 2_000)],
            close=True,
            dxfattribs={"layer": "DOORS"},
        )
        msp.add_text("Вихід", dxfattribs={"layer": "TEXT", "insert": (39_000, 1_400)})
        # Двері без позначки не є виходом: це прохід між приміщеннями.
        msp.add_lwpolyline(
            [(20_000, -100), (20_900, -100), (20_900, 100), (20_000, 100)],
            close=True,
            dxfattribs={"layer": "DOORS"},
        )
        path = directory / "plan.dxf"
        doc.saveas(str(path))
        return path

    def save(self, path: Path) -> dict[str, Any]:
        return _save_dxf_layout(
            self.supabase, self.drawing_id, path, 0.001, [self.room_row]
        )

    def test_exits_and_doors_from_the_dxf_are_saved(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            state = self.save(self.make_dxf(Path(tmp)))

        self.assertEqual(
            state,
            {"status": EXIT_DETECTION_OK, "exits": 2, "passages": 1, "warning": None},
        )
        rows = self.exits_table.rows
        self.assertEqual(len(rows), 2)
        self.assertTrue(all(row["source"] == "dxf" for row in rows))
        self.assertTrue(all(row["room_id"] == self.room_id for row in rows))
        self.assertEqual(sorted(round(row["x"]) for row in rows), [0, 40_000])
        self.assertIn("Вихід", {row["name"] for row in rows})
        # Двері-виходи не стають проходами між приміщеннями.
        (passage,) = self.passages_table.rows
        self.assertEqual(passage["source"], "dxf")
        self.assertEqual((round(passage["x"]), round(passage["y"])), (20_450, 0))

    def test_reprocessing_replaces_dxf_rows_and_keeps_manual_ones(self) -> None:
        stale = self.add_exit(12_345, 1_500, "dxf")
        manual = self.add_exit(20_000, 0, "manual")
        manual["room_id"] = None  # приміщення створені заново — зв'язок втрачено
        stale_passage = self.add_passage(1, 1, "dxf")
        manual_passage = self.add_passage(2, 2, "manual")

        with tempfile.TemporaryDirectory() as tmp:
            self.save(self.make_dxf(Path(tmp)))

        ids = {row["id"] for row in self.exits_table.rows}
        self.assertNotIn(stale["id"], ids)
        self.assertIn(manual["id"], ids)
        self.assertEqual(manual["room_id"], self.room_id)
        self.assertEqual(len(self.exits_table.rows), 3)
        passage_ids = {row["id"] for row in self.passages_table.rows}
        self.assertNotIn(stale_passage["id"], passage_ids)
        self.assertIn(manual_passage["id"], passage_ids)
        self.assertEqual(len(self.passages_table.rows), 2)

    def test_unreadable_dxf_keeps_previous_rows_and_reports_the_failure(self) -> None:
        previous = self.add_exit(12_345, 1_500, "dxf")

        with tempfile.TemporaryDirectory() as tmp:
            state = self.save(Path(tmp) / "missing.dxf")

        self.assertEqual(state["status"], EXIT_DETECTION_FAILED)
        self.assertEqual(state["warning"], WARNING_EXIT_DETECTION_FAILED)
        self.assertEqual([row["id"] for row in self.exits_table.rows], [previous["id"]])

    def test_failed_write_keeps_the_previous_set_and_shows_a_warning(self) -> None:
        """Збій під час запису не стирає раніше знайдені виходи й проходи."""
        old_exit = self.add_exit(12_345, 1_500, "dxf")
        old_passage = self.add_passage(7, 7, "dxf")
        manual = self.add_exit(20_000, 0, "manual")
        before_exits = [dict(row) for row in self.exits_table.rows]
        before_passages = [dict(row) for row in self.passages_table.rows]
        self.supabase = fake_supabase(
            self.tables,
            rpc={
                "replace_dxf_layout": fake_replace_dxf_layout(
                    self.tables, fail_after_delete=True
                )
            },
        )

        with tempfile.TemporaryDirectory() as tmp:
            state = self.save(self.make_dxf(Path(tmp)))

        # Крок позначено збійним, причина видима в стані (його віддає /process).
        self.assertEqual(state["status"], EXIT_DETECTION_FAILED)
        self.assertEqual(state["warning"], WARNING_EXIT_DETECTION_FAILED)
        self.assertIsNone(state["exits"])
        # Попередній набір цілий: і знайдені раніше, і ручні.
        self.assertEqual(self.exits_table.rows, before_exits)
        self.assertEqual(self.passages_table.rows, before_passages)
        self.assertIn(old_exit["id"], {row["id"] for row in self.exits_table.rows})
        self.assertIn(
            old_passage["id"], {row["id"] for row in self.passages_table.rows}
        )
        self.assertIn(manual["id"], {row["id"] for row in self.exits_table.rows})

    def test_python_never_deletes_or_inserts_exits_outside_the_database_function(
        self,
    ) -> None:
        self.add_exit(12_345, 1_500, "dxf")

        with tempfile.TemporaryDirectory() as tmp:
            self.save(self.make_dxf(Path(tmp)))

        # Заміна — тільки через replace_dxf_layout (одна транзакція), без окремих
        # delete/insert, між якими збій стирав би виходи.
        self.assertEqual(self.exits_table.deleted, [])
        self.assertEqual(self.exits_table.inserts, [])
        self.assertEqual(self.passages_table.deleted, [])
        self.assertEqual(self.passages_table.inserts, [])

    def test_missing_database_function_is_reported_not_swallowed(self) -> None:
        """Міграція 014 не застосована: крок помічено збійним, дані не чіпали."""
        previous = self.add_exit(12_345, 1_500, "dxf")
        self.supabase = fake_supabase(self.tables, rpc={})

        with tempfile.TemporaryDirectory() as tmp:
            state = self.save(self.make_dxf(Path(tmp)))

        self.assertEqual(state["status"], EXIT_DETECTION_FAILED)
        self.assertEqual([row["id"] for row in self.exits_table.rows], [previous["id"]])


if __name__ == "__main__":
    unittest.main()
