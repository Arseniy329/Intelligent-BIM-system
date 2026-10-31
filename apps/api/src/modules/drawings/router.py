from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from supabase import Client

from src.core.auth import CurrentUser, get_current_user
from src.core.config import get_settings
from src.infrastructure.storage import cleanup_file, download_dxf_to_tmp
from src.infrastructure.supabase import get_supabase_client
from src.modules.cad.parser import parse_dxf_rooms
from src.modules.cad.writer import add_sensors_to_dxf
from src.modules.drawings.schemas import (
    CreateDrawingRequest,
    CreateDrawingResponse,
    DrawingDetailResponse,
    DrawingRecord,
)
from src.modules.placement.service import RuleRecord, place_devices_from_rule

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
        "file_path": storage_path,
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
    supabase: Annotated[Client | None, Depends(get_supabase_client)] = None,
):
    if supabase is None:
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

    input_tmp_path: Path | None = None
    output_tmp_path: Path | None = None

    try:
        input_tmp_path = download_dxf_to_tmp(drawing.storage_path, client=supabase)

        resolved_drawing_id: UUID | None = None
        try:
            resolved_drawing_id = UUID(drawing_id)
        except (ValueError, TypeError):
            pass

        rooms = parse_dxf_rooms(input_tmp_path, drawing_id=resolved_drawing_id)

        rules_response = supabase.table("rules").select("*").limit(1).execute()
        if (
            not rules_response.data
            or not isinstance(rules_response.data, list)
            or len(rules_response.data) == 0
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No fire safety rules available",
            )

        rule_data = rules_response.data[0]
        if (
            not isinstance(rule_data, dict)
            or "id" not in rule_data
            or "threshold" not in rule_data
        ):
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Invalid rule record format",
            )

        try:
            threshold_val = float(rule_data["threshold"])
        except (ValueError, TypeError) as exc:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Invalid rule threshold",
            ) from exc

        rule = RuleRecord(
            id=str(rule_data["id"]),
            threshold=threshold_val,
            status=str(rule_data.get("status") or "needs_review"),
        )

        sensor_coords: list[tuple[float, float]] = []
        for room in rooms:
            coords = [(float(p.x), float(p.y)) for p in room.polygon]
            devices = place_devices_from_rule(coords, rule)
            for d in devices:
                sensor_coords.append((float(d.x), float(d.y)))

        output_tmp_path = Path("/tmp") / f"{uuid4()}_result.dxf"
        add_sensors_to_dxf(input_tmp_path, output_tmp_path, sensor_coords)

        # 4. Загружаем измененный файл обратно в бакет drawings
        output_storage_path = f"{current_user.id}/{drawing_id}/result.dxf"
        supabase.storage.from_(settings.SUPABASE_STORAGE_BUCKET).upload(
            path=output_storage_path,
            file=str(output_tmp_path),
            file_options={"content-type": "application/dxf", "x-upsert": "true"},
        )

        supabase.table("drawings").update({"status": "processed"}).eq(
            "id", drawing_id
        ).execute()

        return {
            "drawing_id": drawing_id,
            "status": "processed",
            "result_path": output_storage_path,
        }
    finally:
        cleanup_file(input_tmp_path)
        cleanup_file(output_tmp_path)


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
            url_val = signed_url_response.get("signedUrl") or signed_url_response.get(
                "url"
            )
            if isinstance(url_val, str):
                source_url = url_val
    except Exception:
        source_url = None

    expires_at = datetime.now(UTC) + timedelta(seconds=3600)

    result_url: str | None = None
    if drawing.status == "processed":
        expected_result_path = f"{drawing.owner_id}/{drawing.id}/result.dxf"
        try:
            r_resp = supabase.storage.from_(
                settings.SUPABASE_STORAGE_BUCKET
            ).create_signed_url(expected_result_path, 3600)
            if isinstance(r_resp, dict):
                r_val = r_resp.get("signedUrl") or r_resp.get("url")
                if isinstance(r_val, str):
                    result_url = r_val
        except Exception:
            pass

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
        "result_download_url": result_url,
    }
