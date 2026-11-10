"""Integration and E2E tests for FastAPI norms lookup endpoint (BIM-163).

Verifies Phase 3 requirements:
- Test 1: Successful POST /norms/lookup returns 200 OK with NormLookupResult
- Test 2: Validation test: empty / whitespace query returns 422 Unprocessable Entity
- Test 3: Provider failure test: provider exception returns 200 OK with fallback
- Test 4: Obsolete norm query: returns 200 OK with needs_verification & clause=None
- Test 5: Verify response conforms strictly to NormLookupResult schema
- Extra: /api/v1/norms/lookup prefix alias and extra fields rejection.

STRICT RESTRICTION: No external network calls in automated tests.
"""

from __future__ import annotations

import os
import sys
import unittest
from datetime import UTC, datetime
from unittest.mock import MagicMock

# Ensure environment variables required for Settings are set before importing app
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
from src.core.auth import CurrentUser, get_current_user  # noqa: E402
from src.infrastructure.supabase import get_supabase_client  # noqa: E402
from src.main import app  # noqa: E402
from src.services.norms.provider import MockNormsSearchProvider  # noqa: E402
from src.services.norms.service import (  # noqa: E402
    NormsService,
    get_norms_service,
    reset_norms_rate_limiter,
    reset_norms_service,
)


