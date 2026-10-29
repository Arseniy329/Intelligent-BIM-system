import asyncio

import pytest
from fastapi import HTTPException

from src.core.auth import CurrentUser, get_current_user
from src.modules.users.router import require_admin


class FakeAuth:
    def __init__(self, user_id: str, email: str):
        self.user = type("User", (), {"id": user_id, "email": email})()


class FakeTable:
    def __init__(self, payload):
        self.payload = payload

    def select(self, _):
        return self

    def eq(self, key, value):
        return self

    def single(self):
        return self

    def execute(self):
        return type("Resp", (), {"data": self.payload})()


class FakeClient:
    def __init__(self, profile_payload):
        self.auth = type(
            "Auth",
            (),
            {"get_user": lambda self, token: FakeAuth("u-1", "admin@example.com")},
        )()
        self._profile_payload = profile_payload

    def table(self, name):
        return FakeTable(self._profile_payload)


def test_require_admin_for_engineer():
    user = CurrentUser(
        id="u-1",
        email="eng@example.com",
        role="engineer",
        is_active=True,
    )

    with pytest.raises(HTTPException) as exc:
        require_admin(user)

    assert exc.value.status_code == 403


def test_require_admin_allows_admin():
    user = CurrentUser(
        id="u-1",
        email="admin@example.com",
        role="admin",
        is_active=True,
    )

    result = require_admin(user)
    assert result.id == "u-1"


def test_get_current_user_rejects_deactivated_user(monkeypatch):
    profile = {
        "id": "u-1",
        "email": "user@example.com",
        "role": "engineer",
        "is_active": False,
    }

    fake_auth_client = type(
        "AuthClient",
        (),
        {"get_user": lambda self, token: FakeAuth("u-1", "user@example.com")},
    )()

    fake_admin_client = FakeClient(profile)

    monkeypatch.setattr(
        "src.core.auth.get_supabase_auth_client_for_settings",
        lambda settings: fake_auth_client,
    )
    monkeypatch.setattr(
        "src.core.auth.get_supabase_client_for_settings",
        lambda settings: fake_admin_client,
    )

    request = type("Req", (), {"headers": {"Authorization": "Bearer bad-token"}})()

    async def call_get_current_user():
        await get_current_user(
            request,
            settings=type("Settings", (), {})(),
        )

    with pytest.raises(HTTPException) as exc:
        asyncio.run(call_get_current_user())

    assert exc.value.status_code == 401