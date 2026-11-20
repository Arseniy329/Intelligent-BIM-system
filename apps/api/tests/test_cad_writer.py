import shutil
import sys
import tempfile
import unittest
from pathlib import Path

import ezdxf

API_DIR = Path(__file__).resolve().parent.parent
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

from src.modules.cad.writer import add_devices_to_dxf, add_sensors_to_dxf


class TestCadWriter(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = Path(tempfile.mkdtemp())
        self.input_dxf = self.temp_dir / "input.dxf"
        self.output_dxf = self.temp_dir / "output.dxf"

        # Create a base DXF file with an architecture layer
        doc = ezdxf.new("R2010")
        doc.layers.add("WALLS", color=7)
        msp = doc.modelspace()
        msp.add_lwpolyline(
            [(0, 0), (1000, 0), (1000, 1000), (0, 1000)],
            close=True,
            dxfattribs={"layer": "WALLS"},
        )
        doc.saveas(str(self.input_dxf))

    def tearDown(self) -> None:
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_add_sensors_layer_properties(self) -> None:
        """Verify layer SYS_FIRE_SENSORS exists and has color 1 (red)."""
        sensor_coords = [(100.0, 200.0), (300.0, 400.0)]
        add_sensors_to_dxf(self.input_dxf, self.output_dxf, sensor_coords)

        self.assertTrue(self.output_dxf.exists())
        out_doc = ezdxf.readfile(str(self.output_dxf))

        self.assertIn("SYS_FIRE_SENSORS", out_doc.layers)
        layer = out_doc.layers.get("SYS_FIRE_SENSORS")
        self.assertEqual(layer.color, 1)

    def test_add_sensors_block_definition(self) -> None:
        """Verify FIRE_DET_SMOKE block exists with circle and text 'S'."""
        sensor_coords = [(100.0, 200.0)]
        add_sensors_to_dxf(self.input_dxf, self.output_dxf, sensor_coords)

        out_doc = ezdxf.readfile(str(self.output_dxf))
        self.assertIn("FIRE_DET_SMOKE", out_doc.blocks)

        block = out_doc.blocks.get("FIRE_DET_SMOKE")
        entities = list(block)

        # Check for circle
        circles = [e for e in entities if e.dxftype() == "CIRCLE"]
        self.assertEqual(len(circles), 1)
        circle = circles[0]
        self.assertEqual(circle.dxf.radius, 150.0)
        self.assertEqual(circle.dxf.layer, "SYS_FIRE_SENSORS")

        # Check for text
        texts = [e for e in entities if e.dxftype() == "TEXT"]
        self.assertEqual(len(texts), 1)
        text = texts[0]
        self.assertEqual(text.dxf.text, "S")
        self.assertEqual(text.dxf.height, 120.0)
        self.assertEqual(text.dxf.layer, "SYS_FIRE_SENSORS")

    def test_add_sensors_inserts_count_and_positions(self) -> None:
        """Verify block references inserted at exact coordinates."""
        sensor_coords = [(150.0, 250.0), (500.0, 750.0), (800.0, 900.0)]
        add_sensors_to_dxf(self.input_dxf, self.output_dxf, sensor_coords)

        out_doc = ezdxf.readfile(str(self.output_dxf))
        msp = out_doc.modelspace()

        inserts = [e for e in msp if e.dxftype() == "INSERT"]
        self.assertEqual(len(inserts), 3)

        inserted_points = []
        for ins in inserts:
            self.assertEqual(ins.dxf.name, "FIRE_DET_SMOKE")
            self.assertEqual(ins.dxf.layer, "SYS_FIRE_SENSORS")
            inserted_points.append((ins.dxf.insert.x, ins.dxf.insert.y))

        self.assertEqual(inserted_points, sensor_coords)

    def test_add_sensors_preserves_original_architecture(self) -> None:
        """Verify original layers and entities remain intact after writing sensors."""
        sensor_coords = [(200.0, 200.0)]
        add_sensors_to_dxf(self.input_dxf, self.output_dxf, sensor_coords)

        out_doc = ezdxf.readfile(str(self.output_dxf))

        # Check WALLS layer still exists
        self.assertIn("WALLS", out_doc.layers)

        # Check polyline on WALLS layer still exists in modelspace
        msp = out_doc.modelspace()
        walls_entities = [e for e in msp if e.dxf.layer == "WALLS"]
        self.assertEqual(len(walls_entities), 1)
        self.assertEqual(walls_entities[0].dxftype(), "LWPOLYLINE")

    def test_add_sensors_empty_coords(self) -> None:
        """Verify output DXF is created even if sensor coordinates are empty."""
        add_sensors_to_dxf(self.input_dxf, self.output_dxf, [])

        out_doc = ezdxf.readfile(str(self.output_dxf))
        self.assertIn("SYS_FIRE_SENSORS", out_doc.layers)
        self.assertIn("FIRE_DET_SMOKE", out_doc.blocks)

        msp = out_doc.modelspace()
        inserts = [e for e in msp if e.dxftype() == "INSERT"]
        self.assertEqual(len(inserts), 0)

    def test_add_devices_uses_a_block_per_type(self) -> None:
        """Each device type gets its own block: shape and label differ."""
        devices = [
            (100.0, 100.0, "smoke_detector"),
            (200.0, 200.0, "heat_detector"),
            (300.0, 300.0, "manual_call_point"),
            (400.0, 400.0, "sounder"),
            (500.0, 500.0, "unknown_type"),
        ]
        add_devices_to_dxf(self.input_dxf, self.output_dxf, devices)

        out_doc = ezdxf.readfile(str(self.output_dxf))
        inserts = [e for e in out_doc.modelspace() if e.dxftype() == "INSERT"]
        self.assertEqual(
            [(e.dxf.insert.x, e.dxf.name) for e in inserts],
            [
                (100.0, "FIRE_DET_SMOKE"),
                (200.0, "FIRE_DET_HEAT"),
                (300.0, "FIRE_MCP"),
                (400.0, "FIRE_SOUNDER"),
                (500.0, "FIRE_DET_SMOKE"),
            ],
        )
        # BIM-75: ручні сповіщувачі — на власному шарі, решта — на SYS_FIRE_SENSORS.
        self.assertEqual(
            [e.dxf.layer for e in inserts],
            [
                "SYS_FIRE_SENSORS",
                "SYS_FIRE_SENSORS",
                "SYS_FIRE_MCP",
                "SYS_FIRE_SENSORS",
                "SYS_FIRE_SENSORS",
            ],
        )

        expected = {
            "FIRE_DET_SMOKE": ("CIRCLE", "S", 0),
            "FIRE_DET_HEAT": ("LWPOLYLINE", "H", 3),
            "FIRE_MCP": ("LWPOLYLINE", "M", 4),
            "FIRE_SOUNDER": ("LWPOLYLINE", "A", 4),
        }
        for block_name, (outline_type, label, vertices) in expected.items():
            with self.subTest(block=block_name):
                entities = list(out_doc.blocks.get(block_name))
                outlines = [e for e in entities if e.dxftype() == outline_type]
                texts = [e for e in entities if e.dxftype() == "TEXT"]
                self.assertEqual(len(outlines), 1)
                self.assertEqual([t.dxf.text for t in texts], [label])
                block_layer = (
                    "SYS_FIRE_MCP" if block_name == "FIRE_MCP" else "SYS_FIRE_SENSORS"
                )
                self.assertTrue(all(e.dxf.layer == block_layer for e in entities))
                if vertices:
                    self.assertTrue(outlines[0].closed)
                    self.assertEqual(len(outlines[0]), vertices)

    def test_manual_call_points_use_a_separate_layer(self) -> None:
        """BIM-75: SYS_FIRE_MCP існує окремо від SYS_FIRE_SENSORS і має свій колір."""
        devices = [
            (100.0, 100.0, "smoke_detector"),
            (200.0, 200.0, "manual_call_point"),
        ]
        add_devices_to_dxf(self.input_dxf, self.output_dxf, devices)

        out_doc = ezdxf.readfile(str(self.output_dxf))
        self.assertIn("SYS_FIRE_SENSORS", out_doc.layers)
        self.assertIn("SYS_FIRE_MCP", out_doc.layers)
        self.assertNotEqual(
            out_doc.layers.get("SYS_FIRE_MCP").color,
            out_doc.layers.get("SYS_FIRE_SENSORS").color,
        )
        by_name = {
            e.dxf.name: e.dxf.layer
            for e in out_doc.modelspace()
            if e.dxftype() == "INSERT"
        }
        self.assertEqual(
            by_name, {"FIRE_DET_SMOKE": "SYS_FIRE_SENSORS", "FIRE_MCP": "SYS_FIRE_MCP"}
        )

    def test_mcp_layer_is_not_created_without_manual_call_points(self) -> None:
        add_devices_to_dxf(
            self.input_dxf, self.output_dxf, [(100.0, 100.0, "smoke_detector")]
        )
        out_doc = ezdxf.readfile(str(self.output_dxf))
        self.assertNotIn("SYS_FIRE_MCP", out_doc.layers)

    def test_every_device_with_a_rule_carries_the_rule_id(self) -> None:
        """BIM-75: у DXF кожен прилад посилається на правило (XDATA BIM_FIRE)."""
        devices = [
            (100.0, 100.0, "manual_call_point", "MANUAL_CALL_POINT_SPACING_DSTU"),
            (200.0, 200.0, "manual_call_point", "MANUAL_CALL_POINT_SPACING_DSTU"),
            (300.0, 300.0, "smoke_detector", "SMOKE_GRID_HEIGHT_3_5"),
            (400.0, 400.0, "smoke_detector", None),
            (500.0, 500.0, "smoke_detector"),
        ]
        add_devices_to_dxf(self.input_dxf, self.output_dxf, devices)

        out_doc = ezdxf.readfile(str(self.output_dxf))
        inserts = [e for e in out_doc.modelspace() if e.dxftype() == "INSERT"]
        rule_codes = []
        for insert in inserts:
            if insert.has_xdata("BIM_FIRE"):
                values = [tag.value for tag in insert.get_xdata("BIM_FIRE")]
                self.assertIn("rule_id", values)
                rule_codes.append(values[values.index("rule_id") + 1])
            else:
                rule_codes.append(None)
        self.assertEqual(
            rule_codes,
            [
                "MANUAL_CALL_POINT_SPACING_DSTU",
                "MANUAL_CALL_POINT_SPACING_DSTU",
                "SMOKE_GRID_HEIGHT_3_5",
                None,
                None,
            ],
        )


if __name__ == "__main__":
    unittest.main()
