"""Process-wide Backboard model-catalog snapshot.

The Backboard catalog is GLOBAL: /models, /models/providers and
/models/image/all authenticate the caller and then return identical data for
every API key (verified against the Backboard source). This module therefore
holds exactly ONE immutable snapshot per process and replaces the three
per-API-key caches that used to live in config_routes.py and chat.py — the
per-key dimension cached identical data once per user and grew without bound.

Lifecycle:
  - ``load_persisted_snapshot()`` (create_app boot hook) restores the
    last-good snapshot from DynamoDB so a fresh deploy starts warm.
  - ``effective_config(api_key)`` serves the snapshot; with no snapshot at all
    it performs the one synchronous cold fill (first-ever boot), and if that
    fails it falls back to the yaml-derived provisional config — a catalog
    outage degrades the picker, it no longer 500s /api/init.
  - ``ensure_refresh(api_key)`` starts the single background refresh once the
    snapshot is past its refresh-after TTL. Failures negative-cache for
    ``model_catalog_fail_ttl_sec`` and never replace a good snapshot.

Credentials are never stored: every refresh borrows the key of the request
that triggered it (the catalog is global, so any authenticated key works).

Snapshot payload dicts are FROZEN BY CONTRACT: callers embed them in
responses but must never mutate them — that is what makes the zero-copy
serving safe.
"""

from __future__ import annotations

import copy
import gzip
import hashlib
import json
import logging
import os
import random
import threading
import time
from dataclasses import dataclass
from typing import Any

import httpx
import yaml

from api.config import settings
from api.services import state_service

logger = logging.getLogger(__name__)

FREE_TIER_PROVIDERS = {"Cohere", "Cerebras"}
MODEL_TIERS = ("free", "fast", "powerful")
ENABLED_CHAT_PROVIDERS = {
    "openai",
    "anthropic",
    "aws-bedrock",
    "openrouter",
    "xai",
    "google",
    "cohere",
    "cerebras",
}
ENDPOINT_ORDER = {
    "OpenAI": 0,
    "Anthropic": 1,
    "Google": 2,
    "xAI": 3,
    "AWS Bedrock": 4,
    "Cohere": 5,
    "Cerebras": 6,
    "OpenRouter": 7,
}

# /models accepts limit up to 15000; /models/image/all caps at 500.
_LLM_PAGE_LIMIT = 15000
_IMAGE_PAGE_LIMIT = 500

# One version stamp for the persisted row; bump when the persisted shape
# changes so an old row is ignored instead of misread.
_PERSIST_SCHEMA = 1
# DynamoDB items cap at 400KB; leave headroom for the non-blob attributes.
_PERSIST_MAX_COMPRESSED_BYTES = 350_000

# Pooled keep-alive client. follow_redirects restores urllib's behavior (the
# earlier urllib->httpx swap silently dropped redirect following).
_http = httpx.Client(
    timeout=settings.model_catalog_fetch_timeout_sec,
    follow_redirects=True,
)


@dataclass(frozen=True)
class CatalogSnapshot:
    fetched_at: float  # epoch seconds (persistable; NOT monotonic)
    source: str  # "backboard" | "persisted"
    catalog: dict[str, list[str]]  # provider -> ordered "provider/name" ids
    pricing: dict[str, dict[str, float]]
    providers: list[str]
    llm_caps: dict[str, dict]  # "provider/name" -> {"supports_tools": ...}
    image_caps: dict[str, dict]  # "provider/name" -> {"supports_vision": ...}
    effective_config: dict  # yaml overlaid with the live catalog
    models_payload: dict
    endpoints_payload: dict
    models_body: bytes
    endpoints_body: bytes
    etag: str  # content hash — stable across restarts/replicas


_yaml_config: dict | None = None
_snapshot: CatalogSnapshot | None = None
# Bookkeeping only — NEVER held across I/O.
_lock = threading.Lock()
# Serializes the one synchronous first-ever fetch so racing startup requests
# share a single upstream load (held across that fetch by design; it guards
# the cold path only and no hot path ever takes it).
_cold_fill_lock = threading.Lock()
_refreshing = False
_fail_at = float("-inf")  # monotonic; failure negative-cache
_next_refresh_at = 0.0  # epoch; fetched_at + ttl + jitter


# ---------------------------------------------------------------------------
# Yaml config + response shaping (moved verbatim from config_routes.py)
# ---------------------------------------------------------------------------


