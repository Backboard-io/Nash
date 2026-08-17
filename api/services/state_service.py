"""Nash DynamoDB single-table state store.

This module owns the `nash_state` table, which holds all of Nash's internal
state previously crammed into Backboard memories: folders, tags, presets,
agents, prompts, MCP servers, file metadata, conversation metadata, thread
mapping, regen graph, fallback notices, shared links, and user records.

Table layout (composite key):
  pk: S
  sk: S

Per-user rows:
  pk = USER#{user_hash}
  sk = PROFILE | FOLDER#{id} | TAG#{id} | PRESET#{id} | AGENT#{id}
       | PROMPT#{id} | PROMPTGROUP#{id} | MCP#{name} | FAVORITES
       | FILEMETA#{id} | CONVO#{thread_id} | THREADMAP#{thread_id}
       | REGEN#{thread_id} | FALLBACK#{thread_id} | MESSAGEFILES#{thread_id}
       | DISPLAYTEXT#{thread_id} | ADDEDRESPONSE#{thread_id}
       | DELETEDTHREAD#{thread_id} | MCPAUTH#{server_name}
       | GENMEDIA#{thread_id} | SAVEDMSG#{message_id}
       | SAVEDFOLDER#{folder_id} | ANALYTICS#{yyyy-mm-dd}

Global rows (cross-user singletons / shared resources):
  pk = GLOBAL                sk = SHARE#{share_id}

Lookup index rows (resolve external identifiers to user_hash):
  pk = EMAIL#{email}         sk = USERREF

`user_hash` is `sha256(api_key).hexdigest()` — the same hash the BYOK
apikey-login path uses at api/routes/auth.py to bind a user to their
Backboard key without storing plaintext.

Phase 0 ships primitives + key builders + per-entity Entity wrappers.
Per-domain rewrites in Phase 3 consume these directly; no domain logic
lives here.
"""

from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timezone
import os
import threading
import time
from typing import Any, Iterable

import boto3
from botocore.exceptions import ClientError

from api.config import settings

logger = logging.getLogger(__name__)

TABLE_NAME_DEFAULT = "nash_state"


def _debug_enabled() -> bool:
    val = os.environ.get("NASH_STATE_DEBUG", "1").strip().lower()
    return val not in ("0", "false", "no", "")


def _trunc(s: str | None, n: int = 40) -> str:
    if not s:
        return ""
    return s if len(s) <= n else s[:n] + "…"


def _emit(op: str, **fields: Any) -> None:
    if not _debug_enabled():
        return
    parts = [f"op={op}"]
    for k, v in fields.items():
        if v is None:
            continue
        if isinstance(v, str):
            parts.append(f"{k}={_trunc(v)}")
        else:
            parts.append(f"{k}={v}")
    logger.info("[state] " + " ".join(parts))

# ---------------------------------------------------------------------------
# Partition key builders
# ---------------------------------------------------------------------------

def user_pk(user_hash: str) -> str:
    return f"USER#{user_hash}"


def email_lookup_pk(email: str) -> str:
    return f"EMAIL#{email.lower().strip()}"


GLOBAL_PK = "GLOBAL"

# ---------------------------------------------------------------------------
# Sort key constants / prefixes
# ---------------------------------------------------------------------------

# Singletons (full SK is fixed)
SK_PROFILE = "PROFILE"
SK_FAVORITES = "FAVORITES"
SK_USERREF = "USERREF"

