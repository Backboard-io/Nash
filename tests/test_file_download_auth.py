"""Tests for file download authorization (NASH-01 fix).

Verifies that the download endpoint rejects requests where the
authenticated user does not match the user_id in the URL path. Auth is
session-only — the test mocks `dynamo_service.get_session` to control
the user_id that `require_auth` resolves.

Marked as ``extended``: requires the full Flask app and is slow due to
Backboard SDK initialization. Run with ``pytest -m extended tests/``.
"""

import os
import tempfile
import unittest
from unittest.mock import patch

import pytest

from api.app import create_app

pytestmark = pytest.mark.extended


def _session_row_for(user_id: str) -> dict:
    """Shape that dynamo_service.get_session returns for a valid session."""
    return {
        "session_key": "nash_sk_test",
        "encrypted_key": "fake-encrypted",
        "provider": "backboard",
        "chat_assistant_id": "",
        "user_id": user_id,
        "created_at": "2026-05-20T00:00:00Z",
        "last_used_at": 0,
        "ttl": 9999999999,
    }


class FileDownloadAuthTests(unittest.TestCase):
    """Ensure /api/files/download/<user_id>/<file_id> enforces ownership."""

    def setUp(self):
        self.app = create_app()
        self.app.config["TESTING"] = True
        self.client = self.app.test_client()

        self.user_a_id = "user-aaa-1111"
        self.user_b_id = "user-bbb-2222"
        self.file_id = "testfile-0001"

        self.upload_dir = tempfile.mkdtemp()
        user_a_dir = os.path.join(self.upload_dir, self.user_a_id)
        os.makedirs(user_a_dir)
        self.test_file = os.path.join(user_a_dir, f"{self.file_id}_secret.txt")
        with open(self.test_file, "w") as f:
            f.write("confidential data")

    def tearDown(self):
        import shutil
        shutil.rmtree(self.upload_dir, ignore_errors=True)

    def _login_as(self, user_id: str):
        """Mock the session-resolution path so require_auth pins g.user_id."""
        get_patch = patch(
            "api.middleware.session_auth.dynamo_service.get_session",
            return_value={
                "session_key": "nash_sk_test",
                "encrypted_key": "fake",
                "provider": "backboard",
                "chat_assistant_id": "",
                "user_id": user_id,
                "ttl": 9999999999,
            },
        )
        decrypt_patch = patch(
            "api.middleware.session_auth.decrypt_key", return_value="plaintext-key"
        )
        touch_patch = patch(
            "api.middleware.session_auth.dynamo_service.touch_session"
        )
        return get_patch, decrypt_patch, touch_patch

    def test_owner_can_download_own_file(self):
        get_p, decrypt_p, touch_p = self._login_as(self.user_a_id)
        with patch("api.routes.files.UPLOAD_DIR", self.upload_dir), \
             get_p, decrypt_p, touch_p:
            self.client.set_cookie("session_key", "nash_sk_test")
            resp = self.client.get(
                f"/api/files/download/{self.user_a_id}/{self.file_id}"
            )
            self.assertEqual(resp.status_code, 200)
            self.assertEqual(resp.data.decode(), "confidential data")

    def test_other_user_cannot_download(self):
        get_p, decrypt_p, touch_p = self._login_as(self.user_b_id)
        with patch("api.routes.files.UPLOAD_DIR", self.upload_dir), \
             get_p, decrypt_p, touch_p:
            self.client.set_cookie("session_key", "nash_sk_test")
            resp = self.client.get(
                f"/api/files/download/{self.user_a_id}/{self.file_id}"
            )
            self.assertEqual(resp.status_code, 403)

    def test_unauthenticated_request_rejected(self):
        resp = self.client.get(
            f"/api/files/download/{self.user_a_id}/{self.file_id}"
        )
        self.assertEqual(resp.status_code, 401)

    def test_export_file_served_as_attachment(self):
        """Generated document exports (PDF/Word/etc.) must download, not open
        inline — otherwise a PDF opens in-tab and a Word doc never lands."""
        export_id = "export_deadbeef"
        user_a_dir = os.path.join(self.upload_dir, self.user_a_id)
        export_path = os.path.join(user_a_dir, f"{export_id}_report.pdf")
        with open(export_path, "wb") as f:
            f.write(b"%PDF-1.4 fake")
        get_p, decrypt_p, touch_p = self._login_as(self.user_a_id)
        with patch("api.routes.files.UPLOAD_DIR", self.upload_dir), \
             get_p, decrypt_p, touch_p:
            self.client.set_cookie("session_key", "nash_sk_test")
            resp = self.client.get(
                f"/api/files/download/{self.user_a_id}/{export_id}"
            )
            self.assertEqual(resp.status_code, 200)
            disposition = resp.headers.get("Content-Disposition", "")
            self.assertIn("attachment", disposition)
            self.assertIn("report.pdf", disposition)

    def test_non_export_file_served_inline(self):
        """Images must stay inline so they render via <img>, not force-download."""
        get_p, decrypt_p, touch_p = self._login_as(self.user_a_id)
        with patch("api.routes.files.UPLOAD_DIR", self.upload_dir), \
             get_p, decrypt_p, touch_p:
            self.client.set_cookie("session_key", "nash_sk_test")
            resp = self.client.get(
                f"/api/files/download/{self.user_a_id}/{self.file_id}"
            )
            self.assertEqual(resp.status_code, 200)
            self.assertNotIn(
                "attachment", resp.headers.get("Content-Disposition", "")
            )


if __name__ == "__main__":
    unittest.main()
