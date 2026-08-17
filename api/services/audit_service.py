"""Structured JSON audit logging for security-relevant events.

Each audit event is emitted as a single JSON line to stdout so it is captured
by App Runner / CloudWatch without any additional log-shipping setup.

Schema (all fields always present, unknown fields are None / empty string):
  timestamp   — ISO-8601 UTC
  event       — dot-separated name, e.g. "auth.login.success"
  result      — "ok" | "fail" | "blocked"
  user_id     — internal user id, or null for unauthenticated events
  ip          — client IP (unwrapped from X-Forwarded-For when present)
  user_agent  — first 200 chars of User-Agent header
  **kwargs    — any extra event-specific fields (email_domain, reason, …)
"""
import json
import logging
from datetime import datetime, timezone

from flask import has_request_context, request

_log = logging.getLogger("audit")

# Ensure the audit logger always reaches the handler even if root level is higher.
_log.setLevel(logging.INFO)


def _client_ip() -> str:
    if not has_request_context():
        return "internal"
    forwarded = request.headers.get("X-Forwarded-For", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.remote_addr or "unknown"


def _user_agent() -> str:
    if not has_request_context():
        return ""
    return (request.headers.get("User-Agent") or "")[:200]


def emit(
    event: str,
    *,
    result: str = "ok",
    user_id: str | None = None,
    **kwargs,
) -> None:
    """Emit a single audit event as a JSON log line."""
    record: dict = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "event": event,
        "result": result,
        "user_id": user_id,
        "ip": _client_ip(),
        "user_agent": _user_agent(),
    }
    record.update(kwargs)
    _log.info(json.dumps(record))
