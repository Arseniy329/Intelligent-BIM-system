"""FastAPI router for norms search and verification (BIM-163).

Provides endpoints for Ukrainian fire safety standards search.
Zero tolerance for 500 errors on provider failure: external failures
are caught and downgraded to 'needs_verification' with clause=None.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status

from src.contracts.norms import (
    NormLookupRequest,
    NormLookupResult,
    NormVerificationStatus,
)
from src.core.auth import CurrentUser, get_current_user
from src.services.norms.service import (
    NormsRateLimiter,
    NormsService,
    get_norms_rate_limiter,
    get_norms_service,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/norms", tags=["norms"])


@router.post(
    "/lookup",
    response_model=NormLookupResult,
    status_code=status.HTTP_200_OK,
    summary="Пошук та верифікація норм пожежної безпеки України",
    description=(
        "Агентний пошук будівельних норм та стандартів пожежної безпеки України "
        "(ДБН В.2.5-56:2014, ДСТУ EN 54, ДБН В.1.1-7:2016) виключно за офіційними "
        "державними реєстрами з антигалюцинаційним захистом."
    ),
)
async def lookup_norms(
    request: NormLookupRequest,
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
    service: Annotated[NormsService, Depends(get_norms_service)],
    rate_limiter: Annotated[NormsRateLimiter, Depends(get_norms_rate_limiter)],
) -> NormLookupResult:
    """Performs domain-restricted search for Ukrainian fire safety standards.

    Resilient to provider failures: if the external search or LLM provider fails,
    returns a 200 OK result with status 'needs_verification' and clause=None,
    preventing 500 crashes and unverified hallucinations.
    """
    # 1. Enforce per-user rate limit (raises HTTP 429 if exceeded)
    rate_limiter.check_rate_limit(current_user.id)

    # 2. Execute lookup
    try:
        return await service.lookup(request)
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Unexpected error in norms lookup: %s", exc, exc_info=True)
        return NormLookupResult(
            document=None,
            clause=None,
            value=None,
            sourceUrl=None,
            checkedAt=datetime.now(UTC),
            status=NormVerificationStatus.needs_verification,
            summary=(
                "Сервіс тимчасово не зміг верифікувати норму через технічну помилку "
                "або недоступність офіційного реєстру. Потрібна ручна верифікація "
                "інженером."
            ),
            rawSnippet=None,
        )
