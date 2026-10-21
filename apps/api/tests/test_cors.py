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


class TestCORSMiddleware(unittest.TestCase):
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

    def test_cors_allowed_localhost(self) -> None:
        response = self.client.get(
            "/health", headers={"Origin": "http://localhost:3000"}
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.headers.get("access-control-allow-origin"),
            "http://localhost:3000",
        )
        self.assertEqual(
            response.headers.get("access-control-allow-credentials"),
            "true",
        )

    def test_cors_allowed_loopback_ip(self) -> None:
        response = self.client.get(
            "/health", headers={"Origin": "http://127.0.0.1:3000"}
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.headers.get("access-control-allow-origin"),
            "http://127.0.0.1:3000",
        )
        self.assertEqual(
            response.headers.get("access-control-allow-credentials"),
            "true",
        )

    def test_cors_allowed_vercel_regex(self) -> None:
        vercel_origin = "https://intelligent-bim-frontend-preview.vercel.app"
        response = self.client.get("/health", headers={"Origin": vercel_origin})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.headers.get("access-control-allow-origin"),
            vercel_origin,
        )
        self.assertEqual(
            response.headers.get("access-control-allow-credentials"),
            "true",
        )

    def test_cors_allowed_subdomain_vercel_regex(self) -> None:
        vercel_origin = "https://feat-123.intelligent-bim.vercel.app"
        response = self.client.get("/health", headers={"Origin": vercel_origin})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.headers.get("access-control-allow-origin"),
            vercel_origin,
        )
        self.assertEqual(
            response.headers.get("access-control-allow-credentials"),
            "true",
        )

    def test_cors_disallowed_arbitrary_vercel_app(self) -> None:
        response = self.client.get(
            "/health", headers={"Origin": "https://arbitrary-other-app.vercel.app"}
        )
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("access-control-allow-origin", response.headers)

    def test_cors_disallowed_origin(self) -> None:
        response = self.client.get(
            "/health", headers={"Origin": "https://malicious-site.com"}
        )
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("access-control-allow-origin", response.headers)

    def test_cors_preflight_options(self) -> None:
        response = self.client.options(
            "/health",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "authorization,content-type",
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.headers.get("access-control-allow-origin"),
            "http://localhost:3000",
        )
        self.assertEqual(
            response.headers.get("access-control-allow-credentials"),
            "true",
        )


if __name__ == "__main__":
    unittest.main()
