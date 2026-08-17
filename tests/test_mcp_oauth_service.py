"""Unit tests for the generic OAuth-for-MCP engine (mcp_oauth_service)."""

from __future__ import annotations

import time
import unittest
from unittest.mock import MagicMock, patch
from urllib.parse import parse_qs, urlparse

from api.config import settings
from api.services import mcp_oauth_service as svc


class _FakeEntity:
    def __init__(self):
        self.rows: dict = {}

    def put(self, user, ent, attrs):
        self.rows[(user, ent)] = dict(attrs)

    def get(self, user, ent):
        row = self.rows.get((user, ent))
        return dict(row) if row else None

    def delete(self, user, ent):
        return self.rows.pop((user, ent), None) is not None


class _Resp:
    def __init__(self, status, payload=None, text=""):
        self.status_code = status
        self._payload = payload or {}
        self.text = text

    def json(self):
        return self._payload


GOOGLE_OAUTH = {
    "preset": "google-workspace",
    "authorization_url": "https://accounts.google.com/o/oauth2/v2/auth",
    "token_url": "https://oauth2.googleapis.com/token",
    "scope": "https://www.googleapis.com/auth/gmail.readonly",
}
GOOGLE_SERVER = {"serverName": "google-gmail", "config": {"oauth": GOOGLE_OAUTH, "url": "https://x/mcp"}}


class CredentialResolutionTests(unittest.TestCase):
    def test_preset_resolves_from_env(self):
        with patch.object(settings, "google_oauth_client_id", "cid"), patch.object(
            settings, "google_oauth_client_secret", "csec"
        ):
            self.assertEqual(svc.resolve_client_credentials(GOOGLE_OAUTH), ("cid", "csec"))
            self.assertTrue(svc.preset_is_available("google-workspace"))

    def test_preset_unavailable_without_env(self):
        with patch.object(settings, "google_oauth_client_id", ""), patch.object(
            settings, "google_oauth_client_secret", ""
        ):
            self.assertFalse(svc.preset_is_available("google-workspace"))

    def test_generic_uses_stored_values(self):
        cfg = {"client_id": "gid", "client_secret": "gsec"}
        self.assertEqual(svc.resolve_client_credentials(cfg), ("gid", "gsec"))

    def test_redirect_uri(self):
        with patch.object(settings, "domain_server", "https://nash.example"):
            self.assertEqual(
                svc.redirect_uri_for("google-gmail"),
                "https://nash.example/api/mcp/google-gmail/oauth/callback",
            )


class AuthorizeUrlTests(unittest.TestCase):
    def test_authorize_url_has_all_params_and_stores_state(self):
        stored = {}

        def _store(**kw):
            stored.update(kw)

        with patch.object(settings, "google_oauth_client_id", "cid"), patch.object(
            settings, "google_oauth_client_secret", "csec"
        ), patch.object(settings, "domain_server", "https://nash.example"), patch(
            "api.services.mcp_oauth_service.dynamo_service.store_mcp_oauth_state", _store
        ):
            url = svc.build_authorize_url(
                server_name="google-gmail", user_hash="u1", oauth_config=GOOGLE_OAUTH
            )

        q = parse_qs(urlparse(url).query)
        self.assertEqual(q["client_id"], ["cid"])
        self.assertEqual(q["access_type"], ["offline"])
        self.assertEqual(q["prompt"], ["consent"])
        self.assertEqual(q["code_challenge_method"], ["S256"])
        self.assertIn("code_challenge", q)
        self.assertEqual(q["scope"], [GOOGLE_OAUTH["scope"]])
        self.assertEqual(
            q["redirect_uri"], ["https://nash.example/api/mcp/google-gmail/oauth/callback"]
        )
        # State + PKCE verifier were persisted, keyed to this server/user.
        self.assertEqual(stored["server_name"], "google-gmail")
        self.assertEqual(stored["user_hash"], "u1")
        self.assertEqual(stored["state"], q["state"][0])
        self.assertTrue(stored["code_verifier"])

    def test_missing_client_id_raises(self):
        with patch.object(settings, "google_oauth_client_id", ""):
            with self.assertRaises(svc.MCPOAuthError):
                svc.build_authorize_url(server_name="google-gmail", user_hash="u1", oauth_config=GOOGLE_OAUTH)


