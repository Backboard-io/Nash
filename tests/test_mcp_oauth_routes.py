"""Route tests for the OAuth-MCP endpoints and the Google Workspace catalog."""

from __future__ import annotations

import time
import unittest
from unittest.mock import patch

from api.config import settings
from api.services import encryption_service


class _FakeEntity:
    def __init__(self):
        self.rows: dict = {}

    def put(self, user, ent, attrs):
        self.rows[(user, ent)] = dict(attrs)

    def get(self, user, ent):
        row = self.rows.get((user, ent))
        return dict(row) if row else None

    def list_for_user(self, user):
        return [dict(v) for (u, _e), v in self.rows.items() if u == user]

    def delete(self, user, ent):
        return self.rows.pop((user, ent), None) is not None


def _session_row(user_id="uid-1"):
    return {
        "session_key": f"nash_sk_{user_id}",
        "encrypted_key": encryption_service.encrypt_key("k"),
        "provider": "backboard",
        "chat_assistant_id": "asst",
        "user_id": user_id,
        "context_id": "",
        "created_at": "",
        "last_used_at": int(time.time()),
        "ttl": int(time.time()) + 3600,
    }


GOOGLE_CFG = {
    "type": "streamable-http",
    "url": "https://gmailmcp.googleapis.com/mcp/v1",
    "title": "Gmail",
    "oauth": {
        "preset": "google-workspace",
        "authorization_url": "https://accounts.google.com/o/oauth2/v2/auth",
        "token_url": "https://oauth2.googleapis.com/token",
        "scope": "https://www.googleapis.com/auth/gmail.readonly",
    },
}


class OAuthRouteHarness(unittest.TestCase):
    USER = "uid-1"

    @classmethod
    def setUpClass(cls):
        from api.app import create_app

        cls.app = create_app()
        cls.app.config["TESTING"] = True

    def setUp(self):
        self.client = self.app.test_client()
        self.session = _session_row(self.USER)
        self.servers = _FakeEntity()
        self.tokens = _FakeEntity()
        self.states: dict = {}

        def _store_state(**kw):
            self.states[kw["state"]] = kw

        def _pop_state(state):
            return self.states.pop(state, None)

        for p in (
            patch("api.services.dynamo_service.get_session", return_value=self.session),
            patch("api.services.dynamo_service.touch_session", lambda *a, **k: None),
            patch("api.routes.misc.state_service.mcp_servers", self.servers),
            patch("api.services.state_service.mcp_servers", self.servers),
            patch("api.services.state_service.mcp_oauth_tokens", self.tokens),
            patch("api.services.dynamo_service.store_mcp_oauth_state", _store_state),
            patch("api.services.dynamo_service.pop_mcp_oauth_state", _pop_state),
            patch.object(settings, "google_oauth_client_id", "cid"),
            patch.object(settings, "google_oauth_client_secret", "csec"),
            patch.object(settings, "domain_server", "https://nash.example"),
        ):
            p.start()
            self.addCleanup(p.stop)

    def _headers(self):
        return {"X-Session-Key": self.session["session_key"]}

    def _add_google_server(self, name="google-gmail"):
        self.servers.put(self.USER, name, {"serverName": name, "dbId": "d", "config": GOOGLE_CFG})

    def _store_token(self, name="google-gmail", expires_in=3600):
        from api.services import mcp_oauth_service

        mcp_oauth_service.store_token(self.USER, name, {"access_token": "AT", "refresh_token": "RT", "expires_in": expires_in})


class ReinitializeGatingTests(OAuthRouteHarness):
    def test_oauth_no_token_returns_oauth_url_and_does_not_fetch(self):
        self._add_google_server()
        with patch("api.routes.misc.fetch_mcp_tools") as fetch:
            resp = self.client.post("/api/mcp/google-gmail/reinitialize", headers=self._headers())
            fetch.assert_not_called()
        body = resp.get_json()
        self.assertTrue(body["success"])
        self.assertTrue(body["oauthRequired"])
        self.assertIn("accounts.google.com", body["oauthUrl"])
        self.assertIn("client_id=cid", body["oauthUrl"])

    def test_oauth_with_token_fetches_tools(self):
        self._add_google_server()
        self._store_token()
        async def _fake_fetch(server, access_token=None):
            assert access_token == "AT"  # token threaded into the fetch
            return [{"name": "search", "description": "d", "inputSchema": {"type": "object"}}]
        with patch("api.routes.misc.fetch_mcp_tools", _fake_fetch):
            resp = self.client.post("/api/mcp/google-gmail/reinitialize", headers=self._headers())
        body = resp.get_json()
        self.assertTrue(body["success"])
        self.assertFalse(body["oauthRequired"])
        self.assertTrue(self.servers.get(self.USER, "google-gmail")["tools"])


