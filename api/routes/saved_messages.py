"""Saved ("bookmarked") assistant responses, and the folders they live in.

Naming: this is deliberately NOT called "bookmarks" on the storage side —
`TAG#` / `/api/tags` already owns that word in Nash (conversation tags are
labelled "Bookmarks" in the UI). Rows here are `SAVEDMSG#` / `SAVEDFOLDER#`.

Why a snapshot and not a reference: Nash persists no message text. Message
arrays are rebuilt per request from Backboard (`GET /api/messages/<cid>` →
`THREADMAP#{cid}` → `GET threads/{id}`), temporary chats have no `THREADMAP#`
row at all, and forking/regeneration can make a referenced message disappear.
So the row keeps a length-capped copy of the rendered text, exactly the way
`ADDEDRESPONSE#` and `DISPLAYTEXT#` already do.

Entity id is the Backboard `messageId`: the client toggles a save from the
message toolbar, where the message id is the only handle it reliably has.
`conversationId` rides along as an attribute for provenance and "Open in chat".
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from flask import Blueprint, jsonify, request

from api.middleware.session_auth import require_auth
from api.services import state_service
from api.services.backboard_service import get_request_state_partition

saved_messages_bp = Blueprint("saved_messages", __name__)


# DynamoDB's hard ceiling is 400 KB per item. A saved response holds four
# free-text columns, so each gets an explicit cap rather than relying on the
# writer to behave; the sum of the caps stays far under the ceiling even if
# every character is 4-byte UTF-8 (16000+4000+4000+300 chars ≈ 97 KB worst
# case). 16k characters is several times a typical long model answer.
SNAPSHOT_TEXT_LIMIT = 16000
CONTEXT_TEXT_LIMIT = 4000
NOTE_LIMIT = 4000
TITLE_LIMIT = 300
FOLDER_NAME_LIMIT = 200
FOLDER_DESCRIPTION_LIMIT = 1000

# `folderId` is nullable on a saved response; the design shows those under an
# implicit "Unsorted" bucket that has no folder row of its own.
UNSORTED_ID = "unsorted"

# Guard: /api/saved-messages/folders must never be interpreted as a message id.
_RESERVED_MESSAGE_IDS = {"folders"}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clip(value, limit: int) -> str:
    """Coerce to str and truncate to `limit` characters."""
    if value is None:
        return ""
    return str(value)[:limit]


def _int_or(value, default: int = 0) -> int:
    # Dynamo hands numbers back as Decimal, and jsonify renders Decimal as a
    # JSON *string* — which breaks strict client checks like `count === 0`.
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _serialize_saved(row: dict) -> dict:
    saved = {k: v for k, v in row.items() if k not in ("pk", "sk")}
    saved["truncated"] = bool(saved.get("truncated", False))
    return saved


def _serialize_folder(row: dict) -> dict:
    return {k: v for k, v in row.items() if k not in ("pk", "sk")}


def _sort_newest_first(rows: list[dict]) -> list[dict]:
    # createdAt is ISO-8601 UTC, so lexical sort == chronological sort.
    return sorted(rows, key=lambda r: str(r.get("createdAt") or ""), reverse=True)


def _normalize_folder_id(value) -> str | None:
    """`None`, `""` and the literal "unsorted" all mean the implicit bucket."""
    folder_id = (value or "").strip() if isinstance(value, str) else value
    if not folder_id or folder_id == UNSORTED_ID:
        return None
    return folder_id


# ---------------------------------------------------------------------------
# Saved responses
# ---------------------------------------------------------------------------


@saved_messages_bp.route("/api/saved-messages", methods=["GET"])
@require_auth
def list_saved_messages():
    """All saved responses, newest first. `?folderId=` filters; `unsorted` works."""
    user_id = get_request_state_partition()
    rows = state_service.saved_messages.list_for_user(user_id)

    if "folderId" in request.args:
        wanted = _normalize_folder_id(request.args.get("folderId"))
        known = _known_folder_ids(user_id)
        rows = [r for r in rows if _bucket_of(r, known) == wanted]

    return jsonify([_serialize_saved(r) for r in _sort_newest_first(rows)])


@saved_messages_bp.route("/api/saved-messages", methods=["POST"])
@require_auth
def create_saved_message():
    """Save a response. Idempotent on messageId — re-saving updates in place."""
    data = request.get_json() or {}
    user_id = get_request_state_partition()

    message_id = (data.get("messageId") or "").strip()
    if not message_id:
        return jsonify({"error": "messageId is required"}), 400
    if message_id in _RESERVED_MESSAGE_IDS:
        return jsonify({"error": "messageId is reserved"}), 400

    conversation_id = (data.get("conversationId") or "").strip()
    if not conversation_id:
        return jsonify({"error": "conversationId is required"}), 400

    text = _clip(data.get("text"), SNAPSHOT_TEXT_LIMIT)
    if not text:
        return jsonify({"error": "text is required"}), 400

    folder_id = _normalize_folder_id(data.get("folderId"))
    if folder_id and not state_service.saved_message_folders.get(user_id, folder_id):
        return jsonify({"error": "Folder not found"}), 404

    now = _now_iso()
    # Re-saving an already-saved response must not reset createdAt, and must
    # not silently drop a note or folder the caller did not resend.
    existing = state_service.saved_messages.get(user_id, message_id)
    saved = _serialize_saved(existing) if existing else {}

    saved["messageId"] = message_id
    saved["conversationId"] = conversation_id
    saved["text"] = text
    saved["truncated"] = len(str(data.get("text") or "")) > SNAPSHOT_TEXT_LIMIT
    # Optional fields follow the same rule as note below: only overwrite when
    # the key is present in the request. Unconditional assignment blanked
    # title/model/endpoint/context on a re-save that omitted them, contradicting
    # the documented idempotency ("re-saving preserves note/folder/createdAt").
    if "title" in data:
        saved["title"] = _clip(data.get("title"), TITLE_LIMIT)
    if "model" in data:
        saved["model"] = _clip(data.get("model"), TITLE_LIMIT)
    if "endpoint" in data:
        saved["endpoint"] = _clip(data.get("endpoint"), TITLE_LIMIT)
    # The design labels the preceding user turn "Context". The client already
    # has it on screen; the server cannot cheaply re-derive it (see docstring).
    if "context" in data:
        saved["context"] = _clip(data.get("context"), CONTEXT_TEXT_LIMIT)
    for key in ("title", "model", "endpoint", "context"):
        saved.setdefault(key, "")
    if data.get("note") is not None:
        saved["note"] = _clip(data.get("note"), NOTE_LIMIT)
    saved.setdefault("note", "")
    if data.get("folderId") is not None or "folderId" not in saved:
        saved["folderId"] = folder_id
    saved.setdefault("createdAt", now)
    saved["updatedAt"] = now

    state_service.saved_messages.put(user_id, message_id, saved)
    return jsonify(saved)


@saved_messages_bp.route("/api/saved-messages/<message_id>", methods=["PATCH"])
@require_auth
def update_saved_message(message_id):
    """Edit the note and/or move the response between folders."""
    if message_id in _RESERVED_MESSAGE_IDS:
        return jsonify({"error": "Not found"}), 404

    data = request.get_json() or {}
    user_id = get_request_state_partition()

    existing = state_service.saved_messages.get(user_id, message_id)
    if not existing:
        return jsonify({"error": "Not found"}), 404

    saved = _serialize_saved(existing)

    if "folderId" in data:
        folder_id = _normalize_folder_id(data.get("folderId"))
        if folder_id and not state_service.saved_message_folders.get(user_id, folder_id):
            return jsonify({"error": "Folder not found"}), 404
        saved["folderId"] = folder_id

    if "note" in data:
        saved["note"] = _clip(data.get("note"), NOTE_LIMIT)

    saved["updatedAt"] = _now_iso()
    state_service.saved_messages.put(user_id, message_id, saved)
    return jsonify(saved)


@saved_messages_bp.route("/api/saved-messages/<message_id>", methods=["DELETE"])
@require_auth
def delete_saved_message(message_id):
    if message_id in _RESERVED_MESSAGE_IDS:
        return jsonify({"error": "Not found"}), 404
    user_id = get_request_state_partition()
    if state_service.saved_messages.delete(user_id, message_id):
        return jsonify({"message": "Deleted"})
    return jsonify({"error": "Not found"}), 404


# ---------------------------------------------------------------------------
# Folders
# ---------------------------------------------------------------------------


def _known_folder_ids(user_id: str) -> set[str]:
    return {
        str(f.get("folderId"))
        for f in state_service.saved_message_folders.list_for_user(user_id)
        if f.get("folderId")
    }


def _bucket_of(row: dict, known: set[str]) -> str | None:
    """Which folder a row displays under.

    A folderId with no surviving folder row is treated as Unsorted, so a
    half-finished delete can never make a saved response unreachable.
    """
    folder_id = _normalize_folder_id(row.get("folderId"))
    return folder_id if folder_id in known else None


def _folder_stats(saved_rows: list[dict], known: set[str]) -> dict[str | None, dict]:
    """savedCount + newest member timestamp, keyed by folderId (None = Unsorted)."""
    stats: dict[str | None, dict] = {}
    for row in saved_rows:
        key = _bucket_of(row, known)
        bucket = stats.setdefault(key, {"savedCount": 0, "lastSavedAt": ""})
        bucket["savedCount"] += 1
        stamp = str(row.get("updatedAt") or row.get("createdAt") or "")
        if stamp > bucket["lastSavedAt"]:
            bucket["lastSavedAt"] = stamp
    return stats


@saved_messages_bp.route("/api/saved-messages/folders", methods=["GET"])
@require_auth
def list_saved_folders():
    """Folder cards: name, description, savedCount and "Updated <x> ago".

    `updatedAt` is the later of the folder's own edit time and its newest
    member's timestamp, because the card reads as activity, not metadata.
    The implicit Unsorted bucket is returned last as a virtual folder so the
    client can render it without inventing a row.
    """
    user_id = get_request_state_partition()
    saved_rows = state_service.saved_messages.list_for_user(user_id)
    folder_rows = state_service.saved_message_folders.list_for_user(user_id)
    known = {str(f.get("folderId")) for f in folder_rows if f.get("folderId")}
    stats = _folder_stats(saved_rows, known)

    folders = []
    for row in folder_rows:
        folder = _serialize_folder(row)
        bucket = stats.get(folder.get("folderId"), {})
        folder["savedCount"] = _int_or(bucket.get("savedCount"), 0)
        folder["lastSavedAt"] = bucket.get("lastSavedAt", "")
        folder["updatedAt"] = max(
            str(folder.get("updatedAt") or ""), folder["lastSavedAt"]
        )
        folder["virtual"] = False
        folders.append(folder)

    folders = sorted(folders, key=lambda f: str(f.get("createdAt") or ""))

    unsorted = stats.get(None, {})
    folders.append(
        {
            "folderId": UNSORTED_ID,
            "name": "Unsorted",
            "description": "",
            "createdAt": "",
            "updatedAt": unsorted.get("lastSavedAt", ""),
            "lastSavedAt": unsorted.get("lastSavedAt", ""),
            "savedCount": _int_or(unsorted.get("savedCount"), 0),
            # Virtual folders cannot be renamed or deleted.
            "virtual": True,
        }
    )
    return jsonify(folders)


@saved_messages_bp.route("/api/saved-messages/folders", methods=["POST"])
@require_auth
def create_saved_folder():
    data = request.get_json() or {}
    user_id = get_request_state_partition()

    name = _clip(data.get("name"), FOLDER_NAME_LIMIT).strip()
    if not name:
        return jsonify({"error": "name is required"}), 400

    now = _now_iso()
    folder = {
        "folderId": str(uuid.uuid4()),
        "name": name,
        "description": _clip(data.get("description"), FOLDER_DESCRIPTION_LIMIT),
        "createdAt": now,
        "updatedAt": now,
    }
    state_service.saved_message_folders.put(user_id, folder["folderId"], folder)
    return jsonify({**folder, "savedCount": 0, "lastSavedAt": "", "virtual": False})


@saved_messages_bp.route("/api/saved-messages/folders/<folder_id>", methods=["PATCH"])
@require_auth
def update_saved_folder(folder_id):
    if folder_id == UNSORTED_ID:
        return jsonify({"error": "The Unsorted folder cannot be edited"}), 400

    data = request.get_json() or {}
    user_id = get_request_state_partition()

    existing = state_service.saved_message_folders.get(user_id, folder_id)
    if not existing:
        return jsonify({"error": "Not found"}), 404

    folder = _serialize_folder(existing)
    if "name" in data:
        name = _clip(data.get("name"), FOLDER_NAME_LIMIT).strip()
        if not name:
            return jsonify({"error": "name is required"}), 400
        folder["name"] = name
    if "description" in data:
        folder["description"] = _clip(data.get("description"), FOLDER_DESCRIPTION_LIMIT)
    folder["updatedAt"] = _now_iso()

    state_service.saved_message_folders.put(user_id, folder_id, folder)
    return jsonify(folder)


@saved_messages_bp.route("/api/saved-messages/folders/<folder_id>", methods=["DELETE"])
@require_auth
def delete_saved_folder(folder_id):
    """Delete a folder without orphaning its contents — members go to Unsorted."""
    if folder_id == UNSORTED_ID:
        return jsonify({"error": "The Unsorted folder cannot be deleted"}), 400

    user_id = get_request_state_partition()
    if not state_service.saved_message_folders.get(user_id, folder_id):
        return jsonify({"error": "Not found"}), 404

    now = _now_iso()
    # Reparent in ONE batch before deleting the folder. A put() per member
    # could fail partway and strand the rest pointing at a folder that no
    # longer exists — such rows belong to no folder card and are not in
    # Unsorted either, so they vanish from every view while still in storage.
    reparented = []
    for row in state_service.saved_messages.list_for_user(user_id):
        if _normalize_folder_id(row.get("folderId")) != folder_id:
            continue
        saved = _serialize_saved(row)
        saved["folderId"] = None
        saved["updatedAt"] = now
        reparented.append((saved["messageId"], saved))

    state_service.saved_messages.batch_put(user_id, reparented)
    moved = len(reparented)
    state_service.saved_message_folders.delete(user_id, folder_id)
    return jsonify({"message": "Deleted", "movedToUnsorted": moved})
