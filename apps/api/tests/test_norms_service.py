"""Unit tests for Norms Search Service and Anti-Hallucination Guard (BIM-163).

Verifies Phase 2 requirements:
- Test 1: Successful lookup with official domain (dsns.gov.ua / ДБН В.2.5-56:2014)
- Test 2: Obsolete Soviet norm (СНиП 2.04.09-84) intercepted & downgraded
- Test 3: Blocked / third-party domain (.ru / forum) intercepted & downgraded
- Test 4: Missing norm text returns needs_verification with clause=None
- Test 5: Cache prevents repeated outbound calls for identical queries
- Extra: TTL expiration, query builder, dry-run mode, and mock caller.

STRICT RESTRICTION: No external network calls in automated tests.
"""

from __future__ import annotations

import unittest
from datetime import UTC, datetime
from unittest.mock import patch

from src.contracts.norms import (
    NormLookupContext,
    NormLookupRequest,
    NormLookupResult,
    NormVerificationStatus,
)
from src.services.norms.guard import sanitize_and_verify_result
from src.services.norms.provider import (
    OFFICIAL_DOMAINS_SEARCH_FILTER,
    PRIMARY_ACTIVE_STANDARDS,
    LLMDomainRestrictedSearchProvider,
    MockNormsSearchProvider,
    build_domain_restricted_query,
)
from src.services.norms.service import NormsService


