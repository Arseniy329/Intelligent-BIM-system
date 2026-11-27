"""Unit & integration tests for BIM-77 fire-safety compliance findings."""

import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any
from unittest.mock import patch
from uuid import uuid4

import ezdxf
from fastapi.testclient import TestClient

API_DIR = Path(__file__).resolve().parent.parent
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

from src.contracts.generated import Finding, FindingSeverity
from src.core.auth import CurrentUser, get_current_user
from src.infrastructure.supabase import get_supabase_client
from src.main import app
from src.modules.cad.exits import find_door_points, find_exit_points
from src.modules.cad.parser import parse_dxf_rooms_with_scale
from src.modules.findings.service import _persist_findings, evaluate_drawing_findings
from tests.fakes import FakeTable, fake_supabase

FIXTURES_DXF1 = API_DIR / "tests" / "fixtures" / "test_drawing_dxf"
FIXTURES_DXF3 = API_DIR / "tests" / "fixtures" / "test_drawing_dxf3"

DISALLOWED_TOKENS = ("СНиП", "СНИП", "ГОСТ", "НПБ", "ВСН", "ВНПБ")


def _rect(x0: float, y0: float, x1: float, y1: float) -> list[dict[str, float]]:
    return [
        {"x": x0, "y": y0},
        {"x": x1, "y": y0},
        {"x": x1, "y": y1},
        {"x": x0, "y": y1},
    ]


def _rule_row(
    *,
    rule_id: str,
    device_type: str = "smoke_detector",
    value_kind: str = "max_grid_spacing_m",
    value: float = 9.0,
    max_area: float | None = 80.0,
    min_clearance: float | None = None,
    room_types: list[str] | None = None,
    min_height_m: float | None = None,
    max_height_m: float | None = 3.5,
    document: str | None = "ДСТУ EN 54-14:2021",
    clause: str | None = "6.5.2, таблиця A.1",
    verification_status: str = "verified",
    source_url: str | None = "https://budstandart.ua/norm/dstu-en-54-14",
) -> dict[str, Any]:
    conditions: dict[str, Any] = {}
    if max_area is not None:
        conditions["max_protected_area_m2"] = max_area
    if min_clearance is not None:
        conditions["min_wall_clearance_m"] = min_clearance
    return {
        "id": str(uuid4()),
        "rule_id": rule_id,
        "name": rule_id,
        "device_type": device_type,
        "value_kind": value_kind,
        "room_types": room_types or [],
        "min_height_m": min_height_m,
        "max_height_m": max_height_m,
        "value": value,
        "conditions": conditions,
        "document": document,
        "clause": clause,
        "source_url": source_url,
        "verification_status": verification_status,
    }


def _dxf_circles_as_device_rows(
    dxf_path: Path, drawing_id: str
) -> list[dict[str, Any]]:
    doc = ezdxf.readfile(str(dxf_path))
    layer_to_type = {
        "SMOKE_DETECTORS": "smoke_detector",
        "SYS_FIRE_SENSORS": "smoke_detector",
        "SOUNDERS": "sounder",
        "SYS_FIRE_SOUNDERS": "sounder",
        "MANUAL_CALL_POINTS": "manual_call_point",
        "SYS_FIRE_MCP": "manual_call_point",
    }
    devices: list[dict[str, Any]] = []
    for entity in doc.modelspace().query("CIRCLE"):
        layer = str(entity.dxf.layer).upper()
        dev_type = layer_to_type.get(layer)
        if dev_type is None:
            continue
        center = entity.dxf.center
        devices.append(
            {
                "id": str(uuid4()),
                "drawing_id": drawing_id,
                "room_id": None,
                "type": dev_type,
                "x": float(center.x),
                "y": float(center.y),
            }
        )
    return devices


class _SchemaErrorTable(FakeTable):
    """FakeTable raising PostgREST missing-table error PGRST205."""

    def __init__(
        self, rows: list[dict[str, Any]], table_name: str = "findings"
    ) -> None:
        super().__init__(rows)
        self._table_name = table_name

    def execute(self) -> Any:
        raise RuntimeError(
            f"PGRST205: Could not find the table 'public.{self._table_name}' "
            "in the schema cache"
        )


class _FailingInsertFindingsTable(FakeTable):
    """FakeTable that fails during insert to test non-destructive persistence."""

    def execute(self) -> Any:
        if self._operation == "insert":
            self._reset()
            raise RuntimeError("simulated insert failure")
        return super().execute()


