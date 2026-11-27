"""BIM-75: евакуаційні виходи й проходи — перегляд і позначка на плані (BIM-182).

Виходи з креслення (шар EXITS або підпис «Вихід») потрапляють сюди під час обробки
креслення (source = dxf); інженер додає або прибирає виходи на плані (source = manual).
Ручні сповіщувачі розміщуються біля цих виходів (POST /drawings/{id}/place).

Проходи — двері між приміщеннями (з креслення або підтверджені інженером). Без проходу
маршрут евакуації з одного приміщення в інше не будується, навіть якщо контури близькі.
"""

from datetime import UTC, datetime
from typing import Annotated, Any
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Response, status
from supabase import Client

from src.contracts.generated import Point
from src.core.auth import CurrentUser, get_current_user
from src.infrastructure.supabase import get_supabase_client
from src.modules.drawings.access import all_rows, first_row, get_drawing_for_user
from src.modules.drawings.service import stored_unit_scale_m
from src.modules.exits.schemas import (
    Exit,
    ExitCreateRequest,
    ExitSource,
    Passage,
    PassageCreateRequest,
)
from src.modules.findings.service import evaluate_and_persist_findings
from src.modules.placement.manual_call_points import (
    passage_at_rooms,
    passage_room_pair,
    room_id_near_exit,
    rooms_from_rows,
)

router = APIRouter(tags=["exits"])

PASSAGE_ROOMS_UNKNOWN = (
    "Не вдалося однозначно визначити два приміщення, які з'єднує прохід. Позначте "
    "точку в стіні між приміщеннями або вкажіть roomIds"
)
PASSAGE_ROOMS_INVALID = (
    "roomIds мають бути двома різними приміщеннями цього креслення, стіни яких "
    "підходять до точки проходу"
)


def exit_from_row(row: dict[str, Any]) -> Exit:
    """Map a ``public.exits`` row to the Exit model."""
    try:
        source = ExitSource(str(row.get("source")))
    except ValueError:
        source = ExitSource.manual
    return Exit(
        id=str(row["id"]),
        drawingId=UUID(str(row["drawing_id"])),
        roomId=str(row["room_id"]) if row.get("room_id") else None,
        name=row.get("name"),
        position=Point(x=float(row["x"]), y=float(row["y"])),
        source=source,
    )


@router.get("/drawings/{drawing_id}/exits", response_model=list[Exit])
async def list_exits(
    drawing_id: UUID,
    supabase: Annotated[Client, Depends(get_supabase_client)],
    current_user: CurrentUser = Depends(get_current_user),
) -> list[Exit]:
    """Усі виходи креслення: знайдені в DXF і позначені інженером."""
    get_drawing_for_user(supabase, drawing_id, current_user)
    rows = all_rows(
        supabase.table("exits").select("*").eq("drawing_id", str(drawing_id)).execute()
    )
    rows.sort(key=lambda row: (str(row.get("created_at") or ""), str(row.get("id"))))
    return [exit_from_row(row) for row in rows]


@router.post(
    "/drawings/{drawing_id}/exits",
    response_model=Exit,
    status_code=status.HTTP_201_CREATED,
)
async def create_exit(
    drawing_id: UUID,
    payload: ExitCreateRequest,
    supabase: Annotated[Client, Depends(get_supabase_client)],
    current_user: CurrentUser = Depends(get_current_user),
) -> Exit:
    """Інженер позначає двері на плані як евакуаційний вихід."""
    drawing = get_drawing_for_user(supabase, drawing_id, current_user)

    room_rows = all_rows(
        supabase.table("rooms").select("*").eq("drawing_id", str(drawing_id)).execute()
    )
    room_id = room_id_near_exit(
        (payload.position.x, payload.position.y),
        rooms_from_rows(room_rows),
        stored_unit_scale_m(drawing),
    )

    values: dict[str, Any] = {
        "id": str(uuid4()),
        "drawing_id": str(drawing_id),
        "room_id": room_id,
        "name": payload.name or None,
        "x": payload.position.x,
        "y": payload.position.y,
        "source": ExitSource.manual.value,
        "created_at": datetime.now(UTC).isoformat(),
    }
    inserted = first_row(supabase.table("exits").insert(values).execute())
    evaluate_and_persist_findings(supabase, str(drawing_id), drawing_row=drawing)
    return exit_from_row(inserted if inserted is not None else values)


