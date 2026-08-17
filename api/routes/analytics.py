import logging

from flask import Blueprint, jsonify

from api.middleware.session_auth import require_auth
from api.services.analytics_service import get_analytics
from api.services.backboard_service import get_request_user_id

analytics_bp = Blueprint("analytics", __name__)
logger = logging.getLogger(__name__)


@analytics_bp.route("/api/analytics", methods=["GET"])
@require_auth
def get_usage_analytics():
    user_id = get_request_user_id()
    try:
        payload = get_analytics(user_id)
    except Exception:
        logger.exception("[analytics] failed to load analytics")
        return jsonify({"error": "load_failed", "message": "Could not load analytics."}), 500
    return jsonify(payload)