class TestFindingsEngine(unittest.TestCase):
    def setUp(self) -> None:
        self.drawing_id = str(uuid4())
        self.smoke_rule = _rule_row(
            rule_id="SMOKE_GRID_HEIGHT_3_5",
            value=9.0,
            max_area=80.0,
        )
        self.wall_rule = _rule_row(
            rule_id="SMOKE_WALL_CLEARANCE",
            value_kind="max_wall_distance_m",
            value=4.5,
            max_area=None,
            min_clearance=0.5,
            clause="6.5.2",
        )
        self.sounder_rule = _rule_row(
            rule_id="SOUNDER_VERIFIED_TEST",
            device_type="sounder",
            value_kind="max_grid_spacing_m",
            value=15.0,
            max_area=None,
            max_height_m=None,
            clause="6.7.2",
            verification_status="verified",
        )

    def test_missing_height_and_unknown_type_emit_insufficient_data(self) -> None:
        room_no_height = {
            "id": "room-1",
            "name": "Кабінет 1",
            "type": "office",
            "height": None,
            "area": 24.0,
            "polygon": _rect(0, 0, 6000, 4000),
            "confirmed": True,
        }
        room_unknown_type = {
            "id": "room-2",
            "name": "Приміщення Х",
            "type": "unknown",
            "height": 3.0,
            "area": 24.0,
            "polygon": _rect(6000, 0, 12000, 4000),
            "confirmed": True,
        }
        findings = evaluate_drawing_findings(
            drawing_id=self.drawing_id,
            drawing_row={"id": self.drawing_id, "units": "mm", "unit_scale_m": 0.001},
            room_rows=[room_no_height, room_unknown_type],
            device_rows=[
                {
                    "id": "d-1",
                    "room_id": "room-2",
                    "type": "smoke_detector",
                    "x": 9000,
                    "y": 2000,
                }
            ],
            rule_rows=[self.smoke_rule, self.wall_rule],
        )
        insufficient = [
            f for f in findings if f.severity == FindingSeverity.insufficient_data
        ]
        self.assertTrue(
            any(
                f.roomId == "room-1" and "Не введено висоту приміщення" in f.message
                for f in insufficient
            )
        )
        self.assertTrue(
            any(
                f.roomId == "room-2" and "Не визначено тип приміщення" in f.message
                for f in insufficient
            )
        )

    def test_missing_rule_for_height_emits_insufficient_data(self) -> None:
        room = {
            "id": "room-tall",
            "name": "Атріум",
            "type": "hall",
            "height": 18.0,
            "area": 48.0,
            "polygon": _rect(0, 0, 8000, 6000),
            "confirmed": True,
        }
        findings = evaluate_drawing_findings(
            drawing_id=self.drawing_id,
            drawing_row={"id": self.drawing_id, "units": "mm", "unit_scale_m": 0.001},
            room_rows=[room],
            device_rows=[
                {
                    "id": "snd-tall",
                    "room_id": "room-tall",
                    "type": "sounder",
                    "x": 4000,
                    "y": 3000,
                }
            ],
            rule_rows=[self.smoke_rule, self.sounder_rule],
        )
        self.assertEqual(len(findings), 1)
        self.assertEqual(findings[0].severity, FindingSeverity.insufficient_data)
        self.assertEqual(findings[0].roomId, "room-tall")
        self.assertIn("18", findings[0].message)

    def test_missing_sounder_rule_in_catalog_emits_insufficient_data(self) -> None:
        room = {
            "id": "room-no-snd-rule",
            "name": "Офіс 102",
            "type": "office",
            "height": 3.0,
            "area": 48.0,
            "polygon": _rect(0, 0, 8000, 6000),
            "confirmed": True,
        }
        smoke_dev = {
            "id": "sd-1",
            "room_id": "room-no-snd-rule",
            "type": "smoke_detector",
            "x": 4000,
            "y": 3000,
        }
        sounder_dev = {
            "id": "snd-1",
            "room_id": "room-no-snd-rule",
            "type": "sounder",
            "x": 4000,
            "y": 3000,
        }
        # Catalog has NO sounder rules at all — both with and without sounder placed
        for has_sounder, devs in (
            (True, [smoke_dev, sounder_dev]),
            (False, [smoke_dev]),
        ):
            with self.subTest(has_sounder=has_sounder):
                findings = evaluate_drawing_findings(
                    drawing_id=self.drawing_id,
                    drawing_row={
                        "id": self.drawing_id,
                        "units": "mm",
                        "unit_scale_m": 0.001,
                    },
                    room_rows=[room],
                    device_rows=devs,
                    rule_rows=[self.smoke_rule, self.wall_rule],
                )
                self.assertNotEqual(findings, [])
                self.assertFalse(
                    any(f.severity == FindingSeverity.critical for f in findings)
                )
                self.assertTrue(
                    any(
                        f.severity == FindingSeverity.insufficient_data
                        and f.roomId == "room-no-snd-rule"
                        and "sounder" in f.message
                        and "відсутні правила для оповіщувачів" in f.message
                        for f in findings
                    )
                )

    def test_unmatched_sounder_rule_for_type_or_height_emits_insufficient_data(
        self,
    ) -> None:
        room = {
            "id": "room-mismatch",
            "name": "Офіс 201",
            "type": "office",
            "height": 4.5,
            "area": 48.0,
            "polygon": _rect(0, 0, 8000, 6000),
            "confirmed": True,
        }
        smoke_tall = _rule_row(
            rule_id="SMOKE_GRID_HEIGHT_3_5_6",
            value=8.5,
            max_area=70.0,
            min_height_m=3.5,
            max_height_m=6.0,
        )
        wall_tall = _rule_row(
            rule_id="SMOKE_WALL_HEIGHT_3_5_6",
            value_kind="max_wall_distance_m",
            value=4.0,
            max_area=None,
            min_clearance=0.5,
            min_height_m=3.5,
            max_height_m=6.0,
            clause="6.5.2",
        )
        restricted_sounder_rule = _rule_row(
            rule_id="SOUNDER_SLEEPING_ONLY",
            device_type="sounder",
            value_kind="max_grid_spacing_m",
            value=10.0,
            max_area=None,
            room_types=["sleeping_room"],
            max_height_m=3.0,
            clause="6.7.2",
        )
        smoke_dev = {
            "id": "sd-1",
            "room_id": "room-mismatch",
            "type": "smoke_detector",
            "x": 4000,
            "y": 3000,
        }
        sounder_dev = {
            "id": "snd-1",
            "room_id": "room-mismatch",
            "type": "sounder",
            "x": 4000,
            "y": 3000,
        }
        for has_sounder, devs in (
            (True, [smoke_dev, sounder_dev]),
            (False, [smoke_dev]),
        ):
            with self.subTest(has_sounder=has_sounder):
                findings = evaluate_drawing_findings(
                    drawing_id=self.drawing_id,
                    drawing_row={
                        "id": self.drawing_id,
                        "units": "mm",
                        "unit_scale_m": 0.001,
                    },
                    room_rows=[room],
                    device_rows=devs,
                    rule_rows=[smoke_tall, wall_tall, restricted_sounder_rule],
                )
                self.assertNotEqual(findings, [])
                self.assertFalse(
                    any(f.severity == FindingSeverity.critical for f in findings)
                )
                self.assertTrue(
                    any(
                        f.severity == FindingSeverity.insufficient_data
                        and f.roomId == "room-mismatch"
                        and "office" in f.message
                        and "4.5" in f.message
                        and "оповіщувачів" in f.message
                        for f in findings
                    )
                )

    def test_critical_coverage_area_spacing_and_disallowed_norm_filtered(
        self,
    ) -> None:
        # 16m x 6m = 96 m2 room with 1 detector (area 96 > 80 m2)
        room = {
            "id": "room-big",
            "name": "Конференц-зала",
            "type": "hall",
            "height": 3.0,
            "area": 96.0,
            "polygon": _rect(0, 0, 16000, 6000),
            "confirmed": True,
        }
        disallowed_snip_rule = _rule_row(
            rule_id="LEGACY_SNIP",
            value=12.0,
            max_area=100.0,
            document="СНиП 2.04.09-84",
            clause="табл. 5",
        )
        findings = evaluate_drawing_findings(
            drawing_id=self.drawing_id,
            drawing_row={"id": self.drawing_id, "units": "mm", "unit_scale_m": 0.001},
            room_rows=[room],
            device_rows=[
                {
                    "id": "det-1",
                    "room_id": "room-big",
                    "type": "smoke_detector",
                    "x": 2000,
                    "y": 3000,
                }
            ],
            rule_rows=[self.smoke_rule, self.wall_rule, disallowed_snip_rule],
        )
        critical = [f for f in findings if f.severity == FindingSeverity.critical]
        self.assertGreaterEqual(len(critical), 2)
        for item in critical:
            self.assertEqual(item.roomId, "room-big")
            self.assertIsNotNone(item.ruleId)
            self.assertEqual(item.document, "ДСТУ EN 54-14:2021")
            self.assertIsNotNone(item.clause)
            for token in DISALLOWED_TOKENS:
                self.assertNotIn(token, item.document or "")
                self.assertNotIn(token, item.message)

    def test_missing_sounder_emits_finding_for_room(self) -> None:
        room = {
            "id": "room-no-snd",
            "name": "Серверна",
            "type": "technical",
            "height": 3.0,
            "area": 36.0,
            "polygon": _rect(0, 0, 6000, 6000),
            "confirmed": True,
        }
        findings = evaluate_drawing_findings(
            drawing_id=self.drawing_id,
            drawing_row={"id": self.drawing_id, "units": "mm", "unit_scale_m": 0.001},
            room_rows=[room],
            device_rows=[
                {
                    "id": "sd-1",
                    "room_id": "room-no-snd",
                    "type": "smoke_detector",
                    "x": 3000,
                    "y": 3000,
                }
            ],
            rule_rows=[self.smoke_rule, self.wall_rule, self.sounder_rule],
        )
        self.assertEqual(len(findings), 1)
        self.assertEqual(findings[0].severity, FindingSeverity.critical)
        self.assertEqual(findings[0].roomId, "room-no-snd")
        self.assertEqual(findings[0].ruleId, self.sounder_rule["id"])
        self.assertEqual(findings[0].document, "ДСТУ EN 54-14:2021")
        self.assertEqual(findings[0].clause, "6.7.2")

    def test_unverified_rule_emits_warning_without_fabricating_clause(self) -> None:
        unverified_rule = _rule_row(
            rule_id="UNVERIFIED_HEAT",
            device_type="heat_detector",
            value=4.0,
            max_area=15.0,
            min_height_m=6.0,
            max_height_m=9.0,
            document="ДБН В.2.5-56:2014",
            clause=None,
            verification_status="needs_review",
        )
        room = {
            "id": "room-heat",
            "name": "Цех",
            "type": "hall",
            "height": 7.0,
            "area": 12.0,
            "polygon": _rect(0, 0, 4000, 3000),
            "confirmed": True,
        }
        findings = evaluate_drawing_findings(
            drawing_id=self.drawing_id,
            drawing_row={"id": self.drawing_id, "units": "mm", "unit_scale_m": 0.001},
            room_rows=[room],
            device_rows=[
                {
                    "id": "hd-1",
                    "room_id": "room-heat",
                    "type": "heat_detector",
                    "x": 2000,
                    "y": 1500,
                }
            ],
            rule_rows=[unverified_rule],
        )
        warnings = [f for f in findings if f.severity == FindingSeverity.warning]
        self.assertEqual(len(warnings), 1)
        self.assertEqual(warnings[0].ruleId, unverified_rule["id"])
        self.assertEqual(warnings[0].ruleStatus.value, "needs_review")
        self.assertIsNone(warnings[0].clause)

    def test_conflicting_rules_emit_rule_conflict_with_both_citations(self) -> None:
        mcp_dstu = _rule_row(
            rule_id="MANUAL_CALL_POINT_SPACING_DSTU",
            device_type="manual_call_point",
            value_kind="max_grid_spacing_m",
            value=30.0,
            max_area=None,
            max_height_m=None,
            document="ДСТУ EN 54-14:2021",
            clause="п. 6.6",
        )
        mcp_dbn = _rule_row(
            rule_id="MANUAL_CALL_POINT_SPACING_DBN",
            device_type="manual_call_point",
            value_kind="max_grid_spacing_m",
            value=50.0,
            max_area=None,
            max_height_m=None,
            document="ДБН В.2.5-56:2014",
            clause="п. 7.2.15",
        )
        room = {
            "id": "corridor-1",
            "name": "Коридор",
            "type": "corridor",
            "height": 3.0,
            "area": 24.0,
            "polygon": _rect(0, 0, 8000, 3000),
            "confirmed": True,
        }
        findings = evaluate_drawing_findings(
            drawing_id=self.drawing_id,
            drawing_row={"id": self.drawing_id, "units": "mm", "unit_scale_m": 0.001},
            room_rows=[room],
            device_rows=[
                {
                    "id": "sd-1",
                    "room_id": "corridor-1",
                    "type": "smoke_detector",
                    "x": 4000,
                    "y": 1500,
                },
                {
                    "id": "mcp-1",
                    "room_id": "corridor-1",
                    "type": "manual_call_point",
                    "x": 1000,
                    "y": 1500,
                },
            ],
            rule_rows=[self.smoke_rule, self.wall_rule, mcp_dstu, mcp_dbn],
            exit_rows=[
                {
                    "id": "ex-1",
                    "room_id": "corridor-1",
                    "name": "Вихід 1",
                    "x": 0,
                    "y": 1500,
                }
            ],
        )
        conflicts = [f for f in findings if f.severity == FindingSeverity.rule_conflict]
        self.assertEqual(len(conflicts), 1)
        msg = conflicts[0].message
        self.assertIn("ДСТУ EN 54-14:2021", msg)
        self.assertIn("п. 6.6", msg)
        self.assertIn("30", msg)
        self.assertIn("ДБН В.2.5-56:2014", msg)
        self.assertIn("п. 7.2.15", msg)
        self.assertIn("50", msg)
        self.assertIsNotNone(conflicts[0].conflictDetails)

    def test_redundant_devices_and_wall_clearance_emit_warnings(self) -> None:
        room = {
            "id": "room-small",
            "name": "Офіс",
            "type": "office",
            "height": 3.0,
            "area": 48.0,
            "polygon": _rect(0, 0, 8000, 6000),
            "confirmed": True,
        }
        # 4 detectors inside an 8x6 room (48 m2, max 2) + one at 0.2 m from wall
        findings = evaluate_drawing_findings(
            drawing_id=self.drawing_id,
            drawing_row={"id": self.drawing_id, "units": "mm", "unit_scale_m": 0.001},
            room_rows=[room],
            device_rows=[
                {
                    "id": "d-1",
                    "room_id": "room-small",
                    "type": "smoke_detector",
                    "x": 2000,
                    "y": 3000,
                },
                {
                    "id": "d-2",
                    "room_id": "room-small",
                    "type": "smoke_detector",
                    "x": 4000,
                    "y": 3000,
                },
                {
                    "id": "d-3",
                    "room_id": "room-small",
                    "type": "smoke_detector",
                    "x": 6000,
                    "y": 3000,
                },
                {
                    "id": "d-close",
                    "room_id": "room-small",
                    "type": "smoke_detector",
                    "x": 4000,
                    "y": 200,  # 0.2 m < 0.5 m
                },
                {
                    "id": "s-1",
                    "room_id": "room-small",
                    "type": "sounder",
                    "x": 4000,
                    "y": 3000,
                },
            ],
            rule_rows=[self.smoke_rule, self.wall_rule, self.sounder_rule],
        )
        warnings = [f for f in findings if f.severity == FindingSeverity.warning]
        self.assertTrue(any("Надлишок" in f.message for f in warnings))
        self.assertTrue(
            any(
                f.deviceId == "d-close" and "мінімальний відступ" in f.message
                for f in warnings
            )
        )
        self.assertFalse(any(f.severity == FindingSeverity.critical for f in findings))

    def test_compliant_layout_returns_empty_list(self) -> None:
        room = {
            "id": "room-ok",
            "name": "Офіс 101",
            "type": "office",
            "height": 3.2,
            "area": 48.0,
            "polygon": _rect(0, 0, 8000, 6000),
            "confirmed": True,
        }
        findings = evaluate_drawing_findings(
            drawing_id=self.drawing_id,
            drawing_row={"id": self.drawing_id, "units": "mm", "unit_scale_m": 0.001},
            room_rows=[room],
            device_rows=[
                {
                    "id": "d-ok",
                    "room_id": "room-ok",
                    "type": "smoke_detector",
                    "x": 4000,
                    "y": 3000,
                },
                {
                    "id": "s-ok",
                    "room_id": "room-ok",
                    "type": "sounder",
                    "x": 4000,
                    "y": 3000,
                },
            ],
            rule_rows=[self.smoke_rule, self.wall_rule, self.sounder_rule],
        )
        self.assertEqual(findings, [])

    def test_dxf3_oversized_step_and_no_sounder_fixture(self) -> None:
        dxf_path = FIXTURES_DXF3 / "03_violations_oversized_step_and_no_sounder.dxf"
        parsed_rooms, scale = parse_dxf_rooms_with_scale(dxf_path, drawing_id=uuid4())
        room_rows = [
            {
                "id": str(r.id),
                "name": r.name,
                "type": r.type,
                "height": r.height if r.height is not None else 3.2,
                "area": float(r.area),
                "polygon": [{"x": p.x, "y": p.y} for p in r.polygon],
                "confirmed": True,
            }
            for r in parsed_rooms
        ]
        device_rows = _dxf_circles_as_device_rows(dxf_path, self.drawing_id)
        doc = ezdxf.readfile(str(dxf_path))
        exits = [
            {"id": f"ex-{i}", "name": e.name, "x": e.x, "y": e.y}
            for i, e in enumerate(find_exit_points(doc.modelspace(), scale))
        ]
        findings = evaluate_drawing_findings(
            drawing_id=self.drawing_id,
            drawing_row={"id": self.drawing_id, "units": "m", "unit_scale_m": scale},
            room_rows=room_rows,
            device_rows=device_rows,
            rule_rows=[self.smoke_rule, self.wall_rule, self.sounder_rule],
            exit_rows=exits,
            unit_scale_m=scale,
        )
        room_by_name = {r["name"]: r["id"] for r in room_rows}
        conf_id = next(
            rid for name, rid in room_by_name.items() if "Conference" in name
        )
        srv_id = next(rid for name, rid in room_by_name.items() if "Server" in name)

        self.assertTrue(
            any(
                f.roomId == conf_id
                and f.severity == FindingSeverity.critical
                and "12.00 м" in f.message
                for f in findings
            )
        )
        self.assertTrue(
            any(
                f.roomId == srv_id
                and f.severity == FindingSeverity.critical
                and "оповіщувач" in f.message
                for f in findings
            )
        )

    def test_dxf3_missing_height_and_mcp_step_fixture(self) -> None:
        dxf_path = FIXTURES_DXF3 / "04_violations_missing_height_and_mcp_step.dxf"
        parsed_rooms, scale = parse_dxf_rooms_with_scale(dxf_path, drawing_id=uuid4())
        room_rows = [
            {
                "id": str(r.id),
                "name": r.name,
                "type": r.type,
                "height": 3.0 if "Corridor" in str(r.name) else r.height,
                "area": float(r.area),
                "polygon": [{"x": p.x, "y": p.y} for p in r.polygon],
                "confirmed": True,
            }
            for r in parsed_rooms
        ]
        device_rows = _dxf_circles_as_device_rows(dxf_path, self.drawing_id)
        doc = ezdxf.readfile(str(dxf_path))
        detected_exits = find_exit_points(doc.modelspace(), scale)
        exits = [
            {"id": f"ex-{i}", "name": e.name, "x": e.x, "y": e.y}
            for i, e in enumerate(detected_exits)
        ]
        doors = find_door_points(doc.modelspace(), scale, detected_exits)
        passages = [{"id": f"pas-{i}", "x": d.x, "y": d.y} for i, d in enumerate(doors)]
        mcp_dstu = _rule_row(
            rule_id="MANUAL_CALL_POINT_SPACING_DSTU",
            device_type="manual_call_point",
            value_kind="max_grid_spacing_m",
            value=30.0,
            max_area=None,
            max_height_m=None,
            document="ДСТУ EN 54-14:2021",
            clause="п. 6.6",
        )
        findings = evaluate_drawing_findings(
            drawing_id=self.drawing_id,
            drawing_row={"id": self.drawing_id, "units": "m", "unit_scale_m": scale},
            room_rows=room_rows,
            device_rows=device_rows,
            rule_rows=[self.smoke_rule, self.wall_rule, self.sounder_rule, mcp_dstu],
            exit_rows=exits,
            passage_rows=passages,
            unit_scale_m=scale,
        )
        storage_id = next(
            r["id"] for r in room_rows if "Storage" in str(r.get("name") or "")
        )
        self.assertTrue(
            any(
                f.roomId == storage_id
                and f.severity == FindingSeverity.insufficient_data
                and "Не введено висоту приміщення" in f.message
                for f in findings
            )
        )
        self.assertTrue(
            any(
                f.severity == FindingSeverity.critical
                and "40.0 м" in f.message
                and f.clause == "п. 6.6"
                for f in findings
            )
        )

    def test_dxf1_simple_and_unclosed_fixtures_audit(self) -> None:
        for fname in ("01_simple_rooms_mm.dxf", "01_unclosed_cafe_office_plan_mm.dxf"):
            dxf_path = FIXTURES_DXF1 / fname
            parsed_rooms, scale = parse_dxf_rooms_with_scale(
                dxf_path, drawing_id=uuid4()
            )
            self.assertGreater(len(parsed_rooms), 0, fname)
            room_rows = [
                {
                    "id": str(r.id),
                    "name": r.name,
                    "type": r.type,
                    "height": r.height,
                    "area": float(r.area),
                    "polygon": [{"x": p.x, "y": p.y} for p in r.polygon],
                    "confirmed": bool(getattr(r, "confirmed", False)),
                }
                for r in parsed_rooms
            ]
            findings = evaluate_drawing_findings(
                drawing_id=self.drawing_id,
                drawing_row={
                    "id": self.drawing_id,
                    "units": "mm",
                    "unit_scale_m": scale,
                },
                room_rows=room_rows,
                device_rows=[],
                rule_rows=[self.smoke_rule, self.wall_rule, self.sounder_rule],
                unit_scale_m=scale,
            )
            self.assertGreater(len(findings), 0, fname)
            for finding in findings:
                Finding.model_validate(finding.model_dump())


