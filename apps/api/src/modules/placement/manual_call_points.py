"""BIM-75: розміщення ручних пожежних сповіщувачів.

Правило (таблиця ``rules``, device_type = manual_call_point) задає максимальну
відстань між ручними сповіщувачами. Сповіщувачі ставляться:
  1. біля кожного евакуаційного виходу — усередині приміщення, на відстані
     ``exit_offset_m`` від дверей;
  2. вздовж шляхів евакуації між виходами — так, щоб відстань між сусідніми
     сповіщувачами не перевищувала значення з правила.

Шлях евакуації — найкоротший прохід між двома виходами через приміщення типу
«коридор» (див. каталог типів: «Коридор, шлях евакуації») і приміщення, до яких
виходи належать. Рухатись можна лише всередині приміщення; з одного приміщення в
інше — лише через ПРОХІД (двері з креслення або прохід, підтверджений інженером).
Близькі чи навіть однакові контури проходу не доводять: між ними може бути суцільна
стіна.

Прохід з'єднує РІВНО ДВА приміщення: ті, що лежать по різні боки стіни, в якій він
стоїть (``room_a_id``, ``room_b_id``). Раніше прохід з'єднував усі приміщення біля
точки, і двері між A і B «підтверджували» шлях до сусіднього C. Якщо з креслення
не можна однозначно визначити дві сторони (двері на стику трьох приміщень), пару
не вгадують: прохід нічого не з'єднує, доки інженер не підтвердить його із
зазначенням приміщень. Те саме для застарілого проходу: приміщення при кожній
обробці отримують нові id, тож прохід зі старої обробки пари не має.

Якщо проходу між приміщеннями виходів немає, сповіщувачі лишаються біля виходів,
а ``route_coverage`` = ``unconfirmed`` з попередженням. Вихід, який не належить
жодному приміщенню, теж робить покриття ``unconfirmed``: шлях до нього не перевірено.

Модуль не залежить від shapely, fastapi і БД: працює зі списками координат, тому
повністю перевіряється юніт-тестами.
"""

import heapq
import math
from dataclasses import dataclass, field
from typing import Any

Point = tuple[float, float]

DEVICE_TYPE = "manual_call_point"
RULE_VALUE_KIND = "max_grid_spacing_m"

PLACED = "placed"
INSUFFICIENT_DATA = "insufficient_data"

REASON_NO_EXITS = "Позначте евакуаційні виходи"
REASON_NO_RULE = "Немає правила для ручних сповіщувачів"
REASON_NO_SCALE = "Невідомий масштаб креслення"
REASON_NO_ROOMS = "У кресленні немає приміщень"
REASON_EXITS_OUTSIDE = "Жоден вихід не знаходиться біля приміщення"
WARNING_UNVERIFIED = "Розміщено за неперевіреним правилом"
WARNING_ROUTE_UNCONFIRMED = (
    "Шлях евакуації між виходами не підтверджено: немає дверей або позначеного "
    "проходу між приміщеннями. Сповіщувачі стоять лише біля виходів; позначте "
    "прохід на плані"
)
WARNING_EXITS_WITHOUT_ROOM = (
    "Шлях евакуації підтверджено лише для частини виходів: вихід не належить "
    "жодному приміщенню, шлях до нього не перевірено"
)
WARNING_PASSAGES_IGNORED = (
    "Не враховано проходи, для яких не визначено два приміщення (двері на стику "
    "кількох приміщень або проходи зі старої обробки); підтвердіть їх на плані"
)

# Покриття шляхів евакуації між виходами (окремо від статусу розміщення).
ROUTE_CONFIRMED = "confirmed"  # усі виходи з'єднані проходами; точки на шляхах є
ROUTE_UNCONFIRMED = "unconfirmed"  # частина виходів не з'єднана з рештою
ROUTE_NOT_APPLICABLE = "not_applicable"  # вихід один: шляху між виходами немає

# Приміщення, якими проходять шляхи евакуації (тип з room_types.json).
EVACUATION_ROUTE_ROOM_TYPES = frozenset({"corridor"})

# Технічні параметри алгоритму, у метрах. Це не норми.
DEFAULT_EXIT_OFFSET_M = 1.0  # відступ від виходу, якщо його немає в правилі
EXIT_ROOM_TOLERANCE_M = 0.5  # двері лежать у стіні: до приміщення не далі за це
PASSAGE_ROOM_TOLERANCE_M = 0.8  # прохід (двері) у стіні: до приміщення не далі за це
PASSAGE_INWARD_M = 0.5  # на скільки вглиб приміщення відступити від проходу
PASSAGE_SIDE_PROBE_M = 0.05  # проба вбік від стіни, щоб відрізнити внутрішню сторону
PASSAGE_INSIDE_SLACK_M = 0.25  # двері намальовані трохи всередині приміщення
PASSAGE_OPPOSITE_DOT = -0.95  # нормалі двох сторін стіни майже протилежні
INWARD_NUDGE_M = 0.15  # на скільки зсунути точку всередину приміщення
DEDUPE_M = 0.3  # два сповіщувачі ближче за це — це один
MAX_WAYPOINTS = 120

_ROOM_PREFERENCE = {"corridor": 0, "hall": 1, "staircase": 3}
_DEFAULT_ROOM_PREFERENCE = 2


