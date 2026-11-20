"""BIM-75: розміщення ручних пожежних сповіщувачів.

Правило (таблиця ``rules``, device_type = manual_call_point) задає максимальну
відстань між ручними сповіщувачами. Сповіщувачі ставляться:
  1. біля кожного евакуаційного виходу — усередині приміщення, на відстані
     ``exit_offset_m`` від дверей;
  2. вздовж шляхів евакуації між виходами — так, щоб відстань між сусідніми
     сповіщувачами не перевищувала значення з правила.

Шлях евакуації — найкоротший прохід між двома виходами через приміщення типу
«коридор» (див. каталог типів: «Коридор, шлях евакуації») і приміщення, до яких
виходи належать. Двері між приміщеннями окремо не розпізнаються: сусідні
приміщення вважаються з'єднаними через розрив ``WALL_GAP_M`` (товщина стіни).

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

# Приміщення, якими проходять шляхи евакуації (тип з room_types.json).
EVACUATION_ROUTE_ROOM_TYPES = frozenset({"corridor"})

# Технічні параметри алгоритму, у метрах. Це не норми.
DEFAULT_EXIT_OFFSET_M = 1.0  # відступ від виходу, якщо його немає в правилі
EXIT_ROOM_TOLERANCE_M = 0.5  # двері лежать у стіні: до приміщення не далі за це
WALL_GAP_M = 0.5  # розрив між сусідніми приміщеннями (стіна), який можна пройти
SAMPLE_STEP_M = 0.3  # крок перевірки «шлях іде всередині приміщень»
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


def room_id_near_exit(
    point: Point, rooms: list[CallPointRoom], unit_scale_m: float | None
) -> str | None:
    """Приміщення біля виходу (двері лежать у стіні — допуск на товщину стіни)."""
    scale = unit_scale_m if unit_scale_m and unit_scale_m > 0 else 0.001
    indexed = [_Room(room) for room in rooms if len(_clean_ring(room.coords)) >= 3]
    room = _assign_exit_room(point, indexed, EXIT_ROOM_TOLERANCE_M / scale)
    return room.room.id if room else None


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


class _Walkable:
    """Простір, яким можна йти: приміщення шляху евакуації плюс приміщення виходів."""

    def __init__(self, rooms: list[_Room], gap: float, step: float) -> None:
        self.rooms = rooms
        self.gap = gap
        self.step = step

    def contains(self, p: Point) -> bool:
        return any(room.near(p, self.gap) for room in self.rooms)

    def visible(self, a: Point, b: Point) -> bool:
        distance = _dist(a, b)
        samples = max(1, math.ceil(distance / self.step))
        for i in range(samples + 1):
            t = i / samples
            if not self.contains((a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]))):
                return False
        return True

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
    nodes: list[Point], walkable: _Walkable, sources: list[int]
) -> dict[int, tuple[dict[int, float], dict[int, int]]]:
    """Дейкстра по графу видимості між вузлами. Повертає відстані й попередників."""
    count = len(nodes)
    adjacency: list[list[tuple[int, float]]] = [[] for _ in range(count)]
    for i in range(count):
        for j in range(i + 1, count):
            if walkable.visible(nodes[i], nodes[j]):
                weight = _dist(nodes[i], nodes[j])
                adjacency[i].append((j, weight))
                adjacency[j].append((i, weight))

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


def place_manual_call_points(
    *,
    rooms: list[CallPointRoom],
    exits: list[CallPointExit],
    rule_rows: list[dict[str, Any]],
    unit_scale_m: float | None,
) -> CallPointOutcome:
    """Розмістити ручні сповіщувачі біля виходів і вздовж шляхів евакуації.

    Нічого не розміщується (status = insufficient_data), якщо немає виходів, правила,
    масштабу або приміщень; причина — у ``reason``.
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

    # 2. Сповіщувачі на шляхах евакуації між виходами.
    exit_rooms = {room.room.id: room for _, room, _ in exit_devices}
    route_rooms = [
        room for room in indexed if room.room.type in EVACUATION_ROUTE_ROOM_TYPES
    ]
    walk_rooms = list(exit_rooms.values()) + [
        room for room in route_rooms if room.room.id not in exit_rooms
    ]
    walkable = _Walkable(walk_rooms, units(WALL_GAP_M), units(SAMPLE_STEP_M))

    nodes: list[Point] = [position for _, _, position in exit_devices]
    exit_node_ids = list(range(len(nodes)))
    nudge = units(INWARD_NUDGE_M)
    waypoints: list[Point] = []
    for room in walk_rooms:
        waypoints.append(room.interior_point())
        waypoints.extend(room.inward_reflex_points(nudge))
    nodes.extend(waypoints[:MAX_WAYPOINTS])

    if len(exit_node_ids) > 1:
        paths = _shortest_paths(nodes, walkable, exit_node_ids)
        distances = {source: paths[source][0] for source in exit_node_ids}
        max_gap = units(rule.max_spacing_m)
        for a, b in _minimum_spanning_pairs(exit_node_ids, distances):
            polyline = [nodes[i] for i in _path(paths[a][1], a, b)]
            route_points = [
                walkable.snap_into_room(p, nudge)
                for p in _points_along(polyline, max_gap)
            ]
            chain = [nodes[a], *route_points, nodes[b]]
            chain = _fill_long_gaps(chain, max_gap, walkable, nudge)
            for point in chain[1:-1]:
                room = walkable.room_at(point)
                add_device(point, room.room.id if room else None, None)

    outcome.devices = devices
    outcome.status = PLACED
    if rule.status != "verified":
        outcome.warning = WARNING_UNVERIFIED
    return outcome


def _fill_long_gaps(
    chain: list[Point], max_gap: float, walkable: _Walkable, nudge: float
) -> list[Point]:
    """Додає проміжні точки, якщо після зсуву сусіди розійшлись далі за max_gap."""
    for _ in range(6):
        filled: list[Point] = [chain[0]]
        changed = False
        for previous, current in zip(chain, chain[1:], strict=False):
            if _dist(previous, current) > max_gap + 1e-6:
                middle = walkable.snap_into_room(
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
        "rule": _describe_rule(outcome.rule) if outcome.rule else None,
        "alternative_rules": [
            _describe_rule(rule) for rule in outcome.alternative_rules
        ],
    }
