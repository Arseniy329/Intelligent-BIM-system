"""Regression tests reproducing P1 & P2 defects for BIM-163.

Demonstrates:
1. False verification: fictional URL on allowed domain without active standard.
2. Settings isolation: settings must propagate to provider without relying on os.getenv.
3. Access control & bounds: anonymous requests return 401; query > 500 returns 422.
"""

from __future__ import annotations

import json
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

import httpx  # noqa: E402
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
from src.services.norms.service import (  # noqa: E402
    NormsService,
    get_norms_service,
    reset_norms_rate_limiter,
    reset_norms_service,
)


class TestNormsRegression(unittest.IsolatedAsyncioTestCase):
    """Regression test suite for PR code review findings."""

    def setUp(self) -> None:
        reset_norms_service()
        reset_norms_rate_limiter()
        self.mock_supabase = MagicMock()
        app.dependency_overrides[get_supabase_client] = lambda: self.mock_supabase
        self.client = TestClient(app)

    def tearDown(self) -> None:
        reset_norms_service()
        reset_norms_rate_limiter()
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

    # --------------------------------------------------------------------------
    # Regression Test 4: Sophisticated Fake URL/Quote Test (Review P1)
    # --------------------------------------------------------------------------
    async def test_sophisticated_fake_url_quote_downgrades_to_needs_verification(
        self,
    ) -> None:
        """A valid active standard with fake URL on whitelisted domain and long quote

        must be downgraded to needs_verification with clause=None and sourceUrl=None
        because without independent retrieval verification, LLM self-attestations
        cannot be trusted.
        """
        fake_raw = NormLookupResult.model_construct(
            document="ДБН В.2.5-56:2014",
            clause="Таблиця А.1",
            value="до 85 м²",
            sourceUrl="https://zakon.rada.gov.ua/does-not-exist-review-fixture",
            checkedAt=datetime.now(UTC),
            status=NormVerificationStatus.found_in_official_source,
            summary="Вигадана цитата з чинного нормативу.",
            rawSnippet="Це повністю вигадана цитата для регресійного тесту.",
        )
        mock_provider = MockNormsSearchProvider(default_result=fake_raw)
        service = NormsService(provider=mock_provider)

        req = NormLookupRequest(query="яка площа димового сповіщувача")
        result = await service.lookup(req)

        self.assertEqual(result.status, NormVerificationStatus.needs_verification)
        self.assertIsNone(result.clause)
        self.assertIsNone(result.sourceUrl)

    # --------------------------------------------------------------------------
    # Regression Test 5: Multi-HTTP Request Cache Test (Review P2)
    # --------------------------------------------------------------------------
    def test_multi_http_request_caching_across_requests(self) -> None:
        """Two identical HTTP requests hit cache; call provider.lookup once.

        Proves that NormsService maintains its cache singleton across HTTP requests
        without get_norms_service being replaced in app.dependency_overrides.
        """
        from src.core.auth import CurrentUser, get_current_user

        reset_norms_service()

        app.dependency_overrides[get_current_user] = lambda: CurrentUser(
            id="cache-user-id", email="engineer@example.com"
        )

        service = get_norms_service()
        service.verified_retrieval = True
        call_count = 0
        verified_result = NormLookupResult(
            document="ДБН В.2.5-56:2014",
            clause="Таблиця А.1",
            value="85 м²",
            sourceUrl="https://dsns.gov.ua/test",
            checkedAt=datetime.now(UTC),
            status=NormVerificationStatus.found_in_official_source,
            summary="Перевірено з кешуванням",
            rawSnippet="Таблиця А.1 площа 85 м².",
        )

        async def spy_lookup(request: NormLookupRequest) -> NormLookupResult:
            nonlocal call_count
            call_count += 1
            return verified_result

        service.provider.lookup = spy_lookup  # type: ignore[method-assign]

        payload = {"query": "площа димового сповіщувача при висоті 3.5 м"}
        res1 = self.client.post("/api/v1/norms/lookup", json=payload)
        self.assertEqual(res1.status_code, 200)

        res2 = self.client.post("/api/v1/norms/lookup", json=payload)
        self.assertEqual(res2.status_code, 200)

        self.assertEqual(call_count, 1)

    # --------------------------------------------------------------------------
    # Regression Test 6: Per-User Rate Limit Test (Review P2)
    # --------------------------------------------------------------------------
    def test_per_user_rate_limit_exceeded_returns_429(self) -> None:
        """11 consecutive requests from the same user must return 429 on req 11."""
        from src.core.auth import CurrentUser, get_current_user

        app.dependency_overrides[get_current_user] = lambda: CurrentUser(
            id="spammy-user-id", email="spam@example.com"
        )
        service = get_norms_service()
        stub_res = NormLookupResult(
            document=None,
            clause=None,
            value=None,
            sourceUrl=None,
            checkedAt=datetime.now(UTC),
            status=NormVerificationStatus.needs_verification,
            summary="Stub",
            rawSnippet=None,
        )

        async def fast_stub(req: NormLookupRequest) -> NormLookupResult:
            return stub_res

        service.provider.lookup = fast_stub  # type: ignore[method-assign]

        for i in range(1, 11):
            res = self.client.post(
                "/api/v1/norms/lookup",
                json={"query": f"норми запит номер {i}"},
            )
            self.assertEqual(
                res.status_code,
                200,
                f"Request {i} failed unexpectedly with status {res.status_code}",
            )

        res_limit = self.client.post(
            "/api/v1/norms/lookup",
            json={"query": "норми запит номер 11"},
        )
        self.assertEqual(res_limit.status_code, 429)
        self.assertIn("Перевищено ліміт", res_limit.json().get("detail", ""))

    # --------------------------------------------------------------------------
    # Regression Test 7: Resilient JSON Parsing & Aliases
    # --------------------------------------------------------------------------
    def test_parse_llm_json_response_resilience(self) -> None:
        """Tests parsing with markdown fences, conversational prose, and alias keys."""
        from src.services.norms.provider import parse_llm_json_response

        # Markdown fences with json tag
        fenced = (
            "```json\n"
            "{\"document\": \"ДБН В.2.5-56:2014\", \"clause\": \"6.2.23\"}\n"
            "```"
        )
        self.assertEqual(
            parse_llm_json_response(fenced).get("document"),
            "ДБН В.2.5-56:2014",
        )

        # Surrounding conversational prose
        prose = (
            "Ось норма згідно з реєстром:\n"
            "{\"document\": \"ДСТУ EN 54\", \"clause\": \"5.1\", "
            "\"source_url\": \"https://zakon.rada.gov.ua/test\", "
            "\"raw_snippet\": \"цитата\"}\n"
            "Зверніть увагу на обмеження."
        )
        parsed = parse_llm_json_response(prose)
        self.assertEqual(parsed.get("document"), "ДСТУ EN 54")
        self.assertEqual(parsed.get("sourceUrl"), "https://zakon.rada.gov.ua/test")
        self.assertEqual(parsed.get("rawSnippet"), "цитата")

    # --------------------------------------------------------------------------
    # Regression Test 8: Unverified Responses Are NOT Stored In Cache
    # --------------------------------------------------------------------------
    async def test_unverified_responses_not_cached(self) -> None:
        """Failed or unverified lookups must not be cached."""
        call_count = 0
        unverified_result = NormLookupResult(
            document=None,
            clause=None,
            value=None,
            sourceUrl=None,
            checkedAt=datetime.now(UTC),
            status=NormVerificationStatus.needs_verification,
            summary="Не знайдено.",
            rawSnippet=None,
        )

        async def counting_lookup(req: NormLookupRequest) -> NormLookupResult:
            nonlocal call_count
            call_count += 1
            return unverified_result

        mock_provider = MockNormsSearchProvider(handler=counting_lookup)
        service = NormsService(provider=mock_provider)

        req = NormLookupRequest(query="шо ти вмієш?")
        res1 = await service.lookup(req)
        self.assertEqual(res1.status, NormVerificationStatus.needs_verification)
        self.assertEqual(call_count, 1)
        self.assertEqual(service.cache_size, 0)

        # Second identical request must re-query provider because not cached
        res2 = await service.lookup(req)
        self.assertEqual(res2.status, NormVerificationStatus.needs_verification)
        self.assertEqual(call_count, 2)

    # --------------------------------------------------------------------------
    # Regression Test 9: Provider URL Normalization
    # --------------------------------------------------------------------------
    def test_normalize_provider_url(self) -> None:
        """Validates provider URL normalization appends /chat/completions."""
        from src.services.norms.provider import normalize_provider_url

        self.assertEqual(
            normalize_provider_url(
                "https://generativelanguage.googleapis.com/v1beta/openai/"
            ),
            "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        )
        self.assertEqual(
            normalize_provider_url(
                "https://generativelanguage.googleapis.com/v1beta/openai"
            ),
            "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        )
        self.assertEqual(
            normalize_provider_url(
                "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
            ),
            "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        )
        self.assertEqual(
            normalize_provider_url("https://api.openai.com/v1/"),
            "https://api.openai.com/v1/chat/completions",
        )
        self.assertEqual(
            normalize_provider_url(""),
            "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        )
        self.assertEqual(
            normalize_provider_url(None),
            "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        )

    # --------------------------------------------------------------------------
    # Regression Test 10: Non-JSON Response (Plain 'OK') Does Not Crash
    # --------------------------------------------------------------------------
    async def test_non_json_plain_text_response_handled_cleanly(self) -> None:
        """Provider returning text 'OK' must be handled without JSONDecodeError."""
        def plain_text_transport(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                status_code=200,
                headers={"Content-Type": "text/plain"},
                text="OK\r\n",
            )

        client = httpx.AsyncClient(
            transport=httpx.MockTransport(plain_text_transport)
        )
        provider = LLMDomainRestrictedSearchProvider(
            api_key="mock-key",
            base_url="https://models.github.ai/inference/chat/completions",
            http_client=client,
        )
        result = await provider.lookup(NormLookupRequest(query="шо ти вмієш?"))
        self.assertEqual(result.status, NormVerificationStatus.needs_verification)
        self.assertNotIn("JSONDecodeError", result.summary)
        self.assertIn("не у форматі JSON", result.summary)

    # --------------------------------------------------------------------------
    # Regression Test 11: Issue 3 - Suffix-Only Prose & Raw Decode Policies
    # --------------------------------------------------------------------------
    def test_parse_llm_json_response_suffix_prose_and_policies(self) -> None:
        """Reproduces Issue 3: Suffix-only prose, surrounding text, and multi-object."""
        from src.services.norms.provider import parse_llm_json_response

        # Suffix-only prose (starts with '{' but ends with commentary)
        suffix_text = '{"summary":"ok"}\nПотрібна ручна перевірка.'
        res_suffix = parse_llm_json_response(suffix_text)
        self.assertEqual(res_suffix.get("summary"), "ok")

        # Surrounding prose (both leading and trailing commentary)
        surrounding_text = (
            "Ось відповідь експерта:\n"
            '{"document": "ДБН В.2.5-56:2014", "clause": "1.1"}\n'
            "Зверніть увагу на виноску."
        )
        res_surr = parse_llm_json_response(surrounding_text)
        self.assertEqual(res_surr.get("document"), "ДБН В.2.5-56:2014")
        self.assertEqual(res_surr.get("clause"), "1.1")

        # Code fence with trailing commentary
        fenced_with_trailing = (
            "```json\n"
            '{"document": "ДСТУ EN 54", "source_url": "https://zakon.rada.gov.ua"}\n'
            "```\n"
            "Додаткова інформація відсутня."
        )
        res_fence = parse_llm_json_response(fenced_with_trailing)
        self.assertEqual(res_fence.get("document"), "ДСТУ EN 54")
        self.assertEqual(res_fence.get("sourceUrl"), "https://zakon.rada.gov.ua")

        # Ambiguous multiple JSON objects: policy must reject cleanly to {}
        multi_objects = '{"a": 1} {"b": 2}'
        self.assertEqual(parse_llm_json_response(multi_objects), {})

        # Non-string / null / empty inputs
        self.assertEqual(parse_llm_json_response(None), {})  # type: ignore[arg-type]
        self.assertEqual(parse_llm_json_response(""), {})
        self.assertEqual(parse_llm_json_response("   "), {})

    # --------------------------------------------------------------------------
    # Regression Test 12: Issue 2 - Envelope Guard & Message Content Types
    # --------------------------------------------------------------------------
    async def test_envelope_guard_and_content_types(self) -> None:
        """Reproduces Issue 2: content=null, content=[], choices=[], bad envelopes."""
        cases = [
            # 1. content is None (e.g. model refusal or empty generation)
            ({"choices": [{"message": {"content": None}}]}, "null_content"),
            # 2. content is a list (e.g. multi-modal response parts)
            ({"choices": [{"message": {"content": []}}]}, "list_content"),
            # 3. content is empty string
            ({"choices": [{"message": {"content": ""}}]}, "empty_content"),
            # 4. choices is empty list
            ({"choices": []}, "empty_choices"),
            # 5. envelope is not a dict
            ([{"choices": []}], "envelope_not_dict"),
            # 6. choices[0] is not a dict
            ({"choices": [None]}, "choice_not_dict"),
            # 7. message is not a dict
            ({"choices": [{"message": None}]}, "message_not_dict"),
        ]

        for payload, label in cases:
            transport = httpx.MockTransport(
                lambda req, p=payload: httpx.Response(200, json=p)  # type: ignore[misc]
            )
            client = httpx.AsyncClient(transport=transport)
            provider = LLMDomainRestrictedSearchProvider(
                api_key="mock-key",
                http_client=client,
            )
            result = await provider.lookup(NormLookupRequest(query=f"тест {label}"))
            self.assertEqual(
                result.status,
                NormVerificationStatus.needs_verification,
                f"Failed for case: {label}",
            )
            self.assertIsNone(result.document)
            self.assertIsNone(result.clause)
            self.assertNotIn("AttributeError", result.summary)
            self.assertNotIn("IndexError", result.summary)

    # --------------------------------------------------------------------------
    # Regression Test 13: Issue 1 - Transport Outgoing Request & Model Assertion
    # --------------------------------------------------------------------------
    async def test_transport_outgoing_request_and_model_assertion(self) -> None:
        """Asserts actual outgoing HTTP URL, Authorization header, and payload model."""
        recorded_requests: list[httpx.Request] = []

        def recording_transport(req: httpx.Request) -> httpx.Response:
            recorded_requests.append(req)
            return httpx.Response(
                200,
                json={
                    "choices": [
                        {
                            "message": {
                                "content": json.dumps(
                                    {
                                        "document": "ДБН В.2.5-56:2014",
                                        "clause": "6.2.23",
                                        "value": "85 м²",
                                        "sourceUrl": "https://dsns.gov.ua/norm",
                                        "status": "found_in_official_source",
                                        "summary": "Перевірено.",
                                        "rawSnippet": "Таблиця А.1 площа 85 м²",
                                    }
                                )
                            }
                        }
                    ]
                },
            )

        client = httpx.AsyncClient(transport=httpx.MockTransport(recording_transport))

        # 1. Test Default Settings
        with patch.dict(
            os.environ,
            {
                "SUPABASE_URL": "https://mock.supabase.co",
                "SUPABASE_SERVICE_ROLE_KEY": "mock-key",
                "NORMS_SEARCH_API_KEY": "test-gemini-key",
            },
            clear=True,
        ):
            default_settings = Settings(_env_file=None)
            provider_default = LLMDomainRestrictedSearchProvider(
                api_key=default_settings.NORMS_SEARCH_API_KEY,
                base_url=default_settings.NORMS_SEARCH_PROVIDER_URL,
                model=default_settings.NORMS_SEARCH_MODEL,
                http_client=client,
            )
            await provider_default.lookup(NormLookupRequest(query="запит 1"))
            self.assertEqual(len(recorded_requests), 1)
            req1 = recorded_requests[0]
            self.assertEqual(
                str(req1.url),
                "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
            )
            self.assertEqual(req1.headers["Authorization"], "Bearer test-gemini-key")
            body1 = json.loads(req1.content.decode("utf-8"))
            self.assertEqual(body1["model"], "gemini-2.5-flash")

        # 2. Test URL without /chat/completions and trailing slash
        provider_slash = LLMDomainRestrictedSearchProvider(
            api_key="test-gemini-key",
            base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
            http_client=client,
        )
        await provider_slash.lookup(NormLookupRequest(query="запит 2"))
        self.assertEqual(len(recorded_requests), 2)
        req2 = recorded_requests[1]
        self.assertEqual(
            str(req2.url),
            "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        )

        # 3. Test Custom Settings
        custom_settings = Settings(
            SUPABASE_URL="https://mock.supabase.co",
            SUPABASE_SERVICE_ROLE_KEY="mock-key",
            NORMS_SEARCH_API_KEY="custom-api-key",
            NORMS_SEARCH_PROVIDER_URL="https://custom.provider.ai/v1",
            NORMS_SEARCH_MODEL="custom-llm-v2",
        )
        provider_custom = LLMDomainRestrictedSearchProvider(
            api_key=custom_settings.NORMS_SEARCH_API_KEY,
            base_url=custom_settings.NORMS_SEARCH_PROVIDER_URL,
            model=custom_settings.NORMS_SEARCH_MODEL,
            http_client=client,
        )
        await provider_custom.lookup(NormLookupRequest(query="запит 3"))
        self.assertEqual(len(recorded_requests), 3)
        req3 = recorded_requests[2]
        self.assertEqual(
            str(req3.url),
            "https://custom.provider.ai/v1/chat/completions",
        )
        self.assertEqual(req3.headers["Authorization"], "Bearer custom-api-key")
        body3 = json.loads(req3.content.decode("utf-8"))
        self.assertEqual(body3["model"], "custom-llm-v2")


if __name__ == "__main__":
    unittest.main()
