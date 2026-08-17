"""Token usage tracking (simplified -- no billing/plan logic)."""

import os
from datetime import datetime, timezone
from functools import lru_cache

import yaml

from api.services.user_service import find_user_by_id, update_user_field


def _current_period_start() -> str:
    """Return the first day of the current month in UTC ISO format."""
    now = datetime.now(timezone.utc)
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()


def _ensure_period(user: dict) -> None:
    """Reset token usage if we've entered a new billing period."""
    period_start = _current_period_start()
    stored_reset = user.get("tokenUsageResetAt", "")
    if stored_reset != period_start:
        user["tokenUsage"] = 0
        user["tokenUsageResetAt"] = period_start
        update_user_field(user, "tokenUsage", 0)
        update_user_field(user, "tokenUsageResetAt", period_start)


def get_token_usage(user_id: str) -> dict:
    """Return current usage for a user."""
    user = find_user_by_id(user_id)
    if not user:
        return {"usageTokens": 0, "includedTokens": 0, "tokensRemaining": 0, "overageTokens": 0, "overageEnabled": False}

    _ensure_period(user)
    usage = int(user.get("tokenUsage", 0) or 0)

    return {
        "usageTokens": usage,
        "includedTokens": 0,
        "tokensRemaining": 0,
        "overageTokens": 0,
        "overageEnabled": False,
    }


@lru_cache(maxsize=1)
def _load_model_pricing() -> dict[str, dict[str, float]]:
    yaml_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
        "librechat.yaml",
    )
    try:
        with open(yaml_path, "r", encoding="utf-8") as handle:
            config = yaml.safe_load(handle) or {}
    except FileNotFoundError:
        return {}

    pricing = config.get("modelPricing", {})
    if not isinstance(pricing, dict):
        return {}

    normalized: dict[str, dict[str, float]] = {}
    for model_name, raw_pricing in pricing.items():
        if not isinstance(model_name, str) or not isinstance(raw_pricing, dict):
            continue
        normalized[model_name] = {
            "inputCostPer1mTokens": float(
                raw_pricing.get("inputCostPer1mTokens", 0) or 0
            ),
            "outputCostPer1mTokens": float(
                raw_pricing.get("outputCostPer1mTokens", 0) or 0
            ),
            "overageCostPer1mTokens": float(
                raw_pricing.get("overageCostPer1mTokens", 0) or 0
            ),
        }
    return normalized


def _get_model_token_prices_per_1m(model_name: str | None) -> tuple[float, float]:
    if not model_name:
        return 0.0, 0.0
    pricing = _load_model_pricing().get(model_name, {})
    input_cost = float(pricing.get("inputCostPer1mTokens", 0) or 0)
    output_cost = float(pricing.get("outputCostPer1mTokens", 0) or 0)
    return input_cost, output_cost


def calculate_credit_usd_micros(
    model_name: str | None,
    *,
    input_tokens: int = 0,
    output_tokens: int = 0,
) -> int:
    """Return USD-equivalent usage cost in micro-dollars.

    Pricing is configured as USD per 1M tokens, so converting to micro-dollars
    collapses to ``tokens * price_per_1m``. Unknown or free models cost zero.
    """
    input_cost, output_cost = _get_model_token_prices_per_1m(model_name)
    if input_cost <= 0 and output_cost <= 0:
        return 0
    credit = max(0, input_tokens) * max(0.0, input_cost)
    credit += max(0, output_tokens) * max(0.0, output_cost)
    return max(0, int(round(credit)))


def record_token_usage(
    user_id: str,
    tokens: int,
    model_name: str | None = None,
    *,
    input_tokens: int = 0,
    output_tokens: int = 0,
) -> None:
    """Add tokens to the user's monthly usage counter."""
    if tokens <= 0:
        return
    user = find_user_by_id(user_id)
    if not user:
        return
    prev = int(user.get("tokenUsage", 0) or 0)
    new_total = prev + tokens
    update_user_field(user, "tokenUsage", new_total)


def reset_token_usage(user_id: str) -> None:
    """Admin: reset a user's token usage to zero."""
    user = find_user_by_id(user_id)
    if not user:
        return
    update_user_field(user, "tokenUsage", 0)
    update_user_field(user, "tokenUsageResetAt", _current_period_start())
