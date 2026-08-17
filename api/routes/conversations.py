import logging
import uuid
from datetime import datetime, timezone

from flask import Blueprint, request, jsonify

from api.middleware.session_auth import require_auth
from api.services import state_service
from api.services.async_runner import run_async
from api.services.backboard_service import (
    get_request_assistant_id,
    get_request_client,
    get_request_state_partition,
    get_thread_messages,
    is_user_visible_message,
    role_name,
)
from api.services.conversation_service import (
    add_thread_mapping,
    content_with_added_response,
    delete_conversation_meta,
    get_added_response_map,
    get_conversation_meta,
    get_display_file_map,
    get_display_text_map,
    get_or_create_thread,
    get_thread_id_for_conversation,
    get_thread_owner,
    list_conversations,
    list_folder_conversation_ids,
    remove_thread_mapping,
    save_conversation_meta,
)

logger = logging.getLogger(__name__)

conversations_bp = Blueprint("conversations", __name__)


def _user_bb_client():
    return get_request_client()


def _folder_bb_assistant_id(user_id: str, folder_id: str) -> str:
    row = state_service.folders.get(user_id, folder_id)
    return str((row or {}).get("bb_assistant_id", ""))


@conversations_bp.route("/api/convos", methods=["GET"])
@require_auth
def get_conversations():
    user_id = get_request_state_partition()
    is_archived = request.args.get("isArchived", "false").lower() == "true"
    folder_id = request.args.get("folderId")
    tags = request.args.getlist("tags")

    if folder_id and folder_id != "none":
        folder_owner = _folder_bb_assistant_id(user_id, folder_id)
        if not folder_owner:
            return jsonify({"conversations": [], "pageSize": 25, "pages": 1, "pageNumber": "1", "nextCursor": None})

        folder_entries = list_folder_conversation_ids(user_id, folder_owner)
        all_convos = list_conversations(user_id)
        meta_by_id = {c.get("conversationId"): c for c in all_convos}

        convos = []
        for entry in folder_entries:
            cid = entry["conversationId"]
            meta = meta_by_id.get(cid)
            if meta:
                if not meta.get("folderId"):
                    # Lazy patch: thread_map says folder but meta doesn't.
                    patched = {**meta, "folderId": folder_id, "hidden": True}
                    save_conversation_meta(user_id, cid, {"folderId": folder_id, "hidden": True})
                    convos.append(patched)
                else:
                    convos.append(meta)
            else:
                convos.append({"conversationId": cid, "title": "New Chat", "endpoint": "", "model": "", "isArchived": False, "tags": [], "createdAt": "", "updatedAt": "", "folderId": folder_id, "hidden": True})

        filtered = [c for c in convos if c.get("isArchived", False) == is_archived]
        if tags:
            filtered = [c for c in filtered if any(t in (c.get("tags") or []) for t in tags)]
    else:
        # Main list: exclude conversations that belong to a folder.
        all_convos = list_conversations(user_id)
        filtered = []
        for c in all_convos:
            if c.get("isArchived", False) != is_archived:
                continue
            if c.get("hidden") or c.get("folderId"):
                continue
            if tags and not any(t in (c.get("tags") or []) for t in tags):
                continue
            filtered.append(c)

    page_size = int(request.args.get("pageSize", "25"))
    cursor = request.args.get("cursor")

    start_idx = 0
    if cursor:
        for i, c in enumerate(filtered):
            if c.get("conversationId") == cursor:
                start_idx = i + 1
                break

    page = filtered[start_idx:start_idx + page_size]
    next_cursor = page[-1]["conversationId"] if len(page) == page_size else None

    return jsonify({
        "conversations": [_format_convo(c) for c in page],
        "pageSize": page_size,
        "pages": 1,
        "pageNumber": "1",
        "nextCursor": next_cursor,
    })


