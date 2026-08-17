"""Miscellaneous endpoints the frontend expects to exist."""
import logging
import re
import uuid
from datetime import datetime, timezone

from flask import Blueprint, request, jsonify, g, make_response

from api.config import settings
from api.middleware.session_auth import require_auth
from api.services import state_service, mcp_catalog, mcp_oauth_service
from api.services.async_runner import run_async
from api.services.backboard_service import (
    get_request_assistant_id,
    get_request_client,
    get_request_state_partition,
)
from api.services.mcp_oauth_service import MCPOAuthError
from api.services.mcp_service import (
    MCP_LIST_TIMEOUT,
    MCPConnectionError,
    fetch_mcp_tools,
    init_timeout_for,
    mcp_server_client_payload,
    mcp_tools_to_openai_format,
)
from api.services.user_service import (
    find_user_by_id,
    get_all_users,
    update_user_field,
)

logger = logging.getLogger(__name__)

misc_bp = Blueprint("misc", __name__)


def _user_bb_client():
    return get_request_client()


def _clean(obj: dict) -> dict:
    return {k: v for k, v in obj.items() if k not in ("pk", "sk")}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# --- Prompt versioning helpers ---------------------------------------------
#
# A prompt group row carries every version of its prompt:
#   prompts: [v_newest, ..., v_oldest]   (index 0 is the latest version)
#   productionId: <_id of the version currently promoted to production>
#   productionPrompt: <full version object pointed at by productionId>
#
# `productionPrompt` is the snippet the group cards/commands read, so it is
# kept in sync with `productionId` on every mutation.


def _make_version(group_id: str, prompt_data: dict, now: str) -> dict:
    return {
        "_id": str(uuid.uuid4()),
        "groupId": group_id,
        "prompt": prompt_data.get("prompt", ""),
        "type": prompt_data.get("type", "text"),
        "createdAt": now,
        "updatedAt": now,
    }


def _sync_production_snippet(gr: dict) -> None:
    """Point `productionPrompt`/`productionId` at a real version in `prompts`."""
    versions = gr.get("prompts") or []
    if not versions:
        gr["productionId"] = None
        gr["productionPrompt"] = None
        return
    pid = gr.get("productionId")
    prod = next((v for v in versions if v.get("_id") == pid), versions[0])
    gr["productionId"] = prod.get("_id")
    gr["productionPrompt"] = prod


def _normalize_group(gr: dict) -> dict:
    """Upgrade a stored group row in place to the versioned shape and return it.

    Legacy rows carry a single `productionPrompt` and no `prompts` array; lift
    that into a one-element version list so every group looks versioned. Also
    backfills fields the frontend reads on each version (createdAt is required —
    PromptVersions formats it as a date).
    """
    versions = gr.get("prompts")
    if not isinstance(versions, list) or not versions:
        prod = gr.get("productionPrompt")
        versions = [prod] if isinstance(prod, dict) and prod else []
        gr["prompts"] = versions

    gid = gr.get("_id", "")
    for v in versions:
        v.setdefault("_id", str(uuid.uuid4()))
        v.setdefault("groupId", gid)
        v.setdefault("type", "text")
        if not v.get("createdAt"):
            v["createdAt"] = gr.get("createdAt") or _now_iso()
        if not v.get("updatedAt"):
            v["updatedAt"] = v["createdAt"]

    if versions and not gr.get("productionId"):
        gr["productionId"] = versions[0].get("_id")
    _sync_production_snippet(gr)
    return gr


def _present_group(gr: dict) -> dict:
    """Group-shaped response: cleaned + normalized, minus the heavy versions
    array (versions are served by GET /api/prompts?groupId=)."""
    out = _clean(_normalize_group(gr))
    out.pop("prompts", None)
    return out


@misc_bp.route("/api/user/plugins", methods=["GET"])
@require_auth
def user_plugins():
    return jsonify([])


@misc_bp.route("/api/user/plugins", methods=["POST"])
@require_auth
def update_plugins():
    return jsonify([])


@misc_bp.route("/api/banner", methods=["GET"])
def get_banner():
    # No banners. The old token-limit banner belonged to the retired
    # token-quota model; credit exhaustion now surfaces in-chat (Backboard's
    # credit block + the upgrade modal), so a top-of-page warning would be
    # redundant at best and wrong at worst. The route stays for the client's
    # startup fetch.
    return jsonify(None)


_ALL_PERMISSIONS = {
    "PROMPTS": {"USE": True, "CREATE": True, "SHARE": True, "SHARE_PUBLIC": True},
    "BOOKMARKS": {"USE": True},
    "MEMORIES": {"USE": True, "CREATE": True, "UPDATE": True, "READ": True, "OPT_OUT": True},
    "AGENTS": {"USE": True, "CREATE": True, "SHARE": True, "SHARE_PUBLIC": True},
    "MULTI_CONVO": {"USE": True},
    "TEMPORARY_CHAT": {"USE": True},
    "RUN_CODE": {"USE": True},
    "WEB_SEARCH": {"USE": True},
    "PEOPLE_PICKER": {"VIEW_USERS": True, "VIEW_GROUPS": True, "VIEW_ROLES": True},
    "MARKETPLACE": {"USE": True},
    "FILE_SEARCH": {"USE": True},
    "FILE_CITATIONS": {"USE": True},
    "MCP_SERVERS": {"USE": True, "CREATE": True, "SHARE": True, "SHARE_PUBLIC": True},
    "REMOTE_AGENTS": {"USE": True, "CREATE": True, "SHARE": True, "SHARE_PUBLIC": True},
}


