"""Route tests for the /api/mcp CRUD + status/reinitialize endpoints.

Drives the real Flask views through a valid session (fake DynamoDB session +
in-memory state), mocking only the MCP network edge (fetch_mcp_tools). Verifies:
- create surfaces connection failures (502) instead of a silent zero-tool 201
- create/patch store raw tools and the OpenAI-format tools, and never sync to
  an assistant
- PATCH re-fetches tools with the merged config
- reinitialize refreshes tools and records lastError on failure
- connection status reflects stored tool state
"""

from __future__ import annotations

import time
import unittest
from unittest.mock import patch

from api.services import encryption_service


class _FakeMCPEntity:
    def __init__(self):
        self.rows: dict[tuple[str, str], dict] = {}

    def put(self, user_hash, entity_id, attributes):
        self.rows[(user_hash, entity_id)] = dict(attributes)

    def get(self, user_hash, entity_id):
        row = self.rows.get((user_hash, entity_id))
        return dict(row) if row else None

    def list_for_user(self, user_hash):
        return [dict(v) for (u, _e), v in self.rows.items() if u == user_hash]

    def delete(self, user_hash, entity_id):
        return self.rows.pop((user_hash, entity_id), None) is not None


def _session_row(user_id="uid-1", api_key="test-bb-key"):
    return {
        "session_key": f"nash_sk_{user_id}",
        "encrypted_key": encryption_service.encrypt_key(api_key),
        "provider": "backboard",
        "chat_assistant_id": "asst-session",
        "user_id": user_id,
        "context_id": "",
        "created_at": "",
        "last_used_at": int(time.time()),
        "ttl": int(time.time()) + 3600,
    }


_TOOLS = [
    {"name": "search", "description": "Search docs", "inputSchema": {"type": "object", "properties": {"q": {"type": "string"}}}},
    {"name": "fetch", "description": "Fetch a page", "inputSchema": {"type": "object", "properties": {}}},
]


class MCPRouteHarness(unittest.TestCase):
    USER_ID = "uid-1"

    @classmethod
    def setUpClass(cls):
        from api.app import create_app
        cls.app = create_app()
        cls.app.config["TESTING"] = True

    def setUp(self):
        from api.routes import misc  # noqa: F401 ensure module import

        self.client = self.app.test_client()
        self.fake_mcp = _FakeMCPEntity()
        self.session = _session_row(self.USER_ID)

        for p in (
            patch("api.services.dynamo_service.get_session", return_value=self.session),
            patch("api.services.dynamo_service.touch_session", lambda *a, **k: None),
            patch("api.routes.misc.state_service.mcp_servers", self.fake_mcp),
        ):
            p.start()
            self.addCleanup(p.stop)

    def _headers(self):
        return {"X-Session-Key": self.session["session_key"]}

    def _create(self, title="My Server", url="https://srv.example/mcp", extra_config=None):
        config = {"type": "streamable-http", "url": url, "title": title}
        if extra_config:
            config.update(extra_config)
        return self.client.post("/api/mcp/servers", json={"config": config}, headers=self._headers())


