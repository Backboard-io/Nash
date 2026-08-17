"""MCP (Model Context Protocol) client service, built on the official `mcp` SDK.

Supports remote streamable-http (default) and SSE transports with static auth
(bearer / basic / custom header). Handles:
- Fetching tool definitions from an MCP server (spec-compliant initialize
  handshake, session management, pagination)
- Calling tools and returning results as strings for Backboard tool outputs
- Converting MCP tool schemas to OpenAI function-calling format, using the
  client's naming convention ``{tool}_mcp_{server}`` (Constants.mcp_delimiter)
  so ToolCall.tsx renders server attribution without changes

Connections are per-call (connect → initialize → request → close): correct for
v1 and stateless-friendly; pooling is a later optimization.
"""
import asyncio
import hashlib
import json
import logging
import re
from contextlib import asynccontextmanager
from decimal import Decimal

from mcp import ClientSession
from mcp.client.sse import sse_client
from mcp.client.streamable_http import streamablehttp_client

logger = logging.getLogger(__name__)

# Matches Constants.mcp_delimiter in packages/data-provider/src/config.ts —
# ToolCall.tsx splits on it as `{function}_mcp_{server}`.
MCP_DELIMITER = "_mcp_"
# Providers commonly cap function names at 64 chars; longer names are
# truncated deterministically (dispatch never parses names — see tool maps).
MAX_TOOL_NAME_LEN = 64
_NAME_SAFE_RE = re.compile(r"[^a-zA-Z0-9_-]")

MCP_LIST_TIMEOUT = 30
MCP_CALL_TIMEOUT = 60
# Backboard tool outputs travel inside the LLM context; cap runaway results.
MCP_OUTPUT_MAX_CHARS = 100_000


def init_timeout_for(server: dict) -> float:
    """Handshake/tool-list timeout in seconds. Honors a per-server
    ``config.initTimeout`` (milliseconds, per the MCP server spec) so slow
    remote servers aren't cut off — Google Workspace's servers document
    ``initTimeout: 150000``. Falls back to MCP_LIST_TIMEOUT."""
    raw = _get_config(server).get("initTimeout")
    try:
        return float(raw) / 1000.0 if raw else float(MCP_LIST_TIMEOUT)
    except (TypeError, ValueError):
        return float(MCP_LIST_TIMEOUT)


class MCPConnectionError(Exception):
    """Raised when an MCP server cannot be reached/initialized or listing fails."""


def _get_config(server: dict) -> dict:
    return server.get("config", server) or {}


def _build_headers(server: dict, access_token: str | None = None) -> dict:
    """HTTP headers for an MCP connection.

    When ``access_token`` is provided (OAuth servers), it is the authorization —
    injected as a bearer and taking precedence over any static apiKey. When it
    is None (the default, and every non-OAuth server), behavior is unchanged:
    static bearer/basic/custom auth from ``config.apiKey``. Extra static
    ``config.headers`` are always merged last.
    """
    headers: dict = {}
    config = _get_config(server)
    if access_token:
        headers["Authorization"] = f"Bearer {access_token}"
    else:
        api_key_config = config.get("apiKey", {}) or {}
        if api_key_config:
            key = api_key_config.get("key", "")
            auth_type = api_key_config.get("authorization_type", "bearer")
            custom_header = api_key_config.get("custom_header", "")
            if key:
                if auth_type == "bearer":
                    headers["Authorization"] = f"Bearer {key}"
                elif auth_type == "basic":
                    headers["Authorization"] = f"Basic {key}"
                elif auth_type == "custom" and custom_header:
                    headers[custom_header] = key

    extra_headers = config.get("headers", {}) or {}
    headers.update(extra_headers)
    return headers


def _get_url(server: dict) -> str:
    return _get_config(server).get("url", "")


def _get_transport(server: dict) -> str:
    """'streamable-http' (default) or 'sse'. stdio/websocket are unsupported."""
    transport = (_get_config(server).get("type") or "").lower().replace("_", "-")
    return "sse" if transport == "sse" else "streamable-http"


