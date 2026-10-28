from typing import Any, cast

from fastapi import HTTPException, Request, status
from pydantic import BaseModel

from src.core.config import get_settings
from src.infrastructure.supabase import get_supabase_auth_client, get_supabase_client


class CurrentUser(BaseModel):
    id: str
    email: str | None = None
    role: str = "engineer"


async def get_current_user(request: Request) -> CurrentUser:
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid Authorization header",
        )

    token = auth_header.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token",
        )

    settings = get_settings()
    supabase = get_supabase_auth_client(settings)

    try:
        user_response = supabase.auth.get_user(token)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        ) from exc

    user = getattr(user_response, "user", None)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )

    admin_client = get_supabase_client(settings)
    profile_response = (
        admin_client.table("profiles")
        .select("id, email, role")
        .eq("id", user.id)
        .single()
        .execute()
    )

    profile_data = getattr(profile_response, "data", None)
    if not isinstance(profile_data, dict):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Profile not found",
        )
    profile = cast(dict[str, Any], profile_data)

    return CurrentUser(
        id=str(user.id),
        email=user.email,
        role=str(profile.get("role", "engineer")),
    )