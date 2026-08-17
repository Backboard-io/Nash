from __future__ import annotations

import time
from copy import deepcopy

import pytest
from flask import Flask

import api.routes.config_routes as config_routes
import api.routes.init as init_routes
import api.services.model_catalog_service as catalog_service


@pytest.fixture
def catalog_yaml():
    """Reset the process-wide catalog service and pin its yaml config."""

    def _set(config: dict) -> None:
        catalog_service.reset_for_tests()
        catalog_service._yaml_config = config

    yield _set
    catalog_service.reset_for_tests()


def _catalog_data_for(catalog: dict[str, list[str]], pricing: dict | None = None):
    """Build a _fetch_catalog_data 5-tuple from a provider->ids map."""
    llm_caps = {model_id: {"supports_tools": True} for ids in catalog.values() for model_id in ids}
    return catalog, pricing or {}, llm_caps, {}, sorted(catalog)


def _sample_config() -> dict:
    return {
        "endpoints": {
            "custom": [
                {
                    "name": "OpenAI",
                    "models": {
                        "default": [
                            "openai/gpt-4o",
                            "openai/stale-model",
                        ],
                        "fetch": False,
                    },
                    "selectorTiers": {
                        "fast": ["openai/gpt-4o", "openai/stale-model"],
                        "powerful": ["openai/gpt-5.5"],
                    },
                    "titleModel": "openai/gpt-4o",
                    "modelDisplayLabel": "OpenAI",
                },
                {
                    "name": "Other",
                    "models": {"default": ["other/model"]},
                },
                {
                    "name": "Cerebras",
                    "models": {"default": ["cerebras/qwen/qwen3-235b-a22b-2507"]},
                },
            ],
        },
        "modelPricing": {
            "openai/stale-model": {
                "inputCostPer1mTokens": 1,
                "outputCostPer1mTokens": 1,
                "overageCostPer1mTokens": 1,
            },
        },
    }


def test_overlay_live_models_replaces_yaml_models_and_prunes_tiers():
    config = _sample_config()
    original = deepcopy(config)
    pricing = {
        "openai/gpt-5.5": {
            "inputCostPer1mTokens": 2,
            "outputCostPer1mTokens": 8,
            "overageCostPer1mTokens": 8,
        },
    }

    merged = config_routes._overlay_live_models(
        config,
        {"openai": ["openai/gpt-5.5", "openai/gpt-5-mini"]},
        pricing,
    )

    openai = merged["endpoints"]["custom"][0]
    assert openai["models"]["default"] == ["openai/gpt-5.5", "openai/gpt-5-mini"]
    assert openai["models"]["fetch"] is False
    assert openai["selectorTiers"] == {"powerful": ["openai/gpt-5.5"]}
    assert merged["modelPricing"] == pricing
    assert config == original


def test_build_models_response_rejects_missing_user_key(monkeypatch, catalog_yaml):
    catalog_yaml(_sample_config())
    monkeypatch.setattr(config_routes, "_request_api_key", lambda: "")

    with pytest.raises(ValueError, match="missing its Backboard API key"):
        config_routes._build_models_response()


def test_build_models_response_uses_authenticated_user_key(monkeypatch, catalog_yaml):
    catalog_yaml(_sample_config())
    monkeypatch.setattr(config_routes, "_request_api_key", lambda: "user-session-key")

    def fetch(api_key):
        assert api_key == "user-session-key"
        return _catalog_data_for({"openai": ["openai/gpt-5.5"]})

    monkeypatch.setattr(catalog_service, "_fetch_catalog_data", fetch)
    monkeypatch.setattr(catalog_service, "_persist", lambda snap: None)

    models = config_routes._build_models_response()

    assert [model["name"] for model in models["OpenAI"]] == ["openai/gpt-5.5"]


