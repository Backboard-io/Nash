import logging
import os
import re
import uuid
from datetime import datetime, timezone

from flask import Blueprint, request, jsonify, g, send_file

from api.middleware.session_auth import require_auth
from api.services import state_service
from api.services.async_runner import run_async
from api.services.backboard_service import (
    get_request_assistant_id,
    get_request_client,
    get_request_state_partition,
    get_thread_messages,
    get_user_client,
    is_user_visible_message,
    role_name,
)
from api.services.context_service import (
    PERSONAL_CONTEXT_ID,
    fs_safe_partition,
    get_context_api_key,
)
from api.services.conversation_service import (
    content_with_added_response,
    get_added_response_map,
    get_conversation_forked_messages,
    get_conversation_meta,
    get_display_file_map,
    get_display_text_map,
    get_fallback_notice_map,
    get_message_files_map,
    get_or_create_thread,
    get_regen_graph,
    get_thread_id_for_conversation,
    list_conversations,
    save_conversation_meta,
)
from api.services.user_service import find_user_by_id
from api.routes.conversations import _build_message_snapshot, _format_convo
from api.routes.chat import sanitize_long_message_display_text
from api.routes.messages import (
    _message_files,
    _normalize_message_files_for_response,
    _scrub_backboard_s3,
)

logger = logging.getLogger(__name__)

share_bp = Blueprint("share", __name__)

NULL_PARENT = "00000000-0000-0000-0000-000000000000"


def _serialize_share(row: dict, *, drop_user_id: bool = False) -> dict:
    out = {k: v for k, v in row.items() if k not in ("pk", "sk")}
    if drop_user_id:
        out.pop("userId", None)
        out.pop("statePartition", None)
    return out


def _share_partition(share: dict) -> str:
    """The state partition a share's conversation lives in.

    Shares created before multi-org have no statePartition; their userId is
    the partition (personal data was keyed by the raw user id)."""
    return share.get("statePartition") or share.get("userId") or ""


def _context_id_from_partition(user_id: str, state_partition: str) -> str:
    """Inverse of context_service.state_partition_id.

    A personal/legacy partition is the bare user_id; an org partition is
    "{user_id}#ORG#{clientId}". Map back to the bbContexts key so we can look
    up the credential the conversation's thread was created under."""
    if not state_partition or state_partition == user_id:
        return PERSONAL_CONTEXT_ID
    marker = "#ORG#"
    if marker in state_partition:
        return f"org:{state_partition.split(marker, 1)[1]}"
    return PERSONAL_CONTEXT_ID


def _owner_share_client(owner_user_id: str, state_partition: str):
    """Backboard client able to read a public share's thread.

    A shared link is published by its owner and viewed by anyone — often
    logged out — so the thread must be read with the OWNER's credentials, not
    the requester's (which on this public route may be absent entirely). Use
    the key the owning context's thread was created under; never substitute a
    server-wide credential."""
    if owner_user_id:
        owner = find_user_by_id(owner_user_id)
        if owner:
            context_id = _context_id_from_partition(owner_user_id, state_partition)
            key = get_context_api_key(owner, context_id) or owner.get("bbApiKey") or ""
            if key:
                return get_user_client(key)
    raise ValueError("Share owner is missing their Backboard API key")


