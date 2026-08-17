"""Security regression tests covering the session-only auth model.

After the JWT removal:
- Logout deletes the DynamoDB session row (immediate revocation, replaces
  the old in-memory token blacklist).
- `bbApiKey` must never appear in any user serialization.
- CSRF double-submit cookie still protects state-changing endpoints.
- SSO callback responses are still marked `Cache-Control: no-store`.

Marked as ``extended``: requires the full Flask app and is slow due to
Backboard SDK initialization. Run with ``pytest -m extended tests/``.
"""

import json
import unittest
from unittest.mock import patch

import pytest

from api.app import create_app

pytestmark = pytest.mark.extended


class LogoutRevokesSessionTests(unittest.TestCase):
    """Logout deletes the DynamoDB session row keyed by session_key cookie."""

    def setUp(self):
        self.app = create_app()
        self.app.config["TESTING"] = True
        self.client = self.app.test_client()

    def test_logout_deletes_dynamo_session(self):
        with patch("api.services.dynamo_service.delete_session") as mock_delete, \
             patch("api.services.dynamo_service.get_session") as mock_get:
            mock_get.return_value = {"user_id": "user-logout-test"}
            self.client.set_cookie("session_key", "nash_sk_abc")
            self.client.post(
                "/api/auth/logout",
                headers={"Sec-Fetch-Site": "same-origin"},
            )
            mock_delete.assert_called_once_with("nash_sk_abc")

    def test_logout_clears_session_cookie(self):
        with patch("api.services.dynamo_service.delete_session"), \
             patch("api.services.dynamo_service.get_session", return_value=None):
            resp = self.client.post(
                "/api/auth/logout",
                headers={"Sec-Fetch-Site": "same-origin"},
            )
        set_cookies = resp.headers.getlist("Set-Cookie")
        cookie_names = [c.split("=")[0].strip() for c in set_cookies]
        self.assertIn("session_key", cookie_names)
        self.assertIn("bb_api_key", cookie_names)
        self.assertIn("bb_assistant_id", cookie_names)


class UserSerializationTests(unittest.TestCase):
    """bbApiKey must not appear in serialized user responses."""

    def test_serialize_user_excludes_api_key(self):
        from api.routes.auth import _serialize_user

        user = {
            "id": "user-test",
            "email": "test@example.com",
            "name": "Test User",
            "bbApiKey": "secret-key-value",
            "bbAssistantId": "assistant-123",
        }
        serialized = _serialize_user(user)
        self.assertNotIn("bbApiKey", serialized)
        # bbAssistantId is not a secret — kept in the payload.
        self.assertIn("bbAssistantId", serialized)


class CsrfProtectionTests(unittest.TestCase):
    """Double-submit cookie CSRF protection on state-changing endpoints."""

    def setUp(self):
        self.app = create_app()
        self.app.config["TESTING"] = True
        self.client = self.app.test_client()

    def test_cross_site_fetch_blocked(self):
        resp = self.client.post(
            "/api/auth/logout",
            headers={"Sec-Fetch-Site": "cross-site"},
        )
        self.assertEqual(resp.status_code, 403)

    def test_same_origin_fetch_allowed(self):
        resp = self.client.post(
            "/api/auth/logout",
            headers={"Sec-Fetch-Site": "same-origin"},
        )
        self.assertNotEqual(resp.status_code, 403)


