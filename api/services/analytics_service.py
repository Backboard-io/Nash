"""Forward-only usage analytics backed by the state table."""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any

from api.services import state_service
from api.services.token_service import calculate_credit_usd_micros

logger = logging.getLogger(__name__)

MAX_BUCKET_UPDATE_ATTEMPTS = 8

ANALYTICS_DAYS = 365
PERSONAL_SCOPE = "personal"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _today_utc() -> date:
    return _now().date()


def _analytics_sk(day: str) -> str:
    return f"{state_service.SK_ANALYTICS_PREFIX}{day}"


def _strip_keys(row: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in row.items() if k not in {"pk", "sk"}}


def _coerce_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _coerce_model_counts(value: Any) -> dict[str, int]:
    if not isinstance(value, dict):
        return {}
    counts: dict[str, int] = {}
    for model, total in value.items():
        if not isinstance(model, str) or not model:
            continue
        counts[model] = counts.get(model, 0) + _coerce_int(total)
    return counts


def _merge_bucket(
    existing: dict[str, Any] | None,
    *,
    day: str,
    user_id: str,
    model_name: str,
    input_tokens: int,
    output_tokens: int,
    total_tokens: int,
    credit_usd_micros: int,
) -> dict[str, Any]:
    bucket = _strip_keys(existing or {})
    model_counts = _coerce_model_counts(bucket.get("modelCounts"))
    if model_name:
        model_counts[model_name] = model_counts.get(model_name, 0) + total_tokens

    merged = {
        **bucket,
        "date": day,
        "userId": user_id,
        "inputTokens": _coerce_int(bucket.get("inputTokens")) + input_tokens,
        "outputTokens": _coerce_int(bucket.get("outputTokens")) + output_tokens,
        "totalTokens": _coerce_int(bucket.get("totalTokens")) + total_tokens,
        "creditUsdMicros": _coerce_int(bucket.get("creditUsdMicros")) + credit_usd_micros,
        "modelCounts": model_counts,
        "messageCount": _coerce_int(bucket.get("messageCount")) + 1,
        "updatedAt": _now().isoformat(),
    }
    return merged


def _update_bucket(
    pk: str,
    sk: str,
    **usage: Any,
) -> None:
    """Optimistically merge a generation into a bucket without lost updates."""
    for _attempt in range(MAX_BUCKET_UPDATE_ATTEMPTS):
        existing = state_service.get_item(pk, sk)
        expected_version = _coerce_int((existing or {}).get("_version"), 0)
        merged = _merge_bucket(existing, **usage)
        if state_service.compare_and_set_item(
            pk,
            sk,
            merged,
            expected_version=expected_version,
            item_exists=existing is not None,
        ):
            return
    raise RuntimeError(f"Analytics bucket remained busy after retries: {pk}/{sk}")


def record_generation_analytics(
    *,
    user_id: str,
    model_name: str | None,
    input_tokens: int,
    output_tokens: int,
    total_tokens: int,
) -> None:
    """Record one completed chat generation into daily analytics buckets,
    keyed by the caller's identity."""
    if not user_id:
        return
    input_tokens = max(0, int(input_tokens or 0))
    output_tokens = max(0, int(output_tokens or 0))
    total_tokens = max(0, int(total_tokens or 0))
    if total_tokens <= 0:
        total_tokens = input_tokens + output_tokens
    if total_tokens <= 0:
        return

    day = _today_utc().isoformat()
    model = (model_name or "").strip()
    credit_usd_micros = calculate_credit_usd_micros(
        model,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
    )

    personal_pk = state_service.user_pk(user_id)
    personal_sk = _analytics_sk(day)
    usage = dict(
        day=day,
        user_id=user_id,
        model_name=model,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        total_tokens=total_tokens,
        credit_usd_micros=credit_usd_micros,
    )
    _update_bucket(personal_pk, personal_sk, **usage)


def _date_range() -> list[str]:
    today = _today_utc()
    start = today - timedelta(days=ANALYTICS_DAYS - 1)
    return [(start + timedelta(days=offset)).isoformat() for offset in range(ANALYTICS_DAYS)]


def _empty_bucket(day: str) -> dict[str, Any]:
    return {
        "date": day,
        "inputTokens": 0,
        "outputTokens": 0,
        "totalTokens": 0,
        "creditUsdMicros": 0,
        "messageCount": 0,
    }


def _summarize_rows(rows: list[dict[str, Any]]) -> tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, Any]]]:
    days = _date_range()
    day_set = set(days)
    by_day = {day: _empty_bucket(day) for day in days}
    model_totals: dict[str, int] = {}
    summary = {
        "inputTokens": 0,
        "outputTokens": 0,
        "totalTokens": 0,
        "creditUsdMicros": 0,
        "messageCount": 0,
        "activeDays": 0,
        "mainModel": "",
    }

    for row in rows:
        day = str(row.get("date") or "")
        if not day and isinstance(row.get("sk"), str):
            parts = row["sk"].split("#")
            day = parts[1] if len(parts) >= 2 else ""
        if day not in day_set:
            continue
        bucket = by_day[day]
        for key in ("inputTokens", "outputTokens", "totalTokens", "creditUsdMicros", "messageCount"):
            value = _coerce_int(row.get(key))
            bucket[key] += value
            summary[key] += value
        for model, tokens in _coerce_model_counts(row.get("modelCounts")).items():
            model_totals[model] = model_totals.get(model, 0) + tokens

    summary["activeDays"] = sum(1 for bucket in by_day.values() if bucket["messageCount"] > 0)
    model_ranking = [
        {"model": model, "totalTokens": total}
        for model, total in sorted(model_totals.items(), key=lambda item: (-item[1], item[0]))
    ]
    if model_ranking:
        summary["mainModel"] = model_ranking[0]["model"]
    return summary, [by_day[day] for day in days], model_ranking


def _selector(user_id: str) -> dict[str, Any]:
    return {
        "personal": {"id": PERSONAL_SCOPE, "name": "Personal"},
        "organizations": [],
    }


def _query_analytics_rows(pk: str) -> list[dict[str, Any]]:
    """Analytics rows for the dashboard's 365-day window, bounded.

    An unbounded prefix query would re-read the account's entire analytics
    history (which only ever grows) on every dashboard load.
    """
    try:
        # UTC, matching the WRITE side (_today_utc) — a local-date bound stops
        # short of today's bucket every evening once UTC rolls over.
        today = _today_utc()
        start_day = (today - timedelta(days=366)).isoformat()
        # "#USER#" suffixes sort after the bare date, so cap the range past
        # any same-day suffix. ISO dates sort lexicographically.
        end = f"{state_service.SK_ANALYTICS_PREFIX}{today.isoformat()}#~"
        return state_service.query_range(
            pk,
            f"{state_service.SK_ANALYTICS_PREFIX}{start_day}",
            end,
        )
    except Exception:
        logger.exception("[analytics] failed to query analytics rows")
        return []


def get_personal_analytics(user_id: str) -> dict[str, Any]:
    rows = _query_analytics_rows(state_service.user_pk(user_id))
    summary, activity, models = _summarize_rows(rows)
    return {
        "scope": PERSONAL_SCOPE,
        "selector": _selector(user_id),
        "summary": summary,
        "activity": activity,
        "models": models,
        "members": [],
    }


def get_analytics(user_id: str, *, scope: str = PERSONAL_SCOPE, org_id: str = "") -> dict[str, Any]:
    return get_personal_analytics(user_id)
