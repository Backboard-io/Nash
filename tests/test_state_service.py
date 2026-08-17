"""CRUD round-trip tests for api.services.state_service.

These run against an in-process DynamoDB mocked by moto, so they're hermetic
and don't require Docker / DynamoDB Local.
"""

from __future__ import annotations

import unittest

import boto3
from moto import mock_aws

from api.services import state_service


class StateServiceTests(unittest.TestCase):
    """Round-trip every primitive and entity wrapper against moto-DynamoDB."""

    def setUp(self):
        self._mock = mock_aws()
        self._mock.start()
        state_service.ensure_state_table()

    def tearDown(self):
        self._mock.stop()

    # ── Identity helper ───────────────────────────────────────────────────

    def test_user_hash_from_api_key_is_sha256(self):
        # The auth path at api/routes/auth.py uses sha256 of the API key as
        # the user identifier. The state service must produce the same hash
        # for the same key, or BYOK and SSO won't land on the same partition.
        import hashlib
        key = "espr_some_test_key"
        expected = hashlib.sha256(key.encode()).hexdigest()
        self.assertEqual(state_service.user_hash_from_api_key(key), expected)

    def test_ensure_state_table_is_idempotent(self):
        # Should not raise on a second call.
        state_service.ensure_state_table()
        client = boto3.client("dynamodb", region_name="us-east-1")
        tables = client.list_tables()["TableNames"]
        self.assertIn("nash_state_tests", tables)

    # ── put_item / get_item ───────────────────────────────────────────────

    def test_put_and_get_roundtrip(self):
        pk = state_service.user_pk("hash-alice")
        sk = state_service.SK_PROFILE
        state_service.put_item(pk, sk, {"email": "alice@example.com", "name": "Alice"})

        item = state_service.get_item(pk, sk)
        self.assertIsNotNone(item)
        self.assertEqual(item["email"], "alice@example.com")
        self.assertEqual(item["name"], "Alice")
        # pk/sk are stamped by put_item
        self.assertEqual(item["pk"], pk)
        self.assertEqual(item["sk"], sk)

    def test_get_item_missing_returns_none(self):
        self.assertIsNone(state_service.get_item("USER#nope", "PROFILE"))

    # ── query_user / query_prefix ─────────────────────────────────────────

    def test_query_user_returns_only_that_users_rows(self):
        alice = state_service.user_pk("hash-alice")
        bob = state_service.user_pk("hash-bob")
        state_service.put_item(alice, "FOLDER#1", {"name": "alice-f1"})
        state_service.put_item(alice, "TAG#1", {"name": "alice-t1"})
        state_service.put_item(bob, "FOLDER#1", {"name": "bob-f1"})

        rows = state_service.query_user(alice)
        names = sorted(r["name"] for r in rows)
        self.assertEqual(names, ["alice-f1", "alice-t1"])

    def test_query_prefix_filters_by_sk_prefix(self):
        pk = state_service.user_pk("hash-alice")
        state_service.put_item(pk, "FOLDER#1", {"name": "f1"})
        state_service.put_item(pk, "FOLDER#2", {"name": "f2"})
        state_service.put_item(pk, "TAG#1", {"name": "t1"})

        folders = state_service.query_prefix(pk, state_service.SK_FOLDER_PREFIX)
        self.assertEqual(sorted(r["name"] for r in folders), ["f1", "f2"])

        tags = state_service.query_prefix(pk, state_service.SK_TAG_PREFIX)
        self.assertEqual([r["name"] for r in tags], ["t1"])

    # ── delete_item ───────────────────────────────────────────────────────

    def test_delete_item_returns_true_when_present(self):
        pk = state_service.user_pk("hash-alice")
        state_service.put_item(pk, "TAG#1", {"name": "t1"})
        self.assertTrue(state_service.delete_item(pk, "TAG#1"))
        self.assertIsNone(state_service.get_item(pk, "TAG#1"))

    def test_delete_item_returns_false_when_absent(self):
        self.assertFalse(state_service.delete_item("USER#ghost", "TAG#1"))

    # ── batch_put / batch_delete ──────────────────────────────────────────

    def test_batch_put_writes_many(self):
        pk = state_service.user_pk("hash-alice")
        items = [
            {"pk": pk, "sk": f"FOLDER#{i}", "name": f"f{i}"} for i in range(30)
        ]
        state_service.batch_put(items)

        rows = state_service.query_prefix(pk, state_service.SK_FOLDER_PREFIX)
        self.assertEqual(len(rows), 30)

    def test_batch_put_rejects_items_missing_pk_sk(self):
        with self.assertRaises(ValueError):
            state_service.batch_put([{"name": "x"}])

    def test_batch_delete_removes_listed_rows(self):
        pk = state_service.user_pk("hash-alice")
        state_service.put_item(pk, "TAG#1", {"name": "t1"})
        state_service.put_item(pk, "TAG#2", {"name": "t2"})
        state_service.put_item(pk, "TAG#3", {"name": "t3"})

        state_service.batch_delete([(pk, "TAG#1"), (pk, "TAG#3")])
        remaining = state_service.query_prefix(pk, state_service.SK_TAG_PREFIX)
        self.assertEqual([r["sk"] for r in remaining], ["TAG#2"])

    # ── transact_write ────────────────────────────────────────────────────

    def test_transact_write_persists_profile_plus_lookup_rows(self):
        # Mirrors the user-create transaction: PROFILE + EMAIL lookup
        # rows must land atomically.
        table_name = "nash_state_tests"
        user_hash = "hash-alice"
        email = "alice@example.com"
        state_service.transact_write([
            {"Put": {
                "TableName": table_name,
                "Item": {
                    "pk": {"S": state_service.user_pk(user_hash)},
                    "sk": {"S": state_service.SK_PROFILE},
                    "email": {"S": email},
                },
            }},
            {"Put": {
                "TableName": table_name,
                "Item": {
                    "pk": {"S": state_service.email_lookup_pk(email)},
                    "sk": {"S": state_service.SK_USERREF},
                    "user_hash": {"S": user_hash},
                },
            }},
        ])

        profile = state_service.get_item(
            state_service.user_pk(user_hash), state_service.SK_PROFILE
        )
        self.assertIsNotNone(profile)
        self.assertEqual(profile["email"], email)

        email_row = state_service.get_item(
            state_service.email_lookup_pk(email), state_service.SK_USERREF
        )
        self.assertEqual(email_row["user_hash"], user_hash)

    def test_transact_write_empty_actions_is_noop(self):
        # Should not raise.
        state_service.transact_write([])

    # ── transact_put_items convenience wrapper ────────────────────────────

    def test_transact_put_items_serializes_and_persists_all(self):
        # Higher-level atomic helper used by create_user to land PROFILE +
        # EMAIL/SUB lookup rows in a single transaction.
        uh = "hash-zoe"
        state_service.transact_put_items([
            (state_service.user_pk(uh), state_service.SK_PROFILE,
             {"email": "zoe@example.com", "name": "Zoe", "active": True}),
            (state_service.email_lookup_pk("zoe@example.com"), state_service.SK_USERREF,
             {"user_id": uh}),
        ])

        profile = state_service.profile.get(uh)
        self.assertEqual(profile["email"], "zoe@example.com")
        self.assertTrue(profile["active"])

        ref = state_service.get_item(
            state_service.email_lookup_pk("zoe@example.com"),
            state_service.SK_USERREF,
        )
        self.assertEqual(ref["user_id"], uh)

    def test_transact_put_items_empty_is_noop(self):
        state_service.transact_put_items([])

    # ── scan_profile_rows ─────────────────────────────────────────────────

    def test_scan_profile_rows_returns_only_user_profiles(self):
        # Profile rows
        state_service.profile.put("uid-1", {"email": "a@example.com", "name": "A"})
        state_service.profile.put("uid-2", {"email": "b@example.com", "name": "B"})
        # Noise: a folder under one user, a lookup index, a global row
        state_service.folders.put("uid-1", "f1", {"name": "Inbox"})
        state_service.put_item(
            state_service.email_lookup_pk("a@example.com"),
            state_service.SK_USERREF,
            {"user_id": "uid-1"},
        )

        rows = state_service.scan_profile_rows()
        names = sorted(r["name"] for r in rows)
        self.assertEqual(names, ["A", "B"])

    # ── Entity wrapper (per-user repeating) ───────────────────────────────

    def test_entity_put_get_list_delete(self):
        uh = "hash-alice"
        state_service.folders.put(uh, "f1", {"name": "Inbox", "color": "blue"})
        state_service.folders.put(uh, "f2", {"name": "Archive", "color": "grey"})

        row = state_service.folders.get(uh, "f1")
        self.assertIsNotNone(row)
        self.assertEqual(row["name"], "Inbox")
        self.assertEqual(row["sk"], "FOLDER#f1")

        listing = state_service.folders.list_for_user(uh)
        self.assertEqual(sorted(r["name"] for r in listing), ["Archive", "Inbox"])

        self.assertTrue(state_service.folders.delete(uh, "f1"))
        self.assertIsNone(state_service.folders.get(uh, "f1"))
        remaining = state_service.folders.list_for_user(uh)
        self.assertEqual([r["name"] for r in remaining], ["Archive"])

    def test_entities_are_isolated_per_user(self):
        state_service.tags.put("hash-alice", "t1", {"name": "alice-tag"})
        state_service.tags.put("hash-bob", "t1", {"name": "bob-tag"})

        alice_tags = state_service.tags.list_for_user("hash-alice")
        bob_tags = state_service.tags.list_for_user("hash-bob")
        self.assertEqual([r["name"] for r in alice_tags], ["alice-tag"])
        self.assertEqual([r["name"] for r in bob_tags], ["bob-tag"])

    def test_entities_do_not_bleed_across_prefixes(self):
        uh = "hash-alice"
        state_service.folders.put(uh, "1", {"kind": "folder"})
        state_service.tags.put(uh, "1", {"kind": "tag"})
        state_service.presets.put(uh, "1", {"kind": "preset"})

        self.assertEqual(
            [r["kind"] for r in state_service.folders.list_for_user(uh)], ["folder"]
        )
        self.assertEqual(
            [r["kind"] for r in state_service.tags.list_for_user(uh)], ["tag"]
        )
        self.assertEqual(
            [r["kind"] for r in state_service.presets.list_for_user(uh)], ["preset"]
        )

    # ── Singleton wrapper (per-user, fixed SK) ────────────────────────────

    def test_profile_singleton_overwrites(self):
        uh = "hash-alice"
        state_service.profile.put(uh, {"email": "alice@example.com", "role": "USER"})
        state_service.profile.put(uh, {"email": "alice@example.com", "role": "ADMIN"})

        row = state_service.profile.get(uh)
        self.assertEqual(row["role"], "ADMIN")

    def test_favorites_singleton(self):
        uh = "hash-alice"
        self.assertIsNone(state_service.favorites.get(uh))
        state_service.favorites.put(uh, {"items": ["a", "b", "c"]})
        self.assertEqual(state_service.favorites.get(uh)["items"], ["a", "b", "c"])
        self.assertTrue(state_service.favorites.delete(uh))
        self.assertIsNone(state_service.favorites.get(uh))

    # ── Global entity / singleton wrappers ────────────────────────────────

    def test_shared_links_lives_on_global_partition(self):
        state_service.shared_links.put("share-abc", {"thread_id": "t-1", "owner": "alice"})
        row = state_service.shared_links.get("share-abc")
        self.assertIsNotNone(row)
        self.assertEqual(row["pk"], state_service.GLOBAL_PK)
        self.assertEqual(row["sk"], "SHARE#share-abc")
        self.assertEqual(row["owner"], "alice")

        listing = state_service.shared_links.list_all()
        self.assertEqual(len(listing), 1)

        self.assertTrue(state_service.shared_links.delete("share-abc"))
        self.assertEqual(state_service.shared_links.list_all(), [])

    def test_email_lookup_pk_is_case_insensitive(self):
        # `find_user_by_email` historically matched on the raw string. Lower-casing
        # at the PK level means SSO providers that return mixed-case emails still
        # collapse to one user.
        self.assertEqual(
            state_service.email_lookup_pk("Alice@Example.com"),
            state_service.email_lookup_pk("  alice@example.com  "),
        )


if __name__ == "__main__":
    unittest.main()
