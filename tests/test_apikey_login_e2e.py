"""End-to-end tests for the API key login flow.

After the JWT removal these all exercise the session-only auth model:
POST /api/auth/apikey-login → encrypted DynamoDB row + session_key cookie.

Marked as ``extended``: requires the full Flask app and is slow due to
Backboard SDK calls. Run with ``pytest -m extended tests/``.
"""

import json
import os
import unittest
from unittest.mock import patch, AsyncMock

import pytest
from werkzeug.security import generate_password_hash

from api.app import create_app
from api.services.session_cookie import SESSION_COOKIE_NAME, session_cookie_max_age_seconds

pytestmark = pytest.mark.extended


def _cookies_by_name(response):
    return {c.split("=")[0].strip(): c for c in response.headers.getlist("Set-Cookie")}


def _assert_session_cookie(testcase: unittest.TestCase, response):
    cookies = _cookies_by_name(response)
    testcase.assertIn(SESSION_COOKIE_NAME, cookies)
    testcase.assertIn(
        f"Max-Age={session_cookie_max_age_seconds()}",
        cookies[SESSION_COOKIE_NAME],
    )
    return cookies[SESSION_COOKIE_NAME]


def _login_mocks():
    """Common patches for the apikey-login path."""
    return [
        patch("api.routes.auth.get_user_client"),
        patch("api.routes.auth.find_user_by_api_key"),
        patch("api.routes.auth.create_user"),
        patch("api.routes.auth.update_user_field"),
        patch("api.routes.auth._ensure_bb_assistant"),
    ]


