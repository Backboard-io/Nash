import logging

from flask import Blueprint, jsonify, make_response, request

from api.config import settings
from api.middleware.csrf import csrf_protect
from api.middleware.rate_limit import limiter
from api.services import audit_service
from api.services.async_runner import run_async
from api.services import context_service
from api.services.backboard_service import (
    NASH_MAIN_ASSISTANT_NAME,
    ensure_assistant_named,
    get_user_client,
)
from api.services.session_cookie import set_session_cookie
from api.services.user_service import (
    create_user,
    find_user_by_api_key,
    update_user_field,
)

auth_bp = Blueprint("auth", __name__)
logger = logging.getLogger(__name__)


def _extract_session_token() -> str:
    for header_name in ("X-Session-Key", "X-Session-Token"):
        value = request.headers.get(header_name, "").strip()
        if value:
            return value
    auth = request.headers.get("Authorization", "").strip()
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return request.cookies.get("session_key", "").strip()


def _ensure_bb_assistant(user: dict, api_key: str | None = None) -> str:
    """Resolve the user's single nash-main Backboard assistant.

    Discovers an existing nash-main and creates one only if it's missing.
    Idempotent across BYOK re-submits and re-logins — the same assistant
    is reused, so threads and documents persist.
    """
    existing_id = user.get("bbAssistantId", "")
    if existing_id:
        return existing_id

    user_api_key = api_key or user.get("bbApiKey") or None
    client = get_user_client(user_api_key)
    if client is None:
        return ""

    # Discover-or-create (idempotent by name) rather than a bare create_assistant.
    # A bare create raced with a concurrent first login / re-login would spawn
    # duplicate nash-main assistants; ensure_assistant_named re-discovers and
    # converges on the earliest one, matching the keys.py BYOK path.
    main_id = run_async(ensure_assistant_named(client, NASH_MAIN_ASSISTANT_NAME))
    if main_id:
        update_user_field(user, "bbAssistantId", main_id)
    return main_id


def _serialize_user(user: dict) -> dict:
    return {
        "id": user["id"],
        "email": user.get("email", ""),
        "name": user.get("name", ""),
        "username": user.get("username", ""),
        "avatar": user.get("avatar", ""),
        "provider": user.get("provider", ""),
        "role": user.get("role", "USER"),
        "emailVerified": user.get("emailVerified", True),
        "bbAssistantId": user.get("bbAssistantId", ""),
        "createdAt": user.get("createdAt", ""),
        "updatedAt": user.get("updatedAt", ""),
    }


def _set_bb_cookies(response, user: dict, assistant_id: str = "") -> None:
    """Set Backboard assistant ID as httpOnly cookie. API key is NOT set as cookie
    (it's stored encrypted in DynamoDB via session_key instead).
    """
    bb_assistant_id = assistant_id or user.get("bbAssistantId") or ""
    response.delete_cookie("bb_api_key", path="/")
    if bb_assistant_id:
        response.set_cookie(
            "bb_assistant_id",
            bb_assistant_id,
            httponly=True,
            secure=not settings.domain_server.startswith("http://localhost"),
            samesite="Lax",
            max_age=settings.session_ttl_days * 86400,
            path="/",
        )


def _issue_session_response(
    user: dict,
    *,
    audit_event: str = "auth.login.success",
    session_key: str | None = None,
):
    """Build the post-login response. Session-key cookie is set by the caller."""
    audit_service.emit(audit_event, user_id=user["id"])
    payload = {"user": _serialize_user(user)}
    if session_key:
        # The session_key is intentionally returned to the first-party frontend,
        # not just set as the HttpOnly cookie. The SPA must send it as the
        # `X-Session-Key` header on cross-origin requests the cookie can't ride
        # on — image/file downloads, SSE, and audio fetches — where Safari's ITP
        # blocks the cross-site cookie. It is a bearer credential the client must
        # hold to authenticate those requests, so exposing it here is by design,
        # not a leak. (Hardening follow-up: hand off a short-lived, single-use
        # exchange token instead of the durable 30-day key.)
        payload["session_key"] = session_key
        payload["session_token"] = session_key
    response = make_response(jsonify(payload))
    _set_bb_cookies(response, user)
    return response


