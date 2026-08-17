"""A refresh mid image-generation must not lose the in-progress state: the
resume snapshot has to carry the images already produced AND the fact that this
turn is an image generation (so the loading placeholder shows before the first
image lands). A ?resume=true reconnect only tails NEW events, so this snapshot is
the only channel for that state."""

import unittest

from api.routes import chat


class RecordImageEventTests(unittest.TestCase):
    def test_image_events_accumulate_into_generated_media(self):
        state: dict = {}
        img1 = {"documentId": "d1", "mimeType": "image/png", "url": "/api/files/download/x/d1"}
        img2 = {"documentId": "d2", "mimeType": "image/png", "url": "/api/files/download/x/d2"}
        chat._record_stream_event(state, {"type": "image", "image": img1})
        chat._record_stream_event(state, {"type": "image", "image": img2})
        self.assertEqual(state["generatedMedia"], [img1, img2])

    def test_image_event_without_payload_is_ignored(self):
        state: dict = {}
        chat._record_stream_event(state, {"type": "image"})
        self.assertNotIn("generatedMedia", state)

    def test_text_events_do_not_create_generated_media(self):
        state: dict = {}
        chat._record_stream_event(state, {"type": "text", "text": {"value": "hi"}})
        self.assertNotIn("generatedMedia", state)


class ResumeStateTests(unittest.TestCase):
    def test_snapshot_carries_generated_media_and_image_flag(self):
        img = {"documentId": "d1", "mimeType": "image/png", "url": "/api/files/download/x/d1"}
        state = {
            "conversationId": "c1",
            "imageGeneration": True,
            "generatedMedia": [img],
            "userMessage": {"messageId": "u1", "text": "make me a cat", "files": [{"file_id": "f1"}]},
            "responseMessageId": "r1",
        }
        snap = chat._stream_resume_state(state)
        self.assertEqual(snap["generatedMedia"], [img])
        self.assertTrue(snap["imageGeneration"])
        # The user's attached file rides along on the user message so a resume
        # keeps it visible.
        self.assertEqual(snap["userMessage"]["files"], [{"file_id": "f1"}])

    def test_defaults_when_not_an_image_turn(self):
        snap = chat._stream_resume_state({"conversationId": "c1"})
        self.assertEqual(snap["generatedMedia"], [])
        self.assertFalse(snap["imageGeneration"])


if __name__ == "__main__":
    unittest.main()
