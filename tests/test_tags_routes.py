"""Bookmark (tag) routes: DynamoDB Decimal counts must serialize as JSON numbers.

Regression: Dynamo returns numeric attributes as Decimal; jsonify rendered the
tag count as a STRING ("count": "1"), breaking the client's strict
`count === 1` checks (pluralization, zero-states)."""

from __future__ import annotations

import time
import unittest
from decimal import Decimal
from unittest.mock import MagicMock, patch

from api.routes.tags import _serialize_tag
from api.services import encryption_service


class SerializeTagTests(unittest.TestCase):
    def test_decimal_count_becomes_int(self):
        out = _serialize_tag({"pk": "p", "sk": "s", "tag": "x", "count": Decimal("2")})
        self.assertIs(type(out["count"]), int)
        self.assertEqual(out["count"], 2)

    def test_missing_or_garbage_count_defaults_to_zero(self):
        self.assertEqual(_serialize_tag({"tag": "x"})["count"], 0)
        self.assertEqual(_serialize_tag({"tag": "x", "count": "nope"})["count"], 0)


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


class TagListRouteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from api.app import create_app

        cls.app = create_app()
        cls.app.config["TESTING"] = True

    def setUp(self):
        self.client = self.app.test_client()
        self.session = _session_row()
        self.tags_store = MagicMock()
        self.tags_store.list_for_user.return_value = [
            {"pk": "p", "sk": "TAG#funny", "tag": "funny", "count": Decimal("2")},
        ]
        for p in (
            patch("api.services.dynamo_service.get_session", return_value=self.session),
            patch("api.services.dynamo_service.touch_session", lambda *a, **k: None),
            patch("api.services.state_service.tags", self.tags_store),
        ):
            p.start()
            self.addCleanup(p.stop)

    def test_get_tags_returns_numeric_count(self):
        resp = self.client.get(
            "/api/tags", headers={"X-Session-Key": self.session["session_key"]}
        )
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()
        self.assertEqual(body[0]["tag"], "funny")
        self.assertIs(type(body[0]["count"]), int)
        self.assertEqual(body[0]["count"], 2)


if __name__ == "__main__":
    unittest.main()
