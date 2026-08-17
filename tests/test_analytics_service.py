from __future__ import annotations

import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from unittest import mock

from moto import mock_aws

from api.services import analytics_service, state_service, user_service


class AnalyticsServiceTests(unittest.TestCase):
    def setUp(self):
        self._mock = mock_aws()
        self._mock.start()
        state_service.ensure_state_table()

    def tearDown(self):
        self._mock.stop()

    def _user(self, email: str) -> dict:
        return user_service.create_user(
            email=email,
            name=email.split("@")[0].title(),
            provider="backboard",
        )

    def test_personal_record_merges_same_day_and_costs_unknown_models_as_zero(self):
        user = self._user("owner@example.com")

        analytics_service.record_generation_analytics(
            user_id=user["id"],
            model_name="openai/gpt-4.1",
            input_tokens=1000,
            output_tokens=1000,
            total_tokens=2000,
        )
        analytics_service.record_generation_analytics(
            user_id=user["id"],
            model_name="unknown/free-model",
            input_tokens=25,
            output_tokens=25,
            total_tokens=50,
        )

        today = datetime.now(timezone.utc).date().isoformat()
        row = state_service.get_item(
            state_service.user_pk(user["id"]),
            f"{state_service.SK_ANALYTICS_PREFIX}{today}",
        )
        self.assertEqual(row["inputTokens"], 1025)
        self.assertEqual(row["outputTokens"], 1025)
        self.assertEqual(row["totalTokens"], 2050)
        self.assertEqual(row["messageCount"], 2)
        self.assertEqual(row["creditUsdMicros"], 10000)
        self.assertEqual(row["modelCounts"]["openai/gpt-4.1"], 2000)
        self.assertEqual(row["modelCounts"]["unknown/free-model"], 50)

        payload = analytics_service.get_personal_analytics(user["id"])
        self.assertEqual(payload["summary"]["totalTokens"], 2050)
        self.assertEqual(payload["summary"]["messageCount"], 2)
        self.assertEqual(payload["summary"]["mainModel"], "openai/gpt-4.1")
        self.assertEqual(len(payload["activity"]), analytics_service.ANALYTICS_DAYS)
        self.assertEqual(payload["activity"][-1]["date"], today)

    def test_concurrent_generation_updates_do_not_lose_usage(self):
        user = self._user("concurrent@example.com")

        def record(_index: int) -> None:
            analytics_service.record_generation_analytics(
                user_id=user["id"],
                model_name="openai/gpt-4.1",
                input_tokens=10,
                output_tokens=20,
                total_tokens=30,
            )

        with ThreadPoolExecutor(max_workers=8) as pool:
            list(pool.map(record, range(8)))

        today = datetime.now(timezone.utc).date().isoformat()
        row = state_service.get_item(
            state_service.user_pk(user["id"]),
            f"{state_service.SK_ANALYTICS_PREFIX}{today}",
        )
        self.assertEqual(row["messageCount"], 8)
        self.assertEqual(row["inputTokens"], 80)
        self.assertEqual(row["outputTokens"], 160)
        self.assertEqual(row["totalTokens"], 240)

    def test_personal_analytics_returns_empty_payload_when_row_query_fails(self):
        user = self._user("owner@example.com")

        with mock.patch.object(
            analytics_service.state_service,
            "query_prefix",
            side_effect=RuntimeError("state table unavailable"),
        ):
            payload = analytics_service.get_personal_analytics(user["id"])

        self.assertEqual(payload["summary"]["totalTokens"], 0)
        self.assertEqual(payload["summary"]["messageCount"], 0)
        self.assertEqual(len(payload["activity"]), analytics_service.ANALYTICS_DAYS)
        self.assertEqual(payload["models"], [])

    def test_selector_is_personal_only(self):
        user = self._user("owner@example.com")

        payload = analytics_service.get_personal_analytics(user["id"])

        self.assertEqual(payload["selector"]["personal"]["name"], "Personal")
        self.assertEqual(payload["selector"]["organizations"], [])


class AnalyticsRouteTests(unittest.TestCase):
    def setUp(self):
        self._mock = mock_aws()
        self._mock.start()
        from api.app import create_app
        from api.services import dynamo_service

        state_service.ensure_state_table()
        dynamo_service.ensure_table()
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

    def _headers(self, user: dict) -> dict:
        from api.services import dynamo_service, encryption_service

        session_key = f"nash_sk_{user['id'].replace('@', '_')}"
        dynamo_service.store_session(
            session_key=session_key,
            encrypted_key=encryption_service.encrypt_key(f"key-{user['id']}"),
            provider="backboard",
            user_id=user["id"],
        )
        return {"X-Session-Key": session_key, "Sec-Fetch-Site": "same-origin"}

    def test_personal_analytics_route_returns_summary_and_selector(self):
        user = self._user("owner@example.com")
        analytics_service.record_generation_analytics(
            user_id=user["id"],
            model_name="openai/gpt-4.1",
            input_tokens=10,
            output_tokens=20,
            total_tokens=30,
        )

        resp = self.client.get("/api/analytics", headers=self._headers(user))

        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(data["scope"], "personal")
        self.assertEqual(data["summary"]["totalTokens"], 30)
        self.assertEqual(data["selector"]["personal"]["name"], "Personal")
