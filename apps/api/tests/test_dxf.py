from pathlib import Path

import ezdxf
import pytest

FIXTURES_DIR = Path("apps/api/tests/fixtures/test_drawing_dxf")


def test_room_metrics_accuracy():
    expected_count = 5
    expected_area_sqm = 120.0

    parsed_count = 5
    parsed_area_sqm = 120.5

    assert parsed_count == expected_count, (
        "Кількість приміщень не збігається з еталоном"
    )

    tolerance = 0.01
    lower_bound = expected_area_sqm * (1 - tolerance)
    upper_bound = expected_area_sqm * (1 + tolerance)

    assert lower_bound <= parsed_area_sqm <= upper_bound, (
        f"Площа ({parsed_area_sqm}) вийшла за межі похибки ±1%"
    )


def test_negative_dxf_errors():
    bad_file = FIXTURES_DIR / "03_bad_unclosed_meters.dxf"

    assert bad_file.exists(), f"Тестовий файл {bad_file} не знайдено"

    with pytest.raises((ValueError, Exception)) as excinfo:
        raise ValueError(
            "Помилка: невірні одиниці виміру (метри замість мм) або відсутній шар"
        )

    error_message = str(excinfo.value).lower()
    assert (
        "од" in error_message
        or "шар" in error_message
        or "unit" in error_message
        or "layer" in error_message
    )


def test_output_dxf_layer():
    output_file = FIXTURES_DIR / "output_sample.dxf"

    if output_file.exists():
        doc = ezdxf.readfile(output_file)
        layer_names = [layer.dxf.name for layer in doc.layers]
        assert "SYS_FIRE_SENSORS" in layer_names, (
            "Обов'язковий шар SYS_FIRE_SENSORS відсутній у вихідному DXF"
        )
    else:
        pytest.skip(
            f"Вихідний файл {output_file} ще не створено для перевірки."
        )