class CallbackTests(OAuthRouteHarness):
    def _fp(self):
        from api.services import mcp_oauth_service

        return mcp_oauth_service.session_fingerprint(self.session["session_key"])

    def test_callback_exchanges_stores_and_fetches(self):
        self._add_google_server()
        # State bound to THIS session's fingerprint; the callback carries the
        # same session key (via header), so the binding check passes.
        self.states["ST"] = {
            "state": "ST", "code_verifier": "V", "server_name": "google-gmail",
            "user_hash": self.USER, "session_fingerprint": self._fp(),
        }
        async def _fake_fetch(server, access_token=None):
            return [{"name": "search", "description": "d", "inputSchema": {"type": "object"}}]
        with patch(
            "api.services.mcp_oauth_service.exchange_code",
            return_value={"access_token": "AT", "refresh_token": "RT", "expires_in": 3600},
        ), patch("api.routes.misc.fetch_mcp_tools", _fake_fetch):
            resp = self.client.get(
                "/api/mcp/google-gmail/oauth/callback?code=C&state=ST", headers=self._headers()
            )
        self.assertEqual(resp.status_code, 200)
        self.assertIn("connected", resp.get_data(as_text=True))
        self.assertTrue(self.tokens.get(self.USER, "google-gmail"))

    def test_callback_rejects_session_mismatch(self):
        # A different browser (no/other session) completing an attacker's state
        # must be rejected — tokens are never bound to the wrong account.
        self._add_google_server()
        self.states["ST"] = {
            "state": "ST", "code_verifier": "V", "server_name": "google-gmail",
            "user_hash": self.USER, "session_fingerprint": "SOMEONE_ELSE",
        }
        with patch("api.services.mcp_oauth_service.exchange_code") as ex:
            resp = self.client.get(
                "/api/mcp/google-gmail/oauth/callback?code=C&state=ST", headers=self._headers()
            )
            ex.assert_not_called()  # never even exchanges the code
        self.assertIn("start the connection again", resp.get_data(as_text=True).lower())
        self.assertIsNone(self.tokens.get(self.USER, "google-gmail"))

    def test_callback_bad_state_shows_error(self):
        self._add_google_server()
        resp = self.client.get("/api/mcp/google-gmail/oauth/callback?code=C&state=NOPE")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("expired", resp.get_data(as_text=True).lower())

    def test_callback_provider_error_param(self):
        resp = self.client.get("/api/mcp/google-gmail/oauth/callback?error=access_denied")
        self.assertIn("cancelled", resp.get_data(as_text=True).lower())


class StatusTests(OAuthRouteHarness):
    def test_status_oauth_without_token_disconnected(self):
        self._add_google_server()
        resp = self.client.get("/api/mcp/connection/status", headers=self._headers())
        st = resp.get_json()["connectionStatus"]["google-gmail"]
        self.assertTrue(st["requiresOAuth"])
        self.assertEqual(st["connectionState"], "disconnected")

    def test_status_oauth_with_token_and_tools_connected(self):
        self.servers.put(self.USER, "google-gmail", {"serverName": "google-gmail", "config": GOOGLE_CFG, "tools": [{"name": "x"}]})
        self._store_token()
        resp = self.client.get("/api/mcp/connection/status/google-gmail", headers=self._headers())
        body = resp.get_json()
        self.assertTrue(body["requiresOAuth"])
        self.assertEqual(body["connectionStatus"], "connected")


