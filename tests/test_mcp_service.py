"""Unit tests for api.services.mcp_service (the MCP client on the official SDK).

Covers tool-name conversion/truncation, the per-turn tool payload builder
(build_tool_payload) incl. the legacy-row fallback, and fetch/call behavior via
a fake in-process MCP ClientSession (patching _mcp_session so no network runs).
"""

import asyncio
import json
import unittest
from contextlib import asynccontextmanager
from decimal import Decimal
from unittest.mock import patch

from api.services import mcp_service


# --------------------------------------------------------------------------- #
# Fake MCP server: a ClientSession stand-in yielding canned tools/results.
# --------------------------------------------------------------------------- #

class _FakeContentBlock:
    def __init__(self, type_, text=None, data=None):
        self.type = type_
        self.text = text
        self._data = data or {}

    def model_dump(self, mode="json", exclude_none=True):
        return {"type": self.type, **self._data}


class _FakeCallResult:
    def __init__(self, content, is_error=False, structured=None):
        self.content = content
        self.isError = is_error
        self.structuredContent = structured


class _FakeToolsPage:
    def __init__(self, tools, next_cursor=None):
        self.tools = tools
        self.nextCursor = next_cursor


class _FakeTool:
    def __init__(self, name, description, schema):
        self.name = name
        self.description = description
        self.inputSchema = schema

    def model_dump(self, mode="json", exclude_none=True):
        return {"name": self.name, "description": self.description, "inputSchema": self.inputSchema}


class _FakeSession:
    def __init__(self, tools=None, call_result=None, list_error=None, call_error=None, pages=None):
        self._tools = tools or []
        self._call_result = call_result
        self._list_error = list_error
        self._call_error = call_error
        self._pages = pages  # list of _FakeToolsPage for pagination tests
        self.calls = []

    async def list_tools(self, cursor=None):
        if self._list_error:
            raise self._list_error
        if self._pages is not None:
            # Serve pages by cursor: None -> page0, then page.nextCursor drives.
            idx = 0 if cursor is None else int(cursor)
            return self._pages[idx]
        return _FakeToolsPage(self._tools)

    async def call_tool(self, name, arguments):
        self.calls.append((name, arguments))
        if self._call_error:
            raise self._call_error
        return self._call_result


def _patch_session(session):
    @asynccontextmanager
    async def _fake_ctx(server):
        yield session
    return patch.object(mcp_service, "_mcp_session", _fake_ctx)


# --------------------------------------------------------------------------- #
# Pure functions
# --------------------------------------------------------------------------- #

class MakeToolNameTests(unittest.TestCase):
    def test_uses_mcp_delimiter(self):
        self.assertEqual(
            mcp_service.make_openai_tool_name("search_docs", "context7"),
            "search_docs_mcp_context7",
        )

    def test_no_server_name_is_bare_tool(self):
        self.assertEqual(mcp_service.make_openai_tool_name("do_thing", ""), "do_thing")

    def test_sanitizes_unsafe_chars(self):
        name = mcp_service.make_openai_tool_name("weird name!*", "srv")
        self.assertNotIn(" ", name)
        self.assertNotIn("!", name)
        self.assertNotIn("*", name)

    def test_truncates_over_64_chars_deterministically(self):
        long_tool = "x" * 80
        a = mcp_service.make_openai_tool_name(long_tool, "server")
        b = mcp_service.make_openai_tool_name(long_tool, "server")
        self.assertLessEqual(len(a), mcp_service.MAX_TOOL_NAME_LEN)
        self.assertEqual(a, b)  # deterministic

    def test_distinct_long_names_do_not_collide(self):
        a = mcp_service.make_openai_tool_name("alpha_" + "x" * 80, "server")
        b = mcp_service.make_openai_tool_name("beta_" + "x" * 80, "server")
        self.assertNotEqual(a, b)


