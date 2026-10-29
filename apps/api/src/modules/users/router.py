from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from src.core.auth import CurrentUser, get_current_user
from src.core.config import Settings, get_settings
from src.infrastructure.supabase import get_supabase_client_for_settings

router = APIRouter(prefix="/users", tags=["users"])


def require_admin(
    current_user: CurrentUser = Depends(get_current_user),
) -> CurrentUser:
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return current_user


class UserCreateRequest(BaseModel):
    email: str
    password: str = Field(..., min_length=8)
    role: Literal["admin", "engineer"] = "engineer"


class UserUpdateRequest(BaseModel):
    role: Literal["admin", "engineer"] | None = None
    is_active: bool | None = None


@router.get("/me")
async def get_me(current_user: CurrentUser = Depends(get_current_user)):
    return {
        "id": current_user.id,
        "email": current_user.email,
        "role": current_user.role,
        "is_active": current_user.is_active,
    }


@router.get("")
async def list_users(
    _admin: CurrentUser = Depends(require_admin),
    settings: Settings = Depends(get_settings),
):
    supabase = get_supabase_client_for_settings(settings)

    response = (
        supabase.table("profiles")
        .select("id, email, role, created_at, is_active")
        .order("created_at", desc=True)
        .execute()
    )

    return response.data


@router.post("")
async def create_user(
    payload: UserCreateRequest,
    _admin: CurrentUser = Depends(require_admin),
    settings: Settings = Depends(get_settings),
):
    supabase = get_supabase_client_for_settings(settings)

    try:
        auth_user = supabase.auth.admin.create_user(
            {
                "email": payload.email,
                "password": payload.password,
                "email_confirm": True,
                "user_metadata": {"role": payload.role},
            }
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to create user: {exc}",
        ) from exc

    user_id = auth_user.user.id

    profile_payload = {
        "id": user_id,
        "email": payload.email,
        "role": payload.role,
        "is_active": True,
    }

    profile_response = (
        supabase.table("profiles")
        .upsert(profile_payload, on_conflict="id")
        .execute()
    )

    if not profile_response.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="User created in auth, but profile row was not saved",
        )

    return {
        "id": user_id,
        "email": payload.email,
        "role": payload.role,
        "is_active": True,
    }


@router.patch("/{user_id}")
async def update_user(
    user_id: str,
    payload: UserUpdateRequest,
    _admin: CurrentUser = Depends(require_admin),
    settings: Settings = Depends(get_settings),
):
    supabase = get_supabase_client_for_settings(settings)

    updates: dict[str, object] = {}

    if payload.role is not None:
        updates["role"] = payload.role

    if payload.is_active is not None:
        updates["is_active"] = payload.is_active

    if not updates:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No changes provided",
        )

    response = (
        supabase.table("profiles")
        .update(updates)
        .eq("id", user_id)
        .execute()
    )

    if not response.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    return response.data[0]