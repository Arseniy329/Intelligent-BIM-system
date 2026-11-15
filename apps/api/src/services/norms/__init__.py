"""Norms search agent service and provider architecture (BIM-163)."""

from src.services.norms.guard import sanitize_and_verify_result
from src.services.norms.provider import (
    OFFICIAL_DOMAINS_SEARCH_FILTER,
    PRIMARY_ACTIVE_STANDARDS,
    UKRAINIAN_NORMS_SYSTEM_PROMPT,
    BaseNormsSearchProvider,
    LLMDomainRestrictedSearchProvider,
    MockNormsSearchProvider,
    build_domain_restricted_query,
)
from src.services.norms.service import NormsService, get_norms_service

__all__ = [
    "BaseNormsSearchProvider",
    "LLMDomainRestrictedSearchProvider",
    "MockNormsSearchProvider",
    "NormsService",
    "OFFICIAL_DOMAINS_SEARCH_FILTER",
    "PRIMARY_ACTIVE_STANDARDS",
    "UKRAINIAN_NORMS_SYSTEM_PROMPT",
    "build_domain_restricted_query",
    "get_norms_service",
    "sanitize_and_verify_result",
]
