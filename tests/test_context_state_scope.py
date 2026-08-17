"""State partitioning + account-deletion behavior.

The contract under test:

  - state_partition_id(): every session resolves to the plain user_id — all
    data lives in the personal partition.
  - Legacy share rows created under old org partitions stay readable.
  - DELETE /api/user/account wipes the personal partition and the Backboard
    side using the stored key.

Style follows tests/test_folder_document_scope.py: real functions, fake
Backboard/network edges, in-memory DynamoDB state.
"""

from __future__ import annotations

import io
import tempfile
import time
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from api.services import encryption_service
from api.services.context_service import (
    fs_safe_partition,
    state_partition_id,
)


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------

class _FakeEntity:
    def __init__(self, store, prefix: str):
        self._store = store
        self._prefix = prefix

    def _sk(self, entity_id: str) -> str:
        return f"{self._prefix}{entity_id}"

    def put(self, user_hash, entity_id, attributes):
        self._store.put_item(self._store.user_pk(user_hash), self._sk(entity_id), attributes)

    def get(self, user_hash, entity_id):
        return self._store.get_item(self._store.user_pk(user_hash), self._sk(entity_id))

    def list_for_user(self, user_hash):
        return self._store.query_prefix(self._store.user_pk(user_hash), self._prefix)

    def delete(self, user_hash, entity_id):
        return self._store.delete_item(self._store.user_pk(user_hash), self._sk(entity_id))


class _FakeSingleton:
    def __init__(self, store, sk: str):
        self._store = store
        self._sk = sk

    def put(self, user_hash, attributes):
        self._store.put_item(self._store.user_pk(user_hash), self._sk, attributes)

    def get(self, user_hash):
        return self._store.get_item(self._store.user_pk(user_hash), self._sk)

    def delete(self, user_hash):
        return self._store.delete_item(self._store.user_pk(user_hash), self._sk)


class FakeStateService:
    """In-memory mirror of the state_service slice the routes consume."""

    SK_PROFILE = "PROFILE"
    SK_USERREF = "USERREF"
    SK_FAVORITES = "FAVORITES"
    SK_FOLDER_PREFIX = "FOLDER#"
    SK_TAG_PREFIX = "TAG#"
    SK_PRESET_PREFIX = "PRESET#"
    SK_AGENT_PREFIX = "AGENT#"
    SK_PROMPT_PREFIX = "PROMPT#"
    SK_PROMPTGROUP_PREFIX = "PROMPTGROUP#"
    SK_MCP_PREFIX = "MCP#"
    SK_FILEMETA_PREFIX = "FILEMETA#"
    SK_CONVO_PREFIX = "CONVO#"
    SK_THREADMAP_PREFIX = "THREADMAP#"
    SK_REGEN_PREFIX = "REGEN#"
    SK_FALLBACK_PREFIX = "FALLBACK#"

    def __init__(self):
        self.rows: dict[tuple[str, str], dict] = {}
        self.profile = _FakeSingleton(self, self.SK_PROFILE)
        self.file_meta = _FakeEntity(self, self.SK_FILEMETA_PREFIX)
        self.convo_meta = _FakeEntity(self, self.SK_CONVO_PREFIX)
        self.thread_map = _FakeEntity(self, self.SK_THREADMAP_PREFIX)

    def user_pk(self, user_hash: str) -> str:
        return f"USER#{user_hash}"

    def email_lookup_pk(self, email: str) -> str:
        return f"EMAIL#{email.lower().strip()}"

    def sub_lookup_pk(self, sub: str) -> str:
        return f"SUB#{sub}"

    def user_hash_from_api_key(self, api_key: str) -> str:
        from api.services.state_service import user_hash_from_api_key
        return user_hash_from_api_key(api_key)

    def put_item(self, pk, sk, attributes):
        row = dict(attributes)
        row["pk"], row["sk"] = pk, sk
        self.rows[(pk, sk)] = row

    def get_item(self, pk, sk):
        row = self.rows.get((pk, sk))
        return dict(row) if row is not None else None

    def delete_item(self, pk, sk):
        return self.rows.pop((pk, sk), None) is not None

    def transact_put_items(self, items):
        for pk, sk, attrs in items:
            self.put_item(pk, sk, attrs)

    def query_user(self, pk):
        return [dict(r) for (p, _s), r in self.rows.items() if p == pk]

    def query_prefix(self, pk, sk_prefix):
        return [
            dict(r) for (p, s), r in self.rows.items()
            if p == pk and s.startswith(sk_prefix)
        ]