@dataclass(frozen=True)
class CallPointRoom:
    id: str
    name: str
    type: str
    coords: tuple[Point, ...]


@dataclass(frozen=True)
class CallPointExit:
    id: str
    x: float
    y: float
    name: str | None = None


@dataclass(frozen=True)
class CallPointPassage:
    """Прохід між двома приміщеннями: двері з DXF або підтверджений інженером."""

    id: str
    x: float
    y: float
    name: str | None = None
    # Два приміщення, які прохід з'єднує. Немає пари (None) — прохід неоднозначний
    # або застарілий і нічого не підтверджує.
    room_a_id: str | None = None
    room_b_id: str | None = None


@dataclass(frozen=True)
class CallPointRule:
    id: str
    rule_id: str
    name: str
    max_spacing_m: float
    document: str | None
    clause: str | None
    status: str
    source_url: str | None
    exit_offset_m: float | None


@dataclass(frozen=True)
class PlacedCallPoint:
    x: float
    y: float
    room_id: str | None
    exit_id: str | None  # заповнено, якщо сповіщувач стоїть біля виходу


@dataclass
class CallPointOutcome:
    status: str
    reason: str | None = None
    warning: str | None = None
    rule: CallPointRule | None = None
    alternative_rules: list[CallPointRule] = field(default_factory=list)
    devices: list[PlacedCallPoint] = field(default_factory=list)
    used_exit_ids: list[str] = field(default_factory=list)
    skipped_exit_ids: list[str] = field(default_factory=list)
    # Шляхи між виходами: окремий від status стан. Сповіщувачі біля виходів
    # розміщуються завжди, а проміжні — лише там, де прохід підтверджено.
    route_coverage: str = ROUTE_NOT_APPLICABLE
    route_warning: str | None = None
    unconnected_exit_ids: list[str] = field(default_factory=list)
    unconnected_room_names: list[str] = field(default_factory=list)
    used_passage_ids: list[str] = field(default_factory=list)
    # Проходи без пари приміщень або з парою, що більше не збігається з контурами.
    ignored_passage_ids: list[str] = field(default_factory=list)
    skipped_exit_names: list[str] = field(default_factory=list)


# ── Приміщення й виходи з рядків БД ─────────────────────────────────────────


def rooms_from_rows(rows: list[dict[str, Any]]) -> list[CallPointRoom]:
    """Приміщення з рядків ``rooms``; рядки без контуру (<3 точок) пропускаються."""
    rooms: list[CallPointRoom] = []
    for row in rows:
        polygon = row.get("polygon")
        if not isinstance(polygon, list):
            continue
        coords: list[Point] = []
        for item in polygon:
            if not isinstance(item, dict):
                continue
            x, y = _as_float(item.get("x")), _as_float(item.get("y"))
            if x is not None and y is not None:
                coords.append((x, y))
        if len(coords) >= 3:
            rooms.append(
                CallPointRoom(
                    id=str(row.get("id")),
                    name=str(row.get("name") or ""),
                    type=str(row.get("type") or "unknown"),
                    coords=tuple(coords),
                )
            )
    return rooms


def exits_from_rows(rows: list[dict[str, Any]]) -> list[CallPointExit]:
    """Виходи з рядків ``exits``; рядки без координат пропускаємо."""
    exits: list[CallPointExit] = []
    for row in rows:
        x, y = _as_float(row.get("x")), _as_float(row.get("y"))
        if x is None or y is None:
            continue
        exits.append(
            CallPointExit(id=str(row.get("id")), x=x, y=y, name=row.get("name"))
        )
    return exits


def passages_from_rows(rows: list[dict[str, Any]]) -> list[CallPointPassage]:
    """Проходи з рядків ``passages``; рядки без координат пропускаємо."""
    passages: list[CallPointPassage] = []
    for row in rows:
        x, y = _as_float(row.get("x")), _as_float(row.get("y"))
        if x is None or y is None:
            continue
        passages.append(
            CallPointPassage(
                id=str(row.get("id")),
                x=x,
                y=y,
                name=row.get("name"),
                room_a_id=_optional_id(row.get("room_a_id")),
                room_b_id=_optional_id(row.get("room_b_id")),
            )
        )
    return passages


def _optional_id(value: Any) -> str | None:
    return str(value) if value else None


def room_id_near_exit(
    point: Point, rooms: list[CallPointRoom], unit_scale_m: float | None
) -> str | None:
    """Приміщення біля виходу (двері лежать у стіні — допуск на товщину стіни)."""
    scale = unit_scale_m if unit_scale_m and unit_scale_m > 0 else 0.001
    indexed = [_Room(room) for room in rooms if len(_clean_ring(room.coords)) >= 3]
    room = _assign_exit_room(point, indexed, EXIT_ROOM_TOLERANCE_M / scale)
    return room.room.id if room else None


