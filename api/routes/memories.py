import logging
from datetime import datetime, timezone

from flask import Blueprint, request, jsonify, g

from api.middleware.session_auth import require_auth
from api.services.async_runner import run_async
from api.services.backboard_service import get_request_assistant_id, get_request_client
from api.services.user_service import (
    find_user_by_id,
    memories_enabled_for_user,
    update_user_field,
)

logger = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

memories_bp = Blueprint("memories", __name__)


def _user_bb_client():
    return get_request_client()


@memories_bp.route("/api/memories", methods=["GET"])
@require_auth
def list_memories():
    """Return Backboard's auto-extracted user-fact memories for this user.

    Nash internal state (folders, agents, prompts, etc.) lives in DynamoDB
    now, so there's nothing to filter out — the memory panel sees only the
    user-fact memories Backboard surfaces.
    """
    assistant_id = get_request_assistant_id()
    bb = _user_bb_client()

    async def _fetch():
        response = await bb.get_memories(assistant_id)
        memories = []
        for m in response.memories:
            memories.append({
                "key": str(m.id),
                "value": m.content or "",
                "updated_at": getattr(m, "updated_at", None)
                    or getattr(m, "created_at", None)
                    or "",
                "tokenCount": len((m.content or "").split()),
            })
        return memories

    mems = run_async(_fetch())
    total_tokens = sum(m.get("tokenCount", 0) for m in mems)
    logger.info(
        "[memories] assistant=%s returned=%d total_tokens=%d",
        (assistant_id or "")[:8], len(mems), total_tokens,
    )
    return jsonify({
        "memories": mems,
        "totalTokens": total_tokens,
        "tokenLimit": None,
        "usagePercentage": None,
    })


@memories_bp.route("/api/memories", methods=["POST"])
@require_auth
def create_memory():
    data = request.get_json() or {}
    assistant_id = get_request_assistant_id()
    bb = _user_bb_client()
    value = data.get("value", "")

    async def _save():
        client = bb
        result = await client.add_memory(
            assistant_id=assistant_id,
            content=value,
        )
        return result

    result = run_async(_save())
    return jsonify({
        "key": str(result.get("id") or result.get("memory_id", "")),
        "value": value,
        "updated_at": result.get("updated_at") or result.get("created_at") or _now_iso(),
        "tokenCount": len(value.split()),
    })


@memories_bp.route("/api/memories/<key>", methods=["PATCH"])
@require_auth
def update_memory(key):
    data = request.get_json() or {}
    assistant_id = get_request_assistant_id()
    bb = _user_bb_client()
    new_value = data.get("value", "")

    async def _update():
        client = bb
        return await client.update_memory(
            assistant_id=assistant_id,
            memory_id=key,
            content=new_value,
        )

    try:
        updated = run_async(_update())
    except Exception:
        logger.exception("[memories] update failed assistant=%s key=%s",
                         (assistant_id or "")[:8], key)
        return jsonify({"error": "Failed to update memory"}), 502

    updated_at = (
        getattr(updated, "updated_at", None)
        or getattr(updated, "created_at", None)
        or _now_iso()
    )
    return jsonify({
        "key": key,
        "value": new_value,
        "updated_at": updated_at,
        "tokenCount": len(new_value.split()),
    })


@memories_bp.route("/api/memories/<key>", methods=["DELETE"])
@require_auth
def delete_memory(key):
    assistant_id = get_request_assistant_id()
    bb = _user_bb_client()

    async def _del():
        client = bb
        await client.delete_memory(assistant_id=assistant_id, memory_id=key)

    try:
        run_async(_del())
    except Exception:
        logger.exception("[memories] delete failed assistant=%s key=%s",
                         (assistant_id or "")[:8], key)
        return jsonify({"error": "Failed to delete memory"}), 502
    return jsonify({"message": "Deleted"})


def _current_user():
    uid = getattr(g, "user_id", None)
    return find_user_by_id(uid) if uid else None


def _memories_enabled(user) -> bool:
    return memories_enabled_for_user(user)


@memories_bp.route("/api/memories/preferences", methods=["GET"])
@require_auth
def memory_preferences():
    enabled = _memories_enabled(_current_user())
    return jsonify({"preferences": {"memories": enabled}})


@memories_bp.route("/api/memories/preferences", methods=["PATCH", "POST"])
@require_auth
def update_memory_preferences():
    data = request.get_json(silent=True) or {}
    enabled = bool(data.get("memories", True))

    user = _current_user()
    if not user:
        # Session/BYOK auth has no durable profile row to persist against;
        # echo the requested value so the toggle reflects it this session.
        return jsonify({"updated": False, "preferences": {"memories": enabled}})

    personalization = dict(user.get("personalization") or {})
    personalization["memories"] = enabled
    update_user_field(user, "personalization", personalization)
    return jsonify({"updated": True, "preferences": {"memories": enabled}})
