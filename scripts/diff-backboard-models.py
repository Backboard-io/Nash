#!/usr/bin/env python3
"""Sync librechat.yaml with Backboard's live model catalog.

This script paginates Backboard's `/api/models/provider/{provider}` endpoint
for every provider exposed by the account's API key and uses the result as
the source of truth for the model lists in `librechat.yaml`.

Modes
-----
  --check (default): show the diff between librechat.yaml and Backboard. Exit
                     code 1 if drift is detected, 0 otherwise. Does not write.
  --write          : rewrite librechat.yaml so each endpoint's
                     `models.default` matches the live provider catalog.
                     Also rebuilds `modelPricing` from live pricing fields and
                     prunes stale entries from each endpoint's `selectorTiers`.
                     Curated keys (`name`, `apiKey`, `baseURL`, `titleConvo`,
                     `titleModel`, `modelDisplayLabel`, `models.fetch`) are
                     preserved.

Usage
-----
    BACKBOARD_API_KEY=... python scripts/diff-backboard-models.py
    BACKBOARD_API_KEY=... python scripts/diff-backboard-models.py --write
    python scripts/diff-backboard-models.py --check --output /tmp/models.txt

Notes
-----
- `BACKBOARD_API_KEY` is required (loaded from env or repo .env via
  python-dotenv when available).
- Only chat models are synced. Embedding models are filtered out by inspecting
  `model.model_type` and skipping anything tagged as embedding.
- An endpoint whose first model entry has no `provider/` prefix is skipped and
  reported as a warning, rather than silently overwritten.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path
from typing import Any, Iterable

import yaml

try:
    from dotenv import load_dotenv
except ImportError:  # python-dotenv is in pyproject.toml but stay defensive
    load_dotenv = None  # type: ignore[assignment]

from backboard import BackboardClient
from backboard.models import Model

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_YAML = REPO_ROOT / "librechat.yaml"
DEFAULT_TEXT_OUTPUT = REPO_ROOT / "backboard-models.txt"

PAGE_SIZE = 500
EMBEDDING_TYPE_TOKENS = {"embedding", "embeddings"}

# Models Backboard exposes in its catalog but that cannot be invoked through
# its `/threads/{thread_id}/messages` chat path. OpenAI gates these behind the
# `/v1/responses` endpoint instead of `/v1/chat/completions`, so they fail at
# runtime with "This is not a chat model and thus not supported in the
# v1/chat/completions endpoint." Backboard's model API does not flag them, so
# we filter at sync time. Re-evaluate when Backboard adds Responses API
# support to its thread/message route.
RESPONSES_ONLY_MODELS: set[str] = {
    "openai/gpt-5-pro",
    "openai/gpt-5.2-pro",
    "openai/gpt-5.4-pro",
    "openai/gpt-5.5-pro",
    "openai/o1-pro",
    "openai/o3-pro",
}


# ---------------------------------------------------------------------------
# Backboard fetch helpers
# ---------------------------------------------------------------------------

async def _fetch_provider_models(
    client: BackboardClient, provider: str
) -> list[Model]:
    """Paginate every model row for *provider*."""
    out: list[Model] = []
    skip = 0
    while True:
        resp = await client.list_models_by_provider(
            provider_name=provider, skip=skip, limit=PAGE_SIZE
        )
        out.extend(resp.models)
        if not resp.models:
            break
        skip += len(resp.models)
        if skip >= resp.total:
            break
    return out


async def _fetch_live_catalog(api_key: str) -> dict[str, list[Model]]:
    """Return ``{provider: [Model, ...]}`` covering every provider Backboard exposes."""
    catalog: dict[str, list[Model]] = {}
    async with BackboardClient(api_key=api_key) as client:
        providers_resp = await client.list_providers()
        providers = providers_resp.providers or []
        if not providers:
            print("WARN: Backboard returned no providers", file=sys.stderr)
            return catalog
        for provider in providers:
            print(f"  {provider}: fetching models...", flush=True)
            try:
                models = await _fetch_provider_models(client, provider)
            except Exception as exc:  # noqa: BLE001 - surface and continue
                print(f"    ERROR fetching {provider}: {exc}", file=sys.stderr)
                continue
            chat_models = [m for m in models if _is_chat_compatible(m)]
            dropped = len(models) - len(chat_models)
            extra = f" ({dropped} filtered)" if dropped else ""
            print(f"    {provider}: {len(chat_models)} chat model(s){extra}", flush=True)
            catalog[provider] = chat_models
    return catalog


def _is_embedding(model: Model) -> bool:
    if not model.model_type:
        return False
    return model.model_type.lower() in EMBEDDING_TYPE_TOKENS


def _is_chat_compatible(model: Model) -> bool:
    """True when the model can be served through Backboard's chat-thread endpoint.

    Excludes embedding models (different endpoint family) and any model in
    `RESPONSES_ONLY_MODELS` (OpenAI Responses-API-only).
    """
    if _is_embedding(model):
        return False
    if f"{model.provider}/{model.name}" in RESPONSES_ONLY_MODELS:
        return False
    return True


# ---------------------------------------------------------------------------
# YAML helpers
# ---------------------------------------------------------------------------

def _load_yaml(path: Path) -> dict[str, Any]:
    with open(path) as f:
        return yaml.safe_load(f) or {}


def _dump_yaml(path: Path, config: dict[str, Any]) -> None:
    with open(path, "w") as f:
        yaml.safe_dump(
            config,
            f,
            sort_keys=False,
            allow_unicode=True,
            indent=2,
            default_flow_style=False,
            width=120,
        )


def _model_id(model: Model) -> str:
    return f"{model.provider}/{model.name}"


def _existing_model_ids(endpoint: dict[str, Any]) -> list[str]:
    raw = endpoint.get("models", {}).get("default") or []
    out: list[str] = []
    for entry in raw:
        if isinstance(entry, dict):
            name = entry.get("name", "")
        else:
            name = entry
        if isinstance(name, str) and name:
            out.append(name)
    return out


def _detect_provider_prefix(endpoint: dict[str, Any]) -> str | None:
    """Determine which Backboard provider this endpoint maps to.

    Uses the prefix of the first existing model entry (e.g. ``aws-bedrock`` from
    ``aws-bedrock/anthropic.claude-...``). Returns ``None`` when the endpoint
    has no model entries we can use to infer a provider.
    """
    for entry in _existing_model_ids(endpoint):
        if "/" in entry:
            return entry.split("/", 1)[0]
    return None


def _build_pricing_entry(model: Model) -> dict[str, float] | None:
    if model.input_cost_per_1m_tokens is None and model.output_cost_per_1m_tokens is None:
        return None
    input_cost = float(model.input_cost_per_1m_tokens or 0)
    output_cost = float(model.output_cost_per_1m_tokens or 0)
    return {
        "inputCostPer1mTokens": input_cost,
        "outputCostPer1mTokens": output_cost,
        "overageCostPer1mTokens": output_cost,
    }


def _filter_selector_tiers(
    endpoint: dict[str, Any], allowed: set[str]
) -> None:
    tiers = endpoint.get("selectorTiers")
    if not isinstance(tiers, dict):
        return
    for tier_name, tier_models in list(tiers.items()):
        if not isinstance(tier_models, list):
            continue
        # de-dupe and prune to the new allowed set
        pruned = sorted({m for m in tier_models if isinstance(m, str) and m in allowed})
        if pruned:
            tiers[tier_name] = pruned
        else:
            del tiers[tier_name]
    if not tiers:
        endpoint.pop("selectorTiers", None)


# ---------------------------------------------------------------------------
# Sync core
# ---------------------------------------------------------------------------

def apply_catalog(
    config: dict[str, Any], catalog: dict[str, list[Model]]
) -> dict[str, dict[str, set[str]]]:
    """Mutate *config* to match *catalog*.

    Returns a per-provider diff::

        {
          "openai":   {"added": {...}, "removed": {...}},
          "anthropic": {"added": {...}, "removed": {...}},
        }
    """
    diff: dict[str, dict[str, set[str]]] = {}
    new_pricing: dict[str, dict[str, float]] = {}

    custom_endpoints = (config.get("endpoints") or {}).get("custom") or []
    seen_providers: set[str] = set()

    for endpoint in custom_endpoints:
        provider = _detect_provider_prefix(endpoint)
        ep_name = endpoint.get("name", "<unnamed>")
        if not provider:
            print(f"  WARN: endpoint '{ep_name}' has no model entries; skipping")
            continue
        seen_providers.add(provider)
        if provider not in catalog:
            print(
                f"  WARN: endpoint '{ep_name}' uses provider '{provider}' which "
                "Backboard did not return; leaving as-is"
            )
            continue

        live_models = catalog[provider]
        new_ids = sorted({_model_id(m) for m in live_models})
        new_set = set(new_ids)
        old_set = set(_existing_model_ids(endpoint))

        diff[provider] = {
            "added": new_set - old_set,
            "removed": old_set - new_set,
        }

        endpoint.setdefault("models", {})
        endpoint["models"]["default"] = new_ids
        endpoint["models"].setdefault("fetch", False)

        _filter_selector_tiers(endpoint, new_set)

        for m in live_models:
            entry = _build_pricing_entry(m)
            if entry is not None:
                new_pricing[_model_id(m)] = entry

    for provider, models in catalog.items():
        if provider not in seen_providers:
            print(
                f"  WARN: live provider '{provider}' has {len(models)} model(s) but "
                "no matching endpoint in librechat.yaml"
            )

    config["modelPricing"] = dict(sorted(new_pricing.items()))
    return diff


def _print_diff(diff: dict[str, dict[str, set[str]]]) -> bool:
    """Print human-readable diff. Return True if drift was detected."""
    has_changes = False
    for provider in sorted(diff):
        added = diff[provider]["added"]
        removed = diff[provider]["removed"]
        if not added and not removed:
            continue
        has_changes = True
        print(f"\n[{provider}] +{len(added)} added / -{len(removed)} stale")
        for mid in sorted(added):
            print(f"    + {mid}")
        for mid in sorted(removed):
            print(f"    - {mid}")
    if not has_changes:
        print("\nNo model drift — librechat.yaml is in sync with Backboard.")
    return has_changes


def _write_text_dump(path: Path, catalog: dict[str, list[Model]]) -> None:
    ids = sorted({_model_id(m) for models in catalog.values() for m in models})
    path.write_text("\n".join(ids) + "\n")
    print(f"  Wrote {len(ids)} model ids to {path}")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

async def _run(mode: str, yaml_path: Path, text_output: Path | None) -> int:
    api_key = os.getenv("BACKBOARD_API_KEY")
    if not api_key:
        print("ERROR: BACKBOARD_API_KEY is not set", file=sys.stderr)
        return 2

    print("Fetching live model catalog from Backboard ...")
    catalog = await _fetch_live_catalog(api_key)
    if not catalog:
        print("ERROR: Backboard returned no model data", file=sys.stderr)
        return 2

    if text_output is not None:
        _write_text_dump(text_output, catalog)

    print(f"\nLoading {yaml_path} ...")
    config = _load_yaml(yaml_path)
    diff = apply_catalog(config, catalog)
    drift = _print_diff(diff)

    if mode == "write":
        _dump_yaml(yaml_path, config)
        print(f"\nWrote {yaml_path}")
        return 0
    return 1 if drift else 0


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    mode_group = parser.add_mutually_exclusive_group()
    mode_group.add_argument(
        "--check",
        action="store_true",
        help="Show diff only; exit 1 on drift (default).",
    )
    mode_group.add_argument(
        "--write",
        action="store_true",
        help="Rewrite librechat.yaml using live Backboard data.",
    )
    parser.add_argument(
        "--yaml",
        default=DEFAULT_YAML,
        type=Path,
        help="Path to librechat.yaml (default: repo root librechat.yaml).",
    )
    parser.add_argument(
        "--output",
        nargs="?",
        const=DEFAULT_TEXT_OUTPUT,
        default=None,
        type=Path,
        help=(
            "Optional: also write a sorted plain-text list of every "
            "'provider/model' id seen on Backboard. Useful for backfilling "
            "automation that only consumes a flat list."
        ),
    )

    args = parser.parse_args(list(argv) if argv is not None else None)

    if load_dotenv is not None:
        # Load repo-level .env so a developer with BACKBOARD_API_KEY in .env
        # does not need to export it manually.
        load_dotenv(REPO_ROOT / ".env")

    mode = "write" if args.write else "check"
    return asyncio.run(_run(mode, args.yaml, args.output))


if __name__ == "__main__":
    sys.exit(main())
