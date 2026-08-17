import hashlib
import json
import logging
import mimetypes
import os
import threading
from collections import OrderedDict
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from backboard import BackboardClient

from api.config import settings

# Tool outputs can be large (an AWS docs search returns ~4 KB; a page fetch far
# more). The chip only needs enough to show what grounded the answer.
TOOL_OUTPUT_DISPLAY_LIMIT = 8000

logger = logging.getLogger(__name__)

MISSING_USER_API_KEY_MESSAGE = "Authenticated session is missing its Backboard API key"
MISSING_USER_CLIENT_MESSAGE = "A user-scoped Backboard client is required"

# The single Backboard assistant Nash owns per user. Discovery is by name —
# Backboard's AssistantCreate has no metadata field, so the name is the only
# stable handle across sessions.
NASH_MAIN_ASSISTANT_NAME = "nash-main"

# Hard pagination cap when listing assistants. 5000 = 50 pages of 100, more
# than enough; bigger accounts would need a redesign anyway.
_LIST_ASSISTANTS_PAGE_SIZE = 100
_LIST_ASSISTANTS_HARD_CAP = 5000
MAX_TOOL_ITERATIONS = 10
DOCUMENT_EXPORT_TOOL_NAME = "create_document_export"
INTERNAL_IMAGE_TOOL_PREFIX = "inspect_uploaded_image_"
DOCUMENT_EXPORT_TOOL = {
    "type": "function",
    "function": {
        "name": DOCUMENT_EXPORT_TOOL_NAME,
        "description": (
            "Create a downloadable document or code file. Use this when the user asks to "
            "make, save, export, generate, or download a PDF, Word document, spreadsheet, "
            "CSV, text file, or code file."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "filename": {
                    "type": "string",
                    "description": "Filename with extension, such as report.pdf or app.py.",
                },
                "content": {
                    "type": "string",
                    "description": "Exact file contents to write. Do not include chat summary text.",
                },
            },
            "required": ["filename", "content"],
            "additionalProperties": False,
        },
    },
}


@dataclass
class _ThreadMessage:
    """Normalized thread message (supports role='tool' from Backboard)."""
    message_id: str
    content: str
    role: str  # 'user' | 'assistant' | 'system' | 'tool'
    created_at: datetime | None
    # Backboard's `metadata_` blob. Carries the tool round-trip: `tool_calls` /
    # `all_run_tool_calls` on assistant messages, and `tool_call_id` / `tool_name`
    # on role='tool' ones. It also carries Nash's per-send correlation token,
    # which lets file persistence bind uploads to the exact user message without
    # a snapshot-diff race. build_tool_call_parts() reassembles tool metadata.
    metadata: dict = field(default_factory=dict)


def role_name(message) -> str:
    role = getattr(message, "role", "")
    value = getattr(role, "value", role)
    return str(value).split(".")[-1].lower()


def _is_export_tool_payload(text: str) -> bool:
    """True when content is the JSON blob returned by create_document_export."""
    stripped = (text or "").strip()
    if not stripped.startswith("{"):
        return False
    try:
        data = json.loads(stripped)
    except (json.JSONDecodeError, TypeError):
        return False
    return isinstance(data, dict) and bool(data.get("filename")) and bool(data.get("url"))


def is_user_visible_message(message: _ThreadMessage) -> bool:
    """Whether a thread message should be shown in the Nash chat UI."""
    role = role_name(message)
    if role == "tool":
        return False
    content = (message.content or "").strip()
    if role != "user" and not content:
        # Tool-call stubs and other empty non-user rows are internal state.
        return False
    if role == "assistant" and _is_export_tool_payload(content):
        return False
    return True


