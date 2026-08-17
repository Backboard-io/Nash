import logging
import uuid

from flask import Blueprint, g, jsonify, request

from api.middleware.session_auth import require_auth
from api.services import state_service
from api.services.async_runner import run_async
from api.services.backboard_service import get_request_client, get_request_state_partition

logger = logging.getLogger(__name__)

agents_bp = Blueprint("agents", __name__)


def _user_bb_client():
    return get_request_client()


def _serialize_agent(row: dict) -> dict:
    serialized = {k: v for k, v in row.items() if k not in ("pk", "sk")}
    # The frontend keys agent resource-permission lookups off `_id` (LibreChat's
    # Mongo shape). Nash stores agents under `id` only, so mirror it into `_id`
    # — otherwise `/api/permissions/agent/<_id>/effective` resolves to nothing and
    # the owner is denied edit access ("Persona Not Available").
    if not serialized.get("_id") and serialized.get("id"):
        serialized["_id"] = serialized["id"]
    return serialized


def _list_agents(user_id: str) -> list[dict]:
    return state_service.agents.list_for_user(user_id)


@agents_bp.route("/api/agents", methods=["GET"])
@require_auth
def list_agents():
    user_id = get_request_state_partition()
    agents = [_serialize_agent(a) for a in _list_agents(user_id)]
    logger.info(
        "[preview-debug] agents.list user_id=%s count=%s",
        getattr(g, "user_id", None),
        len(agents),
    )
    return jsonify(
        {
            "object": "list",
            "data": agents,
            "first_id": agents[0]["id"] if agents else "",
            "last_id": agents[-1]["id"] if agents else "",
            "has_more": False,
        }
    )


@agents_bp.route("/api/agents", methods=["POST"])
@require_auth
def create_agent():
    data = request.get_json() or {}
    user_id = get_request_state_partition()
    bb = _user_bb_client()
    agent_id = data.get("id") or f"agent_{uuid.uuid4()}"
    data["id"] = agent_id

    async def _create_assistant():
        return await bb.create_assistant(
            name=f"nash-agent-{agent_id}",
            system_prompt=data.get("instructions", ""),
        )

    bb_assistant = run_async(_create_assistant())
    data["bb_assistant_id"] = str(bb_assistant.assistant_id)
    state_service.agents.put(user_id, agent_id, data)
    # Return through the serializer so the response (and the agent-list cache the
    # frontend seeds from it) carries `_id`; otherwise the post-create edit view
    # can't resolve owner permissions and shows "Persona Not Available".
    return jsonify(_serialize_agent(data)), 201


@agents_bp.route("/api/agents/<agent_id>", methods=["GET"])
@agents_bp.route("/api/agents/<agent_id>/expanded", methods=["GET"])
@require_auth
def get_agent(agent_id):
    user_id = get_request_state_partition()
    row = state_service.agents.get(user_id, agent_id)
    if row:
        return jsonify(_serialize_agent(row))

    # Cross-user public agent lookup. A scan with sk == AGENT#{id} returns
    # at most one row per user; we accept the first public one.
    for candidate in state_service.scan_sk_prefix(f"{state_service.SK_AGENT_PREFIX}{agent_id}"):
        if candidate.get("isPublic"):
            return jsonify(_serialize_agent(candidate))
    return jsonify({"error": "Not found"}), 404


@agents_bp.route("/api/agents/<agent_id>", methods=["PATCH"])
@require_auth
def update_agent(agent_id):
    data = request.get_json() or {}
    user_id = get_request_state_partition()
    bb = _user_bb_client()

    row = state_service.agents.get(user_id, agent_id)
    if not row:
        return jsonify({"error": "Not found"}), 404

    bb_assistant_id = row.get("bb_assistant_id", "")
    row.update({k: v for k, v in data.items() if k not in ("pk", "sk")})
    state_service.agents.put(user_id, agent_id, _serialize_agent(row))

    if bb_assistant_id and "instructions" in data:
        async def _sync_prompt():
            await bb.update_assistant(
                bb_assistant_id,
                system_prompt=data["instructions"] or "",
            )
        try:
            run_async(_sync_prompt())
        except Exception:
            logger.exception("[agents] failed to sync system_prompt to %s", bb_assistant_id)

    return jsonify(_serialize_agent(row))


@agents_bp.route("/api/agents/<agent_id>", methods=["DELETE"])
@require_auth
def delete_agent(agent_id):
    user_id = get_request_state_partition()
    if state_service.agents.delete(user_id, agent_id):
        return jsonify({"message": "Deleted"})
    return jsonify({"error": "Not found"}), 404


# Agent/persona categories. Labels are i18n keys the frontend localizes (it
# localizes any label starting with "com_"); `general` must stay present and
# first because the persona form defaults `category` to "general".
_AGENT_CATEGORIES = [
    {"value": "general", "label": "com_ui_agent_category_general"},
    {"value": "hr", "label": "com_ui_agent_category_hr"},
    {"value": "rd", "label": "com_ui_agent_category_rd"},
    {"value": "finance", "label": "com_ui_agent_category_finance"},
    {"value": "it", "label": "com_ui_agent_category_it"},
    {"value": "sales", "label": "com_ui_agent_category_sales"},
    {"value": "aftersales", "label": "com_ui_agent_category_aftersales"},
]


@agents_bp.route("/api/categories", methods=["GET"])
@agents_bp.route("/api/agents/categories", methods=["GET"])
def get_categories():
    return jsonify([{**c, "count": 0} for c in _AGENT_CATEGORIES])


@agents_bp.route("/api/agents/tools", methods=["GET"])
@require_auth
def agent_tools():
    return jsonify([])


@agents_bp.route("/api/agents/actions", methods=["GET"])
@require_auth
def agent_actions():
    return jsonify([])


@agents_bp.route("/api/files/agent/<agent_id>", methods=["GET"])
@require_auth
def agent_files(agent_id):
    return jsonify([])
