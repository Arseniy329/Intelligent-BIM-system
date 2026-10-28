import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch
from uuid import UUID

import ezdxf
from fastapi.testclient import TestClient

API_DIR = Path(__file__).resolve().parent.parent
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

from src.contracts.generated import Room
from src.core.config import get_settings
from src.core.exceptions import (
    LayerNotFoundError,
    NoValidContoursError,
    StorageError,
)
from src.infrastructure.storage import (
    cleanup_file,
    download_dxf_to_tmp,
    temporary_dxf_file,
)
from src.infrastructure.supabase import get_supabase_client
from src.main import app
from src.modules.cad.parser import parse_dxf_rooms

FIXTURES_DIR = API_DIR / "tests" / "fixtures" / "test_drawing_dxf"


def create_mock_dxf(
    output_path: Path,
    insunits: int | None = 4,
    include_fire_rooms_layer: bool = True,
    rooms_data: list[dict] | None = None,
) -> Path:
    """Helper to generate minimal programmatic DXF files using ezdxf.new()."""
    doc = ezdxf.new("R2010")
    if insunits is not None:
        doc.header["$INSUNITS"] = insunits

    if include_fire_rooms_layer:
        doc.layers.add("FIRE_ROOMS")

    msp = doc.modelspace()

    if rooms_data:
        for r in rooms_data:
            layer = r.get("layer", "FIRE_ROOMS")
            if layer not in doc.layers:
                doc.layers.add(layer)
            closed = r.get("closed", True)
            msp.add_lwpolyline(
                r["points"],
                close=closed,
                dxfattribs={"layer": layer},
            )
            if "text" in r and r["text"] is not None:
                text_insert = r.get(
                    "text_insert",
                    (
                        r["points"][0][0] + 1.0,
                        r["points"][0][1] + 1.0,
                        0.0,
                    ),
                )
                text_layer = r.get("text_layer", layer)
                msp.add_text(
                    r["text"],
                    dxfattribs={
                        "insert": text_insert,
                        "layer": text_layer,
                    },
                )
    doc.saveas(str(output_path))
    return output_path


