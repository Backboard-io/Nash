"""Workstream B — forked/duplicated/copied conversations get their prior context.

Fork, duplicate and share-"Add to my chats" all create an EMPTY Backboard
thread plus a Nash-side `forked_messages` display snapshot, so the model has no
memory of the original chat. On the first continuation, chat._seed_forked_thread_if_needed
seeds the thread once with a hidden priming message (send_to_llm=false), recorded
under `seed_message_id` so it is skipped on display (messages.get_messages and
share._assemble_share_messages).
"""

import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from flask import Flask

from api.routes import chat, conversations, share

NULL = "00000000-0000-0000-0000-000000000000"


def _snapshot():
    return [
        {"messageId": "s1", "parentMessageId": NULL, "sender": "User",
         "isCreatedByUser": True, "text": "What's the capital of France?"},
        {"messageId": "s2", "parentMessageId": "s1", "sender": "Nash",
         "isCreatedByUser": False, "text": "Paris."},
    ]


class _FakeMsg:
    def __init__(self, mid, role, content):
        self.message_id = mid
        self.role = role
        self.content = content
        self.created_at = None


class _Role:
    def __init__(self, value):
        self.value = value


class BuildPrimingTextTests(unittest.TestCase):
    def test_renders_user_and_assistant_turns(self):
        text = chat._build_priming_text(_snapshot())
        self.assertIn("User: What's the capital of France?", text)
        self.assertIn("Assistant: Paris.", text)
        self.assertIn("earlier conversation", text.lower())

    def test_empty_snapshot_yields_empty(self):
        self.assertEqual(chat._build_priming_text([]), "")

    def test_truncates_oldest_when_over_budget(self):
        big = [
            {"messageId": f"m{i}", "isCreatedByUser": i % 2 == 0, "text": "x" * 5000}
            for i in range(10)
        ]
        text = chat._build_priming_text(big)
        self.assertIn("[earlier messages omitted]", text)
        # Body stays within budget (+ a little for prefix/omission note).
        self.assertLessEqual(len(text), chat._MAX_SEED_CHARS + 600)


class SeedForkedThreadTests(unittest.TestCase):
    def _bb_with_seed_id(self, seed_id="seed-1"):
        bb = MagicMock()
        resp = MagicMock()
        resp.messages = [{"id": seed_id, "role": "user"}]
        bb.add_message = AsyncMock(return_value=resp)
        return bb

    def test_seeds_once_and_records_id(self):
        bb = self._bb_with_seed_id("seed-1")
        saved = MagicMock()
        with patch("api.routes.chat.get_conversation_meta",
                   return_value={"forked_messages": _snapshot()}), \
             patch("api.routes.chat.save_conversation_meta", saved):
            chat._seed_forked_thread_if_needed("u1", "c1", "thread-1", bb)

        bb.add_message.assert_awaited_once()
        kwargs = bb.add_message.await_args.kwargs
        self.assertEqual(kwargs.get("send_to_llm"), "false")
        self.assertEqual(kwargs.get("thread_id"), "thread-1")
        self.assertIn("Paris.", kwargs.get("content", ""))

        saved.assert_called_once()
        meta = saved.call_args.args[2]
        self.assertTrue(meta["seeded"])
        self.assertEqual(meta["seed_message_id"], "seed-1")

    def test_falls_back_to_thread_fetch_for_id(self):
        bb = MagicMock()
        resp = MagicMock()
        resp.messages = []  # response didn't surface an id
        bb.add_message = AsyncMock(return_value=resp)
        saved = MagicMock()
        with patch("api.routes.chat.get_conversation_meta",
                   return_value={"forked_messages": _snapshot()}), \
             patch("api.routes.chat.get_thread_messages",
                   AsyncMock(return_value=[_FakeMsg("seed-fetched", "user", "ctx")])), \
             patch("api.routes.chat.save_conversation_meta", saved):
            chat._seed_forked_thread_if_needed("u1", "c1", "thread-1", bb)
        self.assertEqual(saved.call_args.args[2]["seed_message_id"], "seed-fetched")

    def test_noop_when_already_seeded(self):
        bb = MagicMock()
        bb.add_message = AsyncMock()
        with patch("api.routes.chat.get_conversation_meta",
                   return_value={"forked_messages": _snapshot(), "seeded": True}), \
             patch("api.routes.chat.save_conversation_meta") as saved:
            chat._seed_forked_thread_if_needed("u1", "c1", "thread-1", bb)
        bb.add_message.assert_not_awaited()
        saved.assert_not_called()

    def test_noop_when_no_snapshot(self):
        bb = MagicMock()
        bb.add_message = AsyncMock()
        with patch("api.routes.chat.get_conversation_meta", return_value={}), \
             patch("api.routes.chat.save_conversation_meta") as saved:
            chat._seed_forked_thread_if_needed("u1", "c1", "thread-1", bb)
        bb.add_message.assert_not_awaited()
        saved.assert_not_called()

    def test_seed_failure_leaves_unseeded_for_retry(self):
        bb = MagicMock()
        bb.add_message = AsyncMock(side_effect=RuntimeError("backboard down"))
        with patch("api.routes.chat.get_conversation_meta",
                   return_value={"forked_messages": _snapshot()}), \
             patch("api.routes.chat.save_conversation_meta") as saved:
            chat._seed_forked_thread_if_needed("u1", "c1", "thread-1", bb)
        # Not flagged seeded → next turn retries.
        saved.assert_not_called()