def normalize_raw_messages(raw_messages: list) -> list[_ThreadMessage]:
    """Normalize raw Backboard message dicts into _ThreadMessage objects.

    The Backboard SDK Thread model only allows role in ('user', 'assistant', 'system'),
    but the API returns role='tool' for tool-call results (causing ValidationError)
    and sometimes list-shaped content — so consumers work from raw JSON and
    normalize here.
    """
    out: list[_ThreadMessage] = []
    for m in raw_messages or []:
        role = (m.get("role") or "assistant").lower()
        if role not in ("user", "assistant", "system", "tool"):
            role = "assistant"
        msg_id = str(m.get("id") or m.get("message_id") or "")
        content = m.get("content") or ""
        if isinstance(content, list):
            content = "".join(
                (c.get("text", {}).get("value", "") if isinstance(c, dict) else str(c))
                for c in content
            )
        elif not isinstance(content, str):
            content = str(content)
        raw_created = m.get("created_at")
        created_at: datetime | None = None
        if raw_created is not None:
            if isinstance(raw_created, datetime):
                created_at = raw_created
            elif isinstance(raw_created, (int, float)):
                created_at = datetime.fromtimestamp(raw_created)
            else:
                try:
                    created_at = datetime.fromisoformat(str(raw_created).replace("Z", "+00:00"))
                except (ValueError, TypeError):
                    pass
        metadata: dict = {}
        alias_metadata = m.get("metadata_")
        if isinstance(alias_metadata, dict):
            metadata.update(alias_metadata)
        canonical_metadata = m.get("metadata")
        if isinstance(canonical_metadata, dict):
            metadata.update(canonical_metadata)
        out.append(
            _ThreadMessage(
                message_id=msg_id,
                content=content,
                role=role,
                created_at=created_at,
                metadata=metadata,
            )
        )
    return out


def is_chip_tool(name: str) -> bool:
    """Whether a tool call should be shown to the user as a chip.

    MCP tools are visible. Document export and the retired uploaded-image
    inspection tool are internal implementation details whose raw outputs would
    confuse users or leak internal URLs/base64 payloads.

    Do NOT test for MCP_DELIMITER here: make_openai_tool_name() truncates the
    exposed name from the head at 64 chars, which chops the trailing
    `_mcp_{server}` off long tool names. Using the delimiter as the predicate
    would silently drop those chips on reload while the live stream still showed
    them — the two paths MUST agree, so both call this.
    """
    return (
        bool(name)
        and name != DOCUMENT_EXPORT_TOOL_NAME
        and not name.startswith(INTERNAL_IMAGE_TOOL_PREFIX)
    )


def truncate_tool_output(output: str) -> str:
    """Cap a tool output for display. Never applied to what we send Backboard."""
    if len(output) > TOOL_OUTPUT_DISPLAY_LIMIT:
        return output[:TOOL_OUTPUT_DISPLAY_LIMIT] + "\n…[truncated]"
    return output


def _tool_call_part(call: Any, outputs: dict[str, str]) -> dict | None:
    """One Backboard tool_call -> one ContentTypes.TOOL_CALL part, or None.

    Deliberately omits the `type` key: ToolCall.tsx treats a part as a plain
    tool call only when `type` is absent (Backboard sends type='function',
    which the client routes to its legacy Assistants-API renderer instead).
    """
    if not isinstance(call, dict):
        return None
    fn = call.get("function") or {}
    name = fn.get("name") or ""
    if not is_chip_tool(name):
        return None
    return {
        "type": "tool_call",
        "tool_call": {
            "id": call.get("id") or "",
            "name": name,
            "args": fn.get("arguments") or "",
            "output": truncate_tool_output(outputs.get(str(call.get("id") or ""), "")),
            "progress": 1,
        },
    }


def build_tool_call_parts(messages: list[_ThreadMessage]) -> dict[str, list[dict]]:
    """Map assistant message_id -> tool_call content parts, from thread history.

    Backboard persists the whole tool round-trip, so Nash stores no second copy.
    A run that called tools leaves behind, in order:

        assistant  content=""      metadata_: {run_id, tool_calls: [...]}   <- hidden stub
        tool       content=OUTPUT  metadata_: {run_id, tool_call_id}        <- hidden
        ...one stub + one tool message per round...
        assistant  content=ANSWER  metadata_: {run_id}                      <- the only visible one

    Everything is stitched together by **run_id**, not by position: the calls
    come off the stubs, the outputs off the role='tool' messages (joined on
    tool_call_id), and the chips land on that run's visible answer.

    Do NOT key off `all_run_tool_calls`: Backboard only sets it on the answer
    when tool outputs were submitted NON-streaming. Nash submits with
    stream=true, where the answer carries just a run_id — so that field is
    absent in every message this app actually produces.
    """
    outputs: dict[str, str] = {}
    calls_by_run: dict[str, dict[str, Any]] = {}
    answer_of_run: dict[str, str] = {}

    for m in messages:
        run_id = str(m.metadata.get("run_id") or "")
        if m.role == "tool":
            call_id = str(m.metadata.get("tool_call_id") or "")
            if call_id:
                outputs[call_id] = m.content or ""
            continue
        if m.role != "assistant" or not run_id:
            continue
        # Calls accumulate across every round of the run, keyed by call id so a
        # stub and an all_run_tool_calls list can't double-count the same call.
        calls = m.metadata.get("tool_calls") or m.metadata.get("all_run_tool_calls") or []
        bucket = calls_by_run.setdefault(run_id, {})
        for call in calls:
            if isinstance(call, dict) and call.get("id"):
                bucket.setdefault(str(call["id"]), call)
        if (m.content or "").strip():
            # Last visible assistant message of the run == the answer the chips
            # belong above. (A mid-run preamble would be overwritten by the
            # real answer, which is what we want.)
            answer_of_run[run_id] = str(m.message_id)

    parts: dict[str, list[dict]] = {}
    for run_id, bucket in calls_by_run.items():
        message_id = answer_of_run.get(run_id)
        if not message_id:
            continue  # run never produced a visible answer (aborted / errored)
        built = [p for p in (_tool_call_part(c, outputs) for c in bucket.values()) if p]
        if built:
            parts[message_id] = built
    return parts


