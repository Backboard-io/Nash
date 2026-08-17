"""Batch init endpoint — single DynamoDB query hydrates the whole UI.

Replaces the prior fan-out of N Backboard `get_memories` calls with one
`query_user` on the nash_state partition for this user, then partitions
the result by SK prefix in-memory.
"""
import hashlib
import logging
import threading
import time

from flask import Blueprint, jsonify, g
from flask import json as flask_json

from api.config import settings
from api.middleware.session_auth import require_auth
from api.routes.config_routes import _build_endpoints_response, _build_models_response
from api.routes.files import _serialize_file_meta
from api.services import state_service
from api.services.mcp_service import mcp_server_client_payload
from api.services.backboard_service import get_request_state_partition
from api.services.user_service import find_user_by_id
from api.utils import http_cache

logger = logging.getLogger(__name__)

init_bp = Blueprint("init", __name__)


INIT_CACHE_TTL_SEC = 10
# cache_key -> (monotonic_ts, serialized_body, etag). Serializing once per
# fill (instead of per hit) is what makes the ETag nearly free: a 304 costs a
# dict lookup plus one string compare.
_init_cache: dict[str, tuple[float, bytes, str]] = {}
_init_cache_lock = threading.Lock()


def _clean(row: dict) -> dict:
    return {k: v for k, v in row.items() if k not in ("pk", "sk")}


def _partition_rows(rows: list[dict]) -> dict[str, list[dict]]:
    """Group rows by their SK prefix family."""
    buckets: dict[str, list[dict]] = {
        "agents": [],
        "files": [],
        "presets": [],
        "convos": [],
        "thread_map": [],
        "prompt_groups": [],
        "tags": [],
        "folders": [],
        "mcp_servers": [],
        "favorites": [],
    }
    for row in rows:
        sk = row.get("sk", "")
        clean = _clean(row)
        if sk == state_service.SK_FAVORITES:
            inner = clean.get("favorites")
            if isinstance(inner, list):
                buckets["favorites"] = inner
        elif sk.startswith(state_service.SK_AGENT_PREFIX):
            buckets["agents"].append(clean)
        elif sk.startswith(state_service.SK_FILEMETA_PREFIX):
            buckets["files"].append(_serialize_file_meta(row))
        elif sk.startswith(state_service.SK_PRESET_PREFIX):
            buckets["presets"].append(clean)
        elif sk.startswith(state_service.SK_CONVO_PREFIX):
            buckets["convos"].append(clean)
        elif sk.startswith(state_service.SK_THREADMAP_PREFIX):
            buckets["thread_map"].append(clean)
        elif sk.startswith(state_service.SK_PROMPTGROUP_PREFIX):
            # Bootstrap only needs the group + its production snippet; the full
            # version history is fetched per-group via GET /api/prompts?groupId=.
            clean.pop("prompts", None)
            buckets["prompt_groups"].append(clean)
        elif sk.startswith(state_service.SK_TAG_PREFIX):
            buckets["tags"].append(clean)
        elif sk.startswith(state_service.SK_FOLDER_PREFIX):
            buckets["folders"].append(clean)
        elif sk.startswith(state_service.SK_MCP_PREFIX):
            buckets["mcp_servers"].append(clean)
    return buckets


