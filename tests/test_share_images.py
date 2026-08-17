"""Public share image serving (#4 — 'Couldn't load this image').

A shared conversation is viewed logged-out, so the owner's @require_auth
/api/files/download path 401s. These tests cover the public, share-scoped image
endpoint and the URL rewrite that points shared messages at it — without
touching DynamoDB (share assembly is patched)."""

import os
import shutil
import tempfile
import unittest
from unittest.mock import patch

from api.app import create_app
from api.routes import share as share_module


class ShareImageHelperTests(unittest.TestCase):
    def test_rewrite_points_download_urls_at_public_share_path(self):
        messages = [
            {
                "text": "here ![img](/api/files/download/owner-dir/generated_abc123)",
                "content": [
                    {
                        "type": "text",
                        "text": {
                            "value": "![parallel](/api/files/download/owner-dir/generated_parallel)"
                        },
                    }
                ],
                "files": [
                    {"file_id": "up1", "filepath": "/api/files/download/owner-dir/up1"}
                ],
            }
        ]
        out = share_module._rewrite_share_image_urls(messages, "owner-dir", "share-9")
        self.assertIn("/api/share/share-9/files/generated_abc123", out[0]["text"])
        self.assertEqual(
            out[0]["files"][0]["filepath"], "/api/share/share-9/files/up1"
        )
        # The owner's raw download path must no longer appear.
        self.assertNotIn("/api/files/download/", out[0]["text"])
        self.assertIn(
            "/api/share/share-9/files/generated_parallel",
            out[0]["content"][0]["text"]["value"],
        )

    def test_allowlist_collects_ids_from_text_and_files(self):
        messages = [
            {
                "text": "![a](/api/files/download/owner-dir/generated_aaa)",
                "content": [
                    {
                        "type": "text",
                        "text": {
                            "value": "![b](/api/files/download/owner-dir/generated_bbb)"
                        },
                    }
                ],
                "files": [
                    {"file_id": "up1", "filepath": "/api/files/download/owner-dir/up1"}
                ],
            },
            {"text": "no images here", "files": []},
        ]
        allowed = share_module._share_allowed_file_ids(messages)
        self.assertEqual(allowed, {"generated_aaa", "generated_bbb", "up1"})


class ShareImageEndpointTests(unittest.TestCase):
    def setUp(self):
        app = create_app()
        app.config["TESTING"] = True
        self.client = app.test_client()
        self.share = {
            "shareId": "share-1",
            "conversationId": "convo-1",
            "isPublic": True,
            "userId": "owner-1",
            "statePartition": "owner-1",
        }
        self.messages = [
            {
                "text": "![a](/api/files/download/owner-1/generated_shared)",
                "files": [
                    {
                        "file_id": "attach_shared",
                        "filepath": "/api/files/download/owner-1/attach_shared",
                    }
                ],
            }
        ]

    def _patches(self, share=None, messages=None):
        return (
            patch.object(
                share_module.state_service.shared_links,
                "get",
                return_value=self.share if share is None else share,
            ),
            patch.object(
                share_module,
                "_assemble_share_messages",
                return_value=self.messages if messages is None else messages,
            ),
        )

    def test_serves_file_that_belongs_to_the_share(self):
        p1, p2 = self._patches()
        with p1, p2, patch.object(
            share_module, "_serve_owner_file", return_value=("OK", 200)
        ) as mock_serve:
            resp = self.client.get("/api/share/share-1/files/attach_shared")
        self.assertEqual(resp.status_code, 200)
        # Served from the owner's fs-safe partition dir, not the raw partition.
        dir_key = share_module.fs_safe_partition("owner-1")
        mock_serve.assert_called_once_with(dir_key, "attach_shared")

    def test_rejects_file_not_in_the_share(self):
        """The core guarantee: an arbitrary owner file id is refused."""
        p1, p2 = self._patches()
        with p1, p2, patch.object(share_module, "_serve_owner_file") as mock_serve:
            resp = self.client.get("/api/share/share-1/files/some_other_owner_file")
        self.assertEqual(resp.status_code, 404)
        mock_serve.assert_not_called()

    def test_rejects_private_or_missing_share(self):
        with patch.object(
            share_module.state_service.shared_links, "get", return_value=None
        ), patch.object(share_module, "_serve_owner_file") as mock_serve:
            resp = self.client.get("/api/share/nope/files/attach_shared")
        self.assertEqual(resp.status_code, 404)
        mock_serve.assert_not_called()


class ShareImageDiskServingTests(unittest.TestCase):
    """End-to-end through the endpoint against real files on disk — exercises
    _serve_owner_file (the byte-serving + .partial skip + not-found paths) that
    the mocked tests above don't cover."""

    def setUp(self):
        app = create_app()
        app.config["TESTING"] = True
        self.client = app.test_client()

        self.owner_partition = "ownerpart"
        self.dir_key = share_module.fs_safe_partition(self.owner_partition)

        self.tmp = tempfile.mkdtemp()
        self.owner_dir = os.path.join(self.tmp, self.dir_key)
        os.makedirs(self.owner_dir, exist_ok=True)

        self.share = {
            "shareId": "share-1",
            "conversationId": "convo-1",
            "isPublic": True,
            "userId": self.owner_partition,
            "statePartition": self.owner_partition,
        }

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _write(self, filename, content=b"IMG"):
        with open(os.path.join(self.owner_dir, filename), "wb") as fh:
            fh.write(content)

    def _messages_with(self, file_id):
        return [
            {
                "text": "",
                "files": [
                    {
                        "file_id": file_id,
                        "filepath": f"/api/files/download/{self.dir_key}/{file_id}",
                    }
                ],
            }
        ]

    def _get(self, file_id, messages):
        with patch.object(
            share_module.state_service.shared_links, "get", return_value=self.share
        ), patch.object(
            share_module, "_assemble_share_messages", return_value=messages
        ), patch(
            "api.routes.files.UPLOAD_DIR", self.tmp
        ):
            return self.client.get(f"/api/share/share-1/files/{file_id}")

    def test_serves_the_actual_bytes(self):
        self._write("attach_1_photo.png", b"REALBYTES")
        resp = self._get("attach_1", self._messages_with("attach_1"))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data, b"REALBYTES")

    def test_skips_partial_writes_and_404s(self):
        # Only a half-written async image exists on disk.
        self._write("generated_x.png.partial", b"incomplete")
        with patch("api.routes.chat.wait_for_pending_image", return_value=False):
            resp = self._get("generated_x", self._messages_with("generated_x"))
        self.assertEqual(resp.status_code, 404)

    def test_missing_file_on_disk_404s(self):
        # In the allowlist, but no bytes on disk.
        resp = self._get("attach_gone", self._messages_with("attach_gone"))
        self.assertEqual(resp.status_code, 404)


if __name__ == "__main__":
    unittest.main()
