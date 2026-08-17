"""DynamoDB session store for Nash OSS.

Each row stores:
  - session_key: opaque random token (PK)
  - user_id: Nash user identity (used by identity-aware routes)
  - encrypted_key: AES-256-GCM encrypted BYOK API key
  - provider: which LLM provider (openai, anthropic, etc.)
  - chat_assistant_id: Backboard assistant id
  - context_id: active Backboard context ("personal" or "org:<clientId>");
    empty/absent on legacy rows means personal
  - created_at: ISO-8601 creation timestamp
  - last_used_at: epoch seconds of the last activity touch
  - ttl: epoch seconds for DynamoDB native TTL auto-deletion

The BYOK material remains AES-GCM wrapped; user_id is the only identity field
and is what identity-aware routes (admin, share-links) consume. TTL is sliding —
bumped by touch_session() on each request, throttled to one update per
settings.session_touch_min_interval_seconds.

Uses DynamoDB Local in dev (docker), real DynamoDB in prod (IAM auth).
"""

import secrets
import threading
import time
from datetime import datetime, timezone
import logging

import boto3
from botocore.exceptions import ClientError

from api.config import settings

TABLE_NAME_DEFAULT = "nash_keys"
logger = logging.getLogger(__name__)
_memory_sessions: dict[str, dict] = {}

# One table handle per thread — see state_service._get_table for rationale
# (per-call construction pays a fresh TLS handshake per DynamoDB operation).
_thread_local = threading.local()


def _get_table():
    """Get a DynamoDB table resource (cached per thread)."""
    table_name = settings.dynamo_table or TABLE_NAME_DEFAULT
    cache_key = (settings.dynamo_region, settings.dynamo_endpoint, table_name)
    if getattr(_thread_local, "sessions_table_key", None) == cache_key:
        return _thread_local.sessions_table

    kwargs = {
        "region_name": settings.dynamo_region or "us-east-1",
    }
    endpoint = settings.dynamo_endpoint
    if endpoint:
        kwargs["endpoint_url"] = endpoint

    resource = boto3.resource("dynamodb", **kwargs)
    table = resource.Table(table_name)
    _thread_local.sessions_table = table
    _thread_local.sessions_table_key = cache_key
    return table


def ensure_table():
    """Create the table if it doesn't exist (for local dev / first run)."""
    kwargs = {
        "region_name": settings.dynamo_region or "us-east-1",
    }
    endpoint = settings.dynamo_endpoint
    if endpoint:
        kwargs["endpoint_url"] = endpoint

    client = boto3.client("dynamodb", **kwargs)
    table_name = settings.dynamo_table or TABLE_NAME_DEFAULT

    try:
        client.describe_table(TableName=table_name)
        return  # already exists
    except ClientError as e:
        if e.response["Error"]["Code"] != "ResourceNotFoundException":
            raise

    client.create_table(
        TableName=table_name,
        KeySchema=[
            {"AttributeName": "session_key", "KeyType": "HASH"},
        ],
        AttributeDefinitions=[
            {"AttributeName": "session_key", "AttributeType": "S"},
        ],
        BillingMode="PAY_PER_REQUEST",
    )
    waiter = client.get_waiter("table_exists")
    waiter.wait(TableName=table_name)

    # Enable TTL on the 'ttl' attribute for auto-expiry
    try:
        client.update_time_to_live(
            TableName=table_name,
            TimeToLiveSpecification={
                "Enabled": True,
                "AttributeName": "ttl",
            },
        )
    except ClientError:
        pass  # TTL may already be enabled or not supported in local


def generate_session_key() -> str:
    """Generate a cryptographically random session key."""
    return f"nash_sk_{secrets.token_urlsafe(32)}"


def _compute_ttl() -> int:
    """Compute the sliding TTL ceiling: now + session_ttl_days."""
    return int(time.time()) + settings.session_ttl_days * 86400


# --- MCP-server OAuth state (its own keyspace so the MCP feature can never
# --- interfere with sign-in). ---

def _mcp_oauth_state_key(state: str) -> str:
    return f"mcp_oauth_state#{state}"


def store_mcp_oauth_state(
    state: str,
    code_verifier: str,
    server_name: str,
    user_hash: str,
    return_to: str = "",
    session_fingerprint: str = "",
) -> None:
    """Persist the CSRF state + PKCE verifier + which server/user this MCP OAuth
    round belongs to. 600s TTL, single-use (popped in the callback).

    ``session_fingerprint`` binds the flow to the initiating session so the
    callback can reject a completion coming from any other browser/account
    (OAuth account-linking CSRF)."""
    ttl = int(time.time()) + 600
    _get_table().put_item(
        Item={
            "session_key": _mcp_oauth_state_key(state),
            "state": state,
            "code_verifier": code_verifier,
            "server_name": server_name,
            "user_hash": user_hash,
            "return_to": return_to,
            "session_fingerprint": session_fingerprint,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "ttl": ttl,
        }
    )


