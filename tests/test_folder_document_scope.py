"""Smoke/e2e coverage for folder-scoped document uploads.

The contract under test (api.routes.chat._process_pending_files):

  - In a folder chat (``folder_assistant_id`` set) an attached document is
    uploaded to the folder's Backboard *assistant* so every thread in that
    folder can reference it.
  - In a main chat or agent chat (no ``folder_assistant_id``) the upload stays
    scoped to the originating *thread* — unchanged behaviour.
  - Either way, once indexed, the file_meta row is updated with the returned
    document_id and status "indexed".

These drive the real async function with a fake Backboard client; only DynamoDB
state access is stubbed.
"""

from __future__ import annotations

import asyncio
import os
import queue
import tempfile
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from backboard import DocumentStatus

from api.routes import chat


def _doc(document_id: str = "doc-123") -> MagicMock:
    d = MagicMock()
    d.document_id = document_id
    return d


def _indexed_status() -> MagicMock:
    s = MagicMock()
    s.status = DocumentStatus.INDEXED  # code reads .status.value
    return s


class FolderDocumentScopeTests(unittest.TestCase):
    def setUp(self):
        # _process_pending_files skips files whose path doesn't exist, so the
        # attachment must be a real file on disk.
        tmp = tempfile.NamedTemporaryFile(suffix=".txt", delete=False)
        tmp.write(b"hello world")
        tmp.close()
        self.path = tmp.name
        self.addCleanup(lambda: os.path.exists(self.path) and os.unlink(self.path))

        self.file_id = "file-1"
        self.user_id = "user-1"
        self.pending_file = {
            "file_id": self.file_id,
            "filename": "report.txt",
            "filepath": self.path,
            "status": "pending",
        }

    def _client(self) -> MagicMock:
        client = MagicMock()
        client.upload_document_to_assistant = AsyncMock(return_value=_doc())
        client.upload_document_to_thread = AsyncMock(return_value=_doc())
        client.get_document_status = AsyncMock(return_value=_indexed_status())
        return client

    def _run(self, *, folder_assistant_id: str):
        client = self._client()
        put_calls: list[tuple] = []
        fake_state = MagicMock()
        fake_state.file_meta.list_for_user.return_value = [dict(self.pending_file)]
        fake_state.file_meta.put.side_effect = (
            lambda uid, fid, row: put_calls.append((uid, fid, row))
        )

        with patch.object(chat, "state_service", fake_state):
            asyncio.run(
                chat._process_pending_files(
                    user_id=self.user_id,
                    target_file_ids={self.file_id},
                    events_queue=queue.Queue(),
                    response_message_id="resp-1",
                    conversation_id="conv-1",
                    user_message_id="um-1",
                    chat_assistant_id="main-asst",
                    thread_id="thread-1",
                    folder_assistant_id=folder_assistant_id,
                    bb_client=client,
                )
            )
        return client, put_calls

    def test_folder_chat_uploads_to_assistant(self):
        client, put_calls = self._run(folder_assistant_id="folder-asst-1")

        client.upload_document_to_assistant.assert_awaited_once()
        kwargs = client.upload_document_to_assistant.await_args.kwargs
        self.assertEqual(kwargs["assistant_id"], "folder-asst-1")
        self.assertEqual(kwargs["file_path"], self.path)

        # Main-chat path must NOT be used for a folder chat.
        client.upload_document_to_thread.assert_not_awaited()

        self.assertTrue(put_calls, "file_meta.put should record the indexed doc")
        _, _, row = put_calls[-1]
        self.assertEqual(row["status"], "indexed")
        self.assertEqual(row["document_id"], "doc-123")

    def test_main_chat_uploads_to_thread(self):
        client, put_calls = self._run(folder_assistant_id="")

        client.upload_document_to_thread.assert_awaited_once()
        kwargs = client.upload_document_to_thread.await_args.kwargs
        self.assertEqual(kwargs["thread_id"], "thread-1")

        # Folder/assistant path must NOT be used for a main chat.
        client.upload_document_to_assistant.assert_not_awaited()

        self.assertTrue(put_calls)
        _, _, row = put_calls[-1]
        self.assertEqual(row["status"], "indexed")
        self.assertEqual(row["document_id"], "doc-123")


if __name__ == "__main__":
    unittest.main()
