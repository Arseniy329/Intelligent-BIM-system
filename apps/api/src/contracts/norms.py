"""Norms lookup Pydantic contracts and whitelist verification (BIM-163).

Shared schemas for Ukrainian fire safety norms agent service.
Enforces that missing or unverified clauses default to None (null in JSON),
never guessed placeholder strings. Zero tolerance for `Any`.
"""

from __future__ import annotations

import re
from datetime import datetime
from enum import StrEnum
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class NormVerificationStatus(StrEnum):
    """Verification status of a standard lookup result."""

    found_in_official_source = "found_in_official_source"
    needs_verification = "needs_verification"


# Official Ukrainian domains whitelist (BIM-124 / BIM-163)
OFFICIAL_UKRAINIAN_DOMAINS: tuple[str, ...] = (
    "zakon.rada.gov.ua",
    "dsns.gov.ua",
    "minregion.gov.ua",
    "budstandart.ua",
    "e-construction.gov.ua",
    "diam.gov.ua",
)

# Disallowed domains / suffixes (e.g. Russian resources)
DISALLOWED_DOMAIN_SUFFIXES: tuple[str, ...] = (
    ".ru",
    ".su",
    ".xn--p1ai",
)

# Obsolete Soviet & Russian standard identifiers
DISALLOWED_STANDARD_IDENTIFIERS: tuple[str, ...] = (
    "СНиП",
    "СНИП",
    "SNiP",
    "НПБ",
    "NPB",
    "ГОСТ",
    "GOST",
    "ВНПБ",
    "VNPB",
    "ВСН",
    "VSN",
)


def is_official_domain(url: str | None) -> bool:
    """Validates if URL belongs to an approved Ukrainian official domain."""
    if not url or not isinstance(url, str):
        return False

    trimmed = url.strip()
    if not trimmed:
        return False

    url_to_parse = trimmed if "://" in trimmed else f"https://{trimmed}"
    try:
        parsed = urlparse(url_to_parse)
        if parsed.scheme not in ("http", "https"):
            return False
        hostname = (parsed.hostname or "").lower()
    except Exception:
        return False

    if not hostname or " " in hostname:
        return False

    for suffix in DISALLOWED_DOMAIN_SUFFIXES:
        if hostname == suffix[1:] or hostname.endswith(suffix):
            return False

    return any(
        hostname == official or hostname.endswith(f".{official}")
        for official in OFFICIAL_UKRAINIAN_DOMAINS
    )


def is_disallowed_document(document_name: str | None) -> bool:
    """Detects obsolete Soviet/Russian standards or citations of Russian sources."""
    if not document_name or not isinstance(document_name, str):
        return False

    trimmed = document_name.strip()
    if not trimmed:
        return False

    lower = trimmed.lower()
    if any(s in lower for s in (".ru", ".su", ".рф")):
        return True

    for ident in DISALLOWED_STANDARD_IDENTIFIERS:
        pattern = rf"(^|[^\w]){re.escape(ident)}([^\w]|$)"
        if re.search(pattern, trimmed, re.IGNORECASE):
            return True

    return False


ACTIVE_STANDARDS_WHITELIST: tuple[str, ...] = (
    "ДБН В.2.5-56:2014",
    "ДСТУ EN 54",
    "ДБН В.1.1-7:2016",
)


def is_active_standard(document_name: str | None) -> bool:
    """Checks whether a document corresponds to verified active Ukrainian standards."""
    if not document_name or not isinstance(document_name, str):
        return False

    if is_disallowed_document(document_name):
        return False

    normalized = (
        document_name.strip()
        .upper()
        .replace("DBN", "ДБН")
        .replace("DSTU", "ДСТУ")
        .replace("V.", "В.")
    )

    if "ДБН В.2.5-56" in normalized:
        return True
    if "ДСТУ EN 54" in normalized or "ДСТУ-Н CEN/TS 54" in normalized:
        return True
    if "ДБН В.1.1-7" in normalized:
        return True

    return False


class NormLookupContext(BaseModel):
    """Context parameters for norms search query. Zero Any allowed."""

    model_config = ConfigDict(extra="allow")

    roomHeight: float | None = None
    roomArea: float | None = None
    detectorType: str | None = None
    roomType: str | None = None
    buildingType: str | None = None


class NormLookupRequest(BaseModel):
    """Request sent to the norms lookup agent."""

    model_config = ConfigDict(extra="forbid")

    query: str = Field(
        ...,
        min_length=1,
        max_length=500,
        description="Пошуковий запит користувача",
    )
    context: NormLookupContext | None = None

    @field_validator("query")
    @classmethod
    def validate_query_not_whitespace(cls, v: str) -> str:
        trimmed = v.strip()
        if not trimmed:
            raise ValueError("Пошуковий запит не може бути порожнім")
        if len(trimmed) > 500:
            raise ValueError("Пошуковий запит не може перевищувати 500 символів")
        return trimmed


class NormLookupResult(BaseModel):
    """Result returned by the norms lookup agent.

    Missing or unverified clauses default to None (null in JSON).
    """

    model_config = ConfigDict(extra="forbid")

    document: str | None = None
    clause: str | None = None
    value: str | float | int | None = None
    sourceUrl: str | None = None
    checkedAt: datetime
    status: NormVerificationStatus
    summary: str = Field(..., min_length=1)
    rawSnippet: str | None = None

    @model_validator(mode="after")
    def validate_norm_status(self) -> NormLookupResult:
        if self.status == NormVerificationStatus.found_in_official_source:
            if not self.document or not self.document.strip():
                raise ValueError(
                    "Verified norm result must specify an official document name"
                )
            if is_disallowed_document(self.document):
                raise ValueError(
                    f"Document '{self.document}' is an obsolete or disallowed standard"
                )

            if not self.clause or not self.clause.strip():
                raise ValueError("Verified norm result must specify a clause or table")

            if not self.sourceUrl or not self.sourceUrl.strip():
                raise ValueError(
                    "Verified norm result must provide an official source URL"
                )
            if not is_official_domain(self.sourceUrl):
                raise ValueError(
                    f"Source URL '{self.sourceUrl}' is not on official whitelist"
                )
        elif self.status == NormVerificationStatus.needs_verification:
            if self.document and is_disallowed_document(self.document):
                raise ValueError(
                    f"Document '{self.document}' is an obsolete or disallowed standard"
                )
        return self
