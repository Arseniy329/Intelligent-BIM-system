from pathlib import Path
from typing import NamedTuple

import ezdxf
from ezdxf.document import Drawing
from ezdxf.enums import TextEntityAlignment

LAYER_NAME = "SYS_FIRE_SENSORS"
DEFAULT_DEVICE_TYPE = "smoke_detector"
SYMBOL_HALF_SIZE = 150.0
TEXT_HEIGHT = 120.0


class DeviceSymbol(NamedTuple):
    block_name: str
    label: str
    # Closed outline in block coordinates; None draws a circle.
    outline: list[tuple[float, float]] | None
    label_y: float = 0.0


_S = SYMBOL_HALF_SIZE

# Shapes follow the web plan overlay (apps/web/components/drawing/device-symbol.tsx):
# smoke = circle, heat = triangle, manual call point = square, sounder = diamond.
DEVICE_SYMBOLS: dict[str, DeviceSymbol] = {
    "smoke_detector": DeviceSymbol("FIRE_DET_SMOKE", "S", None),
    "heat_detector": DeviceSymbol(
        "FIRE_DET_HEAT", "H", [(0.0, _S), (_S, -_S), (-_S, -_S)], label_y=-_S / 2.5
    ),
    "manual_call_point": DeviceSymbol(
        "FIRE_MCP", "M", [(-_S, -_S), (_S, -_S), (_S, _S), (-_S, _S)]
    ),
    "sounder": DeviceSymbol(
        "FIRE_SOUNDER", "A", [(0.0, _S), (_S, 0.0), (0.0, -_S), (-_S, 0.0)]
    ),
}


def _ensure_block(doc: Drawing, device_type: str) -> str:
    symbol = DEVICE_SYMBOLS.get(device_type, DEVICE_SYMBOLS[DEFAULT_DEVICE_TYPE])
    if symbol.block_name in doc.blocks:
        return symbol.block_name

    block = doc.blocks.new(name=symbol.block_name)
    if symbol.outline is None:
        block.add_circle(
            center=(0.0, 0.0), radius=SYMBOL_HALF_SIZE, dxfattribs={"layer": LAYER_NAME}
        )
    else:
        block.add_lwpolyline(
            symbol.outline, close=True, dxfattribs={"layer": LAYER_NAME}
        )
    block.add_text(
        symbol.label,
        dxfattribs={"height": TEXT_HEIGHT, "layer": LAYER_NAME},
    ).set_placement((0.0, symbol.label_y), align=TextEntityAlignment.MIDDLE_CENTER)
    return symbol.block_name


def add_devices_to_dxf(
    input_path: Path,
    output_path: Path,
    devices: list[tuple[float, float, str]],
) -> None:
    """Add fire alarm devices to a DXF file on layer SYS_FIRE_SENSORS.

    Each device type gets its own block (see DEVICE_SYMBOLS); unknown types
    are drawn as smoke detectors.

    Args:
        input_path: Path to source DXF file.
        output_path: Path where modified DXF will be saved.
        devices: List of (x, y, device_type).
    """
    doc = ezdxf.readfile(str(Path(input_path)))

    # Audit document to heal missing handles or structures from non-standard DXFs
    doc.audit()

    # Add or update SYS_FIRE_SENSORS layer with color 1 (red)
    if LAYER_NAME not in doc.layers:
        doc.layers.add(name=LAYER_NAME, color=1)
    else:
        doc.layers.get(LAYER_NAME).color = 1

    # The smoke detector block is always defined, as before BIM-120.
    _ensure_block(doc, DEFAULT_DEVICE_TYPE)

    msp = doc.modelspace()
    for x, y, device_type in devices:
        msp.add_blockref(
            _ensure_block(doc, device_type),
            insert=(float(x), float(y)),
            dxfattribs={"layer": LAYER_NAME},
        )

    out_p = Path(output_path)
    out_p.parent.mkdir(parents=True, exist_ok=True)
    doc.saveas(str(out_p))


def add_sensors_to_dxf(
    input_path: Path,
    output_path: Path,
    sensor_coords: list[tuple[float, float]],
) -> None:
    """Add smoke detectors at the given (x, y) coordinates.

    Kept for existing callers; see add_devices_to_dxf for typed devices.
    """
    add_devices_to_dxf(
        input_path,
        output_path,
        [(x, y, DEFAULT_DEVICE_TYPE) for x, y in sensor_coords],
    )
