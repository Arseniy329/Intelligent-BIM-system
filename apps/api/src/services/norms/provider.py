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


def normalize_provider_url(raw_url: str | None) -> str:
    """Normalizes the LLM provider URL ensuring a valid chat completions endpoint."""
    if not raw_url or not raw_url.strip():
        return (
            "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
        )
    url = raw_url.strip().rstrip("/")
    if url.endswith("/chat/completions"):
        return url
    return f"{url}/chat/completions"


def parse_llm_json_response(raw_text: str | None) -> dict[str, object]:
    """Safely extracts and parses JSON payload from LLM response text."""
    if not isinstance(raw_text, str):
        return {}
    text = raw_text.strip()
    if not text:
        return {}

    # Strip markdown code fence markers if present (e.g. ```json ... ``` or ``` ... ```)
    if "```" in text:
        text = re.sub(r"```[a-zA-Z0-9_-]*", "", text).strip()

    start_idx = text.find("{")
    if start_idx == -1:
        return {}

    try:
        decoder = json.JSONDecoder()
        data, end_idx = decoder.raw_decode(text, idx=start_idx)
        if not isinstance(data, dict):
            return {}

        # Suffix / trailing policy:
        # Check if trailing text contains another ambiguous JSON object.
        # Trailing plain prose (like commentary or notes) is accepted;
        # ambiguous multiple objects (like {"a": 1} {"b": 2}) are rejected to {}.
        trailing = text[end_idx:].strip()
        if "{" in trailing:
            return {}

        # Normalize common casing/alias variations
        if "source_url" in data and "sourceUrl" not in data:
            data["sourceUrl"] = data["source_url"]
        if "raw_snippet" in data and "rawSnippet" not in data:
            data["rawSnippet"] = data["raw_snippet"]
        return data
    except (json.JSONDecodeError, ValueError):
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
        model: str = "gemini-2.5-flash",
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

        target_url = normalize_provider_url(self.base_url)
        headers = {
            "Authorization": f"Bearer {self.api_key or ''}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": UKRAINIAN_NORMS_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": 0.0,
            "response_format": {"type": "json_object"},
        }

        raw_response_text = ""
        try:
            if self.llm_caller:
                raw_response_text = await self.llm_caller(
                    UKRAINIAN_NORMS_SYSTEM_PROMPT, user_prompt
                )
            else:
                if self.http_client:
                    resp = await self.http_client.post(
                        target_url, headers=headers, json=payload
                    )
                else:
                    async with httpx.AsyncClient(timeout=15.0) as client:
                        resp = await client.post(
                            target_url, headers=headers, json=payload
                        )

                if resp.status_code >= 400:
                    logger.warning(
                        "LLM provider returned HTTP error %d from %s: %s",
                        resp.status_code,
                        target_url,
                        resp.text[:300],
                    )
                    return NormLookupResult(
                        document=None,
                        clause=None,
                        value=None,
                        sourceUrl=None,
                        checkedAt=now_utc,
                        status=NormVerificationStatus.needs_verification,
                        summary=(
                            f"Помилка сервера провайдера норм "
                            f"(HTTP {resp.status_code}). "
                            "Потрібна ручна верифікація інженером."
                        ),
                        rawSnippet=None,
                    )

                content_type = resp.headers.get("content-type", "").lower()
                resp_text = resp.text.strip()

                if (
                    not resp_text.startswith(("{", "["))
                    or resp_text == "OK"
                    or "text/plain" in content_type
                ):
                    logger.warning(
                        "LLM provider returned non-JSON response from %s "
                        "(status=%d, content-type=%s): %s",
                        target_url,
                        resp.status_code,
                        content_type,
                        resp_text[:100],
                    )
                    return NormLookupResult(
                        document=None,
                        clause=None,
                        value=None,
                        sourceUrl=None,
                        checkedAt=now_utc,
                        status=NormVerificationStatus.needs_verification,
                        summary=(
                            "Провайдер норм повернув некоректну відповідь "
                            "(не у форматі JSON). "
                            "Потрібна ручна верифікація інженером."
                        ),
                        rawSnippet=resp_text[:300] if resp_text else None,
                    )

                try:
                    data = resp.json()
                except Exception as exc:
                    logger.warning(
                        "Failed to decode JSON from provider response: %s", exc
                    )
                    return NormLookupResult(
                        document=None,
                        clause=None,
                        value=None,
                        sourceUrl=None,
                        checkedAt=now_utc,
                        status=NormVerificationStatus.needs_verification,
                        summary=(
                            "Помилка розбору JSON відповіді провайдера норм. "
                            "Потрібна ручна верифікація інженером."
                        ),
                        rawSnippet=resp_text[:300] if resp_text else None,
                    )

                # Validate envelope structure according to chat completions schema
                if not isinstance(data, dict):
                    logger.warning(
                        "Provider response envelope is not a dict: %s",
                        type(data).__name__,
                    )
                    return NormLookupResult(
                        document=None,
                        clause=None,
                        value=None,
                        sourceUrl=None,
                        checkedAt=now_utc,
                        status=NormVerificationStatus.needs_verification,
                        summary=(
                            "Провайдер норм повернув некоректну структуру відповіді. "
                            "Потрібна ручна верифікація інженером."
                        ),
                        rawSnippet=None,
                    )

                choices = data.get("choices")
                if not isinstance(choices, list) or len(choices) == 0:
                    logger.warning("Provider response missing or empty choices list")
                    return NormLookupResult(
                        document=None,
                        clause=None,
                        value=None,
                        sourceUrl=None,
                        checkedAt=now_utc,
                        status=NormVerificationStatus.needs_verification,
                        summary=(
                            "Провайдер норм повернув порожній список "
                            "варіантів відповіді. "
                            "Потрібна ручна верифікація інженером."
                        ),
                        rawSnippet=None,
                    )

                first_choice = choices[0]
                if not isinstance(first_choice, dict):
                    logger.warning(
                        "Provider choices[0] is not a dict: %s",
                        type(first_choice).__name__,
                    )
                    return NormLookupResult(
                        document=None,
                        clause=None,
                        value=None,
                        sourceUrl=None,
                        checkedAt=now_utc,
                        status=NormVerificationStatus.needs_verification,
                        summary=(
                            "Провайдер норм повернув некоректний елемент choices. "
                            "Потрібна ручна верифікація інженером."
                        ),
                        rawSnippet=None,
                    )

                message = first_choice.get("message")
                if not isinstance(message, dict):
                    logger.warning(
                        "Provider message is not a dict: %s",
                        type(message).__name__,
                    )
                    return NormLookupResult(
                        document=None,
                        clause=None,
                        value=None,
                        sourceUrl=None,
                        checkedAt=now_utc,
                        status=NormVerificationStatus.needs_verification,
                        summary=(
                            "Провайдер норм повернув некоректне повідомлення. "
                            "Потрібна ручна верифікація інженером."
                        ),
                        rawSnippet=None,
                    )

                content = message.get("content")
                if not isinstance(content, str) or not content.strip():
                    logger.warning(
                        "Provider message content is not a non-empty string: %s",
                        type(content).__name__ if content is not None else "null",
                    )
                    return NormLookupResult(
                        document=None,
                        clause=None,
                        value=None,
                        sourceUrl=None,
                        checkedAt=now_utc,
                        status=NormVerificationStatus.needs_verification,
                        summary=(
                            "Провайдер норм повернув порожній або некоректний "
                            "вміст відповіді. "
                            "Потрібна ручна верифікація інженером."
                        ),
                        rawSnippet=None,
                    )

                raw_response_text = content
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