@asynccontextmanager
async def _mcp_session(server: dict, access_token: str | None = None):
    url = _get_url(server)
    if not url:
        raise MCPConnectionError("No URL configured for MCP server")
    headers = _build_headers(server, access_token)
    if _get_transport(server) == "sse":
        transport_ctx = sse_client(url, headers=headers)
    else:
        transport_ctx = streamablehttp_client(url, headers=headers)
    async with transport_ctx as transport:
        read_stream, write_stream = transport[0], transport[1]
        async with ClientSession(read_stream, write_stream) as session:
            await session.initialize()
            yield session


def describe_mcp_error(exc: BaseException) -> str:
    """Human-readable reason for an MCP failure.

    The SDK runs the transport inside a task group, so a plain str() surfaces
    "unhandled errors in a TaskGroup (1 sub-exception)" instead of the thing that
    actually went wrong (an HTTP 401 from a bad token, a refused connection…).
    Walk into the ExceptionGroup and translate the real cause.
    """
    seen: list[str] = []

    def walk(e: BaseException, depth: int = 0) -> None:
        if depth > 5 or e is None:
            return
        subs = getattr(e, "exceptions", None)
        if subs:  # ExceptionGroup / TaskGroup wrapper — the message is noise
            for sub in subs:
                walk(sub, depth + 1)
            return

        status = None
        response = getattr(e, "response", None)
        if response is not None:
            status = getattr(response, "status_code", None)
        if status is None:
            status = getattr(e, "status_code", None)

        if status in (401, 403):
            seen.append(
                f"HTTP {status} — the server rejected our credentials. "
                "Check the API key and header format."
            )
        elif status == 404:
            seen.append(f"HTTP 404 — no MCP endpoint at that URL (is the path right?).")
        elif status is not None:
            seen.append(f"HTTP {status} from the MCP server.")
        elif isinstance(e, TimeoutError):
            seen.append("Timed out connecting to the MCP server.")
        else:
            text = str(e).strip()
            if text:
                seen.append(f"{type(e).__name__}: {text}")
            else:
                seen.append(type(e).__name__)
        if e.__cause__ is not None:
            walk(e.__cause__, depth + 1)

    walk(exc)
    # Prefer an auth/HTTP diagnosis over a generic transport error.
    for msg in seen:
        if msg.startswith("HTTP"):
            return msg
    return seen[0] if seen else str(exc)


async def fetch_mcp_tools(server: dict, access_token: str | None = None) -> list[dict]:
    """Fetch tool definitions from an MCP server (all pages).

    Returns MCP tool dicts: [{"name", "description", "inputSchema"}, ...].
    Raises MCPConnectionError on any connection/handshake/listing failure so
    callers surface the problem instead of storing a silent zero-tool server.
    ``access_token`` is passed for OAuth servers; None for static-auth servers.
    """
    url = _get_url(server)
    # Preserve the exact single-arg call when there's no token so nothing about
    # the static-auth path (or its tests) changes.
    session_cm = _mcp_session(server) if access_token is None else _mcp_session(server, access_token)
    try:
        async with asyncio.timeout(init_timeout_for(server)):
            async with session_cm as session:
                tools: list[dict] = []
                cursor: str | None = None
                while True:
                    page = await session.list_tools(cursor=cursor)
                    tools.extend(
                        t.model_dump(mode="json", exclude_none=True)
                        for t in page.tools
                    )
                    cursor = page.nextCursor
                    if not cursor:
                        break
                logger.info("[mcp] fetched %d tools from %s", len(tools), url)
                return tools
    except MCPConnectionError:
        raise
    except Exception as e:
        reason = describe_mcp_error(e)
        logger.warning("[mcp] failed to fetch tools from %s: %s", url, reason)
        raise MCPConnectionError(f"{url}: {reason}") from e


