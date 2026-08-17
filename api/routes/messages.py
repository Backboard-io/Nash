import logging
import mimetypes

from flask import Blueprint, g, jsonify, request

from api.middleware.session_auth import require_auth
from api.routes.chat import (
    predictable_generated_image_url,
    sanitize_leaked_export_instructions,
    sanitize_long_message_display_text,
    sanitize_s3_image_urls,
    scrub_uploaded_image_tool_payloads,
)
from api.routes.voice import sanitize_s3_audio_urls
from api.services.async_runner import run_async
from api.routes.files import _upload_dir_key
from api.services.backboard_service import (
    build_tool_call_parts,
    get_request_client,
    get_request_state_partition,
    get_thread_messages,
    is_user_visible_message,
    role_name,
)
from api.services.conversation_service import (
    content_with_added_response,
    get_added_response_map,
    get_conversation_forked_messages,
    get_conversation_meta,
    get_display_file_map,
    get_display_text_map,
    get_fallback_notice_map,
    get_generated_media_map,
    get_message_files_map,
    get_regen_graph,
    get_thread_id_for_conversation,
    list_conversations,
)

logger = logging.getLogger(__name__)


def _dir_key_for_request() -> str:
    """Match the directory naming used by upload + generated-image persistence
    so the rewritten /api/files/download URL points at the right user's files."""
    return _upload_dir_key()


def _assistant_content(
    msg_text: str,
    convo_endpoint: str,
    convo_model: str,
    added_entry: dict | None,
    tool_parts: list[dict] | None,
) -> list[dict] | None:
    """Content parts for an assistant message, or None to keep flat text.

    Tool chips and the multi-model parallel view can't coexist: ContentParts
    switches the WHOLE message over to ParallelContentRenderer the moment any
    part carries a groupId, which would silently drop an ungrouped chip. So a
    message with an added-model response keeps its 2-column shape and no chips.
    """
    parallel = content_with_added_response(msg_text, convo_endpoint, convo_model, added_entry)
    if parallel is not None:
        return parallel
    if tool_parts:
        return [*tool_parts, {"type": "text", "text": {"value": msg_text}}]
    return None


def _scrub_backboard_s3(text: str, dir_key: str) -> str:
    """Rewrite both image and audio S3 URLs Backboard might have persisted in
    older messages so reload never leaks the bucket origin to the client."""
    text = scrub_uploaded_image_tool_payloads(text, complete_text=True)
    return sanitize_leaked_export_instructions(
        sanitize_s3_audio_urls(sanitize_s3_image_urls(text, dir_key), dir_key)
    )


def _inject_generated_images(text: str, doc_ids: list[str], dir_key: str) -> str:
    """Re-attach images that were generated via out-of-band media_generated events.

    Backboard's stored message content never carries these (they were only inlined
    into the streamed text), so on reload we append the markdown for each persisted
    image — pointing at the same predictable Nash download URL used while streaming,
    whose bytes are already on disk. Mirrors how an S3-bucket image embedded in the
    message text is rewritten and rendered; here the reference lives in Nash state
    instead of the message body. Skips any image already present in the text.
    """
    out = text or ""
    for doc_id in doc_ids or []:
        if not doc_id:
            continue
        url = predictable_generated_image_url(dir_key, doc_id)
        # generated_{doc_id} uniquely identifies the file in any already-present URL.
        if f"generated_{doc_id}" in out:
            continue
        marker = f"![Generated image]({url})"
        out = f"{out.rstrip()}\n\n{marker}\n\n" if out.strip() else f"{marker}\n\n"
    return out


def _download_path_from_upload_filepath(filepath: str) -> str | None:
    marker = "uploads/"
    if marker not in filepath:
        return None
    tail = filepath.split(marker, 1)[1].lstrip("/")
    parts = tail.split("/", 1)
    if len(parts) != 2:
        return None
    upload_dir, filename = parts
    file_id = filename.split("_", 1)[0].strip()
    if not upload_dir or not file_id:
        return None
    return f"/api/files/download/{upload_dir}/{file_id}"