@conversations_bp.route("/api/convos/<conversation_id>", methods=["GET"])
@require_auth
def get_conversation(conversation_id):
    user_id = get_request_state_partition()
    convos = list_conversations(user_id)
    for c in convos:
        if c.get("conversationId") == conversation_id:
            return jsonify(_format_convo(c))

    # Conversation might only have a thread_map row (created before convo_meta
    # was lazy-written). Derive the folder from the thread's owner_assistant_id.
    owner = get_thread_owner(user_id, conversation_id)
    if owner:
        folder_id = ""
        for f in state_service.folders.list_for_user(user_id):
            if f.get("bb_assistant_id") == owner:
                folder_id = f.get("folderId") or ""
                break
        if folder_id:
            now = datetime.now(timezone.utc).isoformat()
            synthetic = {
                "conversationId": conversation_id,
                "title": "New Chat",
                "endpoint": "",
                "model": "",
                "isArchived": False,
                "tags": [],
                "folderId": folder_id,
                "hidden": True,
                "createdAt": now,
                "updatedAt": now,
            }
            save_conversation_meta(user_id, conversation_id, synthetic)
            return jsonify(_format_convo(synthetic))

    return jsonify({"error": "Not found"}), 404


@conversations_bp.route("/api/convos/update", methods=["POST"])
@require_auth
def update_conversation():
    data = request.get_json() or {}
    arg = data.get("arg", {})
    conversation_id = arg.get("conversationId")
    if not conversation_id:
        return jsonify({"error": "conversationId required"}), 400

    user_id = get_request_state_partition()
    convos = list_conversations(user_id)
    existing = None
    for c in convos:
        if c.get("conversationId") == conversation_id:
            existing = c
            break

    meta = existing or {"conversationId": conversation_id}
    if "title" in arg:
        meta["title"] = arg["title"]
    if "folderId" in arg:
        meta["folderId"] = arg["folderId"]
    if "tags" in arg:
        meta["tags"] = arg["tags"]
    if "isPinned" in arg:
        meta["isPinned"] = arg["isPinned"]

    save_conversation_meta(user_id, conversation_id, meta)
    return jsonify(_format_convo(meta))


@conversations_bp.route("/api/convos/archive", methods=["POST"])
@require_auth
def archive_conversation():
    data = request.get_json() or {}
    # The data-provider wraps the payload in an "arg" envelope (same as the
    # update/delete routes); accept bare payloads too.
    arg = data.get("arg", data) or {}
    conversation_id = arg.get("conversationId")
    is_archived = arg.get("isArchived", True)
    if not conversation_id:
        return jsonify({"error": "conversationId required"}), 400

    user_id = get_request_state_partition()
    convos = list_conversations(user_id)
    for c in convos:
        if c.get("conversationId") == conversation_id:
            c["isArchived"] = is_archived
            save_conversation_meta(user_id, conversation_id, c)
            return jsonify(_format_convo(c))
    return jsonify({"error": "Not found"}), 404


@conversations_bp.route("/api/convos", methods=["DELETE"])
@require_auth
def delete_conversation():
    data = request.get_json() or {}
    arg = data.get("arg", data)
    conversation_id = arg.get("conversationId") or data.get("conversationId")
    if not conversation_id:
        return jsonify({"error": "conversationId required"}), 400

    user_id = get_request_state_partition()
    bb = _user_bb_client()

    # Delete the Backboard thread (cascades to its thread-scoped documents).
    thread_id = get_thread_id_for_conversation(user_id, conversation_id)
    if thread_id:
        try:
            run_async(bb.delete_thread(thread_id))
        except Exception:
            # Non-fatal: if Backboard fails to delete the thread we still
            # want the DynamoDB cleanup to proceed.
            pass
        # Tombstone unconditionally: the except above swallows delete
        # failures, and Backboard list reads may be eventually consistent —
        # the thread import must never resurrect this conversation.
        try:
            state_service.deleted_threads.put(user_id, thread_id, {
                "thread_id": thread_id,
                "conversation_id": conversation_id,
                "deletedAt": datetime.now(timezone.utc).isoformat(),
            })
        except Exception:
            logger.warning("[convos] tombstone write failed (non-fatal)")

    remove_thread_mapping(user_id, conversation_id)
    delete_conversation_meta(user_id, conversation_id)
    return jsonify({"message": "Deleted"})