async def call_mcp_tool(
    server: dict,
    tool_name: str,
    arguments: dict,
    timeout: float = MCP_CALL_TIMEOUT,
    access_token: str | None = None,
) -> str:
    """Call an MCP tool and return the result as a string.

    Never raises — failures come back as a JSON error string so the tool
    output can be submitted to Backboard and the model can react to it.
    ``access_token`` is passed for OAuth servers; None for static-auth servers.
    """
    url = _get_url(server)
    session_cm = _mcp_session(server) if access_token is None else _mcp_session(server, access_token)
    try:
        async with asyncio.timeout(timeout):
            async with session_cm as session:
                result = await session.call_tool(tool_name, arguments or {})
    except TimeoutError:
        logger.warning("[mcp] tool call timed out (%s on %s)", tool_name, url)
        return json.dumps(
            {"error": f"MCP tool '{tool_name}' timed out after {timeout:.0f}s"}
        )
    except Exception as e:
        reason = describe_mcp_error(e)
        logger.warning("[mcp] tool call failed (%s on %s): %s", tool_name, url, reason)
        return json.dumps({"error": f"MCP tool '{tool_name}' failed: {reason}"})

    parts: list[str] = []
    for item in result.content or []:
        item_type = getattr(item, "type", "")
        if item_type == "text":
            parts.append(item.text or "")
        else:
            # Non-text blocks (images, resources) — pass through as JSON.
            parts.append(json.dumps(item.model_dump(mode="json", exclude_none=True)))
    output = "\n".join(p for p in parts if p)
    if not output and result.structuredContent is not None:
        output = json.dumps(result.structuredContent)
    if not output:
        output = json.dumps({"ok": True})
    if result.isError:
        return json.dumps({"error": output[:MCP_OUTPUT_MAX_CHARS]})
    if len(output) > MCP_OUTPUT_MAX_CHARS:
        output = output[:MCP_OUTPUT_MAX_CHARS] + "\n[output truncated]"
    return output


def mcp_server_client_payload(row: dict) -> dict:
    """The single client-facing shape for a stored MCP server row.

    The client flattens this into `{dbId, consumeOnly, ...config}` and reads
    `config.title` / `config.url`, so the config fields must be at the TOP level
    — not nested under a `config` key, and never carrying the (large) tool
    blobs. Both GET /api/mcp/servers and /api/init must emit this exact shape:
    they share one react-query cache key, and a mismatched shape from either one
    silently blanks the server edit form.
    """
    config = row.get("config", {}) or {}
    payload = {
        "serverName": row.get("serverName", ""),
        "dbId": row.get("dbId", ""),
        **{k: v for k, v in config.items() if k not in ("openai_tools", "tools")},
    }
    # Never return an OAuth client secret to the browser. Generic (user-added)
    # OAuth servers store client_secret in config; catalog/preset servers keep
    # it in env and never store it. Strip it either way — the client only needs
    # to know a server is OAuth, not its secret (see /auth-values for set/unset).
    oauth = payload.get("oauth")
    if isinstance(oauth, dict) and "client_secret" in oauth:
        payload["oauth"] = {k: v for k, v in oauth.items() if k != "client_secret"}
    return payload


def json_safe(value):
    """Convert DynamoDB Decimals (and nested containers) to plain JSON types.

    Tool schemas are stored in DynamoDB, which returns EVERY number as a
    ``Decimal`` (``maximum``, ``minLength``, ``default`` …). Those schemas are
    sent straight back out to Backboard as per-turn ``tools``, and the JSON
    encoder rejects Decimal — so normalize on the way out.
    """
    if isinstance(value, Decimal):
        as_int = int(value)
        return as_int if value == as_int else float(value)
    if isinstance(value, dict):
        return {k: json_safe(v) for k, v in value.items()}
    if isinstance(value, list):
        return [json_safe(v) for v in value]
    return value


def make_openai_tool_name(tool_name: str, server_name: str) -> str:
    """Build the exposed function name ``{tool}_mcp_{server}``.

    Sanitized to the provider-safe charset and deterministically truncated to
    MAX_TOOL_NAME_LEN with a short digest suffix (uniqueness under truncation).
    Dispatch uses the tool map, never name parsing, so truncation is safe.
    """
    name = f"{tool_name}{MCP_DELIMITER}{server_name}" if server_name else tool_name
    name = _NAME_SAFE_RE.sub("_", name)
    if len(name) > MAX_TOOL_NAME_LEN:
        digest = hashlib.sha1(name.encode("utf-8")).hexdigest()[:6]
        name = f"{name[: MAX_TOOL_NAME_LEN - 7]}_{digest}"
    return name