def _normalize_message_files_for_response(files, dir_key: str) -> list[dict]:
    """Return renderable file descriptors for chat messages.

    Older MESSAGEFILES rows may contain the raw on-disk upload path from
    FILEMETA instead of the authenticated download URL. The browser cannot load
    those paths, and no Flask download log is emitted because the request never
    targets /api/files/download. Normalize at the API boundary so every local
    persisted file goes through the same authenticated image fetch path.
    """
    if not isinstance(files, list):
        return []

    normalized: list[dict] = []
    for file in files:
        if not isinstance(file, dict):
            continue
        out = dict(file)
        file_id = str(out.get("file_id") or "").strip()
        filepath = str(out.get("filepath") or "").strip()
        upload_download_path = _download_path_from_upload_filepath(filepath)
        source = str(out.get("source") or "local").strip() or "local"
        is_local = (
            source == "local"
            or "uploads/" in filepath
            or "/api/files/download/" in filepath
            or filepath.startswith("api/files/download/")
        )

        if (file_id or upload_download_path) and is_local:
            if filepath.startswith("/api/files/download/"):
                expected = filepath
            elif "/api/files/download/" in filepath:
                expected = filepath[filepath.index("/api/files/download/"):]
            elif filepath.startswith("api/files/download/"):
                expected = f"/{filepath}"
            elif upload_download_path:
                expected = upload_download_path
            else:
                expected = f"/api/files/download/{dir_key}/{file_id}"
            if filepath != expected:
                logger.info(
                    "[messages] normalized message file path file_id=%s old=%r new=%r",
                    file_id,
                    filepath,
                    expected,
                )
            out["filepath"] = expected

        if not out.get("type"):
            guessed_type, _ = mimetypes.guess_type(
                str(out.get("filename") or out.get("filepath") or "")
            )
            if guessed_type:
                out["type"] = guessed_type

        normalized.append(out)

    return normalized


def _message_files(
    message_id: str,
    *file_maps: dict[str, list[dict]],
) -> list[dict]:
    """Merge normal attachments and pasted-text display files without duplicates."""
    files: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for file_map in file_maps:
        if not isinstance(file_map, dict):
            continue
        for file_info in file_map.get(message_id, []) or []:
            if not isinstance(file_info, dict):
                continue
            file_id = str(file_info.get("file_id") or "")
            filepath = str(file_info.get("filepath") or "")
            key = ("id", file_id) if file_id else ("path", filepath)
            if key in seen:
                continue
            seen.add(key)
            files.append(file_info)
    return files


def _attach_message_files(msg: dict, files_map: dict[str, list[dict]]) -> dict:
    """Backward-compatible attachment helper used by message history callers."""
    files = _message_files(str(msg.get("messageId") or ""), files_map)
    if files:
        msg["files"] = files
    return msg


messages_bp = Blueprint("messages", __name__)


def _user_bb_client():
    return get_request_client()


@messages_bp.route("/api/messages", methods=["GET"])
@require_auth
def search_messages():
    """Search messages across all conversations by text content."""
    search_query = (request.args.get("search") or "").lower().strip()
    if not search_query:
        return jsonify({"messages": [], "nextCursor": None})

    user_id = get_request_state_partition()
    bb = _user_bb_client()
    convos = list_conversations(user_id)

    matched_messages = []
    for convo in convos:
        conversation_id = convo.get("conversationId", "")
        if not conversation_id:
            continue

        thread_id = get_thread_id_for_conversation(user_id, conversation_id)
        if not thread_id:
            continue

        async def _fetch(tid=thread_id, client=bb):
            return await get_thread_messages(tid, client)

        try:
            bb_messages = run_async(_fetch())
        except Exception:
            continue

        display_text_map = get_display_text_map(user_id, conversation_id)
        for m in bb_messages:
            if not is_user_visible_message(m):
                continue
            bb_id = str(m.message_id)
            role = role_name(m)
            raw_text = (
                display_text_map.get(bb_id, m.content or "")
                if isinstance(display_text_map, dict) and role == "user"
                else m.content or ""
            )
            if role == "user":
                raw_text = sanitize_long_message_display_text(raw_text)
            text = _scrub_backboard_s3(raw_text, _dir_key_for_request())
            if search_query in text.lower():
                matched_messages.append(
                    {
                        "messageId": bb_id,
                        "conversationId": conversation_id,
                        "parentMessageId": "00000000-0000-0000-0000-000000000000",
                        "text": text,
                        "title": convo.get("title", "New Chat"),
                        "sender": "User" if role == "user" else "Nash",
                        "isCreatedByUser": role == "user",
                        "endpoint": "agents",
                        "createdAt": m.created_at.isoformat() if m.created_at else "",
                        "updatedAt": m.created_at.isoformat() if m.created_at else "",
                        "error": False,
                    }
                )

    return jsonify({"messages": matched_messages, "nextCursor": None})