@conversations_bp.route("/api/convos/gen_title/<conversation_id>", methods=["GET"])
@require_auth
def gen_title(conversation_id):
    user_id = get_request_state_partition()
    assistant_id = get_request_assistant_id()
    bb = _user_bb_client()

    thread_id = get_thread_id_for_conversation(user_id, conversation_id)
    if not thread_id:
        return jsonify({"title": "New Chat"})

    async def _generate():
        messages = await get_thread_messages(thread_id, bb)
        if not messages:
            return "New Chat"
        first_user = ""
        first_assistant = ""
        for m in messages[:4]:
            role = role_name(m)
            if role == "user" and not first_user:
                first_user = (m.content or "")[:200]
            elif role == "assistant" and not first_assistant:
                first_assistant = (m.content or "")[:200]
        snippet = first_user or first_assistant or "New Chat"
        title_thread = await bb.create_thread(assistant_id)
        try:
            resp = await bb.add_message(
                thread_id=title_thread.thread_id,
                content=f"Generate a concise title (max 6 words) for a conversation that starts with: \"{snippet}\". Reply with ONLY the title, no quotes.",
                stream=False,
            )
            return (resp.content or "New Chat").strip().strip('"').strip("'")[:80]
        finally:
            # Scratch thread — must not linger under the main assistant or it
            # would surface in the Backboard thread import.
            try:
                await bb.delete_thread(title_thread.thread_id)
            except Exception:
                logger.warning("[convos] title scratch-thread delete failed (non-fatal)")

    try:
        title = run_async(_generate())
    except Exception:
        logger.warning(
            "[convos] gen_title failed for conversation %s (non-fatal, falling back to New Chat)",
            conversation_id,
            exc_info=True,
        )
        title = None

    if title and title != "New Chat":
        save_conversation_meta(user_id, conversation_id, {"title": title})
    elif not title:
        title = "New Chat"

    return jsonify({"title": title})


@conversations_bp.route("/api/convos/fork", methods=["POST"])
@require_auth
def fork_conversation():
    data = request.get_json() or {}
    message_id = data.get("messageId")
    conversation_id = data.get("conversationId")
    split_at_target = data.get("splitAtTarget", False)

    if not message_id or not conversation_id:
        return jsonify({"error": "messageId and conversationId required"}), 400

    user_id = get_request_state_partition()
    assistant_id = get_request_assistant_id()
    bb = _user_bb_client()

    src_thread_id = get_thread_id_for_conversation(user_id, conversation_id)
    if not src_thread_id:
        return jsonify({"error": "Source conversation not found"}), 404

    src_meta = _get_source_conversation_meta(user_id, conversation_id)
    src_messages = _get_source_display_messages(
        conversation_id, src_thread_id, bb, src_meta, user_id=user_id
    )
    if not src_messages:
        return jsonify({"error": "Source conversation has no messages to fork"}), 404

    target_idx = len(src_messages) - 1
    for i, m in enumerate(src_messages):
        if str(m.get("messageId", "")) == message_id:
            target_idx = i
            break

    sliced = src_messages[target_idx:] if split_at_target else src_messages[:target_idx + 1]

    fork_meta, snapshot = _create_snapshot_conversation(
        user_id=user_id,
        assistant_id=assistant_id,
        bb=bb,
        source_conversation_id=conversation_id,
        source_meta=src_meta,
        source_messages=sliced,
        title_prefix="Fork",
    )

    return jsonify({"conversation": _format_convo(fork_meta), "messages": snapshot})


@conversations_bp.route("/api/convos/duplicate", methods=["POST"])
@require_auth
def duplicate_conversation():
    data = request.get_json() or {}
    conversation_id = data.get("conversationId")
    if not conversation_id:
        return jsonify({"error": "conversationId required"}), 400

    user_id = get_request_state_partition()
    assistant_id = get_request_assistant_id()
    bb = _user_bb_client()

    src_thread_id = get_thread_id_for_conversation(user_id, conversation_id)
    if not src_thread_id:
        return jsonify({"error": "Source conversation not found"}), 404

    src_meta = _get_source_conversation_meta(user_id, conversation_id)
    src_messages = _get_source_display_messages(
        conversation_id, src_thread_id, bb, src_meta, user_id=user_id
    )
    if not src_messages:
        return jsonify({"error": "Source conversation has no messages to duplicate"}), 404

    dup_meta, snapshot = _create_snapshot_conversation(
        user_id=user_id,
        assistant_id=assistant_id,
        bb=bb,
        source_conversation_id=conversation_id,
        source_meta=src_meta,
        source_messages=src_messages,
        title_prefix="Copy",
    )

    return jsonify({"conversation": _format_convo(dup_meta), "messages": snapshot})