def test_build_models_response_falls_back_to_yaml_on_catalog_failure(monkeypatch, catalog_yaml):
    """A catalog outage degrades to the yaml provisional config — it no
    longer 500s the startup endpoints (the pre-service behavior raised)."""
    catalog_yaml(_sample_config())
    monkeypatch.setattr(config_routes, "_request_api_key", lambda: "invalid-user-key")
    monkeypatch.setattr(
        catalog_service,
        "_fetch_catalog_data",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(PermissionError("unauthorized")),
    )

    models = config_routes._build_models_response()

    # Yaml models pass through _sort_model_names (reversed, o-series last).
    assert [model["name"] for model in models["OpenAI"]] == [
        "openai/stale-model",
        "openai/gpt-4o",
    ]
    assert catalog_service.snapshot() is None


def _install_snapshot(catalog: dict[str, list[str]]):
    snap = catalog_service._build_snapshot(
        *_catalog_data_for(catalog), source="backboard", fetched_at=time.time()
    )
    catalog_service._install(snap)
    return snap


def test_models_route_serves_snapshot_body_with_etag(monkeypatch, catalog_yaml):
    catalog_yaml(_sample_config())
    snap = _install_snapshot({"openai": ["openai/gpt-5.5"]})

    app = Flask(__name__)
    with app.test_request_context():
        from flask import g
        g.bb_api_key = "user-key"
        resp = config_routes._catalog_route_response(
            "models_body", catalog_service.models_response
        )

    assert resp.status_code == 200
    assert resp.get_data() == snap.models_body
    assert resp.get_etag() == (snap.etag, False)
    assert resp.cache_control.no_cache

    # Revalidation with the (possibly compress-suffixed) validator -> empty 304.
    with app.test_request_context(headers={"If-None-Match": f'"{snap.etag}:br"'}):
        from flask import g
        g.bb_api_key = "user-key"
        resp304 = config_routes._catalog_route_response(
            "models_body", catalog_service.models_response
        )
    assert resp304.status_code == 304
    assert resp304.get_data() == b""


def test_models_route_provisional_has_no_etag(monkeypatch, catalog_yaml):
    catalog_yaml(_sample_config())
    monkeypatch.setattr(
        catalog_service,
        "_fetch_catalog_data",
        lambda *_a, **_k: (_ for _ in ()).throw(RuntimeError("down")),
    )

    app = Flask(__name__)
    with app.test_request_context():
        from flask import g
        g.bb_api_key = "user-key"
        resp = config_routes._catalog_route_response(
            "models_body", catalog_service.models_response
        )

    assert resp.status_code == 200
    assert resp.get_etag() == (None, None)
    assert resp.cache_control.no_cache
    names = [m["name"] for m in resp.get_json()["OpenAI"]]
    assert "openai/gpt-4o" in names  # yaml provisional content


def test_request_api_key_reads_authenticated_session():
    app = Flask(__name__)
    with app.test_request_context():
        from flask import g
        g.bb_api_key = "decrypted-user-key"
        assert config_routes._request_api_key() == "decrypted-user-key"


def test_models_endpoint_requires_authenticated_session():
    app = Flask(__name__)
    app.register_blueprint(config_routes.config_bp)

    response = app.test_client().get("/api/models")

    assert response.status_code == 401


def test_sort_model_names_keeps_o_series_models_at_bottom():
    assert config_routes._sort_model_names([
        "openai/gpt-5",
        "openai/o3",
        "openai/gpt-5.5",
        "openai/o4-mini",
    ]) == [
        "openai/gpt-5.5",
        "openai/gpt-5",
        "openai/o4-mini",
        "openai/o3",
    ]


def test_get_config_and_startup_config_are_api_key_only():
    app = Flask(__name__)
    with app.app_context():
        config_response = config_routes.get_config()
        config = config_response.get_json()

    startup = init_routes._get_startup_config()

    for payload in (config, startup):
        assert payload["apiKeyLoginEnabled"] is True
        assert payload["socialLogins"] == []
        assert payload["socialLoginEnabled"] is False
        assert payload["emailLoginEnabled"] is False
        assert payload["registrationEnabled"] is False
        assert payload["emailEnabled"] is False
