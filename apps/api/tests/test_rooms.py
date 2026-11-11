import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any
from uuid import uuid4

import ezdxf
from fastapi.testclient import TestClient

API_DIR = Path(__file__).resolve().parent.parent
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

from src.core.auth import CurrentUser, get_current_user
from src.infrastructure.supabase import get_supabase_client
from src.main import app
from src.modules.cad.parser import parse_dxf_rooms
from src.modules.rooms.service import (
    UNKNOWN_ROOM_TYPE,
    get_room_types,
    room_type_exists,
    suggest_room_type,
)
from tests.fakes import FakeTable, fake_supabase

FIXTURES_DIR = API_DIR / "tests" / "fixtures" / "test_drawing_dxf"


class TestRoomTypeCatalog(unittest.TestCase):
    def test_catalog_loads_with_unique_codes_and_unknown(self) -> None:
        codes = [room_type.code for room_type in get_room_types()]
        self.assertEqual(len(codes), len(set(codes)))
        self.assertIn(UNKNOWN_ROOM_TYPE, codes)
        # Must match the room_types used by the rule catalog (005_rule_catalog.sql).
        self.assertIn("sleeping_room", codes)

    def test_generic_room_word_is_not_an_example(self) -> None:
        examples = {
            example.casefold()
            for room_type in get_room_types()
            for example in room_type.examples
        }
        self.assertNotIn("room", examples)

    def test_room_type_exists(self) -> None:
        self.assertTrue(room_type_exists("kitchen"))
        self.assertFalse(room_type_exists("spaceship"))


class TestSuggestRoomType(unittest.TestCase):
    def test_exact_examples(self) -> None:
        cases = {
            "Kitchen": "kitchen",
            "Corridor": "corridor",
            "Office": "office",
            "Кухня": "kitchen",
            "Коридор": "corridor",
            "WC": "restroom",
        }
        for name, expected in cases.items():
            with self.subTest(name=name):
                self.assertEqual(suggest_room_type(name), expected)

    def test_numbers_area_and_explication_format_are_ignored(self) -> None:
        cases = {
            "Office_1": "office",
            "Restroom_2": "restroom",
            "Kitchen (16.0m2)": "kitchen",
            "Кабінет 101": "office",
            "101 | Main_Corridor | 24.0 m2": "corridor",
        }
        for name, expected in cases.items():
            with self.subTest(name=name):
                self.assertEqual(suggest_room_type(name), expected)

    def test_partial_match_prefers_longest_example(self) -> None:
        cases = {
            "Кабінет директора": "office",
            "Server_Room_2": "technical",
            "Staff_Room": "service_room",
            "Storage_Room": "storage",
        }
        for name, expected in cases.items():
            with self.subTest(name=name):
                self.assertEqual(suggest_room_type(name), expected)

    def test_unmatched_names_are_unknown(self) -> None:
        for name in [
            None,
            "",
            "Room_101",
            "Bad_Room_A",
            "Unknown Room",
            "name-not-in-catalog",
        ]:
            with self.subTest(name=name):
                self.assertEqual(suggest_room_type(name), UNKNOWN_ROOM_TYPE)


class TestParserSuggestsTypes(unittest.TestCase):
    def test_cafe_office_fixture(self) -> None:
        rooms = parse_dxf_rooms(FIXTURES_DIR / "02_cafe_office_plan_mm.dxf")
        types_by_name = {room.name: room.type for room in rooms}
        self.assertEqual(
            types_by_name,
            {
                "Cafe_Hall (48.0m2)": "hall",
                "Kitchen (16.0m2)": "kitchen",
                "Main_Corridor (24.0m2)": "corridor",
                "Manager_Office (12.0m2)": "office",
                "Office_1 (16.0m2)": "office",
                "Office_2 (16.0m2)": "office",
                "Restroom_1 (4.0m2)": "restroom",
                "Restroom_2 (4.0m2)": "restroom",
                "Staff_Room (12.0m2)": "service_room",
                "Storage_Room (8.0m2)": "storage",
            },
        )

    def test_simple_rooms_fixture_is_unknown(self) -> None:
        rooms = parse_dxf_rooms(FIXTURES_DIR / "01_simple_rooms_mm.dxf")
        self.assertTrue(rooms)
        self.assertTrue(all(room.type == UNKNOWN_ROOM_TYPE for room in rooms))