@conversations_bp.route("/api/convos/<conversation_id>/folder", methods=["PUT"])
@require_auth
def move_to_folder(conversation_id):
    """Move a conversation into (or out of) a folder.

    With Phase 3 storage, "moving" is just updating the THREADMAP row's owner
    and the CONVO_META's folderId. The underlying Backboard thread isn't
    moved — only the bookkeeping flips so the conversation surfaces in the
    folder's listing.
    """
    data = request.get_json() or {}
    folder_id = data.get("folderId")  # None / "" means remove from current folder

    user_id = get_request_state_partition()

    convos = list_conversations(user_id)
    convo_meta = next((c for c in convos if c.get("conversationId") == conversation_id), None)
    if not convo_meta:
        return jsonify({"error": "Not found"}), 404

    if folder_id:
        folder_owner = _folder_bb_assistant_id(user_id, folder_id)
        if not folder_owner:
            return jsonify({"error": "Target folder not found or has no isolated assistant"}), 404

        thread_id = get_thread_id_for_conversation(user_id, conversation_id)
        if not thread_id:
            return jsonify({"error": "Thread not found for conversation"}), 404

        # Re-key the thread_map owner so folder listings find it.
        add_thread_mapping(user_id, conversation_id, thread_id, folder_owner)

        updated_meta = {**convo_meta, "folderId": folder_id, "hidden": True}
        save_conversation_meta(user_id, conversation_id, updated_meta)
    else:
        # Out of folder: thread reverts to the user's main assistant.
        thread_id = get_thread_id_for_conversation(user_id, conversation_id)
        if thread_id:
            main_assistant_id = get_request_assistant_id()
            add_thread_mapping(user_id, conversation_id, thread_id, main_assistant_id)
        # save_conversation_meta merges updates into the stored row, so omitting
        # keys does not clear them — overwrite with explicit falsy values.
        updated_meta = {**convo_meta, "folderId": None, "hidden": False}
        save_conversation_meta(user_id, conversation_id, updated_meta)

    return jsonify(_format_convo(updated_meta))


def _get_source_conversation_meta(user_id: str, conversation_id: str) -> dict:
    try:
        meta = get_conversation_meta(user_id, conversation_id)
        if isinstance(meta, dict) and meta:
            return meta
    except Exception:
        logger.warning("[convos] failed to fetch source conversation meta", exc_info=True)

    source_convos = list_conversations(user_id)
    return next((c for c in source_convos if c.get("conversationId") == conversation_id), {})


def _create_snapshot_conversation(
    *,
    user_id: str,
    assistant_id: str,
    bb,
    source_conversation_id: str,
    source_meta: dict,
    source_messages: list[dict],
    title_prefix: str,
) -> tuple[dict, list[dict]]:
    conversation_id = str(uuid.uuid4())
    get_or_create_thread(user_id, assistant_id, conversation_id, bb)

    snapshot = _build_message_snapshot(
        source_messages,
        conversation_id,
        owner_partition=user_id,
        source_conversation_id=source_conversation_id,
        added_response_map=get_added_response_map(user_id, source_conversation_id),
        src_endpoint=source_meta.get("endpoint", ""),
        src_model=source_meta.get("model", ""),
    )
    now = datetime.now(timezone.utc).isoformat()
    meta = {
        "conversationId": conversation_id,
        "title": f"{title_prefix}: {source_meta.get('title', 'New Chat')}",
        "endpoint": source_meta.get("endpoint", "agents"),
        "model": source_meta.get("model", ""),
        "createdAt": now,
        "updatedAt": now,
        "forked_from": source_conversation_id,
        "forked_messages": snapshot,
    }
    save_conversation_meta(user_id, conversation_id, meta)
    return meta, snapshot