def passage_room_pair(
    point: Point, rooms: list[CallPointRoom], unit_scale_m: float | None
) -> tuple[str, str] | None:
    """Два приміщення по різні боки стіни, в якій стоїть прохід; інакше ``None``.

    Приміщення біля точки підходять, лише якщо їхні стіни повернуті до проходу
    «спинами» одна до одної: нормалі всередину майже протилежні, а сама точка
    лежить у стіні між ними (поза обома приміщеннями, з невеликим допуском на
    товщину намальованих дверей). Пара має бути єдиною: коли перед точкою кілька
    приміщень утворюють більше однієї пари (наприклад, тонка шахта між двома
    коридорами) або жодної, результат ``None``. Пару тоді не вгадують — прохід нічого
    не з'єднуватиме, доки інженер не підтвердить його із зазначенням приміщень.
    """
    scale = unit_scale_m if unit_scale_m and unit_scale_m > 0 else 0.001
    tolerance = PASSAGE_ROOM_TOLERANCE_M / scale
    probe = PASSAGE_SIDE_PROBE_M / scale
    slack = PASSAGE_INSIDE_SLACK_M / scale
    faces: dict[str, list[Point]] = {}
    for item in rooms:
        if len(_clean_ring(item.coords)) < 3:
            continue
        room = _Room(item)
        if room.boundary_distance(point) > tolerance:
            continue  # двері не в стіні цього приміщення (або воно просто навколо)
        normals = room.facing_normals(point, tolerance, probe, slack)
        if normals:  # приміщення без стіни перед точкою не є стороною цих дверей
            faces[item.id] = normals
    pairs = [
        (first, second)
        for index, first in enumerate(faces)
        for second in list(faces)[index + 1 :]
        if _opposite(faces[first], faces[second])
    ]
    return pairs[0] if len(pairs) == 1 else None


def passage_at_rooms(
    point: Point,
    room_ids: tuple[str, str],
    rooms: list[CallPointRoom],
    unit_scale_m: float | None,
) -> bool:
    """Обидва приміщення пари існують, різні й стіна обох — біля проходу."""
    first, second = room_ids
    if first == second:
        return False
    scale = unit_scale_m if unit_scale_m and unit_scale_m > 0 else 0.001
    tolerance = PASSAGE_ROOM_TOLERANCE_M / scale
    by_id = {
        item.id: _Room(item) for item in rooms if len(_clean_ring(item.coords)) >= 3
    }
    return all(
        room_id in by_id and by_id[room_id].boundary_distance(point) <= tolerance
        for room_id in room_ids
    )


def _opposite(first: list[Point], second: list[Point]) -> bool:
    return any(
        a[0] * b[0] + a[1] * b[1] <= PASSAGE_OPPOSITE_DOT for a in first for b in second
    )


# ── Правило ──────────────────────────────────────────────────────────────────


def _as_float(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _rule_from_row(row: dict[str, Any]) -> CallPointRule | None:
    value = _as_float(row.get("value"))
    if value is None:
        value = _as_float(row.get("threshold"))
    if value is None or value <= 0:
        return None
    conditions = row.get("conditions")
    offset = None
    if isinstance(conditions, dict):
        offset = _as_float(conditions.get("exit_offset_m"))
    return CallPointRule(
        id=str(row.get("id") or ""),
        rule_id=str(row.get("rule_id") or ""),
        name=str(row.get("name") or ""),
        max_spacing_m=value,
        document=row.get("document"),
        clause=row.get("clause"),
        status=str(row.get("verification_status") or "needs_review"),
        source_url=row.get("source_url"),
        exit_offset_m=offset if offset is not None and offset > 0 else None,
    )


def select_call_point_rule(
    rule_rows: list[dict[str, Any]],
) -> tuple[CallPointRule | None, list[CallPointRule]]:
    """Правило для розміщення і решта правил для ручних сповіщувачів.

    Якщо норми дають різні значення (ДСТУ 30 м і ДБН 50 м — конфлікт №3), беремо
    суворіше, тобто меншу відстань; решта повертається для показу конфлікту.
    """
    candidates: list[CallPointRule] = []
    for row in rule_rows:
        if row.get("device_type") != DEVICE_TYPE:
            continue
        if row.get("value_kind") not in (None, RULE_VALUE_KIND):
            continue
        rule = _rule_from_row(row)
        if rule is not None:
            candidates.append(rule)
    if not candidates:
        return None, []
    candidates.sort(key=lambda r: (r.max_spacing_m, r.status != "verified", r.rule_id))
    return candidates[0], candidates[1:]


# ── Геометрія (метри в одиницях креслення через scale) ───────────────────────


def _dist(a: Point, b: Point) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def _dist_point_segment(p: Point, a: Point, b: Point) -> float:
    dx, dy = b[0] - a[0], b[1] - a[1]
    length_sq = dx * dx + dy * dy
    if length_sq == 0:
        return _dist(p, a)
    t = max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length_sq))
    return _dist(p, (a[0] + t * dx, a[1] + t * dy))


def _closest_on_segment(p: Point, a: Point, b: Point) -> Point:
    dx, dy = b[0] - a[0], b[1] - a[1]
    length_sq = dx * dx + dy * dy
    if length_sq == 0:
        return a
    t = max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length_sq))
    return (a[0] + t * dx, a[1] + t * dy)


def _clean_ring(coords: tuple[Point, ...]) -> tuple[Point, ...]:
    ring = list(coords)
    if len(ring) > 1 and ring[0] == ring[-1]:
        ring.pop()
    return tuple(ring)