def _assemble_share_messages(
    share: dict, conversation_id: str, owner_partition: str
) -> list[dict]:
    """Reconstruct a shared conversation's messages from the OWNER's vantage.

    Mirrors GET /api/messages/<id> (api/routes/messages.py:get_messages) but
    keyed to the share owner's partition and credentials, because the public
    viewer is typically logged out and has no Backboard client of their own:
      * the thread is read with the owner's context client (_owner_share_client);
      * forked/continued shares keep their history in a Nash-side snapshot and
        carry an EMPTY Backboard thread, so that snapshot must lead;
      * the regen graph applies SKIP + parent overrides so regenerated turns
        don't duplicate;
      * S3 image/audio URLs are rewritten to the owner's /api/files/download
        path, identical to the owner's own view. (That download route stays
        auth-gated, so public *rendering* of images remains a separate concern;
        this only keeps the raw bucket origin from leaking.)
    """
    thread_id = get_thread_id_for_conversation(owner_partition, conversation_id)

    bb_messages: list = []
    if thread_id:
        bb = _owner_share_client(share.get("userId", ""), owner_partition)
        if bb is not None:
            bb_messages = run_async(get_thread_messages(thread_id, bb))

    dir_key = fs_safe_partition(owner_partition)
    convo_meta = get_conversation_meta(owner_partition, conversation_id)
    convo_model = convo_meta.get("model", "") if isinstance(convo_meta, dict) else ""
    convo_endpoint = convo_meta.get("endpoint", "") if isinstance(convo_meta, dict) else ""
    # Drop the hidden forked-context seed (see chat._seed_forked_thread_if_needed):
    # it lives in the thread to prime the model but must never surface in a share.
    seed_message_id = (
        convo_meta.get("seed_message_id", "") if isinstance(convo_meta, dict) else ""
    )
    if seed_message_id:
        bb_messages = [m for m in bb_messages if str(m.message_id) != seed_message_id]
    fallback_notice_map = get_fallback_notice_map(owner_partition, conversation_id)
    display_text_map = get_display_text_map(owner_partition, conversation_id)
    display_file_map = get_display_file_map(owner_partition, conversation_id)
    message_files_map = get_message_files_map(owner_partition, conversation_id)
    # Multi-conversation: durable added-model responses, same owner_partition
    # scoping as fallback_notice_map above — a share is read-only and always
    # resolves against the OWNER's state, never the anonymous viewer's.
    added_response_map = get_added_response_map(owner_partition, conversation_id)

    def _bb_dict(m, parent_id: str) -> dict:
        bb_id = str(m.message_id)
        role = role_name(m)
        is_user = role == "user"
        notice = (
            fallback_notice_map.get(bb_id, "")
            if isinstance(fallback_notice_map, dict) and not is_user
            else ""
        )
        raw_text = (
            display_text_map.get(bb_id, m.content or "")
            if isinstance(display_text_map, dict) and is_user
            else m.content or ""
        )
        if is_user:
            raw_text = sanitize_long_message_display_text(raw_text)
        text = _scrub_backboard_s3(f"{notice}{raw_text}", dir_key)
        d = {
            "messageId": bb_id,
            "conversationId": conversation_id,
            "parentMessageId": parent_id,
            "text": text,
            "sender": "User" if is_user else "Nash",
            "isCreatedByUser": is_user,
            "model": convo_model if not is_user else None,
            "endpoint": "agents",
            "createdAt": m.created_at.isoformat() if m.created_at else "",
            "updatedAt": m.created_at.isoformat() if m.created_at else "",
            "error": False,
        }
        if is_user:
            msg_files = _message_files(bb_id, message_files_map, display_file_map)
            if msg_files:
                d["files"] = _normalize_message_files_for_response(msg_files, dir_key)
        if not is_user:
            content = content_with_added_response(
                text, convo_endpoint, convo_model, added_response_map.get(bb_id)
            )
            if content is not None:
                d["content"] = content
        return d

    forked_snapshot = get_conversation_forked_messages(owner_partition, conversation_id)
    if forked_snapshot:
        messages = [dict(m) for m in forked_snapshot]
        for snap in messages:
            text = snap.get("text")
            if isinstance(text, str):
                snap["text"] = _scrub_backboard_s3(
                    sanitize_long_message_display_text(text), dir_key
                )
            if snap.get("files"):
                snap["files"] = _normalize_message_files_for_response(
                    snap["files"], dir_key
                )
        last_id = messages[-1]["messageId"] if messages else NULL_PARENT
        for m in bb_messages:
            if not is_user_visible_message(m):
                continue
            msg = _bb_dict(m, last_id)
            messages.append(msg)
            last_id = msg["messageId"]
        return messages

    regen_graph = get_regen_graph(owner_partition, conversation_id)
    messages = [
        _bb_dict(m, NULL_PARENT)
        for m in bb_messages
        if is_user_visible_message(m)
        and regen_graph.get(str(m.message_id)) != "SKIP"
    ]
    if len(messages) >= 2:
        for i in range(1, len(messages)):
            messages[i]["parentMessageId"] = messages[i - 1]["messageId"]
    if regen_graph:
        for msg in messages:
            override = regen_graph.get(msg["messageId"])
            if override and override != "SKIP":
                msg["parentMessageId"] = override
    return messages


# Matches the file_id in an owner-scoped download URL that share assembly emits,
# e.g. /api/files/download/<dir_key>/<file_id>. file_ids are uuids or
# "generated_<hash>" — alnum, underscore, hyphen, dot; markdown punctuation like
# ")" is excluded so it stops at the id boundary.
_DOWNLOAD_URL_RE = re.compile(r"/api/files/download/[^/\s)\"']+/([A-Za-z0-9_.\-]+)")