def _get_source_display_messages(
    conversation_id: str,
    thread_id: str,
    bb,
    src_meta: dict | None = None,
    *,
    user_id: str = "",
) -> list:
    """Return the same visible history users see before fork/duplicate.

    Forked conversations keep pre-fork history in `forked_messages` while their
    Backboard thread starts fresh. A fork of a fork must copy that snapshot plus
    any non-hidden continuation messages from the new thread.
    """

    async def _fetch_src():
        return await get_thread_messages(thread_id, bb)

    meta = src_meta if isinstance(src_meta, dict) else {}
    forked_snapshot = meta.get("forked_messages") or []
    seed_message_id = str(meta.get("seed_message_id") or "")
    display_text_map = get_display_text_map(user_id, conversation_id) if user_id else {}
    display_file_map = get_display_file_map(user_id, conversation_id) if user_id else {}
    bb_messages = [
        _message_to_display_dict(
            m,
            conversation_id,
            display_text_map=display_text_map,
            display_file_map=display_file_map,
        )
        for m in run_async(_fetch_src())
        if str(m.message_id) != seed_message_id
        and is_user_visible_message(m)
    ]

    if not forked_snapshot:
        return bb_messages

    source = [dict(m) for m in forked_snapshot if isinstance(m, dict)]
    source.extend(bb_messages)
    return source


def _message_to_display_dict(
    message,
    conversation_id: str,
    *,
    display_text_map: dict | None = None,
    display_file_map: dict | None = None,
) -> dict:
    is_created_by_user = role_name(message) == "user"
    message_id = str(message.message_id)
    created_at = message.created_at.isoformat() if message.created_at else ""
    text = message.content or ""
    if is_created_by_user and isinstance(display_text_map, dict):
        text = display_text_map.get(message_id, text)
    result = {
        "messageId": message_id,
        "conversationId": conversation_id,
        "text": text,
        "sender": "User" if is_created_by_user else "Nash",
        "isCreatedByUser": is_created_by_user,
        "endpoint": "agents",
        "createdAt": created_at,
        "updatedAt": created_at,
        "error": False,
    }
    if is_created_by_user and isinstance(display_file_map, dict):
        files = display_file_map.get(message_id)
        if files:
            result["files"] = files
    return result


