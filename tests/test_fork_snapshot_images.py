"""Forking/duplicating a chat with images must carry the images into the
snapshot the same way the owner's own view does — attach the message's file
descriptors and rewrite raw Backboard S3 URLs to the stable download path.
Without this, forked chats with images failed to load."""

import unittest
from unittest.mock import patch

from api.routes import conversations as convo


class _Msg:
    def __init__(self, message_id, role, content):
        self.message_id = message_id
        self.role = role
        self.content = content
        self.created_at = None


class BuildMessageSnapshotImageTests(unittest.TestCase):
    def _snapshot(self, messages, files_map, **kwargs):
        with patch.object(convo, "is_user_visible_message", return_value=True), patch(
            "api.services.conversation_service.get_message_files_map",
            return_value=files_map,
        ):
            return convo._build_message_snapshot(messages, "new-convo", **kwargs)

    def test_attaches_uploaded_image_files_to_the_snapshot(self):
        files_map = {
            "u1": [
                {
                    "file_id": "img1",
                    "filepath": "uploads/ownerpart/img1_photo.png",
                    "source": "local",
                    "type": "image/png",
                }
            ]
        }
        msgs = [_Msg("u1", "user", "here is my pic"), _Msg("a1", "assistant", "nice")]
        snap = self._snapshot(
            msgs, files_map, owner_partition="ownerpart", source_conversation_id="src1"
        )

        # The user message that had an image now carries a renderable file whose
        # path points at the authenticated download route (not a raw upload path).
        self.assertTrue(snap[0].get("files"), "expected files on the forked user message")
        self.assertEqual(snap[0]["files"][0]["file_id"], "img1")
        self.assertIn("/api/files/download/", snap[0]["files"][0]["filepath"])
        # A message without files gets no files key.
        self.assertNotIn("files", snap[1])

    def test_backward_compatible_without_owner_partition(self):
        msgs = [_Msg("u1", "user", "plain text only")]
        snap = self._snapshot(msgs, {})  # no owner_partition → no scrub, no files
        self.assertEqual(snap[0]["text"], "plain text only")
        self.assertNotIn("files", snap[0])

    def test_linear_parent_chain_is_preserved(self):
        msgs = [_Msg("u1", "user", "a"), _Msg("a1", "assistant", "b")]
        snap = self._snapshot(msgs, {}, owner_partition="ownerpart", source_conversation_id="src1")
        self.assertEqual(snap[0]["parentMessageId"], "00000000-0000-0000-0000-000000000000")
        self.assertEqual(snap[1]["parentMessageId"], "u1")


if __name__ == "__main__":
    unittest.main()
