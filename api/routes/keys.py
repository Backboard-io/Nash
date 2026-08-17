"""BYOK (Bring Your Own Key) session management routes.

DynamoDB is a blind key store — NO user identity.
Only stores: session_key → encrypted API key + assistant IDs + provider + TTL.

Flow:
  1. POST /api/keys       — submit BYOK key → validate → create assistants → return session_key
  2. POST /api/keys/verify — check if session_key is still valid
  3. DELETE /api/keys      — revoke a session
  4. POST /api/keys/refresh — extend session TTL
"""

import logging

from flask import Blueprint, g, jsonify, request, make_response

from api.config import settings
from api.middleware.rate_limit import limiter
from api.services import context_service, dynamo_service, encryption_service
from api.services.async_runner import run_async
from api.services.backboard_service import ensure_nash_main_assistant, get_user_client
from api.services.audit_service import emit as audit_emit
from api.services.session_cookie import set_session_cookie

keys_bp = Blueprint("keys", __name__)
logger = logging.getLogger(__name__)

SUPPORTED_PROVIDERS = {"openai", "anthropic", "google", "azure", "backboard", "custom"}


@keys_bp.route("/api/keys", methods=["POST"])
@limiter.limit("10 per minute")
def store_key():
    """Submit a BYOK API key. Validates against Backboard, creates assistants,
    encrypts the key, stores in DynamoDB, and returns an opaque session_key.

    No JWT required — submitting a valid key IS the authentication act.

    Request body:
        { "provider": "backboard", "apiKey": "espr_..." }

    Response:
        { "session_key": "nash_sk_...", "provider": "backboard", "ttl_hours": 1 }
    """
    data = request.get_json(silent=True) or {}
    provider = (data.get("provider") or "").strip().lower()
    api_key = (data.get("apiKey") or "").strip()

    if not provider or provider not in SUPPORTED_PROVIDERS:
        return jsonify({"message": f"Provider must be one of: {', '.join(sorted(SUPPORTED_PROVIDERS))}"}), 400
    if not api_key:
        return jsonify({"message": "apiKey is required"}), 400

    # --- Step 1: Validate the key against Backboard billing API ---
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
            audit_emit("byok.validation.failure", result="fail", reason="invalid_key")
            return jsonify({"message": "Invalid API key. Check your key at app.backboard.io/settings"}), 401
        logger.exception("[keys] Backboard validation failed")
        return jsonify({"message": "Could not verify API key. Please try again."}), 502

    # --- Step 2: Discover-or-create the single nash-main assistant ---
    # Idempotent across re-submitted keys: the same assistant is reused, so
    # threads and documents persist instead of being orphaned on every submit.
    try:
        async def _ensure_main():
            client = get_user_client(api_key)
            return await ensure_nash_main_assistant(client)

        chat_assistant_id = run_async(_ensure_main())
    except Exception:
        logger.exception("[keys] Failed to resolve nash-main assistant")
        return jsonify({"message": "Key is valid but failed to initialize session. Please retry."}), 502

    # --- Step 3: Encrypt key and store session in DynamoDB ---
    encrypted = encryption_service.encrypt_key(api_key)
    session_key = dynamo_service.generate_session_key()

    # Derive a stable user_id from the api key hash so BYOK sessions sit on
    # the same partition as apikey-login sessions for this same key.
    from api.services.state_service import user_hash_from_api_key
    user_id = user_hash_from_api_key(api_key)

    dynamo_service.store_session(
        session_key=session_key,
        encrypted_key=encrypted,
        provider=provider,
        chat_assistant_id=chat_assistant_id,
        user_id=user_id,
        context_id=context_service.PERSONAL_CONTEXT_ID,
    )

    audit_emit("byok.session.created", provider=provider)

    # --- Step 4: Return session_key + set as httpOnly cookie ---
    response = make_response(jsonify({
        "session_key": session_key,
        "session_token": session_key,
        "provider": provider,
        "ttl_hours": settings.session_ttl_days * 24,
    }))
    set_session_cookie(response, session_key)
    return response


@keys_bp.route("/api/keys/verify", methods=["POST"])
@limiter.limit("60 per minute")
def verify_session():
    """Check if a session_key is still valid (not expired).

    Request body: { "session_key": "nash_sk_..." }
    No JWT required — the session_key itself is the credential.
    """
    data = request.get_json(silent=True) or {}
    session_key = (data.get("session_key") or "").strip()

    if not session_key:
        return jsonify({"valid": False, "message": "session_key is required"}), 400

    session = dynamo_service.get_session(session_key)
    if not session:
        return jsonify({"valid": False}), 200

    return jsonify({
        "valid": True,
        "provider": session["provider"],
    }), 200


@keys_bp.route("/api/keys", methods=["DELETE"])
@limiter.limit("20 per minute")
def revoke_session():
    """Revoke a session — deletes the encrypted key from DynamoDB.

    Request body: { "session_key": "nash_sk_..." }
    """
    data = request.get_json(silent=True) or {}
    session_key = (data.get("session_key") or "").strip()

    if not session_key:
        return jsonify({"message": "session_key is required"}), 400

    deleted = dynamo_service.delete_session(session_key)
    if not deleted:
        return jsonify({"message": "Session not found"}), 404

    audit_emit("byok.session.revoked")
    response = make_response(jsonify({"message": "Session revoked"}))
    response.delete_cookie("session_key", path="/")
    return response


@keys_bp.route("/api/keys/refresh", methods=["POST"])
@limiter.limit("60 per minute")
def refresh_session():
    """Extend the TTL of an active session.

    Request body: { "session_key": "nash_sk_..." }
    """
    data = request.get_json(silent=True) or {}
    session_key = (data.get("session_key") or "").strip()

    if not session_key:
        return jsonify({"message": "session_key is required"}), 400

    refreshed = dynamo_service.refresh_session(session_key)
    if not refreshed:
        return jsonify({"message": "Session not found or expired"}), 404

    response = make_response(jsonify({
        "message": "Session refreshed",
        "ttl_hours": settings.session_ttl_days * 24,
    }))
    set_session_cookie(response, session_key)
    return response


# ---------------------------------------------------------------------------
# Internal helper — used by chat routes to get the decrypted key
# ---------------------------------------------------------------------------

def get_decrypted_key(session_key: str) -> tuple[str | None, str | None]:
    """Fetch and decrypt a BYOK API key from a session_key.

    Returns (plaintext_key, provider) or (None, None) if not found/expired.
    Caller must not log or persist the plaintext key.
    """
    session = dynamo_service.get_session(session_key)
    if not session:
        return None, None

    encrypted = session.get("encrypted_key")
    if not encrypted:
        return None, None

    plaintext = encryption_service.decrypt_key(encrypted)
    return plaintext, session.get("provider")
