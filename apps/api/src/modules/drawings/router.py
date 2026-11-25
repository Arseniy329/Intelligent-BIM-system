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
from src.modules.cad.writer import MCP_LAYER_NAME, SOUNDER_LAYER_NAME
from src.modules.drawings.schemas import (
    CreateDrawingRequest,
    CreateDrawingResponse,
    DrawingDetailResponse,
    DrawingListItem,
    DrawingRecord,
    DrawingResultWithReport,
)
from src.modules.drawings.service import (
    generate_and_upload_result_dxf,
    get_unit_scale_m,
    is_missing_schema_error,
    list_drawings_for_user,
    stored_unit_scale_m,
)
from src.modules.placement.manual_call_points import (
    describe_call_point_outcome,
    exits_from_rows,
    passage_room_pair,
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


_is_missing_schema_error = is_missing_schema_error


def _select_drawing_rows_strict(
    supabase: Client, table_name: str, drawing_id: str
) -> list[dict[str, Any]]:
    """Select rows for drawing_id, raising 503 if Sprint 4 schema is missing."""
    try:
        response = (
            supabase.table(table_name)
            .select("*")
            .eq("drawing_id", drawing_id)
            .execute()
        )
    except Exception as exc:
        if _is_missing_schema_error(exc):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=(
                    f"Database table '{table_name}' is unavailable "
                    "(apply Sprint 4 migrations)."
                ),
            ) from exc
        raise
    return (
        [row for row in response.data if isinstance(row, dict)]
        if isinstance(response.data, list)
        else []
    )


def _is_undefined_column_error(exc: Exception) -> bool:
    """Return True if exc carries PostgreSQL SQLSTATE 42703 (undefined_column)."""
    parts = [str(exc)]
    for attr in ("code", "message", "details", "hint"):
        val = getattr(exc, attr, None)
        if val is not None:
            parts.append(str(val))
    for arg in getattr(exc, "args", ()):
        parts.append(str(arg))
    return "42703" in " ".join(parts)


def _ensure_column_exists(
    supabase: Client, table_name: str, column_name: str, drawing_id: str
) -> None:
    """Verify a migrated column exists before mutating devices or result DXF."""
    try:
        supabase.table(table_name).select(column_name).eq("id", drawing_id).limit(
            1
        ).execute()
    except Exception as exc:
        if _is_missing_schema_error(exc) or _is_undefined_column_error(exc):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=(
                    f"Database column '{table_name}.{column_name}' is unavailable "
                    "(apply Sprint 4 migrations)."
                ),
            ) from exc
        raise