class ApiKeyLoginE2ETests(unittest.TestCase):
    """Full end-to-end API key login flow."""

    def setUp(self):
        self.app = create_app()
        self.app.config["TESTING"] = True
        self.client = self.app.test_client()

    # ── Login endpoint ──────────────────────────────────────────────

    def test_login_with_valid_key_returns_user_and_session_cookie(self):
        with patch("api.routes.auth.get_user_client") as mock_client, \
             patch("api.routes.auth.find_user_by_api_key") as mock_find_key, \
             patch("api.routes.auth.create_user") as mock_create, \
             patch("api.routes.auth.update_user_field"), \
             patch("api.routes.auth._ensure_bb_assistant"):
            mock_client.return_value.list_assistants = AsyncMock(return_value=[])
            mock_find_key.return_value = None
            mock_create.return_value = self._fake_user()

            resp = self.client.post(
                "/api/auth/apikey-login",
                data=json.dumps({"apiKey": "espr_valid_key_123"}),
                content_type="application/json",
            )
            self.assertEqual(resp.status_code, 200)
            data = json.loads(resp.data)
            # No JWT in body — session-only response.
            self.assertNotIn("token", data)
            self.assertNotIn("refreshToken", data)
            self.assertEqual(data["session_token"], data["session_key"])
            self.assertTrue(data["session_token"].startswith("nash_sk_"))
            # User payload present.
            self.assertIn("user", data)
            self.assertIn("id", data["user"])

            session_cookie = _assert_session_cookie(self, resp)
            self.assertIn("HttpOnly", session_cookie)
            cookies = _cookies_by_name(resp)
            self.assertNotIn("refreshToken", cookies)

    def test_authenticated_request_refreshes_session_cookie(self):
        with patch("api.routes.auth.get_user_client") as mock_client, \
             patch("api.routes.auth.find_user_by_api_key") as mock_find_key, \
             patch("api.routes.auth.create_user") as mock_create, \
             patch("api.routes.auth.update_user_field"), \
             patch("api.routes.auth._ensure_bb_assistant"), \
             patch("api.routes.user.find_user_by_id") as mock_find_user:
            user = self._fake_user()
            mock_client.return_value.list_assistants = AsyncMock(return_value=[])
            mock_find_key.return_value = None
            mock_create.return_value = user
            mock_find_user.return_value = user

            login_resp = self.client.post(
                "/api/auth/apikey-login",
                data=json.dumps({"apiKey": "espr_valid_key_123"}),
                content_type="application/json",
            )
            self.assertEqual(login_resp.status_code, 200)

            user_resp = self.client.get("/api/user")
            self.assertEqual(user_resp.status_code, 200)
            _assert_session_cookie(self, user_resp)

    def test_unauthenticated_request_does_not_refresh_session_cookie(self):
        resp = self.client.get("/api/user")
        self.assertEqual(resp.status_code, 401)
        self.assertNotIn(SESSION_COOKIE_NAME, _cookies_by_name(resp))

    def test_manual_refresh_extends_session_cookie(self):
        session_key = "nash_sk_refresh_test"
        with patch("api.routes.keys.dynamo_service.refresh_session", return_value=True):
            refresh_resp = self.client.post(
                "/api/keys/refresh",
                data=json.dumps({"session_key": session_key}),
                content_type="application/json",
            )
            self.assertEqual(refresh_resp.status_code, 200)
            _assert_session_cookie(self, refresh_resp)

    def test_login_empty_key_returns_400(self):
        resp = self.client.post(
            "/api/auth/apikey-login",
            data=json.dumps({"apiKey": ""}),
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("required", json.loads(resp.data)["message"].lower())

    def test_login_no_body_returns_400(self):
        resp = self.client.post(
            "/api/auth/apikey-login",
            data=json.dumps({}),
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 400)

    def test_login_invalid_key_returns_401(self):
        with patch("api.routes.auth.get_user_client") as mock_client:
            mock_client.return_value.list_assistants = AsyncMock(
                side_effect=Exception("401 Unauthorized")
            )
            resp = self.client.post(
                "/api/auth/apikey-login",
                data=json.dumps({"apiKey": "bad_key"}),
                content_type="application/json",
            )
            self.assertEqual(resp.status_code, 401)

    def test_login_backboard_down_returns_502(self):
        with patch("api.routes.auth.get_user_client") as mock_client:
            mock_client.return_value.list_assistants = AsyncMock(
                side_effect=Exception("Connection timeout")
            )
            resp = self.client.post(
                "/api/auth/apikey-login",
                data=json.dumps({"apiKey": "some_key"}),
                content_type="application/json",
            )
            self.assertEqual(resp.status_code, 502)
            self.assertIn("try again", json.loads(resp.data)["message"].lower())

    def test_login_strips_whitespace_and_newlines(self):
        with patch("api.routes.auth.get_user_client") as mock_client, \
             patch("api.routes.auth.find_user_by_api_key") as mock_find_key, \
             patch("api.routes.auth.create_user") as mock_create, \
             patch("api.routes.auth.update_user_field"), \
             patch("api.routes.auth._ensure_bb_assistant"):
            mock_client.return_value.list_assistants = AsyncMock(return_value=[])
            mock_find_key.return_value = None
            mock_create.return_value = self._fake_user()

            resp = self.client.post(
                "/api/auth/apikey-login",
                data=json.dumps({"apiKey": "  espr_key_123\n\r  "}),
                content_type="application/json",
            )
            self.assertEqual(resp.status_code, 200)
            call_args = mock_client.call_args[0]
            self.assertEqual(call_args[0], "espr_key_123")

    # ── Key never leaks ─────────────────────────────────────────────

    def test_key_never_in_response_body(self):
        secret = "espr_super_secret_key_never_leak"
        with patch("api.routes.auth.get_user_client") as mock_client, \
             patch("api.routes.auth.find_user_by_api_key") as mock_find_key, \
             patch("api.routes.auth.create_user") as mock_create, \
             patch("api.routes.auth.update_user_field"), \
             patch("api.routes.auth._ensure_bb_assistant"):
            mock_client.return_value.list_assistants = AsyncMock(return_value=[])
            mock_find_key.return_value = None
            mock_create.return_value = self._fake_user(bb_api_key=secret)

            resp = self.client.post(
                "/api/auth/apikey-login",
                data=json.dumps({"apiKey": secret}),
                content_type="application/json",
            )
            self.assertNotIn(secret.encode(), resp.data)

    def test_key_not_in_serialized_user(self):
        from api.routes.auth import _serialize_user
        user = self._fake_user(bb_api_key="espr_secret_123")
        serialized = _serialize_user(user)
        self.assertNotIn("bbApiKey", serialized)
        self.assertNotIn("espr_secret_123", json.dumps(serialized))

    # ── Returning user ───────────────────────────────────────────────

    def test_returning_user_same_key_no_new_user_created(self):
        existing_user = self._fake_user(bb_api_key="espr_returning")
        with patch("api.routes.auth.get_user_client") as mock_client, \
             patch("api.routes.auth.find_user_by_api_key") as mock_find_key, \
             patch("api.routes.auth.create_user") as mock_create, \
             patch("api.routes.auth.update_user_field"), \
             patch("api.routes.auth._ensure_bb_assistant"):
            mock_client.return_value.list_assistants = AsyncMock(return_value=[])
            mock_find_key.return_value = existing_user

            resp = self.client.post(
                "/api/auth/apikey-login",
                data=json.dumps({"apiKey": "espr_returning"}),
                content_type="application/json",
            )
            self.assertEqual(resp.status_code, 200)
            mock_create.assert_not_called()

    # ── Disabled account ─────────────────────────────────────────────

    def test_disabled_account_returns_403(self):
        disabled_user = self._fake_user(bb_api_key="espr_disabled")
        disabled_user["active"] = False
        with patch("api.routes.auth.get_user_client") as mock_client, \
             patch("api.routes.auth.find_user_by_api_key") as mock_find_key, \
             patch("api.routes.auth.update_user_field"), \
             patch("api.routes.auth._ensure_bb_assistant"):
            mock_client.return_value.list_assistants = AsyncMock(return_value=[])
            mock_find_key.return_value = disabled_user

            resp = self.client.post(
                "/api/auth/apikey-login",
                data=json.dumps({"apiKey": "espr_disabled"}),
                content_type="application/json",
            )
            self.assertEqual(resp.status_code, 403)

    def test_refresh_route_is_gone(self):
        resp = self.client.post("/api/auth/refresh")
        self.assertIn(resp.status_code, (404, 405))

    # ── Frontend smoke checks ────────────────────────────────────────

    def test_data_provider_exports_apikey_login(self):
        ds_path = os.path.join(
            os.path.dirname(os.path.dirname(__file__)),
            "packages", "data-provider", "src", "data-service.ts",
        )
        with open(ds_path, "r") as f:
            self.assertIn("apiKeyLogin", f.read())

    def test_api_endpoints_has_apikey_login(self):
        ep_path = os.path.join(
            os.path.dirname(os.path.dirname(__file__)),
            "packages", "data-provider", "src", "api-endpoints.ts",
        )
        with open(ep_path, "r") as f:
            self.assertIn("apikey-login", f.read())

    def test_auth_context_exposes_apikey_login(self):
        ctx_path = os.path.join(
            os.path.dirname(os.path.dirname(__file__)),
            "client", "src", "hooks", "AuthContext.tsx",
        )
        with open(ctx_path, "r") as f:
            content = f.read()
        self.assertIn("apiKeyLogin", content)
        self.assertIn("useApiKeyLoginMutation", content)

    # ── Helpers ───────────────────────────────────────────────────────

    def _fake_user(
        self,
        bb_api_key="",
        user_id="apikey-test@apikey.nash.local",
        *,
        email=None,
        provider="apikey",
        password_hash="",
        bb_assistant_id="ast-123",
        email_verified=True,
    ):
        return {
            "id": user_id,
            "email": email or user_id,
            "name": "API Key User",
            "username": "apikey-test",
            "avatar": "",
            "provider": provider,
            "role": "USER",
            "emailVerified": email_verified,
            "bbApiKey": bb_api_key,
            "bbAssistantId": bb_assistant_id,
            "password_hash": password_hash,
            "createdAt": "2026-05-13T00:00:00Z",
            "updatedAt": "2026-05-13T00:00:00Z",
            "_memory_id": "mem-123",
        }


if __name__ == "__main__":
    unittest.main()
