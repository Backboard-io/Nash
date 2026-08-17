import uuid

from flask import Blueprint, request, jsonify

from api.middleware.session_auth import require_auth
from api.services import state_service
from api.services.backboard_service import get_request_state_partition

presets_bp = Blueprint("presets", __name__)


def _serialize_preset(row: dict) -> dict:
    return {k: v for k, v in row.items() if k not in ("pk", "sk")}


@presets_bp.route("/api/presets", methods=["GET"])
@require_auth
def get_presets():
    user_id = get_request_state_partition()
    rows = state_service.presets.list_for_user(user_id)
    return jsonify([_serialize_preset(p) for p in rows])


@presets_bp.route("/api/presets", methods=["POST"])
@require_auth
def create_preset():
    data = request.get_json() or {}
    user_id = get_request_state_partition()
    preset_id = data.get("presetId") or str(uuid.uuid4())
    data["presetId"] = preset_id
    state_service.presets.put(user_id, preset_id, data)
    return jsonify(data)


@presets_bp.route("/api/presets/delete", methods=["POST"])
@require_auth
def delete_preset():
    data = request.get_json() or {}
    preset_id = data.get("presetId")
    if not preset_id:
        return jsonify({"error": "presetId required"}), 400

    user_id = get_request_state_partition()
    if state_service.presets.delete(user_id, preset_id):
        return jsonify({"message": "Deleted"})
    return jsonify({"error": "Not found"}), 404
