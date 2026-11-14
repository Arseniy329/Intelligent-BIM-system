"""Core Norms Lookup Service (BIM-163).

Orchestrates provider querying, anti-hallucination verification guard,
and in-memory TTL caching.
"""

from __future__ import annotations

import hashlib
import json
import logging
import time
from typing import Annotated

from fastapi import Depends, HTTPException, status

from src.contracts.norms import (
    NormLookupRequest,
    NormLookupResult,
    NormVerificationStatus,
)
from src.core.config import Settings, get_settings
from src.services.norms.guard import sanitize_and_verify_result
from src.services.norms.provider import (
    BaseNormsSearchProvider,
    LLMDomainRestrictedSearchProvider,
)

logger = logging.getLogger(__name__)


class NormsService:
    """Core service for Ukrainian norms lookup.

    Features:
    - Provider abstraction (domain-restricted LLM search or test mock)
    - Anti-hallucination post-processing guard
    - In-memory TTL cache to eliminate redundant queries & preserve free-tier quotas.
    """

    def __init__(
        self,
        provider: BaseNormsSearchProvider | None = None,
        cache_ttl_seconds: float = 3600.0,
        max_cache_size: int = 1000,
        verified_retrieval: bool = False,
    ) -> None:
        self.provider: BaseNormsSearchProvider = (
            provider if provider is not None else LLMDomainRestrictedSearchProvider()
        )
        self.cache_ttl_seconds: float = max(0.0, cache_ttl_seconds)
        self.max_cache_size: int = max(1, max_cache_size)
        self.verified_retrieval: bool = verified_retrieval
        # Internal cache map: cache_key -> (timestamp_monotonic, NormLookupResult)
        self._cache: dict[str, tuple[float, NormLookupResult]] = {}

    def _make_cache_key(self, request: NormLookupRequest) -> str:
        """Generates a deterministic hash key for a lookup request."""
        query_normalized = " ".join(request.query.strip().lower().split())
        context_payload = ""
        if request.context:
            context_payload = json.dumps(
                request.context.model_dump(exclude_none=True),
                sort_keys=True,
            )
        raw_key = f"{query_normalized}|{context_payload}"
        digest = hashlib.sha256(raw_key.encode("utf-8")).hexdigest()
        return f"norm:{digest}"

    def _get_from_cache(self, key: str) -> NormLookupResult | None:
        """Retrieves an unexpired entry from cache, removing it if expired."""
        if self.cache_ttl_seconds <= 0:
            return None

        entry = self._cache.get(key)
        if entry is None:
            return None

        cached_at_mono, result = entry
        if (time.monotonic() - cached_at_mono) > self.cache_ttl_seconds:
            # Expired
            self._cache.pop(key, None)
            return None

        return result

    def _put_to_cache(self, key: str, result: NormLookupResult) -> None:
        """Stores a result in cache, evicting expired or excess entries if needed."""
        if self.cache_ttl_seconds <= 0:
            return

        now_mono = time.monotonic()

        # Evict if exceeding max size
        if len(self._cache) >= self.max_cache_size and key not in self._cache:
            # First prune expired
            expired_keys = [
                k
                for k, (t, _) in self._cache.items()
                if (now_mono - t) > self.cache_ttl_seconds
            ]
            for k in expired_keys:
                self._cache.pop(k, None)

            # If still full, pop the oldest entry
            if len(self._cache) >= self.max_cache_size:
                oldest_key = min(self._cache.keys(), key=lambda k: self._cache[k][0])
                self._cache.pop(oldest_key, None)

        self._cache[key] = (now_mono, result)

    def clear_cache(self) -> None:
        """Clears all cached entries."""
        self._cache.clear()

    @property
    def cache_size(self) -> int:
        """Returns the current number of items in cache."""
        return len(self._cache)

    async def lookup(self, request: NormLookupRequest) -> NormLookupResult:
        """Executes a cached and verified norms lookup."""
        cache_key = self._make_cache_key(request)

        # 1. Check TTL cache
        cached_result = self._get_from_cache(cache_key)
        if cached_result is not None:
            logger.debug("Norm lookup cache hit for key %s", cache_key)
            return cached_result

        # 2. Query provider
        raw_result = await self.provider.lookup(request)

        # 3. Post-processing anti-hallucination guard
        is_verified = self.verified_retrieval or getattr(
            self.provider, "verified_retrieval", False
        )
        verified_result = sanitize_and_verify_result(
            raw_result,
            verified_retrieval=is_verified,
        )

        # 4. Save verified result to cache ONLY if found in official source
        if verified_result.status == NormVerificationStatus.found_in_official_source:
            self._put_to_cache(cache_key, verified_result)

        return verified_result

    async def search(self, request: NormLookupRequest) -> NormLookupResult:
        """Convenience alias for lookup."""
        return await self.lookup(request)