def pop_mcp_oauth_state(state: str) -> dict | None:
    table = _get_table()
    key = {"session_key": _mcp_oauth_state_key(state)}
    resp = table.get_item(Key=key)
    item = resp.get("Item")
    table.delete_item(Key=key)
    if not item:
        return None
    if item.get("ttl") and int(item["ttl"]) <= int(time.time()):
        return None
    return item


# ---------------------------------------------------------------------------
# Session CRUD
# ---------------------------------------------------------------------------

def store_session(
    session_key: str,
    encrypted_key: str,
    provider: str,
    chat_assistant_id: str = "",
    user_id: str | None = None,
    context_id: str = "",
    auth_flow: str = "",
) -> None:
    """Persist a session row keyed by session_key.

    auth_flow distinguishes how the session was minted ("sso" for the OAuth
    callback; empty for BYOK/legacy rows) — BYOK sessions must never trigger
    Backboard thread import.
    """
    now_iso = datetime.now(timezone.utc).isoformat()
    now_epoch = int(time.time())
    item = {
        "session_key": session_key,
        "encrypted_key": encrypted_key,
        "provider": provider,
        "created_at": now_iso,
        "last_used_at": now_epoch,
        "ttl": _compute_ttl(),
    }
    if chat_assistant_id:
        item["chat_assistant_id"] = chat_assistant_id
    if user_id:
        item["user_id"] = user_id
    if context_id:
        item["context_id"] = context_id
    if auth_flow:
        item["auth_flow"] = auth_flow
    _memory_sessions[session_key] = item
    logger.info(
        "[session] store_session user_id=%s provider=%s auth_flow=%s ttl_days=%s expires_at=%s",
        user_id or "",
        provider,
        auth_flow or "",
        settings.session_ttl_days,
        item["ttl"],
    )
    try:
        table = _get_table()
        table.put_item(Item=item)
    except Exception as exc:
        logger.warning("[dynamo] store_session failed; using in-memory session fallback: %s", exc)


def get_session(session_key: str) -> dict | None:
    """Look up a session by its key. Returns None if not found or expired."""
    try:
        table = _get_table()
        resp = table.get_item(Key={"session_key": session_key})
        item = resp.get("Item")
    except Exception as exc:
        logger.warning("[dynamo] get_session failed; checking in-memory session fallback: %s", exc)
        item = _memory_sessions.get(session_key)
    if not item:
        return None

    # Check TTL manually (DynamoDB TTL deletion is eventual, not instant)
    if item.get("ttl") and int(item["ttl"]) <= int(time.time()):
        _memory_sessions.pop(session_key, None)
        return None

    return {
        "session_key": item["session_key"],
        "encrypted_key": item.get("encrypted_key", ""),
        "provider": item.get("provider", ""),
        "chat_assistant_id": item.get("chat_assistant_id", ""),
        "user_id": item.get("user_id"),
        "context_id": item.get("context_id", ""),
        "auth_flow": item.get("auth_flow", ""),
        "created_at": item.get("created_at", ""),
        "last_used_at": int(item.get("last_used_at", 0)),
        "ttl": item.get("ttl", 0),
    }


# Last successful touch per session (monotonic), so the throttle can skip the
# DynamoDB round-trip entirely. The ConditionExpression below stays as the
# cross-restart backstop — this dict only avoids paying the network call for
# writes the condition would reject anyway.
_last_touch: dict[str, float] = {}
_LAST_TOUCH_MAX_ENTRIES = 10_000