def _share_allowed_file_ids(messages: list[dict]) -> set[str]:
    """The set of file_ids that legitimately belong to a shared conversation.

    Built from the assembled share messages so the public file endpoint only
    ever serves images that actually appear in this share — never an arbitrary
    file from the owner's upload directory."""
    allowed: set[str] = set()
    for message in messages:
        for f in message.get("files") or []:
            if not isinstance(f, dict):
                continue
            fid = str(f.get("file_id") or "").strip()
            if fid:
                allowed.add(fid)
            for m in _DOWNLOAD_URL_RE.finditer(str(f.get("filepath") or "")):
                allowed.add(m.group(1))
        allowed.update(_DOWNLOAD_URL_RE.findall(str(message.get("text") or "")))
        for part in message.get("content") or []:
            if not isinstance(part, dict):
                continue
            text = part.get("text")
            value = text.get("value") if isinstance(text, dict) else ""
            allowed.update(_DOWNLOAD_URL_RE.findall(str(value or "")))
    return allowed


def _rewrite_share_image_urls(
    messages: list[dict], dir_key: str, share_id: str
) -> list[dict]:
    """Rewrite the owner's auth-gated /api/files/download URLs to the public,
    share-scoped /api/share/<id>/files path so a logged-out viewer can render
    the images (the download route stays @require_auth for the owner)."""
    old_prefix = f"/api/files/download/{dir_key}/"
    new_prefix = f"/api/share/{share_id}/files/"
    for message in messages:
        if isinstance(message.get("text"), str):
            message["text"] = message["text"].replace(old_prefix, new_prefix)
        for part in message.get("content") or []:
            if not isinstance(part, dict):
                continue
            text = part.get("text")
            if isinstance(text, dict) and isinstance(text.get("value"), str):
                text["value"] = text["value"].replace(old_prefix, new_prefix)
        for f in message.get("files") or []:
            if isinstance(f, dict) and isinstance(f.get("filepath"), str):
                f["filepath"] = f["filepath"].replace(old_prefix, new_prefix)
    return messages


def _serve_owner_file(dir_key: str, file_id: str):
    """Stream a file from the share owner's upload directory. Callers MUST have
    already validated file_id against the share's allowlist."""
    from api.routes.files import UPLOAD_DIR

    user_dir = os.path.join(UPLOAD_DIR, dir_key)

    def _serve_if_exists():
        if not os.path.isdir(user_dir):
            return None
        for fname in os.listdir(user_dir):
            # `.partial` files are in-flight async image writes; only serve
            # fully-written files (mirrors files.download_file).
            if fname.startswith(file_id) and not fname.endswith(".partial"):
                return send_file(os.path.join(user_dir, fname))
        return None

    response = _serve_if_exists()
    if response is not None:
        return response

    # Generated images are written async after the URL is emitted; if the
    # viewer races the writer, wait briefly instead of 404-ing.
    if file_id.startswith("generated_"):
        from api.routes.chat import wait_for_pending_image

        if wait_for_pending_image(file_id, timeout=15):
            response = _serve_if_exists()
            if response is not None:
                return response

    return jsonify({"error": "Not found"}), 404


@share_bp.route("/api/share/<share_id>", methods=["GET"])
def get_share(share_id):
    share = state_service.shared_links.get(share_id)
    if not share or not share.get("isPublic"):
        return jsonify({"error": "Not found"}), 404

    conversation_id = share.get("conversationId", "")
    owner_partition = _share_partition(share)
    messages: list[dict] = []

    if conversation_id and owner_partition:
        try:
            messages = _assemble_share_messages(share, conversation_id, owner_partition)
            messages = _rewrite_share_image_urls(
                messages, fs_safe_partition(owner_partition), share_id
            )
        except Exception:
            logger.warning(
                "share %s: failed to load messages", share_id, exc_info=True
            )
            messages = []

    return jsonify({
        "shareId": share.get("shareId"),
        "conversationId": conversation_id,
        "title": share.get("title", ""),
        "isPublic": share.get("isPublic", True),
        "createdAt": share.get("createdAt", ""),
        "updatedAt": share.get("updatedAt", ""),
        "messages": messages,
    })