def _fake_session_row(user_id: str, context_id: str, api_key: str = "test-bb-key"):
    return {
        "session_key": f"nash_sk_{user_id}_{context_id or 'personal'}",
        "encrypted_key": encryption_service.encrypt_key(api_key),
        "provider": "backboard",
        "chat_assistant_id": "asst-session",
        "user_id": user_id,
        "context_id": context_id,
        "created_at": "",
        "last_used_at": int(time.time()),
        "ttl": int(time.time()) + 3600,
    }


# ---------------------------------------------------------------------------
# Unit: the resolver itself
# ---------------------------------------------------------------------------

class StatePartitionIdTests(unittest.TestCase):
    def test_personal_and_legacy_keep_plain_user_id(self):
        self.assertEqual(state_partition_id("uid-1", ""), "uid-1")
        self.assertEqual(state_partition_id("uid-1", "personal"), "uid-1")

    def test_all_contexts_share_the_personal_partition(self):
        self.assertEqual(state_partition_id("uid-1", "org:8448"), "uid-1")

    def test_fs_safe_form_keeps_personal_unchanged(self):
        self.assertEqual(fs_safe_partition("uid-1"), "uid-1")
        self.assertEqual(fs_safe_partition("uid-1#ORG#8448"), "uid-1_ORG_8448")


class SharePartitionBackCompatTests(unittest.TestCase):
    def test_legacy_share_falls_back_to_user_id(self):
        from api.routes.share import _share_partition

        self.assertEqual(_share_partition({"userId": "uid-1"}), "uid-1")
        self.assertEqual(
            _share_partition({"userId": "uid-1", "statePartition": "uid-1#ORG#8448"}),
            "uid-1#ORG#8448",
        )


# ---------------------------------------------------------------------------
# Integration: real routes through the Flask app, fake sessions + state
# ---------------------------------------------------------------------------

@pytest.mark.extended
class ContextScopeHarness(unittest.TestCase):
    USER_ID = "uid-1"

    @classmethod
    def setUpClass(cls):
        from api.app import create_app

        cls.app = create_app()
        cls.app.config["TESTING"] = True

    def setUp(self):
        self.client = self.app.test_client()
        self.fake_state = FakeStateService()
        self.sessions = {}
        for ctx in ("", "org:8448"):
            row = _fake_session_row(self.USER_ID, ctx)
            self.sessions[row["session_key"]] = row

        for p in (
            patch("api.services.dynamo_service.get_session", side_effect=self.sessions.get),
            patch("api.services.dynamo_service.touch_session", lambda *a, **k: None),
            patch("api.services.user_service.state_service", self.fake_state),
        ):
            p.start()
            self.addCleanup(p.stop)

    def _headers(self, context_id: str) -> dict:
        return {"X-Session-Key": f"nash_sk_{self.USER_ID}_{context_id or 'personal'}"}