@messages_bp.route("/api/messages/<conversation_id>", methods=["GET"])
@require_auth
def get_messages(conversation_id):
    user_id = get_request_state_partition()
    bb = _user_bb_client()
    thread_id = get_thread_id_for_conversation(user_id, conversation_id)
    if not thread_id:
        return jsonify([])

    # Fetch conversation metadata once so we can stamp each assistant message with
    # the model that was actually used (including any fallback model that was saved).
    try:
        convo_meta = get_conversation_meta(user_id, conversation_id)
    except Exception:
        convo_meta = {}
    convo_model: str = (
        convo_meta.get("model", "") if isinstance(convo_meta, dict) else ""
    )
    convo_endpoint: str = (
        convo_meta.get("endpoint", "") if isinstance(convo_meta, dict) else ""
    )
    # Hidden priming seed for forked/continued threads (see chat._seed_forked_thread_if_needed):
    # it lives in the Backboard thread to give the model context, but must never
    # be shown to the user.
    seed_message_id: str = (
        convo_meta.get("seed_message_id", "") if isinstance(convo_meta, dict) else ""
    )
    fallback_notice_map = get_fallback_notice_map(user_id, conversation_id)
    generated_media_map = get_generated_media_map(user_id, conversation_id)
    display_text_map = get_display_text_map(user_id, conversation_id)
    display_file_map = get_display_file_map(user_id, conversation_id)
    message_files_map = get_message_files_map(user_id, conversation_id)
    # Multi-conversation: durable added-model responses (see chat._run_added_model_turn),
    # keyed by the primary assistant message_id they're a sibling column of.
    added_response_map = get_added_response_map(user_id, conversation_id)

    forked_snapshot = get_conversation_forked_messages(user_id, conversation_id)

    async def _fetch():
        return await get_thread_messages(thread_id, bb)

    bb_messages = run_async(_fetch())

    # Tool-call chips are reconstructed from Backboard's own thread history
    # (the hidden assistant stubs' tool_calls joined to the role='tool' outputs
    # by run_id), so they survive reload without Nash persisting a second copy.
    tool_call_parts = build_tool_call_parts(bb_messages)

    dir_key = _dir_key_for_request()

    if forked_snapshot:
        messages = [dict(msg) for msg in forked_snapshot if isinstance(msg, dict)]
        # Older messages persisted before the chat-time sanitizer was deployed
        # may contain raw Backboard S3 URLs. Rewrite them so old conversations
        # also load through the Nash-local /api/files/download path.
        for snapshot_msg in messages:
            text = snapshot_msg.get("text")
            if isinstance(text, str):
                snapshot_msg["text"] = _scrub_backboard_s3(
                    sanitize_long_message_display_text(text), dir_key
                )
            if snapshot_msg.get("files"):
                snapshot_msg["files"] = _normalize_message_files_for_response(
                    snapshot_msg["files"], dir_key
                )
        last_id = (
            messages[-1]["messageId"]
            if messages
            else "00000000-0000-0000-0000-000000000000"
        )
        for m in bb_messages:
            if not is_user_visible_message(m):
                continue
            bb_id = str(m.message_id)
            role = role_name(m)
            if seed_message_id and bb_id == seed_message_id:
                continue  # hidden forked-context seed — never display it
            persisted_notice = (
                fallback_notice_map.get(bb_id, "")
                if isinstance(fallback_notice_map, dict) and role != "user"
                else ""
            )
            raw_text = (
                display_text_map.get(bb_id, m.content or "")
                if isinstance(display_text_map, dict) and role == "user"
                else m.content or ""
            )
            if role == "user":
                raw_text = sanitize_long_message_display_text(raw_text)
            msg_text = _scrub_backboard_s3(f"{persisted_notice}{raw_text}", dir_key)
            if role != "user" and generated_media_map.get(bb_id):
                msg_text = _inject_generated_images(
                    msg_text, generated_media_map[bb_id], dir_key
                )
            msg = {
                "messageId": bb_id,
                "conversationId": conversation_id,
                "parentMessageId": last_id,
                "text": msg_text,
                "sender": "User" if role == "user" else "Nash",
                "isCreatedByUser": role == "user",
                "model": convo_model if role != "user" else None,
                "endpoint": "agents",
                "createdAt": m.created_at.isoformat() if m.created_at else "",
                "updatedAt": m.created_at.isoformat() if m.created_at else "",
                "error": False,
            }
            if role == "user":
                msg_files = _message_files(bb_id, message_files_map, display_file_map)
                if msg_files:
                    msg["files"] = _normalize_message_files_for_response(msg_files, dir_key)
            if role != "user":
                content = _assistant_content(
                    msg_text,
                    convo_endpoint,
                    convo_model,
                    added_response_map.get(bb_id),
                    tool_call_parts.get(bb_id),
                )
                if content is not None:
                    msg["content"] = content
            messages.append(msg)
            last_id = msg["messageId"]
        return jsonify(messages)

    regen_graph = get_regen_graph(user_id, conversation_id)

    messages = []
    for m in bb_messages:
        if not is_user_visible_message(m):
            continue
        bb_id = str(m.message_id)
        role = role_name(m)
        if seed_message_id and bb_id == seed_message_id:
            continue  # hidden forked-context seed — never display it
        if regen_graph.get(bb_id) == "SKIP":
            continue
        persisted_notice = (
            fallback_notice_map.get(bb_id, "")
            if isinstance(fallback_notice_map, dict) and role != "user"
            else ""
        )
        raw_text = (
            display_text_map.get(bb_id, m.content or "")
            if isinstance(display_text_map, dict) and role == "user"
            else m.content or ""
        )
        if role == "user":
            raw_text = sanitize_long_message_display_text(raw_text)
        msg_text = _scrub_backboard_s3(f"{persisted_notice}{raw_text}", dir_key)
        if role != "user" and generated_media_map.get(bb_id):
            msg_text = _inject_generated_images(
                msg_text, generated_media_map[bb_id], dir_key
            )
        msg = {
            "messageId": bb_id,
            "conversationId": conversation_id,
            "parentMessageId": "00000000-0000-0000-0000-000000000000",
            "text": msg_text,
            "sender": "User" if role == "user" else "Nash",
            "isCreatedByUser": role == "user",
            "model": convo_model if role != "user" else None,
            "endpoint": "agents",
            "createdAt": m.created_at.isoformat() if m.created_at else "",
            "updatedAt": m.created_at.isoformat() if m.created_at else "",
            "error": False,
        }
        if role == "user":
            msg_files = _message_files(bb_id, message_files_map, display_file_map)
            if msg_files:
                msg["files"] = _normalize_message_files_for_response(msg_files, dir_key)
        if role != "user":
            content = _assistant_content(
                msg_text,
                convo_endpoint,
                convo_model,
                added_response_map.get(bb_id),
                tool_call_parts.get(bb_id),
            )
            if content is not None:
                msg["content"] = content
        messages.append(msg)

    # Build linear parent chain first
    if len(messages) >= 2:
        for i in range(1, len(messages)):
            messages[i]["parentMessageId"] = messages[i - 1]["messageId"]

    # Apply persisted parent overrides (regenerated AI responses share the original user as parent)
    if regen_graph:
        for msg in messages:
            override = regen_graph.get(msg["messageId"])
            if override and override != "SKIP":
                msg["parentMessageId"] = override

    return jsonify(messages)


@messages_bp.route("/api/messages/<conversation_id>/<message_id>", methods=["GET"])
@require_auth
def get_message(conversation_id, message_id):
    return jsonify({"messageId": message_id, "conversationId": conversation_id})


@messages_bp.route("/api/messages/<conversation_id>/<message_id>", methods=["PUT"])
@require_auth
def update_message(conversation_id, message_id):
    return jsonify({"messageId": message_id, "conversationId": conversation_id})


@messages_bp.route("/api/messages/<conversation_id>/<message_id>", methods=["DELETE"])
@require_auth
def delete_message(conversation_id, message_id):
    return jsonify({"message": "Deleted"})


@messages_bp.route(
    "/api/messages/<conversation_id>/<message_id>/feedback", methods=["POST"]
)
@require_auth
def message_feedback(conversation_id, message_id):
    return jsonify({"message": "ok"})


@messages_bp.route("/api/messages/branch", methods=["POST"])
@require_auth
def branch_messages():
    return jsonify({"error": "Not implemented"}), 501
