from pathlib import Path
from typing import NamedTuple

import ezdxf
from ezdxf.document import Drawing
from ezdxf.enums import TextEntityAlignment

LAYER_NAME = "SYS_FIRE_SENSORS"
# BIM-75: ручні сповіщувачі лежать на власному шарі, окремо від автоматичних.
MCP_LAYER_NAME = "SYS_FIRE_MCP"
# BIM-76: оповіщувачі (sounder) — теж на окремому шарі, відмінному від шарів
# сповіщувачів (критерій приймання: окремий шар, не SYS_FIRE_SENSORS).
SOUNDER_LAYER_NAME = "SYS_FIRE_SOUNDERS"
DEFAULT_DEVICE_TYPE = "smoke_detector"
DEVICE_LAYERS: dict[str, str] = {
    "manual_call_point": MCP_LAYER_NAME,
    "sounder": SOUNDER_LAYER_NAME,
}
LAYER_COLORS: dict[str, int] = {
    LAYER_NAME: 1,
    MCP_LAYER_NAME: 5,
    SOUNDER_LAYER_NAME: 3,
}
# Додаток XDATA: кожен прилад посилається на правило (rule_id з таблиці rules).
RULE_XDATA_APPID = "BIM_FIRE"
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


def device_layer(device_type: str) -> str:
    """Шар DXF для типу приладу (невідомі типи малюються як димові)."""
    if device_type not in DEVICE_SYMBOLS:
        device_type = DEFAULT_DEVICE_TYPE
    return DEVICE_LAYERS.get(device_type, LAYER_NAME)


def _ensure_block(doc: Drawing, device_type: str) -> str:
    symbol = DEVICE_SYMBOLS.get(device_type, DEVICE_SYMBOLS[DEFAULT_DEVICE_TYPE])
    if symbol.block_name in doc.blocks:
        return symbol.block_name

    layer = device_layer(device_type)
    block = doc.blocks.new(name=symbol.block_name)
    if symbol.outline is None:
        block.add_circle(
            center=(0.0, 0.0), radius=SYMBOL_HALF_SIZE, dxfattribs={"layer": layer}
        )
    else:
        block.add_lwpolyline(symbol.outline, close=True, dxfattribs={"layer": layer})
    block.add_text(
        symbol.label,
        dxfattribs={"height": TEXT_HEIGHT, "layer": layer},
    ).set_placement((0.0, symbol.label_y), align=TextEntityAlignment.MIDDLE_CENTER)
    return symbol.block_name


def _ensure_layer(doc: Drawing, name: str) -> None:
    color = LAYER_COLORS.get(name, 1)
    if name not in doc.layers:
        doc.layers.add(name=name, color=color)
    else:
        doc.layers.get(name).color = color


def add_devices_to_dxf(
    input_path: Path,
    output_path: Path,
    devices: list[tuple[float, float, str] | tuple[float, float, str, str | None]],
) -> None:
    """Add fire alarm devices to a DXF file.

    Automatic detectors go on layer SYS_FIRE_SENSORS, manual call points (BIM-75)
    on layer SYS_FIRE_MCP, and sounders (BIM-76) on layer SYS_FIRE_SOUNDERS, so
    sounders stay on a layer distinct from the detectors'. Each device type gets its
    own block (see DEVICE_SYMBOLS); unknown types are drawn as smoke detectors.
    A device with a rule code carries it in XDATA (application BIM_FIRE:
    "rule_id", <code>), so the placement can be traced back to the rule.

    Args:
        input_path: Path to source DXF file.
        output_path: Path where modified DXF will be saved.
        devices: List of (x, y, device_type) or (x, y, device_type, rule_code).
    """
    doc = ezdxf.readfile(str(Path(input_path)))

    # Audit document to heal missing handles or structures from non-standard DXFs
    doc.audit()

    # Add or update SYS_FIRE_SENSORS layer with color 1 (red)
    _ensure_layer(doc, LAYER_NAME)

    # The smoke detector block is always defined, as before BIM-120.
    _ensure_block(doc, DEFAULT_DEVICE_TYPE)

    msp = doc.modelspace()
    for device in devices:
        x, y, device_type = device[0], device[1], device[2]
        rule_code = device[3] if len(device) > 3 else None
        layer = device_layer(device_type)
        _ensure_layer(doc, layer)
        block_ref = msp.add_blockref(
            _ensure_block(doc, device_type),
            insert=(float(x), float(y)),
            dxfattribs={"layer": layer},
        )
        if rule_code:
            if RULE_XDATA_APPID not in doc.appids:
                doc.appids.add(RULE_XDATA_APPID)
            block_ref.set_xdata(
                RULE_XDATA_APPID, [(1000, "rule_id"), (1000, str(rule_code))]
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