def load_yaml_config() -> dict:
    global _yaml_config
    if _yaml_config is not None:
        return _yaml_config

    yaml_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "librechat.yaml"
    )
    try:
        with open(yaml_path, "r") as f:
            _yaml_config = yaml.safe_load(f)
    except FileNotFoundError:
        _yaml_config = {}
    return _yaml_config


def _model_name(raw_model) -> str:
    return raw_model.get("name", "") if isinstance(raw_model, dict) else str(raw_model or "")


def _is_o_series_model(model_name: str) -> bool:
    basename = model_name.rsplit("/", 1)[-1].lower()
    return len(basename) >= 2 and basename[0] == "o" and basename[1].isdigit()


def _sort_model_names(raw_models: list) -> list:
    ordered = list(reversed(raw_models))
    return sorted(ordered, key=lambda raw_model: _is_o_series_model(_model_name(raw_model)))


def _endpoint_provider(endpoint: dict) -> str | None:
    for raw_model in endpoint.get("models", {}).get("default", []) or []:
        name = _model_name(raw_model)
        if "/" in name:
            return name.split("/", 1)[0]
    return None


def _configured_custom_endpoints(config: dict) -> list[dict]:
    return [
        endpoint
        for endpoint in config.get("endpoints", {}).get("custom", []) or []
        if _endpoint_provider(endpoint) in ENABLED_CHAT_PROVIDERS
    ]


def _configured_endpoint_providers(config: dict) -> set[str]:
    return {
        provider
        for endpoint in _configured_custom_endpoints(config)
        for provider in [_endpoint_provider(endpoint)]
        if provider
    }


def _prune_selector_tiers(endpoint: dict, allowed_models: set[str]) -> None:
    tiers = endpoint.get("selectorTiers", {})
    for tier_name, tier_models in list(tiers.items()):
        pruned = [m for m in tier_models if m in allowed_models]
        if pruned:
            tiers[tier_name] = pruned
        else:
            tiers.pop(tier_name, None)


def _pricing_entry(model: dict[str, Any]) -> dict[str, float] | None:
    input_cost = model.get("input_cost_per_1m_tokens")
    output_cost = model.get("output_cost_per_1m_tokens")
    if input_cost is None and output_cost is None:
        return None
    input_float = float(input_cost or 0)
    output_float = float(output_cost or 0)
    return {
        "inputCostPer1mTokens": input_float,
        "outputCostPer1mTokens": output_float,
        "overageCostPer1mTokens": output_float,
    }


def _overlay_live_models(
    config: dict, catalog: dict[str, list[str]], pricing: dict[str, dict[str, float]]
) -> dict:
    merged = copy.deepcopy(config)
    endpoints = merged.get("endpoints", {}).get("custom", []) or []
    kept: list[dict] = []
    for endpoint in endpoints:
        provider = _endpoint_provider(endpoint)
        live_models = catalog.get(provider or "")
        if not provider:
            kept.append(endpoint)
            continue
        if not live_models:
            # Backboard serves no models for this provider, so the yaml's
            # hardcoded ids are un-runnable: picking one guarantees a
            # Backboard error and the GPT-4.1 fallback. Hide the endpoint
            # rather than offer models that cannot work.
            logger.info(
                "Hiding endpoint %r: no live Backboard models for provider %r",
                endpoint.get("name", ""),
                provider,
            )
            continue
        endpoint.setdefault("models", {})
        endpoint["models"]["default"] = live_models
        endpoint["models"].setdefault("fetch", False)
        _prune_selector_tiers(endpoint, set(live_models))
        kept.append(endpoint)
    if endpoints:
        merged["endpoints"]["custom"] = kept
    if pricing:
        merged["modelPricing"] = dict(sorted(pricing.items()))
    return merged


def _extract_model_entries(endpoint_config: dict) -> list[dict]:
    raw_models = _sort_model_names(endpoint_config.get("models", {}).get("default", []))
    selector_tiers = endpoint_config.get("selectorTiers", {})

    normalized_tiers = {tier: set(selector_tiers.get(tier, [])) for tier in MODEL_TIERS}

    models = []
    for raw_model in raw_models:
        if isinstance(raw_model, dict):
            model_name = raw_model.get("name", "")
            explicit_tiers = raw_model.get("tiers", []) or []
        else:
            model_name = raw_model
            explicit_tiers = []

        if not model_name:
            continue

        tiers = set(explicit_tiers)
        for tier in MODEL_TIERS:
            if model_name in normalized_tiers[tier]:
                tiers.add(tier)

        model_entry = {"name": model_name}
        if tiers:
            model_entry["tiers"] = [tier for tier in MODEL_TIERS if tier in tiers]
        models.append(model_entry)

    return models


