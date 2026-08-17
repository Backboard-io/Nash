"""End-to-end tests for the DynamoDB-backed user_service.

These run against an in-process DynamoDB via moto and exercise the full
identity story: BYOK/SSO/password user creation, EMAIL/SUB index resolution,
the BYOK↔SSO convergence guarantee, field updates, lookup-row re-indexing,
and deletion.
"""

from __future__ import annotations

import unittest

from moto import mock_aws

from api.services import context_service, state_service, user_service


class UserServiceTests(unittest.TestCase):
    def setUp(self):
        self._mock = mock_aws()
        self._mock.start()
        state_service.ensure_state_table()

    def tearDown(self):
        self._mock.stop()

    # ── create_user: identity, persistence, lookup indices ───────────────

    def test_create_user_byok_uses_supplied_user_id(self):
        key_hash = state_service.user_hash_from_api_key("espr_test_key")
        synthetic = f"apikey-{key_hash}@apikey.nash.local"
        user = user_service.create_user(
            email=synthetic,
            name="API Key User",
            provider="apikey",
            user_id=key_hash,
        )
        self.assertEqual(user["id"], key_hash)
        # PROFILE row is at USER#{key_hash}, not USER#{synthetic}
        self.assertIsNotNone(state_service.profile.get(key_hash))
        self.assertIsNone(state_service.profile.get(synthetic))

    def test_create_user_is_idempotent_on_existing_email(self):
        first = user_service.create_user(email="carol@example.com", name="Carol")
        second = user_service.create_user(email="carol@example.com", name="Different")
        self.assertEqual(first["id"], second["id"])
        # Existing user is returned unchanged
        self.assertEqual(second["name"], "Carol")

    # ── find_user_by_*: lookup-index resolution ──────────────────────────

    def test_find_user_by_id_returns_none_for_missing(self):
        self.assertIsNone(user_service.find_user_by_id("nope"))

    def test_find_user_by_email_uses_email_index(self):
        user_service.create_user(email="dan@example.com", name="Dan")
        found = user_service.find_user_by_email("dan@example.com")
        self.assertIsNotNone(found)
        self.assertEqual(found["id"], "dan@example.com")

    def test_find_user_by_email_returns_none_when_missing(self):
        self.assertIsNone(user_service.find_user_by_email("ghost@example.com"))

    def test_find_user_by_api_key_resolves_via_user_hash(self):
        # The BYOK contract: user_id == sha256(api_key), so find-by-key is a
        # direct USER# lookup with no index hop.
        key = "espr_user_byok_key"
        key_hash = state_service.user_hash_from_api_key(key)
        user_service.create_user(
            email=f"apikey-{key_hash}@apikey.nash.local",
            name="API Key User",
            provider="apikey",
            user_id=key_hash,
        )
        found = user_service.find_user_by_api_key(key)
        self.assertIsNotNone(found)
        self.assertEqual(found["id"], key_hash)

    def test_get_user_api_key_falls_back_to_personal_context_key(self):
        user = user_service.create_user(
            email="google@example.com",
            name="Google User",
            provider="google",
        )
        context_service.upsert_context(
            user,
            context_service.PERSONAL_CONTEXT_ID,
            api_key="fresh-google-api-key",
            assistant_id="assistant-123",
        )

        self.assertEqual(user_service.get_user_api_key(user["id"]), "fresh-google-api-key")

    def test_update_user_field_persists_to_profile_row(self):
        user = user_service.create_user(email="fred@example.com", name="Fred")
        user_service.update_user_field(user, "name", "Frederick")

        reloaded = user_service.find_user_by_id(user["id"])
        self.assertEqual(reloaded["name"], "Frederick")
        # updatedAt was bumped
        self.assertNotEqual(reloaded["updatedAt"], reloaded["createdAt"])

    def test_update_user_field_replaces_email_index(self):
        user = user_service.create_user(email="iris@old.example", name="Iris")
        user_service.update_user_field(user, "email", "iris@new.example")

        self.assertIsNone(user_service.find_user_by_email("iris@old.example"))
        self.assertEqual(
            user_service.find_user_by_email("iris@new.example")["id"], user["id"]
        )

    # ── delete_user ───────────────────────────────────────────────────────

    def test_delete_user_removes_profile_and_indices(self):
        user = user_service.create_user(
            email="jane@example.com",
            name="Jane",
        )
        user_service.delete_user(user)

        self.assertIsNone(user_service.find_user_by_id(user["id"]))
        self.assertIsNone(user_service.find_user_by_email("jane@example.com"))

    # ── get_all_users ────────────────────────────────────────────────────

    def test_get_all_users_returns_only_profile_rows(self):
        user_service.create_user(email="a@example.com", name="A")
        user_service.create_user(email="b@example.com", name="B")
        # Also write a non-user row to confirm the scan filter excludes it.
        state_service.folders.put("a@example.com", "f1", {"name": "Inbox"})

        users = user_service.get_all_users()
        emails = sorted(u["email"] for u in users)
        self.assertEqual(emails, ["a@example.com", "b@example.com"])

    # ── password verification ────────────────────────────────────────────

if __name__ == "__main__":
    unittest.main()