def _signed_area(ring: tuple[Point, ...]) -> float:
    total = 0.0
    for index, (x1, y1) in enumerate(ring):
        x2, y2 = ring[(index + 1) % len(ring)]
        total += x1 * y2 - x2 * y1
    return total / 2.0


def _segment_params(a: Point, b: Point, p: Point, q: Point) -> list[float]:
    """Параметри t ∈ (0, 1) уздовж a→b, де відрізок торкається або перетинає p–q."""
    rx, ry = b[0] - a[0], b[1] - a[1]
    sx, sy = q[0] - p[0], q[1] - p[1]
    qpx, qpy = p[0] - a[0], p[1] - a[1]
    length = math.hypot(rx, ry)
    if length == 0:
        return []
    denom = rx * sy - ry * sx
    if abs(denom) <= 1e-12 * length * math.hypot(sx, sy):
        # Паралельні: важливий лише збіг по одній прямій (рух уздовж стіни).
        if abs(qpx * ry - qpy * rx) / length > 1e-6:
            return []
        rr = length * length
        return [
            t
            for t in (
                (qpx * rx + qpy * ry) / rr,
                ((q[0] - a[0]) * rx + (q[1] - a[1]) * ry) / rr,
            )
            if 0.0 < t < 1.0
        ]
    t = (qpx * sy - qpy * sx) / denom
    u = (qpx * ry - qpy * rx) / denom
    if -1e-9 <= t <= 1.0 + 1e-9 and -1e-9 <= u <= 1.0 + 1e-9:
        return [min(max(t, 0.0), 1.0)]
    return []


class _Room:
    """Приміщення з кешованими межами для швидких перевірок."""

    def __init__(self, room: CallPointRoom) -> None:
        self.room = room
        self.ring = _clean_ring(room.coords)
        xs = [p[0] for p in self.ring]
        ys = [p[1] for p in self.ring]
        self.bbox = (min(xs), min(ys), max(xs), max(ys))
        self.area = abs(_signed_area(self.ring))
        self._interior: Point | None = None

    def boundary_distance(self, p: Point) -> float:
        ring = self.ring
        return min(
            _dist_point_segment(p, ring[i], ring[(i + 1) % len(ring)])
            for i in range(len(ring))
        )

    def contains(self, p: Point) -> bool:
        """Точка всередині або на межі (промінь вправо)."""
        x, y = p
        min_x, min_y, max_x, max_y = self.bbox
        if x < min_x or x > max_x or y < min_y or y > max_y:
            return False
        ring = self.ring
        inside = False
        for i in range(len(ring)):
            x1, y1 = ring[i]
            x2, y2 = ring[(i + 1) % len(ring)]
            if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
                inside = not inside
        return inside or self.boundary_distance(p) < 1e-9

    def covers_segment(self, a: Point, b: Point) -> bool:
        """Відрізок a–b цілком лежить у приміщенні (межа вважається «всередині»).

        Точна перевірка без дискретизації: відрізок ділиться точками перетину з
        контуром, і середина кожної частини має лежати всередині.
        """
        if not (self._inside(a) and self._inside(b)):
            return False
        params = {0.0, 1.0}
        ring = self.ring
        for i in range(len(ring)):
            params.update(_segment_params(a, b, ring[i], ring[(i + 1) % len(ring)]))
        ordered = sorted(params)
        for t0, t1 in zip(ordered, ordered[1:], strict=False):
            if t1 - t0 < 1e-9:
                continue
            tm = (t0 + t1) / 2.0
            if not self._inside((a[0] + tm * (b[0] - a[0]), a[1] + tm * (b[1] - a[1]))):
                return False
        return True

    def _inside(self, p: Point) -> bool:
        return self.contains(p) or self.boundary_distance(p) <= 1e-6

    def near(self, p: Point, tolerance: float) -> bool:
        min_x, min_y, max_x, max_y = self.bbox
        if (
            p[0] < min_x - tolerance
            or p[0] > max_x + tolerance
            or p[1] < min_y - tolerance
            or p[1] > max_y + tolerance
        ):
            return False
        return self.contains(p) or self.boundary_distance(p) <= tolerance

    def interior_point(self) -> Point:
        """Точка всередині контуру, найдальша від стін (сітка 24 × 24)."""
        if self._interior is not None:
            return self._interior
        min_x, min_y, max_x, max_y = self.bbox
        best: Point | None = None
        best_clearance = -1.0
        n = 24
        for i in range(n):
            for j in range(n):
                p = (
                    min_x + (i + 0.5) * (max_x - min_x) / n,
                    min_y + (j + 0.5) * (max_y - min_y) / n,
                )
                if not self.contains(p):
                    continue
                clearance = self.boundary_distance(p)
                if clearance > best_clearance + 1e-9:
                    best, best_clearance = p, clearance
        if best is None:
            best = self.ring[0]
        self._interior = best
        return best

    def facing_normals(
        self, point: Point, tolerance: float, probe: float, slack: float
    ) -> list[Point]:
        """Одиничні нормалі всередину приміщення стін, до яких «дивиться» точка.

        Стіна підходить, якщо вона не далі за ``tolerance`` від точки, точка
        проєктується на саму стіну (а не за її кінець) і лежить із зовнішнього боку
        стіни (не глибше за ``slack`` усередині). Внутрішній бік визначається пробою
        вбік: рівно одна з двох точок має бути в приміщенні.
        """
        ring = self.ring
        normals: list[Point] = []
        for index, start in enumerate(ring):
            end = ring[(index + 1) % len(ring)]
            length = _dist(start, end)
            if length == 0:
                continue
            closest = _closest_on_segment(point, start, end)
            if _dist(point, closest) > tolerance:
                continue
            along = (
                (point[0] - start[0]) * (end[0] - start[0])
                + (point[1] - start[1]) * (end[1] - start[1])
            ) / (length * length)
            if along < 0.0 or along > 1.0:
                continue  # точка за кінцем стіни: ця стіна не «перед» нею
            nx, ny = -(end[1] - start[1]) / length, (end[0] - start[0]) / length
            toward = self.contains((closest[0] + nx * probe, closest[1] + ny * probe))
            away = self.contains((closest[0] - nx * probe, closest[1] - ny * probe))
            if toward == away:
                continue  # вершина, тонкий виступ: бік не визначається
            if not toward:
                nx, ny = -nx, -ny
            if (point[0] - closest[0]) * nx + (point[1] - closest[1]) * ny > slack:
                continue  # точка всередині приміщення, а не в його стіні
            normals.append((nx, ny))
        return normals

    def inward_reflex_points(self, nudge: float) -> list[Point]:
        """Угнуті кути контуру, зсунуті всередину: опорні точки обходу кутів."""
        ring = self.ring
        if len(ring) < 4:
            return []
        orientation = 1.0 if _signed_area(ring) > 0 else -1.0
        points: list[Point] = []
        for i, vertex in enumerate(ring):
            prev_pt, next_pt = ring[i - 1], ring[(i + 1) % len(ring)]
            cross = (vertex[0] - prev_pt[0]) * (next_pt[1] - vertex[1]) - (
                vertex[1] - prev_pt[1]
            ) * (next_pt[0] - vertex[0])
            if cross * orientation >= 0:
                continue  # випуклий кут
            ux, uy = prev_pt[0] - vertex[0], prev_pt[1] - vertex[1]
            vx, vy = next_pt[0] - vertex[0], next_pt[1] - vertex[1]
            lu, lv = math.hypot(ux, uy) or 1.0, math.hypot(vx, vy) or 1.0
            bx, by = ux / lu + vx / lv, uy / lu + vy / lv
            length = math.hypot(bx, by)
            if length < 1e-9:
                continue
            for sign in (-1.0, 1.0):
                candidate = (
                    vertex[0] + sign * nudge * bx / length,
                    vertex[1] + sign * nudge * by / length,
                )
                if self.contains(candidate) and self.boundary_distance(candidate) > (
                    nudge * 0.5
                ):
                    points.append(candidate)
                    break
        return points