async def get_thread_messages(thread_id: str, bb_client=None) -> list[_ThreadMessage]:
    """Fetch thread messages from Backboard, normalized via normalize_raw_messages."""
    client = require_user_client(bb_client)
    response = await client._make_request("GET", f"threads/{thread_id}")
    data = response.json()
    return normalize_raw_messages(data.get("messages") or [])


def require_user_api_key(api_key: str | None) -> str:
    """Normalize a mandatory authenticated-user Backboard API key."""
    normalized = (api_key or "").strip()
    if not normalized:
        raise ValueError(MISSING_USER_API_KEY_MESSAGE)
    return normalized


def require_user_client(client: BackboardClient | None) -> BackboardClient:
    """Return a user-scoped client or fail instead of substituting a global one."""
    if client is None:
        raise ValueError(MISSING_USER_CLIENT_MESSAGE)
    return client


def new_user_client(api_key: str | None) -> BackboardClient:
    """Create a FRESH, caller-owned BackboardClient.

    The caller is responsible for calling ``aclose()`` on it. Use this ONLY for
    lifecycles that must own and tear down their own client (e.g. long-lived
    voice WebSocket sessions that explicitly close FDs). For ordinary
    request/stream work use :func:`get_user_client`, which returns a pooled,
    connection-reusing client that this module owns.
    """
    return BackboardClient(
        api_key=require_user_api_key(api_key),
        base_url=settings.backboard_api_url,
        timeout=120,
    )


# ---------------------------------------------------------------------------
# Client pool
# ---------------------------------------------------------------------------
# A BackboardClient eagerly owns an httpx.AsyncClient (a connection pool).
# Constructing one per request — as the code used to — churns TCP/TLS
# connections AND leaks the pool (nothing ever closes it). Nash runs every
# Backboard coroutine on a single persistent event loop (see async_runner), so
# one client per API key can be shared safely across requests and concurrent
# streams: httpx multiplexes concurrent requests on that loop and reuses
# keep-alive connections. Pooling also collapses the several clients a single
# chat turn used to build (ctx["bb_client"] + each streaming helper) into one.
#
# LRU-bounded so a deployment that sees many distinct keys can't grow the pool
# without limit. Pooled clients are owned here; callers MUST NOT aclose() them.
_CLIENT_POOL_MAX = 1024
_client_pool: "OrderedDict[str, BackboardClient]" = OrderedDict()
_client_pool_lock = threading.Lock()


def _client_pool_key(api_key: str) -> str:
    return hashlib.sha256(api_key.encode("utf-8")).hexdigest()


def get_user_client(api_key: str | None) -> BackboardClient:
    """Return a pooled, connection-reusing BackboardClient for this API key.

    Safe for concurrent use across requests/streams (single persistent event
    loop + httpx concurrency). The returned client is owned by this module —
    do NOT ``aclose()`` it; use :func:`new_user_client` when you need an owned,
    closeable client.
    """
    normalized = require_user_api_key(api_key)
    key = _client_pool_key(normalized)
    with _client_pool_lock:
        client = _client_pool.get(key)
        if client is not None:
            _client_pool.move_to_end(key)
            return client
        client = new_user_client(normalized)
        _client_pool[key] = client
        while len(_client_pool) > _CLIENT_POOL_MAX:
            _, evicted = _client_pool.popitem(last=False)
            # Best-effort, non-blocking close on the persistent loop. The LRU
            # victim is the least-recently-used key, so it is very unlikely to
            # be mid-stream; if it somehow is, httpx surfaces a clear error on
            # its next use rather than corrupting other clients.
            try:
                from api.services.async_runner import run_async_background

                run_async_background(evicted.aclose())
            except Exception:  # pragma: no cover - eviction is best-effort
                logger.debug("client pool: eviction close failed", exc_info=True)
        return client