class AuthHeaderTests(unittest.TestCase):
    """Static auth (v1): the headers actually sent to an MCP server."""

    def _headers(self, api_key_cfg, extra=None):
        config = {"url": "https://x/mcp"}
        if api_key_cfg is not None:
            config["apiKey"] = api_key_cfg
        if extra:
            config["headers"] = extra
        return mcp_service._build_headers({"config": config})

    def test_bearer(self):
        h = self._headers({"key": "sk-123", "authorization_type": "bearer"})
        self.assertEqual(h["Authorization"], "Bearer sk-123")

    def test_basic(self):
        h = self._headers({"key": "dXNlcjpwYXNz", "authorization_type": "basic"})
        self.assertEqual(h["Authorization"], "Basic dXNlcjpwYXNz")

    def test_custom_header(self):
        h = self._headers({
            "key": "sk-xyz",
            "authorization_type": "custom",
            "custom_header": "X-Api-Key",
        })
        self.assertEqual(h["X-Api-Key"], "sk-xyz")
        self.assertNotIn("Authorization", h)

    def test_no_auth_sends_no_credential_header(self):
        h = self._headers(None)
        self.assertNotIn("Authorization", h)

    def test_empty_key_sends_no_credential_header(self):
        h = self._headers({"key": "", "authorization_type": "bearer"})
        self.assertNotIn("Authorization", h)

    def test_extra_headers_merge(self):
        h = self._headers({"key": "k", "authorization_type": "bearer"}, extra={"X-Trace": "1"})
        self.assertEqual(h["X-Trace"], "1")
        self.assertEqual(h["Authorization"], "Bearer k")


class DescribeErrorTests(unittest.TestCase):
    """The SDK buries the real cause inside a TaskGroup ExceptionGroup; users
    were shown "unhandled errors in a TaskGroup (1 sub-exception)" when their
    API key was simply wrong."""

    def _http_error(self, status):
        exc = RuntimeError("boom")
        exc.response = type("R", (), {"status_code": status})()
        return exc

    def test_401_inside_exception_group_reports_credentials(self):
        grouped = ExceptionGroup("unhandled errors in a TaskGroup", [self._http_error(401)])
        msg = mcp_service.describe_mcp_error(grouped)
        self.assertIn("401", msg)
        self.assertIn("credentials", msg.lower())
        self.assertNotIn("TaskGroup", msg)

    def test_403_reports_credentials(self):
        msg = mcp_service.describe_mcp_error(self._http_error(403))
        self.assertIn("403", msg)
        self.assertIn("credentials", msg.lower())

    def test_404_reports_bad_endpoint(self):
        msg = mcp_service.describe_mcp_error(self._http_error(404))
        self.assertIn("404", msg)

    def test_timeout(self):
        msg = mcp_service.describe_mcp_error(TimeoutError())
        self.assertIn("Timed out", msg)

    def test_plain_error_keeps_its_message(self):
        msg = mcp_service.describe_mcp_error(ValueError("nope"))
        self.assertIn("nope", msg)


class McpSystemPromptTests(unittest.TestCase):
    """Sending tools does not make a model use them.

    Verified live: with an AWS-docs MCP server attached, "What is S3 Express One
    Zone?" triggered NO tool call — the model answered from memory and got the
    pricing wrong. A live-weather question, which it knows it cannot answer, did
    call the tool. Backboard exposes no `tool_choice`, so this per-turn system
    prompt is the only lever to bias toward calling the tool.
    """

    def _servers(self):
        return {
            "aws-knowledge": {
                "serverName": "aws-knowledge",
                "config": {"title": "AWS Knowledge", "description": "Official AWS docs"},
                "tools": [{"name": "aws___search_documentation"}, {"name": "aws___read_documentation"}],
            },
        }

    def test_names_the_servers_and_their_tools(self):
        prompt = mcp_service.build_mcp_system_prompt(self._servers())
        self.assertIn("AWS Knowledge", prompt)
        self.assertIn("Official AWS docs", prompt)
        self.assertIn("aws___search_documentation", prompt)

    def test_instructs_the_model_to_prefer_tools_over_memory(self):
        prompt = mcp_service.build_mcp_system_prompt(self._servers())
        self.assertIn("MUST call", prompt)
        # The whole point: do not answer from training data when a tool exists.
        self.assertIn("Do NOT answer", prompt)
        self.assertIn("even if you believe you already know", prompt)

    def test_forbids_inventing_tool_results(self):
        # A model once claimed a "verbatim" quote it had actually paraphrased.
        prompt = mcp_service.build_mcp_system_prompt(self._servers())
        self.assertIn("Never invent tool results", prompt)

    def test_falls_back_to_server_name_when_untitled(self):
        servers = {"srv": {"serverName": "srv", "config": {}, "tools": [{"name": "do_thing"}]}}
        prompt = mcp_service.build_mcp_system_prompt(servers)
        self.assertIn("srv", prompt)
        self.assertIn("do_thing", prompt)

    def test_multiple_servers_all_listed(self):
        servers = self._servers()
        servers["weather"] = {
            "serverName": "weather",
            "config": {"title": "Weather"},
            "tools": [{"name": "get_current_weather"}],
        }
        prompt = mcp_service.build_mcp_system_prompt(servers)
        self.assertIn("AWS Knowledge", prompt)
        self.assertIn("Weather", prompt)
        self.assertIn("get_current_weather", prompt)


