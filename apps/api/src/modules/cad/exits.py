"""BIM-75: евакуаційні виходи з DXF.

Вихід — це двері, які на кресленні позначено одним зі способів (Jira BIM-75):
  * геометрія дверей лежить на шарі EXITS;
  * поруч із дверима є підпис «Вихід» (TEXT/MTEXT; також Выход, Exit).

Крім виходів тут шукаються двері між приміщеннями (``find_door_points``): вони
підтверджують прохід між сусідніми приміщеннями для маршрутів евакуації.

Модуль не залежить від shapely і ezdxf: він працює з будь-яким об'єктом, що поводиться
як ``msp`` (ітерується по сутностях з ``dxftype()`` і ``dxf.layer``), тому його легко
перевіряти в тестах без реальних DXF-файлів.
"""

import math
import re
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

EXIT_LAYER_KEYWORDS = ("EXIT", "ВИХІД", "ВИХОД")
DOOR_LAYER_KEYWORDS = ("DOOR", "ДВЕР", "ДВІР")

_LETTERS = "A-Za-zА-Яа-яІіЇїЄєЁё"
EXIT_TEXT_RE = re.compile(
    rf"(?<![{_LETTERS}])(?:вихід|выход|exit)(?![{_LETTERS}])", re.IGNORECASE
)

# Підпис «Вихід» належить дверям, якщо вони не далі за цю відстань (метри).
LABEL_RADIUS_M = 2.0
# Дві знайдені точки ближче за цю відстань (метри) — це той самий вихід
# (стулка й дуга відкривання однієї дверей дають кілька сутностей).
DEDUPE_RADIUS_M = 1.0
DEFAULT_UNIT_SCALE_M = 0.001

_GEOMETRY_TYPES = frozenset(
    {"LINE", "LWPOLYLINE", "POLYLINE", "ARC", "CIRCLE", "INSERT"}
)
_TEXT_TYPES = frozenset({"TEXT", "MTEXT"})

Point = tuple[float, float]


@dataclass(frozen=True)
class DetectedExit:
    x: float
    y: float
    name: str | None
    origin: str  # "layer" — двері на шарі EXITS; "label" — двері з підписом «Вихід»


@dataclass(frozen=True)
class DetectedDoor:
    """Двері між приміщеннями (не евакуаційний вихід) у координатах креслення."""

    x: float
    y: float


def is_exit_layer(name: str) -> bool:
    upper = name.upper()
    return any(keyword in upper for keyword in EXIT_LAYER_KEYWORDS)


def is_door_layer(name: str) -> bool:
    upper = name.upper()
    return any(keyword in upper for keyword in DOOR_LAYER_KEYWORDS)


def is_exit_text(text: str) -> bool:
    return bool(EXIT_TEXT_RE.search(text))


def _xy(value: Any) -> Point | None:
    try:
        return float(value[0]), float(value[1])
    except (TypeError, ValueError, IndexError, KeyError):
        pass
    try:
        return float(value.x), float(value.y)
    except (AttributeError, TypeError, ValueError):
        return None


def _entity_points(entity: Any) -> list[Point]:
    """Характерні точки геометрії сутності (для центра дверей)."""
    kind = entity.dxftype()
    points: list[Point | None] = []
    if kind == "LINE":
        points = [_xy(entity.dxf.start), _xy(entity.dxf.end)]
    elif kind == "LWPOLYLINE":
        points = [_xy(point) for point in entity.get_points(format="xy")]
    elif kind == "POLYLINE":
        points = [_xy(vertex.dxf.location) for vertex in entity.vertices]
    elif kind == "ARC":
        points = [
            _xy(entity.dxf.center),
            _xy(entity.start_point),
            _xy(entity.end_point),
        ]
    elif kind in {"CIRCLE"}:
        points = [_xy(entity.dxf.center)]
    elif kind == "INSERT":
        points = [_xy(entity.dxf.insert)]
    return [point for point in points if point is not None]


def _entity_center(entity: Any) -> Point | None:
    points = _entity_points(entity)
    if not points:
        return None
    xs = [point[0] for point in points]
    ys = [point[1] for point in points]
    return (min(xs) + max(xs)) / 2.0, (min(ys) + max(ys)) / 2.0


def _text_value(entity: Any) -> str:
    if entity.dxftype() == "MTEXT":
        plain = getattr(entity, "plain_text", None)
        raw = plain() if callable(plain) else getattr(entity.dxf, "text", "")
    else:
        raw = getattr(entity.dxf, "text", "")
    text = str(raw or "").replace(r"\P", "\n").replace(r"\p", "\n")
    return next((line.strip() for line in text.splitlines() if line.strip()), "")