def _update_processing_drawing_status(
    supabase: Client,
    drawing_id: str,
    unit_scale_m: float,
    placement_report: dict[str, Any] | None,
) -> None:
    """Persist processing status, preserving unit_scale_m when possible."""
    try:
        supabase.table("drawings").update(
            {
                "status": "processing",
                "unit_scale_m": unit_scale_m,
                "placement_report": placement_report,
            }
        ).eq("id", drawing_id).execute()
        return
    except Exception as exc:
        if not _is_missing_schema_error(exc):
            raise
        logger.warning(
            "Drawing %s update retrying without placement_report: %s",
            drawing_id,
            exc,
        )

    try:
        supabase.table("drawings").update(
            {"status": "processing", "unit_scale_m": unit_scale_m}
        ).eq("id", drawing_id).execute()
        return
    except Exception as exc:
        if not _is_missing_schema_error(exc):
            raise
        logger.warning(
            "Drawing %s update falling back to status=processing (missing schema): %s",
            drawing_id,
            exc,
        )

    supabase.table("drawings").update({"status": "processing"}).eq(
        "id", drawing_id
    ).execute()


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

    Кожні двері зберігаються разом із парою приміщень, які вони з'єднують (з
    геометрії; без однозначної пари — без пари). Приміщення при обробці створюються
    заново, тож проходи зі старої обробки втрачають пару (``on delete set null``) і
    не підтверджують маршрути для нових контурів, навіть якщо цей запис не вдався.

    Пошук виходів не повинен ламати розпізнавання приміщень, тому збій не
    піднімається, а повертається станом кроку (``exit_detection`` у відповіді
    /process) із попередженням, а не лише в логах. Збій також зберігається разом зі
    звітом креслення (див. ``process_drawing``), щоб попередження не зникло після
    перезавантаження.
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
        passage_rows = []
        for door in doors:
            pair = passage_room_pair((door.x, door.y), rooms, unit_scale_m)
            passage_rows.append(
                {
                    "id": str(uuid4()),
                    "name": None,
                    "x": door.x,
                    "y": door.y,
                    "room_a_id": pair[0] if pair else None,
                    "room_b_id": pair[1] if pair else None,
                }
            )

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

        # Позначені вручну проходи лишаються, але пару приміщень для нових контурів
        # визначаємо знову: однозначна — прив'язуємо, ні — прохід чекає підтвердження.
        manual_passages = (
            supabase.table("passages")
            .select("*")
            .eq("drawing_id", drawing_id)
            .eq("source", "manual")
            .execute()
        )
        manual_passage_links: list[dict[str, Any]] = []
        for row in (
            manual_passages.data if isinstance(manual_passages.data, list) else []
        ):
            if not isinstance(row, dict):
                continue
            pair = passage_room_pair(
                (float(row["x"]), float(row["y"])), rooms, unit_scale_m
            )
            manual_passage_links.append(
                {
                    "id": str(row["id"]),
                    "room_a_id": pair[0] if pair else None,
                    "room_b_id": pair[1] if pair else None,
                }
            )

        supabase.rpc(
            "replace_dxf_layout",
            {
                "p_drawing_id": drawing_id,
                "p_exits": exit_rows,
                "p_passages": passage_rows,
                "p_manual_exit_rooms": manual_links,
                "p_manual_passage_rooms": manual_passage_links,
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


def _stale_layout_report(drawing_data: dict[str, Any]) -> dict[str, Any] | None:
    """Збій оновлення виходів і проходів після останньої обробки, якщо він був.

    Доки обробку не виконано успішно, DXF-виходи й проходи в БД можуть бути зі старої
    обробки. Проходи без пари приміщень маршрути не підтверджують, але інженер має
    бачити причину й у звіті розміщення.
    """
    report = drawing_data.get("placement_report")
    if not isinstance(report, dict):
        return None
    layout = report.get("exit_detection")
    if isinstance(layout, dict) and layout.get("status") == EXIT_DETECTION_FAILED:
        return layout
    return None


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
        # Приміщення створено заново, тож звіт попереднього розміщення втратив
        # чинність. Замість нього лишається лише збій кроку «виходи й проходи»:
        # він не повинен зникнути після перезавантаження, і /place переносить його
        # у свій звіт, доки обробку не виконано успішно.
        _update_processing_drawing_status(
            supabase,
            drawing_id,
            unit_scale_m,
            (
                None
                if exit_detection["status"] == EXIT_DETECTION_OK
                else {"exit_detection": exit_detection}
            ),
        )

        return {
            "drawing_id": drawing_id,
            "status": "processing",
            # Окремий стан кроку «виходи й проходи»: збій тут не ламає розпізнавання
            # приміщень, але не лишається непомітним.
            "exit_detection": exit_detection,
        }
    except Exception as exc:
        if not (
            isinstance(exc, HTTPException)
            and exc.status_code == status.HTTP_503_SERVICE_UNAVAILABLE
        ):
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

        zone_rows = _select_drawing_rows_strict(supabase, "room_zones", drawing_id)
        exit_rows = _select_drawing_rows_strict(supabase, "exits", drawing_id)
        passage_rows = _select_drawing_rows_strict(supabase, "passages", drawing_id)
        _ensure_column_exists(supabase, "drawings", "placement_report", drawing_id)

        # BIM-73: правило береться за висотою приміщення або його зони. Немає
        # висоти чи правила — приладів немає, статус «недостатньо даних».
        unit_scale_m = stored_unit_scale_m(drawing_data)
        if unit_scale_m is None:
            unit_scale_m = get_unit_scale_m(drawing_data, supabase)
        placement_targets = build_placement_targets(
            [room for room in rooms_data if isinstance(room, dict)], zone_rows
        )
        outcomes = place_targets(
            placement_targets,
            rule_rows,
            device_type="smoke_detector",
            unit_scale_m=unit_scale_m,
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

        # BIM-76: оповіщувачі (sounder) за правилом із rules — у кожному приміщенні
        # чи зоні, на ОКРЕМОМУ шарі SYS_FIRE_SOUNDERS, кожен із посиланням на правило.
        # Сітку розміщення використовуємо повторно (та сама, що для сповіщувачів).
        # Окреме правило для спальних приміщень обирається за room_type всередині
        # select_rule_for_room. Немає правила-відстані для оповіщувачів — їх просто
        # не розміщуємо (у звіті статус «недостатньо даних» з причиною).
        sounder_outcomes = place_targets(
            placement_targets,
            rule_rows,
            device_type="sounder",
            unit_scale_m=unit_scale_m,
        )
        new_device_rows.extend(
            {
                "id": str(uuid4()),
                "drawing_id": drawing_id,
                "room_id": outcome.target.room_id,
                "rule_id": str(placed.rule_id),
                "type": "sounder",
                "layer": SOUNDER_LAYER_NAME,
                "x": float(placed.x),
                "y": float(placed.y),
            }
            for outcome in sounder_outcomes
            for placed in outcome.devices
        )

        call_points = place_manual_call_points(
            rooms=rooms_from_rows([r for r in rooms_data if isinstance(r, dict)]),
            exits=exits_from_rows(exit_rows),
            rule_rows=rule_rows,
            unit_scale_m=unit_scale_m,
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

        # `status: processed` лише каже, що крок розміщення завершено. Чи оброблено
        # все креслення, показує placement_status; пропущені приміщення/зони з
        # причинами — у skipped; стан ручних сповіщувачів і шляхів евакуації — у
        # manual_call_points. Звіт пишеться тим самим UPDATE, що й статус, і
        # повертається в GET: після перезавантаження жодне попередження не зникає.
        placement_report: dict[str, Any] = {
            **summarize_outcomes(outcomes),
            "manual_call_points": describe_call_point_outcome(call_points),
        }
        # BIM-76: стан оповіщувачів у звіті — ЗАВЖДИ (оповіщувачі очікуються в
        # запуску), окремою секцією. Нуль приладів без правила-відстані дає
        # placement_status=insufficient_data з причиною на рівні типу приладу, а не
        # мовчазний пропуск, який читався б як «усе гаразд». `needs_review` відділяє
        # «сітку побудовано» від «правило підтверджено»: крок переведено з рівня
        # звуку попередньо (BIM-124/BIM-169), тож `complete` НЕ означає, що акустичне
        # покриття перевірено.
        applied_sounder_rules = [
            outcome.rule for outcome in sounder_outcomes if outcome.rule is not None
        ]
        placement_report["sounders"] = {
            **summarize_outcomes(sounder_outcomes),
            "needs_review": any(
                rule.status != "verified" for rule in applied_sounder_rules
            ),
        }
        stale_layout = _stale_layout_report(drawing_data)
        if stale_layout is not None:
            # Збій оновлення виходів і проходів після останньої обробки лишається
            # видимим, доки обробку не виконано успішно.
            placement_report["exit_detection"] = stale_layout
        supabase.table("drawings").update(
            {"status": "processed", "placement_report": placement_report}
        ).eq("id", drawing_id).execute()

        result_storage_path = generate_and_upload_result_dxf(drawing_id, supabase)

        return {
            "drawing_id": drawing_id,
            "status": "processed",
            "result_path": result_storage_path,
            "placements": [describe_outcome(outcome) for outcome in outcomes],
            **placement_report,
        }
    except Exception as exc:
        if not (
            isinstance(exc, HTTPException)
            and exc.status_code == status.HTTP_503_SERVICE_UNAVAILABLE
        ):
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
    response_model=DrawingResultWithReport | DrawingResult | DrawingDetailResponse,
)
async def get_drawing_detail(
    drawing_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    supabase: Annotated[Client | None, Depends(get_supabase_client)] = None,
) -> DrawingResultWithReport | DrawingResult | DrawingDetailResponse:
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
                        ruleId=str(d["rule_id"]) if d.get("rule_id") else None,
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

        # Звіт останнього розміщення належить лише готовому результату (processed)
        # або проміжному стану після /process; після помилки він застарів.
        stored_report = drawing_data.get("placement_report")
        placement_report = (
            stored_report
            if isinstance(stored_report, dict)
            and status_raw in {"processing", "processed"}
            else None
        )

        result_fields: dict[str, Any] = {
            "sourceDownloadUrl": AnyUrl(source_download_url)
            if source_download_url
            else None,
            "sourceDownloadUrlExpiresAt": source_download_url_expires_at,
            "drawing": drawing,
            "rooms": rooms,
            "devices": devices,
            "downloadUrl": download_url,
            "downloadUrlExpiresAt": download_url_expires_at,
        }
        if placement_report is None:
            # Без звіту відповідь байт-у-байт збігається з контрактом DrawingResult.
            return DrawingResult(**result_fields)
        return DrawingResultWithReport(
            **result_fields, placementReport=placement_report
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
