"""Generated-image persistence resilience ("Couldn't load this image").

The S3→local download used to be one-shot inside a daemon thread: any failure
(or a dev-server reload killing the thread) lost the image forever and
/api/files/download 404'd on every retry. These tests cover the hardening:
the pending event is registered before the thread starts, the presigned URL is
recorded up front, downloads retry, and refetch_generated_image() heals a
missing file from the recorded URL."""

import io
import os
import shutil
import tempfile
import threading
import unittest
from unittest.mock import patch

from api.routes import chat


class FakeFileMeta:
    def __init__(self):
        self.rows: dict[tuple[str, str], dict] = {}

    def put(self, user_id, file_id, row):
        self.rows[(user_id, file_id)] = dict(row)

    def get(self, user_id, file_id):
        return self.rows.get((user_id, file_id))


class RegisterPendingImageTests(unittest.TestCase):
    def test_event_visible_to_route_before_thread_starts(self):
        fid = "generated_test-doc-1"
        event = chat.register_pending_image(fid)
        try:
            # wait_for_pending_image finds the event even though no worker
            # thread has started yet (the pre-registration contract).
            event.set()
            self.assertTrue(chat.wait_for_pending_image(fid, timeout=0.1))
        finally:
            with chat._pending_image_lock:
                chat._pending_image_downloads.pop(fid, None)


class PersistGeneratedImageTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.meta = FakeFileMeta()

    def _run(self, urlopen_side_effects):
        calls = {"n": 0}

        def fake_urlopen(req, timeout=0):
            effect = urlopen_side_effects[min(calls["n"], len(urlopen_side_effects) - 1)]
            calls["n"] += 1
            if isinstance(effect, Exception):
                raise effect
            return io.BytesIO(effect)

        class _Ctx:
            def __init__(self, buf):
                self.buf = buf

            def __enter__(self):
                return self.buf

            def __exit__(self, *a):
                return False

        def fake_urlopen_ctx(req, timeout=0):
            return _Ctx(fake_urlopen(req, timeout))

        with patch("api.routes.files.UPLOAD_DIR", self.tmp), patch.object(
            chat.state_service, "file_meta", self.meta
        ), patch.object(chat.urllib.request, "urlopen", fake_urlopen_ctx), patch.object(
            chat.time, "sleep", lambda s: None
        ):
            chat._persist_generated_image_async(
                "https://bucket.amazonaws.com/x/doc.jpg",
                "doc-1",
                "image/jpeg",
                "user-1",
                "dir-1",
            )
        return calls["n"]

    def test_presigned_url_recorded_before_download(self):
        self._run([b"img-bytes"])
        row = self.meta.get("user-1", chat.generated_image_file_id("doc-1"))
        self.assertIsNotNone(row)
        self.assertEqual(row["media_url"], "https://bucket.amazonaws.com/x/doc.jpg")
        self.assertEqual(row["status"], "indexed")

    def test_transient_failure_is_retried(self):
        attempts = self._run([OSError("boom"), b"img-bytes"])
        self.assertEqual(attempts, 2)
        row = self.meta.get("user-1", chat.generated_image_file_id("doc-1"))
        self.assertEqual(row["status"], "indexed")

    def test_exhausted_retries_keep_pending_row_with_media_url(self):
        self._run([OSError("boom")])
        row = self.meta.get("user-1", chat.generated_image_file_id("doc-1"))
        # The pre-recorded row (with the presigned URL) survives so the
        # download route can heal later.
        self.assertEqual(row["status"], "pending")
        self.assertTrue(row["media_url"])


class RefetchGeneratedImageTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.meta = FakeFileMeta()
        self.fid = chat.generated_image_file_id("doc-2")

    def test_refetch_downloads_and_marks_indexed(self):
        self.meta.put("u", self.fid, {
            "file_id": self.fid,
            "type": "image/png",
            "status": "pending",
            "media_url": "https://bucket.amazonaws.com/x/doc2.png",
        })

        class _Ctx:
            def __enter__(self):
                return io.BytesIO(b"png-bytes")

            def __exit__(self, *a):
                return False

        with patch("api.routes.files.UPLOAD_DIR", self.tmp), patch.object(
            chat.state_service, "file_meta", self.meta
        ), patch.object(chat.urllib.request, "urlopen", lambda req, timeout=0: _Ctx()):
            ok = chat.refetch_generated_image("u", "dir-x", self.fid)

        self.assertTrue(ok)
        row = self.meta.get("u", self.fid)
        self.assertEqual(row["status"], "indexed")
        self.assertTrue(os.path.exists(os.path.join(self.tmp, "dir-x", f"{self.fid}.png")))

    def test_refetch_without_recorded_url_returns_false(self):
        with patch.object(chat.state_service, "file_meta", self.meta):
            self.assertFalse(chat.refetch_generated_image("u", "dir-x", self.fid))

    def test_refetch_failure_returns_false(self):
        self.meta.put("u", self.fid, {
            "file_id": self.fid,
            "type": "image/jpeg",
            "status": "pending",
            "media_url": "https://bucket.amazonaws.com/x/expired.jpg",
        })

        def boom(req, timeout=0):
            raise OSError("403 expired")

        with patch("api.routes.files.UPLOAD_DIR", self.tmp), patch.object(
            chat.state_service, "file_meta", self.meta
        ), patch.object(chat.urllib.request, "urlopen", boom):
            self.assertFalse(chat.refetch_generated_image("u", "dir-x", self.fid))


if __name__ == "__main__":
    unittest.main()