def _text_position(entity: Any) -> Point | None:
    insert = _xy(getattr(entity.dxf, "insert", None))
    align = _xy(getattr(entity.dxf, "align_point", None))
    if align is not None and (align[0] != 0.0 or align[1] != 0.0):
        if insert is None or insert == (0.0, 0.0):
            return align
    return insert


def _distance(a: Point, b: Point) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def find_exit_points(
    msp: Iterable[Any], unit_scale_m: float | None
) -> list[DetectedExit]:
    """Евакуаційні виходи, позначені в кресленні.

    Args:
        msp: простір моделі DXF (або будь-яка послідовність сутностей).
        unit_scale_m: метрів в одній одиниці креслення (для радіусів у метрах).

    Returns:
        Виходи в координатах креслення, без дублікатів, у порядку знаходження.
    """
    scale = unit_scale_m if unit_scale_m and unit_scale_m > 0 else DEFAULT_UNIT_SCALE_M
    label_radius = LABEL_RADIUS_M / scale
    dedupe_radius = DEDUPE_RADIUS_M / scale

    exit_layer_points: list[Point] = []
    doors: list[Point] = []
    labels: list[tuple[Point, str]] = []

    for entity in msp:
        kind = entity.dxftype()
        layer = str(getattr(entity.dxf, "layer", "") or "")
        if kind in _TEXT_TYPES:
            text = _text_value(entity)
            position = _text_position(entity)
            if text and position is not None and is_exit_text(text):
                labels.append((position, text))
            continue
        if kind not in _GEOMETRY_TYPES:
            continue
        center = _entity_center(entity)
        if center is None:
            continue
        if is_exit_layer(layer):
            exit_layer_points.append(center)
        elif is_door_layer(layer):
            doors.append(center)

    candidates: list[DetectedExit] = [
        DetectedExit(x=point[0], y=point[1], name=None, origin="layer")
        for point in exit_layer_points
    ]
    # Підпис «Вихід» робить евакуаційним найближчі двері в межах радіуса.
    for position, text in labels:
        nearest = min(doors, key=lambda door: _distance(door, position), default=None)
        if nearest is not None and _distance(nearest, position) <= label_radius:
            candidates.append(
                DetectedExit(x=nearest[0], y=nearest[1], name=text, origin="label")
            )

    merged: list[DetectedExit] = []
    for candidate in candidates:
        twin_index = next(
            (
                index
                for index, kept in enumerate(merged)
                if _distance((kept.x, kept.y), (candidate.x, candidate.y))
                <= dedupe_radius
            ),
            None,
        )
        if twin_index is None:
            merged.append(candidate)
        elif merged[twin_index].name is None and candidate.name is not None:
            kept = merged[twin_index]
            merged[twin_index] = DetectedExit(
                x=kept.x, y=kept.y, name=candidate.name, origin=kept.origin
            )

    # Підпис без назви біля дверей на шарі EXITS теж дає назву виходу.
    named: list[DetectedExit] = []
    for item in merged:
        if item.name is None:
            nearby = [
                text
                for position, text in labels
                if _distance(position, (item.x, item.y)) <= label_radius
            ]
            if nearby:
                item = DetectedExit(
                    x=item.x, y=item.y, name=nearby[0], origin=item.origin
                )
        named.append(item)
    return named


def find_door_points(
    msp: Iterable[Any],
    unit_scale_m: float | None,
    exits: Iterable[DetectedExit] = (),
) -> list[DetectedDoor]:
    """Двері на шарі дверей, які НЕ є евакуаційними виходами.

    Це підтвердження проходу між сусідніми приміщеннями: близькі контури самі по собі
    проходу не доводять. Двері на шарі EXITS і двері, що вже визначені як виходи
    (``exits``), пропускаються: вони ведуть назовні, а не між приміщеннями.

    Returns:
        Центри дверей в координатах креслення, без дублікатів, у порядку знаходження.
    """
    scale = unit_scale_m if unit_scale_m and unit_scale_m > 0 else DEFAULT_UNIT_SCALE_M
    # Стулка й дуга відкривання однієї дверей дають кілька сутностей: зливаємо їх.
    dedupe_radius = DEDUPE_RADIUS_M / scale
    exit_points = [(item.x, item.y) for item in exits]

    doors: list[DetectedDoor] = []
    for entity in msp:
        if entity.dxftype() not in _GEOMETRY_TYPES:
            continue
        layer = str(getattr(entity.dxf, "layer", "") or "")
        if is_exit_layer(layer) or not is_door_layer(layer):
            continue
        center = _entity_center(entity)
        if center is None:
            continue
        if any(_distance(center, point) <= dedupe_radius for point in exit_points):
            continue
        if any(_distance(center, (door.x, door.y)) <= dedupe_radius for door in doors):
            continue
        doors.append(DetectedDoor(x=center[0], y=center[1]))
    return doors
