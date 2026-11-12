import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

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


class TestDrawingsList(unittest.TestCase):
    def setUp(self) -> None:
        self.fake_supabase = FakeSupabase()
        self._client_patcher = patch(
            "src.infrastructure.supabase._get_cached_client",
            lambda *args, **kwargs: self.fake_supabase,
        )
        self._client_patcher.start()
        app.dependency_overrides.clear()
        self.client = TestClient(app)

    def tearDown(self) -> None:
        app.dependency_overrides.clear()
        self._client_patcher.stop()

    def authenticate(self, user_id: str, role: str = "engineer") -> None:
        app.dependency_overrides[get_current_user] = lambda: CurrentUser(
            id=user_id,
            email=f"{user_id}@example.com",
            role=role,
        )

    def test_list_drawings_unauthenticated_returns_401(self) -> None:
        response = self.client.get("/api/v1/drawings")

        self.assertEqual(response.status_code, 401)

    def test_list_drawings_only_returns_owned_rows(self) -> None:
        self.fake_supabase.tables["drawings"] = [
            drawing_row("a-old", "user-a", "2026-01-01T00:00:00Z"),
            drawing_row("b-only", "user-b", "2026-04-01T00:00:00Z", "processing"),
            drawing_row("a-mid", "user-a", "2026-02-01T00:00:00Z", "processed"),
            drawing_row("a-new", "user-a", "2026-03-01T00:00:00Z", "processing"),
        ]
        self.authenticate("user-a")

        response = self.client.get("/api/v1/drawings")

        self.assertEqual(response.status_code, 200)
        ids = {item["id"] for item in response.json()}
        self.assertEqual(ids, {"a-old", "a-mid", "a-new"})
        self.assertNotIn("b-only", ids)

    def test_list_drawings_orders_newest_first_regardless_of_insert_order(
        self,
    ) -> None:
        self.fake_supabase.tables["drawings"] = [
            drawing_row("oldest", "user-a", "2026-01-01T00:00:00Z"),
            drawing_row("newest", "user-a", "2026-03-01T00:00:00Z"),
            drawing_row("middle", "user-a", "2026-02-01T00:00:00Z"),
        ]
        self.authenticate("user-a")

        response = self.client.get("/api/v1/drawings")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            [item["id"] for item in response.json()],
            ["newest", "middle", "oldest"],
        )

    def test_list_drawings_maps_every_contract_status(self) -> None:
        self.fake_supabase.tables["drawings"] = [
            drawing_row(
                "uploaded-row", "user-a", "2026-04-01T00:00:00Z", "uploaded"
            ),
            drawing_row(
                "processing-row", "user-a", "2026-03-01T00:00:00Z", "processing"
            ),
            drawing_row(
                "processed-row", "user-a", "2026-02-01T00:00:00Z", "processed"
            ),
            drawing_row(
                "failed-row",
                "user-a",
                "2026-01-01T00:00:00Z",
                "failed",
                error_message="DXF parsing failed",
            ),
        ]
        self.authenticate("user-a")

        response = self.client.get("/api/v1/drawings")

        self.assertEqual(response.status_code, 200)
        by_id = {item["id"]: item for item in response.json()}
        self.assertEqual(by_id["uploaded-row"]["status"], "uploaded")
        self.assertEqual(by_id["processing-row"]["status"], "processing")
        self.assertEqual(by_id["processed-row"]["status"], "processed")
        self.assertEqual(by_id["failed-row"]["status"], "failed")
        self.assertTrue(by_id["failed-row"]["error_message"])
        self.assertEqual(
            by_id["failed-row"]["error_message"], "DXF parsing failed"
        )
        for non_failed in ("uploaded-row", "processing-row", "processed-row"):
            self.assertIsNone(by_id[non_failed]["error_message"])

    def test_list_drawings_has_result_reflects_stored_placement(self) -> None:
        self.fake_supabase.tables["drawings"] = [
            drawing_row(
                "with-result", "user-a", "2026-02-01T00:00:00Z", "processed"
            ),
            drawing_row(
                "without-result", "user-a", "2026-01-01T00:00:00Z", "uploaded"
            ),
        ]
        self.fake_supabase.tables["rooms"] = [
            {"id": "room-1", "drawing_id": "with-result"},
        ]
        self.fake_supabase.tables["devices"] = [
            {"id": "device-1", "drawing_id": "with-result"},
        ]
        self.authenticate("user-a")

        response = self.client.get("/api/v1/drawings")

        self.assertEqual(response.status_code, 200)
        by_id = {item["id"]: item for item in response.json()}
        self.assertIs(by_id["with-result"]["has_result"], True)
        self.assertIs(by_id["without-result"]["has_result"], False)

    def test_list_drawings_ignores_user_id_query_parameter(self) -> None:
        self.fake_supabase.tables["drawings"] = [
            drawing_row("a-only", "user-a", "2026-02-01T00:00:00Z"),
            drawing_row("b-only", "user-b", "2026-03-01T00:00:00Z"),
        ]
        self.authenticate("user-a")

        response = self.client.get(
            "/api/v1/drawings", params={"user_id": "user-b"}
        )

        self.assertEqual(response.status_code, 200)
        ids = {item["id"] for item in response.json()}
        self.assertEqual(ids, {"a-only"})
        self.assertNotIn("b-only", ids)

    def test_list_drawings_uses_snake_case_contract_keys(self) -> None:
        self.fake_supabase.tables["drawings"] = [
            drawing_row(
                "a-only", "user-a", "2026-02-01T00:00:00Z", "uploaded"
            ),
        ]
        self.authenticate("user-a")

        response = self.client.get("/api/v1/drawings")

        self.assertEqual(response.status_code, 200)
        items = response.json()
        self.assertEqual(len(items), 1)
        self.assertEqual(set(items[0]), LIST_KEYS)
        self.assertEqual(items[0]["id"], "a-only")
        self.assertEqual(items[0]["filename"], "a-only.dxf")
        self.assertEqual(items[0]["uploaded_at"], "2026-02-01T00:00:00Z")
        self.assertEqual(items[0]["status"], "uploaded")
        self.assertIs(items[0]["has_result"], False)


if __name__ == "__main__":
    unittest.main()