# ---------------------------------------------------------------------------
# nash-main assistant discovery
# ---------------------------------------------------------------------------

async def _list_all_assistants(client: BackboardClient) -> list[Any]:
    """Paginate through every assistant owned by the BackboardClient's key.

    Stops at _LIST_ASSISTANTS_HARD_CAP to bound work on accounts with very
    large assistant counts.
    """
    out: list[Any] = []
    skip = 0
    while skip < _LIST_ASSISTANTS_HARD_CAP:
        page = await client.list_assistants(skip=skip, limit=_LIST_ASSISTANTS_PAGE_SIZE)
        if not page:
            break
        out.extend(page)
        if len(page) < _LIST_ASSISTANTS_PAGE_SIZE:
            break
        skip += _LIST_ASSISTANTS_PAGE_SIZE
    return out


def _earliest_assistant_id(matches: list[Any]) -> str:
    """Pick the earliest-created assistant; tie-break on str(assistant_id)."""
    def _sort_key(a: Any) -> tuple[str, str]:
        created = getattr(a, "created_at", None)
        # datetime sorts naturally; isoformat() keeps the comparison stable
        # against str fallbacks if the SDK ever returns strings.
        created_key = created.isoformat() if hasattr(created, "isoformat") else str(created or "")
        return (created_key, str(getattr(a, "assistant_id", "")))

    matches_sorted = sorted(matches, key=_sort_key)
    return str(matches_sorted[0].assistant_id)


async def discover_assistant_by_name(client: BackboardClient, name: str) -> str | None:
    """Return the assistant_id of an existing assistant with this exact name, or None.

    If multiple assistants share the name (concurrent-first-login race or a
    stray duplicate from another deploy), returns the earliest-created.
    """
    assistants = await _list_all_assistants(client)
    matches = [a for a in assistants if getattr(a, "name", "") == name]
    if not matches:
        return None
    return _earliest_assistant_id(matches)


async def discover_main_assistant(client: BackboardClient) -> str | None:
    """Return the assistant_id of this user's existing nash-main, or None."""
    return await discover_assistant_by_name(client, NASH_MAIN_ASSISTANT_NAME)


async def ensure_assistant_named(client: BackboardClient, name: str) -> str:
    """Discover-or-create the single assistant with this name under the client's key.

    Idempotent: re-submitting a key or re-logging in returns the same
    assistant — no orphan, no duplicate. On the rare concurrent-first-login
    race, the post-create re-discovery resolves to the earliest assistant by
    created_at. Multi-org contexts pass per-user names so an org key shared
    by all members never resolves to another member's assistant.
    """
    found = await discover_assistant_by_name(client, name)
    if found:
        return found

    await client.create_assistant(
        name=name,
        system_prompt="You are Nash, a helpful AI assistant. Be concise, accurate, and helpful.",
    )

    # Re-discover so concurrent creators converge on the earliest one.
    found = await discover_assistant_by_name(client, name)
    if not found:
        # Backboard accepted the create but lists nothing — surface clearly.
        raise RuntimeError(f"Created '{name}' but could not re-discover it")
    return found


async def ensure_nash_main_assistant(client: BackboardClient) -> str:
    """Discover-or-create the single nash-main assistant (personal contexts)."""
    return await ensure_assistant_named(client, NASH_MAIN_ASSISTANT_NAME)


# ---------------------------------------------------------------------------
# Request-scoped helpers (session auth)
# ---------------------------------------------------------------------------

def get_request_client() -> BackboardClient:
    """Get a Backboard client from the authenticated session only."""
    from flask import g
    return get_user_client(getattr(g, "bb_api_key", None))


def get_request_assistant_id() -> str:
    """Get the chat assistant ID for the current request."""
    from flask import g
    aid = getattr(g, "chat_assistant_id", None)
    if aid is not None and aid != "":
        return aid
    user_id = getattr(g, "user_id", None)
    if user_id:
        from api.services.user_service import get_user_assistant_id
        return get_user_assistant_id(user_id)
    raise ValueError("No assistant_id available — session has no assistant or no user context")


