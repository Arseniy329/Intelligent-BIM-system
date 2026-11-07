"""Anti-hallucination guard and post-processing verification (BIM-163).

Enforces:
1. Citations MUST originate from whitelisted official Ukrainian domains.
2. Complete rejection of obsolete Soviet/Russian standards (СНиП, ГОСТ, НПБ).
3. If unverified or missing official source, clause is strictly None.
4. CheckedAt is updated with an active UTC timestamp.
"""

from __future__ import annotations

from datetime import UTC, datetime

from src.contracts.norms import (
    NormLookupResult,
    NormVerificationStatus,
    is_disallowed_document,
    is_official_domain,
)


def sanitize_and_verify_result(raw_result: NormLookupResult) -> NormLookupResult:
    """Sanitizes and enforces strict normative safety guards on a lookup result."""
    status: NormVerificationStatus = raw_result.status
    document: str | None = raw_result.document
    clause: str | None = raw_result.clause
    value: str | float | int | None = raw_result.value
    source_url: str | None = raw_result.sourceUrl
    summary: str = raw_result.summary
    raw_snippet: str | None = raw_result.rawSnippet
    now_utc: datetime = datetime.now(UTC)

    # 1. Obsolete Soviet / Russian standard detection in document name or clause
    has_disallowed_doc = bool(document and is_disallowed_document(document))
    has_disallowed_clause = bool(clause and is_disallowed_document(clause))

    if has_disallowed_doc or has_disallowed_clause:
        status = NormVerificationStatus.needs_verification
        document = None
        clause = None
        source_url = None
        value = None
        summary = (
            "Запит відхилено або вимагає верифікації: виявлено посилання на "
            "застарілий або заборонений радянський/російський норматив. "
            f"{summary}"
        ).strip()

    # 2. Official Ukrainian domain verification
    if not source_url or not is_official_domain(source_url):
        if status == NormVerificationStatus.found_in_official_source:
            status = NormVerificationStatus.needs_verification
        source_url = None
        clause = None

    # 3. Document presence for verified status
    if not document or not document.strip():
        if status == NormVerificationStatus.found_in_official_source:
            status = NormVerificationStatus.needs_verification
        document = None
        clause = None

    # 4. Clause presence and safety
    if not clause or not clause.strip():
        clause = None
        if status == NormVerificationStatus.found_in_official_source:
            status = NormVerificationStatus.needs_verification

    # 5. Strict prohibition: If unverified, clause MUST be None (no hallucinations)
    if status == NormVerificationStatus.needs_verification:
        clause = None

    # 6. Fallback non-empty summary
    clean_summary = (summary or "").strip()
    if not clean_summary:
        clean_summary = (
            "Вимогу не верифіковано в офіційному реєстрі; "
            "потрібна ручна перевірка інженером."
        )

    return NormLookupResult(
        document=document,
        clause=clause,
        value=value,
        sourceUrl=source_url,
        checkedAt=now_utc,
        status=status,
        summary=clean_summary,
        rawSnippet=raw_snippet,
    )
