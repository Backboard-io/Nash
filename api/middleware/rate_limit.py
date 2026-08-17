"""Rate limiting middleware using flask-limiter.

A single Limiter instance is created here and imported by app.py for
initialisation, and by route modules that need per-endpoint overrides.

Key functions / IDs:
- Key: remote IP, unwrapped from X-Forwarded-For (App Runner sets this).
- Storage: in-memory (suitable for a single gunicorn worker).
- Default limit: applied broadly; tighter limits are applied per-route.

Limits applied:
  POST /api/auth/apikey-login — 10 per minute  (brute-force protection)
  global default              — 300 per minute (broad DoS protection)
"""
import os

from flask import request
from flask_limiter import Limiter


def _get_ip() -> str:
    forwarded = request.headers.get("X-Forwarded-For", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.remote_addr or "unknown"


limiter = Limiter(
    key_func=_get_ip,
    default_limits=[os.getenv("NASH_RATE_LIMIT_DEFAULT", "300 per minute")],
    # In-memory storage — works correctly with a single gunicorn worker.
    storage_uri="memory://",
)
