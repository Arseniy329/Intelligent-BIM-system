import shutil
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
from tests.fakes import FakeTable, fake_supabase


class TestDevicesApi(unittest.TestCase):
    def setUp(self) -> None:
        self.user_id = str(uuid4())
        self.drawing_id = str(uuid4())
        self.room_id = str(uuid4())
        self.device_id = str(uuid4())
        self.current_user = CurrentUser(id=self.user_id, role="engineer")

        self.drawing_row: dict[str, Any] = {
            "id": self.drawing_id,
            "owner_id": self.user_id,
            "status": "processed",
            "units": "mm",
        }
        self.device_row: dict[str, Any] = {
            "id": self.device_id,
            "drawing_id": self.drawing_id,
            "room_id": self.room_id,
            "rule_id": str(uuid4()),
            "type": "smoke_detector",
            "layer": "SYS_FIRE_SENSORS",
            "x": 1000.0,
            "y": 2000.0,
        }
        self.other_drawing_room_id = str(uuid4())
        self.drawings_table = FakeTable([self.drawing_row])
        self.rooms_table = FakeTable(
            [
                {"id": self.room_id, "drawing_id": self.drawing_id},
                {"id": self.other_drawing_room_id, "drawing_id": str(uuid4())},
            ]
        )
        self.devices_table = FakeTable([self.device_row])
        self.supabase = fake_supabase(
            {
                "drawings": self.drawings_table,
                "rooms": self.rooms_table,
                "devices": self.devices_table,
            }
        )

        regenerate = patch("src.modules.devices.router.generate_and_upload_result_dxf")
        self.regenerate = regenerate.start()
        self.addCleanup(regenerate.stop)

        app.dependency_overrides[get_current_user] = lambda: self.current_user
        app.dependency_overrides[get_supabase_client] = lambda: self.supabase
        self.client = TestClient(app)

    def tearDown(self) -> None:
        app.dependency_overrides.clear()

    def assert_regenerated_once(self) -> None:
        self.regenerate.assert_called_once_with(self.drawing_id, self.supabase)

    def assert_nothing_written(self) -> None:
        self.assertEqual(self.devices_table.inserts, [])
        self.assertEqual(self.devices_table.updates, [])
        self.assertEqual(self.devices_table.deleted, [])
        self.regenerate.assert_not_called()

    # POST /drawings/{id}/devices

    def test_create_device(self) -> None:
        response = self.client.post(
            f"/api/v1/drawings/{self.drawing_id}/devices",
            json={
                "type": "heat_detector",
                "position": {"x": 1500, "y": 2500.5},
                "roomId": self.room_id,
            },
        )
        self.assertEqual(response.status_code, 201, response.text)
        body = response.json()
        self.assertEqual(body["drawingId"], self.drawing_id)
        self.assertEqual(body["roomId"], self.room_id)
        self.assertEqual(body["type"], "heat_detector")
        self.assertEqual(body["position"], {"x": 1500.0, "y": 2500.5})
        self.assertEqual(body["layer"], "SYS_FIRE_SENSORS")

        inserted = self.devices_table.inserts[-1]
        self.assertEqual(inserted["id"], body["id"])
        self.assertIsNone(inserted["rule_id"])
        self.assertEqual((inserted["x"], inserted["y"]), (1500.0, 2500.5))
        self.assert_regenerated_once()

    def test_create_device_without_room(self) -> None:
        response = self.client.post(
            f"/api/v1/drawings/{self.drawing_id}/devices",
            json={"type": "smoke_detector", "position": {"x": 0, "y": 0}},
        )
        self.assertEqual(response.status_code, 201, response.text)
        self.assertIsNone(response.json()["roomId"])
        self.assertIsNone(self.devices_table.inserts[-1]["room_id"])

    def test_create_device_rejects_invalid_input(self) -> None:
        cases: list[dict[str, Any]] = [
            {},
            {"type": "smoke_detector"},
            {"position": {"x": 0, "y": 0}},
            {"type": "laser", "position": {"x": 0, "y": 0}},
            {"type": "sounder", "position": {"x": 0}},
            {"type": "sounder", "position": {"x": 0, "y": 0}, "roomId": "room-1"},
            {"type": "sounder", "position": {"x": 0, "y": 0}, "layer": "OTHER"},
            # A room of another drawing.
            {
                "type": "sounder",
                "position": {"x": 0, "y": 0},
                "roomId": self.other_drawing_room_id,
            },
            # A room that does not exist.
            {"type": "sounder", "position": {"x": 0, "y": 0}, "roomId": str(uuid4())},
        ]
        for payload in cases:
            with self.subTest(payload=payload):
                response = self.client.post(
                    f"/api/v1/drawings/{self.drawing_id}/devices", json=payload
                )
                self.assertEqual(response.status_code, 422, response.text)
        self.assert_nothing_written()

    def test_create_device_requires_processed_drawing(self) -> None:
        for drawing_status in ("uploaded", "processing", "error"):
            with self.subTest(status=drawing_status):
                self.drawing_row["status"] = drawing_status
                response = self.client.post(
                    f"/api/v1/drawings/{self.drawing_id}/devices",
                    json={"type": "smoke_detector", "position": {"x": 0, "y": 0}},
                )
                self.assertEqual(response.status_code, 409, response.text)
        self.assert_nothing_written()

    def test_create_device_access(self) -> None:
        payload = {"type": "smoke_detector", "position": {"x": 0, "y": 0}}
        missing = self.client.post(f"/api/v1/drawings/{uuid4()}/devices", json=payload)
        self.assertEqual(missing.status_code, 404)
        bad_id = self.client.post("/api/v1/drawings/nope/devices", json=payload)
        self.assertEqual(bad_id.status_code, 422)
        self.drawing_row["owner_id"] = str(uuid4())
        forbidden = self.client.post(
            f"/api/v1/drawings/{self.drawing_id}/devices", json=payload
        )
        self.assertEqual(forbidden.status_code, 403)
        self.assert_nothing_written()

        self.current_user = CurrentUser(id=self.user_id, role="admin")
        admin = self.client.post(
            f"/api/v1/drawings/{self.drawing_id}/devices", json=payload
        )
        self.assertEqual(admin.status_code, 201, admin.text)

    def test_regeneration_failure_is_502_and_keeps_the_change(self) -> None:
        self.regenerate.side_effect = RuntimeError("storage down")
        response = self.client.post(
            f"/api/v1/drawings/{self.drawing_id}/devices",
            json={"type": "smoke_detector", "position": {"x": 0, "y": 0}},
        )
        self.assertEqual(response.status_code, 502, response.text)
        self.assertEqual(len(self.devices_table.inserts), 1)

    # PATCH /devices/{id}

    def test_move_device(self) -> None:
        response = self.client.patch(
            f"/api/v1/devices/{self.device_id}",
            json={"position": {"x": 3000, "y": 4000}},
        )
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["position"], {"x": 3000.0, "y": 4000.0})
        self.assertEqual(body["type"], "smoke_detector")
        self.assertEqual(body["roomId"], self.room_id)
        self.assertEqual(self.devices_table.updates, [{"x": 3000.0, "y": 4000.0}])
        self.assert_regenerated_once()

    def test_change_type_and_detach_room(self) -> None:
        response = self.client.patch(
            f"/api/v1/devices/{self.device_id}",
            json={"type": "manual_call_point", "roomId": None},
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["type"], "manual_call_point")
        self.assertIsNone(response.json()["roomId"])
        self.assertEqual(
            self.devices_table.updates,
            [{"type": "manual_call_point", "room_id": None}],
        )

    def test_patch_device_rejects_invalid_input(self) -> None:
        cases: list[dict[str, Any]] = [
            {},
            {"type": None},
            {"position": None},
            {"type": "laser"},
            {"layer": "OTHER"},
            {"roomId": self.other_drawing_room_id},
        ]
        for payload in cases:
            with self.subTest(payload=payload):
                response = self.client.patch(
                    f"/api/v1/devices/{self.device_id}", json=payload
                )
                self.assertEqual(response.status_code, 422, response.text)
        self.assert_nothing_written()

    def test_patch_device_access_and_status(self) -> None:
        payload = {"position": {"x": 1, "y": 1}}
        missing = self.client.patch(f"/api/v1/devices/{uuid4()}", json=payload)
        self.assertEqual(missing.status_code, 404)
        bad_id = self.client.patch("/api/v1/devices/nope", json=payload)
        self.assertEqual(bad_id.status_code, 422)

        self.drawing_row["status"] = "processing"
        conflict = self.client.patch(f"/api/v1/devices/{self.device_id}", json=payload)
        self.assertEqual(conflict.status_code, 409)

        self.drawing_row["owner_id"] = str(uuid4())
        forbidden = self.client.patch(f"/api/v1/devices/{self.device_id}", json=payload)
        self.assertEqual(forbidden.status_code, 403)
        self.assert_nothing_written()

    # DELETE /devices/{id}

    def test_delete_device(self) -> None:
        response = self.client.delete(f"/api/v1/devices/{self.device_id}")
        self.assertEqual(response.status_code, 204, response.text)
        self.assertEqual(response.content, b"")
        self.assertEqual(self.devices_table.rows, [])
        self.assert_regenerated_once()

    def test_delete_device_access_and_status(self) -> None:
        missing = self.client.delete(f"/api/v1/devices/{uuid4()}")
        self.assertEqual(missing.status_code, 404)

        self.drawing_row["status"] = "uploaded"
        conflict = self.client.delete(f"/api/v1/devices/{self.device_id}")
        self.assertEqual(conflict.status_code, 409)

        self.drawing_row["status"] = "processed"
        self.drawing_row["owner_id"] = str(uuid4())
        forbidden = self.client.delete(f"/api/v1/devices/{self.device_id}")
        self.assertEqual(forbidden.status_code, 403)
        self.assert_nothing_written()


