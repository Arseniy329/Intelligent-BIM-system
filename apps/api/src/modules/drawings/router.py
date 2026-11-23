import logging
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Annotated, Any
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import AnyUrl
from supabase import Client

from src.contracts.generated import (
    Device,
    Drawing,
    DrawingResult,
    DrawingStatus,
    DrawingUnits,
    Point,
    Room,
    Type,
)
from src.core.auth import CurrentUser, get_current_user
from src.core.config import get_settings
from src.core.exceptions import BIMException
from src.infrastructure.storage import cleanup_file, download_dxf_to_tmp
from src.infrastructure.supabase import get_supabase_client
from src.modules.cad.exits import find_door_points, find_exit_points
from src.modules.cad.parser import parse_dxf_rooms_with_scale, read_dxf_document
from src.modules.cad.writer import MCP_LAYER_NAME
from src.modules.drawings.schemas import (
    CreateDrawingRequest,
    CreateDrawingResponse,
    DrawingDetailResponse,
    DrawingListItem,
    DrawingRecord,
)
from src.modules.drawings.service import (
    generate_and_upload_result_dxf,
    list_drawings_for_user,
    stored_unit_scale_m,
)
from src.modules.placement.manual_call_points import (
    describe_call_point_outcome,
    exits_from_rows,
    passages_from_rows,
    place_manual_call_points,
    room_id_near_exit,
    rooms_from_rows,
)
from src.modules.placement.service import (
    build_placement_targets,
    describe_outcome,
    place_targets,
    summarize_outcomes,
)
from src.modules.rooms.service import room_from_row, row_points

router = APIRouter(prefix="/drawings", tags=["drawings"])
logger = logging.getLogger(__name__)
settings = get_settings()


