from pathlib import Path

import ezdxf
from ezdxf.enums import TextEntityAlignment


def add_sensors_to_dxf(
    input_path: Path,
    output_path: Path,
    sensor_coords: list[tuple[float, float]],
) -> None:
    """Add fire sensors to DXF file on layer SYS_FIRE_SENSORS.

    Args:
        input_path: Path to source DXF file.
        output_path: Path where modified DXF will be saved.
        sensor_coords: List of (x, y) coordinates for sensor placement.
    """
    path = Path(input_path)
    doc = ezdxf.readfile(str(path))

    # Audit document to heal missing handles or structures from non-standard DXFs
    doc.audit()

    layer_name = "SYS_FIRE_SENSORS"
    block_name = "FIRE_DET_SMOKE"

    # Add or update SYS_FIRE_SENSORS layer with color 1 (red)
    if layer_name not in doc.layers:
        doc.layers.add(name=layer_name, color=1)
    else:
        doc.layers.get(layer_name).color = 1

    # Create FIRE_DET_SMOKE block containing circle (r=150) and text "S" (h=120)
    if block_name not in doc.blocks:
        block = doc.blocks.new(name=block_name)
        block.add_circle(
            center=(0.0, 0.0),
            radius=150.0,
            dxfattribs={"layer": layer_name},
        )
        block.add_text(
            "S",
            dxfattribs={"height": 120.0, "layer": layer_name},
        ).set_placement((0.0, 0.0), align=TextEntityAlignment.MIDDLE_CENTER)

    # Insert block references into modelspace at each coordinate
    msp = doc.modelspace()
    for x, y in sensor_coords:
        msp.add_blockref(
            block_name,
            insert=(float(x), float(y)),
            dxfattribs={"layer": layer_name},
        )

    out_p = Path(output_path)
    out_p.parent.mkdir(parents=True, exist_ok=True)
    doc.saveas(str(out_p))