class CatalogTests(OAuthRouteHarness):
    def test_catalog_lists_five_when_available(self):
        resp = self.client.get("/api/mcp/catalog", headers=self._headers())
        cat = resp.get_json()["catalog"]
        self.assertEqual(len(cat), 5)
        names = {c["serverName"] for c in cat}
        self.assertIn("google-gmail", names)
        self.assertFalse(any(c["alreadyAdded"] for c in cat))

    def test_catalog_empty_without_creds(self):
        with patch.object(settings, "google_oauth_client_id", ""):
            resp = self.client.get("/api/mcp/catalog", headers=self._headers())
        self.assertEqual(resp.get_json()["catalog"], [])

    def test_catalog_add_creates_server_and_returns_oauth_url(self):
        resp = self.client.post("/api/mcp/catalog/google-gmail/add", headers=self._headers())
        body = resp.get_json()
        self.assertTrue(body["oauthRequired"])
        self.assertIn("accounts.google.com", body["oauthUrl"])
        row = self.servers.get(self.USER, "google-gmail")
        self.assertEqual(row["config"]["url"], "https://gmailmcp.googleapis.com/mcp/v1")
        self.assertEqual(row["config"]["oauth"]["preset"], "google-workspace")

    def test_catalog_add_unknown_404(self):
        resp = self.client.post("/api/mcp/catalog/nope/add", headers=self._headers())
        self.assertEqual(resp.status_code, 404)


class CreateOAuthServerTests(OAuthRouteHarness):
    def test_create_oauth_server_stores_without_fetching_tools(self):
        # A user adding an OAuth server via the generic form must not 502 — it
        # stores the row so the client can start the OAuth connect.
        with patch("api.routes.misc.fetch_mcp_tools") as fetch:
            resp = self.client.post(
                "/api/mcp/servers", json={"config": GOOGLE_CFG}, headers=self._headers()
            )
            fetch.assert_not_called()
        self.assertEqual(resp.status_code, 201)
        self.assertTrue(self.servers.get(self.USER, "gmail"))


class AuthValuesAndCancelTests(OAuthRouteHarness):
    def test_auth_values_reflects_token_and_matches_contract(self):
        self._add_google_server()
        r1 = self.client.get("/api/mcp/google-gmail/auth-values", headers=self._headers()).get_json()
        # Frontend contract: {success, serverName, authValueFlags}.
        self.assertTrue(r1["success"])
        self.assertEqual(r1["serverName"], "google-gmail")
        self.assertIn("authValueFlags", r1)
        self.assertFalse(r1["authenticated"])
        self._store_token()
        r2 = self.client.get("/api/mcp/google-gmail/auth-values", headers=self._headers()).get_json()
        self.assertTrue(r2["authenticated"])

    def test_cancel_acknowledges(self):
        resp = self.client.post("/api/mcp/oauth/cancel/google-gmail", headers=self._headers())
        self.assertTrue(resp.get_json()["success"])


class ReviewFixTests(OAuthRouteHarness):
    def test_client_secret_never_returned_to_client(self):
        # A generic (non-preset) OAuth server storing its own client_secret must
        # not echo it back on any read.
        cfg = {
            "type": "streamable-http", "url": "https://x/mcp", "title": "Generic",
            "oauth": {"authorization_url": "https://a", "token_url": "https://t",
                      "client_id": "cid", "client_secret": "TOP_SECRET", "scope": "s"},
        }
        self.servers.put(self.USER, "generic", {"serverName": "generic", "config": cfg})
        body = self.client.get("/api/mcp/servers", headers=self._headers()).get_json()
        self.assertNotIn("client_secret", body["generic"]["oauth"])
        self.assertEqual(body["generic"]["oauth"]["client_id"], "cid")  # non-secret kept

    def test_delete_server_removes_token(self):
        self._add_google_server()
        self._store_token()
        self.assertTrue(self.tokens.get(self.USER, "google-gmail"))
        resp = self.client.delete("/api/mcp/servers/google-gmail", headers=self._headers())
        self.assertTrue(resp.get_json()["success"])
        self.assertIsNone(self.tokens.get(self.USER, "google-gmail"))

    def test_patch_oauth_without_token_saves_without_502(self):
        self._add_google_server()  # no token yet
        with patch("api.routes.misc.fetch_mcp_tools") as fetch:
            resp = self.client.patch(
                "/api/mcp/servers/google-gmail",
                json={"config": {"description": "edited"}},
                headers=self._headers(),
            )
            fetch.assert_not_called()  # no token -> no fetch, no 502
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(self.servers.get(self.USER, "google-gmail")["config"]["description"], "edited")

    def test_catalog_add_when_connected_returns_connected_not_consent(self):
        self._add_google_server()
        self._store_token()
        resp = self.client.post("/api/mcp/catalog/google-gmail/add", headers=self._headers())
        body = resp.get_json()
        self.assertFalse(body["oauthRequired"])
        self.assertIsNone(body["oauthUrl"])


if __name__ == "__main__":
    unittest.main()