def mcp_tools_to_openai_format(mcp_tools: list[dict], server_name: str = "") -> list[dict]:
    """Convert MCP tool schemas to OpenAI function-calling format for Backboard."""
    openai_tools = []
    for tool in mcp_tools:
        name = tool.get("name", "")
        if not name:
            continue
        input_schema = json_safe(tool.get("inputSchema", {}) or {})
        description = tool.get("description", "")
        if server_name:
            description = f"[{server_name}] {description}" if description else f"[{server_name}]"
        openai_tools.append({
            "type": "function",
            "function": {
                "name": make_openai_tool_name(name, server_name),
                "description": description,
                "parameters": input_schema if input_schema else {"type": "object", "properties": {}},
            },
        })
    return openai_tools


def build_mcp_system_prompt(mcp_server_map: dict) -> str:
    """System prompt telling the model to actually USE the tools we just sent it.

    Sending the tools is not enough. A model calls a tool when it knows it cannot
    answer (live weather), but happily answers from memory when it believes it
    already knows the domain (e.g. AWS docs) — which is exactly the case where the
    user attached a documentation server *because* the model's training data is
    stale. Backboard exposes no `tool_choice` parameter, so the per-turn system
    prompt is the only lever we have to bias toward calling the tool.
    """
    lines = []
    for server_name, server in mcp_server_map.items():
        config = server.get("config", {}) or {}
        title = config.get("title") or server_name
        description = (config.get("description") or "").strip()
        tool_names = [t.get("name", "") for t in (server.get("tools") or []) if t.get("name")]
        entry = f'- "{title}"'
        if description:
            entry += f" — {description}"
        if tool_names:
            entry += f" (tools: {', '.join(tool_names)})"
        lines.append(entry)
    servers_block = "\n".join(lines)

    return (
        "The user has connected the following external tool servers to this "
        f"conversation:\n{servers_block}\n\n"
        "These tools return authoritative, up-to-date information. Whenever the "
        "user's request falls within the scope of any available tool, you MUST call "
        "the relevant tool(s) and base your answer on what they return. Do NOT answer "
        "from your own knowledge in that case — your training data may be outdated or "
        "incorrect, which is precisely why the user connected these tools. Call a tool "
        "even if you believe you already know the answer. Only answer directly when no "
        "available tool is relevant to the request. Never invent tool results, URLs, or "
        "quotes: if you present something as coming from a tool, it must be what the "
        "tool actually returned."
    )


def build_tool_payload(mcp_server_map: dict) -> tuple[list[dict], dict]:
    """Build the per-turn Backboard payload for the selected MCP servers.

    Returns (openai_tools, tool_map) where tool_map maps each exposed
    function name to ``(server_row, real_mcp_tool_name)`` for dispatch.
    Prefers raw MCP tool defs stored on the row; falls back to legacy rows
    that only stored pre-converted openai_tools under the old
    ``{server}__{tool}`` naming.
    """
    openai_tools: list[dict] = []
    tool_map: dict[str, tuple[dict, str]] = {}
    for server_name, server in mcp_server_map.items():
        raw_tools = server.get("tools") or []
        if raw_tools:
            for tool in raw_tools:
                real_name = tool.get("name", "")
                if not real_name:
                    continue
                converted = mcp_tools_to_openai_format([tool], server_name=server_name)
                if not converted:
                    continue
                exposed = converted[0]["function"]["name"]
                if exposed in tool_map:
                    continue
                tool_map[exposed] = (server, real_name)
                openai_tools.append(converted[0])
            continue
        # Legacy rows: only openai_tools with "{server}__{tool}" names.
        for old_tool in server.get("openai_tools") or []:
            fn = old_tool.get("function", {}) or {}
            old_name = fn.get("name", "")
            if not old_name:
                continue
            prefix = f"{server_name}__"
            real_name = old_name[len(prefix):] if old_name.startswith(prefix) else old_name
            exposed = make_openai_tool_name(real_name, server_name)
            if exposed in tool_map:
                continue
            tool_map[exposed] = (server, real_name)
            openai_tools.append({
                "type": "function",
                "function": {
                    "name": exposed,
                    "description": fn.get("description", ""),
                    "parameters": json_safe(fn.get("parameters", {"type": "object", "properties": {}})),
                },
            })
    return openai_tools, tool_map