def get_request_user_id() -> str:
    """Resolve the current request's user_id — the IDENTITY of the caller.

    Session auth populates g.user_id when the row carries one; BYOK sessions may populate only
    g.bb_api_key, so we derive the user_id from it — by Phase 2 invariant,
    user_id for BYOK users is sha256(api_key).

    Use this for identity concerns (profile, audit, admin, billing). For
    per-user APP STATE (convos, folders, files, agents, presets, tags…) use
    :func:`get_request_state_partition`, which scopes to the active
    Backboard context.
    """
    from flask import g
    user_id = getattr(g, "user_id", None)
    if user_id:
        return user_id
    api_key = getattr(g, "bb_api_key", None)
    if api_key:
        from api.services.state_service import user_hash_from_api_key
        return user_hash_from_api_key(api_key)
    raise ValueError("No user context — request has no authenticated session")


def get_request_state_partition() -> str:
    """Resolve the state-partition handle for the current request.

    Identical to get_request_user_id() — all data lives in the user's
    personal partition.
    """
    return get_request_user_id()


def parse_model_spec(model: str | None) -> tuple[str | None, str | None]:
    """Split a proxy-style model string into provider and model name."""
    if not model:
        return None, None

    value = model.strip()
    if not value:
        return None, None

    if "/" not in value:
        return None, value

    provider, *rest = value.split("/")
    model_name = "/".join(rest).strip()
    return (provider.strip() or None), (model_name or None)


def added_model_agent_id(endpoint: str, model: str, index: int | None = None) -> str:
    """Python port of packages/data-provider/src/parsers.ts encodeEphemeralAgentId.

    No sender segment — SiblingHeader.tsx falls back to the bare model name
    when parseEphemeralAgentId finds no ___sender part, so it's a fine label.
    Shared between chat.py (live turn) and messages.py (refresh) so both tag
    parallel-response content parts identically.
    """
    base = f"{endpoint}:{model}".replace(":", "__")
    return f"{base}____{index}" if index is not None else base