class ExchangeAndStoreTests(unittest.TestCase):
    def setUp(self):
        self.fake = _FakeEntity()
        p = patch("api.services.state_service.mcp_oauth_tokens", self.fake)
        p.start()
        self.addCleanup(p.stop)

    def test_exchange_posts_and_returns_tokens(self):
        captured = {}

        def _post(url, data=None, timeout=None):
            captured["url"] = url
            captured["data"] = data
            return _Resp(200, {"access_token": "AT", "refresh_token": "RT", "expires_in": 3600})

        with patch.object(settings, "google_oauth_client_id", "cid"), patch.object(
            settings, "google_oauth_client_secret", "csec"
        ), patch.object(settings, "domain_server", "https://nash.example"), patch(
            "api.services.mcp_oauth_service.httpx.post", _post
        ):
            tokens = svc.exchange_code(
                oauth_config=GOOGLE_OAUTH, server_name="google-gmail", code="C", code_verifier="V"
            )
        self.assertEqual(tokens["access_token"], "AT")
        self.assertEqual(captured["url"], GOOGLE_OAUTH["token_url"])
        self.assertEqual(captured["data"]["grant_type"], "authorization_code")
        self.assertEqual(captured["data"]["code_verifier"], "V")
        self.assertEqual(captured["data"]["client_secret"], "csec")

    def test_exchange_http_error_raises(self):
        with patch("api.services.mcp_oauth_service.httpx.post", return_value=_Resp(400, text="bad")):
            with self.assertRaises(svc.MCPOAuthError):
                svc.exchange_code(oauth_config={"client_id": "c", "token_url": "https://t"}, server_name="s", code="C", code_verifier="V")

    def test_store_and_load_round_trip_encrypts(self):
        svc.store_token("u1", "google-gmail", {"access_token": "AT", "refresh_token": "RT", "expires_in": 3600, "scope": "s"})
        # Stored values are ciphertext, not the plaintext tokens.
        raw = self.fake.get("u1", "google-gmail")
        self.assertNotEqual(raw["access_token"], "AT")
        self.assertNotEqual(raw["refresh_token"], "RT")
        loaded = svc.load_token("u1", "google-gmail")
        self.assertEqual(loaded["access_token"], "AT")
        self.assertEqual(loaded["refresh_token"], "RT")
        self.assertGreater(loaded["expires_at"], time.time())

    def test_refresh_keeps_prior_refresh_token(self):
        svc.store_token("u1", "s", {"access_token": "AT1", "refresh_token": "RT", "expires_in": 3600})
        # A refresh response without refresh_token must not wipe the stored one.
        svc.store_token("u1", "s", {"access_token": "AT2", "expires_in": 3600}, prior=svc.load_token("u1", "s"))
        self.assertEqual(svc.load_token("u1", "s")["refresh_token"], "RT")


class GetValidAccessTokenTests(unittest.TestCase):
    def setUp(self):
        self.fake = _FakeEntity()
        p = patch("api.services.state_service.mcp_oauth_tokens", self.fake)
        p.start()
        self.addCleanup(p.stop)

    def test_returns_none_when_no_token(self):
        self.assertIsNone(svc.get_valid_access_token("u1", GOOGLE_SERVER))

    def test_returns_none_for_non_oauth_server(self):
        self.assertIsNone(svc.get_valid_access_token("u1", {"serverName": "x", "config": {"url": "u"}}))

    def test_returns_fresh_token_without_refresh(self):
        svc.store_token("u1", "google-gmail", {"access_token": "AT", "refresh_token": "RT", "expires_in": 3600})
        with patch("api.services.mcp_oauth_service.httpx.post") as post:
            self.assertEqual(svc.get_valid_access_token("u1", GOOGLE_SERVER), "AT")
            post.assert_not_called()

    def test_refreshes_when_expiring(self):
        svc.store_token("u1", "google-gmail", {"access_token": "OLD", "refresh_token": "RT", "expires_in": 10})
        with patch.object(settings, "google_oauth_client_id", "cid"), patch.object(
            settings, "google_oauth_client_secret", "csec"
        ), patch(
            "api.services.mcp_oauth_service.httpx.post",
            return_value=_Resp(200, {"access_token": "NEW", "expires_in": 3600}),
        ):
            self.assertEqual(svc.get_valid_access_token("u1", GOOGLE_SERVER), "NEW")
        # Persisted new access token, kept old refresh token.
        self.assertEqual(svc.load_token("u1", "google-gmail")["access_token"], "NEW")
        self.assertEqual(svc.load_token("u1", "google-gmail")["refresh_token"], "RT")

    def test_expired_without_refresh_returns_none(self):
        svc.store_token("u1", "google-gmail", {"access_token": "OLD", "expires_in": 1})
        time.sleep(0.01)
        self.assertIsNone(svc.get_valid_access_token("u1", GOOGLE_SERVER))


if __name__ == "__main__":
    unittest.main()