def _map_db_to_drawing(drawing_data: dict[str, Any]) -> Drawing:
    units_raw = drawing_data.get("resolved_units") or drawing_data.get("units")
    resolved_units = None
    if units_raw == "mm":
        resolved_units = DrawingUnits.mm
    elif units_raw == "m":
        resolved_units = DrawingUnits.m

    status_raw = str(drawing_data.get("status", "error"))
    try:
        drawing_status = DrawingStatus(status_raw)
    except ValueError:
        drawing_status = DrawingStatus.error

    created_at_val = drawing_data["created_at"]
    if isinstance(created_at_val, str):
        dt = datetime.fromisoformat(created_at_val.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
    elif isinstance(created_at_val, datetime):
        dt = created_at_val
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
    else:
        dt = datetime.now(UTC)

    return Drawing(
        id=UUID(str(drawing_data["id"])),
        ownerId=UUID(str(drawing_data["owner_id"])),
        originalFileName=str(drawing_data["original_file_name"]),
        storagePath=str(drawing_data["storage_path"]),
        resolvedUnits=resolved_units,
        status=drawing_status,
        errorMessage=drawing_data.get("error_message"),
        createdAt=dt,
    )


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


@router.get("", response_model=list[DrawingListItem])
async def list_drawings(
    current_user: CurrentUser = Depends(get_current_user),
    supabase: Annotated[Client | None, Depends(get_supabase_client)] = None,
):
    return await list_drawings_for_user(current_user.id, supabase)


EXIT_DETECTION_OK = "ok"
EXIT_DETECTION_FAILED = "failed"
WARNING_EXIT_DETECTION_FAILED = (
    "Не вдалося оновити евакуаційні виходи й проходи з креслення. Раніше збережені "
    "виходи й проходи лишено без змін; обробіть креслення ще раз"
)


def _save_dxf_layout(
    supabase: Client,
    drawing_id: str,
    dxf_path: Path,
    unit_scale_m: float,
    room_rows: list[dict[str, Any]],
) -> dict[str, Any]:
    """BIM-75: зберегти виходи й проходи (двері), знайдені в DXF.

    Виходи й проходи з source = dxf замінюються ОДНИМ викликом функції БД
    ``replace_dxf_layout`` (одна транзакція): або замінено все, або при будь-якій
    помилці лишається попередній набір. Позначені вручну лишаються; оновлюється
    лише їхній зв'язок із приміщенням, бо приміщення при обробці створюються заново.

    Пошук виходів не повинен ламати розпізнавання приміщень, тому збій не
    піднімається, а повертається станом кроку (``exit_detection`` у відповіді
    /process) із попередженням, а не лише в логах.
    """
    try:
        document = read_dxf_document(dxf_path)
        modelspace = document.modelspace()
        detected = find_exit_points(modelspace, unit_scale_m)
        doors = find_door_points(modelspace, unit_scale_m, detected)
        rooms = rooms_from_rows(room_rows)

        exit_rows = [
            {
                "id": str(uuid4()),
                "room_id": room_id_near_exit((item.x, item.y), rooms, unit_scale_m),
                "name": item.name,
                "x": item.x,
                "y": item.y,
            }
            for item in detected
        ]
        passage_rows = [
            {"id": str(uuid4()), "name": None, "x": door.x, "y": door.y}
            for door in doors
        ]

        manual = (
            supabase.table("exits")
            .select("*")
            .eq("drawing_id", drawing_id)
            .eq("source", "manual")
            .execute()
        )
        manual_links: list[dict[str, Any]] = []
        for row in manual.data if isinstance(manual.data, list) else []:
            if not isinstance(row, dict):
                continue
            room_id = room_id_near_exit(
                (float(row["x"]), float(row["y"])), rooms, unit_scale_m
            )
            if room_id != row.get("room_id"):
                manual_links.append({"id": str(row["id"]), "room_id": room_id})

        supabase.rpc(
            "replace_dxf_layout",
            {
                "p_drawing_id": drawing_id,
                "p_exits": exit_rows,
                "p_passages": passage_rows,
                "p_manual_exit_rooms": manual_links,
            },
        ).execute()
    except Exception:
        logger.warning(
            "Exit detection failed for drawing %s", drawing_id, exc_info=True
        )
        return {
            "status": EXIT_DETECTION_FAILED,
            "exits": None,
            "passages": None,
            "warning": WARNING_EXIT_DETECTION_FAILED,
        }
    return {
        "status": EXIT_DETECTION_OK,
        "exits": len(exit_rows),
        "passages": len(passage_rows),
        "warning": None,
    }


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
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Drawing not found",
        )

    if drawing_data.get("owner_id") != current_user.id and current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden",
        )

    input_tmp_path: Path | None = None
    try:
        storage_path = drawing_data.get("storage_path")
        if not storage_path or not isinstance(storage_path, str):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Drawing is missing storage_path",
            )

        input_tmp_path = download_dxf_to_tmp(storage_path, client=supabase)

        resolved_drawing_id: UUID | None = None
        try:
            resolved_drawing_id = UUID(drawing_id)
        except (ValueError, TypeError):
            pass

        rooms, unit_scale_m = parse_dxf_rooms_with_scale(
            input_tmp_path, drawing_id=resolved_drawing_id
        )

        supabase.table("rooms").delete().eq("drawing_id", drawing_id).execute()

        default_source = getattr(rooms, "source", "auto")
        room_rows = [
            {
                "id": str(r.id),
                "drawing_id": drawing_id,
                "name": r.name,
                "type": r.type,
                "height": r.height,
                "area": float(r.area),
                "polygon": [{"x": p.x, "y": p.y} for p in r.polygon],
                "source": r.source.value if r.source is not None else default_source,
                "confirmed": bool(getattr(r, "confirmed", False)),
            }
            for r in rooms
        ]
        if room_rows:
            supabase.table("rooms").insert(room_rows).execute()

        exit_detection = _save_dxf_layout(
            supabase, drawing_id, input_tmp_path, unit_scale_m, room_rows
        )

        # unit_scale_m (migration 007) lets manual room edits compute areas
        # even after every parsed room has been deleted.
        supabase.table("drawings").update(
            {"status": "processing", "unit_scale_m": unit_scale_m}
        ).eq("id", drawing_id).execute()

        return {
            "drawing_id": drawing_id,
            "status": "processing",
            # Окремий стан кроку «виходи й проходи»: збій тут не ламає розпізнавання
            # приміщень, але не лишається непомітним.
            "exit_detection": exit_detection,
        }
    except Exception as exc:
        try:
            supabase.table("drawings").update({"status": "error"}).eq(
                "id", drawing_id
            ).execute()
        except Exception:
            pass

        if isinstance(exc, (HTTPException, BIMException)):
            raise
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Drawing processing failed: {exc}",
        ) from exc
    finally:
        cleanup_file(input_tmp_path)


