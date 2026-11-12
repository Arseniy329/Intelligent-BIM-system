import os
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("SUPABASE_URL", "https://mock.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "mock-service-role-key")

API_DIR = Path(__file__).resolve().parent.parent
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

from src.core.auth import CurrentUser, get_current_user  # noqa: E402
from src.main import app  # noqa: E402


class FakeQuery:
    def __init__(self, rows: list[dict]):
        self._rows = rows
        self._filter: tuple[str, object] | None = None
        self._order: str | None = None
        self._desc = False

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, key, value):
        self._filter = (key, value)
        return self

    def order(self, key, desc=False):
        self._order = key
        self._desc = desc
        return self

    def execute(self):
        rows = list(self._rows)
        if self._filter is not None:
            key, value = self._filter
            rows = [row for row in rows if str(row.get(key)) == str(value)]
        if self._order is not None:
            rows.sort(key=lambda row: row[self._order], reverse=self._desc)
        return type("Resp", (), {"data": rows})()


class FakeSupabase:
    def __init__(self, rows: list[dict]):
        self.rows = rows
        self.queries: list[FakeQuery] = []

    def table(self, _name):
        query = FakeQuery(self.rows)
        self.queries.append(query)
        return query


@pytest.fixture
def fake_supabase(monkeypatch):
    fake = FakeSupabase([])
    monkeypatch.setattr(
        "src.infrastructure.supabase._get_cached_client",
        lambda *args, **kwargs: fake,
    )
    app.dependency_overrides.clear()
    yield fake
    app.dependency_overrides.clear()


@pytest.fixture
def client(fake_supabase):
    return TestClient(app)


def authenticate(user_id: str, role: str = "engineer") -> None:
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        id=user_id,
        email=f"{user_id}@example.com",
        role=role,
    )


def test_list_drawings_unauthenticated_returns_401(client):
    response = client.get("/api/v1/drawings")

    assert response.status_code == 401


def test_list_drawings_only_returns_owned_rows(client, fake_supabase):
    fake_supabase.rows = [
        {
            "id": "a-old",
            "owner_id": "user-a",
            "original_file_name": "a-old.dxf",
            "created_at": "2026-01-01T00:00:00Z",
            "status": "uploaded",
        },
        {
            "id": "b-only",
            "owner_id": "user-b",
            "original_file_name": "b-only.dxf",
            "created_at": "2026-04-01T00:00:00Z",
            "status": "processing",
        },
        {
            "id": "a-mid",
            "owner_id": "user-a",
            "original_file_name": "a-mid.dxf",
            "created_at": "2026-02-01T00:00:00Z",
            "status": "processed",
        },
        {
            "id": "a-new",
            "owner_id": "user-a",
            "original_file_name": "a-new.dxf",
            "created_at": "2026-03-01T00:00:00Z",
            "status": "processing",
        },
    ]
    authenticate("user-a")

    response = client.get("/api/v1/drawings")

    assert response.status_code == 200
    ids = {item["id"] for item in response.json()}
    assert ids == {"a-old", "a-mid", "a-new"}
    assert "b-only" not in ids


def test_list_drawings_orders_newest_first(client, fake_supabase):
    fake_supabase.rows = [
        {
            "id": "oldest",
            "owner_id": "user-a",
            "original_file_name": "oldest.dxf",
            "created_at": "2026-01-01T00:00:00Z",
            "status": "uploaded",
        },
        {
            "id": "newest",
            "owner_id": "user-a",
            "original_file_name": "newest.dxf",
            "created_at": "2026-03-01T00:00:00Z",
            "status": "uploaded",
        },
        {
            "id": "middle",
            "owner_id": "user-a",
            "original_file_name": "middle.dxf",
            "created_at": "2026-02-01T00:00:00Z",
            "status": "uploaded",
        },
    ]
    authenticate("user-a")

    response = client.get("/api/v1/drawings")

    assert response.status_code == 200
    assert [item["id"] for item in response.json()] == [
        "newest",
        "middle",
        "oldest",
    ]


def test_list_drawings_maps_statuses_and_keeps_error_rows(client, fake_supabase):
    fake_supabase.rows = [
        {
            "id": "failed-row",
            "owner_id": "user-a",
            "original_file_name": "failed.dxf",
            "created_at": "2026-04-01T00:00:00Z",
            "status": "failed",
        },
        {
            "id": "ready-row",
            "owner_id": "user-a",
            "original_file_name": "ready.dxf",
            "created_at": "2026-03-01T00:00:00Z",
            "status": "ready",
        },
        {
            "id": "completed-row",
            "owner_id": "user-a",
            "original_file_name": "completed.dxf",
            "created_at": "2026-02-01T00:00:00Z",
            "status": "completed",
        },
        {
            "id": "error-row",
            "owner_id": "user-a",
            "original_file_name": "error.dxf",
            "created_at": "2026-01-01T00:00:00Z",
            "status": "error",
        },
    ]
    authenticate("user-a")

    response = client.get("/api/v1/drawings")

    assert response.status_code == 200
    by_id = {item["id"]: item for item in response.json()}
    assert set(by_id) == {
        "failed-row",
        "ready-row",
        "completed-row",
        "error-row",
    }
    assert by_id["failed-row"]["status"] == "error"
    assert by_id["error-row"]["status"] == "error"
    assert by_id["ready-row"]["status"] == "done"
    assert by_id["completed-row"]["status"] == "done"


def test_list_drawings_for_user_without_rows_returns_empty_list(
    client, fake_supabase
):
    fake_supabase.rows = [
        {
            "id": "b-only",
            "owner_id": "user-b",
            "original_file_name": "b-only.dxf",
            "created_at": "2026-04-01T00:00:00Z",
            "status": "processing",
        }
    ]
    authenticate("user-a")

    response = client.get("/api/v1/drawings")

    assert response.status_code == 200
    assert response.json() == []
