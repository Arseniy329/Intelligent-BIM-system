import shutil
import sys
import tempfile
import unittest
from pathlib import Path

import ezdxf

API_DIR = Path(__file__).resolve().parent.parent
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

from src.modules.cad.writer import add_sensors_to_dxf


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


if __name__ == "__main__":
    unittest.main()