@router.post("/{drawing_id}/place")
async def place_drawing_devices(
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
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Drawing not found",
        )

    if drawing_data.get("owner_id") != current_user.id and current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden",
        )

    try:
        rooms_response = (
            supabase.table("rooms").select("*").eq("drawing_id", drawing_id).execute()
        )
        rooms_data = rooms_response.data
        if not isinstance(rooms_data, list) or len(rooms_data) == 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No rooms found for this drawing",
            )

        rules_response = supabase.table("rules").select("*").execute()
        rule_rows = (
            [row for row in rules_response.data if isinstance(row, dict)]
            if isinstance(rules_response.data, list)
            else []
        )
        if not rule_rows:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No fire safety rules available",
            )

        zones_response = (
            supabase.table("room_zones")
            .select("*")
            .eq("drawing_id", drawing_id)
            .execute()
        )
        zone_rows = (
            [row for row in zones_response.data if isinstance(row, dict)]
            if isinstance(zones_response.data, list)
            else []
        )

        # BIM-73: правило береться за висотою приміщення або його зони. Немає
        # висоти чи правила — приладів немає, статус «недостатньо даних».
        outcomes = place_targets(
            build_placement_targets(
                [room for room in rooms_data if isinstance(room, dict)], zone_rows
            ),
            rule_rows,
            device_type="smoke_detector",
            unit_scale_m=stored_unit_scale_m(drawing_data),
        )

        new_device_rows: list[dict[str, Any]] = [
            {
                "id": str(uuid4()),
                "drawing_id": drawing_id,
                "room_id": outcome.target.room_id,
                "rule_id": str(placed.rule_id),
                "type": "smoke_detector",
                "layer": "SYS_FIRE_SENSORS",
                "x": float(placed.x),
                "y": float(placed.y),
            }
            for outcome in outcomes
            for placed in outcome.devices
        ]

        # BIM-75: ручні сповіщувачі біля евакуаційних виходів і на шляхах евакуації.
        # Немає виходів — їх не розміщуємо й повертаємо «Позначте евакуаційні виходи».
        exits_response = (
            supabase.table("exits").select("*").eq("drawing_id", drawing_id).execute()
        )
        exit_rows = (
            [row for row in exits_response.data if isinstance(row, dict)]
            if isinstance(exits_response.data, list)
            else []
        )
        # Проходи (двері з DXF і підтверджені інженером) — єдине, що з'єднує
        # приміщення в маршруті евакуації: близькі контури проходу не доводять.
        passages_response = (
            supabase.table("passages")
            .select("*")
            .eq("drawing_id", drawing_id)
            .execute()
        )
        passage_rows = (
            [row for row in passages_response.data if isinstance(row, dict)]
            if isinstance(passages_response.data, list)
            else []
        )
        call_points = place_manual_call_points(
            rooms=rooms_from_rows([r for r in rooms_data if isinstance(r, dict)]),
            exits=exits_from_rows(exit_rows),
            rule_rows=rule_rows,
            unit_scale_m=stored_unit_scale_m(drawing_data),
            passages=passages_from_rows(passage_rows),
        )
        if call_points.rule is not None:
            new_device_rows.extend(
                {
                    "id": str(uuid4()),
                    "drawing_id": drawing_id,
                    "room_id": placed.room_id,
                    "rule_id": call_points.rule.id,
                    "type": "manual_call_point",
                    "layer": MCP_LAYER_NAME,
                    "x": float(placed.x),
                    "y": float(placed.y),
                }
                for placed in call_points.devices
            )

        supabase.table("devices").delete().eq("drawing_id", drawing_id).execute()

        if new_device_rows:
            supabase.table("devices").insert(new_device_rows).execute()

        supabase.table("drawings").update({"status": "processed"}).eq(
            "id", drawing_id
        ).execute()

        result_storage_path = generate_and_upload_result_dxf(drawing_id, supabase)

        return {
            "drawing_id": drawing_id,
            "status": "processed",
            "result_path": result_storage_path,
            "placements": [describe_outcome(outcome) for outcome in outcomes],
            # `status: processed` лише каже, що крок розміщення завершено. Чи
            # оброблено все креслення, показує placement_status; пропущені
            # приміщення/зони з причинами — у skipped.
            **summarize_outcomes(outcomes),
            "manual_call_points": describe_call_point_outcome(call_points),
        }
    except Exception as exc:
        try:
            supabase.table("drawings").update({"status": "error"}).eq(
                "id", drawing_id
            ).execute()
        except Exception:
            pass

        if isinstance(exc, (HTTPException, BIMException)):
            raise
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Device placement failed: {exc}",
        ) from exc


