"""Stream replay contract for the resumable-chat fix.

Generation now runs on a background producer thread and the HTTP response is a
pure replay of stream_state["events"], so a client refresh no longer aborts the
pipeline. These tests cover `_replay_running_stream` — the consumer half — which
must replay the whole buffer from the start for the initial connection and
terminate correctly."""

import json
import time
import unittest

from api.routes import chat


def _events(payloads):
    out = []
    for p in payloads:
        assert p.startswith("data: ") and p.endswith("\n\n"), p
        out.append(json.loads(p[len("data: ") : -2]))
    return out


class ReplayRunningStreamTests(unittest.TestCase):
    def test_initial_connection_replays_whole_buffer_from_zero(self):
        state = {
            "events": [
                {"created": True, "message": {"text": "hi"}},
                {"type": "text", "text": {"value": "Hello"}},
                {"final": True, "responseMessage": {"text": "Hello there"}},
            ],
            "done": True,
            "finalEvent": {"final": True, "responseMessage": {"text": "Hello there"}},
        }
        out = _events(list(chat._replay_running_stream("s1", state, is_resume=False, start_index=0)))
        # All three buffered events are delivered, in order, ending at final.
        self.assertEqual(len(out), 3)
        self.assertTrue(out[0].get("created"))
        self.assertEqual(out[1]["text"]["value"], "Hello")
        self.assertTrue(out[-1].get("final"))

    def test_done_without_final_in_buffer_emits_completed(self):
        state = {"events": [{"type": "text", "text": {"value": "partial"}}], "done": True}
        out = _events(list(chat._replay_running_stream("s2", state, is_resume=False, start_index=0)))
        self.assertEqual(out[0]["text"]["value"], "partial")
        self.assertTrue(out[-1].get("final") and out[-1].get("completed"))

    def test_resume_emits_sync_state_first(self):
        state = {
            "events": [{"type": "text", "text": {"value": "x"}}],
            "done": True,
            "conversationId": "c1",
            "responseMessageId": "r1",
        }
        out = _events(list(chat._replay_running_stream("s3", state, is_resume=True)))
        self.assertTrue(out[0].get("sync"))
        self.assertEqual(out[0]["resumeState"]["conversationId"], "c1")

    def test_producer_can_append_while_consumer_tails(self):
        """The consumer keeps replaying events the producer appends after the
        connection opened (the core decoupling behavior), then stops on done."""
        state = {"events": [{"type": "text", "text": {"value": "a"}}], "done": False}
        gen = chat._replay_running_stream("s4", state, is_resume=False, start_index=0)
        first = next(gen)  # delivers the one buffered event
        self.assertEqual(json.loads(first[6:-2])["text"]["value"], "a")
        # Producer appends more, then finishes.
        state["events"].append({"type": "text", "text": {"value": "ab"}})
        state["events"].append({"final": True})
        state["done"] = True
        rest = _events(list(gen))
        self.assertEqual(rest[0]["text"]["value"], "ab")
        self.assertTrue(rest[-1].get("final"))


class LiveMessageIdTests(unittest.TestCase):
    def test_preserves_optimistic_user_and_response_ids(self):
        self.assertEqual(
            chat._live_message_ids(
                {
                    "messageId": "client-user-id",
                    "responseMessageId": "client-response-id",
                }
            ),
            ("client-user-id", "client-response-id"),
        )

    def test_derives_the_frontend_response_id_from_the_user_id(self):
        self.assertEqual(
            chat._live_message_ids({"messageId": "client-user-id"}),
            ("client-user-id", "client-user-id_"),
        )

    def test_legacy_payload_gets_generated_ids(self):
        user_id, response_id = chat._live_message_ids({})
        self.assertTrue(user_id)
        self.assertEqual(response_id, f"{user_id}_")


class ResumeContentAggregationTests(unittest.TestCase):
    def test_preserves_indexed_text_and_tool_parts(self):
        state = {"events": []}
        chat._record_stream_event(
            state,
            {"type": "text", "index": 0, "text": {"value": "Checking"}},
        )
        chat._record_stream_event(
            state,
            {
                "type": "tool_call",
                "index": 1,
                "tool_call": {"id": "call-1", "name": "weather", "progress": 1},
            },
        )
        chat._record_stream_event(
            state,
            {"type": "text", "index": 2, "text": {"value": "It is sunny."}},
        )

        self.assertEqual(
            [part["type"] for part in state["aggregatedContent"]],
            ["text", "tool_call", "text"],
        )

    def test_tags_primary_text_for_parallel_resume(self):
        state = {"events": [], "primaryAgentId": "primary-agent"}
        chat._record_stream_event(
            state,
            {"type": "text", "index": 0, "text": {"value": "Primary answer"}},
        )

        [part] = state["aggregatedContent"]
        self.assertEqual(part["agentId"], "primary-agent")
        self.assertEqual(part["groupId"], 1)


if __name__ == "__main__":
    unittest.main()
