from datetime import UTC, datetime, timedelta
from typing import Any, cast
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
    DrawingStatus,
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

    inserted = (
        supabase.table("drawings")
        .insert(insert_payload)
        .execute()
    )

    if not inserted.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create drawing record",
        )

    drawing_data = inserted.data[0]
    drawing = cast(dict[str, Any], drawing_data)

    try:
        upload_response = (
            supabase.storage
            .from_(settings.SUPABASE_STORAGE_BUCKET)
            .create_signed_upload_url(storage_path)
        )
        signed_url = None
        if isinstance(upload_response, dict):
            signed_url = upload_response.get("signedUrl") or upload_response.get("url")
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to generate signed upload URL",
        ) from exc

    return {
        "drawing": DrawingRecord(
            id=str(drawing["id"]),
            owner_id=str(drawing["owner_id"]),
            original_file_name=str(drawing["original_file_name"]),
            storage_path=str(drawing["storage_path"]),
            units=str(drawing["units"]),
            status=cast(DrawingStatus, drawing["status"]),
            created_at=cast(datetime, drawing["created_at"]),
        ),
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

    rows = cast(list[dict[str, Any]], response.data or [])

    return [
        DrawingRecord(
            id=str(row["id"]),
            owner_id=str(row["owner_id"]),
            original_file_name=str(row["original_file_name"]),
            storage_path=str(row["storage_path"]),
            units=str(row["units"]),
            status=cast(DrawingStatus, row["status"]),
            created_at=cast(datetime, row["created_at"]),
        )
        for row in rows
    ]


@router.post("/{drawing_id}/process")
async def process_drawing(
    drawing_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    supabase = get_supabase_client(settings)

    drawing_response = (
        supabase.table("drawings")
        .select("*")
        .eq("id", drawing_id)
        .single()
        .execute()
    )

    if not drawing_response.data:
        raise HTTPException(status_code=404, detail="Drawing not found")

    drawing = cast(dict[str, Any], drawing_response.data)

    if drawing["owner_id"] != current_user.id and current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Forbidden")

    # Заглушка до готовності реальної обробки
    return {
        "drawing_id": drawing_id,
        "status": "accepted",
        "message": (
            "Processing stub accepted. BIM-54/BIM-55/BIM-57 will be connected "
            "later."
        ),
    }


@router.get("/{drawing_id}", response_model=DrawingDetailResponse)
async def get_drawing_detail(
    drawing_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    supabase = get_supabase_client(settings)

    drawing_response = (
        supabase.table("drawings")
        .select("*")
        .eq("id", drawing_id)
        .single()
        .execute()
    )

    if not drawing_response.data:
        raise HTTPException(status_code=404, detail="Drawing not found")

    drawing = cast(dict[str, Any], drawing_response.data)

    if drawing["owner_id"] != current_user.id and current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Forbidden")

    try:
        signed_url_response = (
            supabase.storage
            .from_(settings.SUPABASE_STORAGE_BUCKET)
            .create_signed_url(str(drawing["storage_path"]), 3600)
        )
        if isinstance(signed_url_response, dict):
            source_url = (
                signed_url_response.get("signedUrl")
                or signed_url_response.get("url")
            )
        else:
            source_url = None
    except Exception:
        source_url = None

    expires_at = datetime.now(UTC) + timedelta(seconds=3600)

    return {
        "id": str(drawing["id"]),
        "owner_id": str(drawing["owner_id"]),
        "original_file_name": str(drawing["original_file_name"]),
        "storage_path": str(drawing["storage_path"]),
        "units": str(drawing["units"]),
        "status": cast(DrawingStatus, drawing["status"]),
        "created_at": cast(datetime, drawing["created_at"]),
        "source_download_url": source_url,
        "source_download_url_expires_at": expires_at,
    }