"""Regression tests reproducing P1 & P2 defects for BIM-163.

Demonstrates:
1. False verification: fictional URL on allowed domain without active standard.
2. Settings isolation: settings must propagate to provider without relying on os.getenv.
3. Access control & bounds: anonymous requests return 401; query > 500 returns 422.
"""

from __future__ import annotations

import os
import sys
import unittest
from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

# Ensure test Supabase credentials exist for settings initialization
os.environ.setdefault("SUPABASE_URL", "https://mock.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "mock-service-role-key")

from pathlib import Path  # noqa: E402

API_DIR = Path(__file__).resolve().parent.parent
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

from fastapi.testclient import TestClient  # noqa: E402

from src.contracts.norms import (  # noqa: E402
    NormLookupRequest,
    NormLookupResult,
    NormVerificationStatus,
)
from src.core.config import Settings  # noqa: E402
from src.infrastructure.supabase import get_supabase_client  # noqa: E402
from src.main import app  # noqa: E402
from src.services.norms.provider import (  # noqa: E402
    LLMDomainRestrictedSearchProvider,
    MockNormsSearchProvider,
)
from src.services.norms.service import NormsService, get_norms_service  # noqa: E402


class TestNormsRegression(unittest.IsolatedAsyncioTestCase):
    """Regression test suite for PR code review findings."""

    def setUp(self) -> None:
        self.mock_supabase = MagicMock()
        app.dependency_overrides[get_supabase_client] = lambda: self.mock_supabase
        self.client = TestClient(app)

    def tearDown(self) -> None:
        app.dependency_overrides.clear()

    # --------------------------------------------------------------------------
    # Regression Test 1: Fictional URL on Allowed Domain Must NOT Be Verified
    # --------------------------------------------------------------------------
    async def test_fictional_url_on_allowed_domain_downgrades_to_needs_verification(
        self,
    ) -> None:
        """A fictional document/URL on zakon.rada.gov.ua must be downgraded."""
        fictional_raw = NormLookupResult.model_construct(
            document="ДБН вигаданий-999",
            clause="999.999",
            value="100500 м²",
            sourceUrl="https://zakon.rada.gov.ua/does-not-exist-review-fixture",
            checkedAt=datetime.now(UTC),
            status=NormVerificationStatus.found_in_official_source,
            summary="Вигадана норма без доказів.",
            rawSnippet=None,
        )
        mock_provider = MockNormsSearchProvider(default_result=fictional_raw)
        service = NormsService(provider=mock_provider)

        req = NormLookupRequest(query="яка норма для вигаданого дбн")
        result = await service.lookup(req)

        # STRICT DEFENSE: Must NOT be certified as found_in_official_source
        self.assertEqual(result.status, NormVerificationStatus.needs_verification)
        self.assertIsNone(result.clause)
        self.assertIsNone(result.sourceUrl)

    # --------------------------------------------------------------------------
    # Regression Test 2: Settings Isolation (No os.getenv Dependency)
    # --------------------------------------------------------------------------
    def test_settings_propagation_without_os_getenv(self) -> None:
        """Settings from Pydantic Settings must reach provider without os.environ."""
        # Ensure os.environ has NO norms keys
        clean_env = {
            k: v
            for k, v in os.environ.items()
            if not k.startswith(("NORMS_", "OPENAI_", "GEMINI_"))
        }

        with patch.dict(os.environ, clean_env, clear=True):
            custom_settings = Settings(
                SUPABASE_URL="https://mock.supabase.co",
                SUPABASE_SERVICE_ROLE_KEY="mock-role-key",
                NORMS_SEARCH_API_KEY="explicit-pydantic-key",
                NORMS_SEARCH_PROVIDER_URL="https://api.pydantic.example.com",
                NORMS_CACHE_TTL_SECONDS=1800,
            )

            service = get_norms_service(settings=custom_settings)
            self.assertIsInstance(service.provider, LLMDomainRestrictedSearchProvider)
            provider: LLMDomainRestrictedSearchProvider = service.provider  # type: ignore[assignment]

            self.assertEqual(provider.api_key, "explicit-pydantic-key")
            self.assertEqual(provider.base_url, "https://api.pydantic.example.com")
            self.assertFalse(provider.dry_run)
            self.assertEqual(service.cache_ttl_seconds, 1800.0)

    # --------------------------------------------------------------------------
    # Regression Test 3: Anonymous Access Rejected (401) & Length Bound (422)
    # --------------------------------------------------------------------------
    def test_anonymous_access_returns_401(self) -> None:
        """Endpoint must require authentication and reject anonymous calls with 401."""
        response = self.client.post(
            "/norms/lookup",
            json={"query": "яка площа сповіщувача"},
        )
        self.assertEqual(response.status_code, 401)

    def test_query_length_boundary_exceeded_returns_422(self) -> None:
        """Query exceeding max_length (500 chars) returns 422."""
        from src.core.auth import CurrentUser, get_current_user

        app.dependency_overrides[get_current_user] = lambda: CurrentUser(
            id="test-user", email="engineer@example.com"
        )
        long_query = "а" * 501
        response = self.client.post(
            "/norms/lookup",
            json={"query": long_query},
        )
        self.assertEqual(response.status_code, 422)


if __name__ == "__main__":
    unittest.main()
