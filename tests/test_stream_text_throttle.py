"""SSE text-event throttling: api.routes.chat._TextEventThrottle.

Every chat text event carries the FULL accumulated answer (cumulative-
snapshot contract), so per-chunk emission was O(n^2) in wire bytes and
sanitizer CPU. The throttle coalesces snapshots without changing the
contract: first chunk emits immediately (first-paint), intermediate
snapshots are dropped, and a flush always lands before non-text events and
at every loop exit so ordering/completeness assertions hold.
"""

from __future__ import annotations

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
        "tool_calls": [
            {"id": call_id, "type": "function", "function": {"name": name, "arguments": args}}
        ],
    }


def _run_ended(total=100, inp=60, out=40):
    return {"type": "run_ended", "input_tokens": inp, "output_tokens": out, "total_tokens": total}


class TextEventThrottleUnitTests(unittest.TestCase):
    def _throttle(self, throttle_ms=75, flush_bytes=8192):
        calls = {"n": 0}

        def render():
            calls["n"] += 1
            return {"type": "text", "n": calls["n"]}

        with patch.object(chat, "CHAT_SSE_TEXT_THROTTLE_MS", throttle_ms), patch.object(
            chat, "CHAT_SSE_TEXT_FLUSH_BYTES", flush_bytes
        ):
            throttle = chat._TextEventThrottle(render)
        return throttle, calls

    def test_first_note_emits_immediately(self):
        throttle, calls = self._throttle()
        self.assertEqual(len(throttle.note(5)), 1)
        self.assertEqual(calls["n"], 1)

    def test_second_note_within_window_is_buffered(self):
        throttle, calls = self._throttle()
        throttle.note(5)
        self.assertEqual(throttle.note(5), ())
        self.assertEqual(calls["n"], 1)

    def test_flush_emits_pending_once_and_is_idempotent(self):
        throttle, calls = self._throttle()
        throttle.note(5)
        throttle.note(5)  # buffered
        self.assertEqual(len(throttle.flush()), 1)
        self.assertEqual(throttle.flush(), ())
        self.assertEqual(calls["n"], 2)

    def test_flush_without_pending_is_empty(self):
        throttle, calls = self._throttle()
        self.assertEqual(throttle.flush(), ())
        self.assertEqual(calls["n"], 0)

    def test_byte_threshold_forces_emission(self):
        throttle, calls = self._throttle(throttle_ms=10_000_000, flush_bytes=10)
        throttle.note(5)  # first-paint emit
        self.assertEqual(throttle.note(4), ())  # 4 pending < 10
        self.assertEqual(len(throttle.note(6)), 1)  # 10 pending >= 10
        self.assertEqual(calls["n"], 2)

    def test_zero_interval_emits_every_note(self):
        throttle, calls = self._throttle(throttle_ms=0)
        for _ in range(5):
            self.assertEqual(len(throttle.note(1)), 1)
        self.assertEqual(calls["n"], 5)


class StreamMcpTurnThrottleTests(unittest.TestCase):
    """The MCP loop under throttling, via the same harness as
    test_mcp_chat_loop (fake segments, patched call_mcp_tool)."""

    def _ctx(self):
        return {
            "thread_id": "thread-1",
            "requested_web_search": None,
            "mcp_tools": [{"type": "function", "function": {"name": "search_mcp_srv"}}],
            "mcp_tool_map": {
                "search_mcp_srv": ({"serverName": "srv", "config": {"url": "https://srv"}}, "search"),
            },
        }

    def _drive(self, segments, tool_output='{"result": "ok"}'):
        result = {"full_text": "", "input_tokens": 0, "output_tokens": 0, "total_tokens": 0}
        media = {"dir_key": "", "partition_id": "p", "media": [], "jobs": []}
        seg_iter = iter(segments)

        with patch("api.routes.chat.call_mcp_tool", return_value=tool_output):
            events = list(chat.stream_mcp_turn(
                self._ctx(), IDS, result, media,
                open_stream=lambda: iter(list(next(seg_iter))),
                open_continuation=lambda run_id, outs: iter(list(next(seg_iter))),
            ))
        return events, result

    def test_many_chunks_coalesce_but_final_text_is_complete(self):
        chunks = [_content(f"word{i} ") for i in range(50)]
        segments = [[*chunks, _run_ended()]]
        events, result = self._drive(segments)

        text_events = [e for e in events if e["type"] == "text"]
        expected = "".join(f"word{i} " for i in range(50))
        self.assertEqual(result["full_text"], expected)
        # Coalesced: far fewer snapshot events than chunks...
        self.assertLess(len(text_events), 50)
        # ...but the LAST snapshot (the run_ended pre-flush) carries everything.
        self.assertEqual(text_events[-1]["text"]["value"].strip(), expected.strip())

    def test_full_segment_text_flushed_before_tool_call_event(self):
        segments = [
            [_content("Let me "), _content("check. "), _tsr("run-1", "search_mcp_srv")],
            [_content("Found it."), _run_ended()],
        ]
        events, result = self._drive(segments)
        self.assertEqual(result["full_text"], "Let me check. Found it.")

        first_tool_pos = next(i for i, e in enumerate(events) if e["type"] == "tool_call")
        pre_tool_texts = [e for e in events[:first_tool_pos] if e["type"] == "text"]
        # The held tail of the preamble segment rendered BEFORE the tool chip,
        # under the preamble's own index.
        self.assertTrue(pre_tool_texts)
        self.assertEqual(pre_tool_texts[-1]["text"]["value"].strip(), "Let me check.")
        tool_idx = events[first_tool_pos]["index"]
        self.assertLess(pre_tool_texts[-1]["index"], tool_idx)

    def test_error_chunk_flushes_tail_before_raising(self):
        segments = [[_content("partial "), _content("answer"), {"type": "error", "error": "boom"}]]
        result = {"full_text": "", "input_tokens": 0, "output_tokens": 0, "total_tokens": 0}
        media = {"dir_key": "", "partition_id": "p", "media": [], "jobs": []}
        seg_iter = iter(segments)
        collected = []

        with patch("api.routes.chat.call_mcp_tool", return_value="{}"):
            gen = chat.stream_mcp_turn(
                self._ctx(), IDS, result, media,
                open_stream=lambda: iter(list(next(seg_iter))),
                open_continuation=lambda run_id, outs: iter(list(next(seg_iter))),
            )
            with self.assertRaises(Exception) as cm:
                for event in gen:
                    collected.append(event)
        self.assertIn("boom", str(cm.exception))

        text_events = [e for e in collected if e["type"] == "text"]
        # The pre-raise flush delivered the full accumulated tail.
        self.assertEqual(text_events[-1]["text"]["value"], "partial answer")


if __name__ == "__main__":
    unittest.main()
