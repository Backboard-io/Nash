"""model_catalog_service: one global snapshot, SWR refresh, persistence.

Backboard is stubbed either at ``_fetch_catalog_data`` (behavioral tests) or
at ``_http.get`` (pagination tests) — the same seam pattern the balance tests
use for ``user_routes._balance_http.get``. Persistence tests run against moto
via the same fixture shape as ReviewFixTestBase.
"""

import gzip
import json
import threading
import time
import unittest
from unittest import mock

from moto import mock_aws

from api.config import settings
from api.services import model_catalog_service as catalog
from api.services import state_service


def _wait_for(cond, timeout=3.0, interval=0.01):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if cond():
            return True
        time.sleep(interval)
    return cond()


SAMPLE_YAML = {
    "endpoints": {
        "custom": [
            {
                "name": "OpenAI",
                "models": {"default": ["openai/gpt-4.1"], "fetch": False},
                "selectorTiers": {"fast": ["openai/gpt-4.1"], "powerful": ["openai/stale-id"]},
            },
        ]
    }
}


def _sample_data(extra_model: str | None = None):
    """A minimal valid 5-tuple for _fetch_catalog_data stubs."""
    ids = ["openai/gpt-4.1", "openai/gpt-4.1-mini"]
    if extra_model:
        ids.append(extra_model)
    provider_catalog = {"openai": list(ids)}
    pricing = {ids[0]: {"inputCostPer1mTokens": 2.5, "outputCostPer1mTokens": 10.0, "overageCostPer1mTokens": 10.0}}
    llm_caps = {model_id: {"supports_tools": True} for model_id in ids}
    llm_caps["anthropic/claude-x"] = {"supports_tools": None}  # unfiltered: non-yaml provider stays
    image_caps = {"openrouter/gemini-image": {"supports_vision": True}}
    providers = ["openai", "anthropic"]
    return provider_catalog, pricing, llm_caps, image_caps, providers


class CatalogServiceBase(unittest.TestCase):
    def setUp(self):
        catalog.reset_for_tests()
        catalog._yaml_config = SAMPLE_YAML
        self.addCleanup(catalog.reset_for_tests)


class SnapshotBuildTests(CatalogServiceBase):
    def test_build_overlays_yaml_and_computes_bodies(self):
        snap = catalog._build_snapshot(
            *_sample_data(), source="backboard", fetched_at=time.time()
        )
        openai_models = snap.effective_config["endpoints"]["custom"][0]["models"]["default"]
        self.assertEqual(openai_models, ["openai/gpt-4.1", "openai/gpt-4.1-mini"])
        # Stale yaml tier id pruned; live-model tier kept.
        tiers = snap.effective_config["endpoints"]["custom"][0]["selectorTiers"]
        self.assertEqual(tiers, {"fast": ["openai/gpt-4.1"]})
        self.assertEqual(json.loads(snap.models_body.decode()), snap.models_payload)
        self.assertEqual(json.loads(snap.endpoints_body.decode()), snap.endpoints_payload)
        self.assertIn("anthropic/claude-x", snap.llm_caps)  # unfiltered caps

    def test_etag_stable_for_identical_data_and_changes_with_catalog(self):
        one = catalog._build_snapshot(*_sample_data(), source="backboard", fetched_at=1.0)
        two = catalog._build_snapshot(*_sample_data(), source="backboard", fetched_at=99.0)
        self.assertEqual(one.etag, two.etag)  # content hash, not time/generation
        changed = catalog._build_snapshot(
            *_sample_data(extra_model="openai/gpt-5"), source="backboard", fetched_at=1.0
        )
        self.assertNotEqual(one.etag, changed.etag)