@share_bp.route("/api/share/<share_id>/files/<file_id>", methods=["GET"])
def get_share_file(share_id, file_id):
    """Public, share-scoped image serving. Unauthenticated by design: a share
    is viewed logged-out, so the owner's @require_auth /api/files/download path
    is unreachable. Access is bounded to files that actually appear in this
    public share (via the allowlist) so it can't read the owner's other files."""
    share = state_service.shared_links.get(share_id)
    if not share or not share.get("isPublic"):
        return jsonify({"error": "Not found"}), 404

    conversation_id = share.get("conversationId", "")
    owner_partition = _share_partition(share)
    if not conversation_id or not owner_partition:
        return jsonify({"error": "Not found"}), 404

    try:
        messages = _assemble_share_messages(share, conversation_id, owner_partition)
    except Exception:
        logger.warning(
            "share %s: failed to assemble messages for file %s",
            share_id,
            file_id,
            exc_info=True,
        )
        return jsonify({"error": "Not found"}), 404

    if file_id not in _share_allowed_file_ids(messages):
        return jsonify({"error": "Not found"}), 404

    return _serve_owner_file(fs_safe_partition(owner_partition), file_id)


def _snapshot_from_assembled(messages: list[dict], conversation_id: str) -> list[dict]:
    """Re-key already-assembled share messages into a forked_messages snapshot
    for a brand-new conversation."""
    return _build_message_snapshot(messages, conversation_id)


@share_bp.route("/api/share/<share_id>/continue", methods=["POST"])
@require_auth
def continue_share(share_id):
    """Copy a public share into the requester's own conversations ("Add to my
    chats").

    The shared thread is read with the OWNER's credentials (the viewer is
    usually a different user/org and can't read the owner's thread directly),
    then re-saved as a brand-new conversation owned by the VIEWER — their
    partition, their assistant, their key. History is stored as a Nash-side
    `forked_messages` snapshot (same shape as fork/duplicate) so it displays
    immediately. Contextual continuation (seeding the empty Backboard thread)
    is handled separately on the chat-stream path.
    """
    share = state_service.shared_links.get(share_id)
    if not share or not share.get("isPublic"):
        return jsonify({"error": "Not found"}), 404

    src_conversation_id = share.get("conversationId", "")
    owner_partition = _share_partition(share)
    if not src_conversation_id or not owner_partition:
        return jsonify({"error": "Shared conversation unavailable"}), 404

    try:
        src_messages = _assemble_share_messages(share, src_conversation_id, owner_partition)
    except Exception:
        logger.warning(
            "share %s: continue failed to assemble source", share_id, exc_info=True
        )
        src_messages = []
    if not src_messages:
        return jsonify({"error": "Shared conversation unavailable"}), 404

    # New conversation owned by the VIEWER (their partition + assistant + key).
    viewer_partition = get_request_state_partition()
    viewer_assistant = get_request_assistant_id()
    viewer_bb = get_request_client()

    new_conversation_id = str(uuid.uuid4())
    get_or_create_thread(viewer_partition, viewer_assistant, new_conversation_id, viewer_bb)

    snapshot = _snapshot_from_assembled(src_messages, new_conversation_id)

    now = datetime.now(timezone.utc).isoformat()
    new_meta = {
        "conversationId": new_conversation_id,
        "title": share.get("title") or "Shared Chat",
        "endpoint": "agents",
        "model": "",
        "createdAt": now,
        "updatedAt": now,
        "forked_from": src_conversation_id,
        "forked_messages": snapshot,
    }
    save_conversation_meta(viewer_partition, new_conversation_id, new_meta)

    return jsonify({"conversation": _format_convo(new_meta), "messages": snapshot})


