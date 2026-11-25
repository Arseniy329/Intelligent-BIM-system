import io
import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock, patch
from uuid import uuid4

import ezdxf
from fastapi.testclient import TestClient

os.environ.setdefault("SUPABASE_URL", "https://mock.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "mock-service-role-key")

API_DIR = Path(__file__).resolve().parent.parent
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

from src.contracts.generated import DrawingResult
from src.core.auth import CurrentUser, get_current_user
from src.infrastructure.supabase import get_supabase_client
from src.main import app
from src.modules.drawings.router import (
    EXIT_DETECTION_FAILED,
    WARNING_EXIT_DETECTION_FAILED,
)
from src.modules.placement.manual_call_points import (
    WARNING_PASSAGES_IGNORED,
    WARNING_ROUTE_UNCONFIRMED,
)
from tests.fakes import (
    FakeTable,
    fake_replace_dxf_layout,
    fake_supabase,
    set_null_on_room_delete,
)

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
            self.assertEqual(room["source"], "fire_rooms")
            self.assertEqual(room["confirmed"], False)

        # Verify drawings table status updated to 'processing'
        # Приміщення створено заново, тож збережений звіт розміщення скидається.
        mock_drawings_query.update.assert_called_with(
            {"status": "processing", "unit_scale_m": 0.001, "placement_report": None}
        )

        # Verify /tmp cleanup
        files_after = set(tmp_dir.glob("*.dxf"))
        self.assertEqual(len(files_after - files_before), 0)

    def _process_with_rpc(self, rpc_failure: Exception | None) -> dict:
        """POST /process; ``rpc_failure`` ломає запис виходів і проходів у БД."""
        drawing_id = str(uuid4())
        fixture_path = FIXTURES_DIR / "01_simple_rooms_mm.dxf"
        drawing_record = {
            "id": drawing_id,
            "owner_id": self.user_id,
            "original_file_name": "01_simple_rooms_mm.dxf",
            "storage_path": f"{self.user_id}/{drawing_id}/source.dxf",
            "units": "mm",
            "status": "uploaded",
            "created_at": "2026-10-31T12:00:00Z",
        }

        drawings_query = MagicMock()
        for name in ("select", "eq", "single", "update"):
            getattr(drawings_query, name).return_value = drawings_query
        drawings_query.execute.return_value = MagicMock(data=drawing_record)

        rooms_table = MagicMock()
        rooms_table.delete.return_value.eq.return_value.execute.return_value = (
            MagicMock(data=[])
        )
        inserted_rooms: list[dict] = []

        def insert_rooms(rows: list[dict]) -> MagicMock:
            inserted_rooms.extend(rows)
            return MagicMock(execute=MagicMock(return_value=MagicMock(data=rows)))

        rooms_table.insert.side_effect = insert_rooms

        exits_table = MagicMock()
        exits_query = MagicMock()
        exits_query.select.return_value = exits_query
        exits_query.eq.return_value = exits_query
        exits_query.execute.return_value = MagicMock(data=[])
        exits_table.select.return_value = exits_query

        tables = {
            "drawings": drawings_query,
            "rooms": rooms_table,
            "exits": exits_table,
        }
        self.mock_supabase.table.side_effect = lambda name: tables.get(
            name, MagicMock()
        )
        if rpc_failure is not None:
            self.mock_supabase.rpc.side_effect = rpc_failure
        storage_bucket = MagicMock()
        storage_bucket.download.return_value = fixture_path.read_bytes()
        self.mock_supabase.storage.from_.return_value = storage_bucket

        response = self.client.post(f"/api/v1/drawings/{drawing_id}/process")

        return {
            "response": response,
            "rooms": inserted_rooms,
            "exits_table": exits_table,
            "drawings_query": drawings_query,
            "drawing_id": drawing_id,
        }

    def test_process_reports_exit_detection_step_state(self) -> None:
        result = self._process_with_rpc(None)

        self.assertEqual(result["response"].status_code, 200)
        data = result["response"].json()
        self.assertEqual(data["status"], "processing")
        self.assertEqual(data["exit_detection"]["status"], "ok")
        self.assertIsNone(data["exit_detection"]["warning"])
        # Виходи й проходи замінюються однією функцією БД, а не delete + insert.
        self.mock_supabase.rpc.assert_called_once()
        name, params = self.mock_supabase.rpc.call_args.args
        self.assertEqual(name, "replace_dxf_layout")
        self.assertEqual(params["p_drawing_id"], result["drawing_id"])
        result["exits_table"].delete.assert_not_called()
        result["exits_table"].insert.assert_not_called()

    def test_process_shows_a_warning_when_exit_replacement_fails(self) -> None:
        """Збій запису виходів не ламає обробку і не лишається непомітним."""
        result = self._process_with_rpc(RuntimeError("simulated write failure"))

        self.assertEqual(result["response"].status_code, 200)
        data = result["response"].json()
        self.assertEqual(data["status"], "processing")
        self.assertEqual(data["exit_detection"]["status"], "failed")
        self.assertIn("лишено без змін", data["exit_detection"]["warning"])
        # Приміщення розпізнано і збережено, статус креслення оновлено.
        self.assertGreater(len(result["rooms"]), 0)
        # Збій кроку лишається і у звіті креслення: після перезавантаження
        # попередження не зникає.
        result["drawings_query"].update.assert_called_with(
            {
                "status": "processing",
                "unit_scale_m": 0.001,
                "placement_report": {"exit_detection": data["exit_detection"]},
            }
        )
        # Старі виходи не видалялись окремим запитом.
        result["exits_table"].delete.assert_not_called()
        result["exits_table"].insert.assert_not_called()

    def test_process_drawing_fallback_auto_sets_source_and_confirmed(self) -> None:
        """Verify POST /process fallback sets source='auto' and confirmed=False."""
        drawing_id = str(uuid4())
        fixture_path = FIXTURES_DIR / "03_bad_unclosed_meters.dxf"
        self.assertTrue(fixture_path.exists())

        drawing_record = {
            "id": drawing_id,
            "owner_id": self.user_id,
            "original_file_name": "03_bad_unclosed_meters.dxf",
            "storage_path": f"{self.user_id}/{drawing_id}/source.dxf",
            "units": "m",
            "status": "uploaded",
            "created_at": "2026-10-31T12:00:00Z",
        }

        mock_drawings_query = MagicMock()
        mock_drawings_query.select.return_value = mock_drawings_query
        mock_drawings_query.eq.return_value = mock_drawings_query
        mock_drawings_query.single.return_value = mock_drawings_query
        mock_drawings_query.execute.return_value = MagicMock(data=drawing_record)
        mock_drawings_query.update.return_value = mock_drawings_query

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

        mock_storage_bucket = MagicMock()
        mock_storage_bucket.download.return_value = fixture_path.read_bytes()
        self.mock_supabase.storage.from_.return_value = mock_storage_bucket

        response = self.client.post(f"/api/v1/drawings/{drawing_id}/process")

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["drawing_id"], drawing_id)
        self.assertEqual(data["status"], "processing")

        self.assertGreater(len(inserted_rooms_payload), 0)
        for room in inserted_rooms_payload:
            self.assertEqual(room["drawing_id"], drawing_id)
            self.assertEqual(room["source"], "auto")
            self.assertEqual(room["confirmed"], False)

    def test_process_drawing_01_unclosed_cafe_office_plan_mm_extracts_all_10_rooms(
        self,
    ) -> None:
        """Verify POST /process on unclosed DXF extracts all 10 rooms."""
        drawing_id = str(uuid4())
        fixture_path = FIXTURES_DIR / "01_unclosed_cafe_office_plan_mm.dxf"
        if not fixture_path.exists():
            fixture_path = (
                FIXTURES_DIR.parent
                / "test_drawing_dxf2"
                / "test_drawing_dxf2"
                / "01_unclosed_cafe_office_plan_mm.dxf"
            )
        self.assertTrue(fixture_path.exists())

        drawing_record = {
            "id": drawing_id,
            "owner_id": self.user_id,
            "original_file_name": "01_unclosed_cafe_office_plan_mm.dxf",
            "storage_path": f"{self.user_id}/{drawing_id}/source.dxf",
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

        mock_storage_bucket = MagicMock()
        mock_storage_bucket.download.return_value = fixture_path.read_bytes()
        self.mock_supabase.storage.from_.return_value = mock_storage_bucket

        response = self.client.post(f"/api/v1/drawings/{drawing_id}/process")

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["drawing_id"], drawing_id)
        self.assertEqual(data["status"], "processing")

        self.assertEqual(len(inserted_rooms_payload), 10)
        expected_rooms = {
            "Main_Corridor": (24.0, "corridor"),
            "Cafe_Hall": (48.0, "hall"),
            "Kitchen": (16.0, "kitchen"),
            "Storage_Room": (8.0, "storage"),
            "Restroom_1": (4.0, "restroom"),
            "Restroom_2": (4.0, "restroom"),
            "Office_1": (16.0, "office"),
            "Office_2": (16.0, "office"),
            "Staff_Room": (12.0, "service_room"),
            "Manager_Office": (12.0, "office"),
        }
        inserted_by_name = {r["name"]: r for r in inserted_rooms_payload}
        for name, (exp_area, exp_type) in expected_rooms.items():
            self.assertIn(name, inserted_by_name)
            room = inserted_by_name[name]
            self.assertEqual(room["drawing_id"], drawing_id)
            self.assertEqual(room["source"], "auto")
            self.assertEqual(room["confirmed"], False)
            self.assertAlmostEqual(room["area"], exp_area, places=1)
            self.assertEqual(room["type"], exp_type)

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

        # Verify status set to error
        mock_drawings_query.update.assert_called()
        update_args = mock_drawings_query.update.call_args[0][0]
        self.assertEqual(update_args["status"], "error")

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
            "unit_scale_m": 0.001,
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

        # Правило з каталогу: крок 2 м (креслення в мм, масштаб 0.001),
        # без обмеження висоти.
        db_rule_id = str(uuid4())
        rules_data = [
            {
                "id": db_rule_id,
                "rule_id": "TEST_GRID",
                "name": "Test grid",
                "device_type": "smoke_detector",
                "value_kind": "max_grid_spacing_m",
                "value": 2.0,
                "min_height_m": None,
                "max_height_m": None,
                "room_types": [],
                "conditions": {},
                "verification_status": "verified",
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

        # BIM-73: результат розміщення по приміщенню (кімната висотою 3 м).
        self.assertEqual(len(data["placements"]), 1)
        placement = data["placements"][0]
        self.assertEqual(placement["room_id"], room_id)
        self.assertIsNone(placement["zone_id"])
        self.assertEqual(placement["status"], "placed")
        self.assertEqual(placement["rule"]["rule_id"], "TEST_GRID")

        # BIM-75: виходів немає — ручні сповіщувачі не розміщуються, є повідомлення.
        call_points = data["manual_call_points"]
        self.assertEqual(call_points["status"], "insufficient_data")
        self.assertEqual(call_points["reason"], "Позначте евакуаційні виходи")
        self.assertEqual(call_points["device_count"], 0)

        # Verify old devices deleted
        mock_devices_table.delete.assert_called_once()
        mock_devices_delete.eq.assert_called_with("drawing_id", drawing_id)

        # Verify new devices inserted
        self.assertGreater(len(inserted_devices), 0)
        for dev in inserted_devices:
            self.assertEqual(dev["drawing_id"], drawing_id)
            self.assertEqual(dev["room_id"], room_id)
            self.assertEqual(dev["rule_id"], db_rule_id)
            self.assertIn("x", dev)
            self.assertIn("y", dev)
            self.assertEqual(dev["type"], "smoke_detector")
            self.assertEqual(dev["layer"], "SYS_FIRE_SENSORS")

        # Verify drawing status updated to 'processed'
        # Звіт розміщення пишеться тим самим UPDATE, що й статус (GET його повертає).
        mock_drawings_query.update.assert_called_with(
            {
                "status": "processed",
                "placement_report": {
                    "placement_status": "complete",
                    "device_count": len(inserted_devices),
                    "skipped": [],
                    "manual_call_points": call_points,
                    "sounders": data["sounders"],
                },
            }
        )

        # Verify DXF uploaded
        self.assertEqual(len(uploaded_payloads), 1)
        self.assertEqual(uploaded_payloads[0]["path"], expected_storage_path)

        uploaded_doc = ezdxf.read(
            io.StringIO(
                uploaded_payloads[0]["file_data"].decode("utf-8", errors="ignore"),
                newline=None,
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
                "source": "manual",
                "confirmed": True,
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
        self.assertEqual(response.json()["rooms"][0]["source"], "manual")
        self.assertIs(response.json()["rooms"][0]["confirmed"], True)
        self.assertEqual(len(result.devices), 1)
        self.assertEqual(result.devices[0].position.x, 2500.0)
        self.assertIsNotNone(result.downloadUrl)
        self.assertIsNotNone(result.downloadUrlExpiresAt)

        for state in ("processing", "error", "failed"):
            with self.subTest(state=state):
                drawing_record["status"] = state
                drawing_record["error_message"] = "LayerNotFoundError"
                response = self.client.get(f"/api/v1/drawings/{drawing_id}")
                self.assertEqual(response.status_code, 200)
                partial = DrawingResult.model_validate(response.json())
                self.assertEqual(len(partial.rooms), 1)
                self.assertEqual(partial.devices, [])
                self.assertIsNone(partial.downloadUrl)
                self.assertIsNotNone(partial.sourceDownloadUrl)
                self.assertEqual(partial.drawing.errorMessage, "LayerNotFoundError")

        # Signing failure does not discard the geometry result.
        drawing_record["status"] = "processed"
        mock_bucket.create_signed_url.side_effect = RuntimeError("storage unavailable")
        unavailable = self.client.get(f"/api/v1/drawings/{drawing_id}")
        self.assertEqual(unavailable.status_code, 200)
        self.assertEqual(len(unavailable.json()["rooms"]), 1)
        self.assertEqual(len(unavailable.json()["devices"]), 1)
        self.assertIsNone(unavailable.json()["downloadUrl"])
        self.assertIsNone(unavailable.json()["sourceDownloadUrl"])

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
            "rules": [
                {
                    "id": str(uuid4()),
                    "rule_id": "TEST_GRID",
                    "name": "Test grid",
                    "device_type": "smoke_detector",
                    "value_kind": "max_grid_spacing_m",
                    "value": 2.0,  # метри; креслення в мм, масштаб зберігає /process
                    "min_height_m": None,
                    "max_height_m": None,
                    "room_types": [],
                    "conditions": {},
                    "verification_status": "verified",
                }
            ],
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

        # Rooms are visible before placement; original and generated files differ.
        mid_get_resp = self.client.get(f"/api/v1/drawings/{drawing_id}")
        self.assertEqual(mid_get_resp.status_code, 200)
        mid_data = mid_get_resp.json()
        self.assertEqual(mid_data["drawing"]["status"], "processing")
        self.assertEqual(len(mid_data["rooms"]), len(db["rooms"]))
        self.assertEqual(mid_data["devices"], [])
        self.assertIsNone(mid_data["downloadUrl"])
        self.assertTrue(mid_data["sourceDownloadUrl"].endswith("/source.dxf"))
        self.assertIsNotNone(mid_data["sourceDownloadUrlExpiresAt"])

        # BIM-73: без висоти сповіщувачі не розміщуються, тож інженер вводить її
        # (PATCH /rooms/{id}) до розміщення.
        for room_row in db["rooms"]:
            room_row["height"] = 3.0

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

        # GET повертає збережений звіт розміщення поруч із контрактом (DrawingResult
        # не допускає зайвих полів): контракт перевіряється без нього, а звіт — окремо.
        body = get_resp.json()
        stored_report = body.pop("placementReport")
        self.assertEqual(stored_report, db["drawings"][0]["placement_report"])
        self.assertEqual(stored_report["device_count"], len(db["devices"]))
        result = DrawingResult.model_validate(body)
        self.assertEqual(str(result.drawing.id), drawing_id)
        self.assertEqual(result.drawing.status.value, "processed")
        self.assertEqual(len(result.rooms), len(db["rooms"]))
        self.assertEqual(len(result.devices), len(db["devices"]))
        self.assertIsNotNone(result.downloadUrl)
        self.assertTrue(str(result.downloadUrl).startswith("https://mock.supabase.co"))
        self.assertIsNotNone(result.downloadUrlExpiresAt)

        # Reopening and refreshing do not rerun processing or duplicate overlays.
        reopened = self.client.get(f"/api/v1/drawings/{drawing_id}").json()
        self.assertEqual(reopened["rooms"], get_resp.json()["rooms"])
        self.assertEqual(reopened["devices"], get_resp.json()["devices"])
        self.assertTrue(reopened["sourceDownloadUrl"].endswith("/source.dxf"))
        self.assertTrue(reopened["downloadUrl"].endswith("/result.dxf"))
        exported = ezdxf.read(
            io.StringIO(storage_uploaded[result_key].decode("utf-8"), newline=None)
        )
        inserts = list(exported.modelspace().query('INSERT[layer=="SYS_FIRE_SENSORS"]'))
        self.assertEqual(len(inserts), len(result.devices))
        self.assertEqual(
            [(entity.dxf.insert.x, entity.dxf.insert.y) for entity in inserts],
            [(device.position.x, device.position.y) for device in result.devices],
        )

        # A repeat process must never offer the old generated result or devices.
        repeated = self.client.post(f"/api/v1/drawings/{drawing_id}/process")
        self.assertEqual(repeated.status_code, 200)
        intermediate = self.client.get(f"/api/v1/drawings/{drawing_id}").json()
        self.assertEqual(len(intermediate["rooms"]), len(result.rooms))
        self.assertEqual(intermediate["devices"], [])
        self.assertIsNone(intermediate["downloadUrl"])


def _points(*coords: tuple[float, float]) -> list[SimpleNamespace]:
    return [SimpleNamespace(x=x, y=y) for x, y in coords]


class TestStaleLayoutAfterFailedReprocess(unittest.TestCase):
    """Повторна обробка: збій запису виходів і проходів не підтверджує новий маршрут.

    Приміщення при кожній обробці створюються заново (нові id), а запис виходів і
    проходів — окремий крок, який може не вдатись. Тоді в БД лишаються проходи зі
    старої обробки: вони не мають автоматично підтверджувати маршрут для нових
    контурів, а причина має бути видима і в POST /place, і після перезавантаження.
    """

    DOOR = (20_150.0, 1_500.0)

    def setUp(self) -> None:
        self.user_id = str(uuid4())
        self.drawing_id = str(uuid4())
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

        # Попередня обробка: два коридори через стіну, вихід у кожному, двері між ними.
        self.old_west, self.old_east = str(uuid4()), str(uuid4())
        self.rooms_table = FakeTable(
            [
                self.room_row(self.old_west, "West", 0, 20_000),
                self.room_row(self.old_east, "East", 20_300, 40_300),
            ]
        )
        self.exits_table = FakeTable(
            [
                self.exit_row(0, 1_500, self.old_west),
                self.exit_row(40_300, 1_500, self.old_east),
            ]
        )
        self.old_passage = {
            "id": str(uuid4()),
            "drawing_id": self.drawing_id,
            "name": None,
            "x": self.DOOR[0],
            "y": self.DOOR[1],
            "source": "dxf",
            "room_a_id": self.old_west,
            "room_b_id": self.old_east,
            "created_at": "2026-11-20T10:00:00+00:00",
        }
        self.passages_table = FakeTable([self.old_passage])
        self.drawings_table = FakeTable(
            [
                {
                    "id": self.drawing_id,
                    "owner_id": self.user_id,
                    "units": "mm",
                    "unit_scale_m": 0.001,
                    "status": "processed",
                    "original_file_name": "plan.dxf",
                    "storage_path": f"{self.user_id}/{self.drawing_id}/source.dxf",
                    "created_at": "2026-11-19T10:00:00+00:00",
                    "placement_report": None,
                }
            ]
        )
        self.devices_table = FakeTable([])
        # Приміщення видаляються при обробці, пара проходу обнуляється (set null).
        self.rooms_table.on_delete = set_null_on_room_delete(
            (self.exits_table, ("room_id",)),
            (self.passages_table, ("room_a_id", "room_b_id")),
        )
        self.tables = {
            "rooms": self.rooms_table,
            "room_zones": FakeTable([]),
            "exits": self.exits_table,
            "passages": self.passages_table,
            "drawings": self.drawings_table,
            "devices": self.devices_table,
            "rules": FakeTable([self.manual_call_point_rule()]),
        }
        self.current_user = CurrentUser(id=self.user_id, role="engineer")
        app.dependency_overrides[get_current_user] = lambda: self.current_user

    def tearDown(self) -> None:
        app.dependency_overrides.clear()

    def room_row(self, room_id: str, name: str, x0: float, x1: float) -> dict[str, Any]:
        return {
            "id": room_id,
            "drawing_id": self.drawing_id,
            "name": name,
            "type": "corridor",
            "height": 3.0,
            "area": (x1 - x0) * 3 / 1000,
            "polygon": [
                {"x": x0, "y": 0},
                {"x": x1, "y": 0},
                {"x": x1, "y": 3_000},
                {"x": x0, "y": 3_000},
            ],
            "source": "auto",
        }

    def exit_row(self, x: float, y: float, room_id: str) -> dict[str, Any]:
        return {
            "id": str(uuid4()),
            "drawing_id": self.drawing_id,
            "room_id": room_id,
            "name": None,
            "x": x,
            "y": y,
            "source": "dxf",
            "created_at": "2026-11-20T10:00:00+00:00",
        }

    @staticmethod
    def manual_call_point_rule() -> dict[str, Any]:
        return {
            "id": str(uuid4()),
            "rule_id": "MANUAL_CALL_POINT_SPACING_DSTU",
            "name": "MANUAL_CALL_POINT_SPACING_DSTU",
            "device_type": "manual_call_point",
            "value_kind": "max_grid_spacing_m",
            "room_types": [],
            "min_height_m": None,
            "max_height_m": None,
            "value": 30.0,
            "conditions": {"exit_offset_m": 1.0},
            "verification_status": "verified",
        }

    def use_rpc(self, fails: bool) -> TestClient:
        supabase = fake_supabase(
            self.tables,
            rpc={
                "replace_dxf_layout": fake_replace_dxf_layout(
                    self.tables, fail_after_delete=fails
                )
            },
        )
        app.dependency_overrides[get_supabase_client] = lambda: supabase
        return TestClient(app)

    def place(self, client: TestClient) -> Any:
        with patch(
            "src.modules.drawings.router.generate_and_upload_result_dxf",
            return_value="result.dxf",
        ):
            return client.post(f"/api/v1/drawings/{self.drawing_id}/place")

    def reprocess(self, client: TestClient) -> Any:
        """Повторний POST /process: нові приміщення, ті самі виходи й двері."""
        dxf = Path(self.tmp.name) / f"{uuid4()}.dxf"
        dxf.write_bytes(b"0\nEOF\n")
        new_rooms = [
            SimpleNamespace(
                id=uuid4(),
                name=name,
                type="corridor",
                height=3.0,
                area=60.0,
                polygon=_points((x0, 0), (x1, 0), (x1, 3_000), (x0, 3_000)),
                source=None,
            )
            for name, x0, x1 in (("West", 0, 20_000), ("East", 20_300, 40_300))
        ]
        exits = [
            SimpleNamespace(x=0.0, y=1_500.0, name=None),
            SimpleNamespace(x=40_300.0, y=1_500.0, name=None),
        ]
        doors = [SimpleNamespace(x=self.DOOR[0], y=self.DOOR[1])]
        with (
            patch("src.modules.drawings.router.download_dxf_to_tmp", return_value=dxf),
            patch(
                "src.modules.drawings.router.parse_dxf_rooms_with_scale",
                return_value=(new_rooms, 0.001),
            ),
            patch("src.modules.drawings.router.read_dxf_document"),
            patch("src.modules.drawings.router.find_exit_points", return_value=exits),
            patch("src.modules.drawings.router.find_door_points", return_value=doors),
        ):
            return client.post(f"/api/v1/drawings/{self.drawing_id}/process")

    def reload(self, client: TestClient) -> Any:
        """Новий запит без стану POST: що бачить користувач після перезавантаження."""
        return client.get(f"/api/v1/drawings/{self.drawing_id}")

    def test_the_route_is_confirmed_by_the_passage_before_reprocessing(self) -> None:
        response = self.place(self.use_rpc(fails=False))

        self.assertEqual(response.status_code, 200, response.text)
        mcp = response.json()["manual_call_points"]
        self.assertEqual(mcp["route_coverage"], "confirmed")
        self.assertEqual(mcp["passage_ids"], [self.old_passage["id"]])

    def test_old_passage_does_not_confirm_the_route_after_a_failed_rewrite(
        self,
    ) -> None:
        client = self.use_rpc(fails=True)

        processed = self.reprocess(client)

        self.assertEqual(processed.status_code, 200, processed.text)
        self.assertEqual(processed.json()["exit_detection"]["status"], "failed")
        # Старі дані не втрачено, але прохід більше не належить жодному приміщенню.
        (kept,) = self.passages_table.rows
        self.assertEqual(kept["id"], self.old_passage["id"])
        self.assertIsNone(kept["room_a_id"])
        self.assertIsNone(kept["room_b_id"])
        self.assertNotIn(self.old_west, {r["id"] for r in self.rooms_table.rows})

        response = self.place(client)

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        mcp = body["manual_call_points"]
        # Статус і пояснення, а не лише кількість сповіщувачів.
        self.assertEqual(mcp["status"], "placed")
        self.assertEqual(mcp["device_count"], 2)  # лише біля виходів
        self.assertEqual(mcp["route_coverage"], "unconfirmed")
        self.assertEqual(mcp["passage_ids"], [])
        self.assertEqual(mcp["ignored_passage_ids"], [self.old_passage["id"]])
        self.assertEqual(len(mcp["unconnected_exit_ids"]), 1)
        self.assertEqual(mcp["unconnected_rooms"], ["East"])
        self.assertIn(WARNING_ROUTE_UNCONFIRMED, mcp["route_warning"])
        self.assertIn(WARNING_PASSAGES_IGNORED, mcp["route_warning"])
        # Збій оновлення виходів і проходів теж лишається у звіті розміщення.
        self.assertEqual(body["exit_detection"]["status"], EXIT_DETECTION_FAILED)
        self.assertEqual(
            body["exit_detection"]["warning"], WARNING_EXIT_DETECTION_FAILED
        )

    def test_the_explanation_is_still_there_after_a_reload(self) -> None:
        client = self.use_rpc(fails=True)
        self.reprocess(client)
        posted = self.place(client).json()

        detail = self.reload(client)

        self.assertEqual(detail.status_code, 200, detail.text)
        report = detail.json()["placementReport"]
        self.assertEqual(report["manual_call_points"], posted["manual_call_points"])
        self.assertEqual(report["exit_detection"], posted["exit_detection"])
        self.assertEqual(report["manual_call_points"]["route_coverage"], "unconfirmed")
        self.assertIn(
            WARNING_PASSAGES_IGNORED, report["manual_call_points"]["route_warning"]
        )

    def test_a_failed_rewrite_is_visible_after_a_reload_before_any_placement(
        self,
    ) -> None:
        client = self.use_rpc(fails=True)
        self.reprocess(client)

        detail = self.reload(client)

        self.assertEqual(detail.status_code, 200, detail.text)
        report = detail.json()["placementReport"]
        # Розміщення ще не було: у звіті лише збій кроку, без placement_status.
        self.assertEqual(list(report), ["exit_detection"])
        self.assertEqual(report["exit_detection"]["status"], EXIT_DETECTION_FAILED)

    def test_successful_reprocessing_binds_the_door_to_the_new_rooms(self) -> None:
        client = self.use_rpc(fails=False)

        processed = self.reprocess(client)

        self.assertEqual(processed.json()["exit_detection"]["status"], "ok")
        new_ids = {row["id"] for row in self.rooms_table.rows}
        (passage,) = self.passages_table.rows
        self.assertNotEqual(passage["id"], self.old_passage["id"])
        self.assertEqual({passage["room_a_id"], passage["room_b_id"]}, new_ids)

        mcp = self.place(client).json()["manual_call_points"]

        self.assertEqual(mcp["route_coverage"], "confirmed")
        self.assertEqual(mcp["passage_ids"], [passage["id"]])
        self.assertEqual(mcp["ignored_passage_ids"], [])
        self.assertIsNone(mcp["route_warning"])
        # Без збою звіту про виходи нема: нічого показувати нема чого.
        self.assertNotIn("exit_detection", self.place(client).json())

    def test_a_good_reprocessing_clears_the_failure_of_a_previous_one(self) -> None:
        failed = self.use_rpc(fails=True)
        self.reprocess(failed)
        self.assertIn("placementReport", self.reload(failed).json())

        good = self.use_rpc(fails=False)
        self.reprocess(good)

        self.assertNotIn("placementReport", self.reload(good).json())
        self.assertNotIn("exit_detection", self.place(good).json())


class TestSchemaFallback(unittest.TestCase):
    """Verify Sprint 4 schema fallback when PostgREST reports PGRST204/PGRST205."""

    def setUp(self) -> None:
        self.user_id = str(uuid4())
        self.current_user = CurrentUser(id=self.user_id, role="engineer")
        self.mock_supabase = MagicMock()
        app.dependency_overrides[get_current_user] = lambda: self.current_user
        app.dependency_overrides[get_supabase_client] = lambda: self.mock_supabase
        self.client = TestClient(app)

    def tearDown(self) -> None:
        app.dependency_overrides.clear()

    def test_process_drawing_falls_back_on_pgrst204_missing_columns(self) -> None:
        """process_drawing succeeds with status=processing when PGRST204 occurs."""
        drawing_id = str(uuid4())
        fixture_path = FIXTURES_DIR / "01_simple_rooms_mm.dxf"
        drawing_record = {
            "id": drawing_id,
            "owner_id": self.user_id,
            "original_file_name": "01_simple_rooms_mm.dxf",
            "storage_path": f"{self.user_id}/{drawing_id}/source.dxf",
            "units": "mm",
            "status": "uploaded",
            "created_at": "2026-10-31T12:00:00Z",
        }

        update_payloads: list[dict[str, Any]] = []

        mock_drawings_table = MagicMock()
        mock_select_query = MagicMock()
        mock_select_query.eq.return_value = mock_select_query
        mock_select_query.single.return_value = mock_select_query
        mock_select_query.execute.return_value = MagicMock(data=drawing_record)
        mock_drawings_table.select.return_value = mock_select_query

        def mock_update(payload: dict[str, Any]) -> MagicMock:
            update_payloads.append(payload)
            q = MagicMock()
            q.eq.return_value = q
            if "unit_scale_m" in payload or "placement_report" in payload:
                q.execute.side_effect = Exception(
                    "{'code': 'PGRST204', 'message': "
                    "\"Could not find the 'unit_scale_m' column of 'drawings' "
                    'in the schema cache"}'
                )
            else:
                q.execute.return_value = MagicMock(data=[drawing_record])
            return q

        mock_drawings_table.update.side_effect = mock_update

        mock_rooms_table = MagicMock()
        mock_rooms_q = MagicMock()
        mock_rooms_q.eq.return_value = mock_rooms_q
        mock_rooms_q.execute.return_value = MagicMock(data=[])
        mock_rooms_table.delete.return_value = mock_rooms_q
        mock_rooms_table.insert.return_value = mock_rooms_q

        def table_side_effect(name: str) -> MagicMock:
            if name == "drawings":
                return mock_drawings_table
            if name == "rooms":
                return mock_rooms_table
            return MagicMock()

        self.mock_supabase.table.side_effect = table_side_effect
        mock_bucket = MagicMock()
        mock_bucket.download.return_value = fixture_path.read_bytes()
        self.mock_supabase.storage.from_.return_value = mock_bucket

        response = self.client.post(f"/api/v1/drawings/{drawing_id}/process")

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["status"], "processing")
        self.assertEqual(len(update_payloads), 2)
        self.assertIn("unit_scale_m", update_payloads[0])
        self.assertIn("placement_report", update_payloads[0])
        self.assertEqual(update_payloads[1], {"status": "processing"})

    @patch(
        "src.modules.drawings.router.generate_and_upload_result_dxf",
        return_value="user/drawing/result.dxf",
    )
    def test_place_drawing_devices_falls_back_on_pgrst205_and_pgrst204(
        self,
        _mock_export: MagicMock,
    ) -> None:
        """place_drawing_devices defaults missing Sprint 4 tables to [] and saves."""
        drawing_id = str(uuid4())
        room_id = str(uuid4())
        drawing_record = {
            "id": drawing_id,
            "owner_id": self.user_id,
            "original_file_name": "plan.dxf",
            "storage_path": f"{self.user_id}/{drawing_id}/source.dxf",
            "units": "mm",
            "status": "processing",
            "created_at": "2026-10-31T12:00:00Z",
        }
        room_row = {
            "id": room_id,
            "drawing_id": drawing_id,
            "name": "Office",
            "type": "office",
            "height": 3.0,
            "area": 20.0,
            "polygon": [
                {"x": 0.0, "y": 0.0},
                {"x": 4000.0, "y": 0.0},
                {"x": 4000.0, "y": 5000.0},
                {"x": 0.0, "y": 5000.0},
            ],
        }
        rule_row = {
            "id": str(uuid4()),
            "rule_id": "SMOKE_GRID_HEIGHT_3_5",
            "name": "SMOKE_GRID_HEIGHT_3_5",
            "device_type": "smoke_detector",
            "value_kind": "max_grid_spacing_m",
            "room_types": [],
            "min_height_m": None,
            "max_height_m": 3.5,
            "value": 9.0,
            "conditions": {"max_protected_area_m2": 80.0},
            "verification_status": "verified",
        }

        update_payloads: list[dict[str, Any]] = []
        mock_drawings_table = MagicMock()
        mock_select_q = MagicMock()
        mock_select_q.eq.return_value = mock_select_q
        mock_select_q.single.return_value = mock_select_q
        mock_select_q.execute.return_value = MagicMock(data=drawing_record)
        mock_drawings_table.select.return_value = mock_select_q

        def mock_update(payload: dict[str, Any]) -> MagicMock:
            update_payloads.append(payload)
            q = MagicMock()
            q.eq.return_value = q
            if "placement_report" in payload:
                q.execute.side_effect = Exception(
                    "PGRST204: Could not find the 'placement_report' column"
                )
            else:
                q.execute.return_value = MagicMock(data=[drawing_record])
            return q

        mock_drawings_table.update.side_effect = mock_update

        def make_select_table(rows: list[dict[str, Any]]) -> MagicMock:
            tbl = MagicMock()
            q = MagicMock()
            q.eq.return_value = q
            q.execute.return_value = MagicMock(data=rows)
            tbl.select.return_value = q
            return tbl

        def make_missing_table(table_name: str) -> MagicMock:
            tbl = MagicMock()
            q = MagicMock()
            q.eq.return_value = q
            q.execute.side_effect = Exception(
                f"PGRST205: Could not find the table 'public.{table_name}' "
                "in the schema cache"
            )
            tbl.select.return_value = q
            return tbl

        mock_devices_table = MagicMock()
        mock_devices_q = MagicMock()
        mock_devices_q.eq.return_value = mock_devices_q
        mock_devices_q.execute.return_value = MagicMock(data=[])
        mock_devices_table.delete.return_value = mock_devices_q
        mock_devices_table.insert.return_value = mock_devices_q

        tables = {
            "drawings": mock_drawings_table,
            "rooms": make_select_table([room_row]),
            "rules": make_select_table([rule_row]),
            "devices": mock_devices_table,
            "room_zones": make_missing_table("room_zones"),
            "exits": make_missing_table("exits"),
            "passages": make_missing_table("passages"),
        }
        self.mock_supabase.table.side_effect = lambda name: tables[name]

        response = self.client.post(f"/api/v1/drawings/{drawing_id}/place")

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["status"], "processed")
        self.assertEqual(len(update_payloads), 2)
        self.assertIn("placement_report", update_payloads[0])
        self.assertEqual(update_payloads[1], {"status": "processed"})


if __name__ == "__main__":
    unittest.main()
