from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from src.core.auth import CurrentUser, get_current_user
from src.core.config import Settings, get_settings
from src.infrastructure.supabase import get_supabase_client_for_settings
from src.modules.placement.service import RuleRecord, place_devices_from_rule

router = APIRouter(prefix="/placement", tags=["placement"])


class PlacementRequest(BaseModel):
    rule_id: str
    room_id: str | None = None
    polygon: list[list[float]] = Field(..., min_length=3)


class DeviceResponse(BaseModel):
    x: float
    y: float
    rule_id: str


class PlacementResponse(BaseModel):
    devices: list[DeviceResponse]


@router.post("/compute", response_model=PlacementResponse)
async def compute_placement(
    payload: PlacementRequest,
    current_user: CurrentUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    supabase = get_supabase_client_for_settings(settings)

    rule_response = (
        supabase.table("rules").select("*").eq("id", payload.rule_id).single().execute()
    )

    rule_data = rule_response.data
    if not isinstance(rule_data, dict):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Rule not found",
        )

    if "id" not in rule_data or "threshold" not in rule_data:
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

    room_polygon = [(float(x), float(y)) for x, y in payload.polygon]

    rule = RuleRecord(
        id=str(rule_data["id"]),
        threshold=threshold_val,
        status=str(rule_data.get("status") or "needs_review"),
    )

    points = place_devices_from_rule(room_polygon, rule)

    rows = [
        {"rule_id": p.rule_id, "x": p.x, "y": p.y, "room_id": payload.room_id}
        for p in points
    ]

    if rows:
        supabase.table("devices").insert(rows).execute()

    return {"devices": [{"x": p.x, "y": p.y, "rule_id": p.rule_id} for p in points]}
