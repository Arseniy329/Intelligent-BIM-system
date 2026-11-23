"""BIM-73: API зон приміщення і крок /place за висотою кімнати або зони."""

import sys
import unittest
from pathlib import Path
from typing import Any
from unittest.mock import patch
from uuid import uuid4

from fastapi.testclient import TestClient

API_DIR = Path(__file__).resolve().parent.parent
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

from src.core.auth import CurrentUser, get_current_user
from src.infrastructure.supabase import get_supabase_client
from src.main import app
from tests.fakes import FakeTable, fake_supabase


def rect_mm(x0: float, y0: float, x1: float, y1: float) -> list[dict[str, float]]:
    return [
        {"x": x0, "y": y0},
        {"x": x1, "y": y0},
        {"x": x1, "y": y1},
        {"x": x0, "y": y1},
    ]


def smoke_rule(
    code: str,
    min_height: float | None,
    max_height: float | None,
    step: float,
    area: float,
) -> dict[str, Any]:
    return {
        "id": str(uuid4()),
        "rule_id": code,
        "name": code,
        "device_type": "smoke_detector",
        "value_kind": "max_grid_spacing_m",
        "room_types": [],
        "min_height_m": min_height,
        "max_height_m": max_height,
        "value": step,
        "conditions": {"max_protected_area_m2": area},
        "verification_status": "verified",
    }


class RoomZonesTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.user_id = str(uuid4())
        self.drawing_id = str(uuid4())
        self.room_id = str(uuid4())
        self.current_user = CurrentUser(id=self.user_id, role="engineer")

        # Приміщення 10 × 8 м (креслення в мм) без висоти.
        self.room_row: dict[str, Any] = {
            "id": self.room_id,
            "drawing_id": self.drawing_id,
            "name": "Hall",
            "type": "hall",
            "height": None,
            "area": 80.0,
            "polygon": rect_mm(0, 0, 10_000, 8_000),
            "source": "auto",
        }
        self.rooms_table = FakeTable([self.room_row])
        self.zones_table = FakeTable([])
        self.drawings_table = FakeTable(
            [
                {
                    "id": self.drawing_id,
                    "owner_id": self.user_id,
                    "units": "mm",
                    "unit_scale_m": 0.001,
                    "status": "processing",
                    "original_file_name": "plan.dxf",
                    "storage_path": f"{self.user_id}/{self.drawing_id}/source.dxf",
                    "created_at": "2026-11-19T10:00:00+00:00",
                }
            ]
        )
        self.devices_table = FakeTable([])
        self.exits_table = FakeTable([])
        self.rules_table = FakeTable(
            [
                smoke_rule("SMOKE_GRID_HEIGHT_3_5", None, 3.5, 9.0, 80),
                smoke_rule("SMOKE_GRID_HEIGHT_6_10", 6.0, 10.0, 8.0, 65),
            ]
        )
        self.supabase = fake_supabase(
            {
                "rooms": self.rooms_table,
                "room_zones": self.zones_table,
                "exits": self.exits_table,
                "passages": FakeTable([]),
                "drawings": self.drawings_table,
                "devices": self.devices_table,
                "rules": self.rules_table,
            }
        )

        app.dependency_overrides[get_current_user] = lambda: self.current_user
        app.dependency_overrides[get_supabase_client] = lambda: self.supabase
        self.client = TestClient(app)

    def tearDown(self) -> None:
        app.dependency_overrides.clear()

    def add_zone(
        self,
        polygon: list[dict[str, float]],
        height: float | None,
        name: str | None = None,
        created_at: str = "2026-11-19T10:00:00+00:00",
    ) -> dict[str, Any]:
        row = {
            "id": str(uuid4()),
            "room_id": self.room_id,
            "drawing_id": self.drawing_id,
            "name": name,
            "height": height,
            "area": 0.0,
            "polygon": polygon,
            "created_at": created_at,
        }
        self.zones_table.rows.append(row)
        return row