def build_endpoints_payload(cfg: dict) -> dict:
    custom_endpoints = sorted(
        _configured_custom_endpoints(cfg),
        key=lambda ep: ENDPOINT_ORDER.get(ep.get("name", ""), 100),
    )

    result = {}
    all_models = []
    for ep in custom_endpoints:
        name = ep.get("name", "")
        models = _sort_model_names(ep.get("models", {}).get("default", []))
        result[name] = {
            "type": "custom",
            "name": name,
            "modelDisplayLabel": ep.get("modelDisplayLabel", name),
            "models": models,
            "order": ENDPOINT_ORDER.get(name, 100),
            "titleConvo": ep.get("titleConvo", True),
            "titleModel": ep.get("titleModel", ""),
        }
        all_models.extend(models)

    result["agents"] = {
        "type": "agents",
        "name": "agents",
        "disableBuilder": False,
        "models": all_models or ["default"],
    }

    return result


def build_models_payload(cfg: dict) -> dict:
    custom_endpoints = sorted(
        _configured_custom_endpoints(cfg),
        key=lambda ep: ENDPOINT_ORDER.get(ep.get("name", ""), 100),
    )

    result = {}
    all_models = []
    for ep in custom_endpoints:
        name = ep.get("name", "")
        models = _extract_model_entries(ep)
        result[name] = models
        all_models.extend(models)

    result["agents"] = all_models or ["default"]
    return result


# ---------------------------------------------------------------------------
# Upstream fetch
# ---------------------------------------------------------------------------


def _request_json(path: str, api_key: str, params: dict | None = None) -> dict:
    base_url = (settings.backboard_api_url or "").rstrip("/")
    resp = _http.get(f"{base_url}{path}", params=params, headers={"X-API-Key": api_key})
    resp.raise_for_status()
    return resp.json()


def _request_paged(path: str, api_key: str, limit: int, params: dict | None = None) -> list[dict]:
    """Page through a Backboard list endpoint, driven by its ``total`` field."""
    items: list[dict] = []
    skip = 0
    while True:
        page_params = dict(params or {})
        page_params["skip"] = skip
        page_params["limit"] = limit
        payload = _request_json(path, api_key, params=page_params)
        page = payload.get("models") or []
        if not page:
            break
        items.extend(page)
        skip += len(page)
        total = int(payload.get("total") or 0)
        if total and skip >= total:
            break
    return items


def _fetch_catalog_data(
    api_key: str,
) -> tuple[dict[str, list[str]], dict[str, dict[str, float]], dict[str, dict], dict[str, dict], list[str]]:
    """Fetch the full global catalog: one LLM sweep, image models, providers.

    Raises on any LLM/providers failure and on an empty LLM catalog (a 200
    with zero models is an upstream glitch, not an authoritative "no models" —
    installing it would blank the picker). An image-catalog failure is
    non-fatal: image consumers already treat an empty map as "unknown", which
    matches the previously independent image-cache failure semantics.
    """
    providers_payload = _request_json("/models/providers", api_key)
    providers = list(providers_payload.get("providers") or [])

    llm_models = _request_paged("/models", api_key, _LLM_PAGE_LIMIT, params={"model_type": "llm"})
    if not llm_models:
        raise RuntimeError("Backboard returned an empty model catalog")

    allowed_providers = _configured_endpoint_providers(load_yaml_config())

    catalog: dict[str, list[str]] = {}
    pricing: dict[str, dict[str, float]] = {}
    llm_caps: dict[str, dict] = {}
    for model in llm_models:
        provider = (model.get("provider") or "").strip()
        name = (model.get("name") or "").strip()
        if not provider or not name:
            continue
        model_id = f"{provider}/{name}"
        # Capabilities stay UNFILTERED: chat's model-spec resolver matches
        # against the whole catalog, not just the pickers' providers.
        llm_caps[model_id] = {"supports_tools": model.get("supports_tools")}
        if provider in allowed_providers:
            catalog.setdefault(provider, []).append(model_id)
            pricing_entry = _pricing_entry(model)
            if pricing_entry is not None:
                pricing[model_id] = pricing_entry
    catalog = {provider: list(dict.fromkeys(ids)) for provider, ids in catalog.items()}

    image_caps: dict[str, dict] = {}
    try:
        image_models = _request_paged("/models/image/all", api_key, _IMAGE_PAGE_LIMIT)
        for model in image_models:
            if model.get("supports_image_output") is False:
                continue
            provider = (model.get("provider") or "").strip()
            name = (model.get("name") or "").strip()
            if not provider or not name:
                continue
            image_caps[f"{provider}/{name}"] = {
                "supports_vision": model.get("supports_vision"),
            }
    except Exception:
        logger.warning("[catalog] image-model fetch failed (non-fatal)", exc_info=True)

    return catalog, pricing, llm_caps, image_caps, providers


