import sys
import unittest
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock
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


class FakeTable:
    """Chainable stand-in for a Supabase table query."""

    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self.rows = rows
        self.updates: list[dict[str, Any]] = []
        self._pending_update: dict[str, Any] | None = None

    def select(self, *_args: Any) -> "FakeTable":
        self._pending_update = None
        return self

    def eq(self, *_args: Any) -> "FakeTable":
        return self

    def limit(self, *_args: Any) -> "FakeTable":
        return self

    def update(self, values: dict[str, Any]) -> "FakeTable":
        self._pending_update = values
        self.updates.append(values)
        return self

    def execute(self) -> MagicMock:
        if self._pending_update is not None:
            return MagicMock(
                data=[{**row, **self._pending_update} for row in self.rows]
            )
        return MagicMock(data=list(self.rows))


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
            [{"id": self.drawing_id, "owner_id": self.user_id}]
        )

        self.supabase = MagicMock()
        self.supabase.table.side_effect = lambda name: {
            "rooms": self.rooms_table,
            "drawings": self.drawings_table,
        }[name]

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

    def test_patch_foreign_drawing_is_403(self) -> None:
        self.drawings_table.rows[0]["owner_id"] = str(uuid4())
        response = self.client.patch(
            f"/api/v1/rooms/{self.room_id}", json={"type": "office"}
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.rooms_table.updates, [])


if __name__ == "__main__":
    unittest.main()
