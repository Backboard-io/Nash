"""User records, backed by the DynamoDB state table.

Each user is one PROFILE row plus zero or more lookup-index rows:
  pk=USER#{user_id}     sk=PROFILE           — full user record
  pk=EMAIL#{email}      sk=USERREF           — points at user_id

`user_id` is whatever the caller computes when the user is created:
  - BYOK apikey-login:  sha256(api_key) — see state_service.user_hash_from_api_key

No in-memory cache — DynamoDB reads are fast enough that an opaque cache layer
would just hide write/read races between routes.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from api.services import state_service

logger = logging.getLogger(__name__)


_PROFILE_DEFAULTS: dict[str, object] = {
    "name": "",
    "username": "",
    "avatar": "",
    "nickname": "",
    "firstName": "",
    "lastName": "",
    "provider": "",
    "role": "USER",
    "emailVerified": True,
    "bbAssistantId": "",
    "bbApiKey": "",
    "bbContexts": {},
    "bbActiveContext": "",
    "tokenUsage": 0,
    "tokenUsageResetAt": "",
    "termsAcceptedAt": "",
    "personalization": {"memories": True},
    "active": True,
    "createdAt": "",
    "updatedAt": "",
    "lastLoginAt": "",
    "companyName": "",
    "companyWebsite": "",
    "industry": "",
    "companySize": "",
    "useCase": "",
}


def _normalize_user(row: dict | None) -> dict | None:
    """Return a user dict with every expected field present.

    DynamoDB stores only the keys we put in, so older rows missing newer
    fields would otherwise surface as KeyError at call sites.
    """
    if row is None:
        return None
    out: dict = {"id": row.get("id") or row.get("pk", "").removeprefix("USER#")}
    out["email"] = row.get("email", "")
    for k, default in _PROFILE_DEFAULTS.items():
        if k not in row and isinstance(default, (dict, list)):
            # Copy container defaults — handing every user the same shared
            # object would let one user's in-place mutation leak into others'.
            out[k] = type(default)(default)
        else:
            out[k] = row.get(k, default)
    return out


# ---------------------------------------------------------------------------
# Lookup-index helpers
# ---------------------------------------------------------------------------

def _put_email_index(email: str, user_id: str) -> None:
    if not email:
        return
    state_service.put_item(
        state_service.email_lookup_pk(email),
        state_service.SK_USERREF,
        {"user_id": user_id},
    )


def _delete_email_index(email: str) -> None:
    if not email:
        return
    state_service.delete_item(state_service.email_lookup_pk(email), state_service.SK_USERREF)


def _resolve_user_id_via(pk: str) -> str | None:
    """Read a USERREF row and return the user_id it points at, or None."""
    row = state_service.get_item(pk, state_service.SK_USERREF)
    if not row:
        return None
    uid = row.get("user_id")
    return str(uid) if uid else None


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------

def find_user_by_id(user_id: str) -> dict | None:
    if not user_id:
        return None
    return _normalize_user(state_service.profile.get(user_id))


def find_user_by_email(email: str, *, force: bool = False) -> dict | None:
    """Look up by email via the EMAIL# index.

    `force` is accepted for call-site compatibility but ignored: there's no
    cache to bust now.
    """
    if not email:
        return None
    uid = _resolve_user_id_via(state_service.email_lookup_pk(email))
    if not uid:
        return None
    return find_user_by_id(uid)


def find_user_by_api_key(api_key: str) -> dict | None:
    """Direct lookup: derive user_hash from the key, fetch PROFILE."""
    if not api_key:
        return None
    user_id = state_service.user_hash_from_api_key(api_key)
    return find_user_by_id(user_id)


async def find_user_by_id_async(user_id: str) -> dict | None:
    return find_user_by_id(user_id)


def get_all_users() -> list[dict]:
    """Return every user PROFILE row. Used by admin listings and the legacy
    cross-user public-agent search; both are infrequent.
    """
    rows = state_service.scan_profile_rows()
    return [u for u in (_normalize_user(r) for r in rows) if u is not None]


# ---------------------------------------------------------------------------
# Writes
# ---------------------------------------------------------------------------

def create_user(
    email: str,
    name: str,
    *,
    user_id: str | None = None,
    avatar: str = "",
    provider: str = "",
    role: str = "USER",
    username: str = "",
    email_verified: bool | None = None,
) -> dict:
    """Create a new user record.

    `user_id` may be supplied by the caller (e.g. sha256(api_key) for BYOK).
    Defaults to a lower-cased email so it still gets a stable partition.

    Returns the existing record if a user with this email already exists,
    so callers can rely on this being idempotent.
    """
    existing = find_user_by_email(email)
    if existing:
        return existing

    resolved_id = (user_id or email.lower().strip()) or ""
    if not resolved_id:
        raise ValueError("create_user requires either user_id or email")

    now = datetime.now(timezone.utc).isoformat()
    if email_verified is None:
        email_verified = provider not in {"email", "local"}
    user = {
        "id": resolved_id,
        "email": email,
        "name": name,
        "username": username or (email.split("@")[0] if email else resolved_id),
        "avatar": avatar,
        "provider": provider,
        "role": role,
        "emailVerified": bool(email_verified),
        "bbAssistantId": "",
        "bbApiKey": "",
        "bbContexts": {},
        "bbActiveContext": "",
        "tokenUsage": 0,
        "tokenUsageResetAt": "",
        "termsAcceptedAt": "",
        "active": True,
        "createdAt": now,
        "updatedAt": now,
    }

    items: list[tuple[str, str, dict]] = [
        (state_service.user_pk(resolved_id), state_service.SK_PROFILE, user),
    ]
    if email:
        items.append((
            state_service.email_lookup_pk(email),
            state_service.SK_USERREF,
            {"user_id": resolved_id},
        ))

    state_service.transact_put_items(items)
    return user


def memories_enabled_for_user(user: dict | None) -> bool:
    """Account-wide memory opt-out (Settings → Personalization).

    True by default (including principals with no durable profile row — they
    have nowhere to persist the preference). Consulted by BOTH the memories
    routes and the chat send path: the opt-out must actually stop Backboard
    from reading/writing memories, not just hide the panel."""
    if not user:
        return True
    personalization = user.get("personalization") or {}
    return bool(personalization.get("memories", True))


def update_user_field(user: dict, field: str, value) -> None:
    """Update one field on the user's PROFILE row.

    The `email` lookup index is also updated on email changes: the old index
    row is deleted and a fresh one is written so the user remains findable.
    """
    user_id = user.get("id")
    if not user_id:
        logger.warning("[user_service] update_user_field called with no user id; field=%s", field)
        user[field] = value
        return

    old_value = user.get(field)
    user[field] = value
    user["updatedAt"] = datetime.now(timezone.utc).isoformat()

    if field == "email":
        if old_value and old_value != value:
            _delete_email_index(old_value)
        _put_email_index(value, user_id)

    # Always rewrite the PROFILE row — DynamoDB put_item is full-record write.
    state_service.profile.put(user_id, user)


def delete_user(user: dict) -> None:
    """Remove the user's PROFILE and lookup-index rows.

    Does NOT delete the user's Backboard assistant or its threads/documents
    — the caller wipes those before invoking this.
    """
    user_id = user.get("id")
    if not user_id:
        return
    state_service.profile.delete(user_id)
    _delete_email_index(user.get("email", ""))


# ---------------------------------------------------------------------------
# Convenience accessors
# ---------------------------------------------------------------------------

def get_user_assistant_id(user_id: str) -> str:
    """Get the bbAssistantId for a user. Assumes login already ensured it."""
    user = find_user_by_id(user_id)
    if not user:
        raise ValueError(f"User {user_id} not found")
    assistant_id = user.get("bbAssistantId", "")
    if not assistant_id:
        raise ValueError(f"User {user_id} has no bbAssistantId — re-login required")
    return assistant_id


async def get_user_assistant_id_async(user_id: str) -> str:
    return get_user_assistant_id(user_id)


def get_user_api_key(user_id: str) -> str | None:
    """Return the user's stored Backboard API key, or None.

    Preferred source is the plaintext PROFILE field ``bbApiKey``. For older
    rows that only persisted the encrypted personal-context key, fall back
    to decrypting ``bbContexts.personal.apiKeyEncrypted``.
    """
    if not user_id:
        return None
    user = find_user_by_id(user_id)
    if not user:
        return None

    api_key = str(user.get("bbApiKey") or "").strip()
    if api_key:
        return api_key

    try:
        from api.services import context_service

        api_key = context_service.get_context_api_key(user, context_service.PERSONAL_CONTEXT_ID)
    except Exception:
        api_key = ""

    return api_key or None


async def get_user_api_key_async(user_id: str) -> str | None:
    return get_user_api_key(user_id)