class CreateServerTests(MCPRouteHarness):
    def test_create_success_stores_tools_and_no_assistant_sync(self):
        with patch("api.routes.misc.fetch_mcp_tools", return_value=_TOOLS):
            resp = self._create()
        self.assertEqual(resp.status_code, 201, resp.get_data(as_text=True))
        body = resp.get_json()
        self.assertEqual(body["serverName"], "my-server")
        # Row stored with raw tools + openai_tools, marked fetched.
        row = self.fake_mcp.get(self.USER_ID, "my-server")
        self.assertEqual(len(row["tools"]), 2)
        self.assertEqual(len(row["openai_tools"]), 2)
        self.assertIn("lastFetchedAt", row)
        exposed = {t["function"]["name"] for t in row["openai_tools"]}
        self.assertEqual(exposed, {"search_mcp_my-server", "fetch_mcp_my-server"})

    def test_create_surfaces_connection_failure_as_502(self):
        from api.services.mcp_service import MCPConnectionError
        with patch("api.routes.misc.fetch_mcp_tools", side_effect=MCPConnectionError("refused")):
            resp = self._create()
        self.assertEqual(resp.status_code, 502)
        self.assertIn("refused", resp.get_json()["error"])
        # Nothing persisted on failure.
        self.assertIsNone(self.fake_mcp.get(self.USER_ID, "my-server"))

    def test_create_duplicate_name_conflicts(self):
        with patch("api.routes.misc.fetch_mcp_tools", return_value=_TOOLS):
            self._create()
            resp = self._create()
        self.assertEqual(resp.status_code, 409)

    def test_create_requires_title(self):
        resp = self.client.post(
            "/api/mcp/servers",
            json={"config": {"url": "https://x/mcp", "type": "streamable-http"}},
            headers=self._headers(),
        )
        self.assertEqual(resp.status_code, 400)

    def test_init_and_get_never_leak_tools_payload(self):
        # The stored openai_tools/tools blobs must not ride in the servers list
        # response (they can be large); only config is surfaced.
        with patch("api.routes.misc.fetch_mcp_tools", return_value=_TOOLS):
            self._create()
        resp = self.client.get("/api/mcp/servers", headers=self._headers())
        self.assertEqual(resp.status_code, 200)
        entry = resp.get_json()["my-server"]
        self.assertNotIn("openai_tools", entry)
        self.assertNotIn("tools", entry)
        self.assertIn("url", entry)


class UpdateServerTests(MCPRouteHarness):
    def _seed(self):
        with patch("api.routes.misc.fetch_mcp_tools", return_value=_TOOLS):
            self._create()

    def test_patch_refetches_tools_with_merged_config(self):
        self._seed()
        new_tools = [{"name": "only", "description": "", "inputSchema": {}}]
        with patch("api.routes.misc.fetch_mcp_tools", return_value=new_tools) as fetch:
            resp = self.client.patch(
                "/api/mcp/servers/my-server",
                json={"config": {"url": "https://new.example/mcp"}},
                headers=self._headers(),
            )
        self.assertEqual(resp.status_code, 200)
        # fetch was called with the merged config (new url).
        called_arg = fetch.call_args.args[0]
        self.assertEqual(called_arg["config"]["url"], "https://new.example/mcp")
        row = self.fake_mcp.get(self.USER_ID, "my-server")
        self.assertEqual([t["name"] for t in row["tools"]], ["only"])

    def test_patch_connection_failure_keeps_old_row(self):
        self._seed()
        from api.services.mcp_service import MCPConnectionError
        with patch("api.routes.misc.fetch_mcp_tools", side_effect=MCPConnectionError("down")):
            resp = self.client.patch(
                "/api/mcp/servers/my-server",
                json={"config": {"url": "https://broken/mcp"}},
                headers=self._headers(),
            )
        self.assertEqual(resp.status_code, 502)
        # Old row (2 tools, old url) preserved.
        row = self.fake_mcp.get(self.USER_ID, "my-server")
        self.assertEqual(len(row["tools"]), 2)
        self.assertEqual(row["config"]["url"], "https://srv.example/mcp")

    def test_delete_removes_row(self):
        self._seed()
        resp = self.client.delete("/api/mcp/servers/my-server", headers=self._headers())
        self.assertEqual(resp.status_code, 200)
        self.assertIsNone(self.fake_mcp.get(self.USER_ID, "my-server"))


