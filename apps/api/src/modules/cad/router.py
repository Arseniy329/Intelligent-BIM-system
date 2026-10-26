from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field
from supabase import Client

from src.contracts.generated import Room
from src.infrastructure.storage import temporary_dxf_file
from src.infrastructure.supabase import get_supabase_client
from src.modules.cad.parser import parse_dxf_rooms

router = APIRouter(prefix="/cad", tags=["cad"])


class ExtractRoomsRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    file_path: str = Field(..., description="Path or URL to DXF file")
    drawing_id: UUID | None = Field(default=None, description="Optional drawing UUID")


@router.post(
    "/extract-rooms",
    response_model=list[Room],
    summary="Extract room contours and names from DXF",
)
def extract_rooms(
    request: ExtractRoomsRequest,
    supabase: Annotated[Client, Depends(get_supabase_client)],
) -> list[Room]:
    """Download DXF file and extract rooms from FIRE_ROOMS layer."""
    with temporary_dxf_file(request.file_path, client=supabase) as temp_path:
        return parse_dxf_rooms(temp_path, drawing_id=request.drawing_id)