# Repeating per-user entities (prefix; full SK is `{prefix}{entity_id}`)
SK_FOLDER_PREFIX = "FOLDER#"
SK_TAG_PREFIX = "TAG#"
SK_PRESET_PREFIX = "PRESET#"
SK_AGENT_PREFIX = "AGENT#"
SK_PROMPT_PREFIX = "PROMPT#"
SK_PROMPTGROUP_PREFIX = "PROMPTGROUP#"
SK_MCP_PREFIX = "MCP#"
SK_FILEMETA_PREFIX = "FILEMETA#"
SK_CONVO_PREFIX = "CONVO#"
SK_THREADMAP_PREFIX = "THREADMAP#"
SK_REGEN_PREFIX = "REGEN#"
SK_FALLBACK_PREFIX = "FALLBACK#"
SK_MESSAGEFILES_PREFIX = "MESSAGEFILES#"
SK_DISPLAYTEXT_PREFIX = "DISPLAYTEXT#"
SK_DELETEDTHREAD_PREFIX = "DELETEDTHREAD#"
SK_ANALYTICS_PREFIX = "ANALYTICS#"
SK_ADDEDRESPONSE_PREFIX = "ADDEDRESPONSE#"
# Per-user OAuth tokens for OAuth-authenticated MCP servers (Google Workspace,
# etc). One row per (user, server); token values are encrypted at rest.
SK_MCPAUTH_PREFIX = "MCPAUTH#"
SK_GENMEDIA_PREFIX = "GENMEDIA#"
# A single assistant response the user chose to keep ("bookmark a response").
# Nash stores no message text server-side, so the row carries a length-capped
# TEXT SNAPSHOT, not just a (conversationId, messageId) reference.
SK_SAVEDMSG_PREFIX = "SAVEDMSG#"
# User-created folder a saved response can be filed under. Deliberately NOT
# named "bookmark" — that word already means conversation tags (TAG#).
SK_SAVEDFOLDER_PREFIX = "SAVEDFOLDER#"

# Global repeating entities
SK_SHARE_PREFIX = "SHARE#"


# ---------------------------------------------------------------------------
# Identity helper
# ---------------------------------------------------------------------------

