import sys
import unittest
from pathlib import Path
from typing import Any
from uuid import uuid4

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
            [{"id": self.drawing_id, "owner_id": self.user_id, "units": "mm"}]
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

    def test_patch_polygon_recalculates_area_from_drawing_ratio(self) -> None:
        # The drawing says metres, but the parser's area for the existing room
        # (20 m² for 4000x5000) shows the coordinates are millimetres.
        self.drawings_table.rows[0]["units"] = "m"
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

    def test_patch_polygon_falls_back_to_drawing_units(self) -> None:
        cases = [
            ("m", rect(6, 5)),
            ("mm", rect(6000, 5000)),
            ("from_file", rect(6000, 5000)),
            (None, rect(6000, 5000)),
        ]
        for units, polygon in cases:
            with self.subTest(units=units):
                self.room_row["area"] = 0
                self.drawings_table.rows[0]["units"] = units
                response = self.client.patch(
                    f"/api/v1/rooms/{self.room_id}", json={"polygon": polygon}
                )
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.json()["area"], 30.0)

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

    def test_create_room_in_empty_drawing_uses_units(self) -> None:
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


if __name__ == "__main__":
    unittest.main()