def _room_rank(item: _Room) -> int:
    return _ROOM_PREFERENCE.get(item.room.type, _DEFAULT_ROOM_PREFERENCE)


def _assign_exit_room(
    point: Point, rooms: list[_Room], tolerance: float
) -> _Room | None:
    """Приміщення, з боку якого ставимо сповіщувач біля виходу."""
    candidates = [room for room in rooms if room.near(point, tolerance)]
    if not candidates:
        return None
    candidates.sort(
        key=lambda r: (_room_rank(r), r.boundary_distance(point), -r.area, r.room.id)
    )
    return candidates[0]


def _point_near_exit(point: Point, room: _Room, offset: float) -> Point:
    """Точка всередині приміщення на відстані offset від виходу, подалі від стін."""
    for factor in (1.0, 0.5, 0.25):
        best: Point | None = None
        best_clearance = -1.0
        for k in range(16):
            angle = 2.0 * math.pi * k / 16
            candidate = (
                point[0] + offset * factor * math.cos(angle),
                point[1] + offset * factor * math.sin(angle),
            )
            if not room.contains(candidate):
                continue
            clearance = room.boundary_distance(candidate)
            if clearance > best_clearance + 1e-9:
                best, best_clearance = candidate, clearance
        if best is not None:
            return best
    return room.interior_point()


@dataclass
class _Node:
    point: Point
    room_id: str


