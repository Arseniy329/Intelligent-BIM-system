"""Anti-hallucination guard and post-processing verification (BIM-163).

Enforces:
1. Citations MUST originate from whitelisted official Ukrainian domains.
2. Complete rejection of obsolete Soviet/Russian standards (СНиП, ГОСТ, НПБ).
3. If unverified or missing official source, clause is strictly None.
4. Evidence-based verification: found_in_official_source requires active standard
   and substantiated raw snippet quote from official text.
5. CheckedAt is updated with an active UTC timestamp.
"""

from __future__ import annotations

from datetime import UTC, datetime

from src.contracts.norms import (
    NormLookupResult,
    NormVerificationStatus,
    is_active_standard,
    is_disallowed_document,
    is_official_domain,
)


def sanitize_and_verify_result(
    raw_result: NormLookupResult,
    *,
    verified_retrieval: bool = False,
) -> NormLookupResult:
    """Sanitizes and enforces strict normative safety guards on a lookup result.

    Invariants:
    1. Obsolete Soviet/Russian standards are unconditionally rejected and wiped.
    2. Without verified retrieval source proof (independent fetch of official document
       bytes), results MUST NOT be certified as found_in_official_source. They are
       safely downgraded to needs_verification with clause=None and sourceUrl=None.
    3. Even with verified retrieval, all four evidence criteria must be met:
       active Ukrainian standard, official domain, non-empty proof snippet
       (>= 10 chars), and non-empty clause.
    4. Unverified status always has clause=None.
    5. Fallback non-empty Ukrainian summary is provided.
    """
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

    # 2. Evidence-Based Verification for official status
    # A whitelist check on URL alone is NOT proof.
    # LLM self-attestation is NEVER trusted without independent document retrieval.
    has_active_std = bool(document and is_active_standard(document))
    has_official_url = bool(source_url and is_official_domain(source_url))
    has_proof_snippet = bool(raw_snippet and len(raw_snippet.strip()) >= 10)
    has_valid_clause = bool(clause and clause.strip())

    if status == NormVerificationStatus.found_in_official_source:
        if not verified_retrieval or not (
            has_active_std
            and has_official_url
            and has_proof_snippet
            and has_valid_clause
        ):
            status = NormVerificationStatus.needs_verification
            clause = None
            source_url = None

    # 3. Clean unverified URLs if not official or unverified retrieval
    if source_url and (not is_official_domain(source_url) or not verified_retrieval):
        source_url = None

    # 4. Strict prohibition: If unverified, clause MUST be None (no hallucinations)
    if status == NormVerificationStatus.needs_verification:
        clause = None

    # 5. Fallback non-empty summary
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