class TestFindingsApiIntegration(unittest.TestCase):
    def setUp(self) -> None:
        self.user_id = str(uuid4())
        self.drawing_id = str(uuid4())
        self.room_id = str(uuid4())
        self.device_id = str(uuid4())
        self.current_user = CurrentUser(id=self.user_id, role="engineer")

        self.drawing_row: dict[str, Any] = {
            "id": self.drawing_id,
            "owner_id": self.user_id,
            "status": "processed",
            "units": "mm",
            "unit_scale_m": 0.001,
        }
        self.room_row: dict[str, Any] = {
            "id": self.room_id,
            "drawing_id": self.drawing_id,
            "name": "Офіс 101",
            "type": "office",
            "height": 3.0,
            "area": 48.0,
            "polygon": _rect(0, 0, 8000, 6000),
            "confirmed": True,
        }
        self.device_row: dict[str, Any] = {
            "id": self.device_id,
            "drawing_id": self.drawing_id,
            "room_id": self.room_id,
            "rule_id": None,
            "type": "smoke_detector",
            "layer": "SYS_FIRE_SENSORS",
            "x": 4000.0,
            "y": 3000.0,
        }
        self.sounder_row: dict[str, Any] = {
            "id": str(uuid4()),
            "drawing_id": self.drawing_id,
            "room_id": self.room_id,
            "rule_id": None,
            "type": "sounder",
            "layer": "SYS_FIRE_SOUNDERS",
            "x": 4000.0,
            "y": 3000.0,
        }
        self.smoke_rule = _rule_row(rule_id="SMOKE_GRID_HEIGHT_3_5")
        self.wall_rule = _rule_row(
            rule_id="SMOKE_WALL_CLEARANCE",
            value_kind="max_wall_distance_m",
            value=4.5,
            max_area=None,
            min_clearance=0.5,
            clause="6.5.2",
        )
        self.sounder_rule = _rule_row(
            rule_id="SOUNDER_VERIFIED_TEST",
            device_type="sounder",
            value_kind="max_grid_spacing_m",
            value=15.0,
            max_area=None,
            max_height_m=None,
            clause="6.7.2",
            verification_status="verified",
        )

        self.drawings_table = FakeTable([self.drawing_row])
        self.rooms_table = FakeTable([self.room_row])
        self.devices_table = FakeTable([self.device_row, self.sounder_row])
        self.rules_table = FakeTable(
            [self.smoke_rule, self.wall_rule, self.sounder_rule]
        )
        self.zones_table = FakeTable([])
        self.exits_table = FakeTable([])
        self.passages_table = FakeTable([])
        self.findings_table = FakeTable([])

        self.supabase = fake_supabase(
            {
                "drawings": self.drawings_table,
                "rooms": self.rooms_table,
                "devices": self.devices_table,
                "rules": self.rules_table,
                "room_zones": self.zones_table,
                "exits": self.exits_table,
                "passages": self.passages_table,
                "findings": self.findings_table,
            }
        )

        regen_patch = patch("src.modules.devices.router.generate_and_upload_result_dxf")
        self.regen_mock = regen_patch.start()
        self.addCleanup(regen_patch.stop)

        app.dependency_overrides[get_current_user] = lambda: self.current_user
        app.dependency_overrides[get_supabase_client] = lambda: self.supabase
        self.client = TestClient(app)

    def tearDown(self) -> None:
        app.dependency_overrides.clear()

    def test_get_findings_requires_owner_or_admin(self) -> None:
        self.drawing_row["owner_id"] = str(uuid4())
        resp = self.client.get(f"/api/v1/drawings/{self.drawing_id}/findings")
        self.assertEqual(resp.status_code, 403)

        self.current_user = CurrentUser(id=str(uuid4()), role="admin")
        resp_admin = self.client.get(f"/api/v1/drawings/{self.drawing_id}/findings")
        self.assertEqual(resp_admin.status_code, 200)
        self.assertEqual(resp_admin.json(), [])

    def test_manual_device_and_room_edits_update_findings_immediately(self) -> None:
        # Initially compliant -> []
        initial = self.client.get(f"/api/v1/drawings/{self.drawing_id}/findings")
        self.assertEqual(initial.status_code, 200)
        self.assertEqual(initial.json(), [])

        # PATCH device position to 0.2 m from wall -> wall clearance warning
        patch_close = self.client.patch(
            f"/api/v1/devices/{self.device_id}",
            json={"position": {"x": 4000.0, "y": 200.0}},
        )
        self.assertEqual(patch_close.status_code, 200, patch_close.text)
        after_move = self.client.get(f"/api/v1/drawings/{self.drawing_id}/findings")
        self.assertEqual(after_move.status_code, 200)
        self.assertTrue(
            any(
                f["severity"] == "warning" and f["deviceId"] == self.device_id
                for f in after_move.json()
            )
        )

        # DELETE smoke detector -> critical missing detector persisted BEFORE GET
        del_resp = self.client.delete(f"/api/v1/devices/{self.device_id}")
        self.assertEqual(del_resp.status_code, 204)
        self.assertTrue(
            any(
                row["severity"] == "critical" and row["room_id"] == self.room_id
                for row in self.findings_table.rows
            )
        )
        after_delete = self.client.get(f"/api/v1/drawings/{self.drawing_id}/findings")
        self.assertEqual(after_delete.status_code, 200)
        self.assertTrue(
            any(
                f["severity"] == "critical" and f["roomId"] == self.room_id
                for f in after_delete.json()
            )
        )
        self.assertEqual(len(self.findings_table.rows), len(after_delete.json()))

        # PATCH room height to null -> insufficient_data persisted BEFORE GET
        patch_room = self.client.patch(
            f"/api/v1/rooms/{self.room_id}",
            json={"height": None},
        )
        self.assertEqual(patch_room.status_code, 200)
        self.assertTrue(
            any(
                row["severity"] == "insufficient_data"
                and "Не введено висоту приміщення" in row["message"]
                for row in self.findings_table.rows
            )
        )
        after_room_patch = self.client.get(
            f"/api/v1/drawings/{self.drawing_id}/findings"
        )
        self.assertEqual(after_room_patch.status_code, 200)
        self.assertTrue(
            any(
                f["severity"] == "insufficient_data"
                and "Не введено висоту приміщення" in f["message"]
                for f in after_room_patch.json()
            )
        )

    def test_missing_findings_table_falls_back_gracefully(self) -> None:
        # Simulate unmigrated public.findings (PGRST205)
        self.supabase = fake_supabase(
            {
                "drawings": self.drawings_table,
                "rooms": self.rooms_table,
                "devices": FakeTable([self.sounder_row]),  # missing smoke detector
                "rules": self.rules_table,
                "room_zones": self.zones_table,
                "exits": self.exits_table,
                "passages": self.passages_table,
                "findings": _SchemaErrorTable([]),
            }
        )
        resp = self.client.get(f"/api/v1/drawings/{self.drawing_id}/findings")
        self.assertEqual(resp.status_code, 200, resp.text)
        data = resp.json()
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]["severity"], "critical")
        Finding.model_validate(data[0])

    def test_get_findings_is_strictly_read_only(self) -> None:
        # 1. With unmigrated findings table (evaluates in memory, zero writes)
        self.supabase = fake_supabase(
            {
                "drawings": self.drawings_table,
                "rooms": self.rooms_table,
                "devices": FakeTable([self.sounder_row]),
                "rules": self.rules_table,
                "room_zones": self.zones_table,
                "exits": self.exits_table,
                "passages": self.passages_table,
                "findings": _SchemaErrorTable([]),
            }
        )
        resp = self.client.get(f"/api/v1/drawings/{self.drawing_id}/findings")
        self.assertEqual(resp.status_code, 200)
        for table in (
            self.drawings_table,
            self.rooms_table,
            self.rules_table,
            self.zones_table,
            self.exits_table,
            self.passages_table,
        ):
            self.assertEqual(table.inserts, [])
            self.assertEqual(table.updates, [])
            self.assertEqual(table.deleted, [])
        self.supabase.rpc.assert_not_called()

        # 2. Even with a stale snapshot in public.findings, GET evaluates live
        #    from current DB state with zero writes.
        stale_id = str(uuid4())
        persisted_findings = FakeTable(
            [
                {
                    "id": stale_id,
                    "drawing_id": self.drawing_id,
                    "room_id": self.room_id,
                    "device_id": None,
                    "rule_id": self.smoke_rule["id"],
                    "severity": "critical",
                    "message": "Застаріле порушення",
                    "document": "ДСТУ EN 54-14:2021",
                    "clause": "6.5.2, таблиця A.1",
                    "rule_status": "verified",
                }
            ]
        )
        self.supabase = fake_supabase(
            {
                "drawings": self.drawings_table,
                "rooms": self.rooms_table,
                "devices": self.devices_table,
                "rules": self.rules_table,
                "room_zones": self.zones_table,
                "exits": self.exits_table,
                "passages": self.passages_table,
                "findings": persisted_findings,
            }
        )
        resp_persisted = self.client.get(f"/api/v1/drawings/{self.drawing_id}/findings")
        self.assertEqual(resp_persisted.status_code, 200)
        self.assertEqual(resp_persisted.json(), [])
        self.assertEqual(persisted_findings.inserts, [])
        self.assertEqual(persisted_findings.updates, [])
        self.assertEqual(persisted_findings.deleted, [])
        self.supabase.rpc.assert_not_called()

    def test_atomic_persistence_preserves_previous_snapshot_on_failure(self) -> None:
        previous_row = {
            "id": str(uuid4()),
            "drawing_id": self.drawing_id,
            "room_id": self.room_id,
            "device_id": None,
            "rule_id": self.smoke_rule["id"],
            "severity": "critical",
            "message": "Попередній знімок аудиту",
            "document": "ДСТУ EN 54-14:2021",
            "clause": "6.5.2",
            "rule_status": "verified",
        }
        new_finding = Finding(
            id=str(uuid4()),
            drawingId=self.drawing_id,
            roomId=self.room_id,
            deviceId=None,
            ruleId=self.smoke_rule["id"],
            severity=FindingSeverity.warning,
            message="Нове попередження",
            document="ДСТУ EN 54-14:2021",
            clause="6.5.2",
            ruleStatus="verified",
        )

        # 1. RPC failure keeps previous snapshot intact
        findings_tbl_rpc = FakeTable([dict(previous_row)])

        def failing_rpc(_params: dict[str, Any]) -> Any:
            raise RuntimeError("simulated RPC failure")

        supa_rpc = fake_supabase(
            {"findings": findings_tbl_rpc},
            rpc={"replace_drawing_findings": failing_rpc},
        )
        with self.assertRaises(RuntimeError):
            _persist_findings(supa_rpc, self.drawing_id, [new_finding])
        self.assertEqual(len(findings_tbl_rpc.rows), 1)
        self.assertEqual(findings_tbl_rpc.rows[0]["id"], previous_row["id"])
        self.assertEqual(findings_tbl_rpc.deleted, [])

        # 2. Fallback insert failure keeps previous snapshot intact
        findings_tbl_fallback = _FailingInsertFindingsTable([dict(previous_row)])
        supa_fallback = fake_supabase({"findings": findings_tbl_fallback})
        with self.assertRaises(RuntimeError):
            _persist_findings(supa_fallback, self.drawing_id, [new_finding])
        self.assertEqual(len(findings_tbl_fallback.rows), 1)
        self.assertEqual(findings_tbl_fallback.rows[0]["id"], previous_row["id"])
        self.assertEqual(findings_tbl_fallback.deleted, [])

    def test_place_isolates_audit_persistence_failure(self) -> None:
        self.drawing_row["status"] = "processing"
        self.drawing_row["storage_path"] = f"{self.user_id}/{self.drawing_id}/src.dxf"
        previous_row = {
            "id": str(uuid4()),
            "drawing_id": self.drawing_id,
            "room_id": self.room_id,
            "device_id": None,
            "rule_id": None,
            "severity": "critical",
            "message": "Застарілий знімок",
            "document": None,
            "clause": None,
            "rule_status": None,
        }
        findings_tbl = FakeTable([previous_row])

        def failing_rpc(_params: dict[str, Any]) -> Any:
            raise RuntimeError("audit DB down")

        self.supabase = fake_supabase(
            {
                "drawings": self.drawings_table,
                "rooms": self.rooms_table,
                "devices": self.devices_table,
                "rules": self.rules_table,
                "room_zones": self.zones_table,
                "exits": self.exits_table,
                "passages": self.passages_table,
                "findings": findings_tbl,
            },
            rpc={"replace_drawing_findings": failing_rpc},
        )

        with patch(
            "src.modules.drawings.router.generate_and_upload_result_dxf",
            return_value=f"{self.user_id}/{self.drawing_id}/result.dxf",
        ):
            resp = self.client.post(f"/api/v1/drawings/{self.drawing_id}/place")

        self.assertEqual(resp.status_code, 200, resp.text)
        body = resp.json()
        self.assertEqual(body["status"], "processed")
        self.assertTrue(body["result_path"].endswith("/result.dxf"))
        self.assertEqual(body["audit_status"], "failed")
        self.assertIn("audit_warning", body)
        self.assertEqual(self.drawing_row["status"], "processed")
        self.assertEqual(self.drawing_row["placement_report"]["audit_status"], "failed")

        # GET /findings must ignore the stale snapshot when audit_status == "failed"
        get_resp = self.client.get(f"/api/v1/drawings/{self.drawing_id}/findings")
        self.assertEqual(get_resp.status_code, 200)
        self.assertFalse(any(f["id"] == previous_row["id"] for f in get_resp.json()))

    def test_missing_data_and_unprocessed_never_return_empty_list(self) -> None:
        # 1. Mandatory table read error (rooms PGRST205) -> 503
        self.supabase = fake_supabase(
            {
                "drawings": self.drawings_table,
                "rooms": _SchemaErrorTable([], "rooms"),
                "devices": self.devices_table,
                "rules": self.rules_table,
            }
        )
        resp_rooms_err = self.client.get(f"/api/v1/drawings/{self.drawing_id}/findings")
        self.assertEqual(resp_rooms_err.status_code, 503)

        # 2. Mandatory table read error (rules PGRST205) -> 503
        self.supabase = fake_supabase(
            {
                "drawings": self.drawings_table,
                "rooms": self.rooms_table,
                "devices": self.devices_table,
                "rules": _SchemaErrorTable([], "rules"),
            }
        )
        resp_rules_err = self.client.get(f"/api/v1/drawings/{self.drawing_id}/findings")
        self.assertEqual(resp_rules_err.status_code, 503)

        # 3. Unprocessed drawing (uploaded / processing) -> insufficient_data (never [])
        for raw_status in ("uploaded", "processing"):
            self.drawing_row["status"] = raw_status
            self.supabase = fake_supabase(
                {
                    "drawings": self.drawings_table,
                    "rooms": self.rooms_table,
                    "devices": self.devices_table,
                    "rules": self.rules_table,
                }
            )
            resp_unproc = self.client.get(
                f"/api/v1/drawings/{self.drawing_id}/findings"
            )
            self.assertEqual(resp_unproc.status_code, 200)
            data = resp_unproc.json()
            self.assertEqual(len(data), 1)
            self.assertEqual(data[0]["severity"], "insufficient_data")

        # 4. Missing optional exits table -> insufficient_data for MCP (never [])
        self.drawing_row["status"] = "processed"
        self.supabase = fake_supabase(
            {
                "drawings": self.drawings_table,
                "rooms": self.rooms_table,
                "devices": self.devices_table,
                "rules": self.rules_table,
                "room_zones": self.zones_table,
                "exits": _SchemaErrorTable([], "exits"),
                "passages": self.passages_table,
                "findings": FakeTable([]),
            }
        )
        resp_no_exits = self.client.get(f"/api/v1/drawings/{self.drawing_id}/findings")
        self.assertEqual(resp_no_exits.status_code, 200)
        self.assertTrue(
            any(
                f["severity"] == "insufficient_data"
                and "таблиця виходів/проходів відсутня" in f["message"]
                for f in resp_no_exits.json()
            )
        )

        # 5. Processed and compliant with all tables available -> []
        self.supabase = fake_supabase(
            {
                "drawings": self.drawings_table,
                "rooms": self.rooms_table,
                "devices": self.devices_table,
                "rules": self.rules_table,
                "room_zones": self.zones_table,
                "exits": self.exits_table,
                "passages": self.passages_table,
                "findings": FakeTable([]),
            }
        )
        resp_clean = self.client.get(f"/api/v1/drawings/{self.drawing_id}/findings")
        self.assertEqual(resp_clean.status_code, 200)
        self.assertEqual(resp_clean.json(), [])

    def test_get_findings_ignores_stale_snapshot_when_zones_or_exits_unavailable(
        self,
    ) -> None:
        stale_row = {
            "id": str(uuid4()),
            "drawing_id": self.drawing_id,
            "room_id": self.room_id,
            "device_id": None,
            "rule_id": None,
            "severity": "warning",
            "message": "Застарілий кешований запис",
            "document": None,
            "clause": None,
            "rule_status": None,
        }

        # 1. room_zones becomes unavailable -> must NOT return stale snapshot
        self.supabase = fake_supabase(
            {
                "drawings": self.drawings_table,
                "rooms": self.rooms_table,
                "devices": self.devices_table,
                "rules": self.rules_table,
                "room_zones": _SchemaErrorTable([], "room_zones"),
                "exits": self.exits_table,
                "passages": self.passages_table,
                "findings": FakeTable([dict(stale_row)]),
            }
        )
        resp_no_zones = self.client.get(f"/api/v1/drawings/{self.drawing_id}/findings")
        self.assertEqual(resp_no_zones.status_code, 200)
        data_zones = resp_no_zones.json()
        self.assertFalse(any(f["id"] == stale_row["id"] for f in data_zones))
        self.assertTrue(
            any(
                f["severity"] == "insufficient_data"
                and "таблиця зон відсутня" in f["message"]
                for f in data_zones
            )
        )

        # 2. exits becomes unavailable -> must NOT return stale snapshot
        self.supabase = fake_supabase(
            {
                "drawings": self.drawings_table,
                "rooms": self.rooms_table,
                "devices": self.devices_table,
                "rules": self.rules_table,
                "room_zones": self.zones_table,
                "exits": _SchemaErrorTable([], "exits"),
                "passages": self.passages_table,
                "findings": FakeTable([dict(stale_row)]),
            }
        )
        resp_no_exits = self.client.get(f"/api/v1/drawings/{self.drawing_id}/findings")
        self.assertEqual(resp_no_exits.status_code, 200)
        data_exits = resp_no_exits.json()
        self.assertFalse(any(f["id"] == stale_row["id"] for f in data_exits))
        self.assertTrue(
            any(
                f["severity"] == "insufficient_data"
                and "таблиця виходів/проходів відсутня" in f["message"]
                for f in data_exits
            )
        )

    def test_manual_zone_edit_with_rpc_failure_succeeds_and_get_stays_fresh(
        self,
    ) -> None:
        zone_id = str(uuid4())
        zone_row = {
            "id": zone_id,
            "room_id": self.room_id,
            "drawing_id": self.drawing_id,
            "name": "Основна зона",
            "height": 3.0,
            "area": 48.0,
            "polygon": _rect(0, 0, 8000, 6000),
        }
        stale_row = {
            "id": str(uuid4()),
            "drawing_id": self.drawing_id,
            "room_id": self.room_id,
            "device_id": None,
            "rule_id": None,
            "severity": "warning",
            "message": "Застарілий запис до редагування зони",
            "document": None,
            "clause": None,
            "rule_status": None,
        }
        zones_tbl = FakeTable([zone_row])
        findings_tbl = FakeTable([stale_row])

        def failing_rpc(_params: dict[str, Any]) -> Any:
            raise RuntimeError("replace_drawing_findings transient RPC failure")

        self.supabase = fake_supabase(
            {
                "drawings": self.drawings_table,
                "rooms": self.rooms_table,
                "devices": self.devices_table,
                "rules": self.rules_table,
                "room_zones": zones_tbl,
                "exits": self.exits_table,
                "passages": self.passages_table,
                "findings": findings_tbl,
            },
            rpc={"replace_drawing_findings": failing_rpc},
        )

        # Updating zone height to 18.0 m triggers missing-rule finding; RPC fails.
        patch_resp = self.client.patch(
            f"/api/v1/zones/{zone_id}",
            json={"height": 18.0},
        )
        self.assertEqual(patch_resp.status_code, 200, patch_resp.text)
        self.assertEqual(patch_resp.json()["height"], 18.0)

        # GET /findings computes live from updated zone (ignores stale snapshot).
        get_resp = self.client.get(f"/api/v1/drawings/{self.drawing_id}/findings")
        self.assertEqual(get_resp.status_code, 200, get_resp.text)
        findings = get_resp.json()
        self.assertFalse(any(f["id"] == stale_row["id"] for f in findings))
        self.assertTrue(
            any(
                f["severity"] == "insufficient_data" and "18" in f["message"]
                for f in findings
            )
        )


