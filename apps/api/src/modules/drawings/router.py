from datetime import UTC, datetime, timedelta
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status

from src.core.auth import CurrentUser, get_current_user
from src.core.config import get_settings
from src.infrastructure.supabase import get_supabase_client
from src.modules.drawings.schemas import (
    CreateDrawingRequest,
    CreateDrawingResponse,
    DrawingDetailResponse,
    DrawingRecord,
)

router = APIRouter(prefix="/drawings", tags=["drawings"])
settings = get_settings()


@router.post("", response_model=CreateDrawingResponse)
async def create_drawing(
    payload: CreateDrawingRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    supabase = get_supabase_client(settings)

    storage_path = f"{current_user.id}/{uuid4()}/{payload.original_file_name}"

    insert_payload = {
        "owner_id": current_user.id,
        "original_file_name": payload.original_file_name,
        "storage_path": storage_path,
        "units": payload.units,
        "status": "uploaded",
    }

    inserted = supabase.table("drawings").insert(insert_payload).execute()

    if not inserted.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create drawing record",
        )

    drawing_data = inserted.data[0]
    if not isinstance(drawing_data, dict):
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unexpected response shape from database",
        )

    try:
        drawing = DrawingRecord.model_validate(drawing_data)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to parse created drawing record",
        ) from exc

    try:
        upload_response = supabase.storage.from_(
            settings.SUPABASE_STORAGE_BUCKET
        ).create_signed_upload_url(storage_path)
        signed_url = None
        if isinstance(upload_response, dict):
            signed_url = upload_response.get("signedUrl") or upload_response.get("url")
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to generate signed upload URL",
        ) from exc

    if not signed_url or not isinstance(signed_url, str):
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to generate signed upload URL",
        )

    return {
        "drawing": drawing,
        "upload": {
            "url": signed_url,
            "path": storage_path,
            "expires_in_seconds": 3600,
        },
    }


@router.get("", response_model=list[DrawingRecord])
async def list_drawings(
    current_user: CurrentUser = Depends(get_current_user),
):
    supabase = get_supabase_client(settings)

    response = (
        supabase.table("drawings")
        .select("*")
        .eq("owner_id", current_user.id)
        .order("created_at", desc=True)
        .execute()
    )

    rows = response.data
    if not isinstance(rows, list):
        return []

    drawings: list[DrawingRecord] = []
    for row in rows:
        if not isinstance(row, dict):
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Invalid drawing record format in database",
            )
        try:
            drawings.append(DrawingRecord.model_validate(row))
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to parse drawing record",
            ) from exc

    return drawings


@router.post("/{drawing_id}/process")
async def process_drawing(
    drawing_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    supabase = get_supabase_client(settings)

    drawing_response = (
        supabase.table("drawings").select("*").eq("id", drawing_id).single().execute()
    )

    drawing_data = drawing_response.data
    if not isinstance(drawing_data, dict):
        raise HTTPException(status_code=404, detail="Drawing not found")

    try:
        drawing = DrawingRecord.model_validate(drawing_data)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to parse drawing record",
        ) from exc

    if drawing.owner_id != current_user.id and current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Forbidden")

    return {
        "drawing_id": drawing_id,
        "status": "accepted",
        "message": (
            "Processing stub accepted. BIM-54/BIM-55/BIM-57 will be connected later."
        ),
    }


@router.get("/{drawing_id}", response_model=DrawingDetailResponse)
async def get_drawing_detail(
    drawing_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    supabase = get_supabase_client(settings)

    drawing_response = (
        supabase.table("drawings").select("*").eq("id", drawing_id).single().execute()
    )

    drawing_data = drawing_response.data
    if not isinstance(drawing_data, dict):
        raise HTTPException(status_code=404, detail="Drawing not found")

    try:
        drawing = DrawingRecord.model_validate(drawing_data)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to parse drawing record",
        ) from exc

    if drawing.owner_id != current_user.id and current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Forbidden")

    source_url: str | None = None
    try:
        signed_url_response = supabase.storage.from_(
            settings.SUPABASE_STORAGE_BUCKET
        ).create_signed_url(drawing.storage_path, 3600)
        if isinstance(signed_url_response, dict):
            url_val = signed_url_response.get(
                "signedUrl"
            ) or signed_url_response.get("url")
            if isinstance(url_val, str):
                source_url = url_val
    except Exception:
        source_url = None

    expires_at = datetime.now(UTC) + timedelta(seconds=3600)

    return {
        "id": drawing.id,
        "owner_id": drawing.owner_id,
        "original_file_name": drawing.original_file_name,
        "storage_path": drawing.storage_path,
        "units": drawing.units,
        "status": drawing.status,
        "created_at": drawing.created_at,
        "source_download_url": source_url,
        "source_download_url_expires_at": expires_at,
    }
