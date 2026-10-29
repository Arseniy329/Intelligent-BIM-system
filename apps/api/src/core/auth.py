from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from pydantic import BaseModel

from src.core.config import Settings, get_settings
from src.infrastructure.supabase import (
    get_supabase_auth_client_for_settings,
    get_supabase_client_for_settings,
)


class CurrentUser(BaseModel):
    id: str
    email: str | None = None
    role: str = "engineer"


async def get_current_user(
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
) -> CurrentUser:
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

    supabase = get_supabase_auth_client_for_settings(settings)

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

    admin_client = get_supabase_client_for_settings(settings)

    profile_response = (
        admin_client.table("profiles")
        .select("id, email, role")
        .eq("id", user.id)
        .single()
        .execute()
    )

    profile_data = getattr(profile_response, "data", None)

    if not profile_data:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Profile not found",
        )

    return CurrentUser(
        id=str(user.id),
        email=user.email,
        role=profile_data.get("role", "engineer"),
    )