class DeleteAccountBackboardAccountSurvivesTests(ContextScopeHarness):
    """DELETE /api/user/account erases Backboard *content* (threads,
    documents, memories) but must never delete or deactivate the Backboard
    account/assistant itself. The two are intentionally decoupled: a Nash
    user choosing to delete their Nash account must not take their Backboard
    account down with it.
    """

    def setUp(self):
        super().setUp()
        self.bb_clients: list[MagicMock] = []

        def _make_client(api_key):
            client = MagicMock()
            client._make_request = AsyncMock(return_value=MagicMock(json=lambda: []))
            client.list_assistant_documents = AsyncMock(return_value=[])
            client.delete_document = AsyncMock()
            client.get_memories = AsyncMock(return_value=MagicMock(memories=[]))
            client.delete_memory = AsyncMock()
            client.delete_assistant = AsyncMock()
            self.bb_clients.append(client)
            return client

        for p in (
            patch("api.routes.user.state_service", self.fake_state),
            patch("api.routes.user.get_user_client", side_effect=_make_client),
        ):
            p.start()
            self.addCleanup(p.stop)

        self.fake_state.profile.put("uid-1", {
            "id": "uid-1",
            "email": "a@example.com",
            "backboardSub": "sub-A",
            "bbAssistantId": "asst-personal",
            "bbContexts": {
                "personal": {
                    "apiKeyEncrypted": encryption_service.encrypt_key("personal-key"),
                    "assistantId": "asst-personal",
                },
            },
            "bbActiveContext": "personal",
        })
        self.fake_state.put_item("EMAIL#a@example.com", "USERREF", {"user_id": "uid-1"})
        self.fake_state.put_item("SUB#sub-A", "USERREF", {"user_id": "uid-1"})
        self.fake_state.convo_meta.put("uid-1", "c1", {"conversationId": "c1"})
        self.fake_state.thread_map.put("uid-1", "c1", {"thread_id": "t1"})

    def test_backboard_account_and_assistant_are_never_deleted(self):
        resp = self.client.delete(
            "/api/user/account",
            headers={**self._headers("personal"), "Sec-Fetch-Site": "same-origin"},
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(self.bb_clients), 1)
        client = self.bb_clients[0]

        # Content wipe did happen...
        client.get_memories.assert_awaited_once_with("asst-personal")
        client.delete_document.assert_not_awaited()  # no document_ids seeded

        # ...but nothing ever targets the assistant/account itself.
        client.delete_assistant.assert_not_awaited()
        delete_calls = [
            c for c in client._make_request.await_args_list if c.args[0] == "DELETE"
        ]
        self.assertTrue(delete_calls, "expected the seeded thread to be deleted")
        for c in delete_calls:
            self.assertTrue(
                c.args[1].startswith("threads/"),
                f"DELETE call must target a thread, not the account/assistant: {c.args[1]!r}",
            )


class DeleteAccountOrphanedDocumentTests(ContextScopeHarness):
    """Threads and memories are both live-listed from the Backboard
    assistant (union with Nash's local tracking), so nothing Nash's own
    state lost track of gets left behind. Documents were the odd one out:
    only Nash-tracked `document_id`s (from local FILEMETA# rows) ever got
    deleted, so a document ingested any other way — a dropped/failed
    FILEMETA write, a document uploaded straight through Backboard, one
    dragged in by a re-imported thread — was never deleted and would sit on
    the Backboard dashboard forever. This covers the added Backboard-side
    document listing that closes that gap.
    """

    def setUp(self):
        super().setUp()
        self.bb_clients: list[MagicMock] = []

        def _make_client(api_key):
            client = MagicMock()
            client._make_request = AsyncMock(return_value=MagicMock(json=lambda: []))
            orphan_doc = MagicMock(document_id="orphan-doc-1")
            client.list_assistant_documents = AsyncMock(return_value=[orphan_doc])
            client.delete_document = AsyncMock()
            client.get_memories = AsyncMock(return_value=MagicMock(memories=[]))
            client.delete_memory = AsyncMock()
            self.bb_clients.append(client)
            return client

        for p in (
            patch("api.routes.user.state_service", self.fake_state),
            patch("api.routes.user.get_user_client", side_effect=_make_client),
        ):
            p.start()
            self.addCleanup(p.stop)

        self.fake_state.profile.put("uid-1", {
            "id": "uid-1",
            "email": "a@example.com",
            "backboardSub": "sub-A",
            "bbAssistantId": "asst-personal",
            "bbContexts": {
                "personal": {
                    "apiKeyEncrypted": encryption_service.encrypt_key("personal-key"),
                    "assistantId": "asst-personal",
                },
            },
            "bbActiveContext": "personal",
        })
        self.fake_state.put_item("EMAIL#a@example.com", "USERREF", {"user_id": "uid-1"})
        self.fake_state.put_item("SUB#sub-A", "USERREF", {"user_id": "uid-1"})
        # Deliberately NO FILEMETA row for "orphan-doc-1" — Nash's own state
        # never learned about this document; only Backboard knows it exists.

    def test_document_unknown_to_local_state_is_still_deleted(self):
        resp = self.client.delete(
            "/api/user/account",
            headers={**self._headers("personal"), "Sec-Fetch-Site": "same-origin"},
        )
        self.assertEqual(resp.status_code, 200)
        client = self.bb_clients[0]
        client.list_assistant_documents.assert_awaited_once_with("asst-personal")
        client.delete_document.assert_awaited_once_with("orphan-doc-1")