@router.get(
    "/{drawing_id}",
    response_model=DrawingResult | DrawingDetailResponse,
)
async def get_drawing_detail(
    drawing_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    supabase: Annotated[Client | None, Depends(get_supabase_client)] = None,
) -> DrawingResult | DrawingDetailResponse:
    if supabase is None:
        supabase = get_supabase_client(settings)

    drawing_response = (
        supabase.table("drawings").select("*").eq("id", drawing_id).single().execute()
    )

    drawing_data = drawing_response.data
    if not isinstance(drawing_data, dict):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Drawing not found",
        )

    if drawing_data.get("owner_id") != current_user.id and current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden",
        )

    status_raw = str(drawing_data.get("status") or "uploaded")

    expires_in = 3600
    now = datetime.now(UTC)
    storage_path = str(drawing_data.get("storage_path") or "")
    source_download_url: str | None = None
    source_download_url_expires_at: datetime | None = None

    if storage_path:
        try:
            url_resp = supabase.storage.from_(
                settings.SUPABASE_STORAGE_BUCKET
            ).create_signed_url(storage_path, expires_in)

            raw_url = None
            if isinstance(url_resp, dict):
                raw_url = (
                    url_resp.get("signedUrl")
                    or url_resp.get("signedURL")
                    or url_resp.get("url")
                )
            elif hasattr(url_resp, "signedUrl") or hasattr(url_resp, "signedURL"):
                raw_url = getattr(url_resp, "signedUrl", None) or getattr(
                    url_resp, "signedURL", None
                )

            if raw_url and isinstance(raw_url, str):
                if raw_url.startswith("/"):
                    raw_url = f"{settings.SUPABASE_URL.rstrip('/')}{raw_url}"
                source_download_url = raw_url
                source_download_url_expires_at = now + timedelta(seconds=expires_in)
        except Exception:
            source_download_url = None
            source_download_url_expires_at = None

    if status_raw in {"processing", "processed", "error", "failed"}:
        drawing = _map_db_to_drawing(drawing_data)

        rooms: list[Room] = []
        devices: list[Device] = []
        download_url: AnyUrl | None = None
        download_url_expires_at: datetime | None = None

        rooms_res = (
            supabase.table("rooms").select("*").eq("drawing_id", drawing_id).execute()
        )
        if isinstance(rooms_res.data, list):
            for r in rooms_res.data:
                if not isinstance(r, dict) or len(row_points(r)) < 3:
                    continue
                rooms.append(room_from_row(r))

        devices_res = (
            supabase.table("devices").select("*").eq("drawing_id", drawing_id).execute()
        )
        if status_raw == "processed" and isinstance(devices_res.data, list):
            for d in devices_res.data:
                if not isinstance(d, dict):
                    continue
                x_val: float | None = None
                y_val: float | None = None
                if "x" in d and "y" in d and d["x"] is not None and d["y"] is not None:
                    x_val = float(d["x"])
                    y_val = float(d["y"])
                elif "position" in d and isinstance(d["position"], dict):
                    pos = d["position"]
                    if (
                        "x" in pos
                        and "y" in pos
                        and pos["x"] is not None
                        and pos["y"] is not None
                    ):
                        x_val = float(pos["x"])
                        y_val = float(pos["y"])

                if x_val is None or y_val is None:
                    continue

                dev_type_str = str(d.get("type", "smoke_detector"))
                try:
                    dev_type = Type(dev_type_str)
                except ValueError:
                    dev_type = Type.smoke_detector

                devices.append(
                    Device(
                        id=str(d["id"]),
                        drawingId=UUID(str(d["drawing_id"])),
                        roomId=str(d["room_id"]) if d.get("room_id") else None,
                        type=dev_type,
                        position=Point(x=x_val, y=y_val),
                        layer=str(d.get("layer") or "SYS_FIRE_SENSORS"),
                    )
                )

        if status_raw == "processed" and drawing_data.get("error_message") != (
            "Device changes saved; result DXF needs regeneration"
        ):
            expires_in = 3600
            now = datetime.now(UTC)
            result_path = f"{drawing.ownerId}/{drawing.id}/result.dxf"
            try:
                url_resp = supabase.storage.from_(
                    settings.SUPABASE_STORAGE_BUCKET
                ).create_signed_url(result_path, expires_in)

                raw_url = None
                if isinstance(url_resp, dict):
                    raw_url = (
                        url_resp.get("signedUrl")
                        or url_resp.get("signedURL")
                        or url_resp.get("url")
                    )
                elif hasattr(url_resp, "signedUrl") or hasattr(url_resp, "signedURL"):
                    raw_url = getattr(url_resp, "signedUrl", None) or getattr(
                        url_resp, "signedURL", None
                    )

                if raw_url and isinstance(raw_url, str):
                    if raw_url.startswith("/"):
                        raw_url = f"{settings.SUPABASE_URL.rstrip('/')}{raw_url}"
                    download_url = AnyUrl(raw_url)
                    download_url_expires_at = now + timedelta(seconds=expires_in)
            except Exception:
                download_url = None
                download_url_expires_at = None

        return DrawingResult(
            sourceDownloadUrl=AnyUrl(source_download_url)
            if source_download_url
            else None,
            sourceDownloadUrlExpiresAt=source_download_url_expires_at,
            drawing=drawing,
            rooms=rooms,
            devices=devices,
            downloadUrl=download_url,
            downloadUrlExpiresAt=download_url_expires_at,
        )

    # Flat DrawingDetailResponse format for unprocessed drawings
    created_at_val = drawing_data["created_at"]
    if isinstance(created_at_val, str):
        dt = datetime.fromisoformat(created_at_val.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
    elif isinstance(created_at_val, datetime):
        dt = created_at_val
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
    else:
        dt = datetime.now(UTC)

    return DrawingDetailResponse(
        id=str(drawing_data["id"]),
        owner_id=str(drawing_data["owner_id"]),
        original_file_name=str(drawing_data["original_file_name"]),
        storage_path=storage_path,
        units=str(drawing_data.get("units") or "mm"),
        status=drawing_data.get("status") or "uploaded",
        created_at=dt,
        source_download_url=source_download_url,
        source_download_url_expires_at=source_download_url_expires_at,
    )
