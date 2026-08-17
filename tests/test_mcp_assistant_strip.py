"""Migration: api.routes.chat._strip_legacy_assistant_tools_once.

The retired assistant-sync path left MCP tool definitions persisted on the
nash-main assistant; persisted tools fire on every turn and stall plain
streaming turns (the tool_submit_required the old code never handled). This
one-time cleanup strips them. Tests: it strips only when MCP-shaped tools are
present, runs at most once per assistant per process, and never blocks a turn
on failure.
"""

from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from api.routes import chat


class _Tool:
    def __init__(self, name):
        self.function = MagicMock()
        self.function.name = name


def _assistant(tool_names):
    a = MagicMock()
    a.tools = [_Tool(n) for n in tool_names]
    return a


class StripLegacyAssistantToolsTests(unittest.TestCase):
    def setUp(self):
        chat._STRIPPED_ASSISTANTS.clear()
        self.addCleanup(chat._STRIPPED_ASSISTANTS.clear)

    def _bb(self, assistant):
        bb = MagicMock()
        bb.get_assistant = AsyncMock(return_value=assistant)
        bb.update_assistant = AsyncMock(return_value=None)
        return bb

    def test_strips_when_mcp_tools_present(self):
        bb = self._bb(_assistant(["search_mcp_srv", "other__tool"]))
        chat._strip_legacy_assistant_tools_once("u1", "asst-1", bb)
        bb.update_assistant.assert_awaited_once()
        kwargs = bb.update_assistant.await_args.kwargs
        self.assertEqual(kwargs["assistant_id"], "asst-1")
        self.assertEqual(kwargs["tools"], [])

    def test_noop_when_no_mcp_tools(self):
        bb = self._bb(_assistant(["plain_function", "another_tool"]))
        chat._strip_legacy_assistant_tools_once("u1", "asst-1", bb)
        bb.update_assistant.assert_not_awaited()

    def test_noop_when_no_tools(self):
        bb = self._bb(_assistant([]))
        chat._strip_legacy_assistant_tools_once("u1", "asst-1", bb)
        bb.update_assistant.assert_not_awaited()

    def test_runs_once_per_assistant(self):
        bb = self._bb(_assistant(["search_mcp_srv"]))
        chat._strip_legacy_assistant_tools_once("u1", "asst-1", bb)
        chat._strip_legacy_assistant_tools_once("u1", "asst-1", bb)
        # get_assistant only fetched on the first call.
        bb.get_assistant.assert_awaited_once()

    def test_failure_does_not_raise_and_allows_retry(self):
        bb = MagicMock()
        bb.get_assistant = AsyncMock(side_effect=RuntimeError("api down"))
        # Must not raise (never blocks a chat turn).
        chat._strip_legacy_assistant_tools_once("u1", "asst-1", bb)
        # Retry allowed: the assistant is NOT marked done after a failure.
        self.assertNotIn("asst-1", chat._STRIPPED_ASSISTANTS)

    def test_empty_assistant_id_is_noop(self):
        bb = self._bb(_assistant(["search_mcp_srv"]))
        chat._strip_legacy_assistant_tools_once("u1", "", bb)
        bb.get_assistant.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
