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

LIST_KEYS = {
    "id",
    "filename",
    "uploaded_at",
    "status",
    "error_message",
    "has_result",
}


class FakeQuery:
    def __init__(self, rows: list[dict]):
        self._rows = rows
        self._filters: list[tuple[str, object]] = []
        self._order: str | None = None
        self._desc = False

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, key, value):
        self._filters.append((key, value))
        return self

    def order(self, key, desc=False):
        self._order = key
        self._desc = desc
        return self

    def execute(self):
        rows = list(self._rows)
        for key, value in self._filters:
            rows = [row for row in rows if str(row.get(key)) == str(value)]
        if self._order is not None:
            rows.sort(key=lambda row: row[self._order], reverse=self._desc)
        return type("Resp", (), {"data": rows})()


class FakeSupabase:
    def __init__(self, rows_by_table: dict[str, list[dict]] | None = None):
        self.tables = {
            name: list(rows) for name, rows in (rows_by_table or {}).items()
        }
        self.queries: list[FakeQuery] = []

    def table(self, name):
        query = FakeQuery(self.tables.setdefault(name, []))
        self.queries.append(query)
        return query


@pytest.fixture
def fake_supabase(monkeypatch):
    fake = FakeSupabase()
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


def drawing_row(
    drawing_id: str,
    owner_id: str,
    created_at: str,
    status: str = "uploaded",
    **extra,
) -> dict:
    return {
        "id": drawing_id,
        "owner_id": owner_id,
        "original_file_name": f"{drawing_id}.dxf",
        "created_at": created_at,
        "status": status,
        **extra,
    }


def test_list_drawings_unauthenticated_returns_401(client):
    response = client.get("/api/v1/drawings")

    assert response.status_code == 401


def test_list_drawings_only_returns_owned_rows(client, fake_supabase):
    fake_supabase.tables["drawings"] = [
        drawing_row("a-old", "user-a", "2026-01-01T00:00:00Z"),
        drawing_row("b-only", "user-b", "2026-04-01T00:00:00Z", "processing"),
        drawing_row("a-mid", "user-a", "2026-02-01T00:00:00Z", "processed"),
        drawing_row("a-new", "user-a", "2026-03-01T00:00:00Z", "processing"),
    ]
    authenticate("user-a")

    response = client.get("/api/v1/drawings")

    assert response.status_code == 200
    ids = {item["id"] for item in response.json()}
    assert ids == {"a-old", "a-mid", "a-new"}
    assert "b-only" not in ids


def test_list_drawings_orders_newest_first_regardless_of_insert_order(
    client, fake_supabase
):
    fake_supabase.tables["drawings"] = [
        drawing_row("oldest", "user-a", "2026-01-01T00:00:00Z"),
        drawing_row("newest", "user-a", "2026-03-01T00:00:00Z"),
        drawing_row("middle", "user-a", "2026-02-01T00:00:00Z"),
    ]
    authenticate("user-a")

    response = client.get("/api/v1/drawings")

    assert response.status_code == 200
    assert [item["id"] for item in response.json()] == [
        "newest",
        "middle",
        "oldest",
    ]


def test_list_drawings_maps_every_contract_status(client, fake_supabase):
    fake_supabase.tables["drawings"] = [
        drawing_row("uploaded-row", "user-a", "2026-04-01T00:00:00Z", "uploaded"),
        drawing_row(
            "processing-row", "user-a", "2026-03-01T00:00:00Z", "processing"
        ),
        drawing_row("processed-row", "user-a", "2026-02-01T00:00:00Z", "processed"),
        drawing_row(
            "failed-row",
            "user-a",
            "2026-01-01T00:00:00Z",
            "failed",
            error_message="DXF parsing failed",
        ),
    ]
    authenticate("user-a")

    response = client.get("/api/v1/drawings")

    assert response.status_code == 200
    by_id = {item["id"]: item for item in response.json()}
    assert by_id["uploaded-row"]["status"] == "uploaded"
    assert by_id["processing-row"]["status"] == "processing"
    assert by_id["processed-row"]["status"] == "processed"
    assert by_id["failed-row"]["status"] == "failed"
    assert by_id["failed-row"]["error_message"]
    assert by_id["failed-row"]["error_message"] == "DXF parsing failed"
    for non_failed in ("uploaded-row", "processing-row", "processed-row"):
        assert by_id[non_failed]["error_message"] is None


def test_list_drawings_has_result_reflects_stored_placement(
    client, fake_supabase
):
    fake_supabase.tables["drawings"] = [
        drawing_row("with-result", "user-a", "2026-02-01T00:00:00Z", "processed"),
        drawing_row("without-result", "user-a", "2026-01-01T00:00:00Z", "uploaded"),
    ]
    fake_supabase.tables["rooms"] = [
        {"id": "room-1", "drawing_id": "with-result"},
    ]
    fake_supabase.tables["devices"] = [
        {"id": "device-1", "drawing_id": "with-result"},
    ]
    authenticate("user-a")

    response = client.get("/api/v1/drawings")

    assert response.status_code == 200
    by_id = {item["id"]: item for item in response.json()}
    assert by_id["with-result"]["has_result"] is True
    assert by_id["without-result"]["has_result"] is False


def test_list_drawings_ignores_user_id_query_parameter(client, fake_supabase):
    fake_supabase.tables["drawings"] = [
        drawing_row("a-only", "user-a", "2026-02-01T00:00:00Z"),
        drawing_row("b-only", "user-b", "2026-03-01T00:00:00Z"),
    ]
    authenticate("user-a")

    response = client.get("/api/v1/drawings", params={"user_id": "user-b"})

    assert response.status_code == 200
    ids = {item["id"] for item in response.json()}
    assert ids == {"a-only"}
    assert "b-only" not in ids


def test_list_drawings_uses_snake_case_contract_keys(client, fake_supabase):
    fake_supabase.tables["drawings"] = [
        drawing_row("a-only", "user-a", "2026-02-01T00:00:00Z", "uploaded"),
    ]
    authenticate("user-a")

    response = client.get("/api/v1/drawings")

    assert response.status_code == 200
    items = response.json()
    assert len(items) == 1
    assert set(items[0]) == LIST_KEYS
    assert items[0]["id"] == "a-only"
    assert items[0]["filename"] == "a-only.dxf"
    assert items[0]["uploaded_at"] == "2026-02-01T00:00:00Z"
    assert items[0]["status"] == "uploaded"
    assert items[0]["has_result"] is False