class ColdAndProvisionalTests(CatalogServiceBase):
    def test_keyless_never_fetches_and_serves_yaml(self):
        with mock.patch.object(catalog, "_fetch_catalog_data") as fetch:
            cfg = catalog.effective_config(None)
            self.assertIs(cfg, SAMPLE_YAML)
            self.assertEqual(catalog.llm_caps(""), {})
            catalog.ensure_refresh("")
        fetch.assert_not_called()
        self.assertIsNone(catalog.snapshot())

    def test_cold_fill_installs_snapshot_synchronously(self):
        with mock.patch.object(
            catalog, "_fetch_catalog_data", return_value=_sample_data()
        ) as fetch, mock.patch.object(catalog, "_persist") as persist:
            cfg = catalog.effective_config("key-a")
        fetch.assert_called_once_with("key-a")
        persist.assert_called_once()
        snap = catalog.snapshot()
        self.assertIsNotNone(snap)
        self.assertEqual(snap.source, "backboard")
        self.assertIs(cfg, snap.effective_config)

    def test_cold_fill_failure_serves_yaml_and_negative_caches(self):
        with mock.patch.object(
            catalog, "_fetch_catalog_data", side_effect=RuntimeError("down")
        ) as fetch:
            first = catalog.effective_config("key-a")
            second = catalog.effective_config("key-a")  # inside fail window: no re-fetch
        self.assertIs(first, SAMPLE_YAML)
        self.assertIs(second, SAMPLE_YAML)
        fetch.assert_called_once()
        self.assertIsNone(catalog.snapshot())

    def test_empty_catalog_is_a_failure_and_installs_nothing(self):
        empty_pages = mock.Mock()
        empty_pages.raise_for_status = mock.Mock()
        empty_pages.json = mock.Mock(
            side_effect=[{"providers": ["openai"]}, {"models": [], "total": 0}]
        )
        with mock.patch.object(catalog._http, "get", return_value=empty_pages):
            cfg = catalog.effective_config("key-a")
        self.assertIs(cfg, SAMPLE_YAML)
        self.assertIsNone(catalog.snapshot())


class RefreshTests(CatalogServiceBase):
    def _install_stale(self):
        snap = catalog._build_snapshot(
            *_sample_data(), source="backboard", fetched_at=time.time() - 10
        )
        catalog._install(snap)
        catalog._next_refresh_at = 0.0  # force "past refresh-after"
        return snap

    def test_stale_served_instantly_while_single_flight_refresh_replaces(self):
        old = self._install_stale()
        release = threading.Event()
        calls = []

        def slow_fetch(api_key):
            calls.append(api_key)
            release.wait(timeout=3)
            return _sample_data(extra_model="openai/gpt-5")

        with mock.patch.object(catalog, "_fetch_catalog_data", side_effect=slow_fetch), \
                mock.patch.object(catalog, "_persist"):
            first = catalog.effective_config("key-a")   # serves stale, spawns refresh
            second = catalog.effective_config("key-b")  # single-flight: no second spawn
            self.assertIs(first, old.effective_config)
            self.assertIs(second, old.effective_config)
            release.set()
            self.assertTrue(_wait_for(lambda: not catalog._refreshing))
        self.assertEqual(calls, ["key-a"])
        self.assertIn("openai/gpt-5", catalog.snapshot().llm_caps)

    def test_failed_refresh_keeps_snapshot_and_negative_caches(self):
        old = self._install_stale()
        with mock.patch.object(
            catalog, "_fetch_catalog_data", side_effect=RuntimeError("down")
        ) as fetch:
            catalog.ensure_refresh("key-a")
            self.assertTrue(_wait_for(lambda: not catalog._refreshing))
            catalog.ensure_refresh("key-a")  # inside fail window: no new spawn
            self.assertTrue(_wait_for(lambda: not catalog._refreshing))
        self.assertEqual(fetch.call_count, 1)
        self.assertIs(catalog.snapshot(), old)

    def test_failed_thread_spawn_releases_flag_and_negative_caches(self):
        self._install_stale()
        with mock.patch.object(
            catalog.threading, "Thread", side_effect=RuntimeError("no threads")
        ):
            catalog.ensure_refresh("key-a")  # must not raise
        self.assertFalse(catalog._refreshing)
        self.assertGreater(catalog._fail_at, float("-inf"))

    def test_fresh_snapshot_skips_refresh(self):
        snap = catalog._build_snapshot(
            *_sample_data(), source="backboard", fetched_at=time.time()
        )
        catalog._install(snap)
        with mock.patch.object(catalog, "_fetch_catalog_data") as fetch:
            self.assertIs(catalog.llm_caps("key-a"), snap.llm_caps)
            self.assertIs(catalog.image_caps("key-a"), snap.image_caps)
        fetch.assert_not_called()