class TestFindingsMigrationSecurity(unittest.TestCase):
    def test_migration_018_enforces_read_only_rls_and_service_role_rpc(self) -> None:
        migration_path = (
            API_DIR.parent.parent
            / "supabase"
            / "migrations"
            / "018_replace_drawing_findings.sql"
        )
        sql = migration_path.read_text(encoding="utf-8")
        normalized = " ".join(sql.lower().split())

        self.assertIn("for select", normalized)
        self.assertNotIn("for all", normalized)
        self.assertIn(
            "revoke all on table public.findings from public, anon, authenticated",
            normalized,
        )
        self.assertIn(
            "grant select on table public.findings to authenticated", normalized
        )
        self.assertIn("grant all on table public.findings to service_role", normalized)
        self.assertIn(
            "revoke all on function public.replace_drawing_findings(uuid, jsonb) "
            "from public, anon, authenticated",
            normalized,
        )
        self.assertIn(
            "grant execute on function public.replace_drawing_findings(uuid, jsonb) "
            "to service_role",
            normalized,
        )
        self.assertNotIn("to authenticated, service_role", normalized)

    def test_migration_018_real_postgres_rls_and_privileges(self) -> None:
        supabase_dir = API_DIR.parent.parent / "supabase"
        migrations = sorted((supabase_dir / "migrations").glob("*.sql"))
        stubs_sql = (supabase_dir / "tests" / "supabase_stubs.sql").read_text(
            encoding="utf-8"
        )
        assertions_sql = (supabase_dir / "tests" / "assertions.sql").read_text(
            encoding="utf-8"
        )
        full_chain_sql = "\n".join(
            [
                stubs_sql,
                *(path.read_text(encoding="utf-8") for path in migrations),
                assertions_sql,
            ]
        )

        if shutil.which("initdb") and shutil.which("pg_ctl") and shutil.which("psql"):
            with tempfile.TemporaryDirectory(prefix="bim_pg_test_") as tmp_dir:
                data_dir = Path(tmp_dir) / "data"
                log_file = Path(tmp_dir) / "pg.log"
                port = "55438"
                subprocess.run(
                    ["initdb", "-D", str(data_dir), "-U", "postgres", "--auth=trust"],
                    check=True,
                    capture_output=True,
                    text=True,
                )
                subprocess.run(
                    [
                        "pg_ctl",
                        "-D",
                        str(data_dir),
                        "-l",
                        str(log_file),
                        "-o",
                        f"-k {tmp_dir} -p {port} -c listen_addresses=127.0.0.1",
                        "start",
                    ],
                    check=True,
                    capture_output=True,
                    text=True,
                )
                try:
                    proc = subprocess.run(
                        [
                            "psql",
                            "-h",
                            "127.0.0.1",
                            "-p",
                            port,
                            "-U",
                            "postgres",
                            "-d",
                            "postgres",
                            "-v",
                            "ON_ERROR_STOP=1",
                        ],
                        input=full_chain_sql,
                        text=True,
                        capture_output=True,
                        check=False,
                    )
                    self.assertEqual(
                        proc.returncode,
                        0,
                        f"PostgreSQL check failed:\n{proc.stdout}\n{proc.stderr}",
                    )
                finally:
                    subprocess.run(
                        ["pg_ctl", "-D", str(data_dir), "-m", "immediate", "stop"],
                        check=False,
                        capture_output=True,
                    )
            return

        docker = shutil.which("docker")
        if docker:
            info = subprocess.run(
                [docker, "info"], capture_output=True, text=True, check=False
            )
            img = subprocess.run(
                [docker, "image", "inspect", "postgres:16-alpine"],
                capture_output=True,
                text=True,
                check=False,
            )
            if info.returncode == 0 and img.returncode == 0:
                run = subprocess.run(
                    [
                        docker,
                        "run",
                        "--rm",
                        "-e",
                        "POSTGRES_PASSWORD=postgres",
                        "-d",
                        "postgres:16-alpine",
                    ],
                    check=True,
                    capture_output=True,
                    text=True,
                )
                cid = run.stdout.strip()
                try:
                    for _ in range(40):
                        ready = subprocess.run(
                            [
                                docker,
                                "exec",
                                cid,
                                "psql",
                                "-h",
                                "127.0.0.1",
                                "-U",
                                "postgres",
                                "-d",
                                "postgres",
                                "-c",
                                "SELECT 1",
                            ],
                            capture_output=True,
                            check=False,
                        )
                        if ready.returncode == 0:
                            break
                    proc = subprocess.run(
                        [
                            docker,
                            "exec",
                            "-i",
                            cid,
                            "psql",
                            "-h",
                            "127.0.0.1",
                            "-U",
                            "postgres",
                            "-d",
                            "postgres",
                            "-v",
                            "ON_ERROR_STOP=1",
                        ],
                        input=full_chain_sql,
                        text=True,
                        capture_output=True,
                        check=False,
                    )
                    self.assertEqual(
                        proc.returncode,
                        0,
                        f"Docker PG check failed:\n{proc.stdout}\n{proc.stderr}",
                    )
                finally:
                    subprocess.run(
                        [docker, "rm", "-f", cid], check=False, capture_output=True
                    )
                return

        self.skipTest(
            "Neither local PostgreSQL (initdb/pg_ctl/psql) nor cached Docker "
            "postgres:16-alpine is available"
        )


if __name__ == "__main__":
    unittest.main()
