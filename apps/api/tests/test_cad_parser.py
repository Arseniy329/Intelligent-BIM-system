import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch
from uuid import UUID

import ezdxf
from fastapi.testclient import TestClient
from shapely.geometry import Point as ShapelyPoint
from shapely.geometry import Polygon as ShapelyPolygon

API_DIR = Path(__file__).resolve().parent.parent
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

from src.contracts.generated import Room
from src.core.config import get_settings
from src.core.exceptions import (
    CADParsingError,
    StorageError,
)
from src.infrastructure.storage import (
    cleanup_file,
    download_dxf_to_tmp,
    temporary_dxf_file,
)
from src.infrastructure.supabase import get_supabase_client
from src.main import app
from src.modules.cad.parser import (
    _is_area_string,
    _polygon_to_single_ring,
    parse_dxf_rooms,
)
from src.modules.placement.service import RuleRecord, place_devices_from_rule

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

    def test_fixture_03_auto_search_fallback(self) -> None:
        """Acceptance (BIM-162): DXF without FIRE_ROOMS falls back to auto."""
        fixture_path = FIXTURES_DIR / "03_bad_unclosed_meters.dxf"
        rooms = parse_dxf_rooms(fixture_path)
        self.assertEqual(len(rooms), 1)
        self.assertEqual(rooms[0].name, "Bad_Room_B")
        self.assertAlmostEqual(rooms[0].area, 25.0, places=1)

    def test_fixture_01_unclosed_cafe_office_plan_mm(self) -> None:
        """Acceptance: Unclosed DXF without FIRE_ROOMS extracts 10 rooms via auto."""
        fixture_path = FIXTURES_DIR / "01_unclosed_cafe_office_plan_mm.dxf"
        if not fixture_path.exists():
            fixture_path = (
                FIXTURES_DIR.parent
                / "test_drawing_dxf2"
                / "test_drawing_dxf2"
                / "01_unclosed_cafe_office_plan_mm.dxf"
            )
        rooms = parse_dxf_rooms(fixture_path)
        self.assertEqual(len(rooms), 10)
        self.assertEqual(getattr(rooms, "source", None), "auto")

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
        found_rooms = {r.name: (r.area, r.type) for r in rooms}
        for name, (exp_area, exp_type) in expected_rooms.items():
            self.assertIn(name, found_rooms)
            actual_area, actual_type = found_rooms[name]
            self.assertAlmostEqual(actual_area, exp_area, places=1)
            self.assertEqual(actual_type, exp_type)
        self.assertEqual(getattr(rooms[0], "source", None), "auto")

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
        """Acceptance: Raise CADParsingError when 0 valid contours exist."""
        dxf_path = self.temp_dir / "empty_layer.dxf"
        create_mock_dxf(
            dxf_path,
            include_fire_rooms_layer=True,
            rooms_data=[],
        )

        with self.assertRaises(CADParsingError) as ctx:
            parse_dxf_rooms(dxf_path)
        self.assertIn("Приміщення не знайдено", str(ctx.exception))

    def test_auto_polygonization_with_broken_lines_and_gaps(self) -> None:
        """Acceptance (BIM-162): Wall gap bridging with >= 80% room extraction rate."""
        dxf_path = self.temp_dir / "broken_walls.dxf"
        doc = ezdxf.new("R2010")
        doc.header["$INSUNITS"] = 4  # mm
        doc.layers.add("WALLS")
        msp = doc.modelspace()

        # 4 rooms in a 2x2 grid:
        # Bottom wall with 800mm door gap at corner: (800, 0) -> (4000, 0)
        msp.add_line((800, 0), (4000, 0), dxfattribs={"layer": "WALLS"})
        msp.add_line((4000, 0), (7900, 0), dxfattribs={"layer": "WALLS"})
        # Right wall with 100mm gap: (8000, 100) -> (8000, 10000)
        msp.add_line((8000, 100), (8000, 10000), dxfattribs={"layer": "WALLS"})
        # Top wall: (8000, 10000) -> (0, 10000)
        msp.add_line((8000, 10000), (0, 10000), dxfattribs={"layer": "WALLS"})
        # Left wall: (0, 10000) -> (0, 0)
        msp.add_line((0, 10000), (0, 0), dxfattribs={"layer": "WALLS"})

        # Internal dividers
        # Horizontal divider y=5000: (0, 5000) -> (8000, 5000)
        msp.add_line((0, 5000), (8000, 5000), dxfattribs={"layer": "WALLS"})
        # Vertical divider lower x=4000: (4000, 0) -> (4000, 5000)
        msp.add_line((4000, 0), (4000, 5000), dxfattribs={"layer": "WALLS"})
        # Vertical divider upper x=4000 with 100mm gap: (4000, 5000) -> (4000, 9900)
        msp.add_line((4000, 5000), (4000, 9900), dxfattribs={"layer": "WALLS"})

        # Room texts
        msp.add_text("Room 1", dxfattribs={"insert": (2000, 2500, 0), "layer": "WALLS"})
        msp.add_text("Room 2", dxfattribs={"insert": (6000, 2500, 0), "layer": "WALLS"})
        msp.add_text("Room 3", dxfattribs={"insert": (2000, 7500, 0), "layer": "WALLS"})
        msp.add_text("Room 4", dxfattribs={"insert": (6000, 7500, 0), "layer": "WALLS"})

        doc.saveas(str(dxf_path))

        rooms = parse_dxf_rooms(dxf_path)
        # Verify >= 80% room extraction rate (at least 3 of 4 rooms)
        self.assertGreaterEqual(len(rooms), 3)
        self.assertEqual(len(rooms), 4)
        names = {r.name for r in rooms}
        self.assertEqual(names, {"Room 1", "Room 2", "Room 3", "Room 4"})
        for r in rooms:
            self.assertEqual(getattr(r, "source", None), "auto")

    def test_auto_polygonization_explication_mapping(self) -> None:
        """Acceptance (BIM-162): Numbers inside polygons mapped to explication table."""
        dxf_path = self.temp_dir / "explication_plan.dxf"
        doc = ezdxf.new("R2010")
        doc.header["$INSUNITS"] = 4  # mm
        doc.layers.add("A-WALL")
        doc.layers.add("TEXT")
        msp = doc.modelspace()

        # 3 rooms side-by-side
        msp.add_lwpolyline(
            [(0, 0), (12000, 0), (12000, 5000), (0, 5000)],
            close=True,
            dxfattribs={"layer": "A-WALL"},
        )
        msp.add_line((4000, 0), (4000, 5000), dxfattribs={"layer": "A-WALL"})
        msp.add_line((8000, 0), (8000, 5000), dxfattribs={"layer": "A-WALL"})

        # Inside room numbers
        msp.add_text("101", dxfattribs={"insert": (2000, 2500, 0), "layer": "TEXT"})
        msp.add_text("102", dxfattribs={"insert": (6000, 2500, 0), "layer": "TEXT"})
        msp.add_text("№ 201", dxfattribs={"insert": (10000, 2500, 0), "layer": "TEXT"})

        # Explication table text entities outside rooms
        msp.add_text(
            "101 | Office", dxfattribs={"insert": (0, 12000, 0), "layer": "TEXT"}
        )
        msp.add_text(
            "102 - Storage", dxfattribs={"insert": (0, 11000, 0), "layer": "TEXT"}
        )
        msp.add_mtext(
            "201: Server Room\n", dxfattribs={"insert": (0, 10000, 0), "layer": "TEXT"}
        )

        doc.saveas(str(dxf_path))

        rooms = parse_dxf_rooms(dxf_path)
        self.assertEqual(len(rooms), 3)

        room_dict = {r.name: r for r in rooms}
        self.assertIn("Office", room_dict)
        self.assertEqual(room_dict["Office"].type, "office")

        self.assertIn("Storage", room_dict)
        self.assertEqual(room_dict["Storage"].type, "storage")

        self.assertIn("Server Room", room_dict)
        self.assertEqual(room_dict["Server Room"].type, "technical")

        for r in rooms:
            self.assertEqual(getattr(r, "source", None), "auto")

    def test_auto_polygonization_unnamed_room_and_null_type(self) -> None:
        """Acceptance (BIM-162): Room without name gets 'Без назви' and null type."""
        dxf_path = self.temp_dir / "unnamed_room.dxf"
        doc = ezdxf.new("R2010")
        doc.header["$INSUNITS"] = 4
        doc.layers.add("WALL")
        msp = doc.modelspace()

        msp.add_lwpolyline(
            [(0, 0), (5000, 0), (5000, 4000), (0, 4000)],
            close=True,
            dxfattribs={"layer": "WALL"},
        )
        doc.saveas(str(dxf_path))

        rooms = parse_dxf_rooms(dxf_path)
        self.assertEqual(len(rooms), 1)
        self.assertIn(rooms[0].name, ["Без назви", ""])
        self.assertIsNone(rooms[0].type)
        self.assertEqual(getattr(rooms[0], "source", None), "auto")

    def test_defect_1_false_envelope_removal_preserves_large_hall(self) -> None:
        """P1: Disjoint planar faces (e.g. 192 m2 hall and two 4 m2 corner rooms)

        must not be deleted as envelopes purely by area percentage.
        """
        dxf_path = self.temp_dir / "hall_with_corner_rooms.dxf"
        doc = ezdxf.new("R2010")
        doc.header["$INSUNITS"] = 6  # meters
        doc.layers.add("WALLS")
        msp = doc.modelspace()

        # 20x10 m outer boundary
        msp.add_lwpolyline(
            [(0, 0), (20, 0), (20, 10), (0, 10)],
            close=True,
            dxfattribs={"layer": "WALLS"},
        )
        # Corner room 1 at top-left: (0,8)-(2,8)-(2,10)
        msp.add_lwpolyline(
            [(0, 8), (2, 8), (2, 10)],
            close=False,
            dxfattribs={"layer": "WALLS"},
        )
        # Corner room 2 at top-right: (18,10)-(18,8)-(20,8)
        msp.add_lwpolyline(
            [(18, 10), (18, 8), (20, 8)],
            close=False,
            dxfattribs={"layer": "WALLS"},
        )

        doc.saveas(str(dxf_path))
        rooms = parse_dxf_rooms(dxf_path)
        self.assertEqual(len(rooms), 3)
        areas = sorted([r.area for r in rooms])
        self.assertAlmostEqual(areas[0], 4.0, places=1)
        self.assertAlmostEqual(areas[1], 4.0, places=1)
        self.assertAlmostEqual(areas[2], 192.0, places=1)

    def test_defect_2_open_polyline_gap_closure(self) -> None:
        """P2: Open polyline with gap > max_gap (10m) must not form a room.

        Contrast with gap <= max_gap (e.g. 0.5m) which should form a room.
        """
        # Case A: 10m gap on U-shaped polyline must NOT form a room
        dxf_path_large = self.temp_dir / "open_10m_gap.dxf"
        doc_large = ezdxf.new("R2010")
        doc_large.header["$INSUNITS"] = 6  # meters
        doc_large.layers.add("WALLS")
        doc_large.modelspace().add_lwpolyline(
            [(0, 0), (10, 0), (10, 10), (0, 10)],
            close=False,
            dxfattribs={"layer": "WALLS"},
        )
        doc_large.saveas(str(dxf_path_large))
        with self.assertRaises(CADParsingError):
            parse_dxf_rooms(dxf_path_large)

        # Case B: gap <= max_gap (0.5m gap between (0, 0.5) and (0, 0)) should close
        dxf_path_small = self.temp_dir / "open_small_gap.dxf"
        doc_small = ezdxf.new("R2010")
        doc_small.header["$INSUNITS"] = 6  # meters
        doc_small.layers.add("WALLS")
        doc_small.modelspace().add_lwpolyline(
            [(0, 0), (10, 0), (10, 10), (0, 10), (0, 0.5)],
            close=False,
            dxfattribs={"layer": "WALLS"},
        )
        doc_small.saveas(str(dxf_path_small))
        rooms = parse_dxf_rooms(dxf_path_small)
        self.assertEqual(len(rooms), 1)
        self.assertAlmostEqual(rooms[0].area, 100.0, places=0)

    def test_defect_3_multi_word_room_names_retained(self) -> None:
        """P2: Multi-word labels without delimiters must be preserved as room name.

        Retains positive test for delimited explication like '101 | Server Room'.
        """
        dxf_path = self.temp_dir / "multi_word_names.dxf"
        doc = ezdxf.new("R2010")
        doc.header["$INSUNITS"] = 6  # meters
        doc.layers.add("WALLS")
        doc.layers.add("TEXT")
        msp = doc.modelspace()

        # Room 1: Server Room (0,0)-(5,5)
        msp.add_lwpolyline(
            [(0, 0), (5, 0), (5, 5), (0, 5)],
            close=True,
            dxfattribs={"layer": "WALLS"},
        )
        msp.add_text(
            "Server Room",
            dxfattribs={"insert": (2.5, 2.5, 0), "layer": "TEXT"},
        )

        # Room 2: Storage Room (5,0)-(10,5)
        msp.add_lwpolyline(
            [(5, 0), (10, 0), (10, 5), (5, 5)],
            close=True,
            dxfattribs={"layer": "WALLS"},
        )
        msp.add_text(
            "Storage Room",
            dxfattribs={"insert": (7.5, 2.5, 0), "layer": "TEXT"},
        )

        # Room 3: Кабінет директора (0,5)-(5,10)
        msp.add_lwpolyline(
            [(0, 5), (5, 5), (5, 10), (0, 10)],
            close=True,
            dxfattribs={"layer": "WALLS"},
        )
        msp.add_text(
            "Кабінет директора",
            dxfattribs={"insert": (2.5, 7.5, 0), "layer": "TEXT"},
        )

        # Room 4: 101 | Server Room (5,5)-(10,10)
        msp.add_lwpolyline(
            [(5, 5), (10, 5), (10, 10), (5, 10)],
            close=True,
            dxfattribs={"layer": "WALLS"},
        )
        msp.add_text(
            "101 | Server Room",
            dxfattribs={"insert": (7.5, 7.5, 0), "layer": "TEXT"},
        )

        doc.saveas(str(dxf_path))
        rooms = parse_dxf_rooms(dxf_path)
        self.assertEqual(len(rooms), 4)
        names = {r.name: r.type for r in rooms}

        self.assertIn("Server Room", names)
        self.assertEqual(names["Server Room"], "technical")

        self.assertIn("Storage Room", names)
        self.assertEqual(names["Storage Room"], "storage")

        self.assertIn("Кабінет директора", names)
        self.assertEqual(names["Кабінет директора"], "office")

        # The delimited one also extracts "Server Room" with type "technical"
        server_rooms = [r for r in rooms if r.name == "Server Room"]
        self.assertEqual(len(server_rooms), 2)

    def test_donut_room_with_inner_office_meters(self) -> None:
        """P1 (Test A1): Donut hall (20x10m with 4x2m inner room) in meters.

        $INSUNITS=6 must return BOTH Hall (192 m2) and Office (8 m2).
        """
        dxf_path = self.temp_dir / "donut_hall_office_meters.dxf"
        doc = ezdxf.new("R2010")
        doc.header["$INSUNITS"] = 6  # meters
        doc.layers.add("WALLS")
        doc.layers.add("TEXT")
        msp = doc.modelspace()

        # 20x10 m outer contour
        msp.add_lwpolyline(
            [(0, 0), (20, 0), (20, 10), (0, 10)],
            close=True,
            dxfattribs={"layer": "WALLS"},
        )
        msp.add_text("Hall", dxfattribs={"insert": (4, 4, 0), "layer": "TEXT"})

        # 4x2 m inner room at (8,4)-(12,6)
        msp.add_lwpolyline(
            [(8, 4), (12, 4), (12, 6), (8, 6)],
            close=True,
            dxfattribs={"layer": "WALLS"},
        )
        msp.add_text("Office", dxfattribs={"insert": (10, 5, 0), "layer": "TEXT"})

        doc.saveas(str(dxf_path))
        rooms = parse_dxf_rooms(dxf_path)
        self.assertEqual(len(rooms), 2)
        by_name = {r.name: r for r in rooms}
        self.assertIn("Hall", by_name)
        self.assertIn("Office", by_name)
        self.assertAlmostEqual(by_name["Hall"].area, 192.0, places=1)
        self.assertAlmostEqual(by_name["Office"].area, 8.0, places=1)

    def test_donut_room_with_inner_office_millimeters(self) -> None:
        """P1 (Test A2): Donut hall in millimeters ($INSUNITS=4).

        20000x10000 and 4000x2000 must return both rooms with exact areas.
        """
        dxf_path = self.temp_dir / "donut_hall_office_mm.dxf"
        doc = ezdxf.new("R2010")
        doc.header["$INSUNITS"] = 4  # millimeters
        doc.layers.add("WALLS")
        doc.layers.add("TEXT")
        msp = doc.modelspace()

        # 20000x10000 mm outer contour
        msp.add_lwpolyline(
            [(0, 0), (20000, 0), (20000, 10000), (0, 10000)],
            close=True,
            dxfattribs={"layer": "WALLS"},
        )
        msp.add_text("Hall", dxfattribs={"insert": (4000, 4000, 0), "layer": "TEXT"})

        # 4000x2000 mm inner room at (8000,4000)-(12000,6000)
        msp.add_lwpolyline(
            [(8000, 4000), (12000, 4000), (12000, 6000), (8000, 6000)],
            close=True,
            dxfattribs={"layer": "WALLS"},
        )
        msp.add_text("Office", dxfattribs={"insert": (10000, 5000, 0), "layer": "TEXT"})

        doc.saveas(str(dxf_path))
        rooms = parse_dxf_rooms(dxf_path)
        self.assertEqual(len(rooms), 2)
        by_name = {r.name: r for r in rooms}
        self.assertIn("Hall", by_name)
        self.assertIn("Office", by_name)
        self.assertAlmostEqual(by_name["Hall"].area, 192.0, places=1)
        self.assertAlmostEqual(by_name["Office"].area, 8.0, places=1)

    def test_true_envelope_discarded_when_unlabeled(self) -> None:
        """P1 (Test A3): Outer 20x10 boundary has NO text label, but inside there are

        two separate labeled rooms (4 m2 each) -> outer boundary is discarded.
        """
        dxf_path = self.temp_dir / "true_envelope_two_offices.dxf"
        doc = ezdxf.new("R2010")
        doc.header["$INSUNITS"] = 6  # meters
        doc.layers.add("WALLS")
        doc.layers.add("TEXT")
        msp = doc.modelspace()

        # Outer 20x10 boundary without text
        msp.add_lwpolyline(
            [(0, 0), (20, 0), (20, 10), (0, 10)],
            close=True,
            dxfattribs={"layer": "WALLS"},
        )

        # Room 1: 2x2 m at (2, 2)
        msp.add_lwpolyline(
            [(2, 2), (4, 2), (4, 4), (2, 4)],
            close=True,
            dxfattribs={"layer": "WALLS"},
        )
        msp.add_text("Office 1", dxfattribs={"insert": (3, 3, 0), "layer": "TEXT"})

        # Room 2: 2x2 m at (10, 2)
        msp.add_lwpolyline(
            [(10, 2), (12, 2), (12, 4), (10, 4)],
            close=True,
            dxfattribs={"layer": "WALLS"},
        )
        msp.add_text("Office 2", dxfattribs={"insert": (11, 3, 0), "layer": "TEXT"})

        doc.saveas(str(dxf_path))
        rooms = parse_dxf_rooms(dxf_path)
        self.assertEqual(len(rooms), 2)
        names = {r.name for r in rooms}
        self.assertEqual(names, {"Office 1", "Office 2"})
        areas = sorted([r.area for r in rooms])
        self.assertAlmostEqual(areas[0], 4.0, places=1)
        self.assertAlmostEqual(areas[1], 4.0, places=1)

    def test_extract_walls_and_bridge_gaps_explicit_max_gap(self) -> None:
        """P2 (Test B1): Calling _extract_walls_and_bridge_gaps with explicit max_gap

        (0 and 1.2) must not raise UnboundLocalError.
        """
        doc = ezdxf.new("R2010")
        doc.header["$INSUNITS"] = 6
        doc.layers.add("WALLS")
        msp = doc.modelspace()
        msp.add_lwpolyline(
            [(0, 0), (10, 0), (10, 10), (0, 10)],
            close=False,
            dxfattribs={"layer": "WALLS"},
        )

        from src.modules.cad.parser import _extract_walls_and_bridge_gaps

        # Calling with max_gap=0 must succeed
        segs_0 = _extract_walls_and_bridge_gaps(msp, max_gap=0)
        self.assertIsInstance(segs_0, list)

        # Calling with max_gap=1.2 must succeed
        segs_12 = _extract_walls_and_bridge_gaps(msp, max_gap=1.2)
        self.assertIsInstance(segs_12, list)

    def test_extract_walls_and_bridge_gaps_zero_disables_bridging(self) -> None:
        """P2 (Test B2): With max_gap=0, open contour (0.1m gap) is NOT closed."""
        doc = ezdxf.new("R2010")
        doc.header["$INSUNITS"] = 6
        doc.layers.add("WALLS")
        msp = doc.modelspace()
        msp.add_lwpolyline(
            [(0, 0), (10, 0), (10, 10), (0, 10), (0, 0.1)],
            close=False,
            dxfattribs={"layer": "WALLS"},
        )

        from src.modules.cad.parser import _extract_walls_and_bridge_gaps

        # When max_gap=0, bridging is completely disabled: only 4 drawn segments exist
        segs = _extract_walls_and_bridge_gaps(msp, max_gap=0)
        self.assertEqual(len(segs), 4)

    def test_auto_polygonization_discards_envelope_and_artifacts(self) -> None:
        """Acceptance (BIM-162): Outer envelope and tiny artifacts are discarded."""
        dxf_path = self.temp_dir / "envelope_and_artifacts.dxf"
        doc = ezdxf.new("R2010")
        doc.header["$INSUNITS"] = 6  # meters
        doc.layers.add("WALLS")
        msp = doc.modelspace()

        # Outer building envelope (20m x 10m = 200m2)
        msp.add_lwpolyline(
            [(0, 0), (20, 0), (20, 10), (0, 10)],
            close=True,
            dxfattribs={"layer": "WALLS"},
        )

        # Room 1: (2, 2) to (8, 8) = 36 m2
        msp.add_lwpolyline(
            [(2, 2), (8, 2), (8, 8), (2, 8)], close=True, dxfattribs={"layer": "WALLS"}
        )
        msp.add_text("Office 1", dxfattribs={"insert": (5, 5, 0), "layer": "WALLS"})

        # Room 2: (10, 2) to (18, 8) = 48 m2
        msp.add_lwpolyline(
            [(10, 2), (18, 2), (18, 8), (10, 8)],
            close=True,
            dxfattribs={"layer": "WALLS"},
        )
        msp.add_text("Office 2", dxfattribs={"insert": (14, 5, 0), "layer": "WALLS"})

        # Tiny artifact: 0.4m x 0.4m = 0.16 m2 (< 0.5 m2)
        msp.add_lwpolyline(
            [(1, 1), (1.4, 1), (1.4, 1.4), (1, 1.4)],
            close=True,
            dxfattribs={"layer": "WALLS"},
        )

        doc.saveas(str(dxf_path))

        rooms = parse_dxf_rooms(dxf_path)
        self.assertEqual(len(rooms), 2)
        names = {r.name for r in rooms}
        self.assertEqual(names, {"Office 1", "Office 2"})

    def test_no_rooms_found_raises_cad_parsing_error(self) -> None:
        """Acceptance (BIM-162): DXF with no rooms raises CADParsingError."""
        dxf_path = self.temp_dir / "no_rooms.dxf"
        doc = ezdxf.new("R2010")
        doc.layers.add("WALLS")
        msp = doc.modelspace()
        # Single disjoint line that cannot form a room
        msp.add_line((0, 0), (10, 10), dxfattribs={"layer": "WALLS"})
        doc.saveas(str(dxf_path))

        with self.assertRaises(CADParsingError) as ctx:
            parse_dxf_rooms(dxf_path)
        self.assertIn("Приміщення не знайдено", str(ctx.exception))

    def _create_donut_dxf(
        self,
        filename: str,
        *,
        insunits: int = 6,
        scale: float = 1.0,
        hall_label: str | None = "Hall",
        office_label: str = "Office",
        holes: list[tuple[float, float, float, float, str]] | None = None,
    ) -> Path:
        dxf_path = self.temp_dir / filename
        doc = ezdxf.new("R2010")
        doc.header["$INSUNITS"] = insunits
        doc.layers.add("WALLS")
        doc.layers.add("TEXT")
        msp = doc.modelspace()

        msp.add_lwpolyline(
            [(0, 0), (20 * scale, 0), (20 * scale, 10 * scale), (0, 10 * scale)],
            close=True,
            dxfattribs={"layer": "WALLS"},
        )
        if hall_label is not None:
            msp.add_text(
                hall_label,
                dxfattribs={"insert": (1 * scale, 1 * scale, 0), "layer": "TEXT"},
            )

        hole_defs = (
            holes if holes is not None else [(8.0, 4.0, 12.0, 6.0, office_label)]
        )
        for x0, y0, x1, y1, label in hole_defs:
            msp.add_lwpolyline(
                [
                    (x0 * scale, y0 * scale),
                    (x1 * scale, y0 * scale),
                    (x1 * scale, y1 * scale),
                    (x0 * scale, y1 * scale),
                ],
                close=True,
                dxfattribs={"layer": "WALLS"},
            )
            msp.add_text(
                label,
                dxfattribs={
                    "insert": (0.5 * (x0 + x1) * scale, 0.5 * (y0 + y1) * scale, 0),
                    "layer": "TEXT",
                },
            )

        doc.saveas(str(dxf_path))
        return dxf_path

    def test_donut_serialized_polygon_preserves_hole_and_net_area_meters(self) -> None:
        """P1 (Test A1): Serialized polygon for donut Hall excludes inner Office."""
        dxf_path = self._create_donut_dxf("donut_serialized_meters.dxf")
        rooms = parse_dxf_rooms(dxf_path)
        by_name = {r.name: r for r in rooms}
        self.assertIn("Hall", by_name)
        self.assertIn("Office", by_name)

        hall_poly = ShapelyPolygon([(p.x, p.y) for p in by_name["Hall"].polygon])
        office_poly = ShapelyPolygon([(p.x, p.y) for p in by_name["Office"].polygon])

        self.assertTrue(hall_poly.is_valid)
        self.assertAlmostEqual(hall_poly.area, 192.0, places=4)
        self.assertAlmostEqual(hall_poly.intersection(office_poly).area, 0.0, places=6)

        placed = place_devices_from_rule(
            [(p.x, p.y) for p in by_name["Hall"].polygon],
            RuleRecord(id="r1", threshold=4.0),
        )
        self.assertGreater(len(placed), 0)
        for device in placed:
            self.assertFalse(office_poly.contains(ShapelyPoint(device.x, device.y)))

    def test_donut_serialized_polygon_preserves_hole_millimeters(self) -> None:
        """P1 (Test A2): Serialized polygon keeps hole geometry in mm ($INSUNITS=4)."""
        dxf_path = self._create_donut_dxf(
            "donut_serialized_mm.dxf", insunits=4, scale=1000.0
        )
        rooms = parse_dxf_rooms(dxf_path)
        by_name = {r.name: r for r in rooms}
        self.assertIn("Hall", by_name)
        self.assertIn("Office", by_name)

        hall_poly = ShapelyPolygon([(p.x, p.y) for p in by_name["Hall"].polygon])
        office_poly = ShapelyPolygon([(p.x, p.y) for p in by_name["Office"].polygon])

        self.assertTrue(hall_poly.is_valid)
        self.assertAlmostEqual(hall_poly.area * 1e-6, 192.0, places=4)
        self.assertAlmostEqual(hall_poly.intersection(office_poly).area, 0.0, places=4)

    def test_multi_hole_serialized_polygon_preserves_all_holes(self) -> None:
        """P1 (Test A3): Room enclosing two rooms keeps net area and zero overlap."""
        dxf_path = self._create_donut_dxf(
            "donut_multi_holes.dxf",
            holes=[(2.0, 2.0, 6.0, 8.0, "Room A"), (12.0, 2.0, 16.0, 8.0, "Room B")],
        )
        rooms = parse_dxf_rooms(dxf_path)
        by_name = {r.name: r for r in rooms}
        self.assertEqual(set(by_name.keys()), {"Hall", "Room A", "Room B"})

        hall_poly = ShapelyPolygon([(p.x, p.y) for p in by_name["Hall"].polygon])
        room_a = ShapelyPolygon([(p.x, p.y) for p in by_name["Room A"].polygon])
        room_b = ShapelyPolygon([(p.x, p.y) for p in by_name["Room B"].polygon])

        self.assertTrue(hall_poly.is_valid)
        self.assertAlmostEqual(hall_poly.area, 152.0, places=4)
        self.assertAlmostEqual(hall_poly.intersection(room_a).area, 0.0, places=6)
        self.assertAlmostEqual(hall_poly.intersection(room_b).area, 0.0, places=6)

    def test_combined_room_name_and_area_label_preserved(self) -> None:
        """P2 (Test B1): Combined label 'Hall (192 m2)' is NOT treated as pure area."""
        dxf_path = self._create_donut_dxf(
            "donut_combined_label.dxf", hall_label="Hall (192 m2)"
        )
        rooms = parse_dxf_rooms(dxf_path)
        by_name = {r.name: r for r in rooms}
        self.assertIn("Hall (192 m2)", by_name)
        self.assertIn("Office", by_name)
        self.assertAlmostEqual(by_name["Hall (192 m2)"].area, 192.0, places=1)

    def test_combined_explication_and_area_label_preserved(self) -> None:
        """P2 (Test B2): Combined explication '101 | Hall | 192 m2' keeps the room."""
        dxf_path = self._create_donut_dxf(
            "donut_explication_area.dxf", hall_label="101 | Hall | 192 m2"
        )
        rooms = parse_dxf_rooms(dxf_path)
        by_name = {r.name: r for r in rooms}
        self.assertIn("Hall", by_name)
        self.assertIn("Office", by_name)
        self.assertAlmostEqual(by_name["Hall"].area, 192.0, places=1)

    def test_is_area_string_only_matches_pure_area_annotations(self) -> None:
        """P2 (Test B3): _is_area_string matches ONLY standalone area strings."""
        for pure_area in ("192 m2", "~25.0 sq m", " 24.0 m² ", "≈ 12,5 sqm", "16.5 м2"):
            self.assertTrue(_is_area_string(pure_area), msg=pure_area)

        for mixed_or_other in (
            "Hall (192 m2)",
            "101 | Hall | 192 m2",
            "Kitchen 16 m2",
            "101",
            "Office",
        ):
            self.assertFalse(_is_area_string(mixed_or_other), msg=mixed_or_other)

        # Standalone area annotation inside an envelope must NOT save envelope
        dxf_path = self._create_donut_dxf(
            "donut_pure_area_only.dxf", hall_label="192 m2"
        )
        rooms = parse_dxf_rooms(dxf_path)
        self.assertEqual([r.name for r in rooms], ["Office"])

    def test_touching_hole_serialized_polygon_excludes_office(self) -> None:
        """P1: Hole touching exterior boundary at (0, 5) is spliced cleanly."""
        dxf_path = self.temp_dir / "touching_hole_meters.dxf"
        doc = ezdxf.new("R2010")
        doc.header["$INSUNITS"] = 6
        doc.layers.add("WALLS")
        doc.layers.add("TEXT")
        msp = doc.modelspace()

        outer_pts = [(0.0, 0.0), (20.0, 0.0), (20.0, 10.0), (0.0, 10.0)]
        office_pts = [(0.0, 5.0), (3.0, 3.0), (5.0, 5.0), (3.0, 7.0)]

        msp.add_lwpolyline(outer_pts, close=True, dxfattribs={"layer": "WALLS"})
        msp.add_lwpolyline(office_pts, close=True, dxfattribs={"layer": "WALLS"})
        msp.add_text("Hall", dxfattribs={"insert": (10.0, 2.0, 0.0), "layer": "TEXT"})
        msp.add_text("Office", dxfattribs={"insert": (3.0, 5.0, 0.0), "layer": "TEXT"})
        doc.saveas(str(dxf_path))

        rooms = parse_dxf_rooms(dxf_path)
        by_name = {r.name: r for r in rooms}
        self.assertEqual(set(by_name.keys()), {"Hall", "Office"})
        self.assertAlmostEqual(by_name["Hall"].area, 190.0, places=4)
        self.assertAlmostEqual(by_name["Office"].area, 10.0, places=4)

        reconstructed_hall = ShapelyPolygon(
            [(p.x, p.y) for p in by_name["Hall"].polygon]
        )
        office_poly = ShapelyPolygon([(p.x, p.y) for p in by_name["Office"].polygon])
        original_shapely_hall = ShapelyPolygon(outer_pts, [office_pts])

        self.assertTrue(reconstructed_hall.is_valid)
        self.assertAlmostEqual(reconstructed_hall.area, 190.0, delta=1e-3)
        self.assertAlmostEqual(
            reconstructed_hall.intersection(office_poly).area, 0.0, places=6
        )
        self.assertLessEqual(
            reconstructed_hall.symmetric_difference(original_shapely_hall).area, 1e-3
        )

        # Also ensure empty-grid placement fallback lands in Hall, not Office
        placed = place_devices_from_rule(
            [(p.x, p.y) for p in by_name["Hall"].polygon],
            RuleRecord(id="r-touch-fallback", threshold=12.0),
        )
        self.assertGreaterEqual(len(placed), 1)
        for device in placed:
            pt = ShapelyPoint(device.x, device.y)
            self.assertTrue(reconstructed_hall.covers(pt))
            self.assertFalse(office_poly.contains(pt))

    def test_touching_hole_variants_and_strict_validation(self) -> None:
        """P1: Touching holes convert cleanly; failures raise CADParsingError."""
        variants = [
            # Outer vertex (4, 5) touching interior of hole edge (4, 2)-(4, 8)
            ShapelyPolygon(
                [(0, 0), (20, 0), (20, 10), (0, 10), (4, 5)],
                [[(4, 2), (8, 2), (8, 8), (4, 8)]],
            ),
            # Corner-to-corner touch at (0, 0)
            ShapelyPolygon(
                [(0, 0), (20, 0), (20, 10), (0, 10)],
                [[(0, 0), (3, 1), (4, 4), (1, 3)]],
            ),
            # Two holes touching exterior at the same point (0, 5)
            ShapelyPolygon(
                [(0, 0), (20, 0), (20, 10), (0, 10)],
                [[(0, 5), (3, 3), (4, 4)], [(0, 5), (4, 6), (3, 7)]],
            ),
        ]
        for poly in variants:
            ring = _polygon_to_single_ring(poly)
            reconstructed = ShapelyPolygon(ring)
            self.assertTrue(reconstructed.is_valid)
            self.assertLessEqual(reconstructed.symmetric_difference(poly).area, 1e-3)

        donut = ShapelyPolygon(
            [(0, 0), (20, 0), (20, 10), (0, 10)],
            [[(8, 4), (12, 4), (12, 6), (8, 6)]],
        )
        with patch("src.modules.cad.parser._merge_hole_into_outer", return_value=None):
            with self.assertRaises(CADParsingError) as ctx:
                _polygon_to_single_ring(donut)
            self.assertIn(
                "Не вдалося коректно обробити внутрішні отвори приміщення",
                str(ctx.exception),
            )

        with patch(
            "src.modules.cad.parser._merge_hole_into_outer",
            return_value=[(0.0, 0.0), (20.0, 0.0), (20.0, 10.0), (0.0, 10.0)],
        ):
            with self.assertRaises(CADParsingError) as ctx:
                _polygon_to_single_ring(donut)
            self.assertIn(
                "Не вдалося коректно обробити внутрішні отвори приміщення",
                str(ctx.exception),
            )


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
            self.assertEqual(tmp_path.parent, Path("/tmp"))
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

    def test_extract_rooms_fallback_auto_success(self) -> None:
        """Verify endpoint falls back to auto extraction when FIRE_ROOMS is missing."""
        fixture_path = FIXTURES_DIR / "03_bad_unclosed_meters.dxf"
        self.mock_supabase.storage.from_().download.return_value = (
            fixture_path.read_bytes()
        )

        response = self.client.post(
            "/api/v1/cad/extract-rooms",
            json={"file_path": "drawings/unclosed.dxf"},
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIsInstance(data, list)
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]["name"], "Bad_Room_B")

    def test_extract_rooms_01_unclosed_cafe_office_plan_mm_success(self) -> None:
        """Verify endpoint extracts 10 rooms from 01_unclosed_cafe_office_plan_mm."""
        fixture_path = FIXTURES_DIR / "01_unclosed_cafe_office_plan_mm.dxf"
        if not fixture_path.exists():
            fixture_path = (
                FIXTURES_DIR.parent
                / "test_drawing_dxf2"
                / "test_drawing_dxf2"
                / "01_unclosed_cafe_office_plan_mm.dxf"
            )
        self.mock_supabase.storage.from_().download.return_value = (
            fixture_path.read_bytes()
        )

        response = self.client.post(
            "/api/v1/cad/extract-rooms",
            json={"file_path": "drawings/01_unclosed_cafe_office_plan_mm.dxf"},
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIsInstance(data, list)
        self.assertEqual(len(data), 10)
        names = {r["name"] for r in data}
        self.assertIn("Main_Corridor", names)
        self.assertIn("Cafe_Hall", names)
        self.assertIn("Kitchen", names)
        self.assertIn("Storage_Room", names)

    def test_extract_rooms_no_rooms_found_returns_400(self) -> None:
        """Verify endpoint returns 400 CADParsingError when no rooms are found."""
        with tempfile.TemporaryDirectory() as tmp_dir:
            empty_dxf = Path(tmp_dir) / "empty.dxf"
            doc = ezdxf.new("R2010")
            doc.modelspace().add_line((0, 0), (10, 10))
            doc.saveas(str(empty_dxf))
            self.mock_supabase.storage.from_().download.return_value = (
                empty_dxf.read_bytes()
            )

            response = self.client.post(
                "/api/v1/cad/extract-rooms",
                json={"file_path": "drawings/bad.dxf"},
            )
            self.assertEqual(response.status_code, 400)
            data = response.json()
            self.assertEqual(data["error"], "CADParsingError")
            self.assertIn("Приміщення не знайдено", data["message"])

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
