import time
from unittest.mock import patch

import pytest
from flask import Response

from api.app import create_app
from api.config import settings
from api.services import dynamo_service
from api.services.session_cookie import (
    SESSION_COOKIE_NAME,
    session_cookie_max_age_seconds,
    set_session_cookie,
)


THIRTY_DAYS_SECONDS = 30 * 86400


def _cookies_by_name(response):
    return {c.split("=")[0].strip(): c for c in response.headers.getlist("Set-Cookie")}


@pytest.fixture(autouse=True)
def _force_30_day_ttl(monkeypatch):
    """Pin TTL to 30 days so tests are independent of .env / Terraform overrides."""
    monkeypatch.setattr(settings, "session_ttl_days", 30)


def test_session_ttl_is_configured_for_30_days():
    assert settings.session_ttl_days == 30
    assert session_cookie_max_age_seconds() == THIRTY_DAYS_SECONDS


def test_dynamo_session_ttl_uses_30_day_window(monkeypatch):
    now = 1_800_000_000
    monkeypatch.setattr(time, "time", lambda: now)

    assert dynamo_service._compute_ttl() == now + THIRTY_DAYS_SECONDS


def test_authenticated_request_refreshes_30_day_session_cookie():
    app = create_app()
    app.config["TESTING"] = True
    client = app.test_client()
    session_key = "nash_sk_30_day_refresh"
    user = {
        "id": "user-1",
        "email": "user@example.com",
        "name": "Session User",
        "username": "user@example.com",
        "provider": "password",
        "role": "USER",
    }

    client.set_cookie(SESSION_COOKIE_NAME, session_key)

    with patch(
        "api.middleware.session_auth._resolve_session",
        return_value={
            "api_key": "",
            "provider": "password",
            "chat_assistant_id": "asst-1",
            "user_id": user["id"],
            "context_id": "",
            "auth_flow": "password",
        },
    ), patch("api.middleware.session_auth.dynamo_service.touch_session"), patch(
        "api.routes.user.find_user_by_id",
        return_value=user,
    ):
        response = client.get("/api/user")

    assert response.status_code == 200
    cookies = _cookies_by_name(response)
    assert SESSION_COOKIE_NAME in cookies
    assert f"Max-Age={THIRTY_DAYS_SECONDS}" in cookies[SESSION_COOKIE_NAME]


def test_session_cookie_uses_30_day_max_age():
    session_key = "nash_sk_30_day_refresh"
    response = Response("ok")

    set_session_cookie(response, session_key)

    cookies = _cookies_by_name(response)
    assert SESSION_COOKIE_NAME in cookies
    assert f"{SESSION_COOKIE_NAME}={session_key}" in cookies[SESSION_COOKIE_NAME]
    assert f"Max-Age={THIRTY_DAYS_SECONDS}" in cookies[SESSION_COOKIE_NAME]
