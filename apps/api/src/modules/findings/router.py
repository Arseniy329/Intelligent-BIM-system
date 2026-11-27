"""FastAPI router for BIM-77 compliance audit findings."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends
from supabase import Client

from src.core.auth import CurrentUser, get_current_user
from src.infrastructure.supabase import get_supabase_client
from src.modules.drawings.access import get_drawing_for_user
from src.modules.findings.schemas import Finding
from src.modules.findings.service import get_findings_for_drawing

router = APIRouter(tags=["findings"])


@router.get("/drawings/{drawing_id}/findings", response_model=list[Finding])
async def get_drawing_findings(
    drawing_id: UUID,
    supabase: Annotated[Client, Depends(get_supabase_client)],
    current_user: CurrentUser = Depends(get_current_user),
) -> list[Finding]:
    """Return read-only fire-safety compliance findings for a drawing."""
    drawing = get_drawing_for_user(supabase, drawing_id, current_user)
    return get_findings_for_drawing(supabase, str(drawing_id), drawing_row=drawing)