class TestDeviceEditsResultDxf(unittest.TestCase):
    """Device edits through the API produce a real result DXF with typed blocks.

    Only storage is faked: the source download returns a local DXF and the
    upload keeps the bytes, so the DXF written by ezdxf is read back as-is.
    """

    def setUp(self) -> None:
        self.temp_dir = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.temp_dir, ignore_errors=True)
        source = ezdxf.new("R2010")
        source.modelspace().add_lwpolyline(
            [(0, 0), (5000, 0), (5000, 5000), (0, 5000)], close=True
        )
        self.source_dxf = self.temp_dir / "source.dxf"
        source.saveas(str(self.source_dxf))

        self.user_id = str(uuid4())
        self.drawing_id = str(uuid4())
        self.device_id = str(uuid4())
        self.devices_table = FakeTable(
            [
                {
                    "id": self.device_id,
                    "drawing_id": self.drawing_id,
                    "room_id": None,
                    "rule_id": str(uuid4()),
                    "type": "smoke_detector",
                    "layer": "SYS_FIRE_SENSORS",
                    "x": 1000.0,
                    "y": 1000.0,
                }
            ]
        )
        drawings_table = FakeTable(
            [
                {
                    "id": self.drawing_id,
                    "owner_id": self.user_id,
                    "status": "processed",
                    "units": "mm",
                    "storage_path": f"{self.user_id}/{self.drawing_id}/source.dxf",
                }
            ]
        )
        self.supabase = fake_supabase(
            {
                "drawings": drawings_table,
                "rooms": FakeTable([]),
                "devices": self.devices_table,
            }
        )
        self.uploads: list[bytes] = []
        self.supabase.storage.from_.return_value.upload.side_effect = (
            lambda path, file, file_options: self.uploads.append(
                Path(file).read_bytes()
            )
        )

        download = patch(
            "src.modules.drawings.service.download_dxf_to_tmp",
            side_effect=self._download_copy,
        )
        download.start()
        self.addCleanup(download.stop)

        current_user = CurrentUser(id=self.user_id, role="engineer")
        app.dependency_overrides[get_current_user] = lambda: current_user
        app.dependency_overrides[get_supabase_client] = lambda: self.supabase
        self.addCleanup(app.dependency_overrides.clear)
        self.client = TestClient(app)

    def _download_copy(self, *_args: Any, **_kwargs: Any) -> Path:
        # The generator deletes the downloaded file, so hand out a fresh copy.
        copy = self.temp_dir / f"{uuid4()}.dxf"
        shutil.copy(self.source_dxf, copy)
        return copy

    def last_result_blocks(self) -> dict[tuple[float, float], str]:
        result = self.temp_dir / f"result-{len(self.uploads)}.dxf"
        result.write_bytes(self.uploads[-1])
        msp = ezdxf.readfile(str(result)).modelspace()
        return {
            (e.dxf.insert.x, e.dxf.insert.y): e.dxf.name
            for e in msp
            if e.dxftype() == "INSERT" and e.dxf.layer == "SYS_FIRE_SENSORS"
        }

    def test_each_device_type_is_exported_with_its_own_block(self) -> None:
        created = {
            "heat_detector": (2000.0, 1000.0),
            "manual_call_point": (3000.0, 1000.0),
            "sounder": (4000.0, 1000.0),
        }
        for device_type, (x, y) in created.items():
            response = self.client.post(
                f"/api/v1/drawings/{self.drawing_id}/devices",
                json={"type": device_type, "position": {"x": x, "y": y}},
            )
            self.assertEqual(response.status_code, 201, response.text)

        self.assertEqual(len(self.uploads), 3)
        self.assertEqual(
            self.last_result_blocks(),
            {
                (1000.0, 1000.0): "FIRE_DET_SMOKE",
                (2000.0, 1000.0): "FIRE_DET_HEAT",
                (3000.0, 1000.0): "FIRE_MCP",
                (4000.0, 1000.0): "FIRE_SOUNDER",
            },
        )

    def test_changing_type_and_position_updates_the_exported_block(self) -> None:
        response = self.client.patch(
            f"/api/v1/devices/{self.device_id}",
            json={"type": "manual_call_point", "position": {"x": 1500, "y": 2500}},
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.last_result_blocks(), {(1500.0, 2500.0): "FIRE_MCP"})

        response = self.client.delete(f"/api/v1/devices/{self.device_id}")
        self.assertEqual(response.status_code, 204, response.text)
        self.assertEqual(self.last_result_blocks(), {})


if __name__ == "__main__":
    unittest.main()
