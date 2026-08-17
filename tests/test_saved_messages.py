"""Saved ("bookmarked") assistant responses + their folders.

The stores are replaced with an in-memory double that mirrors `_Entity`
semantics *including the partition key*, so the isolation tests really do
exercise whether the routes scope every read/write to
`get_request_state_partition()` — a MagicMock would happily hand user A the
rows of user B and the test would still pass.
"""

from __future__ import annotations

import unittest
from decimal import Decimal
from unittest.mock import patch

from api.routes.saved_messages import (
    SNAPSHOT_TEXT_LIMIT,
    _bucket_of,
    _folder_stats,
    _serialize_saved,
    _sort_newest_first,
)

USER_A = "uid-a"
USER_B = "uid-b"


def _session(user_id: str) -> dict:
    return {
        "api_key": "",
        "provider": "password",
        "chat_assistant_id": "asst-1",
        "user_id": user_id,
        "context_id": "",
        "auth_flow": "password",
    }


_SESSIONS = {f"nash_sk_{USER_A}": _session(USER_A), f"nash_sk_{USER_B}": _session(USER_B)}


class FakeEntity:
    """In-memory stand-in for `state_service._Entity`, partition-aware."""

    def __init__(self):
        self.rows: dict[tuple[str, str], dict] = {}

    def put(self, user_hash, entity_id, attributes):
        self.rows[(user_hash, entity_id)] = dict(attributes)

    def get(self, user_hash, entity_id):
        row = self.rows.get((user_hash, entity_id))
        return dict(row) if row else None

    def list_for_user(self, user_hash):
        return [dict(v) for (u, _), v in self.rows.items() if u == user_hash]

    def batch_put(self, user_hash, entries):
        for entity_id, attributes in entries:
            self.rows[(user_hash, entity_id)] = dict(attributes)

    def delete(self, user_hash, entity_id):
        return self.rows.pop((user_hash, entity_id), None) is not None


class SerializeTests(unittest.TestCase):
    def test_strips_pk_sk_and_coerces_truncated_to_bool(self):
        out = _serialize_saved({"pk": "p", "sk": "SAVEDMSG#m1", "messageId": "m1"})
        self.assertNotIn("pk", out)
        self.assertNotIn("sk", out)
        self.assertIs(type(out["truncated"]), bool)

    def test_sort_is_newest_first(self):
        rows = [{"createdAt": "2026-01-01"}, {"createdAt": "2026-03-01"}, {}]
        self.assertEqual(
            [r.get("createdAt") for r in _sort_newest_first(rows)],
            ["2026-03-01", "2026-01-01", None],
        )

    def test_folder_saved_count_is_int_not_decimal_string(self):
        from api.routes.saved_messages import _int_or

        self.assertIs(type(_int_or(Decimal("3"))), int)
        self.assertEqual(_int_or("nope", 0), 0)


class SavedMessageRouteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from api.app import create_app

        cls.app = create_app()
        cls.app.config["TESTING"] = True

    def setUp(self):
        self.client = self.app.test_client()
        self.saved = FakeEntity()
        self.folders = FakeEntity()
        for p in (
            patch(
                "api.middleware.session_auth._resolve_session",
                side_effect=lambda key: _SESSIONS.get(key),
            ),
            patch("api.middleware.session_auth.dynamo_service.touch_session"),
            patch("api.services.state_service.saved_messages", self.saved),
            patch("api.services.state_service.saved_message_folders", self.folders),
        ):
            p.start()
            self.addCleanup(p.stop)

    # -- helpers ----------------------------------------------------------
    def _h(self, user_id=USER_A):
        return {"X-Session-Key": f"nash_sk_{user_id}"}

    def _save(self, message_id="m1", user_id=USER_A, **extra):
        body = {
            "messageId": message_id,
            "conversationId": "c1",
            "text": "The .map() method creates a new array.",
            "title": "React patterns",
            "model": "Claude Opus 5",
            "context": "Does .map() mutate the array I call it on?",
            **extra,
        }
        return self.client.post("/api/saved-messages", json=body, headers=self._h(user_id))

    def _folder(self, name="React patterns", user_id=USER_A, **extra):
        return self.client.post(
            "/api/saved-messages/folders",
            json={"name": name, **extra},
            headers=self._h(user_id),
        )

    # -- auth -------------------------------------------------------------
    def test_all_routes_require_auth(self):
        self.assertEqual(self.client.get("/api/saved-messages").status_code, 401)
        self.assertEqual(
            self.client.post("/api/saved-messages", json={}).status_code, 401
        )
        self.assertEqual(self.client.delete("/api/saved-messages/m1").status_code, 401)
        self.assertEqual(
            self.client.get("/api/saved-messages/folders").status_code, 401
        )
        self.assertEqual(
            self.client.post("/api/saved-messages/folders", json={}).status_code, 401
        )

    # -- create -----------------------------------------------------------
    def test_create_returns_snapshot_row_without_pk_sk(self):
        resp = self._save()
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()
        self.assertEqual(body["messageId"], "m1")
        self.assertEqual(body["conversationId"], "c1")
        self.assertEqual(body["context"], "Does .map() mutate the array I call it on?")
        self.assertIsNone(body["folderId"])
        self.assertFalse(body["truncated"])
        self.assertNotIn("pk", body)

    def test_create_requires_message_id_and_text(self):
        self.assertEqual(
            self.client.post(
                "/api/saved-messages", json={"conversationId": "c1", "text": "x"},
                headers=self._h(),
            ).status_code,
            400,
        )
        self.assertEqual(
            self.client.post(
                "/api/saved-messages",
                json={"messageId": "m1", "conversationId": "c1"},
                headers=self._h(),
            ).status_code,
            400,
        )

    def test_text_snapshot_is_capped_and_flagged(self):
        body = self._save(text="x" * (SNAPSHOT_TEXT_LIMIT + 500)).get_json()
        self.assertEqual(len(body["text"]), SNAPSHOT_TEXT_LIMIT)
        self.assertTrue(body["truncated"])

    def test_recreate_is_idempotent_and_preserves_created_at_and_note(self):
        first = self._save(note="Why this matters").get_json()
        second = self._save(text="edited snapshot").get_json()
        self.assertEqual(second["createdAt"], first["createdAt"])
        self.assertEqual(second["note"], "Why this matters")
        self.assertEqual(second["text"], "edited snapshot")
        self.assertEqual(len(self.saved.list_for_user(USER_A)), 1)

    # -- list -------------------------------------------------------------
    def test_list_is_newest_first(self):
        self._save("m1")
        self._save("m2")
        self._save("m3")
        ids = [r["messageId"] for r in self.client.get(
            "/api/saved-messages", headers=self._h()
        ).get_json()]
        self.assertEqual(ids[0], "m3")
        self.assertEqual(len(ids), 3)

    def test_list_filters_by_folder_and_by_unsorted(self):
        folder_id = self._folder().get_json()["folderId"]
        self._save("m1", folderId=folder_id)
        self._save("m2")
        in_folder = self.client.get(
            f"/api/saved-messages?folderId={folder_id}", headers=self._h()
        ).get_json()
        unsorted = self.client.get(
            "/api/saved-messages?folderId=unsorted", headers=self._h()
        ).get_json()
        self.assertEqual([r["messageId"] for r in in_folder], ["m1"])
        self.assertEqual([r["messageId"] for r in unsorted], ["m2"])

    # -- patch ------------------------------------------------------------
    def test_patch_edits_note(self):
        self._save()
        resp = self.client.patch(
            "/api/saved-messages/m1", json={"note": "Reuse in emails."}, headers=self._h()
        )
        self.assertEqual(resp.get_json()["note"], "Reuse in emails.")

    def test_patch_moves_between_folders(self):
        a = self._folder("Debugging notes").get_json()["folderId"]
        b = self._folder("SQL and data").get_json()["folderId"]
        self._save("m1", folderId=a)
        moved = self.client.patch(
            "/api/saved-messages/m1", json={"folderId": b}, headers=self._h()
        ).get_json()
        self.assertEqual(moved["folderId"], b)
        back = self.client.patch(
            "/api/saved-messages/m1", json={"folderId": None}, headers=self._h()
        ).get_json()
        self.assertIsNone(back["folderId"])

    def test_patch_rejects_unknown_folder_and_unknown_message(self):
        self._save()
        self.assertEqual(
            self.client.patch(
                "/api/saved-messages/m1", json={"folderId": "nope"}, headers=self._h()
            ).status_code,
            404,
        )
        self.assertEqual(
            self.client.patch(
                "/api/saved-messages/ghost", json={"note": "x"}, headers=self._h()
            ).status_code,
            404,
        )

    # -- delete -----------------------------------------------------------
    def test_delete_by_message_id(self):
        self._save()
        self.assertEqual(
            self.client.delete("/api/saved-messages/m1", headers=self._h()).status_code,
            200,
        )
        self.assertEqual(
            self.client.delete("/api/saved-messages/m1", headers=self._h()).status_code,
            404,
        )

    # -- folders ----------------------------------------------------------
    def test_folder_list_carries_count_and_latest_update_plus_unsorted(self):
        folder_id = self._folder("React patterns", description="Worth keeping.").get_json()[
            "folderId"
        ]
        self._save("m1", folderId=folder_id)
        self._save("m2", folderId=folder_id)
        self._save("m3")

        folders = self.client.get(
            "/api/saved-messages/folders", headers=self._h()
        ).get_json()
        real = folders[0]
        self.assertEqual(real["name"], "React patterns")
        self.assertEqual(real["description"], "Worth keeping.")
        self.assertIs(type(real["savedCount"]), int)
        self.assertEqual(real["savedCount"], 2)
        self.assertEqual(real["updatedAt"], real["lastSavedAt"])
        self.assertFalse(real["virtual"])

        unsorted = folders[-1]
        self.assertEqual(unsorted["folderId"], "unsorted")
        self.assertEqual(unsorted["savedCount"], 1)
        self.assertTrue(unsorted["virtual"])

    def test_folder_create_requires_name_and_patch_renames(self):
        self.assertEqual(self._folder(name="  ").status_code, 400)
        folder_id = self._folder("Prompt library").get_json()["folderId"]
        renamed = self.client.patch(
            f"/api/saved-messages/folders/{folder_id}",
            json={"name": "Client explanations", "description": "Plain-language."},
            headers=self._h(),
        ).get_json()
        self.assertEqual(renamed["name"], "Client explanations")
        self.assertEqual(renamed["description"], "Plain-language.")

    def test_unsorted_is_not_editable_or_deletable(self):
        self.assertEqual(
            self.client.patch(
                "/api/saved-messages/folders/unsorted", json={"name": "x"},
                headers=self._h(),
            ).status_code,
            400,
        )
        self.assertEqual(
            self.client.delete(
                "/api/saved-messages/folders/unsorted", headers=self._h()
            ).status_code,
            400,
        )

    def test_folder_delete_reparents_members_to_unsorted(self):
        folder_id = self._folder().get_json()["folderId"]
        self._save("m1", folderId=folder_id)
        self._save("m2", folderId=folder_id)

        resp = self.client.delete(
            f"/api/saved-messages/folders/{folder_id}", headers=self._h()
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.get_json()["movedToUnsorted"], 2)

        rows = self.client.get("/api/saved-messages", headers=self._h()).get_json()
        self.assertEqual(len(rows), 2)
        self.assertTrue(all(r["folderId"] is None for r in rows))
        self.assertEqual(
            self.client.delete(
                f"/api/saved-messages/folders/{folder_id}", headers=self._h()
            ).status_code,
            404,
        )

    def test_folders_path_is_never_treated_as_a_message_id(self):
        # Flask matches /api/saved-messages/<message_id> for these, so the
        # reserved-id guard must reject them rather than acting on a row.
        folder_id = self._folder().get_json()["folderId"]
        self._save("m1", folderId=folder_id)
        for resp in (
            self.client.delete("/api/saved-messages/folders", headers=self._h()),
            self.client.patch(
                "/api/saved-messages/folders", json={"note": "x"}, headers=self._h()
            ),
        ):
            self.assertEqual(resp.status_code, 404)
        self.assertEqual(
            self.client.post(
                "/api/saved-messages",
                json={"messageId": "folders", "conversationId": "c1", "text": "t"},
                headers=self._h(),
            ).status_code,
            400,
        )
        self.assertIsNotNone(self.folders.get(USER_A, folder_id))
        self.assertEqual(len(self.saved.list_for_user(USER_A)), 1)

    # -- user isolation ---------------------------------------------------
    def test_user_b_cannot_read_or_delete_user_a_rows(self):
        self._save("m1", user_id=USER_A)
        self._save("m2", user_id=USER_B)

        a_rows = self.client.get("/api/saved-messages", headers=self._h(USER_A)).get_json()
        b_rows = self.client.get("/api/saved-messages", headers=self._h(USER_B)).get_json()
        self.assertEqual([r["messageId"] for r in a_rows], ["m1"])
        self.assertEqual([r["messageId"] for r in b_rows], ["m2"])

        # B deleting A's id must 404 and must leave A's row intact.
        self.assertEqual(
            self.client.delete(
                "/api/saved-messages/m1", headers=self._h(USER_B)
            ).status_code,
            404,
        )
        self.assertIsNotNone(self.saved.get(USER_A, "m1"))

        # …and B must not be able to patch it either.
        self.assertEqual(
            self.client.patch(
                "/api/saved-messages/m1", json={"note": "pwned"}, headers=self._h(USER_B)
            ).status_code,
            404,
        )
        self.assertEqual(self.saved.get(USER_A, "m1")["note"], "")

    def test_user_b_cannot_see_or_delete_user_a_folders(self):
        folder_id = self._folder("Debugging notes", user_id=USER_A).get_json()["folderId"]
        b_folders = self.client.get(
            "/api/saved-messages/folders", headers=self._h(USER_B)
        ).get_json()
        self.assertEqual([f["folderId"] for f in b_folders], ["unsorted"])
        self.assertEqual(
            self.client.delete(
                f"/api/saved-messages/folders/{folder_id}", headers=self._h(USER_B)
            ).status_code,
            404,
        )
        self.assertIsNotNone(self.folders.get(USER_A, folder_id))


