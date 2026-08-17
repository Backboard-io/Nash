"""Temporary-chat ephemerality: no DynamoDB writes for temp conversations.

Covers the service-layer contract (get_or_create_thread with persist=False
never touches the thread-map store and derives thread ids statelessly) and
the gen_title route staying write-free for unmapped (temporary) conversations.
"""

from __future__ import annotations

import time
import unittest
from unittest.mock import MagicMock, patch

from api.services import conversation_service, encryption_service


class _FakeThread:
    def __init__(self, thread_id: str):
        self.thread_id = thread_id


class _FakeBB:
    def __init__(self, thread_id="th-new-123"):
        self.created_with: list[str] = []
        self._thread_id = thread_id

    async def create_thread(self, owner_assistant_id: str):
        self.created_with.append(owner_assistant_id)
        return _FakeThread(self._thread_id)


class GetOrCreateThreadTemporaryTests(unittest.TestCase):
    def setUp(self):
        conversation_service.clear_thread_cache()
        self.store = MagicMock()
        self.store.list_for_user.return_value = []
        self.tombstones = MagicMock()
        for p in (
            patch("api.services.state_service.thread_map", self.store),
            patch("api.services.state_service.deleted_threads", self.tombstones),
        ):
            p.start()
            self.addCleanup(p.stop)
        self.addCleanup(conversation_service.clear_thread_cache)

    def test_temporary_new_conversation_writes_nothing(self):
        bb = _FakeBB("th-temp-1")
        thread_id, conversation_id, is_new = conversation_service.get_or_create_thread(
            "u1", "asst-1", None, bb, persist=False
        )
        self.assertEqual(thread_id, "th-temp-1")
        self.assertEqual(conversation_id, "th-temp-1")  # convo id IS the thread id
        self.assertTrue(is_new)
        self.store.put.assert_not_called()
        # The one allowed row: an import-exclusion tombstone (no chat content),
        # so the login thread-import can never resurrect the temp thread.
        self.tombstones.put.assert_called_once()
        args = self.tombstones.put.call_args.args
        self.assertEqual(args[0], "u1")
        self.assertEqual(args[1], "th-temp-1")

    def test_temporary_followup_derives_thread_from_conversation_id(self):
        bb = _FakeBB()
        thread_id, conversation_id, is_new = conversation_service.get_or_create_thread(
            "u1", "asst-1", "th-temp-1", bb, persist=False
        )
        self.assertEqual((thread_id, conversation_id, is_new), ("th-temp-1", "th-temp-1", False))
        self.assertEqual(bb.created_with, [])  # no new thread created
        self.store.put.assert_not_called()
        self.store.list_for_user.assert_not_called()  # no dynamo reads either
        self.tombstones.put.assert_not_called()  # tombstone only on thread birth

    def test_persistent_conversation_still_writes_mapping(self):
        bb = _FakeBB("th-real-9")
        thread_id, conversation_id, is_new = conversation_service.get_or_create_thread(
            "u1", "asst-1", None, bb
        )
        self.assertEqual((thread_id, conversation_id, is_new), ("th-real-9", "th-real-9", True))
        self.store.put.assert_called_once()
        self.tombstones.put.assert_not_called()  # normal chats are importable


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


class GenTitleTemporaryTests(unittest.TestCase):
    """gen_title must stay write-free for conversations with no thread mapping
    (which is exactly what temporary conversations look like server-side)."""

    @classmethod
    def setUpClass(cls):
        from api.app import create_app

        cls.app = create_app()
        cls.app.config["TESTING"] = True

    def setUp(self):
        self.client = self.app.test_client()
        self.session = _session_row()
        self.meta_save = MagicMock()
        for p in (
            patch("api.services.dynamo_service.get_session", return_value=self.session),
            patch("api.services.dynamo_service.touch_session", lambda *a, **k: None),
            patch("api.routes.conversations.get_thread_id_for_conversation", return_value=None),
            patch("api.routes.conversations.save_conversation_meta", self.meta_save),
        ):
            p.start()
            self.addCleanup(p.stop)

    def test_unmapped_conversation_returns_placeholder_without_writing(self):
        resp = self.client.get(
            "/api/convos/gen_title/th-temp-1",
            headers={"X-Session-Key": self.session["session_key"]},
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.get_json()["title"], "New Chat")
        self.meta_save.assert_not_called()


