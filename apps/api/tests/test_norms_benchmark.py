"""Offline Fixture & Contract Verification Suite (Mock Provider) (BIM-163 / BIM-168).

Validates contract serialization, guard rules, and edge-case handling across
5 engineering benchmark test cases using deterministic offline mock fixtures:
- Benchmark 1: Димовий сповіщувач — площа (ДБН В.2.5-56:2014, Таблиця А.1 -> 85 м²)
- Benchmark 2: Димовий сповіщувач — відстань (ДБН В.2.5-56:2014, Таблиця А.1 -> 9,0 м)
- Benchmark 3: Відстань до стіни (ДБН В.2.5-56:2014 -> від 0,5 м до 4,5 м)
- Benchmark 4 (Negative): Obsolete norm (СНиП / НПБ -> needs_verification, clause=None)
- Benchmark 5 (Negative): Non-existent requirement -> needs_verification, clause=None

IMPORTANT NOTE:
These tests verify deterministic contracts, anti-hallucination guard logic,
and HTTP status semantics. They do NOT evaluate live LLM generative accuracy
or third-party model performance without search retrieval.
"""

from __future__ import annotations

import os
import sys
import unittest
from datetime import UTC, datetime
from unittest.mock import MagicMock

# Set required environment variables for Settings before importing app
os.environ.setdefault("SUPABASE_URL", "https://mock.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "mock-service-role-key")

from pathlib import Path  # noqa: E402

API_DIR = Path(__file__).resolve().parent.parent
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

from fastapi.testclient import TestClient  # noqa: E402

from src.contracts.norms import (  # noqa: E402
    NormLookupContext,
    NormLookupRequest,
    NormLookupResult,
    NormVerificationStatus,
    is_official_domain,
)
from src.core.auth import CurrentUser, get_current_user  # noqa: E402
from src.infrastructure.supabase import get_supabase_client  # noqa: E402
from src.main import app  # noqa: E402
from src.services.norms.provider import (  # noqa: E402
    BaseNormsSearchProvider,
    MockNormsSearchProvider,
)
from src.services.norms.service import NormsService, get_norms_service  # noqa: E402


def benchmark_fixture_dispatcher(request: NormLookupRequest) -> NormLookupResult:
    """Deterministic offline fixture dispatcher for the 5 benchmark queries."""
    query = request.query.lower()
    now_utc = datetime.now(UTC)

    # Benchmark 1: Димовий сповіщувач — площа
    if "площу" in query or "площа" in query:
        return NormLookupResult(
            document="ДБН В.2.5-56:2014",
            clause="Таблиця А.1",
            value="до 85 м²",
            sourceUrl="https://dsns.gov.ua/uk/normativna-baza/dbn-v-2-5-56-2014",
            checkedAt=now_utc,
            status=NormVerificationStatus.found_in_official_source,
            summary=(
                "Згідно з Таблицею А.1 ДБН В.2.5-56:2014, за висоти приміщення "
                "до 3,5 м точковий димовий пожежний сповіщувач контролює площу "
                "до 85 м²."
            ),
            rawSnippet="Таблиця А.1 — Середня площа контролю: 85 м².",
        )

    # Benchmark 2: Димовий сповіщувач — максимальна відстань між сповіщувачами
    if "відстань між" in query:
        return NormLookupResult(
            document="ДБН В.2.5-56:2014",
            clause="Таблиця А.1",
            value="до 9,0 м",
            sourceUrl="https://zakon.rada.gov.ua/laws/show/z1128-14",
            checkedAt=now_utc,
            status=NormVerificationStatus.found_in_official_source,
            summary=(
                "Згідно з Таблицею А.1 ДБН В.2.5-56:2014, за висоти приміщення "
                "до 3,5 м максимальна відстань між точковими димовими сповіщувачами "
                "становить 9,0 м."
            ),
            rawSnippet="Таблиця А.1 — Максимальна відстань між сповіщувачами: 9,0 м.",
        )

    # Benchmark 3: Відстань до стіни
    if "до стіни" in query:
        return NormLookupResult(
            document="ДБН В.2.5-56:2014",
            clause="Пункт 6.2.22",
            value="від 0,5 м до 4,5 м",
            sourceUrl="https://budstandart.ua/doc/dbn-v-2-5-56-2014",
            checkedAt=now_utc,
            status=NormVerificationStatus.found_in_official_source,
            summary=(
                "Відстань від сповіщувача до стіни повинна становити не менше 0,5 м "
                "та не перевищувати 4,5 м (половини відстані між сповіщувачами)."
            ),
            rawSnippet="Пункт 6.2.22 — відстань до стіни: не менше 0,5 м.",
        )

    # Benchmark 4: Застаріла норма (СНиП / НПБ) — модель намагається повернути СНиП
    if "сніп" in query or "снип" in query or "нпб" in query:
        # Use model_construct to simulate raw candidate from external provider
        return NormLookupResult.model_construct(
            document="СНиП 2.04.09-84",
            clause="Таблиця 1, п. 2.1",
            value="85 м²",
            sourceUrl="https://zakon.rada.gov.ua/laws/show/test",
            checkedAt=now_utc,
            status=NormVerificationStatus.found_in_official_source,
            summary="Вимога згідно радянського нормативу СНиП 2.04.09-84.",
            rawSnippet="СНиП 2.04.09-84: площа 85 кв.м",
        )

    # Benchmark 5: Неіснуюча вимога (квантовий плазмовий сповіщувач)
    return NormLookupResult(
        document=None,
        clause=None,
        value=None,
        sourceUrl=None,
        checkedAt=now_utc,
        status=NormVerificationStatus.needs_verification,
        summary=(
            "Вимогу не знайдено в чинних реєстрах України (ДБН В.2.5-56:2014, "
            "ДСТУ EN 54). Потрібна ручна верифікація інженером."
        ),
        rawSnippet=None,
    )


class TestNormsBenchmarks(unittest.IsolatedAsyncioTestCase):
    """Offline Fixture & Contract Verification Suite (Mock Provider) (BIM-168).

    Validates that the contract and guard correctly handle active standards,
    obsolete Soviet norms, non-existent norms, and official whitelists.
    """

    def setUp(self) -> None:
        self.provider: BaseNormsSearchProvider = MockNormsSearchProvider(
            handler=benchmark_fixture_dispatcher
        )
        self.service = NormsService(provider=self.provider)

        self.mock_supabase = MagicMock()
        app.dependency_overrides[get_supabase_client] = lambda: self.mock_supabase
        app.dependency_overrides[get_norms_service] = lambda: self.service
        app.dependency_overrides[get_current_user] = lambda: CurrentUser(
            id="test-user-id", email="engineer@example.com"
        )
        self.client = TestClient(app)

    def tearDown(self) -> None:
        app.dependency_overrides.clear()

    # --------------------------------------------------------------------------
    # Benchmark 1: Димовий сповіщувач — площа
    # --------------------------------------------------------------------------
    async def test_benchmark_1_smoke_detector_coverage_area(self) -> None:
        """Query 1: Площа контролю точкового димового сповіщувача при висоті 3,5 м."""
        query = (
            "Яку площу контролює точковий димовий сповіщувач "
            "при висоті приміщення 3,5 м?"
        )
        req = NormLookupRequest(
            query=query,
            context=NormLookupContext(roomHeight=3.5, detectorType="smoke"),
        )

        # 1. Service Level
        result = await self.service.lookup(req)
        self.assertEqual(result.status, NormVerificationStatus.found_in_official_source)
        self.assertEqual(result.document, "ДБН В.2.5-56:2014")
        self.assertIn("Таблиця А.1", str(result.clause))
        self.assertEqual(result.value, "до 85 м²")
        self.assertTrue(is_official_domain(result.sourceUrl))
        self.assertIn("85 м²", result.summary)

        # 2. HTTP API Level
        response = self.client.post("/norms/lookup", json=req.model_dump())
        self.assertEqual(response.status_code, 200)
        api_data = response.json()
        self.assertEqual(
            api_data["status"],
            NormVerificationStatus.found_in_official_source.value,
        )
        self.assertEqual(api_data["document"], "ДБН В.2.5-56:2014")
        self.assertEqual(api_data["clause"], "Таблиця А.1")

    # --------------------------------------------------------------------------
    # Benchmark 2: Димовий сповіщувач — максимальна відстань між сповіщувачами
    # --------------------------------------------------------------------------
    async def test_benchmark_2_smoke_detector_spacing_distance(self) -> None:
        """Query 2: Максимальна відстань між точковими димовими сповіщувачами."""
        query = (
            "Яка максимальна відстань між точковими димовими сповіщувачами "
            "при висоті приміщення до 3,5 м?"
        )
        req = NormLookupRequest(
            query=query,
            context=NormLookupContext(roomHeight=3.5, detectorType="smoke"),
        )

        # 1. Service Level
        result = await self.service.lookup(req)
        self.assertEqual(result.status, NormVerificationStatus.found_in_official_source)
        self.assertEqual(result.document, "ДБН В.2.5-56:2014")
        self.assertIn("Таблиця А.1", str(result.clause))
        self.assertEqual(result.value, "до 9,0 м")
        self.assertTrue(is_official_domain(result.sourceUrl))

        # 2. HTTP API Level
        response = self.client.post("/norms/lookup", json=req.model_dump())
        self.assertEqual(response.status_code, 200)
        api_data = response.json()
        self.assertEqual(api_data["clause"], "Таблиця А.1")
        self.assertEqual(api_data["value"], "до 9,0 м")

    # --------------------------------------------------------------------------
    # Benchmark 3: Відстань до стіни
    # --------------------------------------------------------------------------
    async def test_benchmark_3_distance_to_wall(self) -> None:
        """Query 3: Мінімальна та максимальна відстань від сповіщувача до стіни."""
        query = "Яка мінімальна та максимальна відстань від сповіщувача до стіни?"
        req = NormLookupRequest(
            query=query,
            context=NormLookupContext(detectorType="smoke"),
        )

        # 1. Service Level
        result = await self.service.lookup(req)
        self.assertEqual(result.status, NormVerificationStatus.found_in_official_source)
        self.assertEqual(result.document, "ДБН В.2.5-56:2014")
        self.assertIsNotNone(result.clause)
        self.assertEqual(result.value, "від 0,5 м до 4,5 м")
        self.assertTrue(is_official_domain(result.sourceUrl))

        # 2. HTTP API Level
        response = self.client.post("/norms/lookup", json=req.model_dump())
        self.assertEqual(response.status_code, 200)
        api_data = response.json()
        self.assertEqual(
            api_data["status"],
            NormVerificationStatus.found_in_official_source.value,
        )
        self.assertIn("0,5 м", api_data["summary"])

    # --------------------------------------------------------------------------
    # Benchmark 4: Застаріла / радянська норма (Негативний тест)
    # --------------------------------------------------------------------------
    async def test_benchmark_4_obsolete_soviet_norm_rejection(self) -> None:
        """Query 4 (Negative): Посилання на СНиП 2.04.09-84 або НПБ блокується."""
        query = "Яка норма розміщення сповіщувачів згідно СНиП 2.04.09-84 або НПБ?"
        req = NormLookupRequest(query=query)

        # 1. Service Level
        result = await self.service.lookup(req)
        self.assertEqual(result.status, NormVerificationStatus.needs_verification)
        # STRICT REQUIREMENT: clause must be None
        self.assertIsNone(result.clause)
        self.assertIsNone(result.document)
        self.assertIsNone(result.sourceUrl)
        self.assertTrue(
            "радянський" in result.summary.lower()
            or "застарілий" in result.summary.lower()
        )

        # 2. HTTP API Level
        response = self.client.post("/norms/lookup", json=req.model_dump())
        self.assertEqual(response.status_code, 200)
        api_data = response.json()
        self.assertEqual(
            api_data["status"],
            NormVerificationStatus.needs_verification.value,
        )
        self.assertIsNone(api_data["clause"])
        self.assertIsNone(api_data["document"])

    # --------------------------------------------------------------------------
    # Benchmark 5: Неіснуюча вимога (Негативний тест)
    # --------------------------------------------------------------------------
    async def test_benchmark_5_nonexistent_norm_unverified(self) -> None:
        """Query 5 (Negative): Квантовий плазмовий сповіщувач -> needs_verification."""
        query = (
            "Яка норма для квантового плазмового сповіщувача в дерев'яному перекритті?"
        )
        req = NormLookupRequest(query=query)

        # 1. Service Level
        result = await self.service.lookup(req)
        self.assertEqual(result.status, NormVerificationStatus.needs_verification)
        # STRICT REQUIREMENT: clause must be None
        self.assertIsNone(result.clause)
        self.assertIsNone(result.document)
        self.assertIsNone(result.sourceUrl)
        self.assertIn("ручна верифікація", result.summary.lower())

        # 2. HTTP API Level
        response = self.client.post("/norms/lookup", json=req.model_dump())
        self.assertEqual(response.status_code, 200)
        api_data = response.json()
        self.assertEqual(
            api_data["status"],
            NormVerificationStatus.needs_verification.value,
        )
        self.assertIsNone(api_data["clause"])


if __name__ == "__main__":
    unittest.main()