class BuildToolPayloadTests(unittest.TestCase):
    def _server(self, name, tools):
        return {"serverName": name, "config": {"url": f"https://{name}"}, "tools": tools}

    def test_builds_tools_and_dispatch_map_from_raw_tools(self):
        server = self._server("ctx", [
            {"name": "search", "description": "d", "inputSchema": {"type": "object", "properties": {}}},
        ])
        tools, tool_map = mcp_service.build_tool_payload({"ctx": server})
        self.assertEqual(len(tools), 1)
        exposed = tools[0]["function"]["name"]
        self.assertEqual(exposed, "search_mcp_ctx")
        self.assertIn(exposed, tool_map)
        mapped_server, real = tool_map[exposed]
        self.assertEqual(real, "search")
        self.assertIs(mapped_server, server)

    def test_multiple_servers_namespaced(self):
        s1 = self._server("a", [{"name": "read", "description": "", "inputSchema": {}}])
        s2 = self._server("b", [{"name": "read", "description": "", "inputSchema": {}}])
        tools, tool_map = mcp_service.build_tool_payload({"a": s1, "b": s2})
        names = {t["function"]["name"] for t in tools}
        self.assertEqual(names, {"read_mcp_a", "read_mcp_b"})
        self.assertEqual(len(tool_map), 2)

    def test_dynamodb_decimals_are_json_encodable(self):
        # Regression: DynamoDB returns every number in a stored tool schema as a
        # Decimal. Those schemas go straight back out to Backboard as per-turn
        # `tools`, and the JSON encoder rejects Decimal — the turn died with
        # "Object of type Decimal is not JSON serializable".
        server = {
            "serverName": "ctx",
            "config": {"url": "https://ctx"},
            "tools": [{
                "name": "search",
                "description": "d",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "limit": {"type": "integer", "maximum": Decimal("100"), "default": Decimal("10")},
                        "ratio": {"type": "number", "minimum": Decimal("0.5")},
                    },
                    "required": ["limit"],
                },
            }],
        }
        tools, _tool_map = mcp_service.build_tool_payload({"ctx": server})
        json.dumps(tools)  # must not raise
        props = tools[0]["function"]["parameters"]["properties"]
        self.assertEqual(props["limit"]["maximum"], 100)
        self.assertIsInstance(props["limit"]["maximum"], int)
        self.assertEqual(props["ratio"]["minimum"], 0.5)
        self.assertIsInstance(props["ratio"]["minimum"], float)

    def test_legacy_row_decimals_are_json_encodable(self):
        legacy = {
            "serverName": "old",
            "config": {"url": "https://old"},
            "openai_tools": [{
                "type": "function",
                "function": {
                    "name": "old__fetch",
                    "description": "leg",
                    "parameters": {"type": "object", "properties": {"n": {"type": "integer", "maximum": Decimal("5")}}},
                },
            }],
        }
        tools, _ = mcp_service.build_tool_payload({"old": legacy})
        json.dumps(tools)  # must not raise
        self.assertEqual(tools[0]["function"]["parameters"]["properties"]["n"]["maximum"], 5)

    def test_legacy_row_fallback_uses_openai_tools(self):
        # Row saved before this feature: only openai_tools with the old
        # "{server}__{tool}" naming, no raw `tools`.
        legacy = {
            "serverName": "old",
            "config": {"url": "https://old"},
            "openai_tools": [
                {"type": "function", "function": {"name": "old__fetch", "description": "leg", "parameters": {"type": "object"}}},
            ],
        }
        tools, tool_map = mcp_service.build_tool_payload({"old": legacy})
        self.assertEqual(len(tools), 1)
        exposed = tools[0]["function"]["name"]
        self.assertEqual(exposed, "fetch_mcp_old")
        self.assertIn(exposed, tool_map)
        _, real = tool_map[exposed]
        self.assertEqual(real, "fetch")


# --------------------------------------------------------------------------- #
# fetch_mcp_tools / call_mcp_tool via a fake session
# --------------------------------------------------------------------------- #