class TestCadParser(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = Path(tempfile.mkdtemp())

    def tearDown(self) -> None:
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_fixture_01_simple_rooms_mm(self) -> None:
        """Acceptance: Valid DXF with room count and area in m²."""
        fixture_path = FIXTURES_DIR / "01_simple_rooms_mm.dxf"
        rooms = parse_dxf_rooms(fixture_path)

        self.assertEqual(len(rooms), 3)
        # Room 101: 4000x5000 mm -> 20.0 m2
        room_names = {r.name: r.area for r in rooms}
        self.assertIn("Room_101 (20.0m2)", room_names)
        self.assertAlmostEqual(room_names["Room_101 (20.0m2)"], 20.0, places=2)

        self.assertIn("Room_102 (25.0m2)", room_names)
        self.assertAlmostEqual(room_names["Room_102 (25.0m2)"], 25.0, places=2)

        self.assertIn("Room_103 (36.0m2)", room_names)
        self.assertAlmostEqual(room_names["Room_103 (36.0m2)"], 36.0, places=2)

        # Validate Room contract schema
        for r in rooms:
            self.assertIsInstance(r, Room)
            self.assertIsInstance(r.drawingId, UUID)
            self.assertEqual(len(r.polygon), 4)

    def test_fixture_02_cafe_office_plan_mm(self) -> None:
        """Acceptance: Valid DXF extracts 10 rooms with accurate areas and text."""
        fixture_path = FIXTURES_DIR / "02_cafe_office_plan_mm.dxf"
        rooms = parse_dxf_rooms(fixture_path)

        self.assertEqual(len(rooms), 10)
        room_names = {r.name: r.area for r in rooms}
        self.assertIn("Main_Corridor (24.0m2)", room_names)
        self.assertAlmostEqual(room_names["Main_Corridor (24.0m2)"], 24.0, places=2)
        self.assertIn("Cafe_Hall (48.0m2)", room_names)
        self.assertAlmostEqual(room_names["Cafe_Hall (48.0m2)"], 48.0, places=2)

    def test_fixture_03_missing_layer_raises_layer_not_found(self) -> None:
        """Acceptance: DXF without FIRE_ROOMS layer throws LayerNotFoundError."""
        fixture_path = FIXTURES_DIR / "03_bad_unclosed_meters.dxf"
        with self.assertRaises(LayerNotFoundError) as ctx:
            parse_dxf_rooms(fixture_path)
        self.assertIn("FIRE_ROOMS", str(ctx.exception))

    def test_text_inside_polygon_becomes_room_name(self) -> None:
        """Acceptance: Text inside the polygon correctly becomes room name."""
        dxf_path = self.temp_dir / "text_inside.dxf"
        create_mock_dxf(
            dxf_path,
            insunits=4,
            include_fire_rooms_layer=True,
            rooms_data=[
                {
                    "points": [(0, 0), (6000, 0), (6000, 4000), (0, 4000)],
                    "closed": True,
                    "text": "Server Room",
                    "text_insert": (3000, 2000, 0),
                    "layer": "FIRE_ROOMS",
                }
            ],
        )

        rooms = parse_dxf_rooms(dxf_path)
        self.assertEqual(len(rooms), 1)
        self.assertEqual(rooms[0].name, "Server Room")
        self.assertAlmostEqual(rooms[0].area, 24.0, places=2)

    def test_room_without_text_defaults_to_unknown_room(self) -> None:
        """Acceptance: Room polygon without text inside defaults to 'Unknown Room'."""
        dxf_path = self.temp_dir / "no_text.dxf"
        create_mock_dxf(
            dxf_path,
            insunits=4,
            include_fire_rooms_layer=True,
            rooms_data=[
                {
                    "points": [(0, 0), (3000, 0), (3000, 3000), (0, 3000)],
                    "closed": True,
                    "text": None,
                    "layer": "FIRE_ROOMS",
                }
            ],
        )

        rooms = parse_dxf_rooms(dxf_path)
        self.assertEqual(len(rooms), 1)
        self.assertEqual(rooms[0].name, "Unknown Room")

    def test_invalid_geometry_ignored(self) -> None:
        """Acceptance: Unclosed polylines or wrong layers are completely ignored."""
        dxf_path = self.temp_dir / "invalid_geometry.dxf"
        create_mock_dxf(
            dxf_path,
            insunits=4,
            include_fire_rooms_layer=True,
            rooms_data=[
                # Valid room on FIRE_ROOMS
                {
                    "points": [(0, 0), (4000, 0), (4000, 5000), (0, 5000)],
                    "closed": True,
                    "text": "Valid Room",
                    "text_insert": (2000, 2500, 0),
                    "layer": "FIRE_ROOMS",
                },
                # Unclosed polyline on FIRE_ROOMS
                {
                    "points": [(0, 6000), (4000, 6000), (4000, 10000)],
                    "closed": False,
                    "text": "Unclosed",
                    "text_insert": (2000, 8000, 0),
                    "layer": "FIRE_ROOMS",
                },
                # Closed polyline on wrong layer (WALLS)
                {
                    "points": [
                        (5000, 0),
                        (8000, 0),
                        (8000, 5000),
                        (5000, 5000),
                    ],
                    "closed": True,
                    "text": "Wrong Layer Room",
                    "text_insert": (6500, 2500, 0),
                    "layer": "WALLS",
                },
            ],
        )

        rooms = parse_dxf_rooms(dxf_path)
        self.assertEqual(len(rooms), 1)
        self.assertEqual(rooms[0].name, "Valid Room")
        self.assertAlmostEqual(rooms[0].area, 20.0, places=2)

    def test_insunits_scale_meters(self) -> None:
        """Acceptance: Scale factor when $INSUNITS is 6 (meters)."""
        dxf_path = self.temp_dir / "meters.dxf"
        create_mock_dxf(
            dxf_path,
            insunits=6,  # meters
            include_fire_rooms_layer=True,
            rooms_data=[
                {
                    "points": [(0, 0), (5, 0), (5, 8), (0, 8)],
                    "closed": True,
                    "text": "Large Hall",
                    "text_insert": (2.5, 4.0, 0),
                    "layer": "FIRE_ROOMS",
                }
            ],
        )

        rooms = parse_dxf_rooms(dxf_path)
        self.assertEqual(len(rooms), 1)
        self.assertEqual(rooms[0].name, "Large Hall")
        # 5 x 8 meters = 40.0 m2
        self.assertAlmostEqual(rooms[0].area, 40.0, places=2)

    def test_missing_insunits_defaults_to_millimeters(self) -> None:
        """Acceptance: Missing $INSUNITS defaults to millimeters (multiplier 1e-6)."""
        dxf_path = self.temp_dir / "missing_units.dxf"
        doc = ezdxf.new("R2010")
        del doc.header["$INSUNITS"]
        doc.layers.add("FIRE_ROOMS")
        msp = doc.modelspace()
        msp.add_lwpolyline(
            [(0, 0), (2000, 0), (2000, 3000), (0, 3000)],
            close=True,
            dxfattribs={"layer": "FIRE_ROOMS"},
        )
        msp.add_text(
            "Default MM Room",
            dxfattribs={"insert": (1000, 1500, 0), "layer": "FIRE_ROOMS"},
        )
        doc.saveas(str(dxf_path))

        rooms = parse_dxf_rooms(dxf_path)
        self.assertEqual(len(rooms), 1)
        # 2000 x 3000 mm = 6.0 m2
        self.assertAlmostEqual(rooms[0].area, 6.0, places=2)

    def test_no_valid_contours_error(self) -> None:
        """Acceptance: Raise NoValidContoursError when 0 valid contours exist."""
        dxf_path = self.temp_dir / "empty_layer.dxf"
        create_mock_dxf(
            dxf_path,
            include_fire_rooms_layer=True,
            rooms_data=[],
        )

        with self.assertRaises(NoValidContoursError):
            parse_dxf_rooms(dxf_path)


class TestStorageUtility(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = Path(tempfile.mkdtemp())

    def tearDown(self) -> None:
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_temporary_dxf_file_cleanup(self) -> None:
        """Verify storage context manager saves to /tmp and cleans up on exit."""
        mock_client = MagicMock()
        mock_client.storage.from_().download.return_value = b"0\nSECTION\nHEADER\n"

        saved_path: Path | None = None
        with temporary_dxf_file("drawings/test.dxf", client=mock_client) as tmp_path:
            saved_path = tmp_path
            self.assertTrue(tmp_path.exists())
            self.assertTrue(str(tmp_path).startswith("/tmp"))
            self.assertTrue(str(tmp_path).endswith(".dxf"))
            self.assertEqual(tmp_path.read_bytes(), b"0\nSECTION\nHEADER\n")

        # After exiting context manager, file must be deleted
        self.assertFalse(saved_path.exists())

    def test_temporary_dxf_file_download_supabase_mock(self) -> None:
        """Verify downloading from Supabase storage using mock client."""
        mock_client = MagicMock()
        mock_storage = MagicMock()
        mock_client.storage.from_.return_value = mock_storage
        mock_storage.download.return_value = b"DXF-MOCK-CONTENT"

        saved_path: Path | None = None
        with temporary_dxf_file(
            "drawings/folder/drawing.dxf",
            client=mock_client,
            bucket_name="drawings",
        ) as tmp_path:
            saved_path = tmp_path
            self.assertTrue(tmp_path.exists())
            self.assertEqual(tmp_path.read_bytes(), b"DXF-MOCK-CONTENT")

        self.assertFalse(saved_path.exists())
        mock_client.storage.from_.assert_called_with("drawings")
        mock_storage.download.assert_called_with("folder/drawing.dxf")

    def test_storage_ssrf_untrusted_url_raises_error(self) -> None:
        """Storage utility rejects untrusted external URLs to prevent SSRF."""
        with self.assertRaises(StorageError) as ctx:
            download_dxf_to_tmp("https://evil.attacker.com/malicious.dxf")
        self.assertIn("Untrusted URL domain", str(ctx.exception))

    @patch("urllib.request.urlopen")
    def test_storage_trusted_url_download(self, mock_urlopen: MagicMock) -> None:
        """Storage utility allows downloading from configured SUPABASE_URL."""
        mock_resp = MagicMock()
        mock_resp.read.return_value = b"0\nSECTION\nHEADER\n"
        mock_resp.__enter__.return_value = mock_resp
        mock_urlopen.return_value = mock_resp

        settings = get_settings()
        trusted_url = (
            f"{settings.SUPABASE_URL}/storage/v1/object/public/drawings/test.dxf"
        )

        saved_path: Path | None = None
        with temporary_dxf_file(trusted_url) as tmp_path:
            saved_path = tmp_path
            self.assertTrue(tmp_path.exists())
            self.assertEqual(tmp_path.read_bytes(), b"0\nSECTION\nHEADER\n")

        self.assertFalse(saved_path.exists())

    def test_storage_empty_file_raises_error(self) -> None:
        """Storage utility raises StorageError on empty input or download."""
        with self.assertRaises(StorageError):
            download_dxf_to_tmp("")

    def test_cleanup_file_handles_none_and_missing(self) -> None:
        """cleanup_file should not throw on None or non-existent paths."""
        cleanup_file(None)
        cleanup_file(Path("/tmp/non_existent_file_12345.dxf"))


class TestCadEndpoint(unittest.TestCase):
    def setUp(self) -> None:
        self.mock_supabase = MagicMock()
        app.dependency_overrides[get_supabase_client] = lambda: self.mock_supabase
        self.client = TestClient(app)

    def tearDown(self) -> None:
        app.dependency_overrides.clear()

    def test_extract_rooms_endpoint_success(self) -> None:
        """Verify POST /api/v1/cad/extract-rooms returns 200 with list of Room."""
        fixture_path = FIXTURES_DIR / "01_simple_rooms_mm.dxf"
        self.mock_supabase.storage.from_().download.return_value = (
            fixture_path.read_bytes()
        )

        response = self.client.post(
            "/api/v1/cad/extract-rooms",
            json={"file_path": "drawings/sample.dxf"},
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIsInstance(data, list)
        self.assertEqual(len(data), 3)
        self.assertEqual(data[0]["name"], "Room_101 (20.0m2)")
        self.assertEqual(data[0]["area"], 20.0)

    def test_extract_rooms_missing_layer_returns_400(self) -> None:
        """Verify endpoint returns 400 when FIRE_ROOMS layer is missing."""
        fixture_path = FIXTURES_DIR / "03_bad_unclosed_meters.dxf"
        self.mock_supabase.storage.from_().download.return_value = (
            fixture_path.read_bytes()
        )

        response = self.client.post(
            "/api/v1/cad/extract-rooms",
            json={"file_path": "drawings/bad.dxf"},
        )
        self.assertEqual(response.status_code, 400)
        data = response.json()
        self.assertEqual(data["error"], "LayerNotFoundError")
        self.assertIn("FIRE_ROOMS", data["message"])

    def test_extract_rooms_storage_failure_returns_400(self) -> None:
        """Verify endpoint returns 400 when storage download fails."""
        self.mock_supabase.storage.from_().download.side_effect = Exception(
            "Bucket not found"
        )

        response = self.client.post(
            "/api/v1/cad/extract-rooms",
            json={"file_path": "drawings/missing.dxf"},
        )
        self.assertEqual(response.status_code, 400)
        data = response.json()
        self.assertEqual(data["error"], "StorageError")
        self.assertIn("message", data)

    def test_extract_rooms_untrusted_url_returns_400(self) -> None:
        """Verify endpoint returns 400 when an untrusted URL is passed."""
        response = self.client.post(
            "/api/v1/cad/extract-rooms",
            json={"file_path": "https://malicious.com/exploit.dxf"},
        )
        self.assertEqual(response.status_code, 400)
        data = response.json()
        self.assertEqual(data["error"], "StorageError")
        self.assertIn("Untrusted URL domain", data["message"])


if __name__ == "__main__":
    unittest.main()
