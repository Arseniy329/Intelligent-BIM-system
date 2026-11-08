"""Search and LLM provider architecture for Ukrainian norms lookup (BIM-163).

Defines:
- BaseNormsSearchProvider: Abstract base class for search providers.
- LLMDomainRestrictedSearchProvider: Concrete provider formulating domain-scoped
  queries restricted exclusively to official Ukrainian registries and prompting
  LLM in Ukrainian.
- MockNormsSearchProvider: Deterministic provider for unit testing without
  external network calls.
"""

from __future__ import annotations

import json
import logging
import re
from abc import ABC, abstractmethod
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime

import httpx

from src.contracts.norms import (
    NormLookupContext,
    NormLookupRequest,
    NormLookupResult,
    NormVerificationStatus,
)

logger = logging.getLogger(__name__)

# Search operators scoped exclusively to official Ukrainian portals & registers
OFFICIAL_DOMAINS_SEARCH_FILTER: str = (
    "site:zakon.rada.gov.ua OR site:dsns.gov.ua OR site:minregion.gov.ua "
    "OR site:budstandart.ua OR site:e-construction.gov.ua"
)

# Primary active fire safety standards in Ukraine
PRIMARY_ACTIVE_STANDARDS: tuple[str, ...] = (
    "ДБН В.2.5-56:2014",
    "ДСТУ EN 54",
    "ДБН В.1.1-7:2016",
)

# System prompt in Ukrainian enforcing strict verification against official standards
UKRAINIAN_NORMS_SYSTEM_PROMPT: str = (
    "Ти — суворий нормативний експерт та аудитор з пожежної безпеки України.\n"
    "Твоє завдання: перевірити запит інженера виключно за чинними нормами України "
    "(ДБН В.2.5-56:2014, ДСТУ EN 54, ДБН В.1.1-7:2016) з офіційних державних джерел "
    "(zakon.rada.gov.ua, dsns.gov.ua, minregion.gov.ua, budstandart.ua, "
    "e-construction.gov.ua, diam.gov.ua).\n\n"
    "СУВОРІ ОБМЕЖЕННЯ ТА ПРАВИЛА:\n"
    "1. КАТЕГОРИЧНО ЗАБОРОНЕНО цитувати або посилатися на радянські та російські "
    "нормативи: СНиП, СНИП, SNiP, НПБ, NPB, ГОСТ, GOST, ВНПБ, ВСН або ресурси "
    "в доменах .ru, .su, .рф. Будь-яке таке посилання є неприпустимим.\n"
    "2. Якщо точний пункт та документ не відомі з 100% достовірністю на основі "
    "офіційного тексту чинного українського нормативу, обов'язково встанови "
    'status = "needs_verification", clause = null, sourceUrl = null.\n'
    "3. НІКОЛИ не вигадуй номер пункту, таблиці або вимогу.\n"
    "4. Для статусу 'found_in_official_source' ОБОВ'ЯЗКОВО надай точну цитату "
    "з тексту офіційного нормативу в полі 'rawSnippet' (не менше 10 символів). "
    "Без перевіреної цитати самосертифікація заборонена — встанови "
    "'needs_verification'.\n"
    "5. Відповідь надай СТРОГО у валідному форматі JSON без зайвого тексту:\n"
    "{\n"
    '  "document": "назва чинного українського нормативу або null",\n'
    '  "clause": "номер пункту чи таблиці або null",\n'
    '  "value": "числове значення або вимога (або null)",\n'
    '  "sourceUrl": "прямий URL на офіційне українське джерело або null",\n'
    '  "status": "found_in_official_source" або "needs_verification",\n'
    '  "summary": "стисле резюме українською мовою",\n'
    '  "rawSnippet": "точна цитата з офіційного нормативу або null"\n'
    "}"
)


def build_domain_restricted_query(
    query: str,
    context: NormLookupContext | None = None,
) -> str:
    """Builds a targeted search query scoped exclusively to official Ukrainian domains.

    Combines:
    - User query keywords and structured context (detectorType, roomHeight, etc.)
    - Active standards: ДБН В.2.5-56:2014, ДСТУ EN 54, ДБН В.1.1-7:2016
    - Targeted domain restriction filter for Ukrainian government registers.
    """
    clean_query = query.strip()

    context_tokens: list[str] = []
    if context:
        if context.detectorType:
            context_tokens.append(f'"{context.detectorType}"')
        if context.roomHeight is not None:
            context_tokens.append(f"висота {context.roomHeight}м")
        if context.roomArea is not None:
            context_tokens.append(f"площа {context.roomArea}м2")
        if context.roomType:
            context_tokens.append(f'"{context.roomType}"')
        if context.buildingType:
            context_tokens.append(f'"{context.buildingType}"')

    standards_filter = " OR ".join(f'"{s}"' for s in PRIMARY_ACTIVE_STANDARDS)

    query_parts: list[str] = [clean_query]
    if context_tokens:
        query_parts.append(" ".join(context_tokens))
    query_parts.append(f"({standards_filter})")
    query_parts.append(f"({OFFICIAL_DOMAINS_SEARCH_FILTER})")

    return " ".join(query_parts)


