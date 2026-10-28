from pathlib import Path

import ezdxf
import pytest

TESTS_DIR = Path(__file__).resolve().parent
FIXTURES_DIR = TESTS_DIR / "fixtures" / "test_drawing_dxf"
BAD_DXF = FIXTURES_DIR / "03_bad_unclosed_meters.dxf"
OUTPUT_DXF = TESTS_DIR / "output" / "result.dxf"

ROOMS_LAYER = "FIRE_ROOMS"
SENSORS_LAYER = "SYS_FIRE_SENSORS"
EXPECTED_ROOMS = 3
EXPECTED_AREA_M2 = 81.0
AREA_TOLERANCE = 0.01
MM2_IN_M2 = 1_000_000


def _polygon_area(points):
    total = 0.0
    for (x1, y1), (x2, y2) in zip(points, points[1:] + points[:1], strict=False):
        total += x1 * y2 - x2 * y1
    return abs(total) / 2


def _room_polylines(doc):
    return [
        entity
        for entity in doc.modelspace().query("LWPOLYLINE")
        if entity.dxf.layer == ROOMS_LAYER
    ]


def _total_area_m2(doc, rooms):
    area = sum(_polygon_area(list(room.get_points("xy"))) for room in rooms)
    if doc.units == ezdxf.units.MM:
        return area / MM2_IN_M2
    if doc.units == ezdxf.units.M:
        return area
    raise ValueError("Невідомі одиниці виміру креслення")


def _validate_drawing(doc):
    if ROOMS_LAYER not in doc.layers:
        raise ValueError(f"Немає шару {ROOMS_LAYER}")
    if doc.units != ezdxf.units.MM:
        raise ValueError("Одиниці виміру мають бути в міліметрах")
    unclosed = [room for room in _room_polylines(doc) if not room.closed]
    if unclosed:
        raise ValueError(f"Знайдено незамкнених контурів: {len(unclosed)}")


def _good_fixtures():
    if not FIXTURES_DIR.exists():
        return []
    return sorted(
        path
        for path in FIXTURES_DIR.glob("*.dxf")
        if "bad" not in path.name.lower()
    )


def test_room_metrics_accuracy():
    fixtures = _good_fixtures()
    if not fixtures:
        pytest.skip("Немає тестових DXF-файлів у каталозі fixtures")

    doc = ezdxf.readfile(fixtures[0])
    _validate_drawing(doc)
    rooms = _room_polylines(doc)
    area = _total_area_m2(doc, rooms)

    assert len(rooms) == EXPECTED_ROOMS, (
        f"Невірна кількість приміщень: очікувалось {EXPECTED_ROOMS}, "
        f"отримано {len(rooms)}"
    )
    assert area == pytest.approx(EXPECTED_AREA_M2, rel=AREA_TOLERANCE), (
        f"Площа поза допуском ±1%: очікувалось {EXPECTED_AREA_M2} м², "
        f"отримано {area:.2f} м²"
    )


def test_negative_dxf_errors():
    if not BAD_DXF.exists():
        pytest.skip(f"Файл {BAD_DXF.name} не знайдено")

    with pytest.raises((ValueError, ezdxf.DXFError)) as exc_info:
        doc = ezdxf.readfile(BAD_DXF)
        _validate_drawing(doc)

    message = str(exc_info.value)
    assert message, "Помилка має містити зрозуміле повідомлення"


def test_output_dxf_layer():
    if not OUTPUT_DXF.exists():
        pytest.skip("Вихідний DXF-файл ще не створено")

    doc = ezdxf.readfile(OUTPUT_DXF)

    assert SENSORS_LAYER in doc.layers, (
        f"У вихідному DXF відсутній обов'язковий шар {SENSORS_LAYER}"
    )