def rect(width: float, height: float) -> list[dict[str, float]]:
    return [
        {"x": 0, "y": 0},
        {"x": width, "y": 0},
        {"x": width, "y": height},
        {"x": 0, "y": height},
    ]


class TestRoomsApi(unittest.TestCase):
    def setUp(self) -> None:
        self.user_id = str(uuid4())
        self.drawing_id = str(uuid4())
        self.room_id = str(uuid4())
        self.current_user = CurrentUser(id=self.user_id, role="engineer")

        self.room_row: dict[str, Any] = {
            "id": self.room_id,
            "drawing_id": self.drawing_id,
            "name": "Room_101",
            "type": "unknown",
            "type_confirmed": False,
            "height": None,
            "area": 20.0,
            "polygon": [
                {"x": 0, "y": 0},
                {"x": 4000, "y": 0},
                {"x": 4000, "y": 5000},
                {"x": 0, "y": 5000},
            ],
            "source": "fire_rooms",
        }
        self.rooms_table = FakeTable([self.room_row])
        self.drawings_table = FakeTable(
            [
                {
                    "id": self.drawing_id,
                    "owner_id": self.user_id,
                    "units": "mm",
                    "unit_scale_m": 0.001,
                }
            ]
        )
        self.devices_table = FakeTable([])
        self.supabase = fake_supabase(
            {
                "rooms": self.rooms_table,
                "drawings": self.drawings_table,
                "devices": self.devices_table,
            }
        )

        app.dependency_overrides[get_current_user] = lambda: self.current_user
        app.dependency_overrides[get_supabase_client] = lambda: self.supabase
        self.client = TestClient(app)

    def tearDown(self) -> None:
        app.dependency_overrides.clear()

    def test_list_room_types(self) -> None:
        response = self.client.get("/api/v1/room-types")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertIn(
            {"code": "unknown", "name": "Тип не визначено", "examples": []}, body
        )
        self.assertTrue(all(set(item) == {"code", "name", "examples"} for item in body))

    def test_list_room_types_requires_auth(self) -> None:
        app.dependency_overrides.pop(get_current_user)
        response = self.client.get("/api/v1/room-types")
        self.assertEqual(response.status_code, 401)

    def test_patch_type_and_height(self) -> None:
        response = self.client.patch(
            f"/api/v1/rooms/{self.room_id}", json={"type": "office", "height": 3.2}
        )
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["id"], self.room_id)
        self.assertEqual(body["drawingId"], self.drawing_id)
        self.assertEqual(body["type"], "office")
        self.assertEqual(body["height"], 3.2)
        self.assertEqual(len(body["polygon"]), 4)

        update = self.rooms_table.updates[-1]
        self.assertEqual(update["type"], "office")
        self.assertTrue(update["type_confirmed"])
        self.assertEqual(update["height"], 3.2)

    def test_patch_height_only_does_not_touch_type(self) -> None:
        response = self.client.patch(
            f"/api/v1/rooms/{self.room_id}", json={"height": 2.7}
        )
        self.assertEqual(response.status_code, 200, response.text)
        update = self.rooms_table.updates[-1]
        self.assertNotIn("type", update)
        self.assertNotIn("type_confirmed", update)

    def test_patch_null_height_clears_it(self) -> None:
        response = self.client.patch(
            f"/api/v1/rooms/{self.room_id}", json={"height": None}
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertIsNone(response.json()["height"])

    def test_patch_admin_can_edit_foreign_drawing(self) -> None:
        self.drawings_table.rows[0]["owner_id"] = str(uuid4())
        self.current_user = CurrentUser(id=self.user_id, role="admin")
        response = self.client.patch(
            f"/api/v1/rooms/{self.room_id}", json={"type": "kitchen"}
        )
        self.assertEqual(response.status_code, 200, response.text)

    def test_patch_rejects_invalid_input(self) -> None:
        cases = [
            {},
            {"type": "spaceship"},
            {"type": None},
            {"height": 0},
            {"height": -1},
            {"height": 3200},
            {"name": "Kitchen"},
        ]
        for payload in cases:
            with self.subTest(payload=payload):
                response = self.client.patch(
                    f"/api/v1/rooms/{self.room_id}", json=payload
                )
                self.assertEqual(response.status_code, 422)
        self.assertEqual(self.rooms_table.updates, [])

    def test_patch_rejects_non_uuid_room_id(self) -> None:
        response = self.client.patch("/api/v1/rooms/not-a-uuid", json={"height": 3})
        self.assertEqual(response.status_code, 422)

    def test_patch_missing_room_is_404(self) -> None:
        self.rooms_table.rows = []
        response = self.client.patch(
            f"/api/v1/rooms/{self.room_id}", json={"height": 3}
        )
        self.assertEqual(response.status_code, 404)

    def test_patch_room_deleted_before_update_is_404(self) -> None:
        # SELECT finds the room, but it is gone by the time UPDATE runs.
        update = self.rooms_table.update

        def update_after_room_was_deleted(values: dict[str, Any]) -> FakeTable:
            self.rooms_table.rows.clear()
            return update(values)

        self.rooms_table.update = update_after_room_was_deleted  # type: ignore[method-assign]
        response = self.client.patch(
            f"/api/v1/rooms/{self.room_id}", json={"height": 3}
        )
        self.assertEqual(response.status_code, 404, response.text)
        self.assertEqual(len(self.rooms_table.updates), 1)

    def test_patch_foreign_drawing_is_403(self) -> None:
        self.drawings_table.rows[0]["owner_id"] = str(uuid4())
        response = self.client.patch(
            f"/api/v1/rooms/{self.room_id}", json={"type": "office"}
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.rooms_table.updates, [])

    # BIM-120: PATCH /rooms/{id} with polygon and confirmed

    def test_patch_polygon_recalculates_area_from_stored_scale(self) -> None:
        # Only drawings.unit_scale_m (mm here) counts: neither drawings.units
        # nor the areas of other rooms.
        self.drawings_table.rows[0]["units"] = "m"
        self.room_row["area"] = 0
        response = self.client.patch(
            f"/api/v1/rooms/{self.room_id}", json={"polygon": rect(6000, 5000)}
        )
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["area"], 30.0)
        self.assertEqual(body["polygon"], rect(6000, 5000))
        update = self.rooms_table.updates[-1]
        self.assertEqual(update["area"], 30.0)
        self.assertEqual(update["polygon"], rect(6000, 5000))
        self.assertNotIn("confirmed", update)
        self.assertNotIn("type", update)

    def test_patch_polygon_uses_stored_scale_for_each_unit(self) -> None:
        cases = [(1.0, rect(6, 5)), (0.01, rect(600, 500)), (0.001, rect(6000, 5000))]
        for unit_scale_m, polygon in cases:
            with self.subTest(unit_scale_m=unit_scale_m):
                self.drawings_table.rows[0]["unit_scale_m"] = unit_scale_m
                response = self.client.patch(
                    f"/api/v1/rooms/{self.room_id}", json={"polygon": polygon}
                )
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.json()["area"], 30.0)
        # A stored scale never needs the source DXF.
        self.supabase.storage.from_.return_value.download.assert_not_called()

    def test_patch_confirmed(self) -> None:
        response = self.client.patch(
            f"/api/v1/rooms/{self.room_id}", json={"confirmed": True}
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertIs(response.json()["confirmed"], True)
        self.assertEqual(response.json()["source"], "fire_rooms")
        self.assertIs(self.rooms_table.updates[-1]["confirmed"], True)

    def test_patch_rejects_invalid_polygons(self) -> None:
        cases: dict[str, Any] = {
            "two points": [{"x": 0, "y": 0}, {"x": 1, "y": 0}],
            "closing point repeated": rect(4000, 5000) + [{"x": 0, "y": 0}],
            "duplicate point": [
                {"x": 0, "y": 0},
                {"x": 10, "y": 0},
                {"x": 10, "y": 0},
                {"x": 0, "y": 10},
            ],
            "self-intersecting": [
                {"x": 0, "y": 0},
                {"x": 10, "y": 10},
                {"x": 10, "y": 0},
                {"x": 0, "y": 10},
            ],
            "collinear": [{"x": 0, "y": 0}, {"x": 5, "y": 0}, {"x": 10, "y": 0}],
            "null": None,
        }
        for label, polygon in cases.items():
            with self.subTest(case=label):
                response = self.client.patch(
                    f"/api/v1/rooms/{self.room_id}", json={"polygon": polygon}
                )
                self.assertEqual(response.status_code, 422, response.text)
        response = self.client.patch(
            f"/api/v1/rooms/{self.room_id}", json={"confirmed": None}
        )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(self.rooms_table.updates, [])

    # BIM-120: POST /drawings/{id}/rooms

    def test_create_manual_room(self) -> None:
        response = self.client.post(
            f"/api/v1/drawings/{self.drawing_id}/rooms",
            json={"name": "Кухня 2", "polygon": rect(3000, 2000)},
        )
        self.assertEqual(response.status_code, 201, response.text)
        body = response.json()
        self.assertEqual(body["drawingId"], self.drawing_id)
        self.assertEqual(body["name"], "Кухня 2")
        self.assertEqual(body["type"], "kitchen")
        self.assertEqual(body["area"], 6.0)
        self.assertEqual(body["source"], "manual")
        self.assertIs(body["confirmed"], True)
        self.assertIsNone(body["height"])

        inserted = self.rooms_table.inserts[-1]
        self.assertEqual(inserted["id"], body["id"])
        self.assertEqual(inserted["drawing_id"], self.drawing_id)
        self.assertEqual(inserted["source"], "manual")
        self.assertIs(inserted["confirmed"], True)
        self.assertIs(inserted["type_confirmed"], False)

    def test_create_room_with_explicit_type_and_height(self) -> None:
        response = self.client.post(
            f"/api/v1/drawings/{self.drawing_id}/rooms",
            json={
                "name": None,
                "type": "storage",
                "height": 3.0,
                "polygon": rect(2000, 2000),
            },
        )
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(response.json()["type"], "storage")
        self.assertEqual(response.json()["height"], 3.0)
        self.assertIs(self.rooms_table.inserts[-1]["type_confirmed"], True)

    def test_create_room_in_empty_drawing_uses_stored_scale(self) -> None:
        self.rooms_table.rows.clear()
        response = self.client.post(
            f"/api/v1/drawings/{self.drawing_id}/rooms",
            json={"polygon": rect(2000, 3000)},
        )
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(response.json()["type"], UNKNOWN_ROOM_TYPE)
        self.assertEqual(response.json()["area"], 6.0)

    def test_create_room_rejects_invalid_input(self) -> None:
        cases: list[dict[str, Any]] = [
            {},
            {"name": "A"},
            {"polygon": rect(10, 10), "type": "spaceship"},
            {"polygon": rect(10, 10), "source": "fire_rooms"},
            {"polygon": [{"x": 0, "y": 0}, {"x": 1, "y": 1}, {"x": 2, "y": 2}]},
        ]
        for payload in cases:
            with self.subTest(payload=payload):
                response = self.client.post(
                    f"/api/v1/drawings/{self.drawing_id}/rooms", json=payload
                )
                self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(self.rooms_table.inserts, [])

    def test_create_room_access(self) -> None:
        missing = self.client.post(
            f"/api/v1/drawings/{uuid4()}/rooms", json={"polygon": rect(10, 10)}
        )
        self.assertEqual(missing.status_code, 404)
        bad_id = self.client.post(
            "/api/v1/drawings/not-a-uuid/rooms", json={"polygon": rect(10, 10)}
        )
        self.assertEqual(bad_id.status_code, 422)
        self.drawings_table.rows[0]["owner_id"] = str(uuid4())
        forbidden = self.client.post(
            f"/api/v1/drawings/{self.drawing_id}/rooms",
            json={"polygon": rect(10, 10)},
        )
        self.assertEqual(forbidden.status_code, 403)
        self.assertEqual(self.rooms_table.inserts, [])

    # BIM-120: DELETE /rooms/{id}

    def test_delete_room_detaches_its_devices(self) -> None:
        other_room_id = str(uuid4())
        self.devices_table.rows.extend(
            [
                {"id": "d1", "drawing_id": self.drawing_id, "room_id": self.room_id},
                {"id": "d2", "drawing_id": self.drawing_id, "room_id": other_room_id},
            ]
        )
        response = self.client.delete(f"/api/v1/rooms/{self.room_id}")
        self.assertEqual(response.status_code, 204, response.text)
        self.assertEqual(response.content, b"")
        self.assertEqual(self.rooms_table.rows, [])
        rooms_by_device = {d["id"]: d["room_id"] for d in self.devices_table.rows}
        self.assertEqual(rooms_by_device, {"d1": None, "d2": other_room_id})

    def test_delete_room_access(self) -> None:
        missing = self.client.delete(f"/api/v1/rooms/{uuid4()}")
        self.assertEqual(missing.status_code, 404)
        self.drawings_table.rows[0]["owner_id"] = str(uuid4())
        forbidden = self.client.delete(f"/api/v1/rooms/{self.room_id}")
        self.assertEqual(forbidden.status_code, 403)
        self.assertEqual(self.rooms_table.deleted, [])
        self.assertEqual(self.devices_table.updates, [])

    # BIM-120: POST /drawings/{id}/rooms/confirm

    def test_confirm_all_rooms_of_drawing(self) -> None:
        self.room_row["confirmed"] = False
        second_room = {**self.room_row, "id": str(uuid4())}
        other_drawing_room = {
            **self.room_row,
            "id": str(uuid4()),
            "drawing_id": str(uuid4()),
        }
        self.rooms_table.rows.extend([second_room, other_drawing_room])

        response = self.client.post(f"/api/v1/drawings/{self.drawing_id}/rooms/confirm")
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(
            {room["id"] for room in body}, {self.room_id, second_room["id"]}
        )
        self.assertTrue(all(room["confirmed"] is True for room in body))
        self.assertIs(other_drawing_room["confirmed"], False)

    def test_confirm_all_foreign_drawing_is_403(self) -> None:
        self.drawings_table.rows[0]["owner_id"] = str(uuid4())
        response = self.client.post(f"/api/v1/drawings/{self.drawing_id}/rooms/confirm")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.rooms_table.updates, [])


