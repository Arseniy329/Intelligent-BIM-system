import io
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock
from uuid import uuid4

import ezdxf
from fastapi.testclient import TestClient

API_DIR = Path(__file__).resolve().parent.parent
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

from src.contracts.generated import DrawingResult
from src.core.auth import CurrentUser, get_current_user
from src.infrastructure.supabase import get_supabase_client
from src.main import app

FIXTURES_DIR = API_DIR / "tests" / "fixtures" / "test_drawing_dxf"


class TestDrawingsProcessEndpoint(unittest.TestCase):
    def setUp(self) -> None:
        self.user_id = str(uuid4())
        self.current_user = CurrentUser(
            id=self.user_id,
            email="engineer@example.com",
            role="engineer",
        )
        self.mock_supabase = MagicMock()

        app.dependency_overrides[get_current_user] = lambda: self.current_user
        app.dependency_overrides[get_supabase_client] = lambda: self.mock_supabase
        self.client = TestClient(app)

    def tearDown(self) -> None:
        app.dependency_overrides.clear()

    def test_process_drawing_success(self) -> None:
        """Verify POST /process extracts rooms, deletes old rooms, inserts new rooms,

        and updates status to 'processing'.
        """
        drawing_id = str(uuid4())
        fixture_path = FIXTURES_DIR / "01_simple_rooms_mm.dxf"
        self.assertTrue(fixture_path.exists(), f"Fixture missing: {fixture_path}")

        drawing_record = {
            "id": drawing_id,
            "owner_id": self.user_id,
            "original_file_name": "01_simple_rooms_mm.dxf",
            "storage_path": f"{self.user_id}/{drawing_id}/source.dxf",
            "units": "mm",
            "status": "uploaded",
            "created_at": "2026-10-31T12:00:00Z",
        }

        # Mock drawing select and update
        mock_drawings_query = MagicMock()
        mock_drawings_query.select.return_value = mock_drawings_query
        mock_drawings_query.eq.return_value = mock_drawings_query
        mock_drawings_query.single.return_value = mock_drawings_query
        mock_drawings_query.execute.return_value = MagicMock(data=drawing_record)
        mock_drawings_query.update.return_value = mock_drawings_query

        # Mock rooms delete and insert
        mock_rooms_table = MagicMock()
        mock_rooms_delete_query = MagicMock()
        mock_rooms_delete_query.eq.return_value = mock_rooms_delete_query
        mock_rooms_delete_query.execute.return_value = MagicMock(data=[])
        mock_rooms_table.delete.return_value = mock_rooms_delete_query

        inserted_rooms_payload: list[dict] = []

        def mock_rooms_insert(rows: list[dict]) -> MagicMock:
            inserted_rooms_payload.extend(rows)
            res = MagicMock()
            res.execute.return_value = MagicMock(data=rows)
            return res

        mock_rooms_table.insert.side_effect = mock_rooms_insert

        def table_side_effect(table_name: str) -> MagicMock:
            if table_name == "drawings":
                return mock_drawings_query
            if table_name == "rooms":
                return mock_rooms_table
            return MagicMock()

        self.mock_supabase.table.side_effect = table_side_effect

        # Mock storage download
        mock_storage_bucket = MagicMock()
        mock_storage_bucket.download.return_value = fixture_path.read_bytes()
        self.mock_supabase.storage.from_.return_value = mock_storage_bucket

        tmp_dir = Path("/tmp")
        files_before = set(tmp_dir.glob("*.dxf"))

        response = self.client.post(f"/api/v1/drawings/{drawing_id}/process")

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["drawing_id"], drawing_id)
        self.assertEqual(data["status"], "processing")

        # Verify old rooms deleted
        mock_rooms_table.delete.assert_called_once()
        mock_rooms_delete_query.eq.assert_called_with("drawing_id", drawing_id)

        # Verify new rooms inserted
        self.assertGreater(len(inserted_rooms_payload), 0)
        for room in inserted_rooms_payload:
            self.assertEqual(room["drawing_id"], drawing_id)
            self.assertIn("name", room)
            self.assertIn("polygon", room)
            self.assertGreaterEqual(len(room["polygon"]), 3)
            self.assertGreater(room["area"], 0)

        # Verify drawings table status updated to 'processing'
        mock_drawings_query.update.assert_called_with(
            {"status": "processing", "error_message": None}
        )

        # Verify /tmp cleanup
        files_after = set(tmp_dir.glob("*.dxf"))
        self.assertEqual(len(files_after - files_before), 0)

    def test_process_drawing_error_updates_drawing_status(self) -> None:
        """Verify parsing error sets status to 'error' and saves error_message."""
        drawing_id = str(uuid4())
        drawing_record = {
            "id": drawing_id,
            "owner_id": self.user_id,
            "original_file_name": "corrupted.dxf",
            "storage_path": f"{self.user_id}/{drawing_id}/corrupted.dxf",
            "units": "mm",
            "status": "uploaded",
            "created_at": "2026-10-31T12:00:00Z",
        }

        mock_drawings_query = MagicMock()
        mock_drawings_query.select.return_value = mock_drawings_query
        mock_drawings_query.eq.return_value = mock_drawings_query
        mock_drawings_query.single.return_value = mock_drawings_query
        mock_drawings_query.execute.return_value = MagicMock(data=drawing_record)
        mock_drawings_query.update.return_value = mock_drawings_query

        self.mock_supabase.table.return_value = mock_drawings_query

        # Provide corrupted DXF content
        mock_storage_bucket = MagicMock()
        mock_storage_bucket.download.return_value = b"NOT A VALID DXF FILE"
        self.mock_supabase.storage.from_.return_value = mock_storage_bucket

        response = self.client.post(f"/api/v1/drawings/{drawing_id}/process")
        self.assertIn(response.status_code, [400, 500])

        # Verify status set to error with error message
        mock_drawings_query.update.assert_called()
        update_args = mock_drawings_query.update.call_args[0][0]
        self.assertEqual(update_args["status"], "error")
        self.assertTrue(len(update_args["error_message"]) > 0)

    def test_process_drawing_not_found(self) -> None:
        """Verify 404 when drawing does not exist in database."""
        mock_query = MagicMock()
        mock_query.select.return_value = mock_query
        mock_query.eq.return_value = mock_query
        mock_query.single.return_value = mock_query
        mock_query.execute.return_value = MagicMock(data=None)

        self.mock_supabase.table.return_value = mock_query

        response = self.client.post(f"/api/v1/drawings/{uuid4()}/process")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["detail"], "Drawing not found")

    def test_process_drawing_forbidden_for_other_user(self) -> None:
        """Verify 403 when drawing belongs to another engineer."""
        other_user_id = str(uuid4())
        drawing_id = str(uuid4())
        drawing_record = {
            "id": drawing_id,
            "owner_id": other_user_id,
            "original_file_name": "plan.dxf",
            "storage_path": f"{other_user_id}/{drawing_id}/source.dxf",
            "units": "mm",
            "status": "uploaded",
            "created_at": "2026-10-31T12:00:00Z",
        }

        mock_query = MagicMock()
        mock_query.select.return_value = mock_query
        mock_query.eq.return_value = mock_query
        mock_query.single.return_value = mock_query
        mock_query.execute.return_value = MagicMock(data=drawing_record)

        self.mock_supabase.table.return_value = mock_query

        response = self.client.post(f"/api/v1/drawings/{drawing_id}/process")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["detail"], "Forbidden")

    def test_process_drawing_admin_allowed_for_any_drawing(self) -> None:
        """Verify admin can process drawings owned by other users."""
        admin_user = CurrentUser(
            id=str(uuid4()),
            email="admin@example.com",
            role="admin",
        )
        app.dependency_overrides[get_current_user] = lambda: admin_user

        other_user_id = str(uuid4())
        drawing_id = str(uuid4())
        fixture_path = FIXTURES_DIR / "01_simple_rooms_mm.dxf"

        drawing_record = {
            "id": drawing_id,
            "owner_id": other_user_id,
            "original_file_name": "plan.dxf",
            "storage_path": f"{other_user_id}/{drawing_id}/source.dxf",
            "units": "mm",
            "status": "uploaded",
            "created_at": "2026-10-31T12:00:00Z",
        }

        mock_drawing_query = MagicMock()
        mock_drawing_query.select.return_value = mock_drawing_query
        mock_drawing_query.eq.return_value = mock_drawing_query
        mock_drawing_query.single.return_value = mock_drawing_query
        mock_drawing_query.execute.return_value = MagicMock(data=drawing_record)
        mock_drawing_query.update.return_value = mock_drawing_query

        mock_rooms_table = MagicMock()
        mock_rooms_delete = MagicMock()
        mock_rooms_delete.eq.return_value = mock_rooms_delete
        mock_rooms_delete.execute.return_value = MagicMock(data=[])
        mock_rooms_table.delete.return_value = mock_rooms_delete
        mock_rooms_insert = MagicMock()
        mock_rooms_insert.execute.return_value = MagicMock(data=[])
        mock_rooms_table.insert.return_value = mock_rooms_insert

        def table_side_effect(table_name: str) -> MagicMock:
            if table_name == "drawings":
                return mock_drawing_query
            if table_name == "rooms":
                return mock_rooms_table
            return MagicMock()

        self.mock_supabase.table.side_effect = table_side_effect

        mock_storage_bucket = MagicMock()
        mock_storage_bucket.download.return_value = fixture_path.read_bytes()
        self.mock_supabase.storage.from_.return_value = mock_storage_bucket

        response = self.client.post(f"/api/v1/drawings/{drawing_id}/process")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["drawing_id"], drawing_id)
        self.assertEqual(data["status"], "processing")

    def test_place_devices_success(self) -> None:
        """Verify POST /place fetches rooms, calculates placement, deletes old devices,

        inserts new devices, generates/uploads DXF, and updates status to 'processed'.
        """
        drawing_id = str(uuid4())
        room_id = str(uuid4())
        fixture_path = FIXTURES_DIR / "01_simple_rooms_mm.dxf"

        drawing_record = {
            "id": drawing_id,
            "owner_id": self.user_id,
            "original_file_name": "01_simple_rooms_mm.dxf",
            "storage_path": f"{self.user_id}/{drawing_id}/source.dxf",
            "units": "mm",
            "status": "processing",
            "created_at": "2026-10-31T12:00:00Z",
        }

        rooms_data = [
            {
                "id": room_id,
                "drawing_id": drawing_id,
                "name": "Test Room",
                "type": None,
                "height": 3.0,
                "area": 50.0,
                "polygon": [
                    {"x": 0.0, "y": 0.0},
                    {"x": 5000.0, "y": 0.0},
                    {"x": 5000.0, "y": 5000.0},
                    {"x": 0.0, "y": 5000.0},
                ],
            }
        ]

        rules_data = [{"id": str(uuid4()), "threshold": 2000.0, "status": "approved"}]

        mock_drawings_query = MagicMock()
        mock_drawings_query.select.return_value = mock_drawings_query
        mock_drawings_query.eq.return_value = mock_drawings_query
        mock_drawings_query.single.return_value = mock_drawings_query
        mock_drawings_query.execute.return_value = MagicMock(data=drawing_record)
        mock_drawings_query.update.return_value = mock_drawings_query

        mock_rooms_query = MagicMock()
        mock_rooms_query.select.return_value = mock_rooms_query
        mock_rooms_query.eq.return_value = mock_rooms_query
        mock_rooms_query.execute.return_value = MagicMock(data=rooms_data)

        mock_rules_query = MagicMock()
        mock_rules_query.select.return_value = mock_rules_query
        mock_rules_query.limit.return_value = mock_rules_query
        mock_rules_query.execute.return_value = MagicMock(data=rules_data)

        inserted_devices: list[dict] = []
        mock_devices_table = MagicMock()
        mock_devices_delete = MagicMock()
        mock_devices_delete.eq.return_value = mock_devices_delete
        mock_devices_delete.execute.return_value = MagicMock(data=[])
        mock_devices_table.delete.return_value = mock_devices_delete

        def mock_devices_insert(rows: list[dict]) -> MagicMock:
            inserted_devices.extend(rows)
            res = MagicMock()
            res.execute.return_value = MagicMock(data=rows)
            return res

        mock_devices_table.insert.side_effect = mock_devices_insert

        # Mock devices query for service function generate_and_upload_result_dxf
        mock_devices_select_query = MagicMock()
        mock_devices_select_query.eq.return_value = mock_devices_select_query

        def devices_execute() -> MagicMock:
            return MagicMock(data=inserted_devices)

        mock_devices_select_query.execute.side_effect = devices_execute
        mock_devices_table.select.return_value = mock_devices_select_query

        def table_side_effect(table_name: str) -> MagicMock:
            if table_name == "drawings":
                return mock_drawings_query
            if table_name == "rooms":
                return mock_rooms_query
            if table_name == "rules":
                return mock_rules_query
            if table_name == "devices":
                return mock_devices_table
            return MagicMock()

        self.mock_supabase.table.side_effect = table_side_effect

        uploaded_payloads: list[dict] = []

        def mock_upload(path: str, file: str | bytes, file_options: dict) -> dict:
            file_data = Path(file).read_bytes() if isinstance(file, str) else file
            uploaded_payloads.append(
                {
                    "path": path,
                    "file": file,
                    "file_data": file_data,
                    "file_options": file_options,
                }
            )
            return {"Key": path}

        mock_storage_bucket = MagicMock()
        mock_storage_bucket.download.return_value = fixture_path.read_bytes()
        mock_storage_bucket.upload.side_effect = mock_upload
        self.mock_supabase.storage.from_.return_value = mock_storage_bucket

        tmp_dir = Path("/tmp")
        files_before = set(tmp_dir.glob("*.dxf"))

        response = self.client.post(f"/api/v1/drawings/{drawing_id}/place")

        self.assertEqual(response.status_code, 200)
        data = response.json()
        expected_storage_path = f"{self.user_id}/{drawing_id}/result.dxf"
        self.assertEqual(data["drawing_id"], drawing_id)
        self.assertEqual(data["status"], "processed")
        self.assertEqual(data["result_path"], expected_storage_path)

        # Verify old devices deleted
        mock_devices_table.delete.assert_called_once()
        mock_devices_delete.eq.assert_called_with("drawing_id", drawing_id)

        # Verify new devices inserted
        self.assertGreater(len(inserted_devices), 0)
        for dev in inserted_devices:
            self.assertEqual(dev["drawing_id"], drawing_id)
            self.assertEqual(dev["room_id"], room_id)
            self.assertIn("x", dev)
            self.assertIn("y", dev)
            self.assertEqual(dev["type"], "smoke_detector")
            self.assertEqual(dev["layer"], "SYS_FIRE_SENSORS")

        # Verify drawing status updated to 'processed'
        mock_drawings_query.update.assert_called_with(
            {"status": "processed", "error_message": None}
        )

        # Verify DXF uploaded
        self.assertEqual(len(uploaded_payloads), 1)
        self.assertEqual(uploaded_payloads[0]["path"], expected_storage_path)

        uploaded_doc = ezdxf.read(
            io.StringIO(
                uploaded_payloads[0]["file_data"].decode("utf-8", errors="ignore")
            )
        )
        self.assertIn("SYS_FIRE_SENSORS", uploaded_doc.layers)

        # Verify /tmp cleanup
        files_after = set(tmp_dir.glob("*.dxf"))
        self.assertEqual(len(files_after - files_before), 0)

    def test_place_devices_no_rooms_returns_400(self) -> None:
        """Verify 400 when drawing has no rooms saved in DB."""
        drawing_id = str(uuid4())
        drawing_record = {
            "id": drawing_id,
            "owner_id": self.user_id,
            "original_file_name": "plan.dxf",
            "storage_path": f"{self.user_id}/{drawing_id}/source.dxf",
            "units": "mm",
            "status": "processing",
            "created_at": "2026-10-31T12:00:00Z",
        }

        mock_drawings_query = MagicMock()
        mock_drawings_query.select.return_value = mock_drawings_query
        mock_drawings_query.eq.return_value = mock_drawings_query
        mock_drawings_query.single.return_value = mock_drawings_query
        mock_drawings_query.execute.return_value = MagicMock(data=drawing_record)
        mock_drawings_query.update.return_value = mock_drawings_query

        mock_rooms_query = MagicMock()
        mock_rooms_query.select.return_value = mock_rooms_query
        mock_rooms_query.eq.return_value = mock_rooms_query
        mock_rooms_query.execute.return_value = MagicMock(data=[])

        def table_side_effect(table_name: str) -> MagicMock:
            if table_name == "drawings":
                return mock_drawings_query
            if table_name == "rooms":
                return mock_rooms_query
            return MagicMock()

        self.mock_supabase.table.side_effect = table_side_effect

        response = self.client.post(f"/api/v1/drawings/{drawing_id}/place")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "No rooms found for this drawing")

        # Verify drawing status was updated to error
        mock_drawings_query.update.assert_called()
        self.assertEqual(mock_drawings_query.update.call_args[0][0]["status"], "error")

    def test_place_devices_no_rules_returns_400(self) -> None:
        """Verify 400 when no rules are configured in the rules table."""
        drawing_id = str(uuid4())
        drawing_record = {
            "id": drawing_id,
            "owner_id": self.user_id,
            "original_file_name": "plan.dxf",
            "storage_path": f"{self.user_id}/{drawing_id}/source.dxf",
            "units": "mm",
            "status": "processing",
            "created_at": "2026-10-31T12:00:00Z",
        }

        rooms_data = [
            {
                "id": str(uuid4()),
                "drawing_id": drawing_id,
                "name": "Room 1",
                "area": 10.0,
                "polygon": [{"x": 0, "y": 0}, {"x": 10, "y": 0}, {"x": 10, "y": 10}],
            }
        ]

        mock_drawings_query = MagicMock()
        mock_drawings_query.select.return_value = mock_drawings_query
        mock_drawings_query.eq.return_value = mock_drawings_query
        mock_drawings_query.single.return_value = mock_drawings_query
        mock_drawings_query.execute.return_value = MagicMock(data=drawing_record)
        mock_drawings_query.update.return_value = mock_drawings_query

        mock_rooms_query = MagicMock()
        mock_rooms_query.select.return_value = mock_rooms_query
        mock_rooms_query.eq.return_value = mock_rooms_query
        mock_rooms_query.execute.return_value = MagicMock(data=rooms_data)

        mock_rules_query = MagicMock()
        mock_rules_query.select.return_value = mock_rules_query
        mock_rules_query.limit.return_value = mock_rules_query
        mock_rules_query.execute.return_value = MagicMock(data=[])

        def table_side_effect(table_name: str) -> MagicMock:
            if table_name == "drawings":
                return mock_drawings_query
            if table_name == "rooms":
                return mock_rooms_query
            if table_name == "rules":
                return mock_rules_query
            return MagicMock()

        self.mock_supabase.table.side_effect = table_side_effect

        response = self.client.post(f"/api/v1/drawings/{drawing_id}/place")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "No fire safety rules available")

        # Verify drawing status was updated to error
        mock_drawings_query.update.assert_called()
        self.assertEqual(mock_drawings_query.update.call_args[0][0]["status"], "error")

    def test_get_drawing_detail_processed(self) -> None:
        """Verify GET /drawings/{id} returns DrawingResult with rooms, devices,

        and signed download URL for processed drawings.
        """
        drawing_id = str(uuid4())
        room_id = str(uuid4())
        device_id = str(uuid4())

        drawing_record = {
            "id": drawing_id,
            "owner_id": self.user_id,
            "original_file_name": "office.dxf",
            "storage_path": f"{self.user_id}/{drawing_id}/source.dxf",
            "units": "mm",
            "status": "processed",
            "error_message": None,
            "created_at": "2026-10-31T12:00:00Z",
        }

        rooms_data = [
            {
                "id": room_id,
                "drawing_id": drawing_id,
                "name": "Room A",
                "type": "office",
                "height": 3.0,
                "area": 25.0,
                "polygon": [
                    {"x": 0.0, "y": 0.0},
                    {"x": 5000.0, "y": 0.0},
                    {"x": 5000.0, "y": 5000.0},
                ],
            }
        ]

        devices_data = [
            {
                "id": device_id,
                "drawing_id": drawing_id,
                "room_id": room_id,
                "type": "smoke_detector",
                "x": 2500.0,
                "y": 2500.0,
                "layer": "SYS_FIRE_SENSORS",
            }
        ]

        mock_drawings_query = MagicMock()
        mock_drawings_query.select.return_value = mock_drawings_query
        mock_drawings_query.eq.return_value = mock_drawings_query
        mock_drawings_query.single.return_value = mock_drawings_query
        mock_drawings_query.execute.return_value = MagicMock(data=drawing_record)

        mock_rooms_query = MagicMock()
        mock_rooms_query.select.return_value = mock_rooms_query
        mock_rooms_query.eq.return_value = mock_rooms_query
        mock_rooms_query.execute.return_value = MagicMock(data=rooms_data)

        mock_devices_query = MagicMock()
        mock_devices_query.select.return_value = mock_devices_query
        mock_devices_query.eq.return_value = mock_devices_query
        mock_devices_query.execute.return_value = MagicMock(data=devices_data)

        def table_side_effect(table_name: str) -> MagicMock:
            if table_name == "drawings":
                return mock_drawings_query
            if table_name == "rooms":
                return mock_rooms_query
            if table_name == "devices":
                return mock_devices_query
            return MagicMock()

        self.mock_supabase.table.side_effect = table_side_effect

        mock_bucket = MagicMock()
        mock_bucket.create_signed_url.return_value = {
            "signedUrl": f"https://mock.supabase.co/storage/v1/object/sign/drawings/{self.user_id}/{drawing_id}/result.dxf"
        }
        self.mock_supabase.storage.from_.return_value = mock_bucket

        response = self.client.get(f"/api/v1/drawings/{drawing_id}")
        self.assertEqual(response.status_code, 200)

        # Validate strictly matches DrawingResult contract
        result = DrawingResult.model_validate(response.json())
        self.assertEqual(str(result.drawing.id), drawing_id)
        self.assertEqual(result.drawing.status.value, "processed")
        self.assertEqual(len(result.rooms), 1)
        self.assertEqual(result.rooms[0].name, "Room A")
        self.assertEqual(len(result.devices), 1)
        self.assertEqual(result.devices[0].position.x, 2500.0)
        self.assertIsNotNone(result.downloadUrl)
        self.assertIsNotNone(result.downloadUrlExpiresAt)

    def test_get_drawing_detail_unprocessed(self) -> None:
        """Verify GET /drawings/{id} for uploaded drawing returns flat format."""
        drawing_id = str(uuid4())
        drawing_record = {
            "id": drawing_id,
            "owner_id": self.user_id,
            "original_file_name": "office.dxf",
            "storage_path": f"{self.user_id}/{drawing_id}/source.dxf",
            "units": "mm",
            "status": "uploaded",
            "error_message": None,
            "created_at": "2026-10-31T12:00:00Z",
        }

        mock_drawings_query = MagicMock()
        mock_drawings_query.select.return_value = mock_drawings_query
        mock_drawings_query.eq.return_value = mock_drawings_query
        mock_drawings_query.single.return_value = mock_drawings_query
        mock_drawings_query.execute.return_value = MagicMock(data=drawing_record)

        self.mock_supabase.table.return_value = mock_drawings_query

        mock_bucket = MagicMock()
        mock_bucket.create_signed_url.return_value = {
            "signedUrl": (
                "https://mock.supabase.co/storage/v1/object/sign/drawings/"
                f"{self.user_id}/{drawing_id}/source.dxf"
            )
        }
        self.mock_supabase.storage.from_.return_value = mock_bucket

        response = self.client.get(f"/api/v1/drawings/{drawing_id}")
        self.assertEqual(response.status_code, 200)

        data = response.json()
        self.assertNotIn("drawing", data)
        self.assertEqual(data["id"], drawing_id)
        self.assertEqual(data["owner_id"], self.user_id)
        self.assertEqual(data["original_file_name"], "office.dxf")
        self.assertEqual(
            data["storage_path"], f"{self.user_id}/{drawing_id}/source.dxf"
        )
        self.assertEqual(data["units"], "mm")
        self.assertEqual(data["status"], "uploaded")
        self.assertTrue(
            data["source_download_url"].startswith("https://mock.supabase.co")
        )
        self.assertIsNotNone(data["source_download_url_expires_at"])

    def test_get_drawing_not_found(self) -> None:
        """Verify 404 when getting non-existent drawing."""
        mock_query = MagicMock()
        mock_query.select.return_value = mock_query
        mock_query.eq.return_value = mock_query
        mock_query.single.return_value = mock_query
        mock_query.execute.return_value = MagicMock(data=None)

        self.mock_supabase.table.return_value = mock_query

        response = self.client.get(f"/api/v1/drawings/{uuid4()}")
        self.assertEqual(response.status_code, 404)

    def test_get_drawing_forbidden_for_other_user(self) -> None:
        """Verify 403 when getting drawing belonging to another user."""
        other_user_id = str(uuid4())
        drawing_id = str(uuid4())
        drawing_record = {
            "id": drawing_id,
            "owner_id": other_user_id,
            "original_file_name": "plan.dxf",
            "storage_path": f"{other_user_id}/{drawing_id}/source.dxf",
            "units": "mm",
            "status": "uploaded",
            "created_at": "2026-10-31T12:00:00Z",
        }

        mock_query = MagicMock()
        mock_query.select.return_value = mock_query
        mock_query.eq.return_value = mock_query
        mock_query.single.return_value = mock_query
        mock_query.execute.return_value = MagicMock(data=drawing_record)

        self.mock_supabase.table.return_value = mock_query

        response = self.client.get(f"/api/v1/drawings/{drawing_id}")
        self.assertEqual(response.status_code, 403)

    def test_full_pipeline_flow_process_place_get(self) -> None:
        """Integration test: POST /process -> POST /place -> GET /drawings/{id}."""
        drawing_id = str(uuid4())
        fixture_path = FIXTURES_DIR / "01_simple_rooms_mm.dxf"

        # Stateful in-memory database simulation
        db: dict[str, list[dict]] = {
            "drawings": [
                {
                    "id": drawing_id,
                    "owner_id": self.user_id,
                    "original_file_name": "01_simple_rooms_mm.dxf",
                    "storage_path": f"{self.user_id}/{drawing_id}/source.dxf",
                    "units": "mm",
                    "status": "uploaded",
                    "error_message": None,
                    "created_at": "2026-10-31T12:00:00Z",
                }
            ],
            "rooms": [],
            "devices": [],
            "rules": [{"id": str(uuid4()), "threshold": 2000.0, "status": "approved"}],
        }

        def mock_table(table_name: str) -> MagicMock:
            query = MagicMock()

            # select
            def select_fn(*args, **kwargs):
                s_query = MagicMock()

                def eq_fn(col, val):
                    eq_q = MagicMock()

                    def single_fn():
                        res = MagicMock()
                        matched = [
                            r
                            for r in db.get(table_name, [])
                            if str(r.get(col)) == str(val)
                        ]
                        res.execute.return_value = MagicMock(
                            data=matched[0] if matched else None
                        )
                        return res

                    def exec_fn():
                        matched = [
                            r
                            for r in db.get(table_name, [])
                            if str(r.get(col)) == str(val)
                        ]
                        return MagicMock(data=matched)

                    eq_q.single = single_fn
                    eq_q.execute = exec_fn
                    return eq_q

                def limit_fn(n):
                    lim_q = MagicMock()
                    lim_q.execute.return_value = MagicMock(
                        data=db.get(table_name, [])[:n]
                    )
                    return lim_q

                def exec_all():
                    return MagicMock(data=db.get(table_name, []))

                s_query.eq = eq_fn
                s_query.limit = limit_fn
                s_query.execute = exec_all
                return s_query

            # insert
            def insert_fn(rows):
                ins_q = MagicMock()
                if isinstance(rows, list):
                    db.setdefault(table_name, []).extend(rows)
                elif isinstance(rows, dict):
                    db.setdefault(table_name, []).append(rows)
                ins_q.execute.return_value = MagicMock(data=rows)
                return ins_q

            # update
            def update_fn(values):
                upd_q = MagicMock()

                def eq_fn(col, val):
                    for r in db.get(table_name, []):
                        if str(r.get(col)) == str(val):
                            r.update(values)
                    res = MagicMock()
                    res.execute.return_value = MagicMock(data=[values])
                    return res

                upd_q.eq = eq_fn
                return upd_q

            # delete
            def delete_fn():
                del_q = MagicMock()

                def eq_fn(col, val):
                    db[table_name] = [
                        r for r in db.get(table_name, []) if str(r.get(col)) != str(val)
                    ]
                    res = MagicMock()
                    res.execute.return_value = MagicMock(data=[])
                    return res

                del_q.eq = eq_fn
                return del_q

            query.select = select_fn
            query.insert = insert_fn
            query.update = update_fn
            query.delete = delete_fn
            return query

        self.mock_supabase.table.side_effect = mock_table

        storage_uploaded: dict[str, bytes] = {}

        def mock_storage_upload(path, file, file_options):
            storage_uploaded[path] = (
                Path(file).read_bytes() if isinstance(file, str) else file
            )
            return {"Key": path}

        def mock_storage_download(path):
            return fixture_path.read_bytes()

        def mock_signed_url(path, expires_in):
            return {
                "signedUrl": f"https://mock.supabase.co/storage/v1/object/sign/{path}"
            }

        mock_bucket = MagicMock()
        mock_bucket.download.side_effect = mock_storage_download
        mock_bucket.upload.side_effect = mock_storage_upload
        mock_bucket.create_signed_url.side_effect = mock_signed_url
        self.mock_supabase.storage.from_.return_value = mock_bucket

        # Step 1: POST /drawings/{id}/process
        process_resp = self.client.post(f"/api/v1/drawings/{drawing_id}/process")
        self.assertEqual(process_resp.status_code, 200)
        self.assertEqual(process_resp.json()["status"], "processing")
        self.assertEqual(db["drawings"][0]["status"], "processing")
        self.assertGreater(len(db["rooms"]), 0)

        # Intermediate check: GET while processing returns flat DrawingDetailResponse
        mid_get_resp = self.client.get(f"/api/v1/drawings/{drawing_id}")
        self.assertEqual(mid_get_resp.status_code, 200)
        mid_data = mid_get_resp.json()
        self.assertNotIn("drawing", mid_data)
        self.assertEqual(mid_data["status"], "processing")
        self.assertTrue(
            mid_data["source_download_url"].startswith("https://mock.supabase.co")
        )
        self.assertIsNotNone(mid_data["source_download_url_expires_at"])

        # Step 2: POST /drawings/{id}/place
        place_resp = self.client.post(f"/api/v1/drawings/{drawing_id}/place")
        self.assertEqual(place_resp.status_code, 200)
        self.assertEqual(place_resp.json()["status"], "processed")
        self.assertEqual(db["drawings"][0]["status"], "processed")
        self.assertGreater(len(db["devices"]), 0)
        result_key = f"{self.user_id}/{drawing_id}/result.dxf"
        self.assertIn(result_key, storage_uploaded)

        # Step 3: GET /drawings/{id}
        get_resp = self.client.get(f"/api/v1/drawings/{drawing_id}")
        self.assertEqual(get_resp.status_code, 200)

        result = DrawingResult.model_validate(get_resp.json())
        self.assertEqual(str(result.drawing.id), drawing_id)
        self.assertEqual(result.drawing.status.value, "processed")
        self.assertEqual(len(result.rooms), len(db["rooms"]))
        self.assertEqual(len(result.devices), len(db["devices"]))
        self.assertIsNotNone(result.downloadUrl)
        self.assertTrue(str(result.downloadUrl).startswith("https://mock.supabase.co"))
        self.assertIsNotNone(result.downloadUrlExpiresAt)


if __name__ == "__main__":
    unittest.main()
