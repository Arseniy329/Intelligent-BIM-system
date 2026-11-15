from functools import lru_cache
from typing import Annotated

from fastapi import Depends
from supabase import Client, create_client

from src.core.config import Settings, get_settings


@lru_cache
def _get_cached_client(supabase_url: str, supabase_key: str) -> Client:
    return create_client(supabase_url, supabase_key)


def get_supabase_client(
    settings: Annotated[Settings, Depends(get_settings)],
) -> Client:
    return _get_cached_client(
        settings.SUPABASE_URL,
        settings.SUPABASE_SERVICE_ROLE_KEY,
    )


def get_supabase_auth_client(
    settings: Annotated[Settings, Depends(get_settings)],
) -> Client:
    return _get_cached_client(
        settings.SUPABASE_URL,
        settings.SUPABASE_ANON_KEY,
    )


def get_supabase_client_for_settings(settings: Settings) -> Client:
    return _get_cached_client(
        settings.SUPABASE_URL,
        settings.SUPABASE_SERVICE_ROLE_KEY,
    )


def get_supabase_auth_client_for_settings(settings: Settings) -> Client:
    return _get_cached_client(
        settings.SUPABASE_URL,
        settings.SUPABASE_ANON_KEY,
    )