@misc_bp.route("/api/roles", methods=["GET"])
@require_auth
def get_roles():
    return jsonify([])


@misc_bp.route("/api/roles/<role_name>", methods=["GET"])
@require_auth
def get_role(role_name):
    return jsonify({
        "name": role_name.upper(),
        "permissions": _ALL_PERMISSIONS,
    })


# --------------- Prompts / Prompt Groups ---------------


@misc_bp.route("/api/prompts", methods=["GET"])
@require_auth
def list_prompts():
    user_id = get_request_state_partition()

    # The frontend's useGetPrompts always filters by groupId and expects the
    # version list (newest first) for that one group.
    group_id = request.args.get("groupId", "")
    if group_id:
        row = state_service.prompt_groups.get(user_id, group_id)
        if not row:
            return jsonify([])
        _normalize_group(row)
        return jsonify(row.get("prompts", []))

    # No filter: legacy callers expect every group (without the heavy versions).
    groups = state_service.prompt_groups.list_for_user(user_id)
    return jsonify([_present_group(gr) for gr in groups])


@misc_bp.route("/api/prompts/groups", methods=["GET"])
@require_auth
def list_prompt_groups():
    user_id = get_request_state_partition()
    groups = [_present_group(gr) for gr in state_service.prompt_groups.list_for_user(user_id)]

    category = request.args.get("category", "")
    if category:
        groups = [gr for gr in groups if gr.get("category", "") == category]

    page_size = int(request.args.get("pageSize", "25"))
    page_number = int(request.args.get("pageNumber", "1"))
    start = (page_number - 1) * page_size
    page = groups[start:start + page_size]
    total_pages = max(1, (len(groups) + page_size - 1) // page_size)

    return jsonify({
        "promptGroups": page,
        "pageNumber": str(page_number),
        "pageSize": page_size,
        "pages": total_pages,
        "has_more": start + page_size < len(groups),
        "after": None,
    })


@misc_bp.route("/api/prompts/groups/<group_id>", methods=["GET"])
@require_auth
def get_prompt_group(group_id):
    user_id = get_request_state_partition()
    row = state_service.prompt_groups.get(user_id, group_id)
    if row:
        return jsonify(_present_group(row))
    return jsonify({"error": "Not found"}), 404


@misc_bp.route("/api/prompts/groups/<group_id>", methods=["PATCH"])
@require_auth
def update_prompt_group(group_id):
    data = request.get_json() or {}
    payload = data.get("payload", data)
    user_id = get_request_state_partition()

    row = state_service.prompt_groups.get(user_id, group_id)
    if not row:
        return jsonify({"error": "Not found"}), 404
    _normalize_group(row)
    row.update({k: v for k, v in payload.items() if k not in ("pk", "sk", "prompts")})
    _sync_production_snippet(row)
    state_service.prompt_groups.put(user_id, group_id, _clean(row))
    return jsonify(_present_group(row))


@misc_bp.route("/api/prompts/groups/<group_id>", methods=["DELETE"])
@require_auth
def delete_prompt_group(group_id):
    user_id = get_request_state_partition()
    if state_service.prompt_groups.delete(user_id, group_id):
        return jsonify({"prompt": group_id, "promptGroup": {"message": "Deleted", "id": group_id}})
    return jsonify({"error": "Not found"}), 404


@misc_bp.route("/api/prompts/groups/<group_id>/prompts", methods=["POST"])
@require_auth
def add_prompt_to_group(group_id):
    data = request.get_json() or {}
    user_id = get_request_state_partition()
    row = state_service.prompt_groups.get(user_id, group_id)
    if not row:
        return jsonify({"error": "Not found"}), 404

    _normalize_group(row)
    now = _now_iso()
    prompt_obj = _make_version(group_id, data.get("prompt", {}), now)

    # New version goes to the front (index 0 == "latest"). Adding a version
    # does not change which version is in production.
    row["prompts"].insert(0, prompt_obj)
    row["updatedAt"] = now
    _sync_production_snippet(row)

    state_service.prompt_groups.put(user_id, group_id, _clean(row))
    return jsonify({"prompt": prompt_obj, "group": _present_group(row)})


@misc_bp.route("/api/prompts/all", methods=["GET"])
@require_auth
def all_prompts():
    user_id = get_request_state_partition()
    groups = state_service.prompt_groups.list_for_user(user_id)
    return jsonify([_present_group(gr) for gr in groups])


@misc_bp.route("/api/prompts/random", methods=["GET"])
@require_auth
def random_prompts():
    return jsonify({"prompts": []})


@misc_bp.route("/api/prompts", methods=["POST"])
@require_auth
def create_prompt():
    data = request.get_json() or {}
    user_id = get_request_state_partition()

    prompt_input = data.get("prompt", {})
    group_input = data.get("group", {})

    group_id = str(uuid.uuid4())
    now = _now_iso()

    _uid = getattr(g, 'user_id', None) or user_id
    user = find_user_by_id(_uid) if _uid else None

    # First version of the group; it is production by default.
    prompt_obj = _make_version(group_id, prompt_input, now)

    group_obj = {
        "_id": group_id,
        "name": group_input.get("name", "Untitled"),
        "author": _uid or "byok-user",
        "authorName": (user or {}).get("name", "BYOK User"),
        "oneliner": group_input.get("oneliner", ""),
        "command": group_input.get("command", ""),
        "category": group_input.get("category", ""),
        "prompts": [prompt_obj],
        "productionId": prompt_obj["_id"],
        "productionPrompt": prompt_obj,
        "createdAt": now,
        "updatedAt": now,
    }

    state_service.prompt_groups.put(user_id, group_id, group_obj)
    return jsonify({"prompt": prompt_obj, "group": _present_group(group_obj)}), 201


@misc_bp.route("/api/prompts/<prompt_id>/tags/production", methods=["PATCH"])
@require_auth
def make_prompt_production(prompt_id):
    """Promote one version to production by repointing the group's productionId."""
    user_id = get_request_state_partition()
    for gr in state_service.prompt_groups.list_for_user(user_id):
        _normalize_group(gr)
        if any(v.get("_id") == prompt_id for v in gr.get("prompts", [])):
            gr["productionId"] = prompt_id
            gr["updatedAt"] = _now_iso()
            _sync_production_snippet(gr)
            state_service.prompt_groups.put(user_id, gr["_id"], _clean(gr))
            return jsonify({"message": "Prompt production made successfully"})
    return jsonify({"error": "Not found"}), 404


@misc_bp.route("/api/prompts/<prompt_id>", methods=["PATCH"])
@require_auth
def update_prompt(prompt_id):
    data = request.get_json() or {}
    user_id = get_request_state_partition()
    for gr in state_service.prompt_groups.list_for_user(user_id):
        _normalize_group(gr)
        versions = gr.get("prompts", [])
        target = next((v for v in versions if v.get("_id") == prompt_id), None)
        if target is None and gr.get("_id") == prompt_id and versions:
            target = versions[0]
        if target is None:
            continue
        if "prompt" in data:
            target["prompt"] = data["prompt"]
        if "type" in data:
            target["type"] = data["type"]
        target["updatedAt"] = _now_iso()
        gr["updatedAt"] = target["updatedAt"]
        _sync_production_snippet(gr)
        state_service.prompt_groups.put(user_id, gr["_id"], _clean(gr))
        return jsonify(_present_group(gr))
    return jsonify({"error": "Not found"}), 404


@misc_bp.route("/api/prompts/<prompt_id>", methods=["DELETE"])
@require_auth
def delete_prompt(prompt_id):
    """Delete a single version. Drops the whole group only when it was the last
    version; otherwise repoints production to the newest remaining version (the
    frontend expects this — see useDeletePrompt)."""
    user_id = get_request_state_partition()
    group_id = request.args.get("groupId", "")

    candidates = (
        [state_service.prompt_groups.get(user_id, group_id)]
        if group_id
        else state_service.prompt_groups.list_for_user(user_id)
    )
    for gr in candidates:
        if not gr:
            continue
        _normalize_group(gr)
        versions = gr.get("prompts", [])
        match = next((v for v in versions if v.get("_id") == prompt_id), None)
        # Legacy fallback: allow deleting by group id (removes the group).
        if match is None and gr.get("_id") != prompt_id:
            continue

        gid = gr.get("_id", "")
        remaining = [v for v in versions if v.get("_id") != prompt_id] if match else []
        if not remaining:
            state_service.prompt_groups.delete(user_id, gid)
            return jsonify({
                "prompt": prompt_id,
                "promptGroup": {"message": "Deleted", "id": gid},
            })

        gr["prompts"] = remaining
        if gr.get("productionId") == prompt_id:
            gr["productionId"] = remaining[0].get("_id")
        gr["updatedAt"] = _now_iso()
        _sync_production_snippet(gr)
        state_service.prompt_groups.put(user_id, gid, _clean(gr))
        return jsonify({"prompt": prompt_id})
    return jsonify({"error": "Not found"}), 404


# --------------- MCP ---------------

def _slugify_server_name(title: str) -> str:
    slug = title.lower().strip()
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    slug = slug.strip("-")
    return slug or "mcp-server"


def _mcp_response(server: dict) -> dict:
    """Client-facing server shape. Shared with /api/init — see
    mcp_service.mcp_server_client_payload for why the shape must match."""
    return mcp_server_client_payload(server)


def _fetch_and_store_tools(row: dict, access_token: str | None = None) -> None:
    """Fetch tools from the server in *row* and store both raw and converted
    forms on the row. Raises MCPConnectionError (or TimeoutError) on failure.

    ``access_token`` is passed for OAuth servers; None for static-auth servers.

    MCP tools are per-turn payload only — they are never synced onto Backboard
    assistants (assistant-persisted tools fire on every turn, including ones
    Nash's streaming path can't answer for).
    """
    server_arg = {"config": row.get("config", {}), "serverName": row.get("serverName", "")}
    # The run_async wrapper must outlast the inner handshake/list timeout, which
    # honors config.initTimeout (Google Workspace uses 150s) — otherwise a slow
    # remote server is killed by the wrapper before its own timeout.
    tools = run_async(
        fetch_mcp_tools(server_arg, access_token),
        timeout=init_timeout_for(server_arg) + 10,
    )
    row["tools"] = tools
    row["openai_tools"] = mcp_tools_to_openai_format(
        tools, server_name=row.get("serverName", "")
    )
    row["lastFetchedAt"] = _now_iso()
    row.pop("lastError", None)


def _server_connection_state(row: dict, user_id: str | None = None) -> str:
    """'connected' | 'disconnected' | 'error'. OAuth servers are only connected
    once the user has a valid token AND tools have been fetched."""
    if row.get("lastError"):
        return "error"
    if mcp_oauth_service.is_oauth_server(row):
        server_name = row.get("serverName", "")
        if not user_id or not mcp_oauth_service.has_token(user_id, server_name):
            return "disconnected"
    if row.get("tools") or row.get("openai_tools"):
        return "connected"
    return "disconnected"


def _oauth_initiate_response(server_name: str, row: dict):
    """Build the {oauthRequired, oauthUrl} initiate response the frontend polls
    on. Returns None if the server has no usable OAuth config."""
    oauth_config = mcp_oauth_service.get_oauth_config(row)
    if not oauth_config:
        return None
    try:
        url = mcp_oauth_service.build_authorize_url(
            server_name=server_name,
            user_hash=get_request_state_partition(),
            oauth_config=oauth_config,
            session_fingerprint=mcp_oauth_service.session_fingerprint(getattr(g, "session_key", "")),
        )
    except MCPOAuthError as e:
        logger.warning("[mcp-oauth] cannot start OAuth for %s: %s", server_name, e)
        return None
    return url


@misc_bp.route("/api/mcp/tools", methods=["GET"])
@require_auth
def mcp_tools():
    # Agent-builder MCP tool attachment is out of scope for v1 (Flask agents
    # don't persist tools); chat-turn tools come from GET /api/mcp/servers rows.
    return jsonify([])


@misc_bp.route("/api/mcp/servers", methods=["GET"])
@require_auth
def mcp_servers():
    user_id = get_request_state_partition()
    result: dict = {}
    for s in state_service.mcp_servers.list_for_user(user_id):
        server_name = s.get("serverName", "")
        if server_name:
            result[server_name] = _mcp_response(s)
    return jsonify(result)


@misc_bp.route("/api/mcp/servers", methods=["POST"])
@require_auth
def create_mcp_server():
    data = request.get_json() or {}
    config = data.get("config", {})
    title = (config.get("title") or "").strip()
    if not title:
        return jsonify({"error": "name is required"}), 400

    server_name = _slugify_server_name(title)
    user_id = get_request_state_partition()
    if state_service.mcp_servers.get(user_id, server_name):
        return jsonify({"error": "Server with this name already exists"}), 409

    server = {
        "serverName": server_name,
        "dbId": str(uuid.uuid4()),
        "config": config,
    }
    if mcp_oauth_service.is_oauth_server(server):
        # OAuth servers cannot list tools until the user authorizes. Store the
        # server so the client can start the OAuth connect (reinitialize returns
        # the authorize URL); tools are fetched in the callback.
        state_service.mcp_servers.put(user_id, server_name, server)
        return jsonify(_mcp_response(server)), 201
    try:
        _fetch_and_store_tools(server)
    except (MCPConnectionError, TimeoutError) as e:
        logger.warning("[mcp] create failed for %s: %s", server_name, e)
        return jsonify({"error": f"Could not connect to MCP server: {e}"}), 502
    state_service.mcp_servers.put(user_id, server_name, server)
    return jsonify(_mcp_response(server)), 201


@misc_bp.route("/api/mcp/servers/<server_name>", methods=["GET"])
@require_auth
def get_mcp_server(server_name: str):
    user_id = get_request_state_partition()
    row = state_service.mcp_servers.get(user_id, server_name)
    if row:
        return jsonify(_mcp_response(row))
    return jsonify({"error": "Not found"}), 404


@misc_bp.route("/api/mcp/servers/<server_name>", methods=["PATCH"])
@require_auth
def update_mcp_server(server_name: str):
    data = request.get_json() or {}
    config_update = data.get("config", {})
    user_id = get_request_state_partition()

    row = state_service.mcp_servers.get(user_id, server_name)
    if not row:
        return jsonify({"error": "Not found"}), 404
    updated = dict(row)
    updated["config"] = {**row.get("config", {}), **config_update}

    # OAuth servers need the per-user token to list tools. Resolve it; if the
    # user hasn't authorized yet, save the config change without a re-fetch
    # (keeping any existing tools) instead of 502-ing an edit of a connected
    # server. Non-OAuth servers behave exactly as before.
    access_token = None
    if mcp_oauth_service.is_oauth_server(updated):
        access_token = mcp_oauth_service.get_valid_access_token(user_id, updated)
        if not access_token:
            state_service.mcp_servers.put(user_id, server_name, _clean(updated))
            return jsonify(_mcp_response(updated))

    # Re-fetch with the merged config so tool defs stay current and a broken
    # config never replaces a working one silently.
    try:
        _fetch_and_store_tools(updated, access_token)
    except (MCPConnectionError, TimeoutError) as e:
        logger.warning("[mcp] update failed for %s: %s", server_name, e)
        return jsonify({"error": f"Could not connect to MCP server: {e}"}), 502
    state_service.mcp_servers.put(user_id, server_name, _clean(updated))
    return jsonify(_mcp_response(updated))


@misc_bp.route("/api/mcp/servers/<server_name>", methods=["DELETE"])
@require_auth
def delete_mcp_server(server_name: str):
    user_id = get_request_state_partition()
    if not state_service.mcp_servers.delete(user_id, server_name):
        return jsonify({"error": "Not found"}), 404
    # Also drop any stored OAuth token so deleting a server fully disconnects it
    # (no orphaned secret silently reused if the same server is re-added later).
    # Best-effort: a token-cleanup hiccup must not fail the server delete.
    try:
        mcp_oauth_service.delete_token(user_id, server_name)
    except Exception:
        logger.warning("[mcp] token cleanup on delete failed for %s (non-fatal)", server_name)
    return jsonify({"success": True})


@misc_bp.route("/api/mcp/<server_name>/reinitialize", methods=["POST"])
@require_auth
def reinitialize_mcp_server(server_name: str):
    """Re-fetch tools from the server (the client's 'initialize/refresh' action).

    For OAuth servers this is the entry point of the connect flow: if the user
    has no valid token we return {oauthRequired, oauthUrl} for the frontend to
    open and poll; with a token we fetch tools using it.
    """
    user_id = get_request_state_partition()
    row = state_service.mcp_servers.get(user_id, server_name)
    if not row:
        return jsonify({"error": "Not found"}), 404

    access_token = None
    if mcp_oauth_service.is_oauth_server(row):
        access_token = mcp_oauth_service.get_valid_access_token(user_id, row)
        if not access_token:
            oauth_url = _oauth_initiate_response(server_name, row)
            if not oauth_url:
                return jsonify({"success": False, "message": "OAuth is not configured for this server"}), 400
            return jsonify({
                "success": True,
                "message": f"'{server_name}' requires authorization",
                "serverName": server_name,
                "oauthRequired": True,
                "oauthUrl": oauth_url,
            })

    try:
        _fetch_and_store_tools(row, access_token)
    except (MCPConnectionError, TimeoutError) as e:
        # Only treat an *auth* failure (401/403) as a stale grant worth dropping
        # the token and re-authorizing. A transient network/5xx error must NOT
        # discard the user's refresh token (that would force a full re-consent
        # for a blip).
        msg = str(e)
        is_auth_failure = ("HTTP 401" in msg) or ("HTTP 403" in msg)
        if mcp_oauth_service.is_oauth_server(row) and is_auth_failure:
            mcp_oauth_service.delete_token(user_id, server_name)
            oauth_url = _oauth_initiate_response(server_name, row)
            if oauth_url:
                return jsonify({
                    "success": True,
                    "message": f"'{server_name}' needs to be re-authorized",
                    "serverName": server_name,
                    "oauthRequired": True,
                    "oauthUrl": oauth_url,
                })
        row["lastError"] = msg
        state_service.mcp_servers.put(user_id, server_name, _clean(row))
        return jsonify({"success": False, "message": msg}), 502

    state_service.mcp_servers.put(user_id, server_name, _clean(row))
    return jsonify({
        "success": True,
        "message": f"MCP server '{server_name}' reinitialized",
        "serverName": server_name,
        "oauthRequired": False,
        "oauthUrl": None,
    })


@misc_bp.route("/api/mcp/connection/status", methods=["GET"])
@require_auth
def mcp_connection_status():
    user_id = get_request_state_partition()
    status = {}
    for row in state_service.mcp_servers.list_for_user(user_id):
        name = row.get("serverName", "")
        if name:
            status[name] = {
                "requiresOAuth": mcp_oauth_service.is_oauth_server(row),
                "connectionState": _server_connection_state(row, user_id),
            }
    return jsonify({"success": True, "connectionStatus": status})


@misc_bp.route("/api/mcp/connection/status/<server_name>", methods=["GET"])
@require_auth
def mcp_server_connection_status(server_name: str):
    user_id = get_request_state_partition()
    row = state_service.mcp_servers.get(user_id, server_name)
    if not row:
        return jsonify({"error": "Not found"}), 404
    return jsonify({
        "success": True,
        "serverName": server_name,
        "requiresOAuth": mcp_oauth_service.is_oauth_server(row),
        "connectionStatus": _server_connection_state(row, user_id),
    })


def _oauth_result_page(message: str, ok: bool):
    """A tiny self-closing page for the OAuth popup. The opener is already
    polling connection status, so this only needs to close (or show an error)."""
    from html import escape

    color = "#7C3AED" if ok else "#dc2626"
    message = escape(message)
    body = (
        "<!doctype html><meta charset='utf-8'>"
        "<title>Nash</title>"
        "<style>body{font-family:-apple-system,Segoe UI,sans-serif;background:#0d0d0d;color:#e3e3e3;"
        "display:flex;align-items:center;justify-content:center;height:100vh;margin:0}"
        ".card{text-align:center;max-width:420px;padding:24px}"
        f".dot{{color:{color};font-size:40px}}</style>"
        f"<div class='card'><div class='dot'>{'✓' if ok else '✕'}</div>"
        f"<p>{message}</p><p style='color:#999'>You can close this window.</p></div>"
        "<script>try{window.close()}catch(e){}"
        "setTimeout(function(){try{window.close()}catch(e){}},1500)</script>"
    )
    resp = make_response(body)
    resp.headers["Content-Type"] = "text/html; charset=utf-8"
    return resp


@misc_bp.route("/api/mcp/<server_name>/oauth/callback", methods=["GET"])
def mcp_oauth_callback(server_name: str):
    """OAuth redirect target. No @require_auth (the JSON 401 would be useless in
    a popup), but the flow is bound to the *initiating* session: the callback is
    same-origin with the app, so the initiator's session cookie rides the
    top-level redirect, and we require its fingerprint to match the one stored
    when the flow started. This blocks OAuth account-linking CSRF — a victim
    completing an attacker-initiated link fails the match, so a victim's tokens
    can never be bound to another account."""
    from api.middleware.session_auth import _extract_session_key

    error = request.args.get("error")
    if error:
        return _oauth_result_page(f"Authorization was cancelled ({error}).", ok=False)
    code = request.args.get("code", "")
    state = request.args.get("state", "")
    if not code or not state:
        return _oauth_result_page("Missing authorization code.", ok=False)

    from api.services import dynamo_service
    state_row = dynamo_service.pop_mcp_oauth_state(state)
    if not state_row or state_row.get("server_name") != server_name:
        return _oauth_result_page("This authorization link has expired. Please try again.", ok=False)

    # Session binding: the browser completing the flow must be the one that
    # started it. (Legacy state rows without a fingerprint are rejected too.)
    expected_fp = state_row.get("session_fingerprint", "")
    actual_fp = mcp_oauth_service.session_fingerprint(_extract_session_key())
    if not expected_fp or expected_fp != actual_fp:
        logger.warning("[mcp-oauth] callback session mismatch for %s (possible CSRF)", server_name)
        return _oauth_result_page(
            "Please start the connection again from your Nash session.", ok=False
        )

    user_id = state_row.get("user_hash", "")
    row = state_service.mcp_servers.get(user_id, server_name)
    if not row:
        return _oauth_result_page("That server no longer exists.", ok=False)
    oauth_config = mcp_oauth_service.get_oauth_config(row)
    if not oauth_config:
        return _oauth_result_page("This server is not configured for OAuth.", ok=False)

    try:
        tokens = mcp_oauth_service.exchange_code(
            oauth_config=oauth_config,
            server_name=server_name,
            code=code,
            code_verifier=state_row.get("code_verifier", ""),
        )
        mcp_oauth_service.store_token(user_id, server_name, tokens)
    except MCPOAuthError as e:
        logger.warning("[mcp-oauth] token exchange failed for %s: %s", server_name, e)
        return _oauth_result_page("Could not complete authorization. Please try again.", ok=False)

    # Now that we have a token, fetch tools so the server is immediately usable.
    try:
        access_token = mcp_oauth_service.get_valid_access_token(user_id, row)
        _fetch_and_store_tools(row, access_token)
        state_service.mcp_servers.put(user_id, server_name, _clean(row))
    except (MCPConnectionError, TimeoutError) as e:
        logger.warning("[mcp-oauth] connected but tool fetch failed for %s: %s", server_name, e)
        # Token is stored; the frontend can reinitialize to retry the fetch.

    return _oauth_result_page(f"{row.get('config', {}).get('title', server_name)} connected.", ok=True)


@misc_bp.route("/api/mcp/oauth/cancel/<server_name>", methods=["POST"])
@require_auth
def cancel_mcp_oauth(server_name: str):
    """Abort an in-flight OAuth connect. Pending state rows expire on their own
    TTL; this simply acknowledges so the frontend can stop polling."""
    return jsonify({"success": True, "serverName": server_name})


@misc_bp.route("/api/mcp/<server_name>/auth-values", methods=["GET"])
@require_auth
def mcp_auth_values(server_name: str):
    """Whether this user has credentials/token set for the server (drives the
    config dialog's set/unset indicators)."""
    user_id = get_request_state_partition()
    row = state_service.mcp_servers.get(user_id, server_name)
    if not row:
        return jsonify({"error": "Not found"}), 404
    is_oauth = mcp_oauth_service.is_oauth_server(row)
    authenticated = (
        mcp_oauth_service.has_token(user_id, server_name)
        if is_oauth
        else bool((row.get("config", {}) or {}).get("apiKey", {}).get("key"))
    )
    # authValueFlags is the contract the config dialog reads: per custom-var
    # key -> is-it-set. Per-user custom var storage isn't implemented, so those
    # are all false; for OAuth servers there are no custom vars.
    custom_vars = (row.get("config", {}) or {}).get("customUserVars", {}) or {}
    auth_value_flags = {key: False for key in custom_vars}
    return jsonify({
        "success": True,
        "serverName": server_name,
        "authValueFlags": auth_value_flags,
        "requiresOAuth": is_oauth,
        "authenticated": authenticated,
    })


# --------------- MCP catalog (one-click providers) ---------------

@misc_bp.route("/api/mcp/catalog", methods=["GET"])
@require_auth
def mcp_catalog_list():
    user_id = get_request_state_partition()
    return jsonify({"catalog": mcp_catalog.list_catalog(user_id)})


@misc_bp.route("/api/mcp/catalog/<server_name>/add", methods=["POST"])
@require_auth
def mcp_catalog_add(server_name: str):
    """Create a catalog server (pre-filled config) and start its OAuth connect.
    Returns the same {oauthRequired, oauthUrl} shape as reinitialize."""
    config = mcp_catalog.build_config(server_name)
    if not config:
        return jsonify({"error": "Unknown catalog server"}), 404
    if not mcp_catalog.is_available():
        return jsonify({"error": "Google Workspace is not configured on this server"}), 503

    user_id = get_request_state_partition()
    existing = state_service.mcp_servers.get(user_id, server_name)
    row = existing or {
        "serverName": server_name,
        "dbId": str(uuid.uuid4()),
        "config": config,
    }
    if not existing:
        state_service.mcp_servers.put(user_id, server_name, row)

    # Already connected with a valid token → don't force a fresh consent.
    if mcp_oauth_service.get_valid_access_token(user_id, row):
        return jsonify({
            "success": True,
            "serverName": server_name,
            "oauthRequired": False,
            "oauthUrl": None,
        })

    oauth_url = _oauth_initiate_response(server_name, row)
    if not oauth_url:
        return jsonify({"error": "Could not start authorization"}), 500
    return jsonify({
        "success": True,
        "serverName": server_name,
        "oauthRequired": True,
        "oauthUrl": oauth_url,
    })


# --------------- Admin ---------------

def _format_admin_user(u: dict) -> dict:
    return {
        "id": u.get("id", ""),
        "name": u.get("name", ""),
        "email": u.get("email", ""),
        "username": u.get("username", ""),
        "avatar": u.get("avatar", ""),
        "role": u.get("role", "USER"),
        "provider": u.get("provider", ""),
        "createdAt": u.get("createdAt", ""),
        "active": u.get("active", True),
    }


@misc_bp.route("/api/admin/users", methods=["GET"])
@require_auth
def admin_users():
    user = find_user_by_id(g.user_id)
    if not user or user.get("role", "").upper() != "ADMIN":
        return jsonify({"error": "Forbidden"}), 403

    q = request.args.get("q", "").lower().strip()
    try:
        users = get_all_users()
    except Exception:
        logger.exception("[admin_users] failed to load users")
        return jsonify({"users": [], "total": 0})

    if q:
        users = [u for u in users if q in (u.get("name", "") + u.get("email", "")).lower()]

    formatted = [_format_admin_user(u) for u in users]
    return jsonify({"users": formatted, "total": len(formatted)})


@misc_bp.route("/api/admin/users/set-role", methods=["PATCH"])
@require_auth
def admin_set_role():
    caller = find_user_by_id(g.user_id)
    if not caller or caller.get("role", "").upper() != "ADMIN":
        return jsonify({"error": "Forbidden"}), 403

    data = request.get_json() or {}
    target_user_id = data.get("userId")
    new_role = data.get("role", "USER").upper()
    if not target_user_id:
        return jsonify({"error": "userId required"}), 400

    target = find_user_by_id(target_user_id)
    if not target:
        return jsonify({"error": "User not found"}), 404

    update_user_field(target, "role", new_role)
    return jsonify({"userId": target_user_id, "role": new_role})


@misc_bp.route("/api/admin/users/disable", methods=["PATCH"])
@require_auth
def admin_disable_users():
    caller = find_user_by_id(g.user_id)
    if not caller or caller.get("role", "").upper() != "ADMIN":
        return jsonify({"error": "Forbidden"}), 403

    data = request.get_json() or {}
    user_ids = data.get("userIds", [])
    if not user_ids:
        return jsonify({"error": "userIds required"}), 400

    disabled = []
    for uid in user_ids:
        if uid == g.user_id:
            continue
        target = find_user_by_id(uid)
        if target:
            update_user_field(target, "active", False)
            disabled.append(uid)

    return jsonify({"disabled": disabled})


@misc_bp.route("/api/admin/users/enable", methods=["PATCH"])
@require_auth
def admin_enable_users():
    caller = find_user_by_id(g.user_id)
    if not caller or caller.get("role", "").upper() != "ADMIN":
        return jsonify({"error": "Forbidden"}), 403

    data = request.get_json() or {}
    user_ids = data.get("userIds", [])
    if not user_ids:
        return jsonify({"error": "userIds required"}), 400

    enabled = []
    for uid in user_ids:
        target = find_user_by_id(uid)
        if target:
            update_user_field(target, "active", True)
            enabled.append(uid)

    return jsonify({"enabled": enabled})


# --------------- Favorites ---------------

def _favorites_array_from_payload(favs: dict | None) -> list:
    if not isinstance(favs, dict):
        return []
    raw = favs.get("favorites")
    return raw if isinstance(raw, list) else []


@misc_bp.route("/api/user/settings/favorites", methods=["GET"])
@require_auth
def user_favorites():
    user_id = get_request_state_partition()
    row = state_service.favorites.get(user_id)
    return jsonify(_favorites_array_from_payload(row))


@misc_bp.route("/api/user/settings/favorites", methods=["POST"])
@require_auth
def update_favorites():
    body = request.get_json() or {}
    favorites = body.get("favorites")
    if not isinstance(favorites, list):
        return jsonify({"error": "expected body { favorites: array }"}), 400
    user_id = get_request_state_partition()
    state_service.favorites.put(user_id, {"favorites": favorites})
    return jsonify(favorites)


# --------------- Speech / Permissions / Code Auth ---------------

@misc_bp.route("/api/files/speech/config/get", methods=["GET"])
@require_auth
def speech_config():
    return jsonify({})


# Resource permission bits (packages/data-provider/src/accessPermissions.ts):
# VIEW=1, EDIT=2, DELETE=4, SHARE=8.
_PERM_VIEW, _PERM_EDIT, _PERM_DELETE, _PERM_SHARE = 1, 2, 4, 8
_PERM_OWNER = _PERM_VIEW | _PERM_EDIT | _PERM_DELETE  # 7 — no sharing in v1


@misc_bp.route("/api/permissions/<resource_type>/effective/all", methods=["GET"])
@require_auth
def all_effective_permissions(resource_type):
    """Effective permission bits per resource id, for the calling user.

    MCP servers live in the caller's own state partition — they created them and
    nobody else can see them — so they always hold owner rights. Without this the
    client falls back to VIEW-only (1) and hides the Edit action on every card.
    Sharing is out of scope for v1, so SHARE is not granted.
    """
    if resource_type == "mcpServer":
        user_id = get_request_state_partition()
        servers = state_service.mcp_servers.list_for_user(user_id)
        return jsonify({
            s["dbId"]: _PERM_OWNER
            for s in servers
            if s.get("dbId")
        })
    return jsonify({})


@misc_bp.route("/api/permissions/<resource_type>/<resource_id>/effective", methods=["GET"])
@require_auth
def resource_effective_permissions(resource_type, resource_id):
    # Client expects { permissionBits: number }; VIEW=1, EDIT=2, DELETE=4, SHARE=8, owner=15
    if resource_type.lower() != "agent":
        return jsonify({"permissionBits": 15})

    user_id = get_request_state_partition()
    is_own = state_service.agents.get(user_id, resource_id) is not None
    permission_bits = 15 if is_own else 0
    return jsonify({"permissionBits": permission_bits})


@misc_bp.route("/api/permissions/<resource_type>/<resource_id>", methods=["GET", "PUT"])
@require_auth
def resource_permissions(resource_type, resource_id):
    if resource_type.lower() != "agent":
        if request.method == "PUT":
            return jsonify(request.get_json() or {})
        return jsonify({"principals": [], "public": False})

    user_id = get_request_state_partition()
    agent = state_service.agents.get(user_id, resource_id)

    if request.method == "GET":
        if not agent:
            return jsonify({"principals": [], "public": False})
        perms = agent.get("_permissions") or {}
        return jsonify({
            "principals": perms.get("principals", []),
            "public": perms.get("public", False),
            "publicAccessRoleId": perms.get("publicAccessRoleId"),
        })

    # PUT — persist the public flag and principals
    data = request.get_json() or {}
    if not agent:
        return jsonify({"principals": [], "public": False})

    permissions = {
        "public": data.get("public", False),
        "publicAccessRoleId": data.get("publicAccessRoleId"),
        "principals": data.get("updated", []),
    }
    agent["_permissions"] = permissions
    agent["isPublic"] = data.get("public", False)
    state_service.agents.put(user_id, resource_id, _clean(agent))
    return jsonify(permissions)


@misc_bp.route("/api/permissions/<resource_type>/roles", methods=["GET"])
@require_auth
def permission_roles(resource_type):
    return jsonify([])


@misc_bp.route("/api/permissions/search-principals", methods=["GET"])
@require_auth
def search_principals():
    return jsonify([])


@misc_bp.route("/api/agents/tools/execute_code/auth", methods=["GET"])
@require_auth
def agent_tool_code_auth():
    return jsonify({"authenticated": False})
