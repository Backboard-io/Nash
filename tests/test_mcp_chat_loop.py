"""The streaming MCP tool loop: api.routes.chat.stream_mcp_turn.

Drives the loop with fake Backboard stream segments and a fake MCP executor
(patched call_mcp_tool), asserting the behavior verified against the live API:
- per-turn tools -> tool_submit_required -> execute -> stream continuation
- CHAINED rounds: a continuation that itself pauses with tool_submit_required
  is satisfied and re-continued (the bug the old run_with_tool_loop had)
- tool-call UI events are emitted with the _mcp_ delimiter name + progress
- content flows to text parts; token totals come from run_ended
- the round cap stops runaway tool loops
- an unknown tool name yields an error output but does not crash the turn
"""

from __future__ import annotations

import json
import unittest
from unittest.mock import patch

from api.routes import chat


IDS = {
    "response_message_id": "resp-1",
    "conversation_id": "conv-1",
    "user_message_id": "user-1",
    "thread_id": "thread-1",
}


def _content(text):
    return {"type": "content_streaming", "content": text}


def _tsr(run_id, name, args="{}", call_id="call-1"):
    return {
        "type": "tool_submit_required",
        "run_id": run_id,
        "tool_calls": [{"id": call_id, "type": "function", "function": {"name": name, "arguments": args}}],
    }


def _run_ended(total=100, inp=60, out=40):
    return {"type": "run_ended", "input_tokens": inp, "output_tokens": out, "total_tokens": total}


def _iterify(chunks):
    """A plain sync iterator over chunk dicts (matches iter_async's output)."""
    return iter(list(chunks))


