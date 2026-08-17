"""POST /api/share/<id>/continue — "Add to my chats".

A public share is published by its OWNER but copied by a (logged-in) VIEWER who
is usually a different user/org. The endpoint must:
  * read the shared thread with the OWNER's credentials (via _assemble_share_messages),
  * write a BRAND-NEW conversation owned by the VIEWER — their state partition,
    their assistant, their key — never the owner's,
  * store the history as a Nash-side forked_messages snapshot, re-keyed to the
    new conversation id with a fresh linear parent chain,
  * gate on share existence + isPublic.

This guards the cross-org copy path (the removed predecessor read with the
viewer's client, which silently failed whenever viewer != owner).
"""

import time
import unittest
from unittest.mock import MagicMock, patch

from api.services import encryption_service

NULL = "00000000-0000-0000-0000-000000000000"
VIEWER_CLIENT = object()  # sentinel: client built from the VIEWER's key
VIEWER_PARTITION = "viewer-1"
VIEWER_ASSISTANT = "viewer-asst"


def _share(is_public=True):
    return {
        "shareId": "share-1",
        "conversationId": "conv-1",
        "userId": "owner-1",
        "statePartition": "owner-1#ORG#42",  # owner is in an org
        "title": "Shared Chat",
        "isPublic": is_public,
        "createdAt": "2026-06-22T00:00:00+00:00",
        "updatedAt": "2026-06-22T00:00:00+00:00",
    }


def _assembled():
    """What _assemble_share_messages returns — keyed to the SOURCE convo."""
    return [
        {"messageId": "a1", "conversationId": "conv-1", "parentMessageId": NULL,
         "text": "owner question", "sender": "User", "isCreatedByUser": True,
         "endpoint": "agents", "error": False},
        {"messageId": "a2", "conversationId": "conv-1", "parentMessageId": "a1",
         "text": "owner answer", "sender": "Nash", "isCreatedByUser": False,
         "endpoint": "agents", "error": False},
    ]


def _session_row():
    return {
        "session_key": "nash_sk_viewer",
        "encrypted_key": encryption_service.encrypt_key("viewer-bb-key"),
        "provider": "backboard",
        "chat_assistant_id": "asst-session",
        "user_id": VIEWER_PARTITION,
        "context_id": "",
        "created_at": "",
        "last_used_at": int(time.time()),
        "ttl": int(time.time()) + 3600,
    }


class ContinueShareTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from api.app import create_app

        cls.app = create_app()
        cls.app.config["TESTING"] = True

    def setUp(self):
        self.client = self.app.test_client()
        # Valid session so @require_auth passes.
        self.sessions = {"nash_sk_viewer": _session_row()}
        for p in (
            patch("api.services.dynamo_service.get_session", side_effect=self.sessions.get),
            patch("api.services.dynamo_service.touch_session", lambda *a, **k: None),
        ):
            p.start()
            self.addCleanup(p.stop)

    def _post(self, *, share, assembled):
        self.save_meta = MagicMock()
        self.get_or_create = MagicMock(return_value=("thread-new", "ignored", True))
        with patch("api.routes.share.state_service.shared_links.get", return_value=share), \
             patch("api.routes.share._assemble_share_messages", return_value=assembled), \
             patch("api.routes.share.get_request_state_partition", return_value=VIEWER_PARTITION), \
             patch("api.routes.share.get_request_assistant_id", return_value=VIEWER_ASSISTANT), \
             patch("api.routes.share.get_request_client", return_value=VIEWER_CLIENT), \
             patch("api.routes.share.get_or_create_thread", self.get_or_create), \
             patch("api.routes.share.save_conversation_meta", self.save_meta):
            return self.client.post(
                "/api/share/share-1/continue", headers={"X-Session-Key": "nash_sk_viewer"}
            )

    def test_copies_under_viewer_and_rekeys(self):
        resp = self._post(share=_share(), assembled=_assembled())
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()

        new_id = body["conversation"]["conversationId"]
        self.assertTrue(new_id and new_id != "conv-1")

        # Messages re-keyed to the new convo with a fresh linear parent chain.
        msgs = body["messages"]
        self.assertEqual([m["messageId"] for m in msgs], ["a1", "a2"])
        self.assertTrue(all(m["conversationId"] == new_id for m in msgs))
        self.assertEqual(msgs[0]["parentMessageId"], NULL)
        self.assertEqual(msgs[1]["parentMessageId"], "a1")

        # The new thread is created under the VIEWER's partition + assistant + key.
        self.get_or_create.assert_called_once()
        args = self.get_or_create.call_args.args
        self.assertEqual(args[0], VIEWER_PARTITION)
        self.assertEqual(args[1], VIEWER_ASSISTANT)
        self.assertIs(args[3], VIEWER_CLIENT)

        # Persisted under the VIEWER's partition, snapshot + provenance recorded.
        self.save_meta.assert_called_once()
        sp_args = self.save_meta.call_args.args
        self.assertEqual(sp_args[0], VIEWER_PARTITION)
        self.assertEqual(sp_args[1], new_id)
        meta = sp_args[2]
        self.assertEqual(meta["forked_from"], "conv-1")
        self.assertEqual(meta["forked_messages"], msgs)

    def test_rejects_private_share(self):
        resp = self._post(share=_share(is_public=False), assembled=_assembled())
        self.assertEqual(resp.status_code, 404)
        self.save_meta.assert_not_called()

    def test_404_when_source_has_no_messages(self):
        resp = self._post(share=_share(), assembled=[])
        self.assertEqual(resp.status_code, 404)
        self.save_meta.assert_not_called()

    def test_requires_auth(self):
        # No session header → @require_auth blocks before any work.
        with patch("api.routes.share.state_service.shared_links.get", return_value=_share()):
            resp = self.client.post("/api/share/share-1/continue")
        self.assertIn(resp.status_code, (401, 403))


if __name__ == "__main__":
    unittest.main()