def _build_message_snapshot(
    messages: list,
    conversation_id: str,
    added_response_map: dict | None = None,
    src_endpoint: str = "",
    src_model: str = "",
    *,
    owner_partition: str = "",
    source_conversation_id: str = "",
) -> list:
    """Freeze source messages into a fork/duplicate snapshot.

    ``messages`` entries may already be display dicts (from a prior fork's
    frozen ``forked_messages`` snapshot — see _get_source_display_messages,
    which mixes those with freshly-fetched live Backboard messages to
    support "fork of a fork") or raw Backboard message objects — handled by
    the ``isinstance`` branch below, which normalizes either shape into
    ``source``/``message_id``/``is_created_by_user``/``created_at``/
    ``updated_at`` before this function does anything shape-specific.

    ``added_response_map`` (source conversation's, looked up by the SOURCE
    message_id — the id these messages already carry, before this snapshot
    hands them a new conversationId) bakes any multi-conversation added-model
    answer into the frozen copy at fork/duplicate time, the same way the
    primary text is already frozen via each message's own text. Without
    this, forking or duplicating a compare-mode conversation would silently
    drop the added model's answers — the disposable Backboard thread that
    produced them is long gone, and the new conversation's own (empty)
    added_response store has no way to inherit them otherwise.

    When owner/source identifiers are supplied, uploaded attachments are copied
    from the source conversation's MESSAGEFILES row and all persisted image URLs
    are normalized through Nash's authenticated download route.
    """
    from api.routes.chat import sanitize_long_message_display_text
    from api.routes.messages import (
        _normalize_message_files_for_response,
        _scrub_backboard_s3,
    )
    from api.services.context_service import fs_safe_partition
    from api.services.conversation_service import get_message_files_map

    added_response_map = added_response_map or {}
    dir_key = fs_safe_partition(owner_partition) if owner_partition else ""
    files_map = (
        get_message_files_map(owner_partition, source_conversation_id)
        if owner_partition and source_conversation_id
        else {}
    )
    snapshot = []
    prev_id = "00000000-0000-0000-0000-000000000000"
    for m in messages:
        if isinstance(m, dict):
            source = dict(m)
            message_id = source.get("messageId")
            is_created_by_user = bool(source.get("isCreatedByUser", False))
            created_at = source.get("createdAt", "")
            updated_at = source.get("updatedAt", created_at)
        else:
            if not is_user_visible_message(m):
                continue
            message_id = getattr(m, "message_id", None)
            is_created_by_user = role_name(m) == "user"
            created = getattr(m, "created_at", None)
            created_at = created.isoformat() if created else ""
            updated_at = created_at
            source = {
                "text": getattr(m, "content", "") or "",
            }
        if message_id is None:
            continue
        bb_id = str(message_id)
        text = source.get("text", "")
        if is_created_by_user:
            text = sanitize_long_message_display_text(text)
        if dir_key:
            text = _scrub_backboard_s3(text, dir_key)
        msg = {
            **source,
            "messageId": bb_id,
            "conversationId": conversation_id,
            "parentMessageId": prev_id,
            "text": text,
            "isCreatedByUser": is_created_by_user,
            "sender": source.get("sender", "User" if is_created_by_user else "Nash"),
            "endpoint": source.get("endpoint", "agents"),
            "createdAt": created_at,
            "updatedAt": updated_at,
            "error": bool(source.get("error", False)),
        }
        source_files = source.get("files") if isinstance(source.get("files"), list) else []
        persisted_files = files_map.get(bb_id, []) if isinstance(files_map, dict) else []
        combined_files: list[dict] = []
        seen_files: set[tuple[str, str]] = set()
        for file_info in [*source_files, *persisted_files]:
            if not isinstance(file_info, dict):
                continue
            file_id = str(file_info.get("file_id") or "")
            filepath = str(file_info.get("filepath") or "")
            key = ("id", file_id) if file_id else ("path", filepath)
            if key in seen_files:
                continue
            seen_files.add(key)
            combined_files.append(file_info)
        if combined_files:
            msg["files"] = (
                _normalize_message_files_for_response(combined_files, dir_key)
                if dir_key
                else combined_files
            )
        if not is_created_by_user:
            content = content_with_added_response(
                text, src_endpoint, src_model, added_response_map.get(bb_id)
            )
            if content is not None:
                msg["content"] = content
        snapshot.append(msg)
        prev_id = bb_id
    return snapshot


def _normalize_endpoint(ep: str) -> str:
    # Previously remapped "", "custom", and "agents" to the literal string
    # "OpenAI" — but every frontend consumer of conversation.endpoint (the
    # regenerate/branching whitelist in useGenerationsByLatest.ts, endpoint
    # config lookups, AssistantsEndpoint casts) does exact matching against
    # EModelEndpoint enum values ('agents', 'openAI', ...). "OpenAI" matches
    # none of them, so any conversation refetched through this formatter
    # (i.e. anything but the live SSE path, which never normalized) silently
    # failed those checks — e.g. the Regenerate button disappearing after a
    # page refresh for the "agents" endpoint Nash uses by default.
    return ep


def _format_convo(c: dict) -> dict:
    result = {
        "conversationId": c.get("conversationId", ""),
        "title": c.get("title", "New Chat"),
        "endpoint": _normalize_endpoint(c.get("endpoint", "")),
        "model": c.get("model", ""),
        "isArchived": c.get("isArchived", False),
        "isPinned": c.get("isPinned", False),
        "tags": c.get("tags", []),
        "createdAt": c.get("createdAt", ""),
        "updatedAt": c.get("updatedAt", ""),
    }
    if c.get("endpointType"):
        result["endpointType"] = c["endpointType"]
    if c.get("user"):
        result["user"] = c["user"]
    if c.get("modelLabel"):
        result["modelLabel"] = c["modelLabel"]
    if c.get("folderId"):
        result["folderId"] = c["folderId"]
    return result