def parse_llm_json_response(raw_text: str) -> dict[str, object]:
    """Safely extracts and parses JSON payload from LLM response text."""
    text = raw_text.strip()
    # Strip markdown code fences if present (e.g. ```json ... ```)
    if "```" in text:
        match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
        if match:
            text = match.group(1).strip()
        else:
            text = re.sub(r"^```(?:json)?\s*", "", text)
            text = re.sub(r"\s*```$", "", text)
            text = text.strip()

    try:
        data = json.loads(text)
        if isinstance(data, dict):
            return data
    except json.JSONDecodeError:
        pass
    return {}


class BaseNormsSearchProvider(ABC):
    """Abstract base provider for Ukrainian fire safety norms lookup."""

    verified_retrieval: bool = False

    @abstractmethod
    async def lookup(self, request: NormLookupRequest) -> NormLookupResult:
        """Looks up norms and returns candidate NormLookupResult."""
        ...


class LLMDomainRestrictedSearchProvider(BaseNormsSearchProvider):
    """Concrete provider using domain-restricted search query and LLM reasoning.

    Key safety design:
    - Never uses hardcoded credentials; resolves API keys strictly via env vars.
    - If credentials are absent, falls back to dry-run/stub mode without crashing.
    - Formulates targeted queries scoped exclusively to official Ukrainian registries.
    - Prompts LLM in Ukrainian with zero tolerance for Soviet/Russian standards.
    - Produces raw candidate via model_construct allowing downstream guard to sanitize.
    """

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
        model: str = "gpt-4o-mini",
        http_client: httpx.AsyncClient | None = None,
        llm_caller: Callable[[str, str], Awaitable[str]] | None = None,
        dry_run: bool = False,
    ) -> None:
        self.api_key: str | None = api_key
        self.base_url: str | None = base_url
        self.model: str = model
        self.http_client: httpx.AsyncClient | None = http_client
        self.llm_caller: Callable[[str, str], Awaitable[str]] | None = llm_caller
        self.dry_run: bool = dry_run or not bool(
            self.api_key or self.llm_caller or self.http_client
        )

    async def lookup(self, request: NormLookupRequest) -> NormLookupResult:
        """Executes targeted query and returns candidate norm result."""
        now_utc = datetime.now(UTC)

        # 1. Stub / Dry-Run Mode when external credentials are not configured
        if self.dry_run:
            logger.info("LLMDomainRestrictedSearchProvider running in dry-run mode")
            return NormLookupResult(
                document=None,
                clause=None,
                value=None,
                sourceUrl=None,
                checkedAt=now_utc,
                status=NormVerificationStatus.needs_verification,
                summary=(
                    "Пошуковий агент працює в режимі без API-ключа (dry-run/stub). "
                    "Встановіть змінну NORMS_SEARCH_API_KEY для виконання запитів. "
                    "Потрібна ручна верифікація інженером."
                ),
                rawSnippet=None,
            )

        # 2. Build targeted domain-scoped search query
        scoped_query = build_domain_restricted_query(request.query, request.context)
        user_prompt = (
            f"Запит інженера: {request.query}\n"
            f"Формульований пошуковий фільтр: {scoped_query}\n"
            "Знайди точну норму в чинних реєстрах України та надай відповідь JSON."
        )

        raw_response_text = ""
        try:
            if self.llm_caller:
                raw_response_text = await self.llm_caller(
                    UKRAINIAN_NORMS_SYSTEM_PROMPT, user_prompt
                )
            elif self.http_client:
                url = self.base_url or "https://api.openai.com/v1/chat/completions"
                headers = {"Authorization": f"Bearer {self.api_key or ''}"}
                payload = {
                    "model": self.model,
                    "messages": [
                        {"role": "system", "content": UKRAINIAN_NORMS_SYSTEM_PROMPT},
                        {"role": "user", "content": user_prompt},
                    ],
                    "temperature": 0.0,
                }
                resp = await self.http_client.post(url, headers=headers, json=payload)
                resp.raise_for_status()
                data = resp.json()
                raw_response_text = (
                    data.get("choices", [{}])[0]
                    .get("message", {})
                    .get("content", "")
                )
            else:
                url = self.base_url or "https://api.openai.com/v1/chat/completions"
                headers = {"Authorization": f"Bearer {self.api_key or ''}"}
                payload = {
                    "model": self.model,
                    "messages": [
                        {"role": "system", "content": UKRAINIAN_NORMS_SYSTEM_PROMPT},
                        {"role": "user", "content": user_prompt},
                    ],
                    "temperature": 0.0,
                }
                async with httpx.AsyncClient(timeout=15.0) as client:
                    resp = await client.post(url, headers=headers, json=payload)
                    resp.raise_for_status()
                    data = resp.json()
                    raw_response_text = (
                        data.get("choices", [{}])[0]
                        .get("message", {})
                        .get("content", "")
                    )
        except Exception as exc:
            logger.warning("LLM provider execution failed: %s", exc)
            return NormLookupResult(
                document=None,
                clause=None,
                value=None,
                sourceUrl=None,
                checkedAt=now_utc,
                status=NormVerificationStatus.needs_verification,
                summary=(
                    f"Помилка зв'язку з провайдером норм ({exc.__class__.__name__}). "
                    "Потрібна ручна верифікація інженером."
                ),
                rawSnippet=None,
            )

        # 3. Parse JSON response into candidate NormLookupResult
        parsed = parse_llm_json_response(raw_response_text)
        if not parsed:
            return NormLookupResult(
                document=None,
                clause=None,
                value=None,
                sourceUrl=None,
                checkedAt=now_utc,
                status=NormVerificationStatus.needs_verification,
                summary=(
                    "Провайдер повернув неструктуровану або нерозпізнану відповідь. "
                    "Потрібна ручна верифікація інженером."
                ),
                rawSnippet=raw_response_text[:300] if raw_response_text else None,
            )

        doc = parsed.get("document")
        clause = parsed.get("clause")
        value = parsed.get("value")
        source_url = parsed.get("sourceUrl")
        summary = str(parsed.get("summary") or "Вимогу опрацьовано провайдером.")
        snippet = parsed.get("rawSnippet")

        status_str = str(parsed.get("status") or "")
        if status_str == NormVerificationStatus.found_in_official_source.value:
            status = NormVerificationStatus.found_in_official_source
        else:
            status = NormVerificationStatus.needs_verification

        # Use model_construct to create raw candidate so downstream guard can inspect
        # and sanitize any disallowed standards without early validation crash.
        raw_val: str | float | int | None = None
        if isinstance(value, (str, float, int)):
            raw_val = value
        elif value is not None:
            raw_val = str(value)

        return NormLookupResult.model_construct(
            document=str(doc) if doc is not None else None,
            clause=str(clause) if clause is not None else None,
            value=raw_val,
            sourceUrl=str(source_url) if source_url is not None else None,
            checkedAt=now_utc,
            status=status,
            summary=summary,
            rawSnippet=str(snippet) if snippet is not None else None,
        )


MockHandlerType = Callable[
    [NormLookupRequest], Awaitable[NormLookupResult] | NormLookupResult
]


class MockNormsSearchProvider(BaseNormsSearchProvider):
    """Deterministic mock provider for unit testing without outbound calls."""

    def __init__(
        self,
        handler: MockHandlerType | None = None,
        default_result: NormLookupResult | None = None,
        verified_retrieval: bool = False,
    ) -> None:
        self.handler: MockHandlerType | None = handler
        self.default_result: NormLookupResult | None = default_result
        self.verified_retrieval: bool = verified_retrieval
        self.call_count: int = 0
        self.last_request: NormLookupRequest | None = None

    async def lookup(self, request: NormLookupRequest) -> NormLookupResult:
        self.call_count += 1
        self.last_request = request
        if self.handler:
            res = self.handler(request)
            if hasattr(res, "__await__"):
                return await res  # type: ignore[no-any-return]
            return res  # type: ignore[return-value]
        if self.default_result:
            return self.default_result
        return NormLookupResult(
            document=None,
            clause=None,
            value=None,
            sourceUrl=None,
            checkedAt=datetime.now(UTC),
            status=NormVerificationStatus.needs_verification,
            summary="Mock default unverified response.",
            rawSnippet=None,
        )