@auth_bp.route("/api/auth/apikey-login", methods=["POST"])
@limiter.limit("10 per minute")
def apikey_login():
    """Authenticate with a Backboard API key. No email/password needed."""
    data = request.get_json(silent=True) or {}
    api_key = (data.get("apiKey") or "").strip().replace("\n", "").replace("\r", "")

    if not api_key:
        return jsonify({"message": "API key is required"}), 400

    try:
        test_client = get_user_client(api_key)
        # Validation only reads the status code — ask for one record, not a page of 100.
        run_async(test_client.list_assistants(limit=1))
    except Exception as e:
        err_str = str(e).lower()
        status_code = getattr(e, "status_code", None)
        if (
            status_code in {401, 403}
            or "401" in err_str
            or "unauthorized" in err_str
            or "forbidden" in err_str
            or "invalid api key" in err_str
        ):
            audit_service.emit("auth.apikey.failure", result="fail", reason="invalid_key")
            return jsonify({"message": "Invalid API key. Check your key at app.backboard.io/settings"}), 401
        logger.exception("[auth] Backboard validation failed for API key login")
        return jsonify({"message": "Could not verify API key. Please try again."}), 502

    # Find existing user by this API key, or create one.
    # The user_id IS the key hash, so repeat logins with the same Backboard
    # key converge on a single Nash user record.
    user = find_user_by_api_key(api_key)
    if not user:
        from api.services.state_service import user_hash_from_api_key
        key_hash = user_hash_from_api_key(api_key)
        synthetic_email = f"apikey-{key_hash}@apikey.nash.local"
        user = create_user(
            email=synthetic_email,
            name="API Key User",
            provider="apikey",
            user_id=key_hash,
        )
    if user.get("active") is False:
        return jsonify({"message": "Account is disabled."}), 403

    _ensure_bb_assistant(user, api_key=api_key)

    # A BYOK key is by definition the account's personal key.
    try:
        context_service.upsert_context(
            user,
            context_service.PERSONAL_CONTEXT_ID,
            api_key=api_key,
            assistant_id=user.get("bbAssistantId", ""),
        )
        context_service.set_active_context(user, context_service.PERSONAL_CONTEXT_ID)
    except Exception:
        logger.exception("[auth] personal context capture failed during apikey-login (non-fatal)")

    # Drop any prior session so the cookie always points at a fresh row.
    old_session_key = request.cookies.get("session_key")
    if old_session_key:
        try:
            from api.services import dynamo_service as _ds
            _ds.delete_session(old_session_key)
        except Exception:
            pass

    try:
        from api.services import dynamo_service, encryption_service
        encrypted = encryption_service.encrypt_key(api_key)
        session_key = dynamo_service.generate_session_key()
        dynamo_service.store_session(
            session_key=session_key,
            encrypted_key=encrypted,
            provider="backboard",
            chat_assistant_id=user.get("bbAssistantId", ""),
            user_id=user["id"],
            context_id=context_service.PERSONAL_CONTEXT_ID,
        )
    except Exception:
        logger.exception("[auth] DynamoDB session creation failed during apikey-login")
        return jsonify({"message": "Could not create session. Please try again."}), 502

    audit_service.emit("auth.apikey.success", user_id=user["id"])
    response = _issue_session_response(user, session_key=session_key)
    set_session_cookie(response, session_key)
    return response


@auth_bp.route("/api/auth/logout", methods=["GET", "POST"])
@csrf_protect
def logout():
    user_id = None
    session_key = _extract_session_token()
    if session_key:
        try:
            from api.services import dynamo_service
            existing = dynamo_service.get_session(session_key)
            if existing:
                user_id = existing.get("user_id")
            dynamo_service.delete_session(session_key)
        except Exception:
            pass

    audit_service.emit("auth.logout", user_id=user_id)
    response = make_response(jsonify({"message": "Logged out"}))
    response.delete_cookie("bb_api_key", path="/")
    response.delete_cookie("bb_assistant_id", path="/")
    response.delete_cookie("session_key", path="/")
    return response