@share_bp.route("/api/share", methods=["GET"])
@require_auth
def list_shares():
    """List the caller's shared links.

    Response contract is SharedLinksResponse from packages/data-provider
    (types/queries.ts): {links: SharedLinkItem[], nextCursor, hasNextPage}.
    The previous shape ({sharedLinks, pageSize, pages}) crashed the Settings →
    Data Controls → Shared Links dialog, which reads page.links unconditionally.
    """
    # Scoped to the active context: a share belongs to the world its
    # conversation lives in. Ownership (update/delete) stays on raw userId.
    partition = get_request_state_partition()

    try:
        page_size = max(1, min(int(request.args.get("pageSize", "10")), 100))
    except ValueError:
        page_size = 10
    sort_by = request.args.get("sortBy") or "createdAt"
    if sort_by not in ("title", "createdAt"):
        sort_by = "createdAt"
    sort_direction = (request.args.get("sortDirection") or "desc").lower()
    # The dialog encodeURIComponent()s the search box and the URL builder
    # inserts it verbatim, so the wire value is single-encoded and Flask's
    # request.args already decoded it — do NOT unquote again (a second decode
    # corrupts literal %-sequences a user searches for).
    search = (request.args.get("search") or "").strip().lower()
    cursor = request.args.get("cursor") or ""

    # The isPublic query param is deliberately IGNORED: this endpoint backs the
    # only UI where links can be seen and revoked, and the dialog hardcodes
    # isPublic=true. Filtering would make any share flipped to private via
    # PATCH /api/share/<id> invisible and irrevocable. Public visibility is
    # enforced where it matters — the anonymous GET /api/share/<share_id>.
    shares = [
        s for s in state_service.shared_links.list_all()
        if s.get("userId") == g.user_id and _share_partition(s) == partition
    ]
    if search:
        shares = [s for s in shares if search in (s.get("title") or "").lower()]

    # lower() makes the title sort case-insensitive; it is a no-op for the
    # ISO-8601 createdAt strings, which sort correctly lexicographically.
    shares.sort(
        key=lambda s: str(s.get(sort_by) or "").lower(),
        reverse=(sort_direction != "asc"),
    )

    start = 0
    if cursor:
        start = next(
            (i + 1 for i, s in enumerate(shares) if s.get("shareId") == cursor),
            -1,
        )
        if start < 0:
            # Stale cursor (boundary share deleted/changed since the previous
            # page). Restarting at 0 would re-serve page 1 and the infinite
            # query would render duplicate rows — end the pagination instead.
            return jsonify({"links": [], "nextCursor": None, "hasNextPage": False})
    page = shares[start:start + page_size]
    has_next = (start + page_size) < len(shares)

    links = [
        {
            "shareId": s.get("shareId"),
            "conversationId": s.get("conversationId"),
            "title": s.get("title") or "Shared Chat",
            "isPublic": bool(s.get("isPublic")),
            "createdAt": s.get("createdAt") or "",
        }
        for s in page
    ]
    return jsonify({
        "links": links,
        "nextCursor": page[-1].get("shareId") if (page and has_next) else None,
        "hasNextPage": has_next,
    })


@share_bp.route("/api/share/link/<conversation_id>", methods=["GET"])
@require_auth
def get_share_link(conversation_id):
    partition = get_request_state_partition()
    for s in state_service.shared_links.list_all():
        if (
            s.get("conversationId") == conversation_id
            and s.get("userId") == g.user_id
            and _share_partition(s) == partition
            and s.get("isPublic")
        ):
            return jsonify(_serialize_share(s))
    return jsonify({"conversationId": conversation_id, "shareId": None, "isPublic": False})


@share_bp.route("/api/share/<conversation_id>", methods=["POST"])
@require_auth
def create_share(conversation_id):
    share_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()

    partition = get_request_state_partition()
    title = "Shared Chat"
    try:
        for c in list_conversations(partition):
            if c.get("conversationId") == conversation_id:
                title = c.get("title", "Shared Chat")
                break
    except Exception:
        pass

    share = {
        "shareId": share_id,
        "conversationId": conversation_id,
        # userId = ownership (raw identity); statePartition = where the
        # conversation's thread map lives, so public resolution works for
        # org-context conversations too.
        "userId": g.user_id,
        "statePartition": partition,
        "title": title,
        "isPublic": True,
        "createdAt": now,
        "updatedAt": now,
    }
    state_service.shared_links.put(share_id, share)
    return jsonify(_serialize_share(share, drop_user_id=True))


@share_bp.route("/api/share/<share_id>", methods=["PATCH"])
@require_auth
def update_share(share_id):
    data = request.get_json() or {}
    share = state_service.shared_links.get(share_id)
    if not share or share.get("userId") != g.user_id:
        return jsonify({"error": "Not found"}), 404

    if "isPublic" in data:
        share["isPublic"] = data["isPublic"]
    share["updatedAt"] = datetime.now(timezone.utc).isoformat()
    state_service.shared_links.put(share_id, {k: v for k, v in share.items() if k not in ("pk", "sk")})
    return jsonify(_serialize_share(share, drop_user_id=True))


@share_bp.route("/api/share/<share_id>", methods=["DELETE"])
@require_auth
def delete_share(share_id):
    share = state_service.shared_links.get(share_id)
    if not share or share.get("userId") != g.user_id:
        return jsonify({"error": "Not found"}), 404
    state_service.shared_links.delete(share_id)
    return jsonify({"message": "Deleted"})
