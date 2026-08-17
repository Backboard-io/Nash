"""Backboard context storage on the user PROFILE (personal API key + assistant).

A *context* holds the Backboard API key and assistant a Nash user acts as.
Only the "personal" context exists — it captures the key the user signed in
with so later requests can decrypt it server-side.

Stored on the user PROFILE row:

  bbContexts: {
      "personal": {"apiKeyEncrypted": "...", "assistantId": "...",
                    "createdAt": "...", "lastLoginAt": "...", "status": "active"},
  }
  bbActiveContext: "personal"

Per-context API keys are AES-256-GCM encrypted (encryption_service); they are
never stored plaintext and never returned to the browser.
"""
from __future__ import annotations

import logging

from api.services import encryption_service
from api.services.user_service import update_user_field

logger = logging.getLogger(__name__)

PERSONAL_CONTEXT_ID = "personal"


def state_partition_id(user_id: str, context_id: str) -> str:
    """Partition handle for per-user app state.

    Always the plain user_id — all data lives in the personal partition.
    """
    return user_id


def fs_safe_partition(partition_id: str) -> str:
    """Filesystem/URL-safe form of a state partition id.

    Personal partitions come back unchanged, so existing upload directories
    keep working.
    """
    return partition_id.replace("#", "_")


# ---------------------------------------------------------------------------
# bbContexts maintenance on the user PROFILE
# ---------------------------------------------------------------------------

def get_contexts(user: dict) -> dict:
    """Return a copy of the user's bbContexts map ({} when absent)."""
    contexts = user.get("bbContexts")
    return dict(contexts) if isinstance(contexts, dict) else {}


def upsert_context(
    user: dict,
    context_id: str,
    *,
    api_key: str = "",
    assistant_id: str = "",
    client_id: int | None = None,
    display_name: str = "",
) -> dict:
    """Create or update one bbContexts entry and persist the PROFILE row.

    Keys are stable: a stored key is replaced only by a non-empty *different*
    incoming key (Backboard rotated it, or access was refreshed by a
    re-login); it is never cleared. Returns the stored entry.
    """
    from datetime import datetime, timezone

    contexts = get_contexts(user)
    entry = dict(contexts.get(context_id) or {})
    now = datetime.now(timezone.utc).isoformat()

    if api_key:
        stored_plain = ""
        encrypted = entry.get("apiKeyEncrypted") or ""
        if encrypted:
            try:
                stored_plain = encryption_service.decrypt_key(encrypted)
            except Exception:
                # Undecryptable (rotated ENCRYPTION_KEY, corrupt row) — the
                # fresh key from Backboard is authoritative.
                stored_plain = ""
        if api_key != stored_plain:
            entry["apiKeyEncrypted"] = encryption_service.encrypt_key(api_key)
    if assistant_id:
        entry["assistantId"] = assistant_id
    if client_id is not None:
        entry["clientId"] = int(client_id)
    if display_name:
        entry["displayName"] = display_name
    entry.setdefault("createdAt", now)
    entry["lastLoginAt"] = now
    entry.setdefault("status", "active")

    contexts[context_id] = entry
    update_user_field(user, "bbContexts", contexts)
    return entry


def get_context_api_key(user: dict, context_id: str) -> str:
    """Decrypt and return the API key stored for a context, or ""."""
    entry = get_contexts(user).get(context_id) or {}
    encrypted = entry.get("apiKeyEncrypted") or ""
    if not encrypted:
        return ""
    try:
        return encryption_service.decrypt_key(encrypted)
    except Exception:
        logger.warning("[contexts] failed to decrypt stored key for context %s", context_id)
        return ""


def set_active_context(user: dict, context_id: str) -> None:
    if user.get("bbActiveContext") != context_id:
        update_user_field(user, "bbActiveContext", context_id)
