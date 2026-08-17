from __future__ import annotations

from unittest.mock import patch

import pytest
from flask import Flask, g

from api.routes import chat as chat_module
from api.middleware import session_auth
from api.services import backboard_service


def test_resolve_chat_credentials_uses_session_credentials():
    with patch.object(chat_module, "get_user_assistant_id") as get_persisted_assistant:
        api_key, assistant_id = chat_module._resolve_chat_credentials(
            "user-123",
            session_bb_api_key="session-key",
            session_chat_assistant_id="session-assistant",
        )

    assert api_key == "session-key"
    assert assistant_id == "session-assistant"
    get_persisted_assistant.assert_not_called()


def test_resolve_chat_credentials_can_recover_non_secret_assistant_id():
    with patch.object(
        chat_module,
        "get_user_assistant_id",
        return_value="persisted-assistant",
    ):
        api_key, assistant_id = chat_module._resolve_chat_credentials(
            "user-123",
            session_bb_api_key="session-key",
        )

    assert api_key == "session-key"
    assert assistant_id == "persisted-assistant"


def test_resolve_chat_credentials_rejects_missing_session_key():
    with patch.object(chat_module, "get_user_assistant_id", return_value="persisted-assistant"):
        with pytest.raises(ValueError, match="missing its Backboard API key"):
            chat_module._resolve_chat_credentials("user-123")


def test_get_user_client_rejects_missing_key():
    with pytest.raises(ValueError, match="missing its Backboard API key"):
        backboard_service.get_user_client("")


def test_get_request_client_rejects_keyless_session():
    app = Flask(__name__)

    with app.test_request_context():
        g.user_id = "signed-in-user"
        g.bb_api_key = ""
        with pytest.raises(ValueError, match="missing its Backboard API key"):
            backboard_service.get_request_client()


def test_session_without_encrypted_user_key_is_invalid(monkeypatch):
    monkeypatch.setattr(
        session_auth.dynamo_service,
        "get_session",
        lambda _session_key: {"user_id": "signed-in-user", "encrypted_key": ""},
    )

    assert session_auth._resolve_session("nash-session") is None