class TestNormsRouter(unittest.TestCase):
    """Integration test suite for /norms/lookup endpoint."""

    def setUp(self) -> None:
        reset_norms_service()
        reset_norms_rate_limiter()
        self.mock_supabase = MagicMock()
        app.dependency_overrides[get_supabase_client] = lambda: self.mock_supabase
        app.dependency_overrides[get_current_user] = lambda: CurrentUser(
            id="test-user-id", email="engineer@example.com"
        )
        self.client = TestClient(app)

    def tearDown(self) -> None:
        reset_norms_service()
        reset_norms_rate_limiter()
        app.dependency_overrides.clear()

    # --------------------------------------------------------------------------
    # Test 1: Successful POST /norms/lookup
    # --------------------------------------------------------------------------
    def test_successful_norms_lookup(self) -> None:
        """Valid query returns 200 OK with verified standard, clause, and URL."""
        mock_result = NormLookupResult(
            document="ДБН В.2.5-56:2014",
            clause="Таблиця А.1, пункт 6.2.23",
            value="до 85 м²",
            sourceUrl="https://dsns.gov.ua/uk/normativna-baza/dbn-v-2-5-56-2014",
            checkedAt=datetime.now(UTC),
            status=NormVerificationStatus.found_in_official_source,
            summary="При висоті до 3.5 м димовий сповіщувач контролює площу до 85 м².",
            rawSnippet="Таблиця А.1: 85 м².",
        )
        mock_service = NormsService(
            provider=MockNormsSearchProvider(
                default_result=mock_result, verified_retrieval=True
            ),
            verified_retrieval=True,
        )
        app.dependency_overrides[get_norms_service] = lambda: mock_service

        payload = {
            "query": "площа димового сповіщувача при висоті 3.5 м",
            "context": {
                "roomHeight": 3.5,
                "detectorType": "smoke",
            },
        }

        # Test both /norms/lookup and /api/v1/norms/lookup
        for endpoint in ("/norms/lookup", "/api/v1/norms/lookup"):
            response = self.client.post(endpoint, json=payload)
            self.assertEqual(response.status_code, 200, f"Failed for {endpoint}")
            data = response.json()

            self.assertEqual(
                data["status"],
                NormVerificationStatus.found_in_official_source.value,
            )
            self.assertEqual(data["document"], "ДБН В.2.5-56:2014")
            self.assertEqual(data["clause"], "Таблиця А.1, пункт 6.2.23")
            self.assertEqual(data["value"], "до 85 м²")
            self.assertEqual(
                data["sourceUrl"],
                "https://dsns.gov.ua/uk/normativna-baza/dbn-v-2-5-56-2014",
            )
            self.assertIn("85 м²", data["summary"])
            self.assertIn("checkedAt", data)

    # --------------------------------------------------------------------------
    # Test 2: Validation test for empty query
    # --------------------------------------------------------------------------
    def test_validation_empty_query_returns_422(self) -> None:
        """Empty or whitespace query returns 422 Unprocessable Entity."""
        # 2a: Empty string
        resp_empty = self.client.post("/norms/lookup", json={"query": ""})
        self.assertEqual(resp_empty.status_code, 422)

        # 2b: Whitespace only string
        resp_ws = self.client.post("/norms/lookup", json={"query": "     "})
        self.assertEqual(resp_ws.status_code, 422)

        # 2c: Missing query field entirely
        resp_missing = self.client.post("/norms/lookup", json={})
        self.assertEqual(resp_missing.status_code, 422)

    # --------------------------------------------------------------------------
    # Test 3: Provider failure test (Resilience / No 500 error)
    # --------------------------------------------------------------------------
    def test_provider_failure_returns_200_fallback(self) -> None:
        """External provider exception does NOT crash with 500; returns 200 fallback."""

        async def failing_provider(_req: NormLookupRequest) -> NormLookupResult:
            raise RuntimeError("Outbound network timeout or LLM rate limit exceeded")

        failing_service = NormsService(
            provider=MockNormsSearchProvider(handler=failing_provider)
        )
        app.dependency_overrides[get_norms_service] = lambda: failing_service

        payload = {"query": "відстань між сповіщувачами"}
        response = self.client.post("/norms/lookup", json=payload)

        # STRICT INVARIANT: Must NOT return 500 Internal Server Error
        self.assertEqual(response.status_code, 200)
        data = response.json()

        self.assertEqual(
            data["status"],
            NormVerificationStatus.needs_verification.value,
        )
        self.assertIsNone(data["clause"])
        self.assertIsNone(data["document"])
        self.assertIsNone(data["sourceUrl"])
        self.assertIn("ручна верифікація", data["summary"].lower())

    # --------------------------------------------------------------------------
    # Test 4: Obsolete norm query intercepted
    # --------------------------------------------------------------------------
    def test_obsolete_norm_intercepted_and_downgraded(self) -> None:
        """Query returning Soviet/Russian standard is downgraded with clause=None."""
        raw_snip = NormLookupResult.model_construct(
            document="СНиП 2.04.09-84",
            clause="Таблиця 1, п. 2.1",
            value="85 м²",
            sourceUrl="https://zakon.rada.gov.ua/laws/show/test",
            checkedAt=datetime.now(UTC),
            status=NormVerificationStatus.found_in_official_source,
            summary="Застарілий норматив",
            rawSnippet="СНиП 2.04.09-84: 85 кв.м",
        )
        service = NormsService(
            provider=MockNormsSearchProvider(default_result=raw_snip)
        )
        app.dependency_overrides[get_norms_service] = lambda: service

        payload = {"query": "параметри за СНиП 2.04.09-84"}
        response = self.client.post("/norms/lookup", json=payload)

        self.assertEqual(response.status_code, 200)
        data = response.json()

        self.assertEqual(
            data["status"],
            NormVerificationStatus.needs_verification.value,
        )
        self.assertIsNone(data["clause"])
        self.assertIsNone(data["document"])
        self.assertIsNone(data["sourceUrl"])
        self.assertIn("радянський", data["summary"].lower())

    # --------------------------------------------------------------------------
    # Test 5: Verify response conforms strictly to NormLookupResult schema
    # --------------------------------------------------------------------------
    def test_response_conforms_to_norm_lookup_result_schema(self) -> None:
        """Response payload strictly validates against Pydantic contract model."""
        mock_result = NormLookupResult(
            document="ДБН В.2.5-56:2014",
            clause="Пункт 6.2.22",
            value="1.4 м",
            sourceUrl="https://zakon.rada.gov.ua/laws/show/z1128-14",
            checkedAt=datetime.now(UTC),
            status=NormVerificationStatus.found_in_official_source,
            summary="Висота монтажу 1,4 м.",
            rawSnippet="Пункт 6.2.22 — висота (1,4 ± 0,1) м від рівня підлоги.",
        )
        service = NormsService(
            provider=MockNormsSearchProvider(
                default_result=mock_result,
                verified_retrieval=True,
            ),
            verified_retrieval=True,
        )
        app.dependency_overrides[get_norms_service] = lambda: service

        response = self.client.post(
            "/norms/lookup",
            json={"query": "висота ручного сповіщувача"},
        )
        self.assertEqual(response.status_code, 200)
        json_data = response.json()

        # Validate with Pydantic model directly
        validated = NormLookupResult.model_validate(json_data)
        self.assertEqual(validated.document, "ДБН В.2.5-56:2014")
        self.assertEqual(validated.clause, "Пункт 6.2.22")
        self.assertEqual(
            validated.status,
            NormVerificationStatus.found_in_official_source,
        )

    # --------------------------------------------------------------------------
    # Extra Test 6: Extra forbidden fields in request return 422
    # --------------------------------------------------------------------------
    def test_extra_fields_in_request_rejected(self) -> None:
        """Request with unknown fields rejected due to extra='forbid'."""
        payload = {
            "query": "нормативний запит",
            "forbidden_extra_field": "malicious or unexpected",
        }
        response = self.client.post("/norms/lookup", json=payload)
        self.assertEqual(response.status_code, 422)


if __name__ == "__main__":
    unittest.main()