class TestNormsServiceAndGuard(unittest.IsolatedAsyncioTestCase):
    """Test suite for Phase 2 Norms Search Service architecture."""

    # --------------------------------------------------------------------------
    # Test 1: Successful lookup with official domain
    # --------------------------------------------------------------------------
    async def test_successful_lookup_with_official_domain(self) -> None:
        """Official domain (dsns.gov.ua / ДБН В.2.5-56:2014) returns verified result."""
        valid_result = NormLookupResult(
            document="ДБН В.2.5-56:2014",
            clause="Таблиця А.1, пункт 6.2.23",
            value="до 85 м²",
            sourceUrl="https://dsns.gov.ua/uk/normativna-baza/dbn-v-2-5-56-2014",
            checkedAt=datetime.now(UTC),
            status=NormVerificationStatus.found_in_official_source,
            summary="При висоті до 3.5 м димовий сповіщувач контролює площу до 85 м².",
            rawSnippet="Таблиця А.1 — площа: 85 м².",
        )
        mock_provider = MockNormsSearchProvider(default_result=valid_result)
        service = NormsService(provider=mock_provider)

        request = NormLookupRequest(
            query="площа димового сповіщувача при висоті 3.5 м",
            context=NormLookupContext(roomHeight=3.5, detectorType="smoke"),
        )

        result = await service.lookup(request)

        self.assertEqual(result.status, NormVerificationStatus.found_in_official_source)
        self.assertEqual(result.document, "ДБН В.2.5-56:2014")
        self.assertEqual(result.clause, "Таблиця А.1, пункт 6.2.23")
        self.assertEqual(result.value, "до 85 м²")
        self.assertEqual(
            result.sourceUrl,
            "https://dsns.gov.ua/uk/normativna-baza/dbn-v-2-5-56-2014",
        )
        self.assertIsNotNone(result.checkedAt)
        self.assertIn("85 м²", result.summary)

    # --------------------------------------------------------------------------
    # Test 2: Obsolete Soviet norm returned by LLM intercepted by guard
    # --------------------------------------------------------------------------
    async def test_obsolete_soviet_norm_intercepted_and_downgraded(self) -> None:
        """Soviet norm (СНиП 2.04.09-84) downgraded to needs_verification."""
        raw_snip = NormLookupResult.model_construct(
            document="СНиП 2.04.09-84",
            clause="Таблиця 1, пункт 2.1",
            value="85 м²",
            sourceUrl="https://zakon.rada.gov.ua/laws/show/test",
            checkedAt=datetime.now(UTC),
            status=NormVerificationStatus.found_in_official_source,
            summary="Застаріла норма з радянського нормативу.",
            rawSnippet="СНиП 2.04.09-84: 85 кв.м",
        )
        mock_provider = MockNormsSearchProvider(default_result=raw_snip)
        service = NormsService(provider=mock_provider)

        request = NormLookupRequest(query="норми СНиП для пожежної автоматики")
        result = await service.lookup(request)

        # Must be downgraded
        self.assertEqual(result.status, NormVerificationStatus.needs_verification)
        # Strictly None clause and document
        self.assertIsNone(result.clause)
        self.assertIsNone(result.document)
        self.assertIsNone(result.sourceUrl)
        self.assertTrue(
            "радянський" in result.summary.lower()
            or "застарілий" in result.summary.lower()
        )

    # --------------------------------------------------------------------------
    # Test 3: Blocked / third-party domain intercepted by guard
    # --------------------------------------------------------------------------
    async def test_blocked_third_party_domain_intercepted(self) -> None:
        """Blocked (.ru) or third-party domains are downgraded to needs_verification."""
        # 3a: Russian .ru domain
        raw_ru = NormLookupResult.model_construct(
            document="ДБН В.2.5-56:2014",
            clause="Таблиця А.1",
            value="85 м²",
            sourceUrl="https://mchs.gov.ru/activities/fire-safety",
            checkedAt=datetime.now(UTC),
            status=NormVerificationStatus.found_in_official_source,
            summary="Джерело з російського сайту",
        )
        service_ru = NormsService(
            provider=MockNormsSearchProvider(default_result=raw_ru)
        )
        res_ru = await service_ru.lookup(NormLookupRequest(query="запит ru"))

        self.assertEqual(res_ru.status, NormVerificationStatus.needs_verification)
        self.assertIsNone(res_ru.sourceUrl)
        self.assertIsNone(res_ru.clause)

        # 3b: Unofficial third-party blog/forum
        raw_blog = NormLookupResult.model_construct(
            document="ДБН В.2.5-56:2014",
            clause="Пункт 6.2.23",
            value="85 м²",
            sourceUrl="https://forum.stroimdom.com.ua/topic/12345",
            checkedAt=datetime.now(UTC),
            status=NormVerificationStatus.found_in_official_source,
            summary="Інформація з форуму",
        )
        service_blog = NormsService(
            provider=MockNormsSearchProvider(default_result=raw_blog)
        )
        res_blog = await service_blog.lookup(NormLookupRequest(query="запит blog"))

        self.assertEqual(res_blog.status, NormVerificationStatus.needs_verification)
        self.assertIsNone(res_blog.sourceUrl)
        self.assertIsNone(res_blog.clause)

    # --------------------------------------------------------------------------
    # Test 4: Missing norm text returns needs_verification with clause=None
    # --------------------------------------------------------------------------
    async def test_missing_norm_text_returns_needs_verification(self) -> None:
        """Missing or unverified clause results in needs_verification."""
        unverified_raw = NormLookupResult(
            document=None,
            clause=None,
            value=None,
            sourceUrl=None,
            checkedAt=datetime.now(UTC),
            status=NormVerificationStatus.needs_verification,
            summary="Вимогу не знайдено; потрібна ручна перевірка інженером.",
            rawSnippet=None,
        )
        service = NormsService(
            provider=MockNormsSearchProvider(default_result=unverified_raw)
        )
        result = await service.lookup(NormLookupRequest(query="невідома вимога"))

        self.assertEqual(result.status, NormVerificationStatus.needs_verification)
        self.assertIsNone(result.clause)
        self.assertIsNone(result.document)
        self.assertIn("ручна перевірка", result.summary)

        # Also test candidate with status found_in_official_source but empty clause
        empty_clause_raw = NormLookupResult.model_construct(
            document="ДБН В.2.5-56:2014",
            clause="",
            value=None,
            sourceUrl="https://zakon.rada.gov.ua/laws/show/z1128-14",
            checkedAt=datetime.now(UTC),
            status=NormVerificationStatus.found_in_official_source,
            summary="Пункт відсутній",
        )
        service_empty = NormsService(
            provider=MockNormsSearchProvider(default_result=empty_clause_raw)
        )
        res_empty = await service_empty.lookup(
            NormLookupRequest(query="порожній пункт")
        )
        self.assertEqual(res_empty.status, NormVerificationStatus.needs_verification)
        self.assertIsNone(res_empty.clause)

    # --------------------------------------------------------------------------
    # Test 5: Cache prevents repeated outbound calls for identical queries
    # --------------------------------------------------------------------------
    async def test_cache_prevents_repeated_outbound_calls(self) -> None:
        """In-memory cache serves identical queries without invoking provider twice."""
        valid_result = NormLookupResult(
            document="ДБН В.2.5-56:2014",
            clause="Таблиця А.1",
            value="85 м²",
            sourceUrl="https://budstandart.ua/doc/dbn-v-2-5-56-2014",
            checkedAt=datetime.now(UTC),
            status=NormVerificationStatus.found_in_official_source,
            summary="Перевірено з кешуванням",
        )
        mock_provider = MockNormsSearchProvider(default_result=valid_result)
        service = NormsService(provider=mock_provider, cache_ttl_seconds=300.0)

        request = NormLookupRequest(
            query="  димовий сповіщувач площа  ",
            context=NormLookupContext(roomHeight=3.0),
        )

        # First call: hits provider
        res1 = await service.lookup(request)
        self.assertEqual(mock_provider.call_count, 1)
        self.assertEqual(res1.clause, "Таблиця А.1")

        # Second call: identical query (with different whitespace formatting)
        identical_request = NormLookupRequest(
            query="димовий  сповіщувач  площа",
            context=NormLookupContext(roomHeight=3.0),
        )
        res2 = await service.lookup(identical_request)
        # Call count must still be 1 (served from cache)
        self.assertEqual(mock_provider.call_count, 1)
        self.assertEqual(res2.clause, "Таблиця А.1")

        # Third call with different query: must trigger provider
        different_request = NormLookupRequest(query="тепловий сповіщувач відстань")
        res3 = await service.lookup(different_request)
        self.assertEqual(mock_provider.call_count, 2)
        self.assertEqual(res3.clause, "Таблиця А.1")

    # --------------------------------------------------------------------------
    # Extra Test 6: Cache TTL expiration
    # --------------------------------------------------------------------------
    async def test_cache_ttl_expiration(self) -> None:
        """Expired cache entries trigger a fresh provider lookup."""
        valid_result = NormLookupResult(
            document="ДБН В.2.5-56:2014",
            clause="Таблиця А.1",
            value="85 м²",
            sourceUrl="https://zakon.rada.gov.ua/laws/show/z1128-14",
            checkedAt=datetime.now(UTC),
            status=NormVerificationStatus.found_in_official_source,
            summary="Тест TTL",
        )
        mock_provider = MockNormsSearchProvider(default_result=valid_result)
        # TTL of 0.01 seconds
        service = NormsService(provider=mock_provider, cache_ttl_seconds=0.01)

        req = NormLookupRequest(query="тест ttl запит")
        await service.lookup(req)
        self.assertEqual(mock_provider.call_count, 1)

        # Wait for TTL to expire
        import asyncio

        await asyncio.sleep(0.02)

        await service.lookup(req)
        self.assertEqual(mock_provider.call_count, 2)

    # --------------------------------------------------------------------------
    # Extra Test 7: Domain-restricted query builder
    # --------------------------------------------------------------------------
    def test_domain_restricted_query_builder(self) -> None:
        """Query builder incorporates official domains filter and active standards."""
        query = "відстань між димовими сповіщувачами"
        context = NormLookupContext(
            detectorType="smoke_detector",
            roomHeight=3.5,
            roomArea=80.0,
            roomType="office",
        )

        formatted = build_domain_restricted_query(query, context)

        # Must contain query and context tokens
        self.assertIn("відстань між димовими сповіщувачами", formatted)
        self.assertIn('"smoke_detector"', formatted)
        self.assertIn("висота 3.5м", formatted)
        self.assertIn("площа 80.0м2", formatted)
        self.assertIn('"office"', formatted)

        # Must enforce active standards
        for std in PRIMARY_ACTIVE_STANDARDS:
            self.assertIn(std, formatted)

        # Must enforce official domains filter
        self.assertIn(OFFICIAL_DOMAINS_SEARCH_FILTER, formatted)
        self.assertIn("site:zakon.rada.gov.ua", formatted)
        self.assertIn("site:dsns.gov.ua", formatted)
        self.assertIn("site:budstandart.ua", formatted)

    # --------------------------------------------------------------------------
    # Extra Test 8: LLM provider dry-run mode when API key is missing
    # --------------------------------------------------------------------------
    async def test_llm_provider_dry_run_mode(self) -> None:
        """Provider gracefully operates in dry-run mode when no API keys are present."""
        with patch.dict("os.environ", {}, clear=True):
            provider = LLMDomainRestrictedSearchProvider(api_key=None, dry_run=True)
            request = NormLookupRequest(query="висота монтажу ручного сповіщувача")
            result = await provider.lookup(request)

            self.assertEqual(result.status, NormVerificationStatus.needs_verification)
            self.assertIsNone(result.clause)
            self.assertIsNone(result.document)
            self.assertIsNone(result.sourceUrl)
            self.assertIn("dry-run", result.summary)

    # --------------------------------------------------------------------------
    # Extra Test 9: LLM provider with mocked async caller (no network calls)
    # --------------------------------------------------------------------------
    async def test_llm_provider_with_mocked_caller(self) -> None:
        """LLMDomainRestrictedSearchProvider parses JSON from LLM caller correctly."""
        llm_response_json = """```json
        {
            "document": "ДБН В.2.5-56:2014",
            "clause": "Пункт 6.2.22",
            "value": "1.4 м",
            "sourceUrl": "https://zakon.rada.gov.ua/laws/show/z1128-14",
            "status": "found_in_official_source",
            "summary": "Ручні пожежні сповіщувачі слід встановлювати на висоті 1,4 м.",
            "rawSnippet": "Пункт 6.2.22 — висота (1,4 ± 0,1) м від рівня підлоги."
        }
        ```"""

        async def fake_caller(sys_prompt: str, usr_prompt: str) -> str:
            self.assertIn("суворий нормативний експерт", sys_prompt)
            self.assertIn("Запит інженера", usr_prompt)
            return llm_response_json

        provider = LLMDomainRestrictedSearchProvider(
            api_key="mock-key",
            llm_caller=fake_caller,
            dry_run=False,
        )
        service = NormsService(provider=provider)
        request = NormLookupRequest(query="висота встановлення ручного сповіщувача")

        result = await service.lookup(request)

        self.assertEqual(result.status, NormVerificationStatus.found_in_official_source)
        self.assertEqual(result.document, "ДБН В.2.5-56:2014")
        self.assertEqual(result.clause, "Пункт 6.2.22")
        self.assertEqual(result.value, "1.4 м")
        self.assertEqual(
            result.sourceUrl, "https://zakon.rada.gov.ua/laws/show/z1128-14"
        )
        self.assertIn("1,4 м", result.summary)

    # --------------------------------------------------------------------------
    # Extra Test 10: Disallowed acronyms in clause are sanitized
    # --------------------------------------------------------------------------
    def test_guard_rejects_disallowed_acronym_in_clause(self) -> None:
        """Disallowed standards in clause (e.g. ГОСТ) are sanitized and stripped."""
        raw = NormLookupResult.model_construct(
            document="ДБН В.2.5-56:2014",
            clause="Згідно ГОСТ 12.1.004-91",
            value="10",
            sourceUrl="https://zakon.rada.gov.ua/laws/show/z1128-14",
            checkedAt=datetime.now(UTC),
            status=NormVerificationStatus.found_in_official_source,
            summary="Посилання на радянський ГОСТ у пункті",
        )
        sanitized = sanitize_and_verify_result(raw)
        self.assertEqual(sanitized.status, NormVerificationStatus.needs_verification)
        self.assertIsNone(sanitized.clause)
        self.assertIsNone(sanitized.document)
        self.assertIsNone(sanitized.sourceUrl)


if __name__ == "__main__":
    unittest.main()