def touch_session(session_key: str) -> None:
    """Bump last_used_at and ttl on the session row.

    Throttled twice: in-process (skip the network call entirely inside the
    window) and by the row's ConditionExpression (authoritative across
    restarts). Best-effort; failures are swallowed because a missed touch
    only shortens the user's idle window.
    """
    now_mono = time.monotonic()
    last = _last_touch.get(session_key)
    if last is not None and (now_mono - last) < settings.session_touch_min_interval_seconds:
        return
    if len(_last_touch) >= _LAST_TOUCH_MAX_ENTRIES:
        # Cheap bound; over-touching after a clear is harmless (the DB
        # condition still rejects early writes).
        _last_touch.clear()
    _last_touch[session_key] = now_mono

    threshold = int(time.time()) - settings.session_touch_min_interval_seconds
    new_ts = int(time.time())
    new_ttl = _compute_ttl()
    # In-memory mirror (used when Dynamo is unavailable)
    mem = _memory_sessions.get(session_key)
    if mem is not None:
        if int(mem.get("last_used_at", 0)) > threshold:
            return
        mem["last_used_at"] = new_ts
        mem["ttl"] = new_ttl
    try:
        table = _get_table()
        table.update_item(
            Key={"session_key": session_key},
            UpdateExpression="SET last_used_at = :ts, #t = :ttl",
            ConditionExpression="attribute_exists(session_key) AND (attribute_not_exists(last_used_at) OR last_used_at < :threshold)",
            ExpressionAttributeNames={"#t": "ttl"},
            ExpressionAttributeValues={
                ":ts": new_ts,
                ":ttl": new_ttl,
                ":threshold": threshold,
            },
        )
    except ClientError as e:
        if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return  # Within throttle window — no write needed.
        logger.debug("[dynamo] touch_session conditional update failed: %s", e)
    except Exception as exc:
        logger.debug("[dynamo] touch_session non-fatal failure: %s", exc)


def update_session_context(
    session_key: str,
    *,
    encrypted_key: str,
    chat_assistant_id: str,
    context_id: str,
) -> bool:
    """Repoint an existing session row at another context's credentials.

    Used by in-app context switching: the session_key (and its cookie) stay
    the same; only the active key, assistant and context change. Never
    creates a row, and never touches user_id.

    Returns True only after the authoritative store accepted the write (the
    in-memory mirror is synced afterwards, so dev-mode read fallbacks agree).
    Returns False when the row no longer exists — callers must treat that as
    an invalid session. In local dev (settings.dynamo_endpoint configured)
    an unreachable DynamoDB falls back to the in-memory mirror, which is the
    operative store there; in prod (real DynamoDB, no endpoint override) any
    failed write raises so callers answer "try again" rather than misreport
    a switch that did not land — a timeout is ambiguous (the write may have
    landed), so retry is the only honest contract.
    """
    def _update_memory() -> bool:
        mem = _memory_sessions.get(session_key)
        if mem is None:
            return False
        mem["encrypted_key"] = encrypted_key
        mem["chat_assistant_id"] = chat_assistant_id
        mem["context_id"] = context_id
        return True

    try:
        table = _get_table()
        table.update_item(
            Key={"session_key": session_key},
            UpdateExpression="SET encrypted_key = :ek, chat_assistant_id = :aid, context_id = :ctx",
            ConditionExpression="attribute_exists(session_key)",
            ExpressionAttributeValues={
                ":ek": encrypted_key,
                ":aid": chat_assistant_id,
                ":ctx": context_id,
            },
        )
    except ClientError as e:
        if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
            # DynamoDB is reachable and says the row is gone (logged out
            # elsewhere / TTL) — a stale in-memory copy must not resurrect it.
            _memory_sessions.pop(session_key, None)
            return False
        # Reachable but rejected (throttle, permissions): the old row still
        # rules reads, so claiming success here would silently no-op the
        # switch and claiming expiry would log the user out.
        raise
    except Exception as exc:
        if not settings.dynamo_endpoint:
            # Prod (real DynamoDB): a transport fault is not the dev
            # fallback — reads still prefer Dynamo once it recovers, so the
            # mirror must not vote on the outcome.
            raise
        logger.warning(
            "[dynamo] update_session_context: DynamoDB unreachable, using in-memory session store: %s",
            exc,
        )
        return _update_memory()
    _update_memory()
    return True


def delete_session(session_key: str) -> bool:
    """Delete a session. Returns True if it existed."""
    existed_in_memory = _memory_sessions.pop(session_key, None) is not None
    try:
        table = _get_table()
        resp = table.delete_item(
            Key={"session_key": session_key},
            ReturnValues="ALL_OLD",
        )
        return bool(resp.get("Attributes")) or existed_in_memory
    except Exception:
        return existed_in_memory


def refresh_session(session_key: str) -> bool:
    """Extend the TTL of an existing session. Returns True if found."""
    new_ttl = _compute_ttl()
    if session_key in _memory_sessions:
        _memory_sessions[session_key]["ttl"] = new_ttl
    try:
        table = _get_table()
        table.update_item(
            Key={"session_key": session_key},
            UpdateExpression="SET #t = :ttl",
            ExpressionAttributeNames={"#t": "ttl"},
            ExpressionAttributeValues={":ttl": new_ttl},
            ConditionExpression="attribute_exists(session_key)",
        )
        return True
    except ClientError as e:
        if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return session_key in _memory_sessions
        raise
    except Exception:
        return session_key in _memory_sessions