def user_hash_from_api_key(api_key: str) -> str:
    """Stable per-user partition handle. Matches api/routes/auth.py:411."""
    return hashlib.sha256(api_key.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Boto3 plumbing
# ---------------------------------------------------------------------------

def _boto_kwargs() -> dict[str, Any]:
    kwargs: dict[str, Any] = {"region_name": settings.dynamo_region or "us-east-1"}
    endpoint = settings.dynamo_endpoint
    if endpoint:
        kwargs["endpoint_url"] = endpoint
    return kwargs


def _table_name() -> str:
    return settings.dynamo_state_table or TABLE_NAME_DEFAULT


# One table handle per thread. Rebuilding boto3.resource per call costs
# client construction plus a fresh TLS handshake per DynamoDB operation
# (a chat turn does ~7, a conversation load ~10). Thread-local because boto3
# resources aren't documented thread-safe and chat generation runs in real
# threads alongside the gevent request greenlets.
_thread_local = threading.local()


def _get_table():
    cache_key = (settings.dynamo_region, settings.dynamo_endpoint, _table_name())
    if getattr(_thread_local, "state_table_key", None) == cache_key:
        return _thread_local.state_table
    resource = boto3.resource("dynamodb", **_boto_kwargs())
    table = resource.Table(_table_name())
    _thread_local.state_table = table
    _thread_local.state_table_key = cache_key
    return table


def _get_client():
    return boto3.client("dynamodb", **_boto_kwargs())


def ensure_state_table() -> None:
    """Create `nash_state` if it doesn't exist. Idempotent."""
    client = _get_client()
    name = _table_name()
    try:
        client.describe_table(TableName=name)
        return
    except ClientError as e:
        if e.response["Error"]["Code"] != "ResourceNotFoundException":
            raise

    client.create_table(
        TableName=name,
        KeySchema=[
            {"AttributeName": "pk", "KeyType": "HASH"},
            {"AttributeName": "sk", "KeyType": "RANGE"},
        ],
        AttributeDefinitions=[
            {"AttributeName": "pk", "AttributeType": "S"},
            {"AttributeName": "sk", "AttributeType": "S"},
        ],
        BillingMode="PAY_PER_REQUEST",
    )
    client.get_waiter("table_exists").wait(TableName=name)


# ---------------------------------------------------------------------------
# Generic primitives
# ---------------------------------------------------------------------------

def put_item(pk: str, sk: str, attributes: dict[str, Any]) -> None:
    """Write a single item. `attributes` must not contain `pk`/`sk` (they're set here)."""
    item = {**attributes, "pk": pk, "sk": sk}
    _get_table().put_item(Item=item)
    _emit("put", pk=pk, sk=sk)


def compare_and_set_item(
    pk: str,
    sk: str,
    attributes: dict[str, Any],
    *,
    expected_version: int,
    item_exists: bool,
) -> bool:
    """Replace an item only when its optimistic-lock version still matches.

    Legacy rows have no ``_version`` and are treated as version zero.  The
    caller can retry after a conditional failure, which makes read/merge/write
    updates safe without changing their stored shape.
    """
    next_version = expected_version + 1
    item = {**attributes, "_version": next_version, "pk": pk, "sk": sk}
    if item_exists:
        if expected_version == 0:
            condition = "attribute_exists(pk) AND attribute_not_exists(#version)"
            values = None
        else:
            condition = "#version = :expected_version"
            values = {":expected_version": expected_version}
    else:
        condition = "attribute_not_exists(pk)"
        values = None

    kwargs: dict[str, Any] = {
        "Item": item,
        "ConditionExpression": condition,
    }
    if "#version" in condition:
        kwargs["ExpressionAttributeNames"] = {"#version": "_version"}
    if values:
        kwargs["ExpressionAttributeValues"] = values
    try:
        _get_table().put_item(**kwargs)
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            _emit("compare_and_set_conflict", pk=pk, sk=sk)
            return False
        raise
    _emit("compare_and_set", pk=pk, sk=sk, version=next_version)
    return True


def get_item(pk: str, sk: str) -> dict[str, Any] | None:
    resp = _get_table().get_item(Key={"pk": pk, "sk": sk})
    item = resp.get("Item")
    _emit("get", pk=pk, sk=sk, found=bool(item))
    return item


def delete_item(pk: str, sk: str) -> bool:
    """Delete a single item. Returns True if it existed."""
    resp = _get_table().delete_item(
        Key={"pk": pk, "sk": sk},
        ReturnValues="ALL_OLD",
    )
    existed = bool(resp.get("Attributes"))
    _emit("delete", pk=pk, sk=sk, existed=existed)
    return existed


def query_user(pk: str) -> list[dict[str, Any]]:
    """Return every row under a single partition. Paginates."""
    return query_prefix(pk, sk_prefix=None)


def query_range(pk: str, sk_start: str, sk_end: str) -> list[dict[str, Any]]:
    """Return rows under `pk` with sk BETWEEN sk_start AND sk_end (inclusive).

    For date-shaped sort keys (ISO dates sort lexicographically) this bounds a
    read to a window instead of scanning an ever-growing history.
    """
    start = time.perf_counter()
    table = _get_table()
    kwargs: dict[str, Any] = {
        "KeyConditionExpression": (
            boto3.dynamodb.conditions.Key("pk").eq(pk)
            & boto3.dynamodb.conditions.Key("sk").between(sk_start, sk_end)
        )
    }
    items: list[dict[str, Any]] = []
    while True:
        resp = table.query(**kwargs)
        items.extend(resp.get("Items", []))
        last_key = resp.get("LastEvaluatedKey")
        if not last_key:
            break
        kwargs["ExclusiveStartKey"] = last_key
    _emit("query_range", pk=pk, sk_start=sk_start, sk_end=sk_end, count=len(items),
          ms=int((time.perf_counter() - start) * 1000))
    return items


def query_prefix(pk: str, sk_prefix: str | None) -> list[dict[str, Any]]:
    """Return rows under `pk` whose `sk` begins with `sk_prefix` (or all if None)."""
    start = time.perf_counter()
    table = _get_table()
    kwargs: dict[str, Any] = {}
    if sk_prefix:
        kwargs["KeyConditionExpression"] = (
            boto3.dynamodb.conditions.Key("pk").eq(pk)
            & boto3.dynamodb.conditions.Key("sk").begins_with(sk_prefix)
        )
    else:
        kwargs["KeyConditionExpression"] = boto3.dynamodb.conditions.Key("pk").eq(pk)

    items: list[dict[str, Any]] = []
    while True:
        resp = table.query(**kwargs)
        items.extend(resp.get("Items", []))
        last = resp.get("LastEvaluatedKey")
        if not last:
            break
        kwargs["ExclusiveStartKey"] = last
    _emit("query", pk=pk, sk_prefix=sk_prefix or "*", count=len(items),
          ms=int((time.perf_counter() - start) * 1000))
    return items


def batch_put(items: Iterable[dict[str, Any]]) -> None:
    """Write many items in one shot. Each item must include `pk` and `sk`."""
    table = _get_table()
    count = 0
    with table.batch_writer() as batch:
        for item in items:
            if "pk" not in item or "sk" not in item:
                raise ValueError("batch_put item missing pk/sk")
            batch.put_item(Item=item)
            count += 1
    _emit("batch_put", count=count)


def batch_delete(keys: Iterable[tuple[str, str]]) -> None:
    """Delete many items in one shot. `keys` is an iterable of (pk, sk) tuples."""
    table = _get_table()
    count = 0
    with table.batch_writer() as batch:
        for pk, sk in keys:
            batch.delete_item(Key={"pk": pk, "sk": sk})
            count += 1
    _emit("batch_delete", count=count)


def transact_write(actions: list[dict[str, Any]]) -> None:
    """Atomic multi-item write. Each action is a raw TransactWriteItem.

    Example:
      transact_write([
        {"Put": {"TableName": _table_name(), "Item": {...}}},
        {"Put": {"TableName": _table_name(), "Item": {...}}},
      ])
    """
    if not actions:
        return
    _get_client().transact_write_items(TransactItems=actions)


def table_name() -> str:
    """Return the configured table name for callers building transactions."""
    return _table_name()


def transact_put_items(items: list[tuple[str, str, dict[str, Any]]]) -> None:
    """Atomic put of multiple items. Each tuple is (pk, sk, attributes).

    Convenience wrapper around `transact_write` that serializes Python dicts
    to DynamoDB AttributeValue format. Use this for cross-row consistency
    (e.g. user PROFILE + EMAIL/SUB lookup index rows).
    """
    if not items:
        return
    from boto3.dynamodb.types import TypeSerializer
    serializer = TypeSerializer()
    table = _table_name()
    actions: list[dict[str, Any]] = []
    for pk, sk, attrs in items:
        record = {**attrs, "pk": pk, "sk": sk}
        serialized = {k: serializer.serialize(v) for k, v in record.items()}
        actions.append({"Put": {"TableName": table, "Item": serialized}})
    _get_client().transact_write_items(TransactItems=actions)
    _emit("transact_put", count=len(items))


# ---------------------------------------------------------------------------
# Cross-partition scans
# ---------------------------------------------------------------------------

def scan_profile_rows() -> list[dict[str, Any]]:
    """Return every USER#{...} PROFILE row in the table.

    DynamoDB Scan is expensive at scale, but for OSS admin listings of user
    counts measured in hundreds this is fine. If a deployment outgrows it,
    add a GSI on (sk, pk) and query SK=PROFILE instead.
    """
    start = time.perf_counter()
    table = _get_table()
    kwargs: dict[str, Any] = {
        "FilterExpression": (
            boto3.dynamodb.conditions.Attr("sk").eq(SK_PROFILE)
            & boto3.dynamodb.conditions.Attr("pk").begins_with("USER#")
        ),
    }
    items: list[dict[str, Any]] = []
    while True:
        resp = table.scan(**kwargs)
        items.extend(resp.get("Items", []))
        last = resp.get("LastEvaluatedKey")
        if not last:
            break
        kwargs["ExclusiveStartKey"] = last
    _emit("scan_profiles", count=len(items),
          ms=int((time.perf_counter() - start) * 1000))
    return items


def scan_sk_prefix(sk_prefix: str) -> list[dict[str, Any]]:
    """Cross-partition scan returning every row whose `sk` begins with `sk_prefix`.

    Used for cross-user lookups (e.g. finding a public agent by id across all
    users). Same scale caveat as `scan_profile_rows`.
    """
    start = time.perf_counter()
    table = _get_table()
    kwargs: dict[str, Any] = {
        "FilterExpression": boto3.dynamodb.conditions.Attr("sk").begins_with(sk_prefix),
    }
    items: list[dict[str, Any]] = []
    while True:
        resp = table.scan(**kwargs)
        items.extend(resp.get("Items", []))
        last = resp.get("LastEvaluatedKey")
        if not last:
            break
        kwargs["ExclusiveStartKey"] = last
    _emit("scan_sk_prefix", sk_prefix=sk_prefix, count=len(items),
          ms=int((time.perf_counter() - start) * 1000))
    return items


# ---------------------------------------------------------------------------
# Entity wrappers
# ---------------------------------------------------------------------------

class _Entity:
    """Per-user repeating entity (folders, tags, presets, …).

    Each row is `pk=USER#{hash}, sk={prefix}{entity_id}`. Callers pass an
    `attributes` dict — the wrapper stamps pk/sk on top.
    """

    def __init__(self, sk_prefix: str):
        self._prefix = sk_prefix

    def _sk(self, entity_id: str) -> str:
        return f"{self._prefix}{entity_id}"

    def put(self, user_hash: str, entity_id: str, attributes: dict[str, Any]) -> None:
        put_item(user_pk(user_hash), self._sk(entity_id), attributes)

    def get(self, user_hash: str, entity_id: str) -> dict[str, Any] | None:
        return get_item(user_pk(user_hash), self._sk(entity_id))

    def list_for_user(self, user_hash: str) -> list[dict[str, Any]]:
        return query_prefix(user_pk(user_hash), self._prefix)

    def delete(self, user_hash: str, entity_id: str) -> bool:
        return delete_item(user_pk(user_hash), self._sk(entity_id))

    def batch_put(self, user_hash: str, entries: list[tuple[str, dict[str, Any]]]) -> None:
        """Write many rows for one user in a single batch.

        `entries` is (entity_id, attributes); pk/sk are stamped here so callers
        never hand-build keys. Use this instead of a put() loop whenever a
        partial write would leave the data inconsistent.
        """
        if not entries:
            return
        pk = user_pk(user_hash)
        batch_put(
            [{**attributes, "pk": pk, "sk": self._sk(entity_id)} for entity_id, attributes in entries]
        )


class _Singleton:
    """Per-user singleton row (FAVORITES, PROFILE). One row per user, fixed SK."""

    def __init__(self, sk: str):
        self._sk = sk

    def put(self, user_hash: str, attributes: dict[str, Any]) -> None:
        put_item(user_pk(user_hash), self._sk, attributes)

    def get(self, user_hash: str) -> dict[str, Any] | None:
        return get_item(user_pk(user_hash), self._sk)

    def delete(self, user_hash: str) -> bool:
        return delete_item(user_pk(user_hash), self._sk)


class _GlobalEntity:
    """Cross-user repeating entity under the GLOBAL partition (e.g. SHARE#)."""

    def __init__(self, sk_prefix: str):
        self._prefix = sk_prefix

    def _sk(self, entity_id: str) -> str:
        return f"{self._prefix}{entity_id}"

    def put(self, entity_id: str, attributes: dict[str, Any]) -> None:
        put_item(GLOBAL_PK, self._sk(entity_id), attributes)

    def get(self, entity_id: str) -> dict[str, Any] | None:
        return get_item(GLOBAL_PK, self._sk(entity_id))

    def list_all(self) -> list[dict[str, Any]]:
        return query_prefix(GLOBAL_PK, self._prefix)

    def delete(self, entity_id: str) -> bool:
        return delete_item(GLOBAL_PK, self._sk(entity_id))


class _GlobalSingleton:
    """Singleton row in the GLOBAL partition (e.g. CATALOGSNAP)."""

    def __init__(self, sk: str):
        self._sk = sk

    def put(self, attributes: dict[str, Any]) -> None:
        put_item(GLOBAL_PK, self._sk, attributes)

    def get(self) -> dict[str, Any] | None:
        return get_item(GLOBAL_PK, self._sk)

    def delete(self) -> bool:
        return delete_item(GLOBAL_PK, self._sk)


# Per-user repeating entities
folders = _Entity(SK_FOLDER_PREFIX)
tags = _Entity(SK_TAG_PREFIX)
presets = _Entity(SK_PRESET_PREFIX)
agents = _Entity(SK_AGENT_PREFIX)
prompts = _Entity(SK_PROMPT_PREFIX)
prompt_groups = _Entity(SK_PROMPTGROUP_PREFIX)
mcp_servers = _Entity(SK_MCP_PREFIX)
# Per-user OAuth tokens for OAuth MCP servers (encrypted values in the row).
mcp_oauth_tokens = _Entity(SK_MCPAUTH_PREFIX)
class _CreatedStampedEntity(_Entity):
    """_Entity that records createdAt once, at first write.

    setdefault (not overwrite): callers re-put full row dicts on updates, so a
    row that already carries createdAt keeps it. updatedAt is deliberately NOT
    auto-bumped here — most file_meta re-puts are system bookkeeping (generated
    media heal, status flips), and stamping them would surface as a user-facing
    "Modified" time that lies. Anything that IS a user modification sets
    updatedAt itself.
    """

    def put(self, user_hash: str, entity_id: str, attributes: dict[str, Any]) -> None:
        attributes = dict(attributes)
        attributes.setdefault(
            "createdAt",
            datetime.now(timezone.utc).isoformat(),
        )
        super().put(user_hash, entity_id, attributes)


file_meta = _CreatedStampedEntity(SK_FILEMETA_PREFIX)
convo_meta = _Entity(SK_CONVO_PREFIX)
thread_map = _Entity(SK_THREADMAP_PREFIX)
regen_graph = _Entity(SK_REGEN_PREFIX)
fallback_notice = _Entity(SK_FALLBACK_PREFIX)
message_files = _Entity(SK_MESSAGEFILES_PREFIX)
display_text = _Entity(SK_DISPLAYTEXT_PREFIX)
# Tombstones for Backboard threads deleted via Nash — consulted by the thread
# import so a thread whose Backboard-side delete failed is never resurrected.
deleted_threads = _Entity(SK_DELETEDTHREAD_PREFIX)
# Added-model (multi-conversation) one-shot responses, keyed per conversation.
# The Backboard thread that produced them is disposable; this row is the
# durable copy merged back into GET /api/messages.
added_response = _Entity(SK_ADDEDRESPONSE_PREFIX)
generated_media = _Entity(SK_GENMEDIA_PREFIX)
# Saved ("bookmarked") assistant responses. Keyed by the Backboard message id.
# The Backboard thread is not a reliable source of truth for the text — it can
# be forked, branched or (for temporary chats) have no THREADMAP# row at all —
# so this row is the durable snapshot, the same reasoning as ADDEDRESPONSE#.
saved_messages = _Entity(SK_SAVEDMSG_PREFIX)
# Folders that saved responses are filed under. A saved response with no
# folderId is "Unsorted"; that bucket is implicit and has no row.
saved_message_folders = _Entity(SK_SAVEDFOLDER_PREFIX)

# Per-user singletons
profile = _Singleton(SK_PROFILE)
favorites = _Singleton(SK_FAVORITES)

# Global
shared_links = _GlobalEntity(SK_SHARE_PREFIX)
# Last-good Backboard catalog snapshot (gzip JSON bytes) so a freshly deployed
# process boots warm instead of paying the multi-request catalog fetch on the
# first user's /api/init. Written by model_catalog_service after a successful
# refresh; read once at create_app.
catalog_snapshot = _GlobalSingleton("CATALOGSNAP")