class _Network:
    """Граф руху: вузли лежать у приміщеннях, ребра — лише всередині одного приміщення.

    Між приміщеннями є тільки ребра-проходи (``links``): без підтвердженого проходу
    жодна відстань між контурами не робить два приміщення з'єднаними.
    """

    def __init__(self, rooms: list[_Room]) -> None:
        self.rooms = rooms
        self.by_id = {room.room.id: room for room in rooms}
        self.nodes: list[_Node] = []
        self.links: list[tuple[int, int]] = []

    def add_node(self, point: Point, room_id: str) -> int:
        self.nodes.append(_Node(point, room_id))
        return len(self.nodes) - 1

    def add_link(self, a: int, b: int) -> None:
        self.links.append((a, b))

    def adjacency(self) -> list[list[tuple[int, float]]]:
        adjacency: list[list[tuple[int, float]]] = [[] for _ in self.nodes]
        for i, first in enumerate(self.nodes):
            room = self.by_id[first.room_id]
            for j in range(i + 1, len(self.nodes)):
                second = self.nodes[j]
                if second.room_id != first.room_id:
                    continue
                if room.covers_segment(first.point, second.point):
                    weight = _dist(first.point, second.point)
                    adjacency[i].append((j, weight))
                    adjacency[j].append((i, weight))
        for i, j in self.links:
            weight = _dist(self.nodes[i].point, self.nodes[j].point)
            adjacency[i].append((j, weight))
            adjacency[j].append((i, weight))
        return adjacency

    def snap_into_room(self, p: Point, nudge: float) -> Point:
        """Точка в розриві між приміщеннями переноситься всередину найближчого."""
        if any(room.contains(p) for room in self.rooms):
            return p
        best_room = min(self.rooms, key=lambda room: room.boundary_distance(p))
        centre = best_room.interior_point()
        away = _dist(p, centre) or 1.0
        for factor in (1.0, 2.0, 4.0, 8.0):
            candidate = (
                p[0] + (centre[0] - p[0]) / away * nudge * factor,
                p[1] + (centre[1] - p[1]) / away * nudge * factor,
            )
            if best_room.contains(candidate):
                return candidate
        return centre

    def room_at(self, p: Point) -> _Room | None:
        containing = [room for room in self.rooms if room.contains(p)]
        if not containing:
            return None
        containing.sort(key=lambda r: (_room_rank(r), r.area, r.room.id))
        return containing[0]


# ── Маршрути між виходами ────────────────────────────────────────────────────


def _shortest_paths(
    network: _Network, sources: list[int]
) -> dict[int, tuple[dict[int, float], dict[int, int]]]:
    """Дейкстра по графу руху. Повертає відстані й попередників для кожного джерела."""
    adjacency = network.adjacency()
    result: dict[int, tuple[dict[int, float], dict[int, int]]] = {}
    for source in sources:
        distance: dict[int, float] = {source: 0.0}
        previous: dict[int, int] = {}
        queue: list[tuple[float, int]] = [(0.0, source)]
        while queue:
            current, node = heapq.heappop(queue)
            if current > distance.get(node, math.inf):
                continue
            for neighbour, weight in adjacency[node]:
                candidate = current + weight
                if candidate < distance.get(neighbour, math.inf) - 1e-12:
                    distance[neighbour] = candidate
                    previous[neighbour] = node
                    heapq.heappush(queue, (candidate, neighbour))
        result[source] = (distance, previous)
    return result


def _path(previous: dict[int, int], source: int, target: int) -> list[int]:
    nodes = [target]
    while nodes[-1] != source:
        nodes.append(previous[nodes[-1]])
    nodes.reverse()
    return nodes


def _points_along(polyline: list[Point], max_gap: float) -> list[Point]:
    """Проміжні точки вздовж ламаної: рівномірно, відстань ≤ max_gap."""
    lengths = [_dist(polyline[i], polyline[i + 1]) for i in range(len(polyline) - 1)]
    total = sum(lengths)
    segments = math.ceil(total / max_gap - 1e-9)
    if segments <= 1:
        return []
    step = total / segments
    points: list[Point] = []
    for k in range(1, segments):
        target = k * step
        walked = 0.0
        for i, length in enumerate(lengths):
            if walked + length >= target - 1e-9 and length > 0:
                t = (target - walked) / length
                a, b = polyline[i], polyline[i + 1]
                points.append((a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])))
                break
            walked += length
    return points


def _minimum_spanning_pairs(
    exit_nodes: list[int], distances: dict[int, dict[int, float]]
) -> list[tuple[int, int]]:
    """Найкоротші зв'язки між виходами (кістяк мережі шляхів, Краскал)."""
    edges = sorted(
        (distances[a][b], a, b)
        for index, a in enumerate(exit_nodes)
        for b in exit_nodes[index + 1 :]
        if b in distances[a]
    )
    parent = {node: node for node in exit_nodes}

    def find(node: int) -> int:
        while parent[node] != node:
            parent[node] = parent[parent[node]]
            node = parent[node]
        return node

    chosen: list[tuple[int, int]] = []
    for _, a, b in edges:
        root_a, root_b = find(a), find(b)
        if root_a != root_b:
            parent[root_a] = root_b
            chosen.append((a, b))
    return chosen


# ── Основна функція ──────────────────────────────────────────────────────────


def _groups(count: int, connected: dict[int, dict[int, float]]) -> list[list[int]]:
    """Групи виходів, між якими існує шлях (індекси 0..count-1)."""
    parent = list(range(count))

    def find(node: int) -> int:
        while parent[node] != node:
            parent[node] = parent[parent[node]]
            node = parent[node]
        return node

    for a in range(count):
        for b in connected.get(a, {}):
            if b < count:
                parent[find(a)] = find(b)
    grouped: dict[int, list[int]] = {}
    for node in range(count):
        grouped.setdefault(find(node), []).append(node)
    return list(grouped.values())