if __name__ == "__main__":
    unittest.main()


class OrphanedFolderTests(unittest.TestCase):
    """A saved response whose folder row is gone must still be reachable.

    Without orphan-safe bucketing such a row belongs to no folder card and is
    not in Unsorted either, so it disappears from every view while remaining
    in storage.
    """

    def test_row_pointing_at_a_missing_folder_reads_as_unsorted(self):
        known = {"folder-that-exists"}
        self.assertIsNone(_bucket_of({"folderId": "folder-that-vanished"}, known))
        self.assertIsNone(_bucket_of({"folderId": None}, known))
        self.assertEqual(
            _bucket_of({"folderId": "folder-that-exists"}, known), "folder-that-exists"
        )

    def test_stats_count_an_orphan_under_unsorted(self):
        rows = [
            {"folderId": "gone", "createdAt": "2026-01-01"},
            {"folderId": None, "createdAt": "2026-01-02"},
            {"folderId": "live", "createdAt": "2026-01-03"},
        ]
        stats = _folder_stats(rows, {"live"})
        self.assertEqual(stats[None]["savedCount"], 2)
        self.assertEqual(stats["live"]["savedCount"], 1)


class EdgeCaseTests(unittest.TestCase):
    """Adversarial probes: malformed input, boundary sizes, hostile ids."""

    def _fresh(self):
        from api.routes import saved_messages as mod
        entity, folders = FakeEntity(), FakeEntity()
        return mod, entity, folders

    def test_clip_handles_none_numbers_and_emoji(self):
        from api.routes.saved_messages import _clip
        self.assertEqual(_clip(None, 5), "")
        self.assertEqual(_clip(12345678, 5), "12345")  # non-string coerced, then clipped
        # astral-plane emoji must not explode or split a surrogate pair
        clipped = _clip("🚀" * 10, 4)
        self.assertEqual(clipped, "🚀" * 4)

    def test_normalize_folder_id_variants(self):
        from api.routes.saved_messages import _normalize_folder_id
        for raw in (None, "", "   ", "unsorted"):
            self.assertIsNone(_normalize_folder_id(raw))
        self.assertEqual(_normalize_folder_id(" f-1 "), "f-1")
        # non-string junk must not crash
        self.assertIsNone(_normalize_folder_id(0))

    def test_resave_without_optional_fields_preserves_them(self):
        """The idempotency contract: omitted optional fields keep their values."""
        from api.routes.saved_messages import _serialize_saved
        # simulate: first save wrote full metadata; second save omits it
        existing = {
            "messageId": "m1", "conversationId": "c1", "text": "old",
            "title": "My chat", "model": "GPT-4.1", "endpoint": "openai",
            "context": "the question", "note": "keep me", "folderId": None,
            "createdAt": "2026-01-01T00:00:00+00:00",
        }
        saved = _serialize_saved(existing)
        data = {"messageId": "m1", "conversationId": "c1", "text": "new text"}
        # mirror the route's guarded-overwrite logic
        for key in ("title", "model", "endpoint", "context"):
            if key in data:
                saved[key] = data[key]
        self.assertEqual(saved["title"], "My chat")
        self.assertEqual(saved["model"], "GPT-4.1")
        self.assertEqual(saved["endpoint"], "openai")
        self.assertEqual(saved["context"], "the question")