async def stream_message_proxy_compatible(
    thread_id: str,
    *,
    content: str,
    model: str | None = None,
    memory: str | None = None,
    web_search: str | None = None,
    image_generation: str | None = None,
    image_model_provider: str | None = None,
    image_model_name: str | None = None,
    system_prompt: str | None = None,
    tools: list | None = None,
    voice: dict | None = None,
    audio_bytes: bytes | None = None,
    audio_mime: str | None = None,
    audio_filename: str | None = None,
    image_files: list[dict] | None = None,
    send_to_llm: bool = True,
    metadata: dict | None = None,
    api_key: str | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """Send a Backboard message using the same form fields as the TS proxy.

    Image generation: when *image_generation* is set (e.g. "auto"), the
    conversation model can invoke the image model named by
    *image_model_provider* / *image_model_name*. Per-turn, not sticky on the
    thread.

    Voice: when *voice* is set, the request is sent as multipart form data so
    we can attach the user's recorded ``audio_file`` alongside the ``voice``
    config (STT and/or TTS). ``send_to_llm`` is forwarded as the literal
    string "true"/"false" Backboard expects.
    """
    client = get_user_client(api_key)
    llm_provider, model_name = parse_model_spec(model)

    use_multipart = (
        voice is not None or audio_bytes is not None or bool(image_files)
    )

    if not use_multipart:
        body: dict[str, Any] = {
            "content": content,
            "stream": True,
            "thread_id": thread_id,
        }
        if llm_provider:
            body["llm_provider"] = llm_provider
        if model_name:
            body["model_name"] = model_name
        if memory:
            body["memory"] = memory
        if system_prompt:
            body["system_prompt"] = system_prompt
        if web_search:
            body["web_search"] = web_search
        if image_generation:
            body["image_generation"] = image_generation
            if image_model_provider:
                body["image_model_provider"] = image_model_provider
            if image_model_name:
                body["image_model_name"] = image_model_name
        if tools:
            body["tools"] = [client._tool_to_dict(t) for t in tools]
        if metadata:
            body["metadata"] = metadata
        return client._parse_streaming_response_iter(
            method="POST",
            endpoint="/threads/messages",
            json_data=body,
        )

    # Multipart path: voice and/or audio attached.
    form: dict[str, str] = {
        "stream": "true",
        "thread_id": thread_id,
        "send_to_llm": "true" if send_to_llm else "false",
    }
    if content:
        form["content"] = content
    if llm_provider:
        form["llm_provider"] = llm_provider
    if model_name:
        form["model_name"] = model_name
    if memory:
        form["memory"] = memory
    if system_prompt:
        form["system_prompt"] = system_prompt
    if web_search:
        form["web_search"] = web_search
    if image_generation:
        form["image_generation"] = image_generation
        if image_model_provider:
            form["image_model_provider"] = image_model_provider
        if image_model_name:
            form["image_model_name"] = image_model_name
    if voice is not None:
        form["voice"] = json.dumps(voice)
    if tools:
        form["tools"] = json.dumps([client._tool_to_dict(t) for t in tools])
    if metadata:
        form["metadata"] = json.dumps(metadata)

    # httpx multipart: a list of (field_name, file_tuple) pairs so multiple
    # attachments can share the "files" field name (Backboard's native
    # message-attachment field, the same one the SDK's add_message uses).
    files: list[tuple[str, tuple[str, bytes, str]]] = []
    if audio_bytes is not None:
        files.append((
            "audio_file",
            (audio_filename or "audio.webm", audio_bytes, audio_mime or "audio/webm"),
        ))
    for image_file in image_files or []:
        path = image_file.get("filepath") or ""
        if not path or not os.path.exists(path):
            logger.warning("[bb] image_files: skipping missing path %r", path)
            continue
        filename = image_file.get("filename") or os.path.basename(path) or "image"
        content_type = (
            image_file.get("content_type")
            or mimetypes.guess_type(filename)[0]
            or "image/png"
        )
        with open(path, "rb") as handle:
            data_bytes = handle.read()
        files.append(("files", (filename, data_bytes, content_type)))

    return client._parse_streaming_response_iter(
        method="POST",
        endpoint="/threads/messages",
        data=form,
        files=files or None,
    )


async def stream_tts_narration(
    *,
    text: str,
    voice_tts: dict,
    system_prompt: str,
    api_key: str | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """Stream TTS audio for an existing passage of text ("Read aloud").

    Backboard has no pure text->speech mode — it only synthesizes an LLM
    *reply* (``send_to_llm=false`` merely saves the message; it never voices
    it). So we run a one-off turn that instructs the model, via ``system_prompt``,
    to echo the passage back verbatim, and attach the TTS ``voice`` config so
    Backboard voices that echoed reply. ``thread_id`` is intentionally omitted
    so Backboard auto-creates a fresh default-assistant thread per call —
    nothing touches the user's real conversation, and there is no extra
    create-thread round-trip.

    Yields the raw Backboard SSE events (``content_streaming`` for the echoed
    text, then ``tts_stream_start`` / ``tts_audio_chunk`` / ``tts_stream_end``).
    """
    client = get_user_client(api_key)
    body: dict[str, Any] = {
        "content": text,
        "stream": True,
        "send_to_llm": True,
        "system_prompt": system_prompt,
        "voice": {"tts": voice_tts},
    }
    return client._parse_streaming_response_iter(
        method="POST",
        endpoint="/threads/messages",
        json_data=body,
    )


async def submit_tool_outputs_stream(
    thread_id: str,
    tool_outputs: list[dict],
    *,
    api_key: str | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """Submit tool outputs and stream the model's continuation as SSE dicts.

    Implements the second half of Backboard's streaming tool-call flow: after a
    ``tool_submit_required`` event we return the tool results on the same
    ``thread_id`` (Backboard keeps the full conversation, so no history is
    replayed) and continue streaming the reply.
    See https://docs.backboard.io/concepts/tool-calling
    """
    client = get_user_client(api_key)
    return await client.submit_tool_outputs_simple(
        thread_id=thread_id,
        tool_outputs=tool_outputs,
        stream=True,
    )


async def stream_submit_tool_outputs(
    thread_id: str,
    run_id: str,
    tool_outputs: list[dict],
    *,
    tools: list | None = None,
    api_key: str | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """Submit tool outputs and stream the run's continuation (SSE events).

    Uses the per-run endpoint because it is the only one that accepts a
    per-run ``tools`` override — per-turn tools are NOT retained by the run
    across submits, so without re-passing them chained tool calls silently
    degrade into the model narrating the call it can no longer make
    (verified against the live API 2026-07-14; see
    the Backboard chat API). The installed backboard-sdk's
    ``submit_tool_outputs`` exposes neither ``tools`` nor ``stream``, hence
    the raw request.
    """
    client = get_user_client(api_key)
    body: dict[str, Any] = {"tool_outputs": tool_outputs}
    if tools:
        body["tools"] = [client._tool_to_dict(t) for t in tools]
    return client._parse_streaming_response_iter(
        method="POST",
        endpoint=f"/threads/{thread_id}/runs/{run_id}/submit-tool-outputs",
        json_data=body,
        params={"stream": "true"},
    )
