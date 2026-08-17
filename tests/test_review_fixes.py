"""Regression tests for the PR #129 security-review fixes.

Stream ownership on the live-chat endpoints: streams are only visible to
their owner.
"""

from __future__ import annotations

import unittest
from unittest import mock

from moto import mock_aws

from api.services import state_service, user_service


class ReviewFixTestBase(unittest.TestCase):
    def setUp(self):
        self._mock = mock_aws()
        self._mock.start()
        state_service.ensure_state_table()
        from api.services import dynamo_service

        dynamo_service.ensure_table()
        from api.app import create_app

        self.app = create_app()
        self.app.config["TESTING"] = True
        self.client = self.app.test_client()

    def tearDown(self):
        self._mock.stop()

    def _user(self, email: str) -> dict:
        return user_service.create_user(
            email=email,
            name=email.split("@")[0].title(),
            provider="backboard",
        )

    def _auth_headers(self, user: dict) -> dict:
        from api.services import dynamo_service, encryption_service

        session_key = f"nash_sk_{user['id']}"
        dynamo_service.store_session(
            session_key=session_key,
            encrypted_key=encryption_service.encrypt_key(f"key-{user['id']}"),
            provider="backboard",
            user_id=user["id"],
            chat_assistant_id="asst-test",
            context_id="",
        )
        return {"X-Session-Key": session_key, "Sec-Fetch-Site": "same-origin"}


class StreamOwnershipTests(ReviewFixTestBase):
    """A2: live-chat streams are only visible to their owner."""

    def _start_stream(self, user: dict, conversation_id: str = "convo-owner") -> str:
        resp = self.client.post(
            "/api/agents/chat",
            json={"text": "hi", "model": "gpt-test", "conversationId": conversation_id},
            headers=self._auth_headers(user),
        )
        self.assertEqual(resp.status_code, 200)
        return resp.get_json()["streamId"]

    def test_other_users_cannot_read_abort_or_enumerate_a_stream(self):
        owner = self._user("owner@example.com")
        attacker = self._user("attacker@example.com")
        stream_id = self._start_stream(owner)
        attacker_headers = self._auth_headers(attacker)

        read = self.client.get(
            f"/api/agents/chat/stream/{stream_id}?resume=true", headers=attacker_headers
        )
        self.assertEqual(read.status_code, 404)

        status = self.client.get(
            "/api/agents/chat/status/convo-owner", headers=attacker_headers
        )
        self.assertFalse(status.get_json()["active"])

        active = self.client.get("/api/agents/chat/active", headers=attacker_headers)
        self.assertEqual(active.get_json()["activeJobIds"], [])

        abort = self.client.post(
            "/api/agents/chat/abort",
            json={"streamId": stream_id},
            headers=attacker_headers,
        )
        self.assertEqual(abort.status_code, 404)

        # The owner's stream is untouched by all of the above.
        from api.routes import chat as chat_module

        state = chat_module._streams.pop(stream_id)
        self.assertFalse(state.get("done"))

    def test_owner_can_still_abort_their_own_stream(self):
        owner = self._user("owner@example.com")
        stream_id = self._start_stream(owner, conversation_id="convo-own")

        abort = self.client.post(
            "/api/agents/chat/abort",
            json={"streamId": stream_id},
            headers=self._auth_headers(owner),
        )
        self.assertEqual(abort.status_code, 200)
        from api.routes import chat as chat_module

        self.assertTrue(chat_module._streams.pop(stream_id)["done"])