@router.delete("/exits/{exit_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_exit(
    exit_id: UUID,
    supabase: Annotated[Client, Depends(get_supabase_client)],
    current_user: CurrentUser = Depends(get_current_user),
) -> Response:
    """Прибрати вихід (знайдений у DXF або позначений вручну)."""
    exit_row = first_row(
        supabase.table("exits").select("*").eq("id", str(exit_id)).limit(1).execute()
    )
    if exit_row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Exit not found"
        )
    drawing_id = str(exit_row["drawing_id"])
    drawing = get_drawing_for_user(supabase, drawing_id, current_user)

    supabase.table("exits").delete().eq("id", str(exit_id)).execute()
    evaluate_and_persist_findings(supabase, drawing_id, drawing_row=drawing)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def passage_from_row(row: dict[str, Any]) -> Passage:
    """Map a ``public.passages`` row to the Passage model."""
    try:
        source = ExitSource(str(row.get("source")))
    except ValueError:
        source = ExitSource.manual
    first, second = row.get("room_a_id"), row.get("room_b_id")
    return Passage(
        id=str(row["id"]),
        drawingId=UUID(str(row["drawing_id"])),
        name=row.get("name"),
        position=Point(x=float(row["x"]), y=float(row["y"])),
        source=source,
        # Пара є лише повна: з однією стороною прохід нічого не з'єднує.
        roomIds=[str(first), str(second)] if first and second else [],
    )


@router.get("/drawings/{drawing_id}/passages", response_model=list[Passage])
async def list_passages(
    drawing_id: UUID,
    supabase: Annotated[Client, Depends(get_supabase_client)],
    current_user: CurrentUser = Depends(get_current_user),
) -> list[Passage]:
    """Усі проходи креслення: двері з DXF і підтверджені інженером."""
    get_drawing_for_user(supabase, drawing_id, current_user)
    rows = all_rows(
        supabase.table("passages")
        .select("*")
        .eq("drawing_id", str(drawing_id))
        .execute()
    )
    rows.sort(key=lambda row: (str(row.get("created_at") or ""), str(row.get("id"))))
    return [passage_from_row(row) for row in rows]


@router.post(
    "/drawings/{drawing_id}/passages",
    response_model=Passage,
    status_code=status.HTTP_201_CREATED,
)
async def create_passage(
    drawing_id: UUID,
    payload: PassageCreateRequest,
    supabase: Annotated[Client, Depends(get_supabase_client)],
    current_user: CurrentUser = Depends(get_current_user),
) -> Passage:
    """Інженер підтверджує прохід (двері або отвір) між двома приміщеннями на плані.

    Прохід з'єднує рівно два приміщення. Їх називає інженер (``roomIds``) або вони
    визначаються з креслення, якщо пара однозначна. Інакше — 422: прохід без пари
    нічого б не підтвердив, а вгадувати сторону не можна.
    """
    drawing = get_drawing_for_user(supabase, drawing_id, current_user)

    rooms = rooms_from_rows(
        all_rows(
            supabase.table("rooms")
            .select("*")
            .eq("drawing_id", str(drawing_id))
            .execute()
        )
    )
    point = (payload.position.x, payload.position.y)
    scale = stored_unit_scale_m(drawing)
    if payload.roomIds is not None:
        named = (payload.roomIds[0], payload.roomIds[1])
        if not passage_at_rooms(point, named, rooms, scale):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=PASSAGE_ROOMS_INVALID,
            )
        pair = named
    else:
        derived = passage_room_pair(point, rooms, scale)
        if derived is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=PASSAGE_ROOMS_UNKNOWN,
            )
        pair = derived

    values: dict[str, Any] = {
        "id": str(uuid4()),
        "drawing_id": str(drawing_id),
        "name": payload.name or None,
        "x": payload.position.x,
        "y": payload.position.y,
        "source": ExitSource.manual.value,
        "room_a_id": pair[0],
        "room_b_id": pair[1],
        "created_at": datetime.now(UTC).isoformat(),
    }
    inserted = first_row(supabase.table("passages").insert(values).execute())
    evaluate_and_persist_findings(supabase, str(drawing_id), drawing_row=drawing)
    return passage_from_row(inserted if inserted is not None else values)


@router.delete("/passages/{passage_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_passage(
    passage_id: UUID,
    supabase: Annotated[Client, Depends(get_supabase_client)],
    current_user: CurrentUser = Depends(get_current_user),
) -> Response:
    """Прибрати прохід (знайдений у DXF або підтверджений вручну)."""
    row = first_row(
        supabase.table("passages")
        .select("*")
        .eq("id", str(passage_id))
        .limit(1)
        .execute()
    )
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Passage not found"
        )
    drawing_id = str(row["drawing_id"])
    drawing = get_drawing_for_user(supabase, drawing_id, current_user)

    supabase.table("passages").delete().eq("id", str(passage_id)).execute()
    evaluate_and_persist_findings(supabase, drawing_id, drawing_row=drawing)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