@init_bp.route("/api/init", methods=["GET"])
@require_auth
def init():
    now = time.monotonic()
    # The context is part of the key: an in-app context switch keeps the same
    # session_key, and must not serve the previous context's cached world.
    cache_key = (
        f"{getattr(g, 'session_key', None) or getattr(g, 'user_id', 'anon')}"
        f":{getattr(g, 'bb_context_id', '') or ''}"
    )
    with _init_cache_lock:
        cached = _init_cache.get(cache_key)
    if cached and (now - cached[0]) < INIT_CACHE_TTL_SEC:
        return http_cache.conditional_json(cached[1], cached[2])

    try:
        user_id = get_request_state_partition()
    except ValueError:
        resp = jsonify({"error": "user_not_found"})
        resp.headers["Retry-After"] = "5"
        return resp, 503

    rows = state_service.query_user(state_service.user_pk(user_id))
    buckets = _partition_rows(rows)
    logger.info(
        "[init] user=%s rows=%d folders=%d tags=%d agents=%d presets=%d "
        "mcp=%d favorites=%d convos=%d thread_map=%d files=%d prompt_groups=%d",
        user_id[:8], len(rows),
        len(buckets["folders"]), len(buckets["tags"]), len(buckets["agents"]),
        len(buckets["presets"]), len(buckets["mcp_servers"]),
        len(buckets["favorites"]), len(buckets["convos"]),
        len(buckets["thread_map"]), len(buckets["files"]),
        len(buckets["prompt_groups"]),
    )

    # Build conversations: convos + placeholder for orphan thread_map rows.
    existing_ids = {c.get("conversationId", "") for c in buckets["convos"]}
    for tm in buckets["thread_map"]:
        cid = tm.get("conversation_id") or tm.get("conversationId") or ""
        if cid and cid not in existing_ids:
            buckets["convos"].append({
                "conversationId": cid,
                "title": "New Chat",
                "endpoint": "custom",
                "model": "",
                "createdAt": "",
                "updatedAt": "",
                "isArchived": False,
                "tags": [],
            })
    buckets["convos"].sort(key=lambda c: c.get("updatedAt", ""), reverse=True)

    from api.services.token_service import get_token_usage
    usage = (
        get_token_usage(g.user_id)
        if getattr(g, 'user_id', None)
        else {"usageTokens": 0, "includedTokens": 0, "overageTokens": 0, "tokensRemaining": 0}
    )

    page_size = 25
    convo_page = [_format_convo(c) for c in buckets["convos"][:page_size]]

    payload = {
        "agents": {
            "object": "list",
            "data": buckets["agents"],
            "first_id": buckets["agents"][0]["id"] if buckets["agents"] else "",
            "last_id": buckets["agents"][-1]["id"] if buckets["agents"] else "",
            "has_more": False,
        },
        "files": buckets["files"],
        "presets": buckets["presets"],
        "conversations": {
            "conversations": convo_page,
            "pageSize": page_size,
            "pages": 1,
            "pageNumber": "1",
            "nextCursor": convo_page[-1]["conversationId"] if len(convo_page) == page_size else None,
        },
        "promptGroups": buckets["prompt_groups"],
        "allPrompts": buckets["prompt_groups"],
        "favorites": buckets["favorites"],
        "tags": buckets["tags"],
        "folders": buckets["folders"],
        # Frontend contract stubs — the client types expect these blocks even
        # though Nash has no billing; values are static.
        "balance": {"tokenCredits": 0, "tokenCreditsUsd": 0},
        "subscription": {
            "subscription": None,
            "plan": "pro",
            "status": "active",
            "usageTokens": usage["usageTokens"],
            "tokensRemaining": 0,
            "includedTokens": 0,
        },
        "models": _build_models_response(),
        "endpoints": _build_endpoints_response(),
        "startupConfig": _get_startup_config(),
        "searchEnabled": {"enabled": True},
        "keys": [],
        # Must match GET /api/mcp/servers exactly — both seed the same
        # react-query cache key (see mcp_service.mcp_server_client_payload).
        "mcpServers": {
            s.get("serverName"): mcp_server_client_payload(s)
            for s in buckets["mcp_servers"]
            if s.get("serverName")
        },
        "mcpTools": [],
        "agentTools": [],
        "agentCategories": [],
        "activeJobs": [],
        "codeAuth": {"authenticated": False},
        "permissions": {},
        "fileConfig": _file_config_data(),
        "banner": _get_banner_data(usage),
    }

    # Flask's JSON provider handles the Decimal values Dynamo rows carry;
    # stdlib json.dumps would raise on them.
    body = flask_json.dumps(payload).encode("utf-8")
    etag = hashlib.sha256(body).hexdigest()[:16]
    with _init_cache_lock:
        _init_cache[cache_key] = (now, body, etag)

    return http_cache.conditional_json(body, etag)


def _format_convo(c: dict) -> dict:
    return {
        "conversationId": c.get("conversationId", ""),
        "title": c.get("title", "New Chat"),
        "endpoint": c.get("endpoint", "custom"),
        "model": c.get("model", ""),
        "chatGptLabel": c.get("chatGptLabel"),
        "modelLabel": c.get("modelLabel"),
        "user": c.get("user"),
        "createdAt": c.get("createdAt", ""),
        "updatedAt": c.get("updatedAt", ""),
        "isArchived": c.get("isArchived", False),
        "tags": c.get("tags", []),
        "folderId": c.get("folderId"),
    }


def _get_startup_config() -> dict:
    from api.config import settings
    return {
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
        "showBirthdayIcon": False,
        "helpAndFaqURL": settings.help_and_faq_url,
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
        },
        "apiKeyLoginEnabled": True,
    }


def _file_config_data() -> dict:
    return {
        "endpoints": {
            "default": {
                "fileLimit": 10,
                "fileSizeLimit": 25 * 1024 * 1024,
                "supportedMimeTypes": ["*/*"],
                "disabled": False,
            }
        },
        "serverFileSizeLimit": 100 * 1024 * 1024,
        "avatarSizeLimit": 2 * 1024 * 1024,
    }


def _get_banner_data(usage: dict):
    return None