class FetchToolsTests(unittest.TestCase):
    def _server(self):
        return {"serverName": "s", "config": {"url": "https://s/mcp"}}

    def test_fetch_returns_tool_dicts(self):
        session = _FakeSession(tools=[
            _FakeTool("search", "Search", {"type": "object", "properties": {"q": {"type": "string"}}}),
        ])
        with _patch_session(session):
            tools = asyncio.run(mcp_service.fetch_mcp_tools(self._server()))
        self.assertEqual(len(tools), 1)
        self.assertEqual(tools[0]["name"], "search")
        self.assertIn("inputSchema", tools[0])

    def test_fetch_follows_pagination(self):
        pages = [
            _FakeToolsPage([_FakeTool("a", "", {})], next_cursor="1"),
            _FakeToolsPage([_FakeTool("b", "", {})], next_cursor=None),
        ]
        session = _FakeSession(pages=pages)
        with _patch_session(session):
            tools = asyncio.run(mcp_service.fetch_mcp_tools(self._server()))
        self.assertEqual([t["name"] for t in tools], ["a", "b"])

    def test_fetch_raises_on_connection_error(self):
        session = _FakeSession(list_error=RuntimeError("boom"))
        with _patch_session(session):
            with self.assertRaises(mcp_service.MCPConnectionError):
                asyncio.run(mcp_service.fetch_mcp_tools(self._server()))

    def test_fetch_no_url_raises(self):
        # A misconfigured server (no URL) must surface an error so create/patch
        # return 502 rather than storing a silent zero-tool server.
        with self.assertRaises(mcp_service.MCPConnectionError):
            asyncio.run(mcp_service.fetch_mcp_tools({"config": {}}))


class CallToolTests(unittest.TestCase):
    def _server(self):
        return {"serverName": "s", "config": {"url": "https://s/mcp"}}

    def test_call_returns_joined_text(self):
        result = _FakeCallResult([_FakeContentBlock("text", text="hello"), _FakeContentBlock("text", text="world")])
        session = _FakeSession(call_result=result)
        with _patch_session(session):
            out = asyncio.run(mcp_service.call_mcp_tool(self._server(), "t", {"a": 1}))
        self.assertEqual(out, "hello\nworld")
        self.assertEqual(session.calls, [("t", {"a": 1})])

    def test_call_error_result_wrapped_as_error(self):
        result = _FakeCallResult([_FakeContentBlock("text", text="nope")], is_error=True)
        session = _FakeSession(call_result=result)
        with _patch_session(session):
            out = asyncio.run(mcp_service.call_mcp_tool(self._server(), "t", {}))
        self.assertIn("error", json.loads(out))

    def test_call_exception_returns_error_string_not_raise(self):
        session = _FakeSession(call_error=RuntimeError("kaboom"))
        with _patch_session(session):
            out = asyncio.run(mcp_service.call_mcp_tool(self._server(), "t", {}))
        self.assertIn("kaboom", json.loads(out)["error"])

    def test_call_truncates_huge_output(self):
        big = "z" * (mcp_service.MCP_OUTPUT_MAX_CHARS + 500)
        result = _FakeCallResult([_FakeContentBlock("text", text=big)])
        session = _FakeSession(call_result=result)
        with _patch_session(session):
            out = asyncio.run(mcp_service.call_mcp_tool(self._server(), "t", {}))
        self.assertLessEqual(len(out), mcp_service.MCP_OUTPUT_MAX_CHARS + len("\n[output truncated]"))
        self.assertTrue(out.endswith("[output truncated]"))

    def test_call_structured_content_when_no_text(self):
        result = _FakeCallResult([], structured={"answer": 42})
        session = _FakeSession(call_result=result)
        with _patch_session(session):
            out = asyncio.run(mcp_service.call_mcp_tool(self._server(), "t", {}))
        self.assertEqual(json.loads(out), {"answer": 42})


if __name__ == "__main__":
    unittest.main()


class InitTimeoutTests(unittest.TestCase):
    def test_honors_config_init_timeout_ms(self):
        from api.services import mcp_service
        self.assertEqual(mcp_service.init_timeout_for({"config": {"initTimeout": 150000}}), 150.0)

    def test_defaults_when_absent_or_bad(self):
        from api.services import mcp_service
        self.assertEqual(mcp_service.init_timeout_for({"config": {}}), float(mcp_service.MCP_LIST_TIMEOUT))
        self.assertEqual(mcp_service.init_timeout_for({"config": {"initTimeout": "x"}}), float(mcp_service.MCP_LIST_TIMEOUT))