# $INSUNITS code -> (room width, room height) in drawing units, expected m².
UNIT_CASES: dict[int, tuple[float, float, float]] = {
    6: (5.0, 4.0, 20.0),  # metres
    4: (5000.0, 4000.0, 20.0),  # millimetres
    5: (500.0, 400.0, 20.0),  # centimetres
    2: (10.0, 10.0, 9.2903),  # feet: 100 ft² = 9.290304 m²
    1: (100.0, 100.0, 6.4516),  # inches: 10,000 in² = 6.4516 m²
}


class TestManualRoomAreaKeepsDrawingScale(unittest.TestCase):
    """parse -> delete all rooms -> create the same outline keeps the area.

    The scale must come from the drawing (DXF $INSUNITS at processing), not
    from rooms the engineer can delete, and not from drawings.units, which
    is 'from_file' here.
    """

    def setUp(self) -> None:
        self.temp_dir = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.temp_dir, ignore_errors=True)
        self.user_id = str(uuid4())
        self.drawing_id = str(uuid4())
        self.drawings_table = FakeTable(
            [
                {
                    "id": self.drawing_id,
                    "owner_id": self.user_id,
                    "status": "uploaded",
                    "units": "from_file",
                    "storage_path": f"{self.user_id}/{self.drawing_id}/source.dxf",
                }
            ]
        )
        self.rooms_table = FakeTable([])
        self.supabase = fake_supabase(
            {
                "drawings": self.drawings_table,
                "rooms": self.rooms_table,
                "devices": FakeTable([]),
            }
        )
        current_user = CurrentUser(id=self.user_id, role="engineer")
        app.dependency_overrides[get_current_user] = lambda: current_user
        app.dependency_overrides[get_supabase_client] = lambda: self.supabase
        self.addCleanup(app.dependency_overrides.clear)
        self.client = TestClient(app)

    def use_source_dxf(self, insunits: int, width: float, height: float) -> None:
        doc = ezdxf.new("R2010")
        doc.header["$INSUNITS"] = insunits
        doc.layers.add("FIRE_ROOMS")
        msp = doc.modelspace()
        msp.add_lwpolyline(
            [(0, 0), (width, 0), (width, height), (0, height)],
            close=True,
            dxfattribs={"layer": "FIRE_ROOMS"},
        )
        msp.add_text(
            "Office", dxfattribs={"layer": "FIRE_ROOMS", "height": height / 20}
        ).set_placement((width / 2, height / 2))
        path = self.temp_dir / f"source_{insunits}.dxf"
        doc.saveas(str(path))
        self.supabase.storage.from_.return_value.download.return_value = (
            path.read_bytes()
        )

    def test_parse_delete_all_create_keeps_area(self) -> None:
        for insunits, (width, height, area_m2) in UNIT_CASES.items():
            with self.subTest(insunits=insunits):
                self.drawings_table.rows[0]["status"] = "uploaded"
                self.use_source_dxf(insunits, width, height)

                processed = self.client.post(
                    f"/api/v1/drawings/{self.drawing_id}/process"
                )
                self.assertEqual(processed.status_code, 200, processed.text)
                self.assertEqual(len(self.rooms_table.rows), 1)
                self.assertEqual(self.rooms_table.rows[0]["area"], area_m2)

                for room in list(self.rooms_table.rows):
                    deleted = self.client.delete(f"/api/v1/rooms/{room['id']}")
                    self.assertEqual(deleted.status_code, 204, deleted.text)
                self.assertEqual(self.rooms_table.rows, [])

                created = self.client.post(
                    f"/api/v1/drawings/{self.drawing_id}/rooms",
                    json={"name": "Office", "polygon": rect(width, height)},
                )
                self.assertEqual(created.status_code, 201, created.text)
                self.assertEqual(created.json()["area"], area_m2)

                edited = self.client.patch(
                    f"/api/v1/rooms/{created.json()['id']}",
                    json={"polygon": rect(width, height / 2)},
                )
                self.assertEqual(edited.status_code, 200, edited.text)
                self.assertAlmostEqual(edited.json()["area"], area_m2 / 2, places=3)

    def test_drawing_processed_before_migration_007_recovers_scale(self) -> None:
        """A processed drawing with unit_scale_m = NULL, without calling process.

        The scale is read once from the source DXF and stored; rooms, including
        manual edits, are never reprocessed.
        """
        length_scales = {6: 1.0, 4: 0.001, 5: 0.01, 2: 0.3048, 1: 0.0254}
        download = self.supabase.storage.from_.return_value.download
        for insunits, (width, height, area_m2) in UNIT_CASES.items():
            with self.subTest(insunits=insunits):
                drawing = self.drawings_table.rows[0]
                drawing.update({"status": "processed", "unit_scale_m": None})
                parsed_room = {
                    "id": str(uuid4()),
                    "drawing_id": self.drawing_id,
                    "name": "Office",
                    "area": area_m2,
                    "polygon": rect(width, height),
                    "source": "fire_rooms",
                    "confirmed": False,
                }
                edited_room = {
                    **parsed_room,
                    "id": str(uuid4()),
                    "name": "Office (edited)",
                    "source": "manual",
                    "confirmed": True,
                }
                self.rooms_table.rows[:] = [parsed_room, edited_room]
                self.rooms_table.inserts.clear()
                self.use_source_dxf(insunits, width, height)
                download.reset_mock()

                for room in list(self.rooms_table.rows):
                    deleted = self.client.delete(f"/api/v1/rooms/{room['id']}")
                    self.assertEqual(deleted.status_code, 204, deleted.text)

                created = self.client.post(
                    f"/api/v1/drawings/{self.drawing_id}/rooms",
                    json={"name": "Office", "polygon": rect(width, height)},
                )
                self.assertEqual(created.status_code, 201, created.text)
                self.assertEqual(created.json()["area"], area_m2)

                edited = self.client.patch(
                    f"/api/v1/rooms/{created.json()['id']}",
                    json={"polygon": rect(width, height / 2)},
                )
                self.assertEqual(edited.status_code, 200, edited.text)
                self.assertAlmostEqual(edited.json()["area"], area_m2 / 2, places=3)

                # Scale stored on the drawing, source read only once.
                self.assertEqual(drawing["unit_scale_m"], length_scales[insunits])
                self.assertEqual(download.call_count, 1)
                # Not reprocessed: only the hand-drawn room was inserted.
                self.assertEqual(drawing["status"], "processed")
                self.assertEqual(
                    [row["id"] for row in self.rooms_table.inserts],
                    [created.json()["id"]],
                )

    def test_unreadable_source_dxf_is_502_not_a_wrong_area(self) -> None:
        self.drawings_table.rows[0].update(
            {"status": "processed", "unit_scale_m": None}
        )
        self.supabase.storage.from_.return_value.download.side_effect = RuntimeError(
            "storage down"
        )
        response = self.client.post(
            f"/api/v1/drawings/{self.drawing_id}/rooms",
            json={"polygon": rect(5, 4)},
        )
        self.assertEqual(response.status_code, 502, response.text)
        self.assertEqual(self.rooms_table.inserts, [])
        self.assertIsNone(self.drawings_table.rows[0]["unit_scale_m"])


if __name__ == "__main__":
    unittest.main()