if __name__ == "__main__":
    unittest.main()


class TemporaryChatStreamSmokeTests(unittest.TestCase):
    """Drive the real POST /api/agents/chat + GET stream far enough to execute
    _prepare_stream (thread resolution, ctx build) with isTemporary=true, and
    assert the request pipeline neither crashes nor writes conversation rows.

    The Backboard client is fully faked; the model call itself is expected to
    fail fast inside the generator (surfaced as an SSE error event) — the
    assertions target the persistence layer, not the model output.
    """

    @classmethod
    def setUpClass(cls):
        from api.app import create_app

        cls.app = create_app()
        cls.app.config["TESTING"] = True

    def setUp(self):
        from unittest.mock import AsyncMock

        conversation_service.clear_thread_cache()
        self.addCleanup(conversation_service.clear_thread_cache)
        self.client = self.app.test_client()
        self.session = _session_row()

        self.fake_bb = MagicMock()
        self.fake_bb.create_thread = AsyncMock(return_value=_FakeThread("th-smoke-1"))

        self.thread_map = MagicMock()
        self.thread_map.list_for_user.return_value = []
        self.thread_map.get.return_value = None
        self.convo_meta = MagicMock()
        self.convo_meta.get.return_value = None
        self.display_text = MagicMock()
        self.tombstones = MagicMock()

        # Everything else in state_service goes to a fake table that reads
        # empty and records writes — no real boto3, no cred errors.
        self.fake_table = MagicMock()
        self.fake_table.get_item.return_value = {}
        self.fake_table.query.return_value = {"Items": []}

        for p in (
            patch("api.services.state_service._get_table", return_value=self.fake_table),
            patch("api.services.dynamo_service.get_session", return_value=self.session),
            patch("api.services.dynamo_service.touch_session", lambda *a, **k: None),
            patch("api.routes.chat.get_user_client", return_value=self.fake_bb),
            patch("api.routes.chat._strip_legacy_assistant_tools_once", lambda *a, **k: None),
            patch("api.routes.chat._resolve_image_config", return_value=("openai", "dall-e-3")),
            patch("api.services.state_service.thread_map", self.thread_map),
            patch("api.services.state_service.convo_meta", self.convo_meta),
            patch("api.services.state_service.display_text", self.display_text),
            patch("api.services.state_service.deleted_threads", self.tombstones),
        ):
            p.start()
            self.addCleanup(p.stop)

    def _headers(self):
        return {"X-Session-Key": self.session["session_key"]}

    def _run_stream(self, payload):
        start = self.client.post("/api/agents/chat", json=payload, headers=self._headers())
        self.assertEqual(start.status_code, 200)
        stream_id = start.get_json()["streamId"]
        resp = self.client.get(
            f"/api/agents/chat/stream/{stream_id}", headers=self._headers()
        )
        body = resp.get_data(as_text=True)
        return resp, body

    def test_temporary_stream_creates_thread_without_any_conversation_rows(self):
        resp, body = self._run_stream(
            {
                "text": "hello",
                "isTemporary": True,
                "endpoint": "openai",
                "model": "gpt-4.1",
            }
        )
        self.assertEqual(resp.status_code, 200)
        # The ordering bug this guards against surfaced as UnboundLocalError
        # before a single SSE byte was produced.
        self.assertNotIn("UnboundLocalError", body)
        self.assertNotIn("NameError", body)
        # Thread resolution ran (the fake Backboard thread was created)...
        self.fake_bb.create_thread.assert_called_once()
        # ...and nothing conversation-scoped was persisted.
        self.thread_map.put.assert_not_called()
        self.convo_meta.put.assert_not_called()
        self.display_text.put.assert_not_called()
        # Exactly one import-exclusion tombstone for the temp thread.
        self.tombstones.put.assert_called_once()

    def test_normal_stream_persists_thread_mapping(self):
        resp, body = self._run_stream(
            {"text": "hello", "endpoint": "openai", "model": "gpt-4.1"}
        )
        self.assertEqual(resp.status_code, 200)
        self.assertNotIn("UnboundLocalError", body)
        self.fake_bb.create_thread.assert_called_once()
        self.thread_map.put.assert_called_once()
        self.tombstones.put.assert_not_called()
