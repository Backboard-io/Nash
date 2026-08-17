"""Public share view must resolve messages with the OWNER's credentials.

Regression guard for the "Shared link not found" bug: GET /api/share/<id> is
unauthenticated, so a logged-out visitor has no Backboard client. The endpoint
must read the owner's thread with the owner's context key (the credential the
thread was created under) rather than the requester's, otherwise messages come
back empty and the client renders "Shared link not found" even though the share
row exists and is public.

It must also mirror GET /api/messages/<id> (api/routes/messages.py): forked /
continued shares keep their history in a Nash-side snapshot with an EMPTY
Backboard thread, and the regen graph drops superseded turns + repoints parents.
If the public view skips either, it diverges from what the owner sees.
"""

import unittest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch


NULL = "00000000-0000-0000-0000-000000000000"
OWNER_CLIENT = object()  # sentinel: the client built from the owner's key


class _FakeMsg:
    def __init__(self, mid, role, content):
        self.message_id = mid
        self.role = role
        self.content = content
        self.created_at = datetime(2026, 6, 22, tzinfo=timezone.utc)


class _Role:
    def __init__(self, value):
        self.value = value


def _share(state_partition="owner-1"):
    return {
        "shareId": "share-1",
        "conversationId": "conv-1",
        "userId": "owner-1",
        "statePartition": state_partition,
        "title": "Shared Chat",
        "isPublic": True,
        "createdAt": "2026-06-22T00:00:00+00:00",
        "updatedAt": "2026-06-22T00:00:00+00:00",
    }


class PublicShareMessagesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from api.app import create_app

        cls.app = create_app()
        cls.app.config["TESTING"] = True

    def setUp(self):
        self.client = self.app.test_client()

    def _get_share(self, *, share, bb_messages, forked=None, regen=None):
        """Drive GET /api/share/share-1 as a logged-out viewer with every
        owner-side read mocked. Returns (response, get_msgs, get_user_client,
        get_context_api_key) so callers can assert on the credential wiring."""
        get_msgs = AsyncMock(return_value=bb_messages)
        get_user_client = MagicMock(return_value=OWNER_CLIENT)
        get_context_api_key = MagicMock(return_value="owner-context-key")
        with patch("api.routes.share.state_service.shared_links.get", return_value=share), \
             patch("api.routes.share.get_thread_id_for_conversation", return_value="thread-1"), \
             patch("api.routes.share.find_user_by_id", return_value={"userId": "owner-1"}), \
             patch("api.routes.share.get_context_api_key", get_context_api_key), \
             patch("api.routes.share.get_user_client", get_user_client), \
             patch("api.routes.share.get_thread_messages", get_msgs), \
             patch("api.routes.share.get_conversation_meta", return_value={}), \
             patch("api.routes.share.get_fallback_notice_map", return_value={}), \
             patch("api.routes.share.get_added_response_map", return_value={}), \
             patch("api.routes.share.get_display_text_map", return_value={}), \
             patch("api.routes.share.get_display_file_map", return_value={}), \
             patch("api.routes.share.get_message_files_map", return_value={}), \
             patch("api.routes.share.get_conversation_forked_messages", return_value=forked), \
             patch("api.routes.share.get_regen_graph", return_value=regen or {}):
            # No session cookie/header — a logged-out public viewer.
            resp = self.client.get("/api/share/share-1")
        return resp, get_msgs, get_user_client, get_context_api_key

    def _assert_owner_read(self, *, state_partition, expect_context_id):
        bb = [_FakeMsg("m1", "user", "hi"), _FakeMsg("m2", "assistant", "hello")]
        resp, get_msgs, get_user_client, get_context_api_key = self._get_share(
            share=_share(state_partition), bb_messages=bb,
        )
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()
        # The owner's context key was resolved for the right context...
        get_context_api_key.assert_called_once()
        self.assertEqual(get_context_api_key.call_args.args[1], expect_context_id)
        get_user_client.assert_called_once_with("owner-context-key")
        # ...and the thread was read with the OWNER's client, not the requester's.
        self.assertIs(get_msgs.await_args.args[1], OWNER_CLIENT)
        # Messages actually come back, so the client won't show "not found".
        self.assertEqual(len(body["messages"]), 2)
        self.assertEqual(body["messages"][0]["text"], "hi")

    def test_personal_share_logged_out_returns_messages(self):
        # Personal/legacy partition == userId → "personal" context.
        self._assert_owner_read(state_partition="owner-1", expect_context_id="personal")

    def test_org_share_logged_out_resolves_org_context(self):
        # Org partition "{user}#ORG#{client}" → "org:{client}" context.
        self._assert_owner_read(state_partition="owner-1#ORG#42", expect_context_id="org:42")

    def test_forked_share_returns_snapshot_when_thread_empty(self):
        # Continued/forked shares carry an EMPTY Backboard thread; their history
        # lives in the Nash snapshot. Without snapshot support the viewer sees 0
        # messages → "Shared link not found" even though the share is valid.
        snapshot = [
            {"messageId": "s1", "conversationId": "conv-1", "parentMessageId": NULL,
             "text": "snap question", "sender": "User", "isCreatedByUser": True,
             "endpoint": "agents", "error": False},
            {"messageId": "s2", "conversationId": "conv-1", "parentMessageId": "s1",
             "text": "snap answer", "sender": "Nash", "isCreatedByUser": False,
             "endpoint": "agents", "error": False},
        ]
        resp, _, _, _ = self._get_share(share=_share(), bb_messages=[], forked=snapshot)
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()
        self.assertEqual(
            [m["text"] for m in body["messages"]], ["snap question", "snap answer"],
        )

    def test_forked_share_appends_new_thread_turns_after_snapshot(self):
        # After "Continue", new turns land in the (previously empty) thread and
        # must follow the snapshot, chained to its last message.
        snapshot = [
            {"messageId": "s1", "conversationId": "conv-1", "parentMessageId": NULL,
             "text": "snap q", "sender": "User", "isCreatedByUser": True,
             "endpoint": "agents", "error": False},
        ]
        bb = [_FakeMsg("m9", "assistant", "new answer")]
        resp, _, _, _ = self._get_share(share=_share(), bb_messages=bb, forked=snapshot)
        body = resp.get_json()
        self.assertEqual([m["messageId"] for m in body["messages"]], ["s1", "m9"])
        self.assertEqual(body["messages"][1]["parentMessageId"], "s1")

    def test_regen_graph_skips_superseded_turns(self):
        # A regenerated response marks the superseded turn SKIP; the shared view
        # must drop it, exactly like the owner's own /api/messages view.
        bb = [
            _FakeMsg("m1", "user", "q"),
            _FakeMsg("m2", "assistant", "old answer"),
            _FakeMsg("m3", "assistant", "new answer"),
        ]
        resp, _, _, _ = self._get_share(
            share=_share(), bb_messages=bb, regen={"m2": "SKIP"},
        )
        body = resp.get_json()
        ids = [m["messageId"] for m in body["messages"]]
        self.assertNotIn("m2", ids)
        self.assertEqual(ids, ["m1", "m3"])

    def test_regen_graph_applies_parent_override(self):
        # Regenerated answers hang off the original user turn, not the linear
        # predecessor — the override must win over the default linear chain.
        bb = [
            _FakeMsg("m1", "user", "q"),
            _FakeMsg("m2", "assistant", "a1"),
            _FakeMsg("m3", "assistant", "a2"),
        ]
        resp, _, _, _ = self._get_share(
            share=_share(), bb_messages=bb, regen={"m3": "m1"},
        )
        body = resp.get_json()
        m3 = next(m for m in body["messages"] if m["messageId"] == "m3")
        # Linear chain would make m3's parent m2; the override repoints it to m1.
        self.assertEqual(m3["parentMessageId"], "m1")

    def test_share_hides_enum_tool_rows_and_empty_assistant_stubs(self):
        bb = [
            _FakeMsg("m1", _Role("user"), "question"),
            _FakeMsg("t1", _Role("tool"), "internal tool output"),
            _FakeMsg("a0", _Role("assistant"), ""),
            _FakeMsg("m2", _Role("assistant"), "answer"),
        ]

        resp, _, _, _ = self._get_share(share=_share(), bb_messages=bb)

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(
            [message["messageId"] for message in resp.get_json()["messages"]],
            ["m1", "m2"],
        )
        self.assertTrue(resp.get_json()["messages"][0]["isCreatedByUser"])
        self.assertEqual(resp.get_json()["messages"][0]["sender"], "User")


if __name__ == "__main__":
    unittest.main()