# ---------------------------------------------------------------------------
# Snapshot build / install / persistence
# ---------------------------------------------------------------------------


def _build_snapshot(
    catalog: dict[str, list[str]],
    pricing: dict[str, dict[str, float]],
    llm_caps: dict[str, dict],
    image_caps: dict[str, dict],
    providers: list[str],
    *,
    source: str,
    fetched_at: float,
) -> CatalogSnapshot:
    effective = _overlay_live_models(load_yaml_config(), catalog, pricing)
    models_payload = build_models_payload(effective)
    endpoints_payload = build_endpoints_payload(effective)
    models_body = json.dumps(models_payload, separators=(",", ":")).encode("utf-8")
    endpoints_body = json.dumps(endpoints_payload, separators=(",", ":")).encode("utf-8")
    etag = hashlib.sha256(models_body + b"\0" + endpoints_body).hexdigest()[:16]
    return CatalogSnapshot(
        fetched_at=fetched_at,
        source=source,
        catalog=catalog,
        pricing=pricing,
        providers=providers,
        llm_caps=llm_caps,
        image_caps=image_caps,
        effective_config=effective,
        models_payload=models_payload,
        endpoints_payload=endpoints_payload,
        models_body=models_body,
        endpoints_body=endpoints_body,
        etag=etag,
    )


def _install(snap: CatalogSnapshot) -> None:
    global _snapshot, _next_refresh_at
    with _lock:
        _snapshot = snap
        # Jitter so replicas warmed by the same deploy don't all refresh in
        # the same second an hour later.
        _next_refresh_at = (
            snap.fetched_at + settings.model_catalog_ttl_sec + random.uniform(0, 300)
        )


def _persist(snap: CatalogSnapshot) -> None:
    """Store the raw catalog data (not the derived config) as gzip JSON bytes.

    JSON-string persistence sidesteps boto3's float rejection; gzip keeps the
    row far below DynamoDB's 400KB item cap. A persistence failure only costs
    the next deploy its warm start — never the refresh itself.
    """
    try:
        raw = json.dumps(
            {
                "fetched_at": snap.fetched_at,
                "catalog": snap.catalog,
                "pricing": snap.pricing,
                "llm_caps": snap.llm_caps,
                "image_caps": snap.image_caps,
                "providers": snap.providers,
            },
            separators=(",", ":"),
        ).encode("utf-8")
        blob = gzip.compress(raw)
        if len(blob) > _PERSIST_MAX_COMPRESSED_BYTES:
            logger.warning(
                "[catalog] snapshot too large to persist (%d bytes compressed); "
                "deploys will cold-fetch until the catalog shrinks",
                len(blob),
            )
            return
        state_service.catalog_snapshot.put(
            {"data": blob, "schema": _PERSIST_SCHEMA, "etag": snap.etag}
        )
    except Exception:
        logger.warning("[catalog] snapshot persist failed (non-fatal)", exc_info=True)


def load_persisted_snapshot() -> bool:
    """Boot hook: restore the last-good snapshot from DynamoDB. Never raises.

    A restored snapshot past its TTL installs as stale — served instantly and
    refreshed by the first keyed request — never trusted as fresh.
    """
    try:
        row = state_service.catalog_snapshot.get()
        if not row or row.get("schema") != _PERSIST_SCHEMA or not row.get("data"):
            return False
        raw = gzip.decompress(bytes(row["data"]))
        data = json.loads(raw.decode("utf-8"))
        snap = _build_snapshot(
            data["catalog"],
            data["pricing"],
            data["llm_caps"],
            data["image_caps"],
            data["providers"],
            source="persisted",
            fetched_at=float(data["fetched_at"]),
        )
        _install(snap)
        return True
    except Exception:
        logger.warning("[catalog] persisted snapshot load failed (non-fatal)", exc_info=True)
        return False


# ---------------------------------------------------------------------------
# Refresh machinery
# ---------------------------------------------------------------------------


