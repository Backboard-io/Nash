"""Session-key authentication middleware.

The session_key cookie (or X-Session-Key / X-Session-Token / Bearer header) is the credential. The
decorator resolves the DynamoDB session row, decrypts the BYOK key, and
populates the Flask `g` context:
  g.auth_method = "session"
  g.session_key = "nash_sk_..."
  g.bb_api_key = <decrypted plaintext key>
  g.chat_assistant_id = "..."
  g.user_id = <from session row, may be None for legacy rows>
  g.bb_context_id = <active Backboard context; "" on legacy rows = personal>
  g.auth_flow = <legacy field; "" on all current sessions>

`require_auth` and `require_session` are aliases — kept to avoid a big rename
sweep across every route module. Both behave identically.
"""

import functools
import logging

from flask import request, g, jsonify

from api.services import dynamo_service
from api.services.encryption_service import decrypt_key

logger = logging.getLogger(__name__)


def _extract_session_key() -> str | None:
    """Extract session key from header or cookie."""
    for header_name in ("X-Session-Key", "X-Session-Token"):
        sk = request.headers.get(header_name, "").strip()
        if sk:
            return sk
    auth = request.headers.get("Authorization", "").strip()
    if auth.lower().startswith("bearer "):
        bearer = auth[7:].strip()
        if bearer:
            return bearer
    sk = request.cookies.get("session_key", "").strip()
    return sk or None


def optional_user_id_from_session() -> str | None:
    """Best-effort: return the caller's user_id from the session_key cookie.

    Used by unauthenticated endpoints that personalize their response when a
    session happens to be present (e.g. /api/banner). Returns None whenever
    the cookie is missing, the session is expired, or any error occurs.
    """
    sk = _extract_session_key()
    if not sk:
        return None
    try:
        session = dynamo_service.get_session(sk)
    except Exception:
        return None
    if not session:
        return None
    user_id = session.get("user_id")
    return user_id or None


def _resolve_session(session_key: str) -> dict | None:
    """Look up session in DynamoDB, decrypt key, return session data or None.

    Returns None on any failure (not found, expired, DynamoDB down, decryption error).
    Never raises — all errors result in 401 to the client.
    """
    try:
        session = dynamo_service.get_session(session_key)
    except Exception:
        # DynamoDB down or network error — treat as invalid session
        return None

    if not session:
        return None

    encrypted = session.get("encrypted_key")
    if not encrypted:
        return None
    try:
        plaintext = decrypt_key(encrypted)
    except Exception:
        # Wrong encryption key or corrupt data — treat as invalid.
        return None
    if not plaintext:
        return None

    return {
        "api_key": plaintext,
        "provider": session.get("provider", ""),
        "chat_assistant_id": session.get("chat_assistant_id", ""),
        "user_id": session.get("user_id"),
        "context_id": session.get("context_id", ""),
        "auth_flow": session.get("auth_flow", ""),
    }


def _populate_g_from_session(session_key: str, data: dict) -> None:
    """Set Flask g context from session data."""
    g.auth_method = "session"
    g.session_key = session_key
    g.bb_api_key = data.get("api_key", "")
    g.chat_assistant_id = data.get("chat_assistant_id", "")
    g.user_id = data.get("user_id")  # populated from session row if present
    g.bb_context_id = data.get("context_id", "")  # "" = personal (legacy rows)
    g.auth_flow = data.get("auth_flow", "")  # "" = BYOK/legacy (never imports)


def require_session(f):
    """Decorator: require a valid session key. No JWT fallback."""
    @functools.wraps(f)
    def decorated(*args, **kwargs):
        session_key = _extract_session_key()
        if not session_key:
            return jsonify({"error": "Missing session key. Send X-Session-Key header."}), 401

        data = _resolve_session(session_key)
        if not data:
            return jsonify({"error": "Invalid or expired session"}), 401

        _populate_g_from_session(session_key, data)
        try:
            dynamo_service.touch_session(session_key)
        except Exception:
            pass
        return f(*args, **kwargs)
    return decorated


def require_auth(f):
    """Decorator: require a valid session_key cookie or X-Session-Key header."""
    @functools.wraps(f)
    def decorated(*args, **kwargs):
        session_key = _extract_session_key()
        if not session_key:
            logger.warning(
                "require_auth: no credentials on %s %s",
                request.method,
                request.path,
            )
            return jsonify({"error": "Missing or invalid authentication"}), 401

        data = _resolve_session(session_key)
        if not data:
            logger.warning(
                "require_auth: invalid session for %s %s",
                request.method,
                request.path,
            )
            return jsonify({"error": "Invalid or expired session"}), 401

        _populate_g_from_session(session_key, data)
        try:
            dynamo_service.touch_session(session_key)
        except Exception:
            pass  # Throttled-write failures must never fail the request.
        return f(*args, **kwargs)
    return decorated