class ShareAssemblySeedSkipTests(unittest.TestCase):
    def test_seed_is_filtered_from_share_view(self):
        bb = [
            _FakeMsg("seed-1", "user", "hidden context note"),
            _FakeMsg("m1", "user", "real question"),
            _FakeMsg("m2", "assistant", "real answer"),
        ]
        with patch("api.routes.share.get_thread_id_for_conversation", return_value="t1"), \
             patch("api.routes.share._owner_share_client", return_value=object()), \
             patch("api.routes.share.get_thread_messages", AsyncMock(return_value=bb)), \
             patch("api.routes.share.get_conversation_meta",
                   return_value={"seed_message_id": "seed-1"}), \
             patch("api.routes.share.get_fallback_notice_map", return_value={}), \
             patch("api.routes.share.get_added_response_map", return_value={}), \
             patch("api.routes.share.get_display_text_map", return_value={}), \
             patch("api.routes.share.get_display_file_map", return_value={}), \
             patch("api.routes.share.get_message_files_map", return_value={}), \
             patch("api.routes.share.get_conversation_forked_messages", return_value=None), \
             patch("api.routes.share.get_regen_graph", return_value={}):
            out = share._assemble_share_messages({"userId": "owner"}, "c1", "owner")
        ids = [m["messageId"] for m in out]
        self.assertNotIn("seed-1", ids)
        self.assertEqual(ids, ["m1", "m2"])


class ForkOfForkSnapshotTests(unittest.TestCase):
    def test_source_display_messages_include_fork_snapshot_and_skip_seed(self):
        bb = object()
        thread_messages = [
            _FakeMsg("seed-1", "user", "hidden context note"),
            _FakeMsg("m3", "user", "continue from here"),
            _FakeMsg("m4", "assistant", "continued answer"),
        ]
        meta = {"forked_messages": _snapshot(), "seed_message_id": "seed-1"}

        with patch(
            "api.routes.conversations.get_thread_messages",
            AsyncMock(return_value=thread_messages),
        ):
            source = conversations._get_source_display_messages(
                "fork-1", "thread-1", bb, meta
            )

        self.assertEqual([m["messageId"] for m in source], ["s1", "s2", "m3", "m4"])

        second_snapshot = conversations._build_message_snapshot(source, "fork-2")
        self.assertEqual([m["conversationId"] for m in second_snapshot], ["fork-2"] * 4)
        self.assertEqual(
            [m["parentMessageId"] for m in second_snapshot],
            [NULL, "s1", "s2", "m3"],
        )

    def test_source_display_messages_falls_back_to_backboard_thread(self):
        bb = object()
        thread_messages = [
            _FakeMsg("m1", "user", "hello"),
            _FakeMsg("m2", "assistant", "hi"),
        ]

        with patch(
            "api.routes.conversations.get_thread_messages",
            AsyncMock(return_value=thread_messages),
        ):
            source = conversations._get_source_display_messages(
                "c1", "thread-1", bb, {}
            )

        snapshot = conversations._build_message_snapshot(source, "fork-1")
        self.assertEqual([m["messageId"] for m in snapshot], ["m1", "m2"])
        self.assertEqual([m["parentMessageId"] for m in snapshot], [NULL, "m1"])

    def test_source_display_messages_hides_enum_tool_rows_and_empty_stubs(self):
        bb = object()
        thread_messages = [
            _FakeMsg("m1", _Role("user"), "hello"),
            _FakeMsg("t1", _Role("tool"), "internal tool output"),
            _FakeMsg("a0", _Role("assistant"), ""),
            _FakeMsg("m2", _Role("assistant"), "hi"),
        ]

        with patch(
            "api.routes.conversations.get_thread_messages",
            AsyncMock(return_value=thread_messages),
        ):
            source = conversations._get_source_display_messages(
                "c1", "thread-1", bb, {}
            )

        self.assertEqual([message["messageId"] for message in source], ["m1", "m2"])
        self.assertTrue(source[0]["isCreatedByUser"])
        self.assertEqual(source[0]["sender"], "User")

    def test_fork_route_copies_existing_fork_snapshot_when_thread_is_empty(self):
        app = Flask(__name__)
        saved = MagicMock()

        with app.test_request_context(
            "/api/convos/fork",
            method="POST",
            json={"conversationId": "fork-1", "messageId": "s2"},
        ), patch("api.routes.conversations.get_request_state_partition", return_value="u1"), \
            patch("api.routes.conversations.get_request_assistant_id", return_value="assistant-1"), \
            patch("api.routes.conversations._user_bb_client", return_value=object()), \
            patch("api.routes.conversations.get_thread_id_for_conversation", return_value="thread-1"), \
            patch("api.routes.conversations.get_conversation_meta",
                  return_value={"title": "Fork: Original", "forked_messages": _snapshot()}), \
            patch("api.routes.conversations.get_thread_messages", AsyncMock(return_value=[])), \
            patch("api.routes.conversations.get_display_text_map", return_value={}), \
            patch("api.routes.conversations.get_display_file_map", return_value={}), \
            patch("api.routes.conversations.get_or_create_thread"), \
            patch("api.routes.conversations.get_added_response_map", return_value={}), \
            patch("api.services.conversation_service.get_message_files_map", return_value={}), \
            patch("api.routes.conversations.save_conversation_meta", saved):
            response = conversations.fork_conversation.__wrapped__()

        self.assertEqual(response.status_code, 200)
        body = response.get_json()
        self.assertEqual([m["messageId"] for m in body["messages"]], ["s1", "s2"])
        self.assertTrue(body["conversation"]["conversationId"])
        saved_meta = saved.call_args.args[2]
        self.assertEqual([m["messageId"] for m in saved_meta["forked_messages"]], ["s1", "s2"])


if __name__ == "__main__":
    unittest.main()
