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
        """Verify full process flow from DXF download to upload and DB update."""
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

        # Mock drawing select
        mock_drawing_query = MagicMock()
        mock_drawing_query.select.return_value = mock_drawing_query
        mock_drawing_query.eq.return_value = mock_drawing_query
        mock_drawing_query.single.return_value = mock_drawing_query
        mock_drawing_query.execute.return_value = MagicMock(data=drawing_record)

        # Mock rule select
        mock_rule_query = MagicMock()
        mock_rule_query.select.return_value = mock_rule_query
        mock_rule_query.limit.return_value = mock_rule_query
        mock_rule_query.execute.return_value = MagicMock(
            data=[{"id": str(uuid4()), "threshold": 2000.0, "status": "approved"}]
        )

        # Mock drawing status update
        mock_drawings_table = MagicMock()
        mock_drawings_table.select.return_value = mock_drawing_query
        mock_update_query = MagicMock()
        mock_drawings_table.update.return_value = mock_update_query
        mock_update_query.eq.return_value = mock_update_query
        mock_update_query.execute.return_value = MagicMock(data=[{"id": drawing_id}])

        # Route table calls
        def table_side_effect(table_name: str) -> MagicMock:
            if table_name == "drawings":
                return mock_drawings_table
            if table_name == "rules":
                mock_t = MagicMock()
                mock_t.select.return_value = mock_rule_query
                return mock_t
            return MagicMock()

        self.mock_supabase.table.side_effect = table_side_effect

        # Mock storage download and upload
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

        # Track /tmp directory before
        tmp_dir = Path("/tmp")
        files_before = set(tmp_dir.glob("*.dxf"))

        response = self.client.post(f"/api/v1/drawings/{drawing_id}/process")

        self.assertEqual(response.status_code, 200)
        data = response.json()
        expected_storage_path = f"{self.user_id}/{drawing_id}/result.dxf"
        self.assertEqual(data["drawing_id"], drawing_id)
        self.assertEqual(data["status"], "processed")
        self.assertEqual(data["result_path"], expected_storage_path)

        # Verify upload arguments
        self.assertEqual(len(uploaded_payloads), 1)
        upload_call = uploaded_payloads[0]
        self.assertEqual(upload_call["path"], expected_storage_path)
        self.assertIsInstance(upload_call["file"], str)
        self.assertEqual(
            upload_call["file_options"],
            {"content-type": "application/dxf", "x-upsert": "true"},
        )

        # Verify uploaded DXF contains sensors layer and block references
        uploaded_bytes = upload_call["file_data"]
        self.assertIsInstance(uploaded_bytes, bytes)
        uploaded_doc = ezdxf.read(
            io.StringIO(uploaded_bytes.decode("utf-8", errors="ignore"))
        )
        self.assertIn("SYS_FIRE_SENSORS", uploaded_doc.layers)
        self.assertEqual(uploaded_doc.layers.get("SYS_FIRE_SENSORS").color, 1)
        self.assertIn("FIRE_DET_SMOKE", uploaded_doc.blocks)

        msp = uploaded_doc.modelspace()
        inserts = [
            e
            for e in msp
            if e.dxftype() == "INSERT" and e.dxf.layer == "SYS_FIRE_SENSORS"
        ]
        self.assertGreater(len(inserts), 0)

        # Verify drawings table status update
        mock_drawings_table.update.assert_called_with({"status": "processed"})

        # Verify /tmp cleanup
        files_after = set(tmp_dir.glob("*.dxf"))
        new_files = files_after - files_before
        self.assertEqual(
            len(new_files),
            0,
            f"Temporary DXF files were not cleaned up: {new_files}",
        )

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

        mock_rule_query = MagicMock()
        mock_rule_query.select.return_value = mock_rule_query
        mock_rule_query.limit.return_value = mock_rule_query
        mock_rule_query.execute.return_value = MagicMock(
            data=[{"id": str(uuid4()), "threshold": 2000.0, "status": "approved"}]
        )

        mock_update_query = MagicMock()
        mock_update_query.update.return_value = mock_update_query
        mock_update_query.eq.return_value = mock_update_query
        mock_update_query.execute.return_value = MagicMock(data=[{"id": drawing_id}])

        def table_side_effect(table_name: str) -> MagicMock:
            if table_name == "drawings":
                mock_t = MagicMock()
                mock_t.select.return_value = mock_drawing_query
                mock_t.update.return_value = mock_update_query
                return mock_t
            if table_name == "rules":
                mock_t = MagicMock()
                mock_t.select.return_value = mock_rule_query
                return mock_t
            return MagicMock()

        self.mock_supabase.table.side_effect = table_side_effect

        mock_storage_bucket = MagicMock()
        mock_storage_bucket.download.return_value = fixture_path.read_bytes()
        mock_storage_bucket.upload.return_value = {"Key": "..."}
        self.mock_supabase.storage.from_.return_value = mock_storage_bucket

        response = self.client.post(f"/api/v1/drawings/{drawing_id}/process")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["drawing_id"], drawing_id)
        self.assertEqual(data["status"], "processed")

    def test_process_drawing_no_rules_returns_400(self) -> None:
        """Verify 400 when no rules are configured in the rules table."""
        drawing_id = str(uuid4())
        fixture_path = FIXTURES_DIR / "01_simple_rooms_mm.dxf"

        drawing_record = {
            "id": drawing_id,
            "owner_id": self.user_id,
            "original_file_name": "plan.dxf",
            "storage_path": f"{self.user_id}/{drawing_id}/source.dxf",
            "units": "mm",
            "status": "uploaded",
            "created_at": "2026-10-31T12:00:00Z",
        }

        mock_drawing_query = MagicMock()
        mock_drawing_query.select.return_value = mock_drawing_query
        mock_drawing_query.eq.return_value = mock_drawing_query
        mock_drawing_query.single.return_value = mock_drawing_query
        mock_drawing_query.execute.return_value = MagicMock(data=drawing_record)

        mock_rule_query = MagicMock()
        mock_rule_query.select.return_value = mock_rule_query
        mock_rule_query.limit.return_value = mock_rule_query
        mock_rule_query.execute.return_value = MagicMock(data=[])

        def table_side_effect(table_name: str) -> MagicMock:
            if table_name == "drawings":
                mock_t = MagicMock()
                mock_t.select.return_value = mock_drawing_query
                return mock_t
            if table_name == "rules":
                mock_t = MagicMock()
                mock_t.select.return_value = mock_rule_query
                return mock_t
            return MagicMock()

        self.mock_supabase.table.side_effect = table_side_effect

        mock_storage_bucket = MagicMock()
        mock_storage_bucket.download.return_value = fixture_path.read_bytes()
        self.mock_supabase.storage.from_.return_value = mock_storage_bucket

        tmp_dir = Path("/tmp")
        files_before = set(tmp_dir.glob("*.dxf"))

        response = self.client.post(f"/api/v1/drawings/{drawing_id}/process")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "No fire safety rules available")

        # Verify /tmp was cleaned up despite error
        files_after = set(tmp_dir.glob("*.dxf"))
        new_files = files_after - files_before
        self.assertEqual(len(new_files), 0)


if __name__ == "__main__":
    unittest.main()