class BalanceEndpointTests(ReviewFixTestBase):
    """The plan badge swaps pools based on this data — nulls must mean
    'could not read', never 'empty pool'."""

    def setUp(self):
        super().setUp()
        # The route caches per-key results in-process (60s success / 15s
        # failure); both tests here use the same fake key, so a leaked entry
        # would serve one test's payload to the other.
        from api.routes import user as user_routes

        user_routes._balance_cache.clear()

    def _get(self, user):
        return self.client.get("/api/balance", headers=self._auth_headers(user))

    def test_balance_carries_nash_pool_and_wallet(self):
        from api.routes import user as user_routes

        user = self._user("balance@example.com")
        user_service.update_user_field(user, "bbApiKey", "nash_key_x")

        class _Resp:
            status_code = 200

            @staticmethod
            def json():
                return {
                    "nash_credit_usd": 12.5,
                    "nash_allocation_usd": 25.0,
                    "paid_credit_usd": 3.0,
                    "subscription_credits_usd": 2.0,
                }

        with mock.patch.object(user_routes._balance_http, "get", return_value=_Resp()):
            resp = self._get(user)
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(data["nashCreditsUsd"], 12.5)
        self.assertEqual(data["nashAllocationUsd"], 25.0)
        self.assertEqual(data["backboardCreditsUsd"], 5.0)

    def test_balance_caches_wallet_reads_per_key(self):
        from api.routes import user as user_routes

        user = self._user("balance-cache@example.com")
        user_service.update_user_field(user, "bbApiKey", "nash_key_x")

        class _Resp:
            status_code = 200

            @staticmethod
            def json():
                return {"nash_credit_usd": 1.0, "nash_allocation_usd": 2.0}

        with mock.patch.object(
            user_routes._balance_http, "get", return_value=_Resp()
        ) as upstream:
            first = self._get(user)
            second = self._get(user)
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.get_json()["nashCreditsUsd"], 1.0)
        upstream.assert_called_once()

    def test_balance_nulls_when_backboard_unreachable(self):
        from api.routes import user as user_routes

        user = self._user("balance2@example.com")
        user_service.update_user_field(user, "bbApiKey", "nash_key_x")
        with mock.patch.object(
            user_routes._balance_http, "get", side_effect=RuntimeError("down")
        ):
            resp = self._get(user)
        self.assertEqual(resp.status_code, 200)
        self.assertIsNone(resp.get_json()["nashCreditsUsd"])

    def test_balance_failure_preserves_last_good_value(self):
        import hashlib
        import time as time_module

        from api.routes import user as user_routes

        user = self._user("balance3@example.com")
        user_service.update_user_field(user, "bbApiKey", "nash_key_x")

        class _Resp:
            status_code = 200

            @staticmethod
            def json():
                return {"nash_credit_usd": 12.5, "nash_allocation_usd": 25.0}

        with mock.patch.object(user_routes._balance_http, "get", return_value=_Resp()):
            self._get(user)

        # Expire the good entry, then fail the upstream: the response must
        # keep the last-known value instead of blanking to nulls. The route
        # keys on the SESSION's decrypted key (key-<id>), not the user row's
        # bbApiKey fallback.
        cache_key = hashlib.sha256(f"key-{user['id']}".encode("utf-8")).hexdigest()
        ts, payload, ok = user_routes._balance_cache[cache_key]
        user_routes._balance_cache[cache_key] = (
            time_module.monotonic() - user_routes._BALANCE_CACHE_TTL_SEC - 1,
            payload,
            ok,
        )
        with mock.patch.object(
            user_routes._balance_http, "get", side_effect=RuntimeError("blip")
        ) as upstream:
            resp = self._get(user)
        upstream.assert_called_once()
        self.assertEqual(resp.get_json()["nashCreditsUsd"], 12.5)

    def test_invalidate_balance_cache_forces_next_read_upstream(self):
        from api.routes import user as user_routes

        user = self._user("balance4@example.com")
        user_service.update_user_field(user, "bbApiKey", "nash_key_x")

        class _Resp:
            status_code = 200

            @staticmethod
            def json():
                return {"nash_credit_usd": 1.0, "nash_allocation_usd": 2.0}

        with mock.patch.object(
            user_routes._balance_http, "get", return_value=_Resp()
        ) as upstream:
            self._get(user)
            user_routes.invalidate_balance_cache(f"key-{user['id']}")
            self._get(user)
        self.assertEqual(upstream.call_count, 2)

    def test_balance_cache_bound_clears_at_cap(self):
        from api.routes import user as user_routes

        user = self._user("balance5@example.com")
        user_service.update_user_field(user, "bbApiKey", "nash_key_x")

        class _Resp:
            status_code = 200

            @staticmethod
            def json():
                return {"nash_credit_usd": 1.0, "nash_allocation_usd": 2.0}

        for i in range(3):
            user_routes._balance_cache[f"filler-{i}"] = (0.0, {}, True)
        with mock.patch.object(user_routes, "_BALANCE_CACHE_MAX_ENTRIES", 3), \
                mock.patch.object(user_routes._balance_http, "get", return_value=_Resp()):
            self._get(user)
        self.assertEqual(len(user_routes._balance_cache), 1)


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
