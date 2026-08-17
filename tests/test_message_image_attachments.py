import json
import unittest
from decimal import Decimal
from unittest.mock import AsyncMock, patch

from flask import Flask

from api.routes import chat, messages
from api.services import conversation_service


class _FakeMessage:
    def __init__(self, message_id, role, content):
        self.message_id = message_id
        self.role = role
        self.content = content
        self.created_at = None
        self.metadata = {}


class MessageFileDescriptorTests(unittest.TestCase):
    def test_builds_renderable_image_from_stored_upload(self):
        stored = {
            "file_id": "file-1",
            "filename": "court.png",
            "type": "image/png",
            "source": "local",
            "bytes": 123,
        }
        requested = [{"file_id": "file-1", "height": 600, "width": 800}]

        with patch.object(chat.state_service.file_meta, "get", return_value=stored):
            result = chat._message_files_from_request("user-1", "user-dir", requested)

        self.assertEqual(
            result,
            [
                {
                    "file_id": "file-1",
                    "filename": "court.png",
                    "filepath": "/api/files/download/user-dir/file-1",
                    "type": "image/png",
                    "source": "local",
                    "height": 600,
                    "width": 800,
                    "bytes": 123,
                }
            ],
        )

    def test_ignores_unknown_file_id(self):
        with patch.object(chat.state_service.file_meta, "get", return_value=None):
            result = chat._message_files_from_request(
                "user-1",
                "user-dir",
                [{"file_id": "forged", "filepath": "https://example.com/image.png"}],
            )

        self.assertEqual(result, [])

    def test_converts_dynamo_decimals_to_json_numbers(self):
        stored = {
            "file_id": "file-1",
            "filename": "court.png",
            "type": "image/png",
            "source": "local",
            "height": Decimal("600"),
            "width": Decimal("800"),
            "bytes": Decimal("123"),
        }

        with patch.object(chat.state_service.file_meta, "get", return_value=stored):
            result = chat._message_files_from_request(
                "user-1",
                "user-dir",
                [{"file_id": "file-1"}],
            )

        json.dumps(result)
        self.assertEqual(result[0]["height"], 600)
        self.assertEqual(result[0]["width"], 800)
        self.assertEqual(result[0]["bytes"], 123)


class ReloadedMessageFileTests(unittest.TestCase):
    def test_normalizes_raw_upload_path_for_response(self):
        raw_file = {
            "file_id": "file-1",
            "filename": "court.png",
            "filepath": "uploads/user-dir/file-1_court.png",
            "source": "local",
        }

        result = messages._normalize_message_files_for_response([raw_file], "user-dir")

        self.assertEqual(result[0]["filepath"], "/api/files/download/user-dir/file-1")
        self.assertEqual(result[0]["type"], "image/png")

    def test_normalizes_absolute_upload_path_for_response(self):
        raw_file = {
            "filename": "clipboard.png",
            "filepath": (
                "/tmp/nash/uploads/"
                "fixture-user@example.com/"
                "7e68fc44-cfe2-4855-8931-74c5f84469c7_clipboard_1784054067841_image.png"
            ),
            "source": "local",
        }

        result = messages._normalize_message_files_for_response([raw_file], "unused-dir")

        self.assertEqual(
            result[0]["filepath"],
            "/api/files/download/fixture-user@example.com/"
            "7e68fc44-cfe2-4855-8931-74c5f84469c7",
        )

    def test_preserves_existing_download_path_for_response(self):
        image = {
            "file_id": "file-1",
            "filename": "court.png",
            "filepath": "/api/files/download/upload-dir/file-1",
            "type": "image/png",
            "source": "local",
        }

        result = messages._normalize_message_files_for_response([image], "current-dir")

        self.assertEqual(result[0]["filepath"], "/api/files/download/upload-dir/file-1")

    def test_get_messages_attaches_persisted_image(self):
        app = Flask(__name__)
        image = {
            "file_id": "file-1",
            "filename": "court.png",
            "filepath": "/api/files/download/user-dir/file-1",
            "type": "image/png",
        }
        bb_messages = [
            _FakeMessage("user-message-1", "user", "Review this image"),
            _FakeMessage("assistant-message-1", "assistant", "Done"),
        ]

        with app.test_request_context("/api/messages/conversation-1"), \
             patch.object(messages, "get_request_state_partition", return_value="user-1"), \
             patch.object(messages, "_user_bb_client", return_value=object()), \
             patch.object(messages, "get_thread_id_for_conversation", return_value="thread-1"), \
             patch.object(messages, "get_thread_messages", AsyncMock(return_value=bb_messages)), \
             patch.object(messages, "get_conversation_meta", return_value={}), \
             patch.object(messages, "get_fallback_notice_map", return_value={}), \
             patch.object(messages, "get_generated_media_map", return_value={}), \
             patch.object(messages, "get_display_text_map", return_value={}), \
             patch.object(messages, "get_display_file_map", return_value={}), \
             patch.object(messages, "get_message_files_map", return_value={"user-message-1": [image]}), \
             patch.object(messages, "get_added_response_map", return_value={}), \
             patch.object(messages, "get_conversation_forked_messages", return_value=None), \
             patch.object(messages, "get_regen_graph", return_value={}):
            response = messages.get_messages.__wrapped__("conversation-1")

        payload = response.get_json()
        self.assertEqual(payload[0]["files"], [image])
        self.assertNotIn("files", payload[1])


class GeneratedMediaReloadTests(unittest.TestCase):
    def test_inject_appends_markdown_for_persisted_generated_image(self):
        text = messages._inject_generated_images(
            "Here you go!", ["doc-abc"], "user-1"
        )
        self.assertIn("Here you go!", text)
        self.assertIn(
            "![Generated image](/api/files/download/user-1/generated_doc-abc)", text
        )

    def test_inject_skips_image_already_present(self):
        base = "![Generated image](/api/files/download/user-1/generated_doc-abc)"
        text = messages._inject_generated_images(base, ["doc-abc"], "user-1")
        # No duplicate marker for the same document.
        self.assertEqual(text.count("generated_doc-abc"), 1)

    def test_save_merges_generated_media_per_message(self):
        existing = {"media": {"msg-1": ["doc-1"]}}
        with patch.object(
            conversation_service.state_service.generated_media,
            "get",
            return_value=existing,
        ), patch.object(
            conversation_service.state_service.generated_media, "put"
        ) as put:
            conversation_service.save_generated_media(
                "user-1", "conversation-1", {"msg-1": ["doc-2"], "msg-2": ["doc-3"]}
            )
        saved = put.call_args.args[2]["media"]
        self.assertEqual(saved["msg-1"], ["doc-1", "doc-2"])
        self.assertEqual(saved["msg-2"], ["doc-3"])


class MessageFilePersistenceTests(unittest.TestCase):
    def test_save_merges_files_for_multiple_messages(self):
        existing = {
            "files": {"message-1": [{"file_id": "file-1"}]},
        }
        with patch.object(
            conversation_service.state_service.message_files, "get", return_value=existing
        ), patch.object(conversation_service.state_service.message_files, "put") as put:
            conversation_service.save_message_files(
                "user-1", "conversation-1", "message-2", [{"file_id": "file-2"}]
            )

        saved = put.call_args.args[2]["files"]
        self.assertEqual(saved["message-1"], [{"file_id": "file-1"}])
        self.assertEqual(saved["message-2"], [{"file_id": "file-2"}])


if __name__ == "__main__":
    unittest.main()