class ClientPayloadShapeTests(unittest.TestCase):
    """/api/init and GET /api/mcp/servers share one react-query cache key.

    When their shapes diverged, /api/init seeded the cache with the raw row
    (config nested under `config`) while the client reads `config.title` /
    `config.url` — silently blanking the server edit form.
    """

    def test_config_fields_are_flattened_and_tools_stripped(self):
        from api.services.mcp_service import mcp_server_client_payload

        row = {
            "serverName": "srv",
            "dbId": "abc",
            "config": {"title": "My Server", "url": "https://x/mcp", "type": "streamable-http"},
            "tools": [{"name": "t"}],
            "openai_tools": [{"type": "function"}],
            "lastFetchedAt": "2026-07-14T00:00:00Z",
        }
        payload = mcp_server_client_payload(row)
        # Config fields at the TOP level — not nested under "config".
        self.assertEqual(payload["title"], "My Server")
        self.assertEqual(payload["url"], "https://x/mcp")
        self.assertNotIn("config", payload)
        # Tool blobs never ride along.
        self.assertNotIn("tools", payload)
        self.assertNotIn("openai_tools", payload)
        self.assertEqual(payload["serverName"], "srv")
        self.assertEqual(payload["dbId"], "abc")


class EffectivePermissionsTests(MCPRouteHarness):
    def test_owner_gets_view_edit_delete_bits(self):
        # Without this the client defaults to VIEW-only (1) and hides Edit on
        # every card — the user could only reconnect or delete their own server.
        with patch("api.routes.misc.fetch_mcp_tools", return_value=_TOOLS):
            created = self._create().get_json()
        resp = self.client.get("/api/permissions/mcpServer/effective/all", headers=self._headers())
        self.assertEqual(resp.status_code, 200)
        perms = resp.get_json()
        self.assertEqual(perms[created["dbId"]], 7)  # VIEW|EDIT|DELETE

    def test_other_resource_types_unchanged(self):
        resp = self.client.get("/api/permissions/agent/effective/all", headers=self._headers())
        self.assertEqual(resp.get_json(), {})


class ReinitializeAndStatusTests(MCPRouteHarness):
    def _seed(self):
        with patch("api.routes.misc.fetch_mcp_tools", return_value=_TOOLS):
            self._create()

    def test_reinitialize_success(self):
        self._seed()
        with patch("api.routes.misc.fetch_mcp_tools", return_value=_TOOLS[:1]):
            resp = self.client.post("/api/mcp/my-server/reinitialize", headers=self._headers())
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()
        self.assertTrue(body["success"])
        self.assertFalse(body["oauthRequired"])
        row = self.fake_mcp.get(self.USER_ID, "my-server")
        self.assertEqual(len(row["tools"]), 1)

    def test_reinitialize_failure_records_last_error(self):
        self._seed()
        from api.services.mcp_service import MCPConnectionError
        with patch("api.routes.misc.fetch_mcp_tools", side_effect=MCPConnectionError("nope")):
            resp = self.client.post("/api/mcp/my-server/reinitialize", headers=self._headers())
        self.assertEqual(resp.status_code, 502)
        self.assertFalse(resp.get_json()["success"])
        row = self.fake_mcp.get(self.USER_ID, "my-server")
        self.assertIn("nope", row["lastError"])

    def test_reinitialize_unknown_server_404(self):
        resp = self.client.post("/api/mcp/ghost/reinitialize", headers=self._headers())
        self.assertEqual(resp.status_code, 404)

    def test_connection_status_reports_connected(self):
        self._seed()
        resp = self.client.get("/api/mcp/connection/status", headers=self._headers())
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()
        self.assertTrue(body["success"])
        self.assertEqual(body["connectionStatus"]["my-server"]["connectionState"], "connected")
        self.assertFalse(body["connectionStatus"]["my-server"]["requiresOAuth"])

    def test_per_server_connection_status_error_state(self):
        self._seed()
        # Simulate a prior failed reinitialize.
        row = self.fake_mcp.get(self.USER_ID, "my-server")
        row["lastError"] = "boom"
        row["tools"] = []
        row["openai_tools"] = []
        self.fake_mcp.put(self.USER_ID, "my-server", row)
        resp = self.client.get("/api/mcp/connection/status/my-server", headers=self._headers())
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.get_json()["connectionStatus"], "error")


if __name__ == "__main__":
    unittest.main()