class PaginationTests(CatalogServiceBase):
    def test_llm_pagination_is_total_driven(self):
        class DummyResp:
            def __init__(self, payload):
                self._payload = payload

            def raise_for_status(self):
                return None

            def json(self):
                return self._payload

        def fake_get(url, params=None, headers=None):
            if url.endswith("/models/providers"):
                return DummyResp({"providers": ["openai"]})
            if url.endswith("/models/image/all"):
                return DummyResp({"models": [], "total": 0})
            skip = params["skip"]
            page_one = [
                {"provider": "openai", "name": "m-0", "supports_tools": True},
                {"provider": "openai", "name": "m-1", "supports_tools": True},
            ]
            page_two = [{"provider": "openai", "name": "m-2", "supports_tools": False}]
            if skip == 0:
                return DummyResp({"models": page_one, "total": 3})
            if skip == 2:
                return DummyResp({"models": page_two, "total": 3})
            raise AssertionError(f"unexpected skip={skip}")

        with mock.patch.object(catalog._http, "get", side_effect=fake_get):
            provider_catalog, _, llm_caps, _, providers = catalog._fetch_catalog_data("k")
        self.assertEqual(providers, ["openai"])
        self.assertEqual(len(llm_caps), 3)
        self.assertEqual(provider_catalog["openai"], ["openai/m-0", "openai/m-1", "openai/m-2"])

    def test_image_fetch_failure_is_non_fatal(self):
        class DummyResp:
            def __init__(self, payload):
                self._payload = payload

            def raise_for_status(self):
                return None

            def json(self):
                return self._payload

        def fake_get(url, params=None, headers=None):
            if url.endswith("/models/providers"):
                return DummyResp({"providers": ["openai"]})
            if url.endswith("/models/image/all"):
                raise RuntimeError("image endpoint down")
            return DummyResp(
                {"models": [{"provider": "openai", "name": "m", "supports_tools": True}], "total": 1}
            )

        with mock.patch.object(catalog._http, "get", side_effect=fake_get):
            _, _, llm_caps, image_caps, _ = catalog._fetch_catalog_data("k")
        self.assertEqual(len(llm_caps), 1)
        self.assertEqual(image_caps, {})


class PersistenceTests(CatalogServiceBase):
    def setUp(self):
        super().setUp()
        self.mock = mock_aws()
        self.mock.start()
        state_service.ensure_state_table()
        self.addCleanup(self.mock.stop)

    def test_round_trip_preserves_floats_and_marks_stale_by_ttl(self):
        stale_at = time.time() - settings.model_catalog_ttl_sec - 600
        snap = catalog._build_snapshot(*_sample_data(), source="backboard", fetched_at=stale_at)
        catalog._persist(snap)

        catalog.reset_for_tests()
        catalog._yaml_config = SAMPLE_YAML
        self.assertTrue(catalog.load_persisted_snapshot())
        restored = catalog.snapshot()
        self.assertEqual(restored.source, "persisted")
        self.assertEqual(restored.etag, snap.etag)
        self.assertEqual(
            restored.pricing["openai/gpt-4.1"]["inputCostPer1mTokens"], 2.5
        )
        # Past-TTL restore is due immediately: the first keyed touch refreshes.
        with mock.patch.object(
            catalog, "_fetch_catalog_data", return_value=_sample_data()
        ) as fetch, mock.patch.object(catalog, "_persist"):
            catalog.ensure_refresh("key-a")
            self.assertTrue(_wait_for(lambda: not catalog._refreshing))
        fetch.assert_called_once()

    def test_fresh_persisted_snapshot_is_not_immediately_refreshed(self):
        snap = catalog._build_snapshot(*_sample_data(), source="backboard", fetched_at=time.time())
        catalog._persist(snap)
        catalog.reset_for_tests()
        catalog._yaml_config = SAMPLE_YAML
        self.assertTrue(catalog.load_persisted_snapshot())
        with mock.patch.object(catalog, "_fetch_catalog_data") as fetch:
            catalog.ensure_refresh("key-a")
        fetch.assert_not_called()

    def test_oversized_snapshot_skips_persist_with_warning(self):
        snap = catalog._build_snapshot(*_sample_data(), source="backboard", fetched_at=time.time())
        with mock.patch.object(catalog, "_PERSIST_MAX_COMPRESSED_BYTES", 10):
            with self.assertLogs(catalog.logger, level="WARNING"):
                catalog._persist(snap)
        self.assertIsNone(state_service.catalog_snapshot.get())

    def test_unknown_schema_row_is_ignored(self):
        state_service.catalog_snapshot.put(
            {"data": gzip.compress(b"{}"), "schema": 999, "etag": "x"}
        )
        self.assertFalse(catalog.load_persisted_snapshot())
        self.assertIsNone(catalog.snapshot())

    def test_missing_row_returns_false(self):
        self.assertFalse(catalog.load_persisted_snapshot())


if __name__ == "__main__":
    unittest.main()