class StreamMcpTurnTests(unittest.TestCase):
    def _ctx(self, tool_map=None):
        return {
            "thread_id": "thread-1",
            "requested_web_search": None,
            "mcp_tools": [{"type": "function", "function": {"name": "search_mcp_srv"}}],
            "mcp_tool_map": tool_map if tool_map is not None else {
                "search_mcp_srv": ({"serverName": "srv", "config": {"url": "https://srv"}}, "search"),
            },
        }

    def _drive(self, ctx, segments, tool_output='{"result": "ok"}'):
        """Run stream_mcp_turn over prepared segments.

        `segments` is a list of chunk-lists: segments[0] is the initial stream;
        each subsequent segment is returned by the next open_continuation call.
        """
        result = {"full_text": "", "input_tokens": 0, "output_tokens": 0, "total_tokens": 0}
        media = {"dir_key": "", "partition_id": "p", "media": [], "jobs": []}
        seg_iter = iter(segments)
        continuations = []

        def open_stream():
            return _iterify(next(seg_iter))

        def open_continuation(run_id, tool_outputs):
            continuations.append((run_id, tool_outputs))
            return _iterify(next(seg_iter))

        with patch("api.routes.chat.call_mcp_tool", return_value=tool_output):
            events = list(chat.stream_mcp_turn(
                ctx, IDS, result, media,
                open_stream=open_stream,
                open_continuation=open_continuation,
            ))
        return events, result, continuations

    # --------------------------------------------------------------------- #

    def test_single_tool_round_then_answer(self):
        segments = [
            [_tsr("run-1", "search_mcp_srv", args='{"q": "hi"}')],
            [_content("The answer "), _content("is 42."), _run_ended(total=90)],
        ]
        events, result, conts = self._drive(self._ctx(), segments)

        self.assertEqual(result["full_text"], "The answer is 42.")
        self.assertEqual(result["total_tokens"], 90)
        # One continuation opened, carrying our tool output.
        self.assertEqual(len(conts), 1)
        run_id, outputs = conts[0]
        self.assertEqual(run_id, "run-1")
        self.assertEqual(outputs[0]["tool_call_id"], "call-1")
        self.assertEqual(json.loads(outputs[0]["output"]), {"result": "ok"})

    def test_tool_call_ui_events_use_mcp_delimiter_and_progress(self):
        segments = [
            [_tsr("run-1", "search_mcp_srv", args='{"q": "x"}')],
            [_content("done"), _run_ended()],
        ]
        events, _result, _c = self._drive(self._ctx(), segments)
        tool_events = [e for e in events if e["type"] == "tool_call"]
        self.assertEqual(len(tool_events), 2)  # in-progress + completed
        self.assertIn("_mcp_", tool_events[0]["tool_call"]["name"])
        self.assertEqual(tool_events[0]["tool_call"]["progress"], 0.1)
        self.assertIsNone(tool_events[0]["tool_call"]["output"])
        self.assertEqual(tool_events[1]["tool_call"]["progress"], 1)
        self.assertEqual(json.loads(tool_events[1]["tool_call"]["output"]), {"result": "ok"})
        # Both parts share one content index (progress overwrite).
        self.assertEqual(tool_events[0]["index"], tool_events[1]["index"])

    def test_chained_tool_rounds(self):
        # Continuation itself pauses with a second tool call — the exact case
        # the retired run_with_tool_loop dropped.
        ctx = self._ctx(tool_map={
            "get_city_mcp_srv": ({"serverName": "srv", "config": {}}, "get_city"),
            "get_weather_mcp_srv": ({"serverName": "srv", "config": {}}, "get_weather"),
        })
        segments = [
            [_tsr("run-1", "get_city_mcp_srv", call_id="c1")],
            [_tsr("run-1", "get_weather_mcp_srv", args='{"city":"Beirut"}', call_id="c2")],
            [_content("Beirut: 31C clear."), _run_ended(total=250)],
        ]
        events, result, conts = self._drive(ctx, segments)
        self.assertEqual(result["full_text"], "Beirut: 31C clear.")
        self.assertEqual(result["total_tokens"], 250)
        self.assertEqual(len(conts), 2)  # two continuations = two chained rounds
        self.assertEqual([c[0] for c in conts], ["run-1", "run-1"])  # same run id

    def test_preamble_text_then_tool_then_answer_ordering(self):
        # Text before the tool call must land at a lower index than the tool
        # part, and the post-tool answer at a higher index — chronological order.
        segments = [
            [_content("Let me check. "), _tsr("run-1", "search_mcp_srv")],
            [_content("Found it."), _run_ended()],
        ]
        events, result, _c = self._drive(self._ctx(), segments)
        self.assertEqual(result["full_text"], "Let me check. Found it.")
        text_events = [e for e in events if e["type"] == "text"]
        tool_events = [e for e in events if e["type"] == "tool_call"]
        preamble_idx = text_events[0]["index"]
        tool_idx = tool_events[0]["index"]
        answer_idx = text_events[-1]["index"]
        self.assertLess(preamble_idx, tool_idx)
        self.assertLess(tool_idx, answer_idx)

    def test_round_cap_stops_runaway(self):
        # Every segment pauses with a tool call and never finishes.
        loop_segments = [[_tsr("run-1", "search_mcp_srv", call_id=f"c{i}")] for i in range(chat.MAX_TOOL_ITERATIONS + 5)]
        result = {"full_text": "", "input_tokens": 0, "output_tokens": 0, "total_tokens": 0}
        media = {"dir_key": "", "partition_id": "p", "media": [], "jobs": []}
        seg_iter = iter(loop_segments)
        opened = {"n": 0}

        def open_stream():
            return _iterify(next(seg_iter))

        def open_continuation(run_id, tool_outputs):
            opened["n"] += 1
            return _iterify(next(seg_iter))

        with patch("api.routes.chat.call_mcp_tool", return_value="{}"):
            list(chat.stream_mcp_turn(self._ctx(), IDS, result, media,
                                      open_stream=open_stream, open_continuation=open_continuation))
        # Stops at the cap, not the full 15 prepared segments.
        self.assertLessEqual(opened["n"], chat.MAX_TOOL_ITERATIONS)
        self.assertIn("too many tool calls", result["full_text"])

    def test_unknown_tool_yields_error_output_not_crash(self):
        # tool_map has no entry for the requested name.
        ctx = self._ctx(tool_map={})
        segments = [
            [_tsr("run-1", "ghost_mcp_srv")],
            [_content("handled"), _run_ended()],
        ]
        events, result, conts = self._drive(ctx, segments)
        # Turn still completes; the submitted output is an error blob.
        self.assertEqual(result["full_text"], "handled")
        _run_id, outputs = conts[0]
        self.assertIn("error", json.loads(outputs[0]["output"]))

    def test_backboard_error_chunk_raises(self):
        segments = [[{"type": "error", "error": "provider exploded"}]]
        with self.assertRaises(Exception) as cm:
            self._drive(self._ctx(), segments)
        self.assertIn("provider exploded", str(cm.exception))

    def test_executed_calls_survive_a_failing_continuation(self):
        """The tool ran and its chip streamed; then the continuation run failed.

        chat.py harvests result["tool_calls"] in a `finally`, so the finalized
        message still carries the chip the user just watched appear. That only
        works if stream_mcp_turn has ALREADY recorded the call before it raises —
        this pins that ordering.
        """
        result = {"full_text": "", "input_tokens": 0, "output_tokens": 0, "total_tokens": 0}
        media = {"dir_key": "", "partition_id": "p", "media": [], "jobs": []}
        segments = [
            [_tsr("run-1", "search_mcp_srv", args='{"q": "hi"}')],
            [{"type": "error", "error": "continuation exploded"}],
        ]
        seg_iter = iter(segments)

        with patch("api.routes.chat.call_mcp_tool", return_value='{"result": "ok"}'):
            with self.assertRaises(Exception):
                list(chat.stream_mcp_turn(
                    self._ctx(), IDS, result, media,
                    open_stream=lambda: _iterify(next(seg_iter)),
                    open_continuation=lambda run_id, outs: _iterify(next(seg_iter)),
                ))

        calls = result.get("tool_calls") or []
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]["name"], "search_mcp_srv")
        self.assertEqual(chat._tool_chip_parts(calls)[0]["tool_call"]["name"], "search_mcp_srv")


if __name__ == "__main__":
    unittest.main()