def _refresh(api_key: str) -> None:
    """Background refresh. Failure keeps the existing snapshot and
    negative-caches; only a strictly better (fresh, non-empty) catalog ever
    replaces what is installed."""
    global _fail_at, _refreshing
    try:
        data = _fetch_catalog_data(api_key)
        snap = _build_snapshot(*data, source="backboard", fetched_at=time.time())
        _install(snap)
        _persist(snap)
        logger.info(
            "[catalog] refreshed: %d providers, %d llm models, %d image models",
            len(snap.catalog),
            len(snap.llm_caps),
            len(snap.image_caps),
        )
    except Exception:
        with _lock:
            _fail_at = time.monotonic()
        logger.warning("[catalog] refresh failed; serving existing snapshot", exc_info=True)
    finally:
        with _lock:
            _refreshing = False


def ensure_refresh(api_key: str) -> None:
    """Kick the single background refresh if one is due. Never blocks.

    No-op when keyless, when a refresh is already running, during the failure
    negative-cache window, or while the snapshot is inside its refresh-after
    TTL. The caller's key rides the refresh thread — nothing is stored.
    """
    global _refreshing, _fail_at
    if not api_key:
        return
    snap = _snapshot
    with _lock:
        if _refreshing:
            return
        if (time.monotonic() - _fail_at) < settings.model_catalog_fail_ttl_sec:
            return
        if snap is not None and time.time() < _next_refresh_at:
            return
        _refreshing = True
    try:
        threading.Thread(
            target=_refresh,
            args=(api_key,),
            name="model-catalog-refresh",
            daemon=True,
        ).start()
    except Exception:
        # A failed spawn must release the claim or this process would never
        # refresh again (the wedge the old per-key single-flight had). It is
        # treated like a failed refresh — negative-cached, never raised into
        # the serving path that merely tried to kick a refresh.
        with _lock:
            _refreshing = False
            _fail_at = time.monotonic()
        logger.warning("[catalog] refresh thread spawn failed", exc_info=True)


# ---------------------------------------------------------------------------
# Public accessors
# ---------------------------------------------------------------------------


def snapshot() -> CatalogSnapshot | None:
    return _snapshot


def effective_config(api_key: str | None = None) -> dict:
    """The live-overlaid endpoint config, without ever blocking a warm path.

    Order: installed snapshot (kicking a background refresh when due) ->
    synchronous first-ever cold fill (keyed callers only; racing startup
    requests share one fetch via _cold_fill_lock) -> yaml provisional.
    The provisional is served, never installed, never persisted.
    """
    global _fail_at
    snap = _snapshot
    if snap is not None:
        if api_key:
            ensure_refresh(api_key)
        return snap.effective_config

    if api_key and (time.monotonic() - _fail_at) >= settings.model_catalog_fail_ttl_sec:
        with _cold_fill_lock:
            snap = _snapshot
            if snap is not None:
                return snap.effective_config
            try:
                data = _fetch_catalog_data(api_key)
            except Exception:
                with _lock:
                    _fail_at = time.monotonic()
                logger.warning(
                    "[catalog] cold catalog fetch failed; serving yaml provisional config",
                    exc_info=True,
                )
                return load_yaml_config()
            snap = _build_snapshot(*data, source="backboard", fetched_at=time.time())
            _install(snap)
            _persist(snap)
            logger.info(
                "[catalog] cold fill: %d providers, %d llm models",
                len(snap.catalog),
                len(snap.llm_caps),
            )
            return snap.effective_config

    return load_yaml_config()


def models_response(api_key: str | None = None) -> dict:
    snap = _snapshot
    if snap is not None:
        if api_key:
            ensure_refresh(api_key)
        return snap.models_payload
    return build_models_payload(effective_config(api_key))


def endpoints_response(api_key: str | None = None) -> dict:
    snap = _snapshot
    if snap is not None:
        if api_key:
            ensure_refresh(api_key)
        return snap.endpoints_payload
    return build_endpoints_payload(effective_config(api_key))


def llm_caps(api_key: str) -> dict[str, dict]:
    """Chat-path capability map. {} until the first snapshot exists — callers
    already treat an empty map as "unknown, pass through"."""
    if api_key:
        ensure_refresh(api_key)
    snap = _snapshot
    return snap.llm_caps if snap is not None else {}


def image_caps(api_key: str) -> dict[str, dict]:
    if api_key:
        ensure_refresh(api_key)
    snap = _snapshot
    return snap.image_caps if snap is not None else {}


def reset_for_tests() -> None:
    global _yaml_config, _snapshot, _refreshing, _fail_at, _next_refresh_at
    with _lock:
        _yaml_config = None
        _snapshot = None
        _refreshing = False
        _fail_at = float("-inf")
        _next_refresh_at = 0.0
