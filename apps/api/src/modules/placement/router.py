from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from src.core.auth import CurrentUser, get_current_user
from src.core.config import Settings, get_settings
from src.infrastructure.supabase import get_supabase_client_for_settings
from src.modules.placement.service import (
    place_devices_from_rule,
    select_rule_for_room,
)

router = APIRouter(prefix="/placement", tags=["placement"])


class PlacementRequest(BaseModel):
    # Можна передати UUID rules.id або текстовий rules.rule_id.
    rule_id: str | None = None
    device_type: str = "smoke_detector"
    room_type: str | None = None
    room_height_m: float | None = Field(default=None, gt=0)
    room_id: str | None = None
    polygon: list[list[float]] = Field(..., min_length=3)


class DeviceResponse(BaseModel):
    x: float
    y: float
    rule_id: str


class AppliedRuleResponse(BaseModel):
    id: str
    rule_id: str
    name: str
    value: float
    value_kind: str
    document: str | None = None
    clause: str | None = None
    source_url: str | None = None
    verification_status: str


class PlacementResponse(BaseModel):
    devices: list[DeviceResponse]
    rule: AppliedRuleResponse


@router.post("/compute", response_model=PlacementResponse)
async def compute_placement(
    payload: PlacementRequest,
    current_user: CurrentUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    del current_user
    supabase = get_supabase_client_for_settings(settings)
    rule_rows: list[dict] = []

    if payload.rule_id:
        by_uuid = (
            supabase.table("rules")
            .select("*")
            .eq("id", payload.rule_id)
            .execute()
        )
        result = by_uuid.data if isinstance(by_uuid.data, list) else []
        rule_rows = [row for row in result if isinstance(row, dict)]

        if not rule_rows:
            by_code = (
                supabase.table("rules")
                .select("*")
                .eq("rule_id", payload.rule_id)
                .execute()
            )
            result = by_code.data if isinstance(by_code.data, list) else []
            rule_rows = [row for row in result if isinstance(row, dict)]
    else:
        response = supabase.table("rules").select("*").execute()
        result = response.data if isinstance(response.data, list) else []
        rule_rows = [row for row in result if isinstance(row, dict)]

    rule = select_rule_for_room(
        rule_rows,
        device_type=payload.device_type,
        room_type=payload.room_type,
        room_height_m=payload.room_height_m,
        value_kind="max_grid_spacing_m",
    )

    if rule is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                "No applicable spacing rule found. "
                "Sound-level rules do not define device spacing."
            ),
        )

    polygon = [(float(point[0]), float(point[1])) for point in payload.polygon]
    try:
        points = place_devices_from_rule(polygon, rule)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc

    device_rows = [
        {
            "rule_id": rule.id,
            "x": point.x,
            "y": point.y,
            "room_id": payload.room_id,
            "type": payload.device_type,
        }
        for point in points
    ]
    if device_rows:
        supabase.table("devices").insert(device_rows).execute()

    return {
        "devices": [
            {"x": point.x, "y": point.y, "rule_id": point.rule_id}
            for point in points
        ],
        "rule": {
            "id": rule.id,
            "rule_id": rule.rule_id,
            "name": rule.name,
            "value": rule.threshold,
            "value_kind": rule.value_kind,
            "document": rule.document,
            "clause": rule.clause,
            "source_url": rule.source_url,
            "verification_status": rule.status,
        },
    }