class NormsRateLimiter:
    """Sliding-window in-memory rate limiter per user (BIM-163).

    Limits request frequency (e.g. 10 req / 60s) to prevent quota exhaustion.
    """

    def __init__(
        self,
        max_requests: int = 10,
        window_seconds: float = 60.0,
    ) -> None:
        self.max_requests = max(1, max_requests)
        self.window_seconds = max(1.0, window_seconds)
        self._requests: dict[str, list[float]] = {}

    def check_rate_limit(self, user_id: str) -> None:
        """Records a request and raises HTTP 429 if the user has exceeded quota."""
        now = time.monotonic()
        cutoff = now - self.window_seconds

        timestamps = self._requests.setdefault(user_id, [])
        # Prune expired timestamps
        self._requests[user_id] = [t for t in timestamps if t > cutoff]

        if len(self._requests[user_id]) >= self.max_requests:
            logger.warning(
                "Rate limit exceeded for user %s: %d requests in last %.1f s",
                user_id,
                len(self._requests[user_id]),
                self.window_seconds,
            )
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Перевищено ліміт запитів на пошук норм. Спробуйте пізніше.",
            )

        self._requests[user_id].append(now)

    def reset(self) -> None:
        """Clears all in-memory rate limit records (for test isolation)."""
        self._requests.clear()


_rate_limiter = NormsRateLimiter()


def get_norms_rate_limiter() -> NormsRateLimiter:
    """Dependency provider for NormsRateLimiter."""
    return _rate_limiter


def reset_norms_rate_limiter() -> None:
    """Resets the rate limiter for test isolation."""
    _rate_limiter.reset()


_norms_service_instance: NormsService | None = None


def get_norms_service(
    settings: Annotated[Settings | None, Depends(get_settings)] = None,
) -> NormsService:
    """Dependency provider for NormsService configured strictly from Settings.

    Maintains a singleton instance to preserve the in-memory cache across HTTP requests.
    """
    global _norms_service_instance
    effective_settings = settings if settings is not None else get_settings()
    model = getattr(effective_settings, "NORMS_SEARCH_MODEL", "openai/gpt-4o-mini")

    if _norms_service_instance is None:
        provider = LLMDomainRestrictedSearchProvider(
            api_key=effective_settings.NORMS_SEARCH_API_KEY,
            base_url=effective_settings.NORMS_SEARCH_PROVIDER_URL,
            model=model,
        )
        _norms_service_instance = NormsService(
            provider=provider,
            cache_ttl_seconds=float(effective_settings.NORMS_CACHE_TTL_SECONDS),
        )
    elif settings is not None:
        current_provider = _norms_service_instance.provider
        if (
            not isinstance(current_provider, LLMDomainRestrictedSearchProvider)
            or current_provider.api_key != effective_settings.NORMS_SEARCH_API_KEY
            or current_provider.base_url != effective_settings.NORMS_SEARCH_PROVIDER_URL
            or getattr(current_provider, "model", None) != model
        ):
            provider = LLMDomainRestrictedSearchProvider(
                api_key=effective_settings.NORMS_SEARCH_API_KEY,
                base_url=effective_settings.NORMS_SEARCH_PROVIDER_URL,
                model=model,
            )
            _norms_service_instance = NormsService(
                provider=provider,
                cache_ttl_seconds=float(effective_settings.NORMS_CACHE_TTL_SECONDS),
            )

    return _norms_service_instance


def reset_norms_service(service: NormsService | None = None) -> None:
    """Resets or seeds the singleton NormsService instance for testing isolation."""
    global _norms_service_instance
    _norms_service_instance = service
