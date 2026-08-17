from datetime import datetime, timezone

from flask import Blueprint, request, jsonify

from api.middleware.session_auth import require_auth
from api.services import state_service
from api.services.async_runner import run_async
from api.services.backboard_service import get_request_state_partition
from api.services.conversation_service import list_conversations, save_conversation_meta

tags_bp = Blueprint("tags", __name__)


def _serialize_tag(row: dict) -> dict:
    tag = {k: v for k, v in row.items() if k not in ("pk", "sk")}
    # DynamoDB numbers come back as Decimal, which jsonify renders as a STRING
    # ("count": "1") — the client's strict `count === 1` checks then misbehave.
    try:
        tag["count"] = int(tag.get("count", 0))
    except (TypeError, ValueError):
        tag["count"] = 0
    return tag


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _adjust_tag_count(user_id: str, tag_name: str, delta: int) -> None:
    row = state_service.tags.get(user_id, tag_name)
    if not row:
        return
    new_count = max(0, int(row.get("count", 0)) + delta)
    row["count"] = new_count
    state_service.tags.put(user_id, tag_name, _serialize_tag(row))


def _rename_tag_on_convos(user_id: str, old_name: str, new_name: str) -> None:
    for convo in list_conversations(user_id):
        tags = convo.get("tags") or []
        if old_name in tags:
            convo["tags"] = [new_name if t == old_name else t for t in tags]
            save_conversation_meta(user_id, convo.get("conversationId"), convo)


@tags_bp.route("/api/tags", methods=["GET"])
@require_auth
def get_tags():
    user_id = get_request_state_partition()
    rows = state_service.tags.list_for_user(user_id)
    return jsonify([_serialize_tag(t) for t in rows])


@tags_bp.route("/api/tags/list", methods=["GET"])
@require_auth
def list_tags():
    user_id = get_request_state_partition()
    rows = state_service.tags.list_for_user(user_id)
    return jsonify([_serialize_tag(t) for t in rows])


@tags_bp.route("/api/tags", methods=["POST"])
@require_auth
def create_tag():
    data = request.get_json() or {}
    user_id = get_request_state_partition()
    tag_name = (data.get("tag") or "").strip()
    if not tag_name:
        return jsonify({"error": "tag is required"}), 400

    now = _now_iso()
    # Re-creating a tag that already exists must not clobber its count or
    # createdAt; start from the existing row and update fields in place.
    existing_tag = state_service.tags.get(user_id, tag_name)
    tag = _serialize_tag(existing_tag) if existing_tag else {}
    tag["tag"] = tag_name
    tag.setdefault("count", 0)
    tag.setdefault("createdAt", now)
    tag["updatedAt"] = now
    if data.get("description") is not None:
        tag["description"] = data.get("description") or ""
    if data.get("position") is not None:
        tag["position"] = data["position"]

    # When created from a conversation, link the tag to that conversation so the
    # count reflects reality (the frontend's cache update is not persisted).
    conversation_id = data.get("conversationId")
    if data.get("addToConversation") and conversation_id:
        convo = next(
            (
                c
                for c in list_conversations(user_id)
                if c.get("conversationId") == conversation_id
            ),
            None,
        )
        meta = convo or {"conversationId": conversation_id}
        convo_tags = list(meta.get("tags") or [])
        if tag_name not in convo_tags:
            convo_tags.append(tag_name)
            meta["tags"] = convo_tags
            save_conversation_meta(user_id, conversation_id, meta)
        # The tag is now linked to this conversation (newly added or already
        # present), so the count is at least 1.
        if int(tag.get("count", 0)) < 1:
            tag["count"] = 1

    state_service.tags.put(user_id, tag_name, tag)
    return jsonify(tag)


@tags_bp.route("/api/tags/<tag>", methods=["PUT"])
@require_auth
def update_tag(tag):
    data = request.get_json() or {}
    user_id = get_request_state_partition()

    existing = state_service.tags.get(user_id, tag)
    if not existing:
        return jsonify({"error": "Not found"}), 404

    updated = _serialize_tag(existing)
    new_name = (data.get("tag") or tag).strip() or tag
    updated["tag"] = new_name
    if "description" in data:
        updated["description"] = data.get("description") or ""
    if data.get("position") is not None:
        updated["position"] = data["position"]

    if new_name != tag:
        if state_service.tags.get(user_id, new_name):
            return jsonify({"error": "A tag with that name already exists"}), 409
        state_service.tags.delete(user_id, tag)
        state_service.tags.put(user_id, new_name, updated)
        _rename_tag_on_convos(user_id, tag, new_name)
    else:
        state_service.tags.put(user_id, new_name, updated)

    return jsonify(updated)


@tags_bp.route("/api/tags/<tag>", methods=["DELETE"])
@require_auth
def delete_tag(tag):
    user_id = get_request_state_partition()
    if state_service.tags.delete(user_id, tag):
        return jsonify({"message": "Deleted"})
    return jsonify({"error": "Not found"}), 404


@tags_bp.route("/api/tags/convo/<conversation_id>", methods=["POST"])
@require_auth
def add_tag_to_convo(conversation_id):
    data = request.get_json() or {}
    tags = data.get("tags", [])
    user_id = get_request_state_partition()

    convos = list_conversations(user_id)
    existing = None
    for c in convos:
        if c.get("conversationId") == conversation_id:
            existing = c
            break
    old_tags = set(existing.get("tags", [])) if existing else set()
    new_tags = set(tags)
    added = new_tags - old_tags
    removed = old_tags - new_tags

    meta = existing or {"conversationId": conversation_id}
    meta["tags"] = tags
    save_conversation_meta(user_id, conversation_id, meta)

    for tag_name in added:
        _adjust_tag_count(user_id, tag_name, 1)
    for tag_name in removed:
        _adjust_tag_count(user_id, tag_name, -1)

    return jsonify({"conversationId": conversation_id, "tags": tags})