class TestZonesApi(RoomZonesTestCase):
    def test_create_zone_is_stored_as_part_of_the_room(self) -> None:
        response = self.client.post(
            f"/api/v1/rooms/{self.room_id}/zones",
            json={
                "name": "Антресоль",
                "height": 3.0,
                "polygon": rect_mm(0, 0, 5_000, 8_000),
            },
        )

        self.assertEqual(response.status_code, 201, response.text)
        body = response.json()
        self.assertEqual(body["roomId"], self.room_id)
        self.assertEqual(body["drawingId"], self.drawing_id)
        self.assertEqual(body["name"], "Антресоль")
        self.assertEqual(body["height"], 3.0)
        self.assertEqual(body["area"], 40.0)
        self.assertEqual(len(body["polygon"]), 4)
        self.assertEqual(len(self.zones_table.inserts), 1)
        self.assertEqual(self.zones_table.inserts[0]["room_id"], self.room_id)

    def test_create_zone_without_height_keeps_height_empty(self) -> None:
        response = self.client.post(
            f"/api/v1/rooms/{self.room_id}/zones",
            json={"polygon": rect_mm(0, 0, 5_000, 8_000)},
        )

        self.assertEqual(response.status_code, 201, response.text)
        self.assertIsNone(response.json()["height"])
        self.assertIsNone(self.zones_table.inserts[0]["height"])

    def test_two_zones_with_different_heights_are_kept_together(self) -> None:
        for polygon, height in (
            (rect_mm(0, 0, 5_000, 8_000), 3.0),
            (rect_mm(5_000, 0, 10_000, 8_000), 7.0),
        ):
            response = self.client.post(
                f"/api/v1/rooms/{self.room_id}/zones",
                json={"height": height, "polygon": polygon},
            )
            self.assertEqual(response.status_code, 201, response.text)

        listed = self.client.get(f"/api/v1/drawings/{self.drawing_id}/zones")
        self.assertEqual(listed.status_code, 200, listed.text)
        self.assertEqual([zone["height"] for zone in listed.json()], [3.0, 7.0])
        self.assertTrue(all(zone["roomId"] == self.room_id for zone in listed.json()))

    def test_zone_must_lie_inside_the_room(self) -> None:
        response = self.client.post(
            f"/api/v1/rooms/{self.room_id}/zones",
            json={"height": 3.0, "polygon": rect_mm(8_000, 0, 14_000, 8_000)},
        )

        self.assertEqual(response.status_code, 422)
        self.assertIn("inside", response.json()["detail"])
        self.assertEqual(self.zones_table.inserts, [])

    def test_zones_of_one_room_must_not_overlap(self) -> None:
        self.add_zone(rect_mm(0, 0, 6_000, 8_000), 3.0)

        response = self.client.post(
            f"/api/v1/rooms/{self.room_id}/zones",
            json={"height": 7.0, "polygon": rect_mm(4_000, 0, 10_000, 8_000)},
        )

        self.assertEqual(response.status_code, 422)
        self.assertIn("overlap", response.json()["detail"])

    def test_touching_zones_are_allowed(self) -> None:
        self.add_zone(rect_mm(0, 0, 5_000, 8_000), 3.0)

        response = self.client.post(
            f"/api/v1/rooms/{self.room_id}/zones",
            json={"height": 7.0, "polygon": rect_mm(5_000, 0, 10_000, 8_000)},
        )

        self.assertEqual(response.status_code, 201, response.text)

    def test_create_rejects_invalid_input(self) -> None:
        cases = [
            {"height": 0, "polygon": rect_mm(0, 0, 5_000, 8_000)},
            {"height": -2, "polygon": rect_mm(0, 0, 5_000, 8_000)},
            {"height": 3200, "polygon": rect_mm(0, 0, 5_000, 8_000)},
            {"height": 3.0},
            {"height": 3.0, "polygon": [{"x": 0, "y": 0}, {"x": 1, "y": 1}]},
            {"height": 3.0, "polygon": rect_mm(0, 0, 5_000, 8_000), "room_id": "x"},
        ]
        for payload in cases:
            with self.subTest(payload=payload):
                response = self.client.post(
                    f"/api/v1/rooms/{self.room_id}/zones", json=payload
                )
                self.assertEqual(response.status_code, 422)
        self.assertEqual(self.zones_table.inserts, [])

    def test_create_zone_in_unknown_room_is_404(self) -> None:
        response = self.client.post(
            f"/api/v1/rooms/{uuid4()}/zones",
            json={"height": 3.0, "polygon": rect_mm(0, 0, 5_000, 8_000)},
        )

        self.assertEqual(response.status_code, 404)

    def test_other_users_drawing_is_forbidden(self) -> None:
        self.drawings_table.rows[0]["owner_id"] = str(uuid4())

        response = self.client.post(
            f"/api/v1/rooms/{self.room_id}/zones",
            json={"height": 3.0, "polygon": rect_mm(0, 0, 5_000, 8_000)},
        )

        self.assertEqual(response.status_code, 403)
        self.assertEqual(
            self.client.get(f"/api/v1/drawings/{self.drawing_id}/zones").status_code,
            403,
        )

    def test_patch_height_and_clear_it(self) -> None:
        zone = self.add_zone(rect_mm(0, 0, 5_000, 8_000), None, name="A")

        response = self.client.patch(
            f"/api/v1/zones/{zone['id']}", json={"height": 4.2}
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["height"], 4.2)
        self.assertEqual(response.json()["name"], "A")

        response = self.client.patch(
            f"/api/v1/zones/{zone['id']}", json={"height": None}
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertIsNone(response.json()["height"])

    def test_patch_polygon_checks_overlap_with_other_zones_only(self) -> None:
        left = self.add_zone(rect_mm(0, 0, 5_000, 8_000), 3.0)
        right = self.add_zone(rect_mm(5_000, 0, 10_000, 8_000), 7.0)

        same = self.client.patch(
            f"/api/v1/zones/{right['id']}",
            json={"polygon": rect_mm(5_000, 0, 10_000, 8_000)},
        )
        self.assertEqual(same.status_code, 200, same.text)

        overlapping = self.client.patch(
            f"/api/v1/zones/{right['id']}",
            json={"polygon": rect_mm(4_000, 0, 10_000, 8_000)},
        )
        self.assertEqual(overlapping.status_code, 422)
        self.assertIn(left["id"], {row["id"] for row in self.zones_table.rows})

    def test_patch_rejects_invalid_input(self) -> None:
        zone = self.add_zone(rect_mm(0, 0, 5_000, 8_000), 3.0)
        for payload in [{}, {"height": 0}, {"polygon": None}, {"room_id": "x"}]:
            with self.subTest(payload=payload):
                response = self.client.patch(
                    f"/api/v1/zones/{zone['id']}", json=payload
                )
                self.assertEqual(response.status_code, 422)
        self.assertEqual(self.zones_table.updates, [])

    def test_patch_unknown_zone_is_404(self) -> None:
        response = self.client.patch(f"/api/v1/zones/{uuid4()}", json={"height": 3.0})

        self.assertEqual(response.status_code, 404)

    def test_delete_zone(self) -> None:
        zone = self.add_zone(rect_mm(0, 0, 5_000, 8_000), 3.0)

        response = self.client.delete(f"/api/v1/zones/{zone['id']}")

        self.assertEqual(response.status_code, 204)
        self.assertEqual(self.zones_table.rows, [])
        self.assertEqual(
            self.client.delete(f"/api/v1/zones/{zone['id']}").status_code, 404
        )


class TestPlaceUsesRoomAndZoneHeight(RoomZonesTestCase):
    def place(self) -> Any:
        with patch(
            "src.modules.drawings.router.generate_and_upload_result_dxf",
            return_value="result.dxf",
        ):
            return self.client.post(f"/api/v1/drawings/{self.drawing_id}/place")

    def test_room_without_height_gets_insufficient_data_and_no_devices(self) -> None:
        response = self.place()

        self.assertEqual(response.status_code, 200, response.text)
        (placement,) = response.json()["placements"]
        self.assertEqual(placement["room_id"], self.room_id)
        self.assertIsNone(placement["zone_id"])
        self.assertEqual(placement["status"], "insufficient_data")
        self.assertEqual(placement["reason"], "Не введено висоту")
        self.assertEqual(placement["device_count"], 0)
        self.assertEqual(self.devices_table.inserts, [])

    def test_room_height_selects_rule_and_reports_it(self) -> None:
        self.room_row["height"] = 3.0

        response = self.place()

        self.assertEqual(response.status_code, 200, response.text)
        (placement,) = response.json()["placements"]
        self.assertEqual(placement["status"], "placed")
        self.assertEqual(placement["rule"]["rule_id"], "SMOKE_GRID_HEIGHT_3_5")
        self.assertEqual(placement["rule"]["grid_step_m"], 9.0)
        self.assertEqual(placement["rule"]["protected_area_m2"], 80.0)
        self.assertGreater(len(self.devices_table.inserts), 0)
        self.assertTrue(
            all(row["room_id"] == self.room_id for row in self.devices_table.inserts)
        )

    def test_height_without_rule_gets_reason(self) -> None:
        self.room_row["height"] = 13.0

        response = self.place()

        self.assertEqual(response.status_code, 200, response.text)
        (placement,) = response.json()["placements"]
        self.assertEqual(placement["status"], "insufficient_data")
        self.assertEqual(placement["reason"], "Немає правила для висоти 13 м")
        self.assertEqual(self.devices_table.inserts, [])

    def test_zones_are_placed_separately_and_zone_without_height_is_skipped(
        self,
    ) -> None:
        low = self.add_zone(rect_mm(0, 0, 4_000, 8_000), 3.0, "Низька")
        high = self.add_zone(rect_mm(4_000, 0, 7_000, 8_000), 8.0, "Висока")
        missing = self.add_zone(rect_mm(7_000, 0, 10_000, 8_000), None, "Без висоти")

        response = self.place()

        self.assertEqual(response.status_code, 200, response.text)
        by_zone = {item["zone_id"]: item for item in response.json()["placements"]}
        self.assertEqual(by_zone[low["id"]]["status"], "placed")
        self.assertEqual(by_zone[low["id"]]["rule"]["rule_id"], "SMOKE_GRID_HEIGHT_3_5")
        self.assertEqual(by_zone[high["id"]]["status"], "placed")
        self.assertEqual(
            by_zone[high["id"]]["rule"]["rule_id"], "SMOKE_GRID_HEIGHT_6_10"
        )
        self.assertEqual(by_zone[missing["id"]]["status"], "insufficient_data")
        self.assertEqual(by_zone[missing["id"]]["reason"], "Не введено висоту")
        self.assertEqual(by_zone[missing["id"]]["device_count"], 0)

        # Прилади лише в зонах з висотою і з правилами своїх зон.
        rule_ids = {row["rule_id"] for row in self.devices_table.inserts}
        self.assertEqual(len(rule_ids), 2)
        self.assertTrue(all(row["x"] <= 7_000 for row in self.devices_table.inserts))

    # ── Інваріант: ніщо не зникає мовчки, клієнт бачить неповний результат ──

    def test_missing_height_is_visible_in_placement_status(self) -> None:
        response = self.place()

        body = response.json()
        self.assertEqual(response.status_code, 200, response.text)
        # Крок розміщення завершився, але приладів немає — це не успіх.
        self.assertEqual(body["status"], "processed")
        self.assertEqual(body["placement_status"], "insufficient_data")
        self.assertEqual(body["device_count"], 0)
        (skipped,) = body["skipped"]
        self.assertEqual(skipped["room_id"], self.room_id)
        self.assertEqual(skipped["name"], "Hall")
        self.assertEqual(skipped["scope"], "room")
        self.assertEqual(skipped["reason"], "Не введено висоту")

    def test_partial_zone_does_not_drop_the_rest_of_the_room(self) -> None:
        zone = self.add_zone(rect_mm(0, 0, 5_000, 8_000), 3.0, "Ліва половина")

        response = self.place()

        body = response.json()
        self.assertEqual(response.status_code, 200, response.text)
        by_scope = {item["scope"]: item for item in body["placements"]}
        self.assertEqual(by_scope["zone"]["zone_id"], zone["id"])
        self.assertEqual(by_scope["zone"]["status"], "placed")
        remainder = by_scope["remainder"]
        self.assertEqual(remainder["room_id"], self.room_id)
        self.assertIsNone(remainder["zone_id"])
        self.assertEqual(remainder["status"], "insufficient_data")
        self.assertEqual(remainder["device_count"], 0)
        self.assertEqual(remainder["area_m2"], 40.0)
        self.assertIn("не віднесено до жодної зони", remainder["reason"])

        self.assertEqual(body["placement_status"], "partial")
        self.assertEqual([item["scope"] for item in body["skipped"]], ["remainder"])
        self.assertEqual(body["skipped"][0]["reason"], remainder["reason"])
        # Прилади — тільки в межах зони.
        self.assertGreater(len(self.devices_table.inserts), 0)
        self.assertTrue(all(row["x"] <= 5_000 for row in self.devices_table.inserts))

    # ── Звіт переживає перезавантаження: його повертає GET, а не лише POST ──

    def reload(self) -> Any:
        """Новий запит без жодного стану POST: те, що бачить користувач після
        повного перезавантаження сторінки або відкриття посилання іншою людиною."""
        return self.client.get(f"/api/v1/drawings/{self.drawing_id}")

    def test_partial_report_survives_a_reload(self) -> None:
        self.add_zone(rect_mm(0, 0, 5_000, 8_000), 3.0, "Ліва половина")
        posted = self.place().json()
        self.assertEqual(posted["placement_status"], "partial")

        reloaded = self.reload()

        self.assertEqual(reloaded.status_code, 200, reloaded.text)
        body = reloaded.json()
        # Результат на місці (DXF і прилади доступні), а поруч — ті самі причини.
        self.assertEqual(body["drawing"]["status"], "processed")
        self.assertGreater(len(body["devices"]), 0)
        report = body["placementReport"]
        self.assertEqual(report["placement_status"], "partial")
        self.assertEqual(report["device_count"], posted["device_count"])
        self.assertEqual(report["skipped"], posted["skipped"])
        self.assertEqual([item["scope"] for item in report["skipped"]], ["remainder"])
        self.assertIn("не віднесено до жодної зони", report["skipped"][0]["reason"])

    def test_missing_height_report_survives_a_reload(self) -> None:
        self.place()

        report = self.reload().json()["placementReport"]

        self.assertEqual(report["placement_status"], "insufficient_data")
        self.assertEqual(report["device_count"], 0)
        self.assertEqual(report["skipped"][0]["reason"], "Не введено висоту")

    def test_report_is_written_with_the_processed_status_in_one_update(self) -> None:
        self.add_zone(rect_mm(0, 0, 5_000, 8_000), 3.0, "Ліва половина")
        posted = self.place().json()

        (update,) = [
            values
            for values in self.drawings_table.updates
            if values.get("status") == "processed"
        ]
        self.assertEqual(
            update["placement_report"],
            {
                "placement_status": posted["placement_status"],
                "device_count": posted["device_count"],
                "skipped": posted["skipped"],
                # BIM-75: стан ручних сповіщувачів і шляхів теж у звіті.
                "manual_call_points": posted["manual_call_points"],
            },
        )

    def test_complete_placement_report_is_stored_too(self) -> None:
        self.room_row["height"] = 3.0
        self.place()

        report = self.reload().json()["placementReport"]

        self.assertEqual(report["placement_status"], "complete")
        self.assertEqual(report["skipped"], [])

    def test_result_without_a_report_matches_the_contract_exactly(self) -> None:
        """Старі креслення (розміщені до цієї зміни) не отримують нових ключів."""
        self.drawings_table.rows[0]["status"] = "processed"

        body = self.reload().json()

        self.assertNotIn("placementReport", body)
        self.assertEqual(
            sorted(body),
            [
                "devices",
                "downloadUrl",
                "downloadUrlExpiresAt",
                "drawing",
                "rooms",
                "sourceDownloadUrl",
                "sourceDownloadUrlExpiresAt",
            ],
        )

    def test_reprocessing_clears_the_stored_report(self) -> None:
        """Приміщення створюються заново: старий звіт до них не належить."""
        self.room_row["height"] = 3.0
        self.place()
        self.assertIn("placementReport", self.reload().json())

        exits_saved = {"status": "ok", "exits": 0, "passages": 0, "warning": None}
        with (
            patch("src.modules.drawings.router.download_dxf_to_tmp", return_value=None),
            patch(
                "src.modules.drawings.router.parse_dxf_rooms_with_scale",
                return_value=([], 0.001),
            ),
            patch(
                "src.modules.drawings.router._save_dxf_layout",
                return_value=exits_saved,
            ),
        ):
            response = self.client.post(f"/api/v1/drawings/{self.drawing_id}/process")

        self.assertEqual(response.status_code, 200, response.text)
        self.assertIsNone(self.drawings_table.rows[0]["placement_report"])
        self.assertNotIn("placementReport", self.reload().json())

    def test_report_of_a_failed_drawing_is_not_shown(self) -> None:
        self.place()
        self.drawings_table.rows[0]["status"] = "error"

        self.assertNotIn("placementReport", self.reload().json())

    # ── Зміна контуру приміщення після створення зон ──

    def test_zone_left_outside_a_narrowed_room_is_not_placed(self) -> None:
        """Приміщення 10×8 м звузили до 5×8 м; зона 10×8 м лишилась старою."""
        stale = self.add_zone(rect_mm(0, 0, 10_000, 8_000), 3.0, "Стара зона")
        self.room_row["polygon"] = rect_mm(0, 0, 5_000, 8_000)

        response = self.place()

        body = response.json()
        self.assertEqual(response.status_code, 200, response.text)
        by_scope = {item["scope"]: item for item in body["placements"]}
        self.assertEqual(by_scope["zone"]["zone_id"], stale["id"])
        self.assertEqual(by_scope["zone"]["status"], "insufficient_data")
        self.assertIn("виходить за межі приміщення", by_scope["zone"]["reason"])
        self.assertIn("remainder", by_scope)
        self.assertEqual(body["placement_status"], "insufficient_data")
        self.assertEqual(body["device_count"], 0)
        self.assertEqual(self.devices_table.inserts, [])
        report = self.reload().json()["placementReport"]
        self.assertEqual(report["skipped"], body["skipped"])

    def test_full_split_by_adjacent_zones_is_complete(self) -> None:
        self.add_zone(rect_mm(0, 0, 5_000, 8_000), 3.0, "Ліва")
        self.add_zone(rect_mm(5_000, 0, 10_000, 8_000), 8.0, "Права")

        response = self.place()

        body = response.json()
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(
            sorted(item["scope"] for item in body["placements"]), ["zone", "zone"]
        )
        self.assertEqual(body["placement_status"], "complete")
        self.assertEqual(body["skipped"], [])


if __name__ == "__main__":
    unittest.main()
