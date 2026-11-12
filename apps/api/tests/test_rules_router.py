"""Integration tests for ``GET /api/v1/rules``.

Exercises the real FastAPI app and router against a fake Supabase table,
then validates the JSON payload against the Pydantic response contract used
by the web rules table (``apps/web/lib/api/rules.ts``).
"""

from __future__ import annotations

import os
import sys
import unittest
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock
from uuid import uuid4

# Settings are validated at import time; provide safe values before importing app.
os.environ.setdefault("SUPABASE_URL", "https://mock.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "mock-service-role-key")

from fastapi.testclient import TestClient  # noqa: E402

API_DIR = Path(__file__).resolve().parent.parent
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

from src.core.auth import CurrentUser, get_current_user  # noqa: E402
from src.infrastructure.supabase import get_supabase_client  # noqa: E402
from src.main import app  # noqa: E402
from src.modules.rules.router import RulesResponse  # noqa: E402

EXPECTED_RULE_KEYS = {
    "id",
    "rule",
    "value",
    "room_type",
    "room_height_min",
    "room_height_max",
    "document",
    "clause",
    "link",
    "status",
    "checked_at",
}


class FakeRulesTable:
    """Minimal chainable stand-in for a Supabase table query."""

    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self.rows = rows

    def select(self, *_args: Any) -> FakeRulesTable:
        return self

    def order(self, *_args: Any, **_kwargs: Any) -> FakeRulesTable:
        return self

    def execute(self) -> MagicMock:
        return MagicMock(data=list(self.rows))


class FakeSupabase:
    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self.rules_table = FakeRulesTable(rows)

    def table(self, name: str) -> FakeRulesTable:
        if name != "rules":
            raise AssertionError(f"Unexpected table access: {name}")
        return self.rules_table


def _rule_row(**overrides: Any) -> dict[str, Any]:
    row: dict[str, Any] = {
        "id": str(uuid4()),
        "rule_id": "SMOKE_GRID_HEIGHT_3_5",
        "name": "Крок сітки та площа захисту димових сповіщувачів",
        "device_type": "smoke_detector",
        "document": "ДСТУ EN 54-14:2021",
        "clause": "6.5.2, таблиця A.1",
        "value": 9,
        "threshold": 9,
        "value_kind": "max_grid_spacing_m",
        "room_types": ["sleeping_room"],
        "min_height_m": None,
        "max_height_m": 3.5,
        "source_url": "https://uas.gov.ua/national-fund-of-regulatory-documents/",
        "status": "verified",
        "verification_status": "verified",
        "created_at": "2026-11-07T10:00:00+00:00",
        "updated_at": "2026-11-08T12:30:00+00:00",
    }
    row.update(overrides)
    return row


class TestRulesRouter(unittest.TestCase):
    def setUp(self) -> None:
        self.current_user = CurrentUser(id=str(uuid4()), role="engineer")
        self.supabase = FakeSupabase([_rule_row()])
        app.dependency_overrides[get_current_user] = lambda: self.current_user
        app.dependency_overrides[get_supabase_client] = lambda: self.supabase
        self.client = TestClient(app)

    def tearDown(self) -> None:
        app.dependency_overrides.clear()

    def test_list_rules_returns_contract(self) -> None:
        response = self.client.get("/api/v1/rules")

        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.headers["content-type"].startswith("application/json"))
        payload = response.json()

        # Envelope is validated through the same Pydantic model the route uses.
        contract = RulesResponse.model_validate(payload)
        self.assertEqual(contract.total, 1)
        self.assertEqual(len(contract.items), 1)

        item = contract.items[0]
        self.assertEqual(
            item.rule, "Крок сітки та площа захисту димових сповіщувачів"
        )
        self.assertEqual(item.value, "9")
        self.assertEqual(item.room_type, "sleeping_room")
        self.assertIsNone(item.room_height_min)
        self.assertEqual(item.room_height_max, 3.5)
        self.assertEqual(item.document, "ДСТУ EN 54-14:2021")
        self.assertEqual(item.clause, "6.5.2, таблиця A.1")
        self.assertEqual(
            item.link,
            "https://uas.gov.ua/national-fund-of-regulatory-documents/",
        )
        self.assertEqual(item.status, "verified")
        self.assertIsNotNone(item.checked_at)
        self.assertEqual(item.checked_at, datetime(2026, 11, 8, 12, 30, tzinfo=UTC))

        # The serialized field names match what the web table reads.
        self.assertEqual(set(payload["items"][0]), EXPECTED_RULE_KEYS)
        self.assertEqual(set(payload), {"items", "total"})

    def test_status_and_empty_room_types_are_normalized(self) -> None:
        self.supabase.rules_table.rows = [
            _rule_row(
                name="Загальні вимоги до рівня звуку оповіщувачів",
                value=65.0,
                room_types=[],
                min_height_m=None,
                max_height_m=None,
                status="needs_review",
                verification_status="needs_review",
            )
        ]

        response = self.client.get("/api/v1/rules")

        self.assertEqual(response.status_code, 200, response.text)
        item = RulesResponse.model_validate(response.json()).items[0]
        self.assertEqual(item.status, "needs_verification")
        self.assertIsNone(item.room_type)
        self.assertEqual(item.value, "65")

    def test_empty_catalog_returns_empty_envelope(self) -> None:
        self.supabase.rules_table.rows = []

        response = self.client.get("/api/v1/rules")

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), {"items": [], "total": 0})

    def test_requires_authentication(self) -> None:
        app.dependency_overrides.pop(get_current_user)

        response = self.client.get("/api/v1/rules")

        self.assertEqual(response.status_code, 401)


if __name__ == "__main__":
    unittest.main()