def place_manual_call_points(
    *,
    rooms: list[CallPointRoom],
    exits: list[CallPointExit],
    rule_rows: list[dict[str, Any]],
    unit_scale_m: float | None,
    passages: list[CallPointPassage] | None = None,
) -> CallPointOutcome:
    """Розмістити ручні сповіщувачі біля виходів і вздовж шляхів евакуації.

    Нічого не розміщується (status = insufficient_data), якщо немає виходів, правила,
    масштабу або приміщень; причина — у ``reason``.

    Сповіщувачі біля виходів ставляться завжди. Проміжні точки на шляхах між
    виходами — лише там, де шлях доведено: у межах одного приміщення або через
    ``passages`` (двері / прохід, підтверджений інженером). Решту повідомляє
    ``route_coverage`` = ``unconfirmed`` і ``route_warning``.
    """
    if not exits:
        return CallPointOutcome(INSUFFICIENT_DATA, reason=REASON_NO_EXITS)

    rule, alternatives = select_call_point_rule(rule_rows)
    if rule is None:
        return CallPointOutcome(INSUFFICIENT_DATA, reason=REASON_NO_RULE)
    outcome = CallPointOutcome(
        INSUFFICIENT_DATA, rule=rule, alternative_rules=alternatives
    )

    if unit_scale_m is None or unit_scale_m <= 0:
        outcome.reason = REASON_NO_SCALE
        return outcome

    indexed = [_Room(room) for room in rooms if len(_clean_ring(room.coords)) >= 3]
    if not indexed:
        outcome.reason = REASON_NO_ROOMS
        return outcome

    def units(metres: float) -> float:
        return metres / unit_scale_m

    offset = units(rule.exit_offset_m or DEFAULT_EXIT_OFFSET_M)
    tolerance = units(EXIT_ROOM_TOLERANCE_M)

    # 1. Сповіщувач біля кожного виходу.
    exit_devices: list[tuple[CallPointExit, _Room, Point]] = []
    for exit_point in exits:
        room = _assign_exit_room((exit_point.x, exit_point.y), indexed, tolerance)
        if room is None:
            outcome.skipped_exit_ids.append(exit_point.id)
            outcome.skipped_exit_names.append(exit_point.name or exit_point.id)
            continue
        position = _point_near_exit((exit_point.x, exit_point.y), room, offset)
        exit_devices.append((exit_point, room, position))

    if not exit_devices:
        outcome.reason = REASON_EXITS_OUTSIDE
        return outcome

    devices: list[PlacedCallPoint] = []
    kept_points: list[Point] = []
    dedupe = units(DEDUPE_M)

    def add_device(position: Point, room_id: str | None, exit_id: str | None) -> bool:
        if any(_dist(position, other) < dedupe for other in kept_points):
            return False
        kept_points.append(position)
        devices.append(PlacedCallPoint(position[0], position[1], room_id, exit_id))
        return True

    for exit_point, room, position in exit_devices:
        add_device(position, room.room.id, exit_point.id)
        outcome.used_exit_ids.append(exit_point.id)
    outcome.devices = devices  # той самий список: далі в нього додаються точки шляхів
    outcome.status = PLACED
    if rule.status != "verified":
        outcome.warning = WARNING_UNVERIFIED

    # 2. Шляхи евакуації між виходами: лише всередині приміщень і через проходи.
    exit_rooms = {room.room.id: room for _, room, _ in exit_devices}
    route_rooms = [
        room for room in indexed if room.room.type in EVACUATION_ROUTE_ROOM_TYPES
    ]
    walk_rooms = list(exit_rooms.values()) + [
        room for room in route_rooms if room.room.id not in exit_rooms
    ]
    network = _Network(walk_rooms)
    nudge = units(INWARD_NUDGE_M)

    for _, room, position in exit_devices:
        network.add_node(position, room.room.id)
    exit_node_ids = list(range(len(exit_devices)))

    waypoint_count = 0
    for room in walk_rooms:
        for waypoint in (room.interior_point(), *room.inward_reflex_points(nudge)):
            if waypoint_count >= MAX_WAYPOINTS:
                break
            network.add_node(waypoint, room.room.id)
            waypoint_count += 1

    # Прохід з'єднує РІВНО свою пару приміщень (двері лежать у стіні між ними), а не
    # всі приміщення біля точки. Без пари або з парою, що вже не збігається з
    # контурами, прохід нічого не підтверджує.
    passage_tolerance = units(PASSAGE_ROOM_TOLERANCE_M)
    passage_inward = units(PASSAGE_INWARD_M)
    by_id = {room.room.id: room for room in indexed}
    for passage in passages or []:
        point = (passage.x, passage.y)
        first = by_id.get(passage.room_a_id) if passage.room_a_id else None
        second = by_id.get(passage.room_b_id) if passage.room_b_id else None
        if (
            first is None
            or second is None
            or first is second
            or first.boundary_distance(point) > passage_tolerance
            or second.boundary_distance(point) > passage_tolerance
        ):
            outcome.ignored_passage_ids.append(passage.id)
            continue
        if first.room.id not in network.by_id or second.room.id not in network.by_id:
            continue  # прохід між приміщеннями, якими шлях евакуації не йде
        sides = [
            network.add_node(
                _point_near_exit(point, room, passage_inward), room.room.id
            )
            for room in (first, second)
        ]
        network.add_link(sides[0], sides[1])
        outcome.used_passage_ids.append(passage.id)

    if len(exit_node_ids) < 2:
        # Один вихід у приміщенні: шляху між виходами немає. Але якщо є ще виходи
        # поза приміщеннями, шлях до них не перевірено.
        _finish_route_coverage(outcome, [], exit_devices)
        return outcome

    paths = _shortest_paths(network, exit_node_ids)
    distances = {source: paths[source][0] for source in exit_node_ids}
    max_gap = units(rule.max_spacing_m)
    for a, b in _minimum_spanning_pairs(exit_node_ids, distances):
        polyline = [network.nodes[i].point for i in _path(paths[a][1], a, b)]
        route_points = [
            network.snap_into_room(p, nudge) for p in _points_along(polyline, max_gap)
        ]
        chain = [network.nodes[a].point, *route_points, network.nodes[b].point]
        chain = _fill_long_gaps(chain, max_gap, network, nudge)
        for point in chain[1:-1]:
            room = network.room_at(point)
            add_device(point, room.room.id if room else None, None)

    # Покриття шляхів: виходи, між якими немає доведеного шляху, повідомляємо окремо.
    groups = _groups(len(exit_node_ids), distances)
    groups.sort(key=lambda members: (-len(members), min(members)))
    detached = [node for group in groups[1:] for node in sorted(group)]
    _finish_route_coverage(outcome, detached, exit_devices)
    return outcome


