"""Core Norms Lookup Service (BIM-163).

Orchestrates provider querying, anti-hallucination verification guard,
and in-memory TTL caching.
"""

from __future__ import annotations

import hashlib
import json
import logging
import time
from functools import lru_cache

from src.contracts.norms import (
    NormLookupRequest,
    NormLookupResult,
)
from src.core.config import get_settings
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
    ) -> None:
        self.provider: BaseNormsSearchProvider = (
            provider if provider is not None else LLMDomainRestrictedSearchProvider()
        )
        self.cache_ttl_seconds: float = max(0.0, cache_ttl_seconds)
        self.max_cache_size: int = max(1, max_cache_size)
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
        verified_result = sanitize_and_verify_result(raw_result)

        # 4. Save verified result to cache
        self._put_to_cache(cache_key, verified_result)

        return verified_result

    async def search(self, request: NormLookupRequest) -> NormLookupResult:
        """Convenience alias for lookup."""
        return await self.lookup(request)


@lru_cache
def get_norms_service() -> NormsService:
    """Dependency provider for NormsService."""
    settings = get_settings()
    ttl = getattr(settings, "NORMS_CACHE_TTL_SECONDS", 3600)
    return NormsService(cache_ttl_seconds=float(ttl))
