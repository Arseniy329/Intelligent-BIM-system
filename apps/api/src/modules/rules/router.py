"""FastAPI router for the fire-safety rule catalog.

The web rules table (`apps/web/lib/api/rules.ts`) consumes
``GET /api/v1/rules`` and accepts either a bare array or an ``{items}``
envelope. Responses use the same snake_case field names as that client.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict
from supabase import Client

from src.core.auth import CurrentUser, get_current_user
from src.infrastructure.supabase import get_supabase_client

router = APIRouter(prefix="/rules", tags=["rules"])

# Values stored by migration 005 use ``needs_review``; the web client
# declares ``needs_verification`` for the same state.
_STATUS_ALIASES = {"needs_review": "needs_verification"}


class RuleResponse(BaseModel):
    """A single row of the rules table."""

    model_config = ConfigDict(extra="forbid")

    id: str
    rule: str
    value: str
    room_type: str | None = None
    room_height_min: float | None = None
    room_height_max: float | None = None
    document: str | None = None
    clause: str | None = None
    link: str | None = None
    status: str
    checked_at: datetime | None = None


class RulesResponse(BaseModel):
    """Envelope returned by ``GET /api/v1/rules``."""

    model_config = ConfigDict(extra="forbid")

    items: list[RuleResponse]
    total: int


def _as_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _format_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def _as_room_type(value: Any) -> str | None:
    if not isinstance(value, (list, tuple)):
        return None
    names = [str(item).strip() for item in value if str(item).strip()]
    return ", ".join(names) or None


def _as_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        result = value
    elif isinstance(value, str) and value.strip():
        try:
            result = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    else:
        return None
    if result.tzinfo is None:
        result = result.replace(tzinfo=UTC)
    return result


def _as_status(row: dict[str, Any]) -> str:
    raw = str(
        row.get("status") or row.get("verification_status") or "needs_verification"
    )
    return _STATUS_ALIASES.get(raw, raw)


def _rule_from_row(row: dict[str, Any]) -> RuleResponse:
    return RuleResponse(
        id=str(row.get("id") or ""),
        rule=str(row.get("name") or row.get("rule_id") or ""),
        value=_format_value(row.get("value", row.get("threshold"))),
        room_type=_as_room_type(row.get("room_types")),
        room_height_min=_as_float(row.get("min_height_m")),
        room_height_max=_as_float(row.get("max_height_m")),
        document=(
            str(row["document"]) if row.get("document") is not None else None
        ),
        clause=str(row["clause"]) if row.get("clause") is not None else None,
        link=str(row["source_url"]) if row.get("source_url") is not None else None,
        status=_as_status(row),
        checked_at=_as_datetime(row.get("updated_at") or row.get("created_at")),
    )


@router.get("", response_model=RulesResponse)
async def list_rules(
    supabase: Annotated[Client, Depends(get_supabase_client)],
    current_user: CurrentUser = Depends(get_current_user),
) -> RulesResponse:
    """List the fire-safety rules shown on the protected rules page."""
    del current_user

    response = supabase.table("rules").select("*").execute()
    rows = getattr(response, "data", None)
    items = [
        _rule_from_row(row)
        for row in (rows if isinstance(rows, list) else [])
        if isinstance(row, dict)
    ]
    return RulesResponse(items=items, total=len(items))
