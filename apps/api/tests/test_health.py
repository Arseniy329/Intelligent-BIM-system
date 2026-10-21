import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock

from fastapi.testclient import TestClient

API_DIR = Path(__file__).resolve().parent.parent
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

from src.infrastructure.supabase import get_supabase_client
from src.main import app


class TestHealthEndpoint(unittest.TestCase):
    def setUp(self) -> None:
        self.mock_supabase = MagicMock()
        self.mock_response = MagicMock()
        self.mock_response.status_code = 200
        self.mock_supabase.postgrest.session.get.return_value = self.mock_response
        self.mock_supabase.rest_url = "https://example.supabase.co/rest/v1"

        app.dependency_overrides[get_supabase_client] = lambda: self.mock_supabase
        self.client = TestClient(app)

    def tearDown(self) -> None:
        app.dependency_overrides.clear()

    def test_health_success(self) -> None:
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["status"], "ok")
        self.assertEqual(data["database"]["status"], "connected")
        self.assertIn("timestamp", data)

    def test_healthz_alias(self) -> None:
        response = self.client.get("/healthz")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["status"], "ok")
        self.assertEqual(data["database"]["status"], "connected")

    def test_health_database_error(self) -> None:
        self.mock_supabase.postgrest.session.get.side_effect = Exception(
            "Connection refused"
        )
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["database"]["status"], "disconnected")


if __name__ == "__main__":
    unittest.main()