def _finish_route_coverage(
    outcome: CallPointOutcome,
    detached: list[int],
    exit_devices: list[tuple[CallPointExit, _Room, Point]],
) -> None:
    """Загальний стан шляхів: ``confirmed`` лише якщо доведено шлях до УСІХ виходів.

    Виходи, не з'єднані проходами з рештою (``detached``), і виходи поза
    приміщеннями (``skipped_exit_ids``) однаково не підтверджені: підмножина
    з'єднаних виходів не робить підтвердженим шлях до всіх.
    """
    skipped = outcome.skipped_exit_ids
    if not detached and not skipped:
        outcome.route_coverage = (
            ROUTE_CONFIRMED if len(exit_devices) >= 2 else ROUTE_NOT_APPLICABLE
        )
        return

    outcome.route_coverage = ROUTE_UNCONFIRMED
    outcome.unconnected_exit_ids = [exit_devices[node][0].id for node in detached]
    outcome.unconnected_exit_ids.extend(skipped)
    names: list[str] = []
    for node in detached:
        name = exit_devices[node][1].room.name or exit_devices[node][1].room.id
        if name not in names:
            names.append(name)
    outcome.unconnected_room_names = names

    parts: list[str] = []
    if detached:
        parts.append(f"{WARNING_ROUTE_UNCONFIRMED}. Приміщення: {'; '.join(names)}")
    if skipped:
        skipped_names = "; ".join(outcome.skipped_exit_names)
        parts.append(f"{WARNING_EXITS_WITHOUT_ROOM}. Виходи: {skipped_names}")
    if outcome.ignored_passage_ids:
        parts.append(f"{WARNING_PASSAGES_IGNORED} ({len(outcome.ignored_passage_ids)})")
    outcome.route_warning = ". ".join(parts)


def _fill_long_gaps(
    chain: list[Point], max_gap: float, network: _Network, nudge: float
) -> list[Point]:
    """Додає проміжні точки, якщо після зсуву сусіди розійшлись далі за max_gap."""
    for _ in range(6):
        filled: list[Point] = [chain[0]]
        changed = False
        for previous, current in zip(chain, chain[1:], strict=False):
            if _dist(previous, current) > max_gap + 1e-6:
                middle = network.snap_into_room(
                    ((previous[0] + current[0]) / 2, (previous[1] + current[1]) / 2),
                    nudge,
                )
                filled.append(middle)
                changed = True
            filled.append(current)
        chain = filled
        if not changed:
            break
    return chain


# ── Відповідь API ────────────────────────────────────────────────────────────


def _describe_rule(rule: CallPointRule) -> dict[str, Any]:
    return {
        "id": rule.id,
        "rule_id": rule.rule_id,
        "name": rule.name,
        "max_spacing_m": rule.max_spacing_m,
        "document": rule.document,
        "clause": rule.clause,
        "verification_status": rule.status,
        "source_url": rule.source_url,
    }


def describe_call_point_outcome(outcome: CallPointOutcome) -> dict[str, Any]:
    """Підсумок розміщення ручних сповіщувачів для відповіді /place."""
    return {
        "device_type": DEVICE_TYPE,
        "status": outcome.status,
        "reason": outcome.reason,
        "warning": outcome.warning,
        "device_count": len(outcome.devices),
        "exit_ids": list(outcome.used_exit_ids),
        "skipped_exit_ids": list(outcome.skipped_exit_ids),
        # Шляхи між виходами — окремий від status стан: сповіщувачі біля виходів
        # стоять, а чи доведено шлях між ними, показує route_coverage.
        "route_coverage": outcome.route_coverage,
        "route_warning": outcome.route_warning,
        "unconnected_exit_ids": list(outcome.unconnected_exit_ids),
        "unconnected_rooms": list(outcome.unconnected_room_names),
        "skipped_exit_names": list(outcome.skipped_exit_names),
        "passage_ids": list(outcome.used_passage_ids),
        # Проходи без пари приміщень (неоднозначні або застарілі) нічого не з'єднують.
        "ignored_passage_ids": list(outcome.ignored_passage_ids),
        "rule": _describe_rule(outcome.rule) if outcome.rule else None,
        "alternative_rules": [
            _describe_rule(rule) for rule in outcome.alternative_rules
        ],
    }
