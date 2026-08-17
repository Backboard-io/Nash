import logging
import os
import tomllib

from flask import Blueprint, Response, g, has_request_context, jsonify, request

from api.config import settings
from api.middleware.session_auth import require_auth
from api.services import model_catalog_service
from api.services.backboard_service import require_user_api_key
from api.utils import http_cache

# Catalog constants and yaml/response shaping moved to model_catalog_service;
# re-exported here because chat.py and existing tests reach them through this
# module.
from api.services.model_catalog_service import (  # noqa: F401
    ENABLED_CHAT_PROVIDERS,
    ENDPOINT_ORDER,
    FREE_TIER_PROVIDERS,
    MODEL_TIERS,
    _overlay_live_models,
    _sort_model_names,
    load_yaml_config as _load_endpoint_config,
)

config_bp = Blueprint("config", __name__)
logger = logging.getLogger(__name__)

def _read_version() -> str:
    try:
        pyproject_path = os.path.join(
            os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
            "pyproject.toml",
        )
        with open(pyproject_path, "rb") as f:
            data = tomllib.load(f)
        return data.get("project", {}).get("version", "unknown")
    except Exception:
        return "unknown"

_VERSION = _read_version()


def _request_api_key() -> str:
    """Return the authenticated user's mandatory Backboard key."""
    if not has_request_context():
        raise RuntimeError("A request context is required to resolve the user's API key")
    return require_user_api_key(getattr(g, "bb_api_key", ""))


def _load_effective_endpoint_config(api_key: str | None = None) -> dict:
    """The live-overlaid endpoint config for an authenticated caller.

    The keyless-session raise stays here (routes must 4xx a session with no
    Backboard key); the catalog service itself is keyless-tolerant.
    """
    api_key = require_user_api_key(_request_api_key() if api_key is None else api_key)
    return model_catalog_service.effective_config(api_key)


def _build_models_response() -> dict:
    return model_catalog_service.models_response(require_user_api_key(_request_api_key()))


def _build_endpoints_response() -> dict:
    return model_catalog_service.endpoints_response(require_user_api_key(_request_api_key()))


def _cacheable_json(resp, max_age: int):
    """Private browser caching + conditional revalidation for config JSON.

    These payloads change at most hourly (live-catalog TTL) but the client
    re-requests them on navigation. `private, max-age` lets the browser serve
    repeats from its local cache without a request; the ETag turns anything
    past the window into a 304 instead of a full re-download.
    """
    resp.cache_control.private = True
    resp.cache_control.max_age = max_age
    resp.add_etag()
    if has_request_context():
        return resp.make_conditional(request)
    return resp


@config_bp.route("/api/config", methods=["GET"])
def get_config():
    resp = jsonify({
        "appTitle": settings.app_title,
        "socialLogins": [],
        "discordLoginEnabled": False,
        "facebookLoginEnabled": False,
        "githubLoginEnabled": False,
        "googleLoginEnabled": False,
        "openidLoginEnabled": False,
        "appleLoginEnabled": False,
        "samlLoginEnabled": False,
        "openidLabel": "",
        "openidImageUrl": "",
        "openidAutoRedirect": False,
        "samlLabel": "",
        "samlImageUrl": "",
        "serverDomain": settings.domain_server,
        "emailLoginEnabled": False,
        "registrationEnabled": False,
        "socialLoginEnabled": False,
        "passwordResetEnabled": False,
        "emailEnabled": False,
        "apiKeyLoginEnabled": True,
        "showBirthdayIcon": False,
        "helpAndFaqURL": settings.help_and_faq_url,
        "statusPageURL": settings.status_page_url,
        "supportURL": settings.support_url,
        "sharedLinksEnabled": settings.allow_shared_links,
        "publicSharedLinksEnabled": settings.allow_shared_links,
        "instanceProjectId": "nash-2",
        "interface": {
            "webSearch": True,
            "endpointsMenu": True,
            "modelSelect": True,
            "parameters": True,
            "sidePanel": True,
            "presets": False,
            "bookmarks": True,
            "agents": {"use": True, "create": True, "share": False, "public": False},
            "prompts": True,
            "multiConvo": False,
            "artifacts": False,
            "codeBrowser": False,
            "fileCitations": True,
            "remoteAgents": {"use": False, "create": False, "share": False, "public": False},
            "privacyPolicy": {
                "externalUrl": "/privacy",
            },
            "termsOfService": {
                "externalUrl": "/terms",
                "modalAcceptance": True,
                "modalTitle": "Terms of Service",
                "modalContent": (
                    "By using Nash, you agree to our [Terms of Service](/terms) and "
                    "[Privacy Policy](/privacy).\n\n"
                    "**Key points:**\n"
                    "- You must be 13 or older to use Nash\n"
                    "- Don't use Nash to generate harmful or illegal content\n"
                    "- We don't sell your data or use your conversations to train AI models\n"
                    "- AI responses may be inaccurate — always verify important information\n\n"
                    "You can read our full [Terms of Service](/terms) and [Privacy Policy](/privacy) "
                    "for complete details."
                ),
            },
        },
    })
    return _cacheable_json(resp, max_age=300)


def _catalog_route_response(body_attr: str, payload_fn) -> Response:
    """Shared body of /api/endpoints and /api/models.

    With a snapshot installed: serve its pre-serialized body under
    `private, no-cache` + the snapshot's content-hash ETag — a revalidation
    costs a string compare, and every request re-runs auth so a context
    switch can never see the previous identity's catalog. Without a snapshot
    (provisional yaml fallback): plain no-cache 200, no ETag — provisional
    payloads must never become a cached validator.
    """
    api_key = require_user_api_key(_request_api_key())
    model_catalog_service.ensure_refresh(api_key)
    snap = model_catalog_service.snapshot()
    if snap is None:
        resp = jsonify(payload_fn(api_key))
        resp.cache_control.private = True
        resp.cache_control.no_cache = True
        return resp
    return http_cache.conditional_json(getattr(snap, body_attr), snap.etag)


@config_bp.route("/api/endpoints", methods=["GET"])
@require_auth
def get_endpoints():
    return _catalog_route_response("endpoints_body", model_catalog_service.endpoints_response)


@config_bp.route("/api/models", methods=["GET"])
@require_auth
def get_models():
    return _catalog_route_response("models_body", model_catalog_service.models_response)


@config_bp.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "version": _VERSION})
