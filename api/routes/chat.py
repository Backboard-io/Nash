"""Chat streaming via Backboard.

Implements the resumable SSE pattern the frontend expects:
  POST /api/agents/chat      -> start stream, return {streamId, conversationId}
  GET  /api/agents/chat/stream/:streamId -> SSE event stream
"""

import asyncio
import base64
from contextlib import aclosing
from decimal import Decimal
import hashlib
from io import BytesIO
import json
import logging
import mimetypes
import os
import queue
import re
import shutil
import tempfile
import threading
import time
import urllib.error
import urllib.request
import uuid

from backboard import DocumentStatus
from backboard.exceptions import BackboardAPIError, BackboardValidationError
from flask import Blueprint, Response, g, jsonify, request
from PIL import Image, ImageOps
from werkzeug.utils import secure_filename

from api.config import settings
from api.middleware.session_auth import require_auth
from api.routes.user import invalidate_balance_cache
from api.services import model_catalog_service
from api.services.model_catalog_service import (
    FREE_TIER_PROVIDERS,
    load_yaml_config as _load_endpoint_config,
)
from api.services.async_runner import iter_async, run_async, run_async_background
from api.services.backboard_service import (
    DOCUMENT_EXPORT_TOOL,
    DOCUMENT_EXPORT_TOOL_NAME,
    MAX_TOOL_ITERATIONS,
    added_model_agent_id,
    get_request_assistant_id,
    get_request_client,
    get_request_state_partition,
    get_request_user_id,
    get_thread_messages,
    get_user_client,
    is_chip_tool,
    is_user_visible_message,
    parse_model_spec,
    role_name,
    require_user_api_key,
    require_user_client,
    stream_message_proxy_compatible,
    submit_tool_outputs_stream,
    stream_submit_tool_outputs,
    truncate_tool_output,
)
from api.services.mcp_service import build_mcp_system_prompt, build_tool_payload, call_mcp_tool
from api.services import mcp_oauth_service
from api.services.conversation_service import (
    _get_conversation_meta,
    _save_conversation_meta,
    get_conversation_meta,
    get_generated_media_map,
    get_or_create_thread,
    get_regen_graph,
    save_added_response,
    save_conversation_meta,
    save_display_file_overrides,
    save_display_text_overrides,
    save_fallback_notice,
    save_generated_media,
    save_message_files,
    save_regen_graph,
)
from api.services.token_service import (
    get_token_usage,
    record_token_usage,
)
from api.services.analytics_service import record_generation_analytics
from api.services import context_service, state_service
from api.services.export_service import build_export, is_supported_export
from api.services.user_service import (
    find_user_by_id,
    get_user_assistant_id,
    memories_enabled_for_user,
)

chat_bp = Blueprint("chat", __name__)
logger = logging.getLogger(__name__)

_streams: dict[str, dict] = {}
CHAT_STREAM_TTL_SEC = 15 * 60
FILE_POLL_INTERVAL_SEC = 2
FILE_POLL_MAX_ATTEMPTS = 150  # ~5 minutes per file if no phase limit
FILE_PROCESSING_PHASE_TIMEOUT_SEC = (
    90  # stop waiting on docs after this, proceed to reply
)
# NOTE: document-export intent is no longer detected with regex. The export tool
# is offered on every non-MCP turn and the MODEL decides when to call it (verified
# to self-trigger and to coexist with image generation). See ctx["tools"] +
# CAPABILITIES_SYSTEM_PROMPT.
LEAKED_EXPORT_INSTRUCTION_RE = re.compile(
    r"\s*\[Export instruction for assistant:.*?"
    r"Do not provide browser print/save-as instructions when a downloadable file was requested\.\]\s*",
    re.IGNORECASE | re.DOTALL,
)
CODE_EXPORT_EXTENSIONS = {
    "c",
    "cc",
    "cpp",
    "cs",
    "css",
    "go",
    "h",
    "html",
    "java",
    "js",
    "json",
    "jsx",
    "kt",
    "md",
    "php",
    "py",
    "rb",
    "rs",
    "sh",
    "sql",
    "ts",
    "tsx",
    "xml",
    "yaml",
    "yml",
}
FILE_UPLOAD_TIMEOUT_SEC = 90  # max wait for Backboard upload_document_to_assistant
IMAGE_TOOL_MAX_BYTES = 5 * 1024 * 1024
IMAGE_TOOL_TARGET_BYTES = int(IMAGE_TOOL_MAX_BYTES * 0.9)
IMAGE_TOOL_MAX_DIMENSION = 2048
IMAGE_TOOL_NAME_PREFIX = "inspect_uploaded_image_"
STREAM_IDLE_TIMEOUT_SEC = 120
CHAT_SSE_TEXT_THROTTLE_MS = settings.chat_sse_text_throttle_ms
CHAT_SSE_TEXT_FLUSH_BYTES = settings.chat_sse_text_flush_bytes
STREAM_TOTAL_TIMEOUT_SEC = 180
MCP_TOOL_CALL_TIMEOUT_SEC = 90  # per MCP tools/call round-trip
LONG_MESSAGE_CHAR_THRESHOLD = settings.long_message_char_threshold

FALLBACK_MODEL = "openai/gpt-4.1"

# Backboard image-generation mode. "auto" is the ONLY enabling value the API
# accepts — it attaches Backboard's built-in generate_image tool for the turn
# and the thread LLM decides whether to call it; any other string (including
# "force") is treated as "off" by Backboard, silently disabling generation.
IMAGE_GENERATION_MODE = "auto"

# Both catalogs (LLM + image) come from the process-wide snapshot in
# model_catalog_service — the Backboard catalog is GLOBAL, so one snapshot
# serves every key. The catalogs stay advisory: every consumer treats an
# empty dict as "unknown, pass through" and has its own fallback path, so a
# send never blocks on a catalog fetch.


def _fetch_image_models(api_key: str) -> dict[str, dict]:
    """Available image models ({"provider/name": caps}) from the process-wide
    catalog snapshot.

    Never blocks: returns {} until the first snapshot exists (the touch also
    kicks the background refresh when one is due). Callers must treat an
    empty catalog as "unknown", not "no models". Runs without a Flask
    request context (called from the streaming generator).
    """
    return model_catalog_service.image_caps(api_key)


def _image_model_vision_ok(entry, needs_vision: bool) -> bool:
    """False only when we KNOW the model can't take image input but the turn
    needs it. Unknown capability is allowed — Backboard is the authority."""
    if not needs_vision:
        return True
    if isinstance(entry, dict):
        return entry.get("supports_vision") is not False
    return True


def _resolve_image_config(
    req_spec: str | None, api_key: str = "", needs_vision: bool = False
) -> tuple[str, str]:
    """Resolve the (provider, model_name) for image generation.

    Validates against the live Backboard image model catalog (fetched from
    /models/image/all with the user's key). Falls back to deploy defaults when
    the requested model is missing or not in the catalog, then to the first
    available image model from the catalog.

    ``needs_vision``: the turn attaches a reference image (image-to-image), so
    a model the catalog marks as vision-incapable would 400 with
    image_model_vision_required — skip it in favor of one that can see.
    """
    image_models = _fetch_image_models(api_key) if api_key else {}

    provider, model_name = parse_model_spec(req_spec)
    provider = (provider or "").strip().lower()
    model_name = (model_name or "").strip()

    if provider and model_name:
        spec_key = f"{provider}/{model_name}"
        if not image_models or (
            spec_key in image_models
            and _image_model_vision_ok(image_models[spec_key], needs_vision)
        ):
            return provider, model_name

    # Fall back to deploy defaults — validate against the catalog when we have one.
    default_provider = (settings.image_model_provider or "").strip().lower()
    default_name = (settings.image_model_name or "").strip()
    if default_provider and default_name:
        default_key = f"{default_provider}/{default_name}"
        if not image_models or (
            default_key in image_models
            and _image_model_vision_ok(image_models[default_key], needs_vision)
        ):
            return default_provider, default_name

    # Deploy default isn't available — use the first suitable catalog model.
    for model_id, entry in image_models.items():
        if not _image_model_vision_ok(entry, needs_vision):
            continue
        parts = model_id.split("/", 1)
        if len(parts) == 2:
            return parts[0], parts[1]

    # Last resort: return the deploy defaults even if unverified.
    return default_provider or "openrouter", default_name or "google/gemini-3.1-flash-image-preview"


def _fetch_llm_models(api_key: str) -> dict[str, dict]:
    """Backboard's live LLM catalog ({"provider/name": {"supports_tools": ...}})
    from the process-wide snapshot.

    Never blocks: returns {} until the first snapshot exists (the touch also
    kicks the background refresh when one is due). Callers must treat an
    empty catalog as "unknown", not "no models". Runs without a Flask
    request context (called from the streaming generator).
    """
    return model_catalog_service.llm_caps(api_key)


# Bedrock-style names carry the vendor as a dotted prefix and often a trailing
# version tag: "anthropic.claude-opus-4-1-20250805-v1:0". Backboard's own
# catalog names are bare ("claude-opus-4-1-20250805" under provider
# "anthropic"), so a picker id that isn't in the live catalog is re-resolved by
# stripping those wrappers and matching the base name across providers.
_MODEL_VENDOR_PREFIX_RE = re.compile(
    r"^(anthropic|amazon|meta|mistral|cohere|ai21|deepseek|google|openai|xai)\.",
    re.IGNORECASE,
)
_MODEL_VERSION_SUFFIX_RE = re.compile(r"[-:]v\d+(?::\d+)?$", re.IGNORECASE)


def _normalize_model_base(name: str) -> str:
    base = _MODEL_VERSION_SUFFIX_RE.sub("", (name or "").strip().lower())
    return base.replace(".", "-")


def _resolve_chat_model_spec(model: str | None, api_key: str) -> str | None:
    """Map a picker model id onto a model Backboard can actually run.

    A valid "provider/name" catalog id passes through untouched. Anything else
    (stale yaml ids, Bedrock-style "anthropic.claude-…-v1:0" names, ids without
    a provider) is matched against the live catalog by base name — preferring
    the vendor named in the id, then the original provider. When nothing
    matches (or the catalog is unavailable) the original id is returned and the
    existing error/fallback path handles it.
    """
    if not model:
        return model
    catalog = _fetch_llm_models(api_key) if api_key else {}
    if not catalog:
        return model

    provider, name = parse_model_spec(model)
    provider = (provider or "").strip()
    name = (name or "").strip()
    if provider and name and f"{provider}/{name}" in catalog:
        return model

    vendor_match = _MODEL_VENDOR_PREFIX_RE.match(name)
    vendor = vendor_match.group(1).lower() if vendor_match else ""
    base = _normalize_model_base(name[vendor_match.end():] if vendor_match else name)
    if not base:
        return model

    exact: list[tuple[int, str]] = []
    dated: list[tuple[int, str]] = []
    for model_id in catalog:
        cat_provider, _, cat_name = model_id.partition("/")
        # Strip the vendor prefix from catalog names too (Bedrock-style
        # "anthropic.claude-…" entries), mirroring the requested id — else a
        # catalog whose only Anthropic access is via aws-bedrock never matches.
        cat_vendor_match = _MODEL_VENDOR_PREFIX_RE.match(cat_name)
        cat_base = _normalize_model_base(
            cat_name[cat_vendor_match.end():] if cat_vendor_match else cat_name
        )
        if cat_base != base:
            # Dated-variant match only when the remainder LOOKS like a date
            # (YYYYMMDD, ISO date, or xAI-style MMDD) — a bare "-2…" prefix
            # check would confuse version numbers ("grok-4" vs "grok-4.20…").
            if not cat_base.startswith(base):
                continue
            suffix = cat_base[len(base):]
            if not re.fullmatch(r"-(?:20\d{6}|20\d{2}-\d{2}-\d{2}|[01]\d[0-3]\d)", suffix):
                continue
        # Rank: the vendor embedded in the requested id beats the requested
        # provider, which beats everything else.
        rank = (
            0 if cat_provider.lower() == vendor
            else 1 if cat_provider.lower() == provider.lower()
            else 2
        )
        (exact if cat_base == base else dated).append((rank, model_id))

    # An exact base match wins; otherwise take the newest dated variant
    # ("claude-sonnet-4-5" -> "claude-sonnet-4-5-20250929").
    if exact:
        exact.sort(key=lambda item: (item[0], item[1]))
        return exact[0][1]
    if dated:
        best_rank = min(rank for rank, _ in dated)
        return max(mid for rank, mid in dated if rank == best_rank)
    return model


def _image_turn_orchestrator(
    model: str | None, fallback_model: str | None, api_key: str
) -> str | None:
    """Model to RUN an image turn on when the selected model can't.

    Backboard's image tool is tool-calling: the thread LLM must call
    generate_image. When the live catalog says the selected model does NOT
    support tools (e.g. Bedrock-hosted Claude — the model EXISTS, it just
    can't drive tools), the image turn is doomed before it starts. Returns the
    fallback to orchestrate that single turn on (with an honest notice), or
    None to run on the selected model (unknown capability included — Backboard
    is the authority, and the error-retry path still covers surprises).
    Respects the fallback opt-out (fallback_model=None)."""
    if not model or not fallback_model or fallback_model == model:
        return None
    entry = _fetch_llm_models(api_key).get(model) if api_key else None
    if entry and entry.get("supports_tools") is False:
        return fallback_model
    return None


# ---------------------------------------------------------------------------
# Web search / image generation / document export
# ---------------------------------------------------------------------------
# There is intentionally NO prompt regex / intent heuristic anywhere in this
# module. Web search and Backboard's generate_image tool are enabled on EVERY
# turn (image_generation="auto"), the export tool is offered on every non-MCP
# turn, and the chat model decides which of them to use, guided by
# CAPABILITIES_SYSTEM_PROMPT. This scales to any phrasing or language without a
# brittle allow-list. The only image signal we compute is deterministic
# *context* (an uploaded image this turn, or a previously generated image), used
# to attach vision references and to orchestrate on a tool-capable model when
# the selected one cannot drive tools.


_MODEL_FRIENDLY_NAMES: dict[str, str] = {
    "openai/gpt-4.1": "GPT-4.1",
    "openrouter/openrouter/free": "a free model",
    "openai/gpt-4o": "GPT-4o",
    "openai/gpt-4o-mini": "GPT-4o mini",
    "openai/o1": "o1",
    "openai/o3-mini": "o3 mini",
    "anthropic/claude-opus-4-5": "Claude Opus 4.5",
    "anthropic/claude-sonnet-4-5": "Claude Sonnet 4.5",
    "anthropic/claude-haiku-3-5": "Claude Haiku 3.5",
    "cohere/command-a-reasoning-08-2025": "Cohere Command A",
    "cohere/command-r-plus": "Cohere Command R+",
    "cohere/command-r": "Cohere Command R",
    "meta/llama-3.3-70b-instruct": "Llama 3.3 70B",
    "google/gemini-2.0-flash": "Gemini 2.0 Flash",
    "google/gemini-1.5-pro": "Gemini 1.5 Pro",
}


def _friendly_model_name(model: str) -> str:
    """Return a short human-readable label for a model spec string."""
    if not model:
        return "The selected model"
    known = _MODEL_FRIENDLY_NAMES.get(model)
    if known:
        return known
    basename = model.split("/")[-1]
    # Bedrock-style names: drop the vendor prefix and version tag so the
    # notice reads "Claude Opus 4 7", not "Anthropic.Claude Opus 4 7 V1:0".
    basename = _MODEL_VERSION_SUFFIX_RE.sub("", _MODEL_VENDOR_PREFIX_RE.sub("", basename))
    return basename.replace("-", " ").title()


LONG_MESSAGE_STATUS_START = (
    "Big message detected. Indexing it in Backboard so I can read it cleanly."
)
LONG_MESSAGE_STATUS_INDEXING = "Indexing your message..."
LONG_MESSAGE_STATUS_DONE = "All set. Answering now."
LONG_MESSAGE_DISPLAY_FALLBACK = "Large message uploaded for processing."


def _log_stream_event(stream_id: str, stage: str, **extra):
    logger.warning(
        "[chat][stream:%s] %s %s", stream_id, stage, json.dumps(extra, default=str)
    )


def _eager_conversation_title(user_text: str) -> str:
    """Prompt-derived name for a brand-new chat, shown in the sidebar the moment
    the chat starts — before any response exists. Mirrors the 60-char truncation
    used for the response-based title at stream completion, so early and final
    names stay visually consistent. Falls back to "New Chat" when the turn has no
    text (e.g. a bare image upload), which the completion step then replaces with
    a response-derived title (that fallback is a PLACEHOLDER_TITLES value)."""
    snippet = (user_text or "").replace("\n", " ").strip()
    if not snippet:
        return "New Chat"
    return snippet[:60] + ("..." if len(snippet) > 60 else "")


def _message_content_from_text(text: str) -> list[dict]:
    return [{"type": "text", "text": {"value": text or ""}}]


def _live_message_ids(payload: dict) -> tuple[str, str]:
    """Keep the optimistic frontend message identities stable across SSE setup.

    The frontend renders the user message (including uploaded-image components)
    before the stream starts. Replacing that message with fresh server UUIDs in
    the ``created`` event makes React unmount and remount the same image, causing
    a visible flash and a duplicate authenticated image fetch. Prefer the IDs
    already carried by the submission; retain UUID fallbacks for older clients.
    """
    requested_user_id = payload.get("messageId")
    user_message_id = (
        requested_user_id.strip()
        if isinstance(requested_user_id, str) and requested_user_id.strip()
        else str(uuid.uuid4())
    )

    requested_response_id = payload.get("responseMessageId")
    response_message_id = (
        requested_response_id.strip()
        if isinstance(requested_response_id, str) and requested_response_id.strip()
        else f"{user_message_id}_"
    )
    return user_message_id, response_message_id


def _stream_resume_state(stream_state: dict) -> dict:
    return {
        "runSteps": stream_state.get("runSteps", []),
        "aggregatedContent": stream_state.get("aggregatedContent", _message_content_from_text("")),
        "userMessage": stream_state.get("userMessage"),
        "responseMessageId": stream_state.get("responseMessageId"),
        "conversationId": stream_state.get("conversationId"),
        # Images already produced this turn. A ?resume=true reconnect only tails
        # NEW events, so without this snapshot any image emitted before the
        # refresh is lost. Mirrors how aggregatedContent snapshots the text.
        "generatedMedia": stream_state.get("generatedMedia", []),
        # Whether THIS turn is an image generation — set at request start, so a
        # refresh BEFORE the first image lands still knows to show the
        # "Generating image…" placeholder (the input toggle isn't a reliable
        # signal after a reload, especially once /c/new became a real id).
        "imageGeneration": bool(stream_state.get("imageGeneration")),
        "sender": "Nash",
    }


def _record_stream_event(stream_state: dict, event: dict) -> dict:
    stream_state.setdefault("events", []).append(event)
    if event.get("created"):
        stream_state["userMessage"] = event.get("message")
        stream_state["responseMessageId"] = event.get("responseMessageId")
    elif event.get("type") in {"text", "tool_call"}:
        event_type = event["type"]
        if event_type == "text":
            part = {
                "type": "text",
                "text": {"value": ((event.get("text") or {}).get("value") or "")},
            }
            for key in ("agentId", "groupId"):
                if event.get(key) is not None:
                    part[key] = event[key]
            if (
                event.get("index") == 0
                and "agentId" not in part
                and stream_state.get("primaryAgentId")
            ):
                part["agentId"] = stream_state["primaryAgentId"]
                part["groupId"] = 1
        else:
            part = {
                "type": "tool_call",
                "tool_call": dict(event.get("tool_call") or {}),
            }

        index = event.get("index")
        if not isinstance(index, int):
            index = 0
        content_parts = stream_state.setdefault("_contentParts", {})
        content_parts[index] = part
        stream_state["aggregatedContent"] = [
            content_parts[i] for i in sorted(content_parts)
        ]
    elif event.get("type") == "image":
        # Accumulate generated images so a resume snapshot can carry every image
        # produced so far — a reconnect tails only new events and would otherwise
        # drop images emitted before the refresh.
        image = event.get("image")
        if image:
            stream_state.setdefault("generatedMedia", []).append(image)
    elif event.get("final"):
        stream_state["finalEvent"] = event
        response_message = event.get("responseMessage") or {}
        response_content = response_message.get("content")
        if isinstance(response_content, list) and response_content:
            stream_state["aggregatedContent"] = response_content
        else:
            response_text = response_message.get("text") or ""
            stream_state["aggregatedContent"] = _message_content_from_text(response_text)
        stream_state["done"] = True
    stream_state["updatedAtMono"] = time.monotonic()
    return event


def _sse_payload(event: dict) -> str:
    return f"data: {json.dumps(event)}\n\n"


class _TextEventThrottle:
    """Coalesce cumulative text-snapshot SSE events.

    Contract: every emitted event still carries the FULL accumulated text —
    throttling drops intermediate snapshots, never content. Because each
    snapshot re-renders (sanitizes) the whole answer and each event is stored
    in stream_state["events"] AND retransmitted, per-chunk emission is O(n^2)
    in CPU, memory, and wire bytes (measured: 271 events / 258KiB SSE for a
    1.3KiB answer). Callers MUST ``yield from flush()`` before any non-text
    event and at every loop exit so ordering and completeness are preserved.
    """

    def __init__(self, render):
        # render: () -> dict — builds the sanitized cumulative snapshot at
        # emission time (reads its closure's CURRENT accumulated text).
        self._render = render
        self._interval = max(0, CHAT_SSE_TEXT_THROTTLE_MS) / 1000.0
        self._flush_bytes = CHAT_SSE_TEXT_FLUSH_BYTES
        self._last_emit = float("-inf")  # first snapshot emits immediately
        self._pending = 0
        self._dirty = False

    def note(self, nbytes: int) -> tuple:
        """Record newly accumulated text; emit a snapshot if it's due."""
        self._dirty = True
        self._pending += nbytes
        if (
            self._interval == 0
            or (time.monotonic() - self._last_emit) >= self._interval
            or self._pending >= self._flush_bytes
        ):
            return self.flush()
        return ()

    def flush(self) -> tuple:
        """Emit the pending snapshot, if any. Idempotent."""
        if not self._dirty:
            return ()
        self._dirty = False
        self._pending = 0
        self._last_emit = time.monotonic()
        return (self._render(),)


def _stream_owned_by_caller(stream_state: dict | None) -> bool:
    """Whether the CURRENT request's identity owns this stream.

    Streams carry the raw identity captured at start_chat ("userId"); every
    stream read/status/abort must compare it against the caller — otherwise
    any logged-in user could read or kill someone else's live reply.
    """
    if not stream_state:
        return False
    try:
        caller = get_request_user_id()
    except Exception:
        return False
    return bool(caller) and stream_state.get("userId") == caller


def _evict_stale_chat_streams() -> None:
    # TTL-only: done streams are NOT reaped early. A normally completed stream
    # is popped by the generator's own teardown; an ABORTED stream must linger
    # so a reconnecting client can replay its final event.
    now = time.monotonic()
    stale = [
        sid
        for sid, state in _streams.items()
        if now - state.get("updatedAtMono", state.get("createdAtMono", now)) > CHAT_STREAM_TTL_SEC
    ]
    for sid in stale:
        _streams.pop(sid, None)


def _cleanup_stream_if_unfinished(stream_id: str, stream_state: dict) -> None:
    if stream_state is not _streams.get(stream_id):
        return
    if stream_state.get("done"):
        _streams.pop(stream_id, None)
        return
    stream_state["done"] = True
    stream_state["generating"] = False
    _streams.pop(stream_id, None)
    _log_stream_event(stream_id, "stream_cleaned_unfinished")


def _with_stream_cleanup(stream_id: str, stream_state: dict, iterable):
    try:
        for item in iterable:
            yield item
    finally:
        _cleanup_stream_if_unfinished(stream_id, stream_state)


def _replay_running_stream(
    stream_id: str, stream_state: dict, is_resume: bool, start_index: int | None = None
):
    if is_resume:
        yield _sse_payload({"sync": True, "resumeState": _stream_resume_state(stream_state)})
    # The initial client connection replays the whole buffer from the start
    # (start_index=0) since generation now runs on a separate producer thread; a
    # reconnect resumes from wherever the buffer currently is.
    next_index = start_index if start_index is not None else len(stream_state.get("events", []))
    while True:
        events = stream_state.get("events", [])
        while next_index < len(events):
            event = events[next_index]
            next_index += 1
            yield _sse_payload(event)
            if event.get("final"):
                return
        if stream_state.get("done"):
            final_event = stream_state.get("finalEvent")
            if final_event:
                yield _sse_payload(final_event)
            else:
                yield _sse_payload({"final": True, "completed": True})
            return
        time.sleep(0.05)


def _extract_user_text(payload: dict) -> str:
    text = payload.get("text", "")
    if not text:
        messages = payload.get("messages", [])
        if messages:
            last = messages[-1] if isinstance(messages, list) else {}
            text = last.get("text", "") or last.get("content", "")
    return text


def _count_lines(text: str) -> int:
    normalized = text[:-1] if text.endswith("\n") else text
    return 0 if not normalized else len(normalized.split("\n"))


def _read_pasted_file_content(file_info: dict) -> str:
    metadata = file_info.get("metadata") if isinstance(file_info.get("metadata"), dict) else {}
    display_text = metadata.get("displayText")
    if isinstance(display_text, str):
        return display_text

    filepath = str(file_info.get("filepath") or "")
    if not filepath.startswith("/api/files/download/"):
        return ""

    parts = filepath.split("/")
    if len(parts) < 6:
        return ""
    dir_key = parts[-2]
    file_id = parts[-1]
    from api.routes.files import UPLOAD_DIR

    user_dir = os.path.join(UPLOAD_DIR, dir_key)
    if not os.path.isdir(user_dir):
        return ""
    for fname in os.listdir(user_dir):
        if fname.startswith(file_id) and not fname.endswith(".partial"):
            path = os.path.join(user_dir, fname)
            try:
                with open(path, "r", encoding="utf-8", errors="replace") as handle:
                    return handle.read()
            except Exception:
                logger.warning("[chat] failed to read pasted text file %s", path, exc_info=True)
                return ""
    return ""


def _persist_pasted_text_file(
    *,
    partition_id: str,
    conversation_id: str,
    dir_key: str,
    filename: str,
    content: str,
    content_type: str,
    language: str,
    source_file_id: str = "",
) -> dict:
    from api.routes.files import UPLOAD_DIR

    safe_filename = secure_filename(filename or "Pasted text.txt") or "Pasted_text.txt"
    file_id = source_file_id if source_file_id.startswith("pasted-") else f"pasted-{uuid.uuid4().hex}"
    dir_key = dir_key or context_service.fs_safe_partition(partition_id)
    user_dir = os.path.join(UPLOAD_DIR, dir_key)
    os.makedirs(user_dir, exist_ok=True)
    path = os.path.join(user_dir, f"{file_id}_{safe_filename}")
    real_dir = os.path.realpath(user_dir)
    if os.path.commonpath([real_dir, os.path.realpath(path)]) != real_dir:
        raise ValueError("pasted text path escapes upload directory")

    payload = content.encode("utf-8")
    with open(path, "wb") as handle:
        handle.write(payload)

    metadata = {
        "isPastedBlock": True,
        "displayLanguage": language or "Text",
        "lineCount": _count_lines(content),
    }
    file_row = {
        "file_id": file_id,
        "filename": safe_filename,
        "filepath": f"/api/files/download/{dir_key}/{file_id}",
        "type": content_type or "text/plain",
        "bytes": len(payload),
        "embedded": True,
        "object": "file",
        "usage": 0,
        "source": "text",
        "conversationId": conversation_id,
        "metadata": metadata,
    }
    state_service.file_meta.put(
        partition_id,
        file_id,
        {
            "file_id": file_id,
            "filename": safe_filename,
            "bytes": len(payload),
            "type": content_type or "text/plain",
            "source": "text",
            "filepath": path,
            "status": "ready",
            "conversationId": conversation_id,
            "metadata": metadata,
        },
    )
    return file_row


def _display_files_from_pasted_payload(
    *,
    payload: dict,
    partition_id: str,
    conversation_id: str,
    dir_key: str,
) -> list[dict]:
    display_files: list[dict] = []
    for file_info in payload.get("files", []) or []:
        if not isinstance(file_info, dict):
            continue
        metadata = file_info.get("metadata") if isinstance(file_info.get("metadata"), dict) else {}
        if metadata.get("isPastedBlock") is not True:
            continue
        content = _read_pasted_file_content(file_info)
        if not content:
            continue
        filename = str(file_info.get("filename") or "Pasted text.txt")
        content_type = str(file_info.get("type") or "text/plain")
        language = str(metadata.get("displayLanguage") or "Text")
        persisted = _persist_pasted_text_file(
            partition_id=partition_id,
            conversation_id=conversation_id,
            dir_key=dir_key,
            filename=filename,
            content=content,
            content_type=content_type,
            language=language,
            source_file_id=str(file_info.get("file_id") or ""),
        )
        persisted["_content"] = content
        display_files.append(persisted)
    return display_files


# NOTE: web-search AND document-export intent are no longer detected with regex —
# both capabilities are always available and the MODEL decides when to use them
# (see _prepare_stream + CAPABILITIES_SYSTEM_PROMPT).


def sanitize_leaked_export_instructions(text: str) -> str:
    if not text or "Export instruction for assistant:" not in text:
        return text
    cleaned = LEAKED_EXPORT_INSTRUCTION_RE.sub("\n\n", text)
    marker = cleaned.find("[Export instruction for assistant:")
    if marker >= 0:
        cleaned = cleaned[:marker]
    return cleaned.strip()


def _export_ext(filename: str) -> str:
    return filename.rsplit(".", 1)[-1].lower() if "." in filename else ""


def _is_supported_document_export(filename: str) -> bool:
    return is_supported_export(filename) or _export_ext(filename) in CODE_EXPORT_EXTENSIONS


def _build_document_export_payload(filename: str, content: str) -> bytes:
    if is_supported_export(filename):
        return build_export(filename, content)
    return content.encode("utf-8")


def _create_document_export_file(
    *,
    partition_id: str,
    dir_key: str,
    filename: str,
    content: str,
) -> dict:
    from api.routes.files import UPLOAD_DIR

    safe_filename = secure_filename(filename or "").strip()
    if not safe_filename:
        raise ValueError("filename required")
    if not _is_supported_document_export(safe_filename):
        raise ValueError("unsupported export file type")
    if not content.strip():
        raise ValueError("content required")
    if len(content.encode("utf-8")) > 2 * 1024 * 1024:
        raise ValueError("content exceeds 2 MB")

    payload = _build_document_export_payload(safe_filename, content)
    file_id = f"export_{uuid.uuid4().hex}"
    user_dir = os.path.join(UPLOAD_DIR, dir_key)
    os.makedirs(user_dir, exist_ok=True)
    path = os.path.join(user_dir, f"{file_id}_{safe_filename}")
    real_dir = os.path.realpath(user_dir)
    if os.path.commonpath([real_dir, os.path.realpath(path)]) != real_dir:
        raise ValueError("invalid filename")
    with open(path, "wb") as f:
        f.write(payload)

    content_type = "text/plain; charset=utf-8"
    if is_supported_export(safe_filename):
        from api.services.export_service import export_content_type

        content_type = export_content_type(safe_filename)

    state_service.file_meta.put(
        partition_id,
        file_id,
        {
            "file_id": file_id,
            "filename": safe_filename,
            "bytes": len(payload),
            "type": content_type,
            "source": "local",
            "filepath": path,
            "status": "ready",
        },
    )
    return {
        "filename": safe_filename,
        "url": f"/api/files/download/{dir_key}/{file_id}",
        "bytes": len(payload),
    }


def _response_text(response) -> str:
    text = getattr(response, "content", "") or ""
    if text or not hasattr(response, "messages"):
        return text
    messages = response.messages or []
    if not messages:
        return ""
    # SDK's ChatMessagesResponse.messages is List[Dict[str, Any]] (raw JSON
    # dicts, not Message objects) — .content would be an AttributeError.
    # response.content (above) already proxies to messages[-1].get("content")
    # for the same reason; this fallback only exists for response objects
    # that expose .messages without that convenience property.
    last = messages[-1]
    if isinstance(last, dict):
        return last.get("content") or ""
    return getattr(last, "content", "") or ""


def _merge_export_links(text: str, created_exports: list[dict]) -> str:
    """Return the model's summary with exactly one download link per export.

    The model often echoes its own "[Download file.pdf](file.pdf)" link, which
    points at a bare filename rather than the real download URL and can appear
    more than once. Strip every markdown link that targets an exported file
    (by filename), then append one authoritative link per created export.
    """
    if not created_exports:
        return text or ""

    cleaned = text or ""
    filenames = {export["filename"] for export in created_exports}
    for filename in filenames:
        # Remove any markdown link whose label or href references this filename.
        pattern = re.compile(
            r"\[[^\]]*" + re.escape(filename) + r"[^\]]*\]\([^)]*\)"
            r"|\[[^\]]*\]\([^)]*" + re.escape(filename) + r"[^)]*\)",
            re.IGNORECASE,
        )
        cleaned = pattern.sub("", cleaned)

    # Collapse blank lines left behind by the removals.
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()

    links = "\n".join(export["markdown_link"] for export in created_exports)
    return f"{cleaned}\n\n{links}".strip() if cleaned else links


def _tool_call_function(tool_call) -> tuple[str, dict]:
    """Extract (name, args) from a tool call — works for SDK objects (non-stream
    REQUIRES_ACTION) and raw dicts (streaming ``tool_submit_required`` event)."""
    if isinstance(tool_call, dict):
        fn = tool_call.get("function", {}) or {}
    else:
        fn = getattr(tool_call, "function", {}) or {}

    if isinstance(fn, dict):
        name = fn.get("name", "") or ""
        args_raw = fn.get("arguments", "{}")
    else:
        name = getattr(fn, "name", "") or ""
        args_raw = getattr(fn, "arguments", "{}")

    try:
        args = json.loads(args_raw) if isinstance(args_raw, str) else (args_raw or {})
    except Exception:
        args = {}
    return name, args


def _execute_export_tool_calls(
    tool_calls: list,
    created_exports: list[dict],
    *,
    partition_id: str,
    dir_key: str,
) -> list[dict]:
    """Run each create_document_export call and return Backboard tool_outputs.

    Appends successful exports to *created_exports* so the caller can merge one
    authoritative download link per file into the final reply.
    """
    tool_outputs = []
    for tool_call in tool_calls:
        name, args = _tool_call_function(tool_call)
        if name != DOCUMENT_EXPORT_TOOL_NAME:
            output = json.dumps({"error": f"Unsupported tool {name}"})
        else:
            try:
                result = _create_document_export_file(
                    partition_id=partition_id,
                    dir_key=dir_key,
                    filename=str(args.get("filename") or ""),
                    content=str(args.get("content") or ""),
                )
                result["markdown_link"] = f"[Download {result['filename']}]({result['url']})"
                created_exports.append(result)
                output = json.dumps(result)
            except Exception as exc:
                output = json.dumps({"error": str(exc)})
        tool_outputs.append({"tool_call_id": _tool_call_id(tool_call), "output": output})
    return tool_outputs


# Applied on every normal turn now that web search + image generation are always
# available and the MODEL decides when to use them (like ChatGPT). It is permissive
# — it tells the model the tools exist and to use them WHEN APPROPRIATE, never
# forcing a tool on an ordinary question. This is what neutralizes a restrictive
# persona ("I can't search / generate images") that otherwise makes the model
# refuse even though the capability is present.
CAPABILITIES_SYSTEM_PROMPT = (
    "You have two built-in capabilities available on every turn: live web search "
    "and image generation/editing. Decide for yourself when each is useful.\n"
    "- Web search: when the user needs current, recent, real-time, or factual "
    "information you may not have, search the web and answer from what you find. "
    "Never claim you lack internet access.\n"
    "- Image generation: when the user asks you to create or edit an image "
    "(\"make an image of…\", \"change the background\", \"another one\"), generate "
    "or edit it now — for an edit, change the MOST RECENT image and keep everything "
    "else the same — then add a brief caption. An image the user attached this turn "
    "also rides along to the image tool as a visual reference where the image model "
    "supports it, but do not rely on that alone: when the user references an "
    "attached/uploaded image, also describe its key visual details into your "
    "request. Never claim you cannot generate or edit images.\n"
    "- Document export: when the user asks to make, save, export, or download a PDF, "
    "Word doc, spreadsheet, CSV, text file, or code file, call the "
    "create_document_export tool with the filename and full content.\n"
    "For ordinary questions that need none of these, just answer normally — do NOT "
    "search, generate an image, or create a file when it wouldn't help."
)


# Backboard's generate_image accepts input_image_document_id for TRUE
# image-to-image editing of a previously generated image (see
# docs: concepts/image-tool, "Option B"). The model can only pass that id if we
# tell it the id — appended to the system prompt on conversations that already
# generated images.
IMAGE_EDIT_DOC_IDS_PROMPT = (
    "\n\nPreviously generated image document ids in this conversation, oldest "
    "to newest: {doc_ids}. When the user asks to MODIFY/EDIT one of these "
    "images (\"change the eyes\", \"add a hat\", \"same but darker\"), call "
    "generate_image with input_image_document_id set to the id of the image "
    "being edited — the newest id unless the user points at an earlier one — "
    "so the edit is applied to the actual image rather than regenerating from "
    "scratch."
)


def _image_edit_prompt_suffix(user_id: str, conversation_id: str) -> str:
    """System-prompt suffix carrying prior generated-image document ids.

    Empty when the conversation has none (new conversations, plain chat)."""
    try:
        media_map = get_generated_media_map(user_id, conversation_id)
    except Exception:
        return ""
    doc_ids: list[str] = []
    for ids in (media_map or {}).values():
        if isinstance(ids, list):
            doc_ids.extend(str(i) for i in ids if i)
    if not doc_ids:
        return ""
    # Cap so a long image conversation doesn't bloat the prompt.
    doc_ids = doc_ids[-5:]
    return IMAGE_EDIT_DOC_IDS_PROMPT.format(doc_ids=", ".join(doc_ids))


def _should_index_long_message(text: str) -> bool:
    return bool(text) and len(text) >= LONG_MESSAGE_CHAR_THRESHOLD


def _build_long_message_prompt(document_id: str) -> str:
    return (
        "The user's message was too long to send inline, so its full text has "
        f"been attached to this thread as indexed document {document_id}. "
        "Read and use that attached document as the user's message, then "
        "respond to the user's request. Do not ask the user to re-upload it "
        "or say you cannot access it."
    )


def _build_pasted_files_prompt(user_text: str, doc_refs: list[dict]) -> str:
    lines = [
        "The user attached pasted text as document file cards. The full text has "
        "been indexed into this thread as the following document(s):"
    ]
    for ref in doc_refs:
        lines.append(f"- {ref['filename']}: indexed document {ref['document_id']}")
    if user_text.strip():
        lines.extend(["", "User request:", user_text.strip()])
    else:
        lines.extend(["", "Use the attached pasted text as the user's message."])
    lines.append(
        "Read and use the indexed document content directly. Do not ask the user "
        "to re-upload it or say you cannot access it."
    )
    return "\n".join(lines)


def sanitize_long_message_display_text(text: str) -> str:
    """Hide internal long-message routing prompts in legacy conversations."""
    if not text:
        return text
    if (
        text.startswith("The user's message was too long to send directly. ")
        and "uploaded to Backboard as document" in text
        and "Read the document content" in text
    ):
        return LONG_MESSAGE_DISPLAY_FALLBACK
    if (
        text.startswith("The user's message was too long to send inline, ")
        and "indexed document" in text
        and "Do not ask the user to re-upload it" in text
    ):
        return LONG_MESSAGE_DISPLAY_FALLBACK
    return text


def _save_long_message_display_text(
    *,
    partition_id: str,
    conversation_id: str,
    thread_id: str,
    ctx: dict,
) -> None:
    """Persist the original visible text for long-message document rewrites.

    Backboard must receive the short "read document X" prompt so the model uses
    the uploaded document. Nash must show the user's original message on reload,
    not that internal routing prompt.
    """
    original_text = ctx.get("display_text_override")
    if original_text is None:
        original_text = ctx.get("user_text") or ""
    model_text = ctx.get("model_text") or ""
    display_files = [
        {k: v for k, v in file_info.items() if k != "_content"}
        for file_info in (ctx.get("display_files") or [])
        if isinstance(file_info, dict)
    ]
    if (
        not (ctx.get("should_index_long_message") or display_files)
        or not model_text
        or original_text == model_text
    ):
        return

    try:
        bb_msgs = run_async(get_thread_messages(thread_id, ctx.get("bb_client")), timeout=15)
        overrides: dict[str, str] = {}
        for msg in bb_msgs:
            if not is_user_visible_message(msg) or role_name(msg) != "user":
                continue
            if (msg.content or "") == model_text:
                overrides[str(msg.message_id)] = original_text

        if not overrides:
            logger.warning(
                "[chat] long message: no Backboard user message matched display override for convo %s",
                conversation_id,
            )
            return

        save_display_text_overrides(partition_id, conversation_id, overrides)
        if display_files:
            save_display_file_overrides(
                partition_id,
                conversation_id,
                {message_id: display_files for message_id in overrides},
            )
        logger.info(
            "[chat] long message: saved %d display override(s) for convo %s",
            len(overrides),
            conversation_id,
        )
    except Exception:
        logger.exception(
            "[chat] long message: failed to save display override for convo %s",
            conversation_id,
        )


def _extract_requested_model(payload: dict) -> str:
    model = payload.get("model") or ""
    endpoint_option = payload.get("endpointOption", {})
    if not model and endpoint_option:
        model = endpoint_option.get("model", "") or endpoint_option.get(
            "modelLabel", ""
        )
    return model


def _is_free_tier_model(model_name: str) -> bool:
    if not model_name:
        return False

    normalized_model = model_name.lower().strip()

    cfg = _load_endpoint_config()
    model_pricing = cfg.get("modelPricing", {}) or {}
    pricing = model_pricing.get(model_name) or model_pricing.get(normalized_model) or {}
    if isinstance(pricing, dict):
        input_cost = float(pricing.get("inputCostPer1mTokens", 0) or 0)
        output_cost = float(pricing.get("outputCostPer1mTokens", 0) or 0)
        if input_cost <= 0 and output_cost <= 0:
            return True

    custom_endpoints = cfg.get("endpoints", {}).get("custom", [])
    for endpoint in custom_endpoints:
        selector_tiers = endpoint.get("selectorTiers", {}) or {}
        free_models = selector_tiers.get("free", []) or []
        for free_model in free_models:
            if (
                isinstance(free_model, str)
                and free_model.lower().strip() == normalized_model
            ):
                return True

    providers = {p.lower() for p in FREE_TIER_PROVIDERS}
    segments = normalized_model.split("/")
    return any(
        seg == provider or seg.startswith(f"{provider}-") or seg.startswith(provider)
        for provider in providers
        for seg in segments
    )


def _resolve_endpoint_for_model(model_name: str, fallback_endpoint: str) -> str:
    if not model_name:
        return fallback_endpoint

    normalized_model = model_name.lower().strip()
    cfg = _load_endpoint_config()
    custom_endpoints = cfg.get("endpoints", {}).get("custom", [])
    for endpoint_cfg in custom_endpoints:
        endpoint_name = endpoint_cfg.get("name", "") or fallback_endpoint
        raw_models = endpoint_cfg.get("models", {}).get("default", [])
        for raw_model in raw_models:
            candidate = (
                raw_model.get("name", "") if isinstance(raw_model, dict) else raw_model
            )
            if (
                isinstance(candidate, str)
                and candidate.lower().strip() == normalized_model
            ):
                return endpoint_name

    return fallback_endpoint


def _is_tool_use_error(message: str) -> bool:
    lowered = message.lower()
    return (
        "tool use" in lowered
        or "does not support tools" in lowered
        or "no endpoints found" in lowered
    )


# Nash toggle value -> Backboard Memory Lite mode. Backboard accepts ONLY
# Auto/Readonly/off and silently treats anything else as OFF — the legacy "On"
# toggle value therefore disabled memory while the UI said otherwise; it maps
# to Auto (the strongest read+write mode).
_BB_MEMORY_MODES = {"Auto": "Auto", "Readonly": "Readonly", "On": "Auto", "Off": "off"}


def _is_credit_block_error(message: str) -> bool:
    """Backboard's billing gate ends the run with user-appropriate copy
    (Backboard's credit-block copy): it always points at the Billing
    page / credits. Detect it so we surface that text VERBATIM instead of a
    generic "error generating a response" — and never burn retries on a
    fallback model that hits the same wallet."""
    lowered = message.lower()
    return (
        "billing page" in lowered
        # Nash-pool block copy: "Your Nash credit is used
        # up …". A nash_ key spends the isolated Nash pool, so this is the
        # no-credits signal from the Backboard wallet.
        or "nash credit" in lowered
        or (
            "credit" in lowered
            and ("add credits" in lowered or "out of credits" in lowered
                 or "used up" in lowered)
        )
    )


def _get_agent_bb_assistant_id(user_id: str, agent_id: str) -> str:
    """Look up the Backboard assistant ID for a user-created agent."""
    row = state_service.agents.get(user_id, agent_id)
    return str((row or {}).get("bb_assistant_id", ""))


def _get_folder_bb_assistant_id(user_id: str, folder_id: str) -> str:
    """Look up the Backboard assistant ID for a folder."""
    row = state_service.folders.get(user_id, folder_id)
    return str((row or {}).get("bb_assistant_id", ""))


# ---------------------------------------------------------------------------
# Generated image persistence
# ---------------------------------------------------------------------------

_MIME_TO_EXT = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
}

# Registry of in-flight generated-image downloads, keyed by file_id (which is
# always ``generated_{document_id}``). Used by the files.py download route to
# block briefly when the browser fetches the predictable Nash URL before the
# background download has finished.
_pending_image_downloads: dict[str, threading.Event] = {}
_pending_image_lock = threading.Lock()


def generated_image_file_id(document_id: str) -> str:
    """Stable file_id for a Backboard-generated image."""
    return f"generated_{document_id}"


def predictable_generated_image_url(dir_key: str, document_id: str) -> str:
    """Nash URL the frontend uses for a generated image. Resolves to the same
    /api/files/download endpoint used for uploads. The S3 URL is never exposed
    to the client — the backend handles the fetch and persistence."""
    return f"/api/files/download/{dir_key}/{generated_image_file_id(document_id)}"


# Matches the presigned Backboard S3 URL we get back in media_generated events
# AND the same URL when the LLM inlines it in its markdown response. Capture
# group 1 is the document_id (a UUID). We rewrite to the Nash-local URL so the
# bucket origin never reaches the browser.
_BACKBOARD_S3_IMAGE_RE = re.compile(
    r"https?://[\w.-]*\bamazonaws\.com/[^\s)\]\"'>]*?/"
    r"(?P<doc>[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})"
    r"\.(?:jpe?g|png|webp|gif)(?:\?[^\s)\]\"'>]*)?",
    re.IGNORECASE,
)

_IMAGE_TOOL_TEXT_KEY = '"text"'
_IMAGE_TOOL_TEXT_PREFIX = "Uploaded image:"
IMAGE_TOOL_MAX_ROUNDS = 3


def _skip_json_whitespace(text: str, position: int) -> int:
    while position < len(text) and text[position] in " \t\r\n":
        position += 1
    return position


def _uploaded_image_payload_start(text: str, marker_position: int) -> int | None:
    """Return the opening brace when *marker_position* starts our text value."""
    text_key_position = text.rfind(_IMAGE_TOOL_TEXT_KEY, 0, marker_position)
    if text_key_position < 0:
        return None
    object_start = text.rfind("{", 0, text_key_position)
    if object_start < 0:
        return None

    position = _skip_json_whitespace(text, object_start + 1)
    if position != text_key_position:
        return None
    position = _skip_json_whitespace(text, position + len(_IMAGE_TOOL_TEXT_KEY))
    if position >= len(text) or text[position] != ":":
        return None
    position = _skip_json_whitespace(text, position + 1)
    if position >= len(text) or text[position] != '"':
        return None
    return object_start if position + 1 == marker_position else None


def _json_object_end(text: str, object_start: int) -> int | None:
    """Return the matching closing brace without treating braces in strings as JSON."""
    depth = 0
    in_string = False
    escaped = False
    for position in range(object_start, len(text)):
        char = text[position]
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return position
    return None


def _is_uploaded_image_payload(payload_text: str) -> bool:
    try:
        payload = json.loads(payload_text)
    except (json.JSONDecodeError, TypeError):
        return False
    return (
        isinstance(payload, dict)
        and str(payload.get("text") or "").startswith(_IMAGE_TOOL_TEXT_PREFIX)
        and "__image_media_type" in payload
        and "__image_base64" in payload
    )


def scrub_uploaded_image_tool_payloads(text: str, *, complete_text: bool = False) -> str:
    """Remove hidden uploaded-image tool payloads from user-visible text.

    Backboard can occasionally echo a tool output into assistant-visible text.
    Those outputs contain base64 image bytes used only for model inspection and
    must never be streamed or persisted as chat copy. During streaming an
    unfinished matching object is held back. For complete persisted text it is
    preserved because truncating the rest of a saved message is worse than
    displaying malformed or quoted JSON.
    """
    if not text or _IMAGE_TOOL_TEXT_PREFIX not in text:
        return text

    kept: list[str] = []
    cursor = 0
    search_from = 0
    changed = False
    while True:
        marker_position = text.find(_IMAGE_TOOL_TEXT_PREFIX, search_from)
        if marker_position < 0:
            kept.append(text[cursor:])
            break

        object_start = _uploaded_image_payload_start(text, marker_position)
        if object_start is None:
            search_from = marker_position + len(_IMAGE_TOOL_TEXT_PREFIX)
            continue

        object_end = _json_object_end(text, object_start)
        if object_end is None:
            # Streaming can split anywhere inside the JSON/base64 value. Hold
            # the unfinished object back until a later chunk completes it.
            if not complete_text:
                kept.append(text[cursor:object_start])
                cursor = len(text)
                changed = True
                break
            search_from = marker_position + len(_IMAGE_TOOL_TEXT_PREFIX)
            continue

        if not _is_uploaded_image_payload(text[object_start:object_end + 1]):
            # This may be user-authored JSON or a malformed historical object.
            # Keep it and continue after its own boundary so keys in a later
            # payload can never be mistaken for part of this one.
            search_from = object_end + 1
            continue

        kept.append(text[cursor:object_start])
        cursor = object_end + 1
        search_from = cursor
        changed = True

    if not changed:
        return text
    scrubbed = "".join(kept)
    return re.sub(r"\n{3,}", "\n\n", scrubbed).strip()


def sanitize_s3_image_urls(text: str, dir_key: str) -> str:
    """Replace any Backboard-presigned S3 image URL inside *text* with the
    Nash-local /api/files/download URL keyed on the document_id, AND ensure
    standalone occurrences render as inline images (markdown ``![](url)``).

    The model sometimes inlines a presigned URL inside markdown image syntax
    (``![](https://…s3…/uuid.png?…)``) and sometimes just prints the URL on
    its own line. We want both forms to:
      1. never leak the S3 hostname, and
      2. actually render the image in the chat rather than appear as text.
    """
    if not text or not dir_key or "amazonaws.com" not in text:
        return text

    src_holder = {"s": text}

    def _swap(match: re.Match) -> str:
        local_url = predictable_generated_image_url(dir_key, match.group("doc").lower())
        # If the URL is already wrapped in markdown image/link syntax (preceded
        # by ``](``), don't re-wrap — the surrounding markdown handles render.
        start = match.start()
        src = src_holder["s"]
        already_in_md_link = start >= 2 and src[start - 2 : start] == "]("
        if already_in_md_link:
            return local_url
        # Standalone URL — wrap in markdown image syntax so the frontend
        # renders it inline (through the Nash-owned DownloadableImage).
        return f"![Generated image]({local_url})"

    return _BACKBOARD_S3_IMAGE_RE.sub(_swap, text)


def safe_partial_text(text: str) -> str:
    """Trim a streaming assistant text buffer so it never ends mid-Backboard-S3-URL.

    Token streaming delivers the assistant's markdown a few chars at a time;
    intermediate states look like ``…amazonaws.com/genera``. We don't yet
    know the document_id, so the regex sanitizer can't rewrite it. Returning
    that partial fragment to the client would leak the S3 hostname before the
    next chunk completes and replaces it.

    Strategy: if ``amazonaws.com`` appears in the text and there's no
    fully-terminated S3 image URL (with extension + optional query, followed
    by a closing token), drop everything from the nearest preceding ``http(s)://``
    onward and let the next chunk reveal the completed URL — which will then
    be rewritten by ``sanitize_s3_image_urls``.
    """
    if "amazonaws.com" not in text:
        return text
    # If a complete S3 image URL is present (post-sanitize this can't happen
    # because the regex rewrites it), let it through.
    if _BACKBOARD_S3_IMAGE_RE.search(text):
        return text
    # Find the last `http://` or `https://` that opens the partial URL.
    cutoff = max(text.rfind("http://"), text.rfind("https://"))
    if cutoff < 0:
        # No protocol prefix — drop everything after the last `amazonaws`
        # mention. This is paranoid but cheap.
        cutoff = text.rfind("amazonaws")
    return text[:cutoff] if cutoff >= 0 else ""


def wait_for_pending_image(file_id: str, timeout: float = 10.0) -> bool:
    """Block up to ``timeout`` seconds for a generated-image download to
    finish, used by /api/files/download to avoid 404-ing on a file that is
    still streaming in from Backboard. Returns True if the download signaled
    completion before the timeout."""
    with _pending_image_lock:
        event = _pending_image_downloads.get(file_id)
    if event is None:
        return False
    return event.wait(timeout=timeout)


def register_pending_image(file_id: str) -> threading.Event:
    """Register the pending-download event BEFORE the worker thread starts.

    The /api/files/download route decides whether to block on the event's
    existence — registering inside the thread left a window where a fast
    browser fetch found nothing and 404'd even though the download was about
    to begin."""
    event = threading.Event()
    with _pending_image_lock:
        _pending_image_downloads[file_id] = event
    return event


def _download_image_to_dir(media_url: str, dir_key: str, filename: str) -> str:
    """Download ``media_url`` into the user's upload dir (atomic rename).
    Returns the local path. Raises on failure."""
    from api.routes.files import UPLOAD_DIR  # avoid circular import at module load
    user_dir = os.path.join(UPLOAD_DIR, dir_key)
    os.makedirs(user_dir, exist_ok=True)
    local_path = os.path.join(user_dir, filename)
    # Stream to a UNIQUE temp file then atomic-rename so the route never sees
    # a half-written file — and concurrent writers (persist worker + the
    # download-route heal, or two parallel heals) never interleave into one
    # shared temp path. The ".partial" suffix keeps the route's ignore-filter
    # working.
    fd, tmp_path = tempfile.mkstemp(dir=user_dir, prefix=filename + ".", suffix=".partial")
    try:
        req = urllib.request.Request(media_url, headers={"User-Agent": "Nash/image-persist"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            with os.fdopen(fd, "wb") as f:
                shutil.copyfileobj(resp, f)
        os.replace(tmp_path, local_path)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise
    return local_path


# Transient refetch failures are throttled per file so a page full of dead
# images doesn't fire an outbound S3 request per <img> per reload, forever.
_image_refetch_fail_ts: dict[str, float] = {}
_IMAGE_REFETCH_FAIL_TTL = 60


def refetch_generated_image(user_id: str, dir_key: str, file_id: str) -> bool:
    """Last-chance heal for a generated image missing on disk: re-download it
    from the presigned URL recorded in file_meta. Covers the persist thread
    dying (dev-server reload is the classic case) and transient network
    failures, for as long as the presigned URL stays valid. Returns True when
    the file is on disk afterwards.

    A 403/404 from the presigned URL is PERMANENT (expired/deleted): the
    media_url is dropped from the row so later misses short-circuit instead of
    re-probing S3 on every render. Other failures are throttled per file."""
    row = state_service.file_meta.get(user_id, file_id) or {}
    media_url = row.get("media_url") or ""
    if not media_url:
        return False
    now = time.monotonic()
    if (now - _image_refetch_fail_ts.get(file_id, float("-inf"))) < _IMAGE_REFETCH_FAIL_TTL:
        return False
    ext = _MIME_TO_EXT.get(str(row.get("type") or "").lower(), "jpg")
    try:
        local_path = _download_image_to_dir(media_url, dir_key, f"{file_id}.{ext}")
    except urllib.error.HTTPError as exc:
        if exc.code in (403, 404):
            terminal = dict(row)
            terminal.pop("media_url", None)
            terminal["status"] = "unrecoverable"
            try:
                state_service.file_meta.put(user_id, file_id, terminal)
            except Exception:
                logger.warning("[chat] failed to mark image %s unrecoverable", file_id)
            logger.warning(
                "[chat] presigned URL for generated image %s is dead (%s) — "
                "marked unrecoverable", file_id, exc.code,
            )
        else:
            _image_refetch_fail_ts[file_id] = now
            logger.warning(
                "[chat] refetch of generated image %s failed: %s", file_id, exc,
            )
        return False
    except Exception as exc:
        _image_refetch_fail_ts[file_id] = now
        logger.warning(
            "[chat] refetch of generated image %s failed: %s", file_id, exc,
        )
        return False
    _image_refetch_fail_ts.pop(file_id, None)
    updated = dict(row)
    updated.update({
        "filename": os.path.basename(local_path),
        "bytes": os.path.getsize(local_path),
        "filepath": local_path,
        "status": "indexed",
    })
    state_service.file_meta.put(user_id, file_id, updated)
    logger.warning("[chat] re-fetched generated image %s to %s", file_id, local_path)
    return True


def _persist_generated_image_async(
    media_url: str,
    document_id: str,
    mime_type: str,
    user_id: str,
    dir_key: str,
    event: threading.Event | None = None,
) -> None:
    """Download a Backboard-generated image to local disk and register it with
    state_service. Runs in a background thread so the live stream isn't
    blocked. The frontend hits the predictable Nash URL immediately; this
    helper makes sure the file appears at that URL before any retry deadline.

    The presigned URL is recorded in file_meta up front so a failed/killed
    download can be healed later by refetch_generated_image(). Transient
    failures are retried before giving up.
    """
    file_id = generated_image_file_id(document_id)
    if event is None:
        event = register_pending_image(file_id)
    try:
        ext = _MIME_TO_EXT.get((mime_type or "").lower(), "jpg")
        filename = f"{file_id}.{ext}"
        # Record the source URL FIRST: if this thread dies (dev reload) or the
        # download fails, the download route can still heal via refetch.
        # media_url is server-side only — the file list serializer strips it.
        try:
            state_service.file_meta.put(user_id, file_id, {
                "file_id": file_id,
                "filename": filename,
                "type": mime_type or "image/jpeg",
                "source": "generated",
                "status": "pending",
                "document_id": document_id,
                "media_url": media_url,
            })
        except Exception:
            logger.warning("[chat] failed to pre-record generated image meta %s", file_id)

        local_path = ""
        last_exc: Exception | None = None
        for attempt in range(3):
            try:
                local_path = _download_image_to_dir(media_url, dir_key, filename)
                break
            except Exception as exc:  # transient S3/network errors — retry
                last_exc = exc
                time.sleep(1.5 * (attempt + 1))
        if not local_path:
            raise last_exc or RuntimeError("download failed")

        file_size = os.path.getsize(local_path)
        # Content hash so the file list can dedup images Backboard emits more
        # than once (it sends multiple media_generated events with distinct
        # document_ids for the same generated image).
        content_hash = ""
        try:
            import hashlib
            with open(local_path, "rb") as fh:
                content_hash = hashlib.sha256(fh.read()).hexdigest()
        except Exception:
            content_hash = ""
        state_service.file_meta.put(user_id, file_id, {
            "file_id": file_id,
            "filename": filename,
            "bytes": file_size,
            "type": mime_type or "image/jpeg",
            "source": "generated",
            "filepath": local_path,
            "status": "indexed",
            "document_id": document_id,
            "content_hash": content_hash,
            # Kept for refetch_generated_image; stripped from client payloads.
            "media_url": media_url,
        })
        logger.warning(
            "[chat] persisted generated image documentId=%s bytes=%d path=%s",
            document_id, file_size, local_path,
        )
    except Exception as exc:
        logger.warning(
            "[chat] failed to persist generated image documentId=%s err=%s",
            document_id, exc,
        )
    finally:
        event.set()
        with _pending_image_lock:
            _pending_image_downloads.pop(file_id, None)


async def _process_pending_files(
    user_id: str,
    target_file_ids: set[str],
    events_queue: queue.Queue,
    response_message_id: str,
    conversation_id: str,
    user_message_id: str,
    chat_assistant_id: str = "",
    thread_id: str = "",
    folder_assistant_id: str = "",
    bb_client=None,
):
    """Process file uploads and emit status events directly to the pre-stream queue.

    When ``folder_assistant_id`` is set (a folder chat), uploads are attached to
    the folder's Backboard assistant so every thread in that folder can
    reference them. Otherwise uploads stay scoped to ``thread_id`` (main chat
    and agent chats are unchanged).
    """
    phase_deadline = time.monotonic() + FILE_PROCESSING_PHASE_TIMEOUT_SEC

    def phase_timed_out() -> bool:
        return time.monotonic() >= phase_deadline

    def _status_event(text: str) -> dict:
        return {
            "type": "text",
            "text": {"value": text},
            "index": 0,
            "messageId": response_message_id,
            "conversationId": conversation_id,
            "userMessageId": user_message_id,
            "stream": True,
        }

    client = require_user_client(bb_client)
    files = state_service.file_meta.list_for_user(user_id)
    pending_files = [
        f
        for f in files
        if f.get("status") != "indexed"
        and f.get("file_id")
        and f.get("file_id") in target_file_ids
    ]
    if not pending_files:
        logger.info(
            "[chat] file processing: no pending files for file_ids %s", target_file_ids
        )
        return

    logger.info(
        "[chat] file processing: starting, %d pending file(s), phase_timeout=%ds",
        len(pending_files),
        FILE_PROCESSING_PHASE_TIMEOUT_SEC,
    )

    for i, f in enumerate(pending_files, start=1):
        if phase_timed_out():
            logger.warning(
                "[chat] file processing: phase time limit reached, skipping remaining"
            )
            return
        filename = f.get("filename", "file")
        # Process attached files SILENTLY — do not stream any "Loading image…" /
        # "Processing…" status text. That status was written into the assistant
        # message's own text content, which hijacked the message tree (and, when
        # the messages cache was momentarily empty during the new-chat id commit,
        # collapsed the whole thread to just the status line — wiping the user's
        # prompt, their image, and earlier messages). Keeping this phase silent
        # lets the user's optimistic message (prompt + image preview) stay on
        # screen while the normal "Generating…" placeholder covers the wait, and
        # the real response replaces it when it streams.
        try:
            filepath = f.get("filepath", "")
            if not filepath or not os.path.exists(filepath):
                logger.info(
                    "[chat] file processing: skip '%s' (no path or missing)", filename
                )
                continue

            logger.warning(
                "[chat] file processing: uploading '%s' to Backboard ...", filename
            )
            try:
                if folder_assistant_id:
                    upload_coro = client.upload_document_to_assistant(
                        assistant_id=folder_assistant_id,
                        file_path=filepath,
                    )
                else:
                    upload_coro = client.upload_document_to_thread(
                        thread_id=thread_id,
                        file_path=filepath,
                    )
                doc = await asyncio.wait_for(
                    upload_coro,
                    timeout=FILE_UPLOAD_TIMEOUT_SEC,
                )
            except asyncio.TimeoutError:
                logger.warning(
                    "[chat] file processing: upload timed out after %ds for '%s'",
                    FILE_UPLOAD_TIMEOUT_SEC,
                    filename,
                )
                events_queue.put(
                    _status_event(
                        f"Could not process {filename} (upload timed out). Continuing without it."
                    )
                )
                continue
            except Exception as e:
                logger.exception(
                    "Failed uploading pending file '%s' for assistant %s from %s",
                    filename,
                    folder_assistant_id or chat_assistant_id,
                    filepath,
                )
                events_queue.put(
                    _status_event(
                        f"Could not process {filename} ({e}). Continuing without it."
                    )
                )
                continue

            logger.info(
                "[chat] file processing: uploaded '%s', document_id=%s, polling for indexed ...",
                filename,
                doc.document_id,
            )

            for attempt in range(FILE_POLL_MAX_ATTEMPTS):
                if phase_timed_out():
                    logger.warning(
                        "[chat] file processing: phase time limit during poll for '%s'",
                        filename,
                    )
                    return
                try:
                    status = await client.get_document_status(doc.document_id)
                except BackboardAPIError as e:
                    logger.debug(
                        "[chat] file processing: poll attempt %d for '%s' got BackboardAPIError, retrying: %s",
                        attempt + 1,
                        filename,
                        e,
                    )
                    await asyncio.sleep(FILE_POLL_INTERVAL_SEC)
                    continue
                status_val = (
                    status.status.value
                    if hasattr(status.status, "value")
                    else str(status.status)
                )
                if (attempt + 1) % 15 == 0 or attempt == 0:
                    logger.info(
                        "[chat] file processing: poll attempt %d/%d for '%s': status=%s",
                        attempt + 1,
                        FILE_POLL_MAX_ATTEMPTS,
                        filename,
                        status_val,
                    )
                if status_val == DocumentStatus.INDEXED.value:
                    logger.info("[chat] file processing: '%s' indexed", filename)
                    break
                # Backboard's terminal failure status is "error"
                # (app/models/document.py); the SDK enum still says "failed".
                # Accept both — matching only the SDK value meant failed docs
                # were polled until timeout and the real reason discarded.
                if status_val in (DocumentStatus.FAILED.value, "error"):
                    msg = status.status_message or "Document processing failed"
                    logger.warning(
                        "[chat] file processing: '%s' failed: %s", filename, msg
                    )
                    events_queue.put(
                        _status_event(
                            f"Could not process {filename} ({msg}). Continuing without it."
                        )
                    )
                    doc = None
                    break
                await asyncio.sleep(FILE_POLL_INTERVAL_SEC)
            else:
                logger.warning(
                    "[chat] file processing: timed out waiting for '%s'", filename
                )
                events_queue.put(
                    _status_event(
                        f"Could not process {filename} (timed out). Continuing without it."
                    )
                )
                continue

            if doc is None:
                continue

            file_id = f.get("file_id")
            if file_id:
                updated = {
                    **{k: v for k, v in f.items() if k not in ("pk", "sk")},
                    "status": "indexed",
                    "document_id": str(doc.document_id),
                }
                try:
                    state_service.file_meta.put(user_id, file_id, updated)
                except Exception:
                    logger.exception(
                        "Failed to update file_meta for '%s' (%s)", filename, file_id,
                    )
        except Exception:
            logger.exception(
                "Unexpected error while processing pending file '%s'", filename
            )
            events_queue.put(
                _status_event(f"Could not process {filename}. Continuing without it.")
            )

    logger.warning("[chat] file processing: done, calling add_message next")


def _is_image_file_meta(file_meta: dict) -> bool:
    content_type = (file_meta.get("type") or "").lower()
    if content_type.startswith("image/"):
        return True
    filename = (file_meta.get("filename") or file_meta.get("filepath") or "").lower()
    guessed, _ = mimetypes.guess_type(filename)
    return bool(guessed and guessed.startswith("image/"))


def _load_image_tool_files(user_id: str, target_file_ids: set[str]) -> list[dict]:
    if not target_file_ids:
        return []
    out: list[dict] = []
    for file_meta in state_service.file_meta.list_for_user(user_id):
        if file_meta.get("file_id") not in target_file_ids:
            continue
        if not _is_image_file_meta(file_meta):
            continue
        path = file_meta.get("filepath", "")
        if not path or not os.path.exists(path):
            logger.info(
                "[chat] image tool: skip '%s' (no path or missing)",
                file_meta.get("filename", "image"),
            )
            continue
        out.append(file_meta)
    return out


def _image_tool_name(index: int) -> str:
    return f"{IMAGE_TOOL_NAME_PREFIX}{index}"


def _image_tool_definitions(image_files: list[dict]) -> list[dict]:
    tools: list[dict] = []
    for index, image_file in enumerate(image_files, start=1):
        filename = image_file.get("filename") or f"image-{index}"
        tools.append({
            "type": "function",
            "function": {
                "name": _image_tool_name(index),
                "description": (
                    "Return the uploaded image bytes for visual inspection. "
                    f"Call this tool to inspect attached image {index}: {filename}."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": False,
                },
            },
        })
    return tools


def _jpeg_ready_image(image: Image.Image) -> Image.Image:
    image = ImageOps.exif_transpose(image)
    if image.mode in ("RGBA", "LA") or (
        image.mode == "P" and "transparency" in image.info
    ):
        background = Image.new("RGB", image.size, "white")
        background.paste(image, mask=image.convert("RGBA").split()[-1])
        return background
    return image.convert("RGB")


def _encode_jpeg_under_limit(image: Image.Image, target_bytes: int) -> bytes | None:
    working = _jpeg_ready_image(image)
    working.thumbnail(
        (IMAGE_TOOL_MAX_DIMENSION, IMAGE_TOOL_MAX_DIMENSION),
        Image.Resampling.LANCZOS,
    )
    for _ in range(8):
        for quality in (85, 75, 65, 55, 45, 35):
            buffer = BytesIO()
            working.save(buffer, format="JPEG", quality=quality, optimize=True)
            data = buffer.getvalue()
            if len(data) <= target_bytes:
                return data
        width, height = working.size
        if width <= 512 and height <= 512:
            break
        next_size = (max(512, int(width * 0.8)), max(512, int(height * 0.8)))
        working = working.resize(next_size, Image.Resampling.LANCZOS)
    return None


def _image_bytes_for_tool(filepath: str, filename: str) -> tuple[bytes, str, bool]:
    size = os.path.getsize(filepath)
    media_type = mimetypes.guess_type(filename)[0] or "image/png"
    if size <= IMAGE_TOOL_MAX_BYTES:
        with open(filepath, "rb") as handle:
            return handle.read(), media_type, False

    with Image.open(filepath) as image:
        compressed = _encode_jpeg_under_limit(image, IMAGE_TOOL_TARGET_BYTES)
    if compressed is None:
        raise ValueError(f"{filename} could not be compressed below the image limit")
    return compressed, "image/jpeg", True


def _image_tool_output(image_file: dict) -> str:
    filepath = image_file.get("filepath", "")
    filename = image_file.get("filename") or os.path.basename(filepath) or "image"
    try:
        image_bytes, media_type, compressed = _image_bytes_for_tool(filepath, filename)
    except Exception as exc:
        size = os.path.getsize(filepath)
        return json.dumps({
            "error": f"{filename} could not be prepared for image inspection",
            "details": str(exc),
            "max_bytes": IMAGE_TOOL_MAX_BYTES,
            "bytes": size,
        })
    image_b64 = base64.b64encode(image_bytes).decode("ascii")
    text = f"Uploaded image: {filename}"
    if compressed:
        text = f"{text} (compressed for inspection)"
    return json.dumps({
        "text": text,
        "__image_media_type": media_type,
        "__image_base64": image_b64,
    })


async def _index_long_message_for_assistant(
    assistant_id: str,
    content: str,
    events_queue: queue.Queue,
    response_message_id: str,
    conversation_id: str,
    user_message_id: str,
    thread_id: str = "",
    bb_client=None,
) -> str:
    """Upload a long message as a document and wait for it to index."""

    def _status_event(text: str) -> dict:
        return {
            "type": "text",
            "text": {"value": text},
            "index": 0,
            "messageId": response_message_id,
            "conversationId": conversation_id,
            "userMessageId": user_message_id,
            "stream": True,
        }

    client = require_user_client(bb_client)
    events_queue.put(_status_event(LONG_MESSAGE_STATUS_START))

    filepath = ""
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".txt", delete=False
        ) as handle:
            handle.write(content)
            filepath = handle.name

        events_queue.put(_status_event(LONG_MESSAGE_STATUS_INDEXING))
        doc = await asyncio.wait_for(
            client.upload_document_to_thread(
                thread_id=thread_id,
                file_path=filepath,
            ),
            timeout=FILE_UPLOAD_TIMEOUT_SEC,
        )
    finally:
        if filepath:
            try:
                os.unlink(filepath)
            except Exception:
                logger.exception(
                    "[chat] long message: failed to remove temp file %s", filepath
                )

    for attempt in range(FILE_POLL_MAX_ATTEMPTS):
        status = await client.get_document_status(doc.document_id)
        status_val = (
            status.status.value
            if hasattr(status.status, "value")
            else str(status.status)
        )
        if (attempt + 1) % 15 == 0 or attempt == 0:
            logger.info(
                "[chat] long message: poll %d/%d status=%s",
                attempt + 1,
                FILE_POLL_MAX_ATTEMPTS,
                status_val,
            )
        if status_val == DocumentStatus.INDEXED.value:
            events_queue.put(_status_event(LONG_MESSAGE_STATUS_DONE))
            return str(doc.document_id)
        if status_val == DocumentStatus.FAILED.value:
            msg = status.status_message or "Document processing failed"
            raise RuntimeError(msg)
        await asyncio.sleep(FILE_POLL_INTERVAL_SEC)

    raise RuntimeError("Timed out waiting for message indexing")


# Cap on the priming-seed size so a long forked history can't blow the model's
# context window. ~12k chars ≈ 3k tokens; we keep the most recent turns.
_MAX_SEED_CHARS = 12000


def _build_priming_text(snapshot: list) -> str:
    """Render a forked_messages snapshot into a single hidden priming message.

    Keeps the most recent turns within the budget (recent context matters most
    for continuation) and prepends an omission note if older turns were dropped.
    """
    lines: list[str] = []
    total = 0
    truncated = False
    for snap in reversed(snapshot or []):
        if not isinstance(snap, dict):
            continue
        text = (snap.get("text") or "").strip()
        if not text:
            continue
        who = "User" if snap.get("isCreatedByUser") else "Assistant"
        line = f"{who}: {text}"
        if lines and total + len(line) > _MAX_SEED_CHARS:
            truncated = True
            break
        lines.append(line)
        total += len(line)
    if not lines:
        return ""
    lines.reverse()
    body = "\n\n".join(lines)
    if truncated:
        body = "[earlier messages omitted]\n\n" + body
    return (
        "The following is the earlier conversation that this chat continues. "
        "Use it as background context for everything that follows. Do not reply "
        "to this note or mention it; just continue the conversation naturally.\n\n"
        + body
    )


def _resolve_regen_original_user_id(
    prev_ai_id: str, positional_fallback_id: str, existing_graph: dict
) -> str:
    """Find the TRUE original user message id for a regeneration.

    The naive positional guess (visible_msgs[-4] in the caller) is only
    correct on the FIRST regeneration of a given exchange — the thread
    grows by 2 messages (a hidden duplicate user message + new response)
    per prior retry, so on the 2nd+ regeneration a fixed offset lands on a
    previous retry's hidden (SKIP) duplicate user message instead of the
    real original, orphaning the newest response's parent to a message the
    frontend never receives.

    Chain through the existing regen graph instead: if the response
    actually being regenerated (prev_ai_id) was itself a regeneration, its
    original is already recorded there — reuse it. Otherwise (first
    regeneration) fall back to the positional guess, which is correct in
    that case.
    """
    return existing_graph.get(prev_ai_id, positional_fallback_id)


def _seed_forked_thread_if_needed(
    user_id: str, conversation_id: str, thread_id: str, bb
) -> None:
    """Give a forked/duplicated/copied conversation its prior model context.

    Fork, duplicate and share-"Add to my chats" all create an EMPTY Backboard
    thread plus a Nash-side `forked_messages` display snapshot — so the model has
    no memory of the original chat. On the FIRST continuation we seed the thread
    once with a hidden priming message (send_to_llm=false: saved to the thread
    and fed to the next run, but never shown — skipped on display by
    seed_message_id). A `seeded` flag makes this run exactly once.
    """
    if not thread_id or bb is None:
        return
    try:
        meta = get_conversation_meta(user_id, conversation_id)
    except Exception:
        return
    if not isinstance(meta, dict) or meta.get("seeded"):
        return
    snapshot = meta.get("forked_messages") or []
    if not snapshot:
        return

    priming = _build_priming_text(snapshot)
    if not priming:
        # Nothing usable to seed; flag it so we don't retry every turn.
        try:
            save_conversation_meta(
                user_id, conversation_id, {"seeded": True, "seed_message_id": ""}
            )
        except Exception:
            pass
        return

    seed_id = ""
    try:
        resp = run_async(
            bb.add_message(
                thread_id=thread_id, content=priming, send_to_llm="false", stream=False
            )
        )
        msgs = getattr(resp, "messages", None) or []
        if msgs and isinstance(msgs[-1], dict):
            seed_id = str(msgs[-1].get("id") or msgs[-1].get("message_id") or "")
    except Exception:
        logger.warning(
            "[chat] forked-thread seed failed for convo %s; will retry next turn",
            conversation_id, exc_info=True,
        )
        return  # leave `seeded` unset → retried on the next turn

    if not seed_id:
        # The response didn't surface the id; the freshly-seeded (previously
        # empty) thread now holds exactly the seed, so read it back directly.
        try:
            tmsgs = run_async(get_thread_messages(thread_id, bb))
            if tmsgs:
                seed_id = str(tmsgs[-1].message_id)
        except Exception:
            pass

    try:
        save_conversation_meta(
            user_id, conversation_id, {"seeded": True, "seed_message_id": seed_id}
        )
    except Exception:
        logger.warning(
            "[chat] failed to persist seed flag for convo %s",
            conversation_id, exc_info=True,
        )


def _json_safe_file_number(value):
    if isinstance(value, Decimal):
        if value.is_finite() and value == value.to_integral_value():
            return int(value)
        if value.is_finite():
            return float(value)
        return str(value)
    return value


def _message_files_from_request(
    user_id: str, dir_key: str, requested_files: list
) -> list[dict]:
    """Build renderable descriptors from trusted upload metadata."""
    message_files: list[dict] = []
    for requested in requested_files:
        if not isinstance(requested, dict) or not requested.get("file_id"):
            continue
        metadata = requested.get("metadata")
        if isinstance(metadata, dict) and metadata.get("isPastedBlock") is True:
            continue
        file_id = str(requested["file_id"])
        stored = state_service.file_meta.get(user_id, file_id)
        if not stored:
            continue
        descriptor = {
            "file_id": file_id,
            "filename": stored.get("filename") or requested.get("filename") or "File",
            "filepath": f"/api/files/download/{dir_key}/{file_id}",
            "type": stored.get("type") or requested.get("type") or "application/octet-stream",
            "source": stored.get("source") or "local",
        }
        for field in ("height", "width", "bytes"):
            value = requested.get(field)
            if value is None:
                value = stored.get(field)
            if value is not None:
                descriptor[field] = _json_safe_file_number(value)
        message_files.append(descriptor)
    return message_files


def _get_added_convo(payload: dict) -> dict | None:
    """Validate payload["addedConvo"] enough to act on; None if unusable."""
    added_convo = payload.get("addedConvo")
    if not isinstance(added_convo, dict):
        return None
    if not added_convo.get("model"):
        return None
    return added_convo


# Serializes "resolve the real Backboard message_id for this turn, then save
# the added-model response under it" per conversation. Without this, two
# turns racing on the SAME conversation (two tabs, a fast double-send) could
# both resolve to the same get_thread_messages()[-1] and either cross-attach
# one turn's added-model answer to the OTHER turn's message, or lose an
# entry outright to save_added_response's non-atomic read-modify-write —
# both confirmed reproducible without this lock. Correct and sufficient here
# specifically because this process runs a single gevent worker (see
# Dockerfile: --workers 1 --worker-class gevent) — gevent monkey-patches
# threading.Lock to yield cooperatively between greenlets rather than
# blocking an OS thread, so this is a real mutex across concurrently-handled
# requests, not a no-op. A multi-process deployment would need a distributed
# lock (or a conditional DynamoDB write) instead of this.
_added_response_locks: dict[tuple[str, str], threading.Lock] = {}
_added_response_locks_guard = threading.Lock()


def _get_added_response_lock(user_id: str, conversation_id: str) -> threading.Lock:
    key = (user_id, conversation_id)
    with _added_response_locks_guard:
        lock = _added_response_locks.get(key)
        if lock is None:
            lock = threading.Lock()
            _added_response_locks[key] = lock
        return lock


async def _run_added_model_turn(
    *,
    user_id: str,
    conversation_id: str,
    assistant_id: str,
    main_thread_id: str,
    user_text: str,
    added_endpoint: str,
    added_model: str,
    bb,
) -> dict:
    """One-shot added-model turn: fresh disposable thread, seeded, one answer.

    This coroutine is itself scheduled onto the persistent event loop (via
    run_async_background — see its call site in stream_chat.generate()), so
    it must stay 100% ``await``-based. Calling run_async() from in here would
    block the loop thread waiting on a task submitted to that SAME loop —
    a guaranteed deadlock, not just a slow path.

    Never raises — a broken/slow second model must not take down the primary
    response. Always returns {"text", "error", "thread_id"}.
    """
    llm_provider, model_name = parse_model_spec(added_model)
    fresh_thread_id = ""
    # Captured before the primary turn has written anything for THIS turn
    # (this coroutine starts concurrently before the primary's own Backboard
    # call opens) — the caller uses it to confirm the primary actually wrote
    # a NEW message before attributing this turn's added-model answer to it,
    # rather than blindly attaching to whatever happens to be thread-last at
    # resolution time (which could be a stale prior turn if the primary
    # silently failed to write, e.g. a transport error before Backboard ever
    # received it).
    baseline_last_message_id = None
    try:
        # Forked/duplicated conversations seed their (otherwise-empty)
        # Backboard thread with a hidden priming message
        # (_seed_forked_thread_if_needed) — is_user_visible_message alone
        # does not filter it out (it's role="user" like a real turn), so
        # without this it would be re-wrapped into ANOTHER "earlier
        # conversation" preamble by _build_priming_text below, every single
        # turn, burning a growing share of the fixed _MAX_SEED_CHARS budget
        # on nested boilerplate instead of actual recent history. Same
        # exclusion messages.py/share.py already apply when displaying it.
        try:
            convo_meta = get_conversation_meta(user_id, conversation_id)
        except Exception:
            convo_meta = {}
        seed_message_id = (
            convo_meta.get("seed_message_id", "") if isinstance(convo_meta, dict) else ""
        )

        raw_msgs = await get_thread_messages(main_thread_id, bb)
        visible_raw_msgs = [
            m
            for m in raw_msgs
            if is_user_visible_message(m) and (not seed_message_id or m.message_id != seed_message_id)
        ]
        if visible_raw_msgs:
            baseline_last_message_id = visible_raw_msgs[-1].message_id
        snapshot = [
            {"text": m.content, "isCreatedByUser": role_name(m) == "user"}
            for m in visible_raw_msgs
        ]

        thread = await bb.create_thread(assistant_id)
        fresh_thread_id = str(thread.thread_id)

        priming = _build_priming_text(snapshot)
        if priming:
            await bb.add_message(
                thread_id=fresh_thread_id,
                content=priming,
                send_to_llm="false",
                stream=False,
            )

        # The primary pane's equivalent oversized-message handling
        # (_index_long_message_for_assistant) uploads the raw text as an
        # indexed document and swaps in a short "read document X" prompt —
        # that rewrite happens later in generate(), on ctx["model_text"],
        # after this coroutine has already been scheduled with
        # ctx["user_text"]'s value captured at call time, so this turn
        # cannot simply switch to reading the rewritten field. A full
        # equivalent (indexing under the added model's own disposable
        # thread/assistant) isn't worth the added latency and complexity for
        # a one-shot side answer — cap defensively instead, so an oversized
        # paste degrades to "answered from a truncated view" rather than
        # reliably failing outright (Backboard rejecting an oversized inline
        # content field, or the added model's own context window overflowing).
        turn_text = user_text
        if len(turn_text) > LONG_MESSAGE_CHAR_THRESHOLD:
            turn_text = (
                turn_text[:LONG_MESSAGE_CHAR_THRESHOLD]
                + "\n\n[message truncated for the added model — too long to send inline]"
            )
        response = await bb.send_message(
            content=turn_text,
            thread_id=fresh_thread_id,
            llm_provider=llm_provider,
            model_name=model_name,
            stream=False,
        )
        # Must check status before touching _response_text: when the
        # assistant has any tool configured (MCP server, memory retrieval —
        # possible even with no per-call tools= passed here, since tool
        # availability is assistant-level config, not a per-message opt-in),
        # a REQUIRES_ACTION response has response.content == None while
        # response.messages is non-empty. _response_text's fallback then does
        # messages[-1].content on what is actually a raw dict (SDK's
        # ChatMessagesResponse.messages: List[Dict]), raising AttributeError.
        # This one-shot added-model turn intentionally doesn't run a tool
        # loop (that would need its own submit_tool_outputs cycle, doubling
        # cost/complexity for a side answer) — surface it as a clear,
        # distinct outcome instead of risking that crash.
        status = getattr(response, "status", None)
        if status == "REQUIRES_ACTION":
            return {
                "text": "",
                "error": "requires_action",
                "thread_id": fresh_thread_id,
                "baseline_last_message_id": baseline_last_message_id,
            }
        return {
            "text": _response_text(response),
            "error": None,
            "thread_id": fresh_thread_id,
            "baseline_last_message_id": baseline_last_message_id,
        }
    except Exception as e:
        logger.warning(
            "[chat] added-model turn failed (endpoint=%s model=%s): %s",
            added_endpoint, added_model, e, exc_info=True,
        )
        return {
            "text": "",
            "error": str(e),
            "thread_id": fresh_thread_id,
            "baseline_last_message_id": baseline_last_message_id,
        }
    finally:
        # Detached, not awaited: cleanup must never delay returning the
        # actual answer. Joining a slow/hanging delete_thread call here would
        # make added_future.result(timeout=...) in generate() time out on a
        # turn that actually succeeded, just because cleanup was slow.
        if fresh_thread_id:
            asyncio.ensure_future(_delete_thread_best_effort(fresh_thread_id, bb))


async def _delete_thread_best_effort(thread_id: str, bb) -> None:
    try:
        await bb.delete_thread(thread_id)
    except Exception:
        logger.debug(
            "[chat] added-model thread cleanup failed for %s (harmless — orphaned thread, never looked up again)",
            thread_id,
        )


def _resolve_and_persist_added_response(
    *,
    partition_id: str,
    conversation_id: str,
    thread_id: str,
    bb,
    baseline_last_message_id: str | None,
    added_was_aborted: bool,
    stream_state: dict,
    added_text: str,
    added_convo_model: str,
    added_agent_id: str,
    added_ok: bool,
) -> None:
    """Resolve the real Backboard message_id for this turn and durably save
    the added-model response under it — extracted out of generate() so this
    (previously untested) logic is directly unit-testable.

    Locked per (user, conversation): two turns racing on the same
    conversation (two tabs, a fast double-send) could otherwise both resolve
    get_thread_messages(...)[-1] to the SAME message and either cross-attach
    one turn's answer to the other's message, or lose an entry to
    save_added_response's non-atomic read-modify-write. See
    _get_added_response_lock.
    """
    with _get_added_response_lock(partition_id, conversation_id):
        # Re-checked here (in addition to the two checks already done by the
        # caller before/after the added-model join) — immediately before
        # touching shared state, since an abort landing in the small window
        # between those checks and acquiring this lock would otherwise still
        # slip through.
        if stream_state.get("done"):
            added_was_aborted = True

        real_response_message_id = None
        if not added_was_aborted:
            try:
                added_id_msgs = run_async(get_thread_messages(thread_id, bb), timeout=15)
                added_id_visible = [m for m in added_id_msgs if is_user_visible_message(m)]
                if added_id_visible and role_name(added_id_visible[-1]) == "assistant":
                    candidate_id = added_id_visible[-1].message_id
                    # Guard against attaching to a STALE message: if nothing
                    # changed since before this turn's primary call ran
                    # (baseline_last_message_id, captured by
                    # _run_added_model_turn before the primary wrote
                    # anything), the primary silently failed to write to
                    # Backboard this turn — attaching here would mis-attach
                    # this answer to an unrelated older turn instead of just
                    # not persisting it.
                    if candidate_id != baseline_last_message_id:
                        real_response_message_id = candidate_id
                    else:
                        logger.warning(
                            "[chat] added-model: thread tail unchanged since "
                            "before this turn for conversation %s — primary likely "
                            "did not write; skipping attribution to a stale message",
                            conversation_id,
                        )
            except Exception:
                logger.exception(
                    "[chat] added-model: failed to resolve real message_id for conversation %s",
                    conversation_id,
                )

        if real_response_message_id:
            try:
                save_added_response(
                    partition_id,
                    conversation_id,
                    real_response_message_id,
                    {
                        "text": added_text,
                        "model": added_convo_model,
                        "agentId": added_agent_id,
                        "ok": added_ok,
                    },
                )
            except Exception:
                logger.exception(
                    "[chat] failed to persist added-model response for conversation %s",
                    conversation_id,
                )
        elif not added_was_aborted:
            # Couldn't resolve the real id — the answer already reached the
            # user via the SSE events already yielded by the caller; it just
            # won't survive a refresh. Log loudly since this should be rare
            # (thread read failure right after a successful write), not
            # silent.
            logger.error(
                "[chat] added-model: no real message_id resolved for conversation %s — "
                "response delivered live but will not survive a refresh",
                conversation_id,
            )


_STRIPPED_ASSISTANTS: set[str] = set()
# Marks that a tool bears the old "{server}__{tool}" MCP prefix or the current
# "{tool}_mcp_{server}" one — i.e. was pushed onto the assistant by the retired
# assistant-sync path. The document-export tool is Nash's own per-turn tool and
# is never persisted, so it won't appear here.
_LEGACY_MCP_TOOL_MARKERS = ("__", "_mcp_")


def _strip_legacy_assistant_tools_once(user_id: str, assistant_id: str, bb) -> None:
    """One-time removal of MCP tools previously synced onto a user's assistant.

    The retired assistant-sync path (``_sync_mcp_tools_to_assistant``) left MCP
    tool definitions persisted on the nash-main assistant. Persisted tools fire
    on EVERY turn — including plain streaming turns whose ``tool_submit_required``
    the old code never handled — stalling the run until the 45s idle timeout.
    MCP is now per-turn only, so any persisted MCP tools are pure liability.

    Runs at most once per assistant per process (best-effort; a fresh worker
    re-checks and no-ops when there's nothing to strip).
    """
    if not assistant_id or assistant_id in _STRIPPED_ASSISTANTS:
        return
    _STRIPPED_ASSISTANTS.add(assistant_id)
    try:
        async def _maybe_strip():
            assistant = await bb.get_assistant(assistant_id)
            tools = getattr(assistant, "tools", None) or []
            def _name(t):
                fn = getattr(t, "function", None) or (t.get("function") if isinstance(t, dict) else None) or {}
                return getattr(fn, "name", None) or (fn.get("name") if isinstance(fn, dict) else "") or ""
            has_mcp = any(
                marker in _name(t)
                for t in tools
                for marker in _LEGACY_MCP_TOOL_MARKERS
            )
            if tools and has_mcp:
                logger.warning(
                    "[mcp] stripping %d persisted tool(s) off assistant %s (retired sync path)",
                    len(tools), assistant_id,
                )
                await bb.update_assistant(assistant_id=assistant_id, tools=[])

        run_async(_maybe_strip(), timeout=30)
    except Exception:
        # Never block a chat turn on migration cleanup; retry on the next turn.
        _STRIPPED_ASSISTANTS.discard(assistant_id)
        logger.warning("[mcp] assistant tool-strip check failed for %s", assistant_id, exc_info=True)


def _prepare_stream(stream_id: str, user_id: str, payload: dict,
                    session_bb_api_key: str = "", session_chat_assistant_id: str = "",
                    dir_key: str = "",
                    account_user_id: str = "") -> dict:
    """Resolve IDs and prepare the stream context.

    ``user_id`` is the STATE PARTITION (see get_request_state_partition) —
    every state_service read/write in here must stay on it.
    ``account_user_id`` is the raw account identity, needed for account-level
    settings (the memory opt-out) that aren't partition-scoped.

    NOTE: This runs inside the SSE generator (outside Flask request context),
    so it must NOT access ``request``.  Request-scoped values are passed in
    via captured stream state at creation time.

    Returns a dict with all the context needed for generate() to pull
    directly from the Backboard stream.  Also enqueues any file-processing
    status events into a small pre-stream queue that generate() drains first.
    """
    # The Flask request is gone by the time this generator runs, so use only
    # the session credential captured when the stream was created.
    bb_api_key, assistant_id = _resolve_chat_credentials(
        user_id,
        session_bb_api_key=session_bb_api_key,
        session_chat_assistant_id=session_chat_assistant_id,
    )
    # The chat/config split is retired — same id for both.
    config_assistant_id = assistant_id
    bb = get_user_client(bb_api_key)
    conversation_id = payload.get("conversationId")
    # Read the temporary flag before the thread is resolved: it decides whether
    # get_or_create_thread persists the conversation→thread mapping at all.
    is_temporary_chat = bool(payload.get("isTemporary"))

    agent_id = payload.get("agent_id", "")
    ephemeral_agent = payload.get("ephemeralAgent") or {}
    agent_bb_assistant_id = ""

    if isinstance(ephemeral_agent, dict) and ephemeral_agent.get("bb_assistant_id"):
        agent_bb_assistant_id = ephemeral_agent["bb_assistant_id"]
        logger.warning(
            "[chat] using ephemeral agent bb_assistant_id=%s, agent=%s",
            agent_bb_assistant_id,
            ephemeral_agent.get("name", ""),
        )
    elif agent_id and agent_id.startswith("agent_"):
        try:
            agent_bb_assistant_id = _get_agent_bb_assistant_id(user_id, agent_id)
            if agent_bb_assistant_id:
                logger.warning(
                    "[chat] resolved agent_id=%s -> bb_assistant_id=%s",
                    agent_id,
                    agent_bb_assistant_id,
                )
            else:
                logger.warning(
                    "[chat] agent_id=%s has no bb_assistant_id, falling back to default",
                    agent_id,
                )
        except Exception:
            logger.exception(
                "Failed to resolve bb_assistant_id for agent_id=%s", agent_id
            )

    folder_id = payload.get("folderId", "") if not agent_bb_assistant_id else ""
    folder_bb_assistant_id = ""
    if not agent_bb_assistant_id and folder_id:
        try:
            folder_bb_assistant_id = _get_folder_bb_assistant_id(user_id, folder_id)
            if folder_bb_assistant_id:
                logger.warning(
                    "[chat] resolved folder_id=%s -> bb_assistant_id=%s",
                    folder_id,
                    folder_bb_assistant_id,
                )
            else:
                logger.warning(
                    "[chat] folder_id=%s has no bb_assistant_id, falling back to default",
                    folder_id,
                )
        except Exception:
            logger.exception(
                "Failed to resolve bb_assistant_id for folder_id=%s", folder_id
            )

    thread_owner_id = agent_bb_assistant_id or folder_bb_assistant_id or assistant_id
    # Temporary chats create their Backboard thread without persisting the
    # conversation→thread mapping (or anything else) to DynamoDB.
    thread_id, conversation_id, is_new = get_or_create_thread(
        user_id, thread_owner_id, conversation_id, bb, persist=not is_temporary_chat
    )

    # For new folder conversations, eagerly write hidden conversation_meta so the
    # conversation never leaks into the main list even during the first stream.
    if is_new and folder_id and not agent_bb_assistant_id and not is_temporary_chat:
        try:
            run_async(
                _save_conversation_meta(
                    user_id,
                    conversation_id,
                    {"folderId": folder_id, "hidden": True, "title": "New Chat"},
                )
            )
        except Exception:
            logger.exception(
                "[chat] stream: failed to pre-save folder conversation meta"
            )

    # Forked/duplicated/copied conversations carry their history only as a
    # display snapshot; their Backboard thread is empty. Seed it once (hidden)
    # so the model can actually continue the conversation with context.
    _seed_forked_thread_if_needed(user_id, conversation_id, thread_id, bb)

    user_text = _extract_user_text(payload)

    # Eagerly persist conversation meta for a brand-new main-list chat so it
    # shows up in the sidebar immediately — with a real, prompt-derived name —
    # and survives a refresh mid-generation. Previously the titled meta was only
    # written when the stream *completed*, so refreshing while the model was
    # still responding (e.g. describing a freshly uploaded image) dropped the new
    # chat from the list until it finished; only an untitled thread_map
    # placeholder existed in the meantime. Folder chats are pre-saved (hidden)
    # above; this covers the main list. save_conversation_meta merges, so the
    # completion write never clobbers this title (should_set_title stays False
    # once a real prompt-derived title is present).
    if is_new and not folder_id and not is_temporary_chat:
        try:
            run_async(
                _save_conversation_meta(
                    user_id,
                    conversation_id,
                    {
                        "title": _eager_conversation_title(user_text),
                        "endpoint": payload.get("endpoint")
                        or payload.get("endpointType")
                        or "openai",
                        "model": payload.get("model") or "",
                    },
                )
            )
        except Exception:
            logger.exception(
                "[chat] stream: failed to eager-save conversation meta"
            )
    model_text = user_text
    # The export tool is offered on every turn so the model can decide when to
    # call it — no server-side regex gating. Backboard holds the full
    # conversation on the thread_id, so the model always has prior context
    # (e.g. the document it just outlined) and can call create_document_export
    # on a bare follow-up like "do it" or any phrasing we wouldn't predict.
    # This flag only decides whether to strengthen the system prompt nudging the
    # model toward the tool.
    should_index_long_message = _should_index_long_message(user_text)
    display_files = _display_files_from_pasted_payload(
        payload=payload,
        partition_id=user_id,
        conversation_id=conversation_id,
        dir_key=dir_key,
    )
    display_text_override = user_text
    if should_index_long_message and not display_files:
        try:
            display_files = [
                _persist_pasted_text_file(
                    partition_id=user_id,
                    conversation_id=conversation_id,
                    dir_key=dir_key,
                    filename="Pasted text.txt",
                    content=user_text,
                    content_type="text/plain",
                    language="Text",
                )
            ]
            display_files[0]["_content"] = user_text
            display_text_override = ""
        except Exception:
            logger.warning(
                "[chat] failed to persist long message display file for convo %s",
                conversation_id,
                exc_info=True,
            )
    model = payload.get("model") or ""
    endpoint = payload.get("endpoint") or payload.get("endpointType") or "openai"
    # New logins default to OpenAI GPT-4.1 for the plain default chat (no custom
    # agent or folder assistant, which carry their own configured model).
    # Without this, an empty model makes Backboard fall back to its own AWS
    # Anthropic default. An explicit user selection is always respected.
    if not model and thread_owner_id == assistant_id:
        model = FALLBACK_MODEL
    endpoint_option = payload.get("endpointOption", {})
    if not model and endpoint_option:
        model = endpoint_option.get("model", "") or endpoint_option.get(
            "modelLabel", ""
        )
    # Re-anchor the picker id to Backboard's live catalog. Stale yaml ids and
    # Bedrock-style names ("anthropic.claude-opus-4-7") don't exist upstream:
    # unresolved, every such turn errors and silently falls back to GPT-4.1.
    resolved_model = _resolve_chat_model_spec(model, bb_api_key)
    if resolved_model and resolved_model != model:
        logger.warning(
            "[chat] model %r not in Backboard catalog; resolved to %r",
            model, resolved_model,
        )
        model = resolved_model

    mem_toggle = (
        "Off"
        if is_temporary_chat
        else (
            ephemeral_agent.get("memory", "Auto")
            if isinstance(ephemeral_agent, dict)
            else "Auto"
        )
    )
    bb_memory = _BB_MEMORY_MODES.get(mem_toggle, "off")
    # The account-wide privacy opt-out (Settings → Personalization → memories)
    # must win over any per-conversation composer state: when disabled,
    # Backboard must neither retrieve nor record memories for this user. Keyed on
    # the ACCOUNT identity captured at stream creation — not the state partition
    # (org partitions aren't user ids) and not flask.g, which is gone by the time
    # this runs in the generator thread.
    if bb_memory != "off":
        try:
            if not memories_enabled_for_user(
                find_user_by_id(account_user_id or user_id)
            ):
                bb_memory = "off"
        except Exception:
            logger.warning("[chat] failed to check memory opt-out", exc_info=True)
    # Web search is ALWAYS available; the MODEL decides when to use it (like
    # ChatGPT). "Auto" = capability on, model chooses — verified: on Auto both
    # Bedrock Claude and GPT-4.1 self-trigger a search only when the question
    # needs it. No prompt detection. A user can still force it OFF via the toggle.
    requested_web_search = (
        None
        if isinstance(ephemeral_agent, dict)
        and ephemeral_agent.get("web_search") is False
        else "Auto"
    )
    # Image generation is ALWAYS available; the MODEL decides when to generate or
    # edit (like ChatGPT). No prompt detection — verified: on image_generation=
    # "auto" both Bedrock Claude and GPT-4.1 self-trigger the image tool only when
    # the user actually asks for an image, and answer ordinary questions normally.
    # Enabling it does NOT change the conversation model (Backboard runs the
    # separate image_model). A user can force it OFF via the ephemeral agent.
    # _resolve_image_config is cheap to call every turn — it reads the Backboard
    # model catalog through a TTL cache.
    requested_image_generation = not (
        isinstance(ephemeral_agent, dict)
        and ephemeral_agent.get("image_generation") is False
    )

    # Deterministic image *context* (NOT regex): does this turn have an uploaded
    # image, or has the conversation already produced one? Used only to (a)
    # attach uploaded images as vision references, (b) orchestrate the turn on a
    # tool-capable model when the selected one cannot drive tools, and (c) drive
    # image-specific error messaging. `has_uploaded_image` is resolved below once
    # the uploaded files are loaded. The image model itself is resolved there too
    # (it needs to know whether the turn carries a reference image).
    conv_has_image = False
    if not is_new:
        try:
            _cm = state_service.convo_meta.get(user_id, conversation_id) or {}
            conv_has_image = bool(_cm.get("imageGenerated"))
        except Exception:
            conv_has_image = False

    pre_queue = queue.Queue()

    requested_files = payload.get("files") or []
    message_files = _message_files_from_request(user_id, dir_key, requested_files)
    # Match attachments by file_id. The upload response now returns `filepath`
    # as a download URL (so the browser can render it), so the legacy
    # filepath-string match no longer works for newly uploaded files. file_id
    # is always present on uploaded files and unambiguous.
    requested_file_ids = {f["file_id"] for f in message_files}
    # Keep uploaded images on Backboard's native thread-document path. Main's
    # temporary inspect_uploaded_image tool returned the image as a multi-megabyte
    # base64 JSON string; providers treated that as text rather than vision input,
    # producing unrelated descriptions and leaking the payload into tool chips.
    if requested_file_ids:
        logger.info(
            "[chat] stream: processing pending files (file_ids=%s)", requested_file_ids
        )
        try:
            # run_async's DEFAULT 30s timeout used to apply here, killing any
            # attachment turn whose upload+indexing ran longer (normal PDFs and
            # images routinely do — Backboard indexes with a vision model in a
            # background worker). _process_pending_files enforces its own
            # deadlines (FILE_PROCESSING_PHASE_TIMEOUT_SEC per phase,
            # FILE_UPLOAD_TIMEOUT_SEC per upload), so size the outer guard to
            # their worst case instead: one upload started just before the
            # phase deadline.
            run_async(
                _process_pending_files(
                    user_id=user_id,
                    target_file_ids=requested_file_ids,
                    events_queue=pre_queue,
                    response_message_id=str(uuid.uuid4()),
                    conversation_id=conversation_id,
                    user_message_id=str(uuid.uuid4()),
                    chat_assistant_id=assistant_id,
                    thread_id=thread_id,
                    folder_assistant_id=folder_bb_assistant_id,
                    bb_client=bb,
                ),
                timeout=FILE_UPLOAD_TIMEOUT_SEC + FILE_PROCESSING_PHASE_TIMEOUT_SEC,
            )
        except TimeoutError:
            # concurrent.futures.TimeoutError is builtins.TimeoutError on
            # 3.11+. Degrade instead of killing the turn: the reply proceeds
            # without the stragglers. (Backboard may still 400 the send with
            # "documents are still being indexed"; that surfaces via the
            # normal error path, and a retry after indexing completes
            # succeeds.)
            logger.warning(
                "[chat] stream: file-processing phase timed out; continuing "
                "without unfinished files (file_ids=%s)", requested_file_ids,
            )

    # Image-to-image: attach the user's uploaded reference image(s) DIRECTLY to
    # the generation message via Backboard's native message-attachment path (the
    # multipart "files" field the SDK's add_message uses). This is the one channel
    # that delivers the image to the model/image model as real VISION. The other
    # two paths both fail: /documents is RAG/text, and the base64 view-tool output
    # is delivered as text (proven 2026-07-21 — it ballooned input_tokens to ~46k
    # and the model still said "can't access the image"). Scoped to image turns
    # that actually carry an upload; ordinary turns are unaffected.
    image_gen_ref_files: list[dict] = []
    if requested_file_ids:
        image_gen_ref_files = _load_image_tool_files(user_id, requested_file_ids)
        if image_gen_ref_files:
            logger.info(
                "[chat] image turn: attaching %d uploaded image(s) to the "
                "generation message as vision references",
                len(image_gen_ref_files),
            )

    # Deterministic (mime-based) — an uploaded image means the user almost
    # certainly wants something done WITH it (edit/transform/analyze). Combined
    # with any previously generated image, this is the full image-context
    # signal used below. No regex.
    has_uploaded_image_this_turn = bool(image_gen_ref_files)
    image_context_this_turn = has_uploaded_image_this_turn or conv_has_image

    # Per-user image model preference ("<provider>/<model_name>"), sent on the
    # ephemeralAgent and validated against the allow-list. Falls back to deploy
    # defaults when missing. Resolved on EVERY turn now that the tool is always
    # attached (_resolve_image_config hits the Backboard catalog, but it's
    # cached per key for an hour so this is not a per-turn network hit).
    # Resolved AFTER the reference images are known: an image-to-image turn must
    # land on a vision-capable image model or Backboard 400s with
    # image_model_vision_required.
    image_model_provider, image_model_name = _resolve_image_config(
        ephemeral_agent.get("image_model")
        if isinstance(ephemeral_agent, dict)
        else None,
        api_key=bb_api_key,
        needs_vision=has_uploaded_image_this_turn,
    )
    logger.info(
        "[chat] image tool enabled: image_model=%s/%s needs_vision=%s uploaded_image=%s",
        image_model_provider, image_model_name, has_uploaded_image_this_turn,
        has_uploaded_image_this_turn,
    )

    # Resolve fallback model (opt-out, not opt-in).
    # Frontend sends ephemeralAgent.fallback_model = False to disable entirely.
    fallback_model: str | None = FALLBACK_MODEL
    if (
        isinstance(ephemeral_agent, dict)
        and ephemeral_agent.get("fallback_model") is False
    ):
        fallback_model = None

    # The tool is attached every turn, but a model the catalog marks
    # tools-incapable (e.g. Bedrock-hosted Claude) can never CALL it. Only swap
    # to a tool-capable orchestrator when this turn actually carries image
    # context (an uploaded image to edit, or a prior generated image to modify)
    # — otherwise ordinary chat on a Bedrock model would be needlessly hijacked
    # onto the fallback. Decide the swap NOW so the turn starts on a capable
    # orchestrator with an honest notice instead of erroring first. None = run
    # on the selected model.
    image_orchestrator_override: str | None = None
    if image_context_this_turn:
        image_orchestrator_override = _image_turn_orchestrator(
            model, fallback_model, bb_api_key
        )
        if image_orchestrator_override:
            logger.warning(
                "[chat] image turn: %r has no tool support — orchestrating on %r",
                model, image_orchestrator_override,
            )

    # Load MCP server configs if any are enabled for this conversation.
    mcp_server_map: dict = {}
    if isinstance(ephemeral_agent, dict):
        mcp_enabled = ephemeral_agent.get("mcp", {}) or {}
        if mcp_enabled:
            for s in state_service.mcp_servers.list_for_user(user_id):
                sname = s.get("serverName", "")
                # frontend sends {serverName: true} or {serverName: MCPServerRecord}
                if sname and sname in mcp_enabled:
                    # An OAuth server with no valid/refreshable token can't answer
                    # a tool call — skip it so the model isn't offered tools that
                    # would deterministically 401 (and get misreported as an
                    # API-key problem). Its (possibly stale) stored tools are not
                    # exposed until the user (re)authorizes.
                    if mcp_oauth_service.is_oauth_server(s) and not mcp_oauth_service.get_valid_access_token(user_id, s):
                        logger.info("[chat] skipping OAuth MCP server %s: no valid token", sname)
                        continue
                    mcp_server_map[sname] = s

    # Per-turn tool payload for the selected servers. MCP tools ride the normal
    # streaming call as OpenAI-style `tools`; mcp_tool_map dispatches
    # tool_submit_required calls back to the owning server.
    mcp_tools, mcp_tool_map = (
        build_tool_payload(mcp_server_map) if mcp_server_map else ([], {})
    )

    _strip_legacy_assistant_tools_once(user_id, assistant_id, bb)

    return {
        "assistant_id": assistant_id,
        "config_assistant_id": config_assistant_id,
        # The assistant that actually owns this conversation's THREAD — differs
        # from assistant_id (the user's plain default) whenever this turn runs
        # under a custom Agent or a folder-scoped assistant. Added-model turns
        # must create their disposable thread under THIS assistant, not the
        # plain default, or they lose the agent's system prompt/documents.
        "thread_owner_id": thread_owner_id,
        "bb_api_key": bb_api_key,
        "bb_client": bb,
        "thread_id": thread_id,
        "conversation_id": conversation_id,
        "folder_id": folder_id,
        "user_text": user_text,
        "model_text": model_text,
        "display_text_override": display_text_override,
        "display_files": display_files,
        "should_index_long_message": should_index_long_message,
        "model": model,
        "endpoint": endpoint,
        "bb_memory": bb_memory,
        # Temporary chat: no conversation meta / graphs / message-file maps are
        # written to DynamoDB anywhere in the stream pipeline.
        "is_temporary": is_temporary_chat,
        "requested_web_search": requested_web_search,
        "requested_image_generation": requested_image_generation,
        "image_context_this_turn": image_context_this_turn,
        "image_model_provider": image_model_provider,
        "image_model_name": image_model_name,
        # Reserved for compatibility with the main-branch helper/tests. New
        # uploaded images use Backboard's native indexed-document pipeline.
        "image_tool_files": [],
        "image_gen_ref_files": image_gen_ref_files,
        "pre_queue": pre_queue,
        "message_files": message_files,
        "mcp_server_map": mcp_server_map,
        "mcp_tools": mcp_tools,
        "mcp_tool_map": mcp_tool_map,
        "fallback_model": fallback_model,
        "image_orchestrator_override": image_orchestrator_override,
        # Sending tools does not make a model use them: it calls a tool when it
        # knows it cannot answer (live weather), but answers from memory when it
        # thinks it knows the domain (e.g. AWS docs) — the very case the user
        # attached the server for. Backboard has no tool_choice, so we bias it
        # with a per-turn system prompt.
        # Web search + image generation are always available and the MODEL decides
        # when to use them. The permissive CAPABILITIES prompt neutralizes a
        # restrictive persona ("I can't search / generate images") so the model
        # actually uses the tools — without forcing them on ordinary questions.
        # MCP takes precedence when servers are selected (its own prompt/tools);
        # otherwise the permissive CAPABILITIES prompt covers web search, image
        # generation, AND document export — all model-decided, no regex.
        # Either way, on conversations that already produced images the prior
        # document ids ride along so an edit request becomes true image-to-image
        # (input_image_document_id) instead of a from-scratch regeneration.
        "system_prompt": (
            (
                build_mcp_system_prompt(mcp_server_map)
                if mcp_tools
                else CAPABILITIES_SYSTEM_PROMPT
            )
            + _image_edit_prompt_suffix(user_id, conversation_id)
        ),
        # Per-turn tools. The document-export tool is offered on every non-MCP
        # turn and the MODEL decides when to call it (verified: it self-triggers
        # for PDF/Word asks and coexists with image_generation="auto" — the model
        # still generates images when asked). MCP turns use their own tool set.
        "tools": (mcp_tools or None) if mcp_tools else [DOCUMENT_EXPORT_TOOL],
    }


def _pick_message_files_user_id(
    bb_msgs, regen_graph, pre_user_ids, corr_token=None, require_new=False
):
    """Choose which user message this request's uploaded files belong to.

    Files must attach to the user message THIS request created — not merely the
    thread's current last user message. A concurrent turn (e.g. a reload that
    starts a new request while this one is still generating) can advance the
    thread's last user message, so the naive "last user message" pick lands the
    files on the wrong turn (#3 — occasionally attaches the wrong image).

    Resolution order, most authoritative first:

    1. ``corr_token`` — the per-request token Nash stamped into the message
       metadata on send. The user message whose ``metadata.nash_msg_token``
       equals it is unambiguously ours, with no timing assumption at all. This
       fully closes the race, and depends on Backboard persisting and returning
       per-message metadata.
    2. ``pre_user_ids`` — the set of user-message ids that existed BEFORE this
       request opened its Backboard stream. This request's user message is a
       *new* id; if several are new (truly concurrent turns), the oldest new one
       is ours, because we opened our stream — and so created our user message —
       first. Used when Backboard returns no matching metadata.
    3. The last non-SKIP user message, when no snapshot is available.
    """
    candidates = [
        m
        for m in bb_msgs
        if m.role == "user" and regen_graph.get(str(m.message_id)) != "SKIP"
    ]
    if not candidates:
        return None
    if corr_token:
        for m in candidates:
            meta = getattr(m, "metadata", None) or {}
            if isinstance(meta, dict) and meta.get("nash_msg_token") == corr_token:
                return str(m.message_id)
    if pre_user_ids is not None:
        new_users = [m for m in candidates if str(m.message_id) not in pre_user_ids]
        if new_users:
            return str(new_users[0].message_id)
    if require_new:
        # Early persistence path: only accept a definitively-new message (token
        # or snapshot match). Refuse the last-user fallback, which could still be
        # a PRIOR turn's message if Backboard hasn't created this turn's user
        # message yet — attaching the image there would be wrong.
        return None
    return str(candidates[-1].message_id)


def _resolve_and_save_message_files(
    partition_id,
    conversation_id,
    thread_id,
    bb_client,
    message_files,
    pre_user_ids,
    corr_token,
    require_new=False,
) -> bool:
    """Attach the user's uploaded files to the Backboard user message THIS turn
    created and persist them. Returns True once saved. Safe to call repeatedly
    (idempotent put) and off the request thread. With ``require_new`` it only
    saves once the turn's user message is definitively identified (used by the
    early poll so it never lands on a prior message)."""
    try:
        bb_msgs = run_async(get_thread_messages(thread_id, bb_client))
        regen_graph = get_regen_graph(partition_id, conversation_id)
        target_user_id = _pick_message_files_user_id(
            bb_msgs, regen_graph, pre_user_ids, corr_token=corr_token, require_new=require_new
        )
        if target_user_id is None:
            return False
        save_message_files(partition_id, conversation_id, target_user_id, message_files)
        logger.info(
            "[chat] saved %d message files for msg %s convo %s",
            len(message_files),
            target_user_id,
            conversation_id,
        )
        return True
    except Exception:
        logger.exception(
            "[chat] failed to persist message files convo %s", conversation_id
        )
        return False


def _open_backboard_stream(
    ctx: dict,
    web_search_mode: str | None,
    model_override: str | None = None,
    image_generation: bool = False,
):
    """Open the Backboard async stream and return a sync iterator via iter_async.

    *image_generation* is per-call rather than per-ctx so a retry can decide
    whether to request it (e.g. a fallback retry drops the flag when the
    fallback model may not support tool calling).
    """

    async def _open():
        return await stream_message_proxy_compatible(
            thread_id=ctx["thread_id"],
            content=ctx["model_text"],
            model=model_override or ctx["model"] or None,
            memory=ctx["bb_memory"],
            web_search=web_search_mode,
            image_generation=IMAGE_GENERATION_MODE if image_generation else None,
            image_model_provider=ctx["image_model_provider"] if image_generation else None,
            image_model_name=ctx["image_model_name"] if image_generation else None,
            # Attach the user's uploaded reference image(s) directly to the
            # generation message (Backboard's native message-attachment path).
            # Unlike the /documents RAG upload or base64 tool outputs — both of
            # which reach the model as text, not vision — a file attached here is
            # delivered as real vision, so the model/image model can recreate or
            # edit it. Only on image turns that actually carry an upload.
            image_files=ctx.get("image_gen_ref_files") if image_generation else None,
            system_prompt=ctx.get("system_prompt"),
            tools=ctx.get("tools"),
            metadata=(
                {"nash_msg_token": ctx["files_corr_token"]}
                if ctx.get("files_corr_token")
                else None
            ),
            api_key=ctx.get("bb_api_key"),
        )

    async_iter = run_async(_open())
    return iter_async(async_iter, idle_timeout=STREAM_IDLE_TIMEOUT_SEC)


def _latest_message_dict(data: dict) -> dict:
    messages = data.get("messages") or []
    if isinstance(messages, list) and messages:
        latest = messages[-1]
        if isinstance(latest, dict):
            return latest
    return data


def _extract_tool_calls(data: dict) -> list[dict]:
    latest = _latest_message_dict(data)
    tool_calls = data.get("tool_calls") or latest.get("tool_calls") or []
    return tool_calls if isinstance(tool_calls, list) else []


def _extract_run_id(data: dict) -> str:
    latest = _latest_message_dict(data)
    metadata = latest.get("metadata") or latest.get("metadata_") or {}
    if not isinstance(metadata, dict):
        metadata = {}
    return str(
        data.get("run_id")
        or data.get("runId")
        or latest.get("run_id")
        or latest.get("runId")
        or metadata.get("run_id")
        or metadata.get("runId")
        or ""
    )


def _image_tool_action(data: dict) -> tuple[str, list[dict]] | None:
    """Extract a required tool action from buffered or streaming responses."""
    latest = _latest_message_dict(data)
    status = str(data.get("status") or latest.get("status") or "").upper()
    if data.get("type") != "tool_submit_required" and status != "REQUIRES_ACTION":
        return None
    return _extract_run_id(data), _extract_tool_calls(data)


def _tool_call_id(tool_call) -> str:
    # Handles BOTH raw dicts (streaming tool_submit_required events) AND SDK
    # ToolCall objects (non-streaming send_message responses, e.g. the document
    # export loop) — the latter has no .get(), so a dict-only version crashed
    # with "'ToolCall' object has no attribute 'get'".
    if isinstance(tool_call, dict):
        return str(tool_call.get("id") or tool_call.get("tool_call_id") or "")
    return str(
        getattr(tool_call, "id", None) or getattr(tool_call, "tool_call_id", None) or ""
    )


def _tool_call_name(tool_call) -> str:
    if isinstance(tool_call, dict):
        function = tool_call.get("function") or {}
    else:
        function = getattr(tool_call, "function", None) or {}
    if isinstance(function, dict):
        return str(function.get("name") or "")
    return str(getattr(function, "name", "") or "")


async def _stream_image_tool_turn(
    ctx: dict,
    web_search_mode: str | None,
    model_override: str | None = None,
    image_generation: bool = False,
):
    client = get_user_client(ctx.get("bb_api_key"))
    llm_provider, model_name = parse_model_spec(model_override or ctx["model"] or None)
    image_files: list[dict] = ctx.get("image_tool_files") or []
    tools = _image_tool_definitions(image_files)
    image_names = ", ".join(
        f"{_image_tool_name(index)} for {image_file.get('filename') or 'image'}"
        for index, image_file in enumerate(image_files, start=1)
    )
    system_prompt = (
        "Attached image files are available through temporary tools. "
        "Call the relevant image tool before answering any question about image content. "
        f"Available tools: {image_names}."
    )
    body: dict[str, object] = {
        "content": ctx["model_text"],
        "stream": False,
        "thread_id": ctx["thread_id"],
        "system_prompt": system_prompt,
        "tools": tools,
    }
    if ctx.get("files_corr_token"):
        body["metadata"] = {"nash_msg_token": ctx["files_corr_token"]}
    if llm_provider:
        body["llm_provider"] = llm_provider
    if model_name:
        body["model_name"] = model_name
    if ctx["bb_memory"]:
        body["memory"] = ctx["bb_memory"]
    if web_search_mode:
        body["web_search"] = web_search_mode
    if image_generation:
        body["image_generation"] = IMAGE_GENERATION_MODE
        if ctx["image_model_provider"]:
            body["image_model_provider"] = ctx["image_model_provider"]
        if ctx["image_model_name"]:
            body["image_model_name"] = ctx["image_model_name"]

    response = await client._make_request("POST", "/threads/messages", json_data=body)
    data = response.json()
    latest = _latest_message_dict(data)
    action = _image_tool_action(data)
    if action is None:
        text = str(data.get("content") or latest.get("content") or "")
        if text:
            yield {"type": "content_streaming", "content": text}
        return

    by_tool_name = {
        _image_tool_name(index): image_file
        for index, image_file in enumerate(image_files, start=1)
    }
    for round_index in range(1, IMAGE_TOOL_MAX_ROUNDS + 1):
        run_id, tool_calls = action
        if not run_id or not tool_calls:
            raise BackboardAPIError(
                "Image tool action is missing its run id or tool calls"
            )

        tool_outputs: list[dict[str, str]] = []
        for tool_call in tool_calls:
            tool_call_id = _tool_call_id(tool_call)
            tool_name = _tool_call_name(tool_call)
            image_file = by_tool_name.get(tool_name)
            if not tool_call_id:
                continue
            if image_file is None:
                output = json.dumps(
                    {"error": f"No uploaded image found for tool {tool_name}"}
                )
            else:
                output = _image_tool_output(image_file)
            tool_outputs.append({"tool_call_id": tool_call_id, "output": output})

        if not tool_outputs:
            raise BackboardAPIError("Image tool action has no valid tool call ids")

        async_iter = await client.submit_tool_outputs(
            thread_id=ctx["thread_id"],
            run_id=run_id,
            tool_outputs=tool_outputs,
            stream=True,
        )
        next_action = None
        async with aclosing(async_iter) as continuation:
            async for chunk in continuation:
                next_action = _image_tool_action(chunk)
                if next_action is not None:
                    break
                yield chunk

        if next_action is None:
            return
        action = next_action
        logger.info("[chat] image tool: continuing with round %d", round_index + 1)

    raise BackboardAPIError(
        f"Image tool loop exceeded {IMAGE_TOOL_MAX_ROUNDS} rounds"
    )


def _open_backboard_image_tool_stream(
    ctx: dict,
    web_search_mode: str | None,
    model_override: str | None = None,
    image_generation: bool = False,
):
    async_iter = _stream_image_tool_turn(
        ctx,
        web_search_mode,
        model_override=model_override,
        image_generation=image_generation,
    )
    return iter_async(async_iter, idle_timeout=STREAM_IDLE_TIMEOUT_SEC)


def _open_tool_output_stream(ctx: dict, tool_outputs: list[dict]):
    """Submit tool outputs and return a sync iterator over the continuation SSE.

    Used after a ``tool_submit_required`` event to feed the export results back
    to Backboard and keep streaming the reply on the same thread.
    """

    async def _open():
        return await submit_tool_outputs_stream(
            ctx["thread_id"],
            tool_outputs,
            api_key=ctx.get("bb_api_key"),
        )

    async_iter = run_async(_open())
    return iter_async(async_iter, idle_timeout=STREAM_IDLE_TIMEOUT_SEC)


async def _open_tool_continuation(ctx: dict, run_id: str, tool_outputs: list[dict]):
    """Open the streaming continuation after submitting MCP tool outputs.

    Re-passes the per-turn tools so chained tool calls keep working (the run
    does not retain per-turn tools across submits — verified against the live
    API)."""
    return await stream_submit_tool_outputs(
        thread_id=ctx["thread_id"],
        run_id=run_id,
        tool_outputs=tool_outputs,
        tools=ctx.get("mcp_tools"),
        api_key=ctx.get("bb_api_key"),
    )


def _execute_mcp_tool_calls(tool_calls: list, tool_map: dict, base_index: int, ids: dict, user_id: str = ""):
    """Run each requested MCP tool, yielding tool_call UI event dicts.

    Emits an in-progress part then a completed part per call so ToolCall.tsx
    renders the activity. The final yield is ``(None, (tool_outputs, next_index))``
    — a sentinel carrying the collected Backboard tool outputs and the next
    free content index. ``user_id`` (state partition) resolves per-user OAuth
    tokens for OAuth MCP servers; empty/static servers ignore it.
    """
    outputs = []
    idx = base_index
    _token_cache: dict = {}  # server_name -> access_token, resolved once per turn

    def _access_token_for(server: dict):
        if not user_id or not mcp_oauth_service.is_oauth_server(server):
            return None
        name = server.get("serverName", "")
        if name not in _token_cache:
            _token_cache[name] = mcp_oauth_service.get_valid_access_token(user_id, server)
        return _token_cache[name]
    for tc in tool_calls or []:
        fn = tc.get("function", {}) if isinstance(tc, dict) else {}
        exposed_name = fn.get("name", "") or ""
        args_raw = fn.get("arguments", "{}")
        call_id = tc.get("id", "") if isinstance(tc, dict) else ""
        try:
            arguments = json.loads(args_raw) if isinstance(args_raw, str) else (args_raw or {})
        except (json.JSONDecodeError, TypeError):
            arguments = {}
        args_str = args_raw if isinstance(args_raw, str) else json.dumps(arguments)

        tool_part_index = idx
        idx += 1

        def _tool_event(output, progress):
            # Truncate for the UI only — `outputs` below keeps the full text,
            # which is what gets submitted back to Backboard. Without this the
            # live chip would show more than the finalized/reloaded one and
            # visibly shrink when the stream ends.
            return {
                "type": "tool_call",
                "tool_call": {
                    "id": call_id,
                    "name": exposed_name,
                    "args": args_str,
                    "output": truncate_tool_output(output) if output else output,
                    "progress": progress,
                },
                "index": tool_part_index,
                "messageId": ids["response_message_id"],
                "conversationId": ids["conversation_id"],
                "userMessageId": ids["user_message_id"],
                "thread_id": ids["thread_id"],
                "stream": True,
            }

        yield _tool_event(None, 0.1), None

        entry = tool_map.get(exposed_name)
        if entry is None:
            logger.warning("[mcp] no server mapped for requested tool %r", exposed_name)
            output = json.dumps({"error": f"Unknown tool '{exposed_name}'"})
        else:
            server, real_tool_name = entry
            started = time.monotonic()
            try:
                output = run_async(
                    call_mcp_tool(
                        server, real_tool_name, arguments,
                        access_token=_access_token_for(server),
                    ),
                    timeout=MCP_TOOL_CALL_TIMEOUT_SEC,
                )
                logger.info(
                    "[mcp] called %s.%s in %.2fs -> %d chars",
                    server.get("serverName", "?"), real_tool_name,
                    time.monotonic() - started, len(output or ""),
                )
            except Exception as tool_exc:
                logger.warning("[chat] MCP tool %s failed: %s", exposed_name, tool_exc)
                output = json.dumps({"error": f"Tool '{exposed_name}' failed: {tool_exc}"})

        outputs.append({"tool_call_id": call_id, "output": output})
        yield _tool_event(output, 1), None
    yield None, (outputs, idx)


def _tool_chip_parts(tool_calls: list[dict]) -> list[dict]:
    """tool_call content parts for the `final` SSE event.

    Must stay byte-for-byte equivalent to what build_tool_call_parts()
    reconstructs from Backboard on reload — same is_chip_tool() predicate, same
    truncation — or a chip shows while streaming and disappears on refresh.
    """
    parts = []
    for call in tool_calls or []:
        name = call.get("name", "")
        if not is_chip_tool(name):
            continue
        parts.append({
            "type": "tool_call",
            "tool_call": {
                "id": call.get("id", ""),
                "name": name,
                "args": call.get("args", ""),
                "output": truncate_tool_output(call.get("output") or ""),
                "progress": 1,
            },
        })
    return parts


def stream_mcp_turn(ctx: dict, ids: dict, result: dict, media_sink: dict, *,
                    open_stream=None, open_continuation=None):
    """Stream an MCP turn, satisfying every tool_submit_required round.

    Yields SSE event dicts. Content and tool-call parts get monotonically
    increasing indices so the UI renders them in true chronological order
    ([preamble?][tool calls][answer]). Accumulates into ``result``
    (full_text/input_tokens/output_tokens/total_tokens) for token accounting;
    the final message reloads from Backboard on refresh.

    ``open_stream()`` / ``open_continuation(run_id, tool_outputs)`` return sync
    chunk iterators; they default to the live Backboard stream and are injected
    by tests.
    """
    tool_map = ctx.get("mcp_tool_map") or {}
    dir_key = media_sink.get("dir_key")
    partition_id = media_sink.get("partition_id")

    if open_stream is None:
        def open_stream():
            return _open_backboard_stream(ctx, ctx.get("requested_web_search"))
    if open_continuation is None:
        def open_continuation(run_id, tool_outputs):
            return iter_async(
                run_async(_open_tool_continuation(ctx, run_id, tool_outputs)),
                idle_timeout=STREAM_IDLE_TIMEOUT_SEC,
            )

    stream = open_stream()
    stream_started = time.monotonic()
    next_index = 0
    text_index = None
    segment_text = ""
    tool_rounds = 0

    def _render_segment() -> dict:
        # Reads the CURRENT segment_text/text_index at emission time.
        rendered = sanitize_s3_image_urls(segment_text, dir_key)
        rendered = sanitize_leaked_export_instructions(rendered)
        rendered = safe_partial_text(rendered)
        return {
            "type": "text",
            "text": {"value": rendered},
            "index": text_index,
            "messageId": ids["response_message_id"],
            "conversationId": ids["conversation_id"],
            "userMessageId": ids["user_message_id"],
            "thread_id": ids["thread_id"],
            "stream": True,
        }

    throttle = _TextEventThrottle(_render_segment)

    while stream is not None:
        continuation = None
        for chunk in stream:
            if time.monotonic() - stream_started >= STREAM_TOTAL_TIMEOUT_SEC:
                logger.warning("[chat] MCP stream: total timeout after %ss", STREAM_TOTAL_TIMEOUT_SEC)
                yield from throttle.flush()
                result["full_text"] += "\n\n[Error: response timed out]"
                return
            chunk_type = chunk.get("type", "")
            if chunk_type == "content_streaming":
                content = chunk.get("content", "")
                if not content:
                    continue
                if text_index is None:
                    text_index = next_index
                    next_index += 1
                    segment_text = ""
                segment_text += content
                result["full_text"] += content
                yield from throttle.note(len(content))
            elif chunk_type == "media_generated":
                yield from throttle.flush()
                media = chunk.get("media") or {}
                media_url = media.get("url") or ""
                document_id = str(media.get("document_id") or "")
                if not media_url or not document_id or not dir_key:
                    continue
                mime_type = media.get("mime_type") or "image/jpeg"
                local_url = predictable_generated_image_url(dir_key, document_id)
                media_entry = {
                    "documentId": document_id,
                    "mimeType": mime_type,
                    "url": local_url,
                    "fileSizeBytes": media.get("file_size_bytes"),
                }
                t = threading.Thread(
                    target=_persist_generated_image_async,
                    args=(
                        media_url, document_id, mime_type, partition_id, dir_key,
                        register_pending_image(generated_image_file_id(document_id)),
                    ),
                    daemon=True,
                )
                t.start()
                media_sink["jobs"].append(t)
                media_sink["media"].append(media_entry)
                yield {
                    "type": "image",
                    "image": media_entry,
                    "messageId": ids["response_message_id"],
                    "conversationId": ids["conversation_id"],
                    "userMessageId": ids["user_message_id"],
                    "thread_id": ids["thread_id"],
                    "stream": True,
                }
            elif chunk_type == "tool_submit_required":
                # Flush BEFORE text_index resets: the held tail of the current
                # segment must render under ITS index, or that content part
                # stays truncated in the live view until the final event.
                yield from throttle.flush()
                tool_rounds += 1
                if tool_rounds > MAX_TOOL_ITERATIONS:
                    logger.warning("[chat] MCP: exceeded %d tool rounds", MAX_TOOL_ITERATIONS)
                    result["full_text"] += "\n\n[Error: too many tool calls — stopping]"
                    return
                run_id = chunk.get("run_id")
                tool_calls = chunk.get("tool_calls") or []
                text_index = None  # close current text segment; answer resumes after tools
                collected = None
                for event, sentinel in _execute_mcp_tool_calls(tool_calls, tool_map, next_index, ids, partition_id):
                    if sentinel is not None:
                        collected = sentinel
                    if event is not None:
                        # Keep the completed calls so the `final` event can carry
                        # chips too — without this the finalized message is
                        # text-only and the chips vanish the instant the stream
                        # ends, only to reappear on reload (rebuilt from
                        # Backboard by build_tool_call_parts).
                        part = event.get("tool_call") or {}
                        if part.get("progress") == 1:
                            result.setdefault("tool_calls", []).append(dict(part))
                        yield event
                tool_outputs, next_index = collected if collected else ([], next_index)
                if not run_id:
                    logger.warning("[chat] MCP: tool_submit_required with no run_id")
                    return
                continuation = open_continuation(run_id, tool_outputs)
                break
            elif chunk_type in ("run_ended", "run_completed"):
                yield from throttle.flush()
                result["input_tokens"] = int(chunk.get("input_tokens", 0) or 0)
                result["output_tokens"] = int(chunk.get("output_tokens", 0) or 0)
                result["total_tokens"] = int(chunk.get("total_tokens", 0) or 0)
                return
            elif chunk_type in ("error", "run_failed"):
                # Flush before raising so the partial tail was emitted before
                # the exception reaches the retry orchestration.
                yield from throttle.flush()
                error_msg = chunk.get("error") or chunk.get("message", "Unknown error")
                raise BackboardAPIError(error_msg)
        stream = continuation
    yield from throttle.flush()


def _resolve_chat_credentials(
    user_id: str,
    *,
    session_bb_api_key: str = "",
    session_chat_assistant_id: str = "",
) -> tuple[str, str]:
    """Return credentials captured from the authenticated session.

    Chat must never fall back to a server or persisted profile key because
    either could belong to an older Backboard context.
    """
    bb_api_key = require_user_api_key(session_bb_api_key)
    try:
        assistant_id = session_chat_assistant_id or get_user_assistant_id(user_id)
    except Exception:
        assistant_id = session_chat_assistant_id or ""
    return bb_api_key, assistant_id


@chat_bp.route("/api/agents/chat", methods=["POST"])
@chat_bp.route("/api/agents/chat/<endpoint_name>", methods=["POST"])
@require_auth
def start_chat(endpoint_name=None):
    _evict_stale_chat_streams()
    payload = request.get_json() or {}
    stream_id = str(uuid.uuid4())
    conversation_id = payload.get("conversationId", "")
    user_id = get_request_user_id()
    state_partition = get_request_state_partition()
    logger.warning(
        "[chat] start_chat stream_id=%s endpoint_name=%s conversation_id=%s model=%s endpoint=%s isTemporary=%s",
        stream_id,
        endpoint_name,
        conversation_id,
        payload.get("model"),
        payload.get("endpoint") or payload.get("endpointType"),
        bool(payload.get("isTemporary")),
    )

    from api.routes.files import _upload_dir_key

    # Store just enough for the SSE endpoint to resolve the stream context.
    # Capture request-context values now; generate() runs outside request context.
    _streams[stream_id] = {
        # Raw identity — billing (record_token_usage) and the active_jobs
        # ownership check. App-state operations use statePartition instead.
        "userId": user_id,
        # Partition for all state_service reads/writes.
        "statePartition": state_partition,
        "payload": payload,
        "conversationId": conversation_id,
        "done": False,
        # Session auth: capture decrypted key + assistant id for _prepare_stream
        "sessionBbApiKey": getattr(g, 'bb_api_key', '') or '',
        "sessionChatAssistantId": getattr(g, 'chat_assistant_id', '') or '',
        # Directory key for user uploads / generated-image persistence. Matches
        # the upload-route convention (api/routes/files.py).
        "dirKey": _upload_dir_key(),
        "events": [],
        "createdAtMono": time.monotonic(),
        "updatedAtMono": time.monotonic(),
    }
    _log_stream_event(stream_id, "stream_created")

    return jsonify(
        {
            "streamId": stream_id,
            "conversationId": conversation_id,
            "status": "started",
        }
    )


@chat_bp.route("/api/agents/chat/stream/<stream_id>", methods=["GET"])
@require_auth
def stream_chat(stream_id):
    _evict_stale_chat_streams()
    is_resume = request.args.get("resume") == "true"
    stream_state = _streams.get(stream_id)
    _log_stream_event(stream_id, "sse_connect", isResume=is_resume)

    if not stream_state:
        if is_resume:

            def completed():
                yield _sse_payload({"final": True, "completed": True})

            return Response(
                completed(),
                mimetype="text/event-stream",
                headers={
                    "Cache-Control": "no-cache, no-transform",
                    "Connection": "keep-alive",
                    "X-Accel-Buffering": "no",
                },
            )
        return jsonify({"error": "Stream not found"}), 404

    # Ownership: a stream id is not a capability. Respond 404 (not 403) so an
    # attacker probing ids can't distinguish "exists" from "not yours".
    if not _stream_owned_by_caller(stream_state):
        return jsonify({"error": "Stream not found"}), 404

    # Guard: if generate() is already running — or the stream is DONE (e.g.
    # aborted before the client ever connected) — a connection must replay the
    # recorded events, never (re-)run the pipeline. Without the done-check an
    # abort-then-connect would start a ghost generation for a dead stream.
    if stream_state.get("generating") or stream_state.get("done"):
        _log_stream_event(stream_id, "resume_already_generating", isResume=is_resume)

        return Response(
            _replay_running_stream(stream_id, stream_state, is_resume),
            mimetype="text/event-stream",
            headers={
                "Cache-Control": "no-cache, no-transform",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    stream_state["generating"] = True

    def generate():
        """Pull-based SSE generator — no queue, no background thread.

        Opens the Backboard stream and yields each chunk as an SSE event
        directly, mirroring the Backboard API's own streaming approach.
        """
        payload = stream_state.pop("payload", {})
        user_id = stream_state["userId"]  # raw identity: billing only
        # Context-scoped partition for every state_service read/write.
        partition_id = stream_state.get("statePartition") or user_id
        full_text = ""
        total_tokens = 0
        input_tokens = 0
        output_tokens = 0
        executed_tool_calls: list[dict] = []  # MCP calls made this turn (chips)
        conversation_id = stream_state.get("conversationId", "")
        fallback_succeeded = False
        # Set when an image turn is preemptively orchestrated on the fallback
        # model (selected model can't call tools). Function-scoped: the
        # post-stream notice persistence reads it on every code path,
        # including MCP turns that never enter the _consume branch.
        preemptive_override: str | None = None
        generated_media: list[dict] = []  # populated by media_generated events
        # Mutable flag (list so the nested media handler can set it without
        # `nonlocal`): whether THIS turn produced an image. Persisted on the
        # conversation so follow-ups are recognized as image/edit turns.
        image_generated_this_turn = [False]
        # Document IDs of images generated this turn (via media_generated events).
        # These are inlined into the streamed text only; Backboard's stored message
        # never carries them, so they're persisted per assistant message at
        # stream-end and re-injected on reload (see save_generated_media).
        generated_image_doc_ids: list[str] = []
        # Backboard sometimes emits the SAME generated image as two media_generated
        # events with different document_ids but byte-identical content, which
        # rendered the image twice. Track sizes seen this turn to drop the dup.
        seen_media_sizes: set[int] = set()
        # Background download threads for generated images. We don't await them
        # at end-of-stream — the predictable Nash URL emitted in the SSE event
        # is what the browser fetches, and /api/files/download blocks briefly
        # on the in-flight event if the bytes haven't landed yet.
        generated_media_jobs: list[threading.Thread] = []
        # Directory key used for storing user uploads + generated images.
        # Resolved once we know which session is talking.
        dir_key_for_uploads = stream_state.get("dirKey", "") or context_service.fs_safe_partition(partition_id or "")

        try:
            ctx = _prepare_stream(
                stream_id, partition_id, payload,
                session_bb_api_key=stream_state.get("sessionBbApiKey", ""),
                session_chat_assistant_id=stream_state.get("sessionChatAssistantId", ""),
                dir_key=dir_key_for_uploads,
                account_user_id=user_id,
            )
            persisted_fallback_prefix = ""
        except Exception:
            logger.exception(
                "[chat] stream: prepare failed for stream_id=%s", stream_id
            )
            yield _sse_payload(
                _record_stream_event(
                    stream_state,
                    {
                        "final": True,
                        "conversation": {"conversationId": conversation_id},
                        "requestMessage": None,
                        "responseMessage": {
                            "text": "I ran into an error starting your response. Please try again.",
                            "error": True,
                        },
                    },
                )
            )
            _streams.pop(stream_id, None)
            return

        conversation_id = ctx["conversation_id"]
        stream_state["conversationId"] = conversation_id
        # No pre-emptive image guess: image generation is always available and the
        # model decides, so the indicator is driven reactively — a tool_status is
        # emitted when the model actually invokes a tool (Backboard's
        # tool_call_ready event). Deterministic image context is deliberately NOT
        # used here: it stays true for every later turn of a conversation that
        # once produced an image, which would show a "Generating image…"
        # placeholder on plain follow-up questions.
        stream_state["imageGeneration"] = False
        thread_id = ctx["thread_id"]
        model = ctx["model"]
        endpoint = ctx["endpoint"]

        # Some models (notably GPT-4.1, the image-routing target) return a
        # generated image INLINE in their markdown — ![](<presigned-s3-url>) —
        # instead of via a media_generated event. sanitize_s3_image_urls rewrites
        # that S3 URL to a Nash-local /api/files/download URL, but nothing
        # downloads the bytes, so the rewritten URL 404s ("Couldn't load this
        # image"). Persist those inline images the same way media_generated ones
        # are, deduped by file_id so streaming's repeated calls fire once.
        _inline_image_seen: set[str] = set()
        # Scan cursor into full_text (list so the closure can mutate it): each
        # call scans only what was appended since the last one, plus an overlap
        # generous enough to cover a presigned S3 URL (~1.5KB with signature)
        # split across chunk boundaries. Rescanning the overlap is harmless —
        # matches dedupe by file_id below.
        _inline_scan_pos = [0]

        def _persist_inline_s3_images(text: str) -> None:
            if not text or not dir_key_for_uploads:
                return
            if len(text) < _inline_scan_pos[0]:
                # full_text was reset (fallback retry) — restart the scan.
                _inline_scan_pos[0] = 0
            segment = text[max(0, _inline_scan_pos[0] - 4096):]
            _inline_scan_pos[0] = len(text)
            if "amazonaws.com" not in segment:
                return
            for m in _BACKBOARD_S3_IMAGE_RE.finditer(segment):
                doc = m.group("doc").lower()
                fid = generated_image_file_id(doc)
                if fid in _inline_image_seen:
                    continue
                _inline_image_seen.add(fid)
                with _pending_image_lock:
                    in_flight = fid in _pending_image_downloads
                if in_flight or state_service.file_meta.get(partition_id, fid):
                    continue
                ext = m.group(0).rsplit(".", 1)[-1].split("?")[0].lower()
                mime = {
                    "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
                    "webp": "image/webp", "gif": "image/gif",
                }.get(ext, "image/jpeg")
                worker = threading.Thread(
                    target=_persist_generated_image_async,
                    args=(
                        m.group(0), doc, mime, partition_id, dir_key_for_uploads,
                        register_pending_image(fid),
                    ),
                    daemon=True,
                )
                worker.start()
                generated_media_jobs.append(worker)
                logger.warning(
                    "[chat] persisting inline generated image documentId=%s", doc,
                )

        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        user_message_id, response_message_id = _live_message_ids(payload)
        parent_message_id = payload.get(
            "parentMessageId", "00000000-0000-0000-0000-000000000000"
        )
        override_parent_message_id = payload.get("overrideParentMessageId")
        is_regenerate = payload.get("isRegenerate", False)

        # Multi-conversation (compare mode): kick off the added model's turn
        # concurrently with the primary response — a fresh, disposable
        # Backboard thread per turn, joined back in near the end of this
        # generator (see "added_future.result(...)" below). Started this
        # early (before the primary Backboard stream opens) so both run in
        # parallel on the shared persistent event loop, and so the history
        # snapshot it seeds from is read before this turn's user message is
        # appended to the main thread.
        added_convo = _get_added_convo(payload)
        added_future = None
        added_agent_id = ""
        primary_agent_id = ""
        if added_convo is not None:
            try:
                # Fall back like the primary endpoint resolution above ("openai")
                # rather than "" — an empty endpoint produces a leading "__" in
                # the encoded agentId, which parseEphemeralAgentId (client-side)
                # can't parse back into a clean label.
                added_convo_endpoint = added_convo.get("endpoint") or "openai"
                added_agent_id = added_model_agent_id(
                    added_convo_endpoint, added_convo.get("model") or "", index=1
                )
                primary_agent_id = added_model_agent_id(endpoint, model)
                stream_state["primaryAgentId"] = primary_agent_id
                added_future = run_async_background(
                    _run_added_model_turn(
                        user_id=partition_id,
                        conversation_id=conversation_id,
                        # thread_owner_id, not assistant_id: the assistant that
                        # actually owns THIS conversation's thread (matters for
                        # custom Agents / folder-scoped assistants, which carry
                        # their own system_prompt/documents that assistant_id
                        # alone would silently skip).
                        assistant_id=ctx["thread_owner_id"],
                        main_thread_id=thread_id,
                        user_text=ctx["user_text"],
                        added_endpoint=added_convo_endpoint,
                        # Same catalog re-anchoring as the primary model — an
                        # unresolvable added model would error its whole column.
                        added_model=_resolve_chat_model_spec(
                            added_convo.get("model") or "", ctx.get("bb_api_key") or ""
                        ),
                        bb=ctx["bb_client"],
                    )
                )
            except Exception:
                logger.exception(
                    "[chat] failed to start added-model turn for conversation %s",
                    conversation_id,
                )
                added_future = None

        user_message = {
            "messageId": user_message_id,
            "conversationId": conversation_id,
            "parentMessageId": parent_message_id,
            "text": ctx.get("display_text_override", ctx["user_text"]),
            "sender": "User",
            "isCreatedByUser": True,
            "createdAt": now,
            "error": False,
        }
        visible_message_files = list(ctx.get("message_files") or [])
        if ctx.get("display_files"):
            visible_message_files.extend(
                {k: v for k, v in file_info.items() if k != "_content"}
                for file_info in ctx["display_files"]
                if isinstance(file_info, dict)
            )
        if visible_message_files:
            user_message["files"] = visible_message_files

        yield _sse_payload(
            _record_stream_event(
                stream_state,
                {
                    "created": True,
                    "message": user_message,
                    "responseMessageId": response_message_id,
                },
            )
        )

        # Index long messages before streaming (and before draining status events).
        if ctx.get("display_files"):
            try:
                doc_refs = []
                for file_info in ctx["display_files"]:
                    content = file_info.get("_content") if isinstance(file_info, dict) else ""
                    if not content:
                        continue
                    doc_id = run_async(
                        _index_long_message_for_assistant(
                            assistant_id=ctx["assistant_id"],
                            content=content,
                            events_queue=ctx["pre_queue"],
                            response_message_id=response_message_id,
                            conversation_id=conversation_id,
                            user_message_id=user_message_id,
                            thread_id=ctx.get("thread_id", ""),
                            bb_client=ctx.get("bb_client"),
                        )
                    )
                    doc_refs.append({
                        "filename": file_info.get("filename") or "Pasted text.txt",
                        "document_id": doc_id,
                    })
                if doc_refs:
                    ctx["model_text"] = _build_pasted_files_prompt(ctx["user_text"], doc_refs)
            except Exception as e:
                logger.exception(
                    "[chat] pasted text: indexing failed for conversation %s",
                    conversation_id,
                )
                full_text = f"Sorry, I could not index that pasted text. {e}"
        elif ctx.get("should_index_long_message"):
            try:
                doc_id = run_async(
                    _index_long_message_for_assistant(
                        assistant_id=ctx["assistant_id"],
                        content=ctx["user_text"],
                        events_queue=ctx["pre_queue"],
                        response_message_id=response_message_id,
                        conversation_id=conversation_id,
                        user_message_id=user_message_id,
                        thread_id=ctx.get("thread_id", ""),
                        bb_client=ctx.get("bb_client"),
                    )
                )
                ctx["model_text"] = _build_long_message_prompt(doc_id)
            except Exception as e:
                logger.exception(
                    "[chat] long message: indexing failed for conversation %s",
                    conversation_id,
                )
                full_text = f"Sorry, I could not index that long message. {e}"

        # Drain any file-processing or long-message status events first.
        pre_q: queue.Queue = ctx["pre_queue"]
        while not pre_q.empty():
            event = pre_q.get_nowait()
            if isinstance(event, dict) and event.get("stream") is True:
                event["messageId"] = response_message_id
                event["conversationId"] = conversation_id
                event["userMessageId"] = user_message_id
                event["thread_id"] = thread_id
            yield _sse_payload(_record_stream_event(stream_state, event))

        mcp_server_map = ctx.get("mcp_server_map", {})

        # Bind uploaded files to the user message THIS request creates. Primary
        # mechanism: stamp a per-request correlation token into the Backboard
        # message metadata (see _open_backboard_stream), then match it back at
        # save time — deterministic, immune to the concurrent-reload race (#3).
        # Fallback (when Backboard doesn't round-trip metadata): snapshot the
        # thread's user-message ids BEFORE Backboard creates this request's user
        # message, and at save time pick the id that's *new* relative to the
        # snapshot. The token reuses this request's client-side user_message_id,
        # which is already unique per request.
        if ctx.get("message_files"):
            ctx["files_corr_token"] = user_message_id
        files_pre_user_ids = None
        if ctx.get("message_files") and not ctx.get("is_temporary"):
            try:
                _pre_msgs = run_async(
                    get_thread_messages(thread_id, ctx.get("bb_client"))
                )
                files_pre_user_ids = {
                    str(m.message_id) for m in _pre_msgs if m.role == "user"
                }
            except Exception:
                files_pre_user_ids = None

            # Persist the user's attachment as soon as Backboard creates this
            # turn's user message — NOT only at stream completion. Otherwise
            # navigating back into the chat before the response finishes loads
            # the conversation from the DB, where the attachment isn't saved
            # yet, so the prompt shows without its image. Runs off the request
            # thread and polls briefly for the just-created user message; the
            # completion block below is the authoritative final save.
            _early_files = ctx["message_files"]
            _early_bb = ctx.get("bb_client")
            _early_pre = files_pre_user_ids
            _early_token = user_message_id

            def _persist_files_early(
                files=_early_files, bb=_early_bb, pre=_early_pre, token=_early_token
            ):
                for _ in range(20):  # ~6s to cover Backboard create latency
                    if _resolve_and_save_message_files(
                        partition_id,
                        conversation_id,
                        thread_id,
                        bb,
                        files,
                        pre,
                        token,
                        require_new=True,
                    ):
                        return
                    time.sleep(0.3)

            threading.Thread(
                target=_persist_files_early,
                name=f"chat-files-{conversation_id}",
                daemon=True,
            ).start()

        logger.warning(
            "[chat] stream: opening Backboard stream (thread_id=%s, model=%r, memory=%s, web_search=%r, mcp_servers=%s)",
            thread_id,
            model,
            ctx["bb_memory"],
            ctx["requested_web_search"],
            list(mcp_server_map.keys()),
        )

        # All capabilities (web search, image generation, document export) are now
        # always-on and model-decided, so there is no pre-emptive status. The
        # "Searching the web…" / "Creating image…" / "Creating document…" line is
        # emitted REACTIVELY from the consume loop the moment the model actually
        # invokes a tool — so plain questions never show a spurious status.
        _tool_status_label = None

        if full_text:
            total_tokens = (len(ctx["model_text"]) + len(full_text)) // 4 + 1
        elif mcp_server_map:
            # MCP path: stream the turn with per-turn tools; when Backboard
            # pauses with tool_submit_required, execute the MCP tool(s) and
            # stream the continuation. Chained rounds re-pass the tools on the
            # per-run submit endpoint (the only one that retains them — see
            # the Backboard chat API).
            try:
                _mcp_result = {"full_text": "", "input_tokens": 0, "output_tokens": 0, "total_tokens": 0}
                _mcp_ids = {
                    "response_message_id": response_message_id,
                    "conversation_id": conversation_id,
                    "user_message_id": user_message_id,
                    "thread_id": thread_id,
                }
                _mcp_media = {
                    "dir_key": dir_key_for_uploads,
                    "partition_id": partition_id,
                    "media": generated_media,
                    "jobs": generated_media_jobs,
                }
                mcp_error = None
                for event in stream_mcp_turn(ctx, _mcp_ids, _mcp_result, _mcp_media):
                    yield _sse_payload(_record_stream_event(stream_state, event))
                input_tokens = _mcp_result["input_tokens"]
                output_tokens = _mcp_result["output_tokens"]
                total_tokens = _mcp_result["total_tokens"]
            except Exception as e:
                logger.exception(
                    "[chat] stream: MCP tool loop failed for conversation %s",
                    conversation_id,
                )
                mcp_error = e
            finally:
                # Harvest in `finally`: stream_mcp_turn can raise AFTER tools have
                # already run and streamed their chips (e.g. the continuation run
                # fails). Reading these only on the happy path dropped both the
                # partial answer and the chips from the finalized message — the
                # user would watch a chip appear, then see it vanish at stream end.
                executed_tool_calls = _mcp_result.get("tool_calls") or []
                full_text += _mcp_result["full_text"]
                if mcp_error is not None:
                    full_text += f"\n\n[Error: {mcp_error}]"
        else:

            def _consume(
                web_search_mode,
                model_override: str | None = None,
                image_generation: bool = False,
            ):
                nonlocal full_text, total_tokens, input_tokens, output_tokens, _tool_status_label
                stream_started = time.monotonic()
                chunk_count = 0
                created_exports: list[dict] = []
                # Reactive tool-status: emit "Searching the web…" / "Creating
                # image…" the moment the model actually invokes a tool (web
                # search + image gen are always-on and model-decided, so this is
                # the accurate signal). Emitted at most once per consume.
                _reactive_status = [False]

                def _reactive_tool_status_event(chunk: dict):
                    nonlocal _tool_status_label
                    if _reactive_status[0]:
                        return None
                    # No classification of which tool fired — the model decides
                    # whether and what to call, we just surface that something
                    # is running. Guessing the tool from names/keywords is the
                    # same regex-style inference this PR removes.
                    label = "Working…"
                    _reactive_status[0] = True
                    _tool_status_label = label
                    return {
                        "type": "tool_status",
                        "status": "active",
                        "label": label,
                        "messageId": response_message_id,
                        "conversationId": conversation_id,
                        "userMessageId": user_message_id,
                        "stream": True,
                    }

                def _stream_with_tools(initial_stream):
                    # Chain the Backboard stream(s): when the model requests the
                    # export tool via `tool_submit_required`, run it, submit the
                    # results, and keep streaming the continuation on the same
                    # thread (Backboard holds the conversation, so no history is
                    # replayed). The tool_submit_required event is swallowed here
                    # so the main loop only sees content/media/run_ended.
                    pending = [initial_stream]
                    while pending:
                        current = pending.pop(0)
                        for chunk in current:
                            if chunk.get("type") == "tool_submit_required":
                                tool_calls = chunk.get("tool_calls", []) or []
                                logger.warning(
                                    "[chat] stream: tool_submit_required (%d call(s))",
                                    len(tool_calls),
                                )
                                tool_outputs = _execute_export_tool_calls(
                                    tool_calls,
                                    created_exports,
                                    partition_id=partition_id,
                                    dir_key=dir_key_for_uploads,
                                )
                                pending.append(
                                    _open_tool_output_stream(ctx, tool_outputs)
                                )
                                break
                            yield chunk

                def _render_snapshot() -> dict:
                    # Runs at EMISSION time — reads the current full_text /
                    # persisted_fallback_prefix cells, so throttled emission
                    # always renders the latest accumulated answer. These
                    # sanitizer passes are full-text scans; running them per
                    # emission instead of per chunk is most of the throttle's
                    # CPU win.
                    rendered_text = (
                        persisted_fallback_prefix + full_text
                        if persisted_fallback_prefix
                        else full_text
                    )
                    rendered_text = scrub_uploaded_image_tool_payloads(rendered_text)
                    # Strip any Backboard S3 URL the model inlined in its
                    # markdown response — the bucket origin must never
                    # reach the client. ``safe_partial_text`` also holds
                    # back text that ends mid-URL so the partial form
                    # doesn't leak before the next chunk completes it.
                    rendered_text = sanitize_s3_image_urls(
                        rendered_text, dir_key_for_uploads,
                    )
                    rendered_text = sanitize_leaked_export_instructions(rendered_text)
                    rendered_text = safe_partial_text(rendered_text)
                    return {
                        "type": "text",
                        "text": {"value": rendered_text},
                        "index": 0,
                        "messageId": response_message_id,
                        "conversationId": conversation_id,
                        "userMessageId": user_message_id,
                        "thread_id": thread_id,
                        "stream": True,
                    }

                _throttle = _TextEventThrottle(_render_snapshot)

                stream_iter = (
                    _open_backboard_image_tool_stream
                    if ctx.get("image_tool_files")
                    else _open_backboard_stream
                )
                for chunk in _stream_with_tools(
                    stream_iter(
                        ctx,
                        web_search_mode,
                        model_override=model_override,
                        image_generation=image_generation,
                    )
                ):
                    if time.monotonic() - stream_started >= STREAM_TOTAL_TIMEOUT_SEC:
                        logger.warning(
                            "[chat] stream: total timeout after %ss",
                            STREAM_TOTAL_TIMEOUT_SEC,
                        )
                        # Pending text reaches the live view; the error text
                        # arrives via the final event, as before.
                        yield from _throttle.flush()
                        full_text += "\n\n[Error: response timed out]"
                        return
                    chunk_type = chunk.get("type", "")
                    if chunk_type == "content_streaming":
                        content = chunk.get("content", "")
                        full_text += content
                        # Kick off downloads for any inline S3 image the model
                        # emitted, so the rewritten Nash URL resolves. Uses the
                        # raw full_text (still holds the S3 URL); deduped inside.
                        # Stays per-chunk (not per-emission): download latency
                        # matters and the scan cursor handles resets.
                        _persist_inline_s3_images(full_text)
                        chunk_count += 1
                        if chunk_count <= 3:
                            logger.warning(
                                "[chat] stream: chunk %d len=%d",
                                chunk_count,
                                len(content),
                            )
                        yield from _throttle.note(len(content))
                    elif chunk_type == "media_generated":
                        yield from _throttle.flush()
                        # Backboard Image Tool emits one media_generated event per
                        # image. Multiple per turn are possible. We NEVER expose
                        # Backboard's presigned S3 URL to the client — instead
                        # the SSE event carries a stable Nash URL pointing at
                        # the /api/files/download route, and a background
                        # thread persists the bytes to that location. The
                        # download route briefly blocks if the file is still
                        # in flight, so the browser's <img> just waits.
                        media = chunk.get("media") or {}
                        media_url = media.get("url") or ""
                        document_id = str(media.get("document_id") or "")
                        if not media_url or not document_id or not dir_key_for_uploads:
                            continue
                        # Drop a duplicate emission of the same image (same byte
                        # size this turn) so it isn't rendered/persisted twice.
                        size_bytes = media.get("file_size_bytes")
                        try:
                            size_bytes = int(size_bytes) if size_bytes else 0
                        except (TypeError, ValueError):
                            size_bytes = 0
                        if size_bytes and size_bytes in seen_media_sizes:
                            logger.warning(
                                "[chat] stream: duplicate media_generated "
                                "(size=%d, documentId=%s) — skipping second render",
                                size_bytes, document_id,
                            )
                            continue
                        if size_bytes:
                            seen_media_sizes.add(size_bytes)
                        mime_type = media.get("mime_type") or "image/jpeg"
                        local_url = predictable_generated_image_url(dir_key_for_uploads, document_id)
                        media_entry = {
                            "documentId": document_id,
                            "mimeType": mime_type,
                            "url": local_url,
                            "fileSizeBytes": media.get("file_size_bytes"),
                        }
                        pending_evt = register_pending_image(
                            generated_image_file_id(document_id)
                        )
                        t = threading.Thread(
                            target=_persist_generated_image_async,
                            args=(
                                media_url, document_id, mime_type,
                                partition_id, dir_key_for_uploads, pending_evt,
                            ),
                            daemon=True,
                        )
                        t.start()
                        generated_media_jobs.append(t)
                        image_generated_this_turn[0] = True
                        if document_id not in generated_image_doc_ids:
                            generated_image_doc_ids.append(document_id)
                        logger.warning(
                            "[chat] stream: media_generated documentId=%s mimeType=%s",
                            document_id, mime_type,
                        )
                        # Inline the image into the reply TEXT (markdown) rather
                        # than relying on the standalone "image" SSE event. That
                        # event is dropped by the client when it arrives before any
                        # text has created the assistant message — which is exactly
                        # what happens for image turns (media_generated fires first,
                        # then the caption). The message-text path always renders,
                        # and the inline markdown survives reload via the saved
                        # message text. Bytes are downloading in the background;
                        # /api/files/download blocks briefly until they land.
                        marker = f"![Generated image]({local_url})"
                        if marker not in full_text:
                            full_text = (
                                f"{full_text.rstrip()}\n\n{marker}\n\n"
                                if full_text.strip()
                                else f"{marker}\n\n"
                            )
                        rendered_text = (
                            persisted_fallback_prefix + full_text
                            if persisted_fallback_prefix
                            else full_text
                        )
                        yield {
                            "type": "text",
                            "text": {"value": rendered_text},
                            "index": 0,
                            "messageId": response_message_id,
                            "conversationId": conversation_id,
                            "userMessageId": user_message_id,
                            "thread_id": thread_id,
                            "stream": True,
                        }
                    elif chunk_type in ("tool_call_ready", "tool_calls"):
                        yield from _throttle.flush()
                        # Model self-invoked a tool — show a reactive status line.
                        _ev = _reactive_tool_status_event(chunk)
                        if _ev is not None:
                            yield _ev
                    elif chunk_type in ("run_ended", "run_completed"):
                        yield from _throttle.flush()
                        input_tokens = int(chunk.get("input_tokens", 0) or 0)
                        output_tokens = int(chunk.get("output_tokens", 0) or 0)
                        total_tokens = int(chunk.get("total_tokens", 0) or 0)
                        logger.warning(
                            "[chat] stream: %s, input_tokens=%d, output_tokens=%d, total_tokens=%d",
                            chunk_type,
                            input_tokens,
                            output_tokens,
                            total_tokens,
                        )
                        if created_exports:
                            # Replace any download link the model wrote with the
                            # authoritative Nash URL(s) for the files we created.
                            full_text = _merge_export_links(full_text, created_exports)
                            rendered_text = (
                                persisted_fallback_prefix + full_text
                                if persisted_fallback_prefix
                                else full_text
                            )
                            rendered_text = sanitize_s3_image_urls(
                                rendered_text, dir_key_for_uploads,
                            )
                            rendered_text = sanitize_leaked_export_instructions(
                                rendered_text
                            )
                            yield {
                                "type": "text",
                                "text": {"value": rendered_text},
                                "index": 0,
                                "messageId": response_message_id,
                                "conversationId": conversation_id,
                                "userMessageId": user_message_id,
                                "thread_id": thread_id,
                                "stream": True,
                            }
                        return
                    elif chunk_type in ("error", "run_failed"):
                        # Flush before raising so the partial tail was emitted
                        # before the exception reaches the retry orchestration
                        # (the fallback path resets full_text; a fresh throttle
                        # is created on the retry's _consume call).
                        yield from _throttle.flush()
                        error_msg = chunk.get("error") or chunk.get(
                            "message", "Unknown error"
                        )
                        raise BackboardAPIError(error_msg)
                # Stream exhausted without a run_ended chunk.
                yield from _throttle.flush()

            try:
                try:
                    # Image turns run on the user's SELECTED model — with ONE
                    # exception: when the live catalog says the selected model
                    # cannot call tools at all (supports_tools=False, e.g.
                    # Bedrock-hosted Claude), the image tool can never fire, so
                    # the turn is orchestrated on the fallback model up front
                    # with an honest notice (ctx["image_orchestrator_override"],
                    # computed in _prepare_stream; None for capable/unknown
                    # models and when fallback is opted out). Backboard's image
                    # tool separates the conversation model from the image
                    # model: image_model_provider/name runs the actual
                    # generation either way.
                    # media_generated / inline-S3 handlers persist + render it.
                    if ctx.get("requested_image_generation"):
                        preemptive_override = ctx.get("image_orchestrator_override")
                    if preemptive_override:
                        persisted_fallback_prefix = (
                            f"*{_friendly_model_name(ctx['model'])} can't run image "
                            f"tools, so I used "
                            f"{_friendly_model_name(preemptive_override)} for this "
                            f"image.*\n\n"
                        )
                    for event in _consume(
                        ctx["requested_web_search"],
                        model_override=preemptive_override,
                        image_generation=ctx.get("requested_image_generation", False),
                    ):
                        yield _sse_payload(_record_stream_event(stream_state, event))
                    if preemptive_override:
                        model = preemptive_override
                        endpoint = _resolve_endpoint_for_model(
                            preemptive_override, endpoint
                        )
                        ctx["model"] = preemptive_override
                        ctx["endpoint"] = endpoint
                except BackboardAPIError as e:
                    # Keyed on deterministic image CONTEXT, not the always-on
                    # tool flag: the tool is attached on every turn, so an
                    # ordinary question failing with a transient error must not
                    # claim "couldn't run this image request" (nor skip the
                    # web-search retry below). Only turns that actually carry an
                    # uploaded or previously generated image take the image path.
                    if _is_credit_block_error(str(e)):
                        # Out of credits: Backboard's message says exactly what
                        # to do (Billing page / auto-reload). Show it verbatim
                        # and do NOT retry — the fallback model hits the same
                        # wallet, so every retry is a doomed extra request.
                        logger.warning(
                            "[chat] stream: credit block for conversation %s: %s",
                            conversation_id, e,
                        )
                        full_text = str(e)
                        yield _sse_payload(_record_stream_event(stream_state, {
                            "type": "text",
                            "text": {"value": full_text},
                            "index": 0,
                            "messageId": response_message_id,
                            "conversationId": conversation_id,
                            "userMessageId": user_message_id,
                            "thread_id": thread_id,
                            "stream": True,
                            # Machine flag so the client can pop the "Upgrade plan"
                            # modal (in addition to the verbatim inline copy).
                            "creditBlock": True,
                        }))
                    elif ctx.get("image_context_this_turn"):
                        # The image turn ran on the user's SELECTED model, which
                        # may be unable to run it (no tool support, or a model id
                        # Backboard rejects). The user asked for an IMAGE, so the
                        # first retry keeps the image tool on and swaps only the
                        # orchestrating chat model to the fallback — with an
                        # honest notice. Only if that also fails do we retry
                        # text-only, then give up with an honest message.
                        logger.warning(
                            "[chat] stream: IMAGE turn failed (model=%r, files=%d): %s",
                            model, len(ctx.get("message_files") or []), e,
                        )

                        def _discard_failed_attempt_media() -> None:
                            # A failed attempt may already have emitted
                            # media_generated: drop its doc ids / dedup sizes so
                            # persistence reflects only the attempt whose output
                            # was kept, and an identical retry image isn't
                            # swallowed by the size dedup. (Persist threads for
                            # the discarded docs are harmless orphans.)
                            generated_image_doc_ids.clear()
                            seen_media_sizes.clear()
                            image_generated_this_turn[0] = False

                        # Honor the per-request fallback opt-out
                        # (ephemeralAgent.fallback_model=False → None): never
                        # swap models the user pinned.
                        override = (
                            ctx.get("fallback_model")
                            if ctx.get("fallback_model")
                            and ctx["fallback_model"] != ctx["model"]
                            else None
                        )
                        image_retry_ok = False
                        if override:
                            full_text = ""
                            _discard_failed_attempt_media()
                            original_model = ctx["model"]
                            persisted_fallback_prefix = (
                                f"*{_friendly_model_name(original_model)} couldn't run "
                                f"this image request, so I used "
                                f"{_friendly_model_name(override)} instead.*\n\n"
                            )
                            try:
                                for event in _consume(
                                    ctx["requested_web_search"],
                                    model_override=override,
                                    image_generation=True,
                                ):
                                    yield _sse_payload(
                                        _record_stream_event(stream_state, event)
                                    )
                                image_retry_ok = True
                                model = override
                                endpoint = _resolve_endpoint_for_model(
                                    override, endpoint
                                )
                                ctx["model"] = override
                                ctx["endpoint"] = endpoint
                                fallback_succeeded = True
                            except Exception:
                                logger.exception(
                                    "[chat] stream: image retry on fallback model failed"
                                )
                                persisted_fallback_prefix = ""
                        if not image_retry_ok:
                            full_text = ""
                            _discard_failed_attempt_media()
                            try:
                                for event in _consume(None, model_override=override):
                                    yield _sse_payload(
                                        _record_stream_event(stream_state, event)
                                    )
                                if not full_text.strip():
                                    full_text = (
                                        "I couldn't generate that image just now. "
                                        "Please try again."
                                    )
                            except Exception:
                                logger.exception(
                                    "[chat] stream: image turn text-only retry failed"
                                )
                                full_text = (
                                    "I couldn't generate that image just now. "
                                    "Please try again."
                                )
                    elif (
                        ctx["requested_web_search"]
                        and not full_text
                        and _is_tool_use_error(str(e))
                    ):
                        logger.warning(
                            "[chat] stream: retrying without web_search (model=%r)",
                            model,
                        )
                        for event in _consume(None):
                            yield _sse_payload(_record_stream_event(stream_state, event))
                    elif (
                        ctx.get("fallback_model")
                        and ctx["model"] != ctx["fallback_model"]
                    ):
                        # Primary model failed — attempt tier-appropriate fallback.
                        original_model = ctx["model"]
                        chosen_fallback: str = ctx["fallback_model"]
                        logger.warning(
                            "[chat] stream: primary model %r failed (%s), falling back to %s",
                            original_model,
                            e,
                            chosen_fallback,
                        )
                        fallback_prefix = (
                            f"*{_friendly_model_name(original_model)} wasn't available, "
                            f"so I used {_friendly_model_name(chosen_fallback)} instead.*\n\n"
                        )
                        persisted_fallback_prefix = fallback_prefix
                        full_text = ""
                        try:
                            for event in _consume(
                                None,
                                model_override=chosen_fallback,
                            ):
                                # Prepend the notice to every streamed chunk so the UI
                                # always shows the full text including the header.
                                event_with_prefix = dict(event)
                                event_with_prefix["text"] = {
                                    "value": sanitize_leaked_export_instructions(
                                        fallback_prefix + full_text
                                    )
                                }
                                yield _sse_payload(
                                    _record_stream_event(stream_state, event_with_prefix)
                                )
                            # full_text stays WITHOUT the notice — final_text (and
                            # every rendered chunk above) prepends
                            # persisted_fallback_prefix exactly once; prepending it
                            # here too doubled the notice in the final/persisted text.
                            model = chosen_fallback
                            endpoint = _resolve_endpoint_for_model(
                                chosen_fallback, endpoint
                            )
                            ctx["model"] = chosen_fallback
                            ctx["endpoint"] = endpoint
                            fallback_succeeded = True
                        except Exception:
                            logger.exception(
                                "[chat] stream: fallback model %s also failed for conversation %s",
                                chosen_fallback,
                                conversation_id,
                            )
                            # The notice would claim the fallback was used right
                            # above a sentence saying it failed — drop it.
                            persisted_fallback_prefix = ""
                            full_text = "I ran into an error generating a response and the fallback model also failed. Please try again."
                    else:
                        logger.warning(
                            "[chat] stream: Backboard API error (fallback model)=%s", e
                        )
                        full_text = "I ran into an error generating a response. Please try again."
            except Exception as e:
                if isinstance(e, (TimeoutError, asyncio.TimeoutError)):
                    logger.warning(
                        "[chat] stream: idle timeout after %ss for conversation %s",
                        STREAM_IDLE_TIMEOUT_SEC,
                        conversation_id,
                    )
                    full_text += (
                        "\n\nThe response stream timed out before finishing. Please try again."
                    )
                else:
                    logger.exception(
                        "[chat] stream: failed for conversation %s", conversation_id
                    )
                    full_text += "\n\nI ran into an unexpected error. Please try again."

        # Clear the tool-status line once the turn is done (safety net — the
        # frontend also hides it as soon as reply text appears).
        if _tool_status_label:
            yield _sse_payload({
                "type": "tool_status",
                "status": "done",
                "label": _tool_status_label,
                "messageId": response_message_id,
                "conversationId": conversation_id,
                "userMessageId": user_message_id,
                "stream": True,
            })

        # generated_media_jobs continue downloading in the background. URLs
        # already point at the local /api/files/download endpoint, so no
        # post-stream swap is needed. The endpoint blocks briefly on the
        # pending event when the browser fetches before the bytes land.

        if total_tokens == 0:
            total_tokens = (len(ctx["user_text"]) + len(full_text)) // 4 + 1
            if input_tokens == 0 and output_tokens == 0:
                input_tokens = max(1, len(ctx["user_text"]) // 4)
                output_tokens = max(1, total_tokens - input_tokens)

        if total_tokens > 0:
            record_token_usage(
                user_id,
                total_tokens,
                model,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
            )
            # The wallet just changed: drop the cached balance for the key
            # that paid (org key for org chats) so the client's SSE-final
            # refetch reads the post-spend value, not a <=60s-old snapshot.
            invalidate_balance_cache(ctx.get("bb_api_key") or "")
            try:
                record_generation_analytics(
                    user_id=user_id,
                    model_name=model,
                    input_tokens=input_tokens,
                    output_tokens=output_tokens,
                    total_tokens=total_tokens,
                )
            except Exception:
                logger.exception("[chat] stream: failed to record analytics")

        # Safety net: persist any inline S3 image that only fully materialized in
        # the final buffer (e.g. the fully-buffered tool-loop branch never hits
        # the per-chunk handler above).
        _persist_inline_s3_images(full_text)
        final_text = (
            persisted_fallback_prefix + full_text
            if persisted_fallback_prefix
            else full_text
        )
        final_text = scrub_uploaded_image_tool_payloads(final_text, complete_text=True)
        # Last-line defense: if any S3 URL slipped past the chunk-level
        # sanitize (e.g. fully-buffered tool-loop branch), rewrite here too.
        final_text = sanitize_s3_image_urls(final_text, dir_key_for_uploads)
        final_text = sanitize_leaked_export_instructions(final_text)

        response_content_parts = [
            *_tool_chip_parts(executed_tool_calls),
            {"type": "text", "text": {"value": final_text}},
        ]

        # Multi-conversation: join the added model's turn (started concurrently
        # near the top of this generator, so most of its work usually overlaps
        # the primary's own streaming time — this is the RESIDUAL wait, not
        # its total budget).
        #
        # This join necessarily delays this generator's `final` SSE event,
        # which is the client's only signal to re-enable the composer and
        # hide the stop button — so a slow added model measurably delays
        # those, even though the primary's own text is already fully visible
        # (it streamed via ordinary text-delta chunks before this point).
        # Fully decoupling this would mean delivering the added model's
        # answer to the client through some OTHER channel once this stream
        # has already closed — there's no polling/push mechanism for that
        # today, and building one is a bigger, riskier change than bounding
        # the wait here. 25s (short relative to the 60s+ this used to allow)
        # is the deliberate compromise: generous enough that most real
        # completions land inside it (most of their own work already
        # overlapped the primary's streaming time), short enough that the
        # "generating…" state left over on the primary's own UI doesn't
        # linger long. See
        # "Known trade-offs" section.
        # abort_chat() (see its route below) sets stream_state["done"] on the
        # SAME dict object generate() closes over — visible here without any
        # extra plumbing. It doesn't (and can't cheaply) interrupt the 25s
        # wait already in flight below, but it's the cue not to compound an
        # aborted turn by persisting its added-model half durably once that
        # wait finishes.
        added_was_aborted = added_future is not None and bool(stream_state.get("done"))

        if added_future is not None and not added_was_aborted:
            added_error_reason = None
            added_result = None
            try:
                added_result = added_future.result(timeout=25)
                added_text = (added_result or {}).get("text") or ""
                added_error_reason = (added_result or {}).get("error")
            except Exception:
                logger.exception(
                    "[chat] added-model turn did not complete for conversation %s",
                    conversation_id,
                )
                added_text = ""
                added_error_reason = "timeout"

            # Make a failure visually distinguishable from a real answer —
            # there's no per-content-part error convention on the frontend
            # today (TMessage.error is message-level, and this is one column
            # of a message whose other column succeeded), so the clearest
            # low-risk signal is the text itself, phrased distinctly per
            # cause rather than one generic apology for every failure mode.
            added_ok = bool(added_text) and added_error_reason is None
            if not added_ok:
                if added_error_reason == "requires_action":
                    added_text = (
                        "⚠️ _This model tried to use a tool (e.g. memory or an "
                        "MCP server), which isn't supported for the added model "
                        "yet. Try a model/assistant without tools enabled._"
                    )
                elif added_error_reason == "timeout":
                    added_text = "⚠️ _This model took too long to respond. Please try again._"
                else:
                    added_text = "⚠️ _This model didn't respond. Please try again._"

            # Re-check "done" — the 25s wait above is exactly the window an
            # abort is most likely to land in. No point pushing a chunk into
            # (or durably persisting the result of) a turn the user already
            # cancelled.
            if stream_state.get("done"):
                added_was_aborted = True

            if not added_was_aborted:
                response_content_parts = [
                    {
                        "type": "text",
                        "text": {"value": final_text},
                        "agentId": primary_agent_id,
                        "groupId": 1,
                    },
                    {
                        "type": "text",
                        "text": {"value": added_text},
                        "agentId": added_agent_id,
                        "groupId": 1,
                    },
                ]

                yield _sse_payload(
                    _record_stream_event(
                        stream_state,
                        {
                            "type": "text",
                            "text": {"value": added_text},
                            "index": 1,
                            "messageId": response_message_id,
                            "conversationId": conversation_id,
                            "userMessageId": user_message_id,
                            "thread_id": thread_id,
                            "agentId": added_agent_id,
                            "groupId": 1,
                            "stream": False,
                        },
                    )
                )

                # save_added_response MUST be keyed by the real Backboard
                # message_id of the primary's just-saved assistant turn —
                # that's the id messages.py/share.py look it up by later
                # (they key off get_thread_messages(...) results, which are
                # Backboard-native ids). response_message_id is a
                # Nash-generated uuid4 minted before the Backboard call even
                # happened (used only for the live SSE protocol) and never
                # reconciled with the real id anywhere — keying the save by
                # it would silently never be found again on refresh. Mirrors
                # the same re-fetch-after-the-fact pattern
                # is_regenerate/fallback_succeeded already use below.
                if not ctx.get("is_temporary"):
                    _resolve_and_persist_added_response(
                        partition_id=partition_id,
                        conversation_id=conversation_id,
                        thread_id=thread_id,
                        bb=ctx.get("bb_client"),
                        baseline_last_message_id=(added_result or {}).get("baseline_last_message_id"),
                        added_was_aborted=added_was_aborted,
                        stream_state=stream_state,
                        added_text=added_text,
                        added_convo_model=added_convo.get("model") or "",
                        added_agent_id=added_agent_id,
                        added_ok=added_ok,
                    )

        response_message = {
            "messageId": response_message_id,
            "conversationId": conversation_id,
            "parentMessageId": (override_parent_message_id or parent_message_id)
            if is_regenerate
            else user_message_id,
            "text": final_text,
            "sender": "Nash",
            "isCreatedByUser": False,
            "model": model,
            "endpoint": endpoint,
            "createdAt": now,
            "error": False,
            "unfinished": False,
            "content": response_content_parts,
            # Generated images (Backboard Image Tool). Empty for non-image turns.
            "generatedMedia": generated_media,
        }

        final_event = {
            "final": True,
            "requestMessage": user_message,
            "responseMessage": response_message,
            "conversation": {
                "conversationId": conversation_id,
                "title": None,
                "endpoint": endpoint,
                "model": model,
                "createdAt": now,
                "updatedAt": now,
            },
        }

        if not ctx.get("is_temporary"):
            _save_long_message_display_text(
                partition_id=partition_id,
                conversation_id=conversation_id,
                thread_id=thread_id,
                ctx=ctx,
            )

        title = final_text[:60].replace("\n", " ").strip()
        if not title:
            title = "New Chat"
        elif len(final_text) > 60:
            title += "..."

        existing_meta = run_async(
            _get_conversation_meta(partition_id, conversation_id)
        )
        existing_title = existing_meta.get("title", "")
        should_set_title = not existing_title or existing_title == "New Chat"

        if is_regenerate and not ctx.get("is_temporary"):
            try:
                bb_msgs = run_async(get_thread_messages(thread_id, ctx.get("bb_client")))
                visible_msgs = [m for m in bb_msgs if is_user_visible_message(m)]
                # Thread ends with: [..., aN_prev, uN_regen, aN_regen], where aN_prev
                # is the response actually being regenerated — the ORIGINAL response
                # the first time, or itself a prior regeneration on the 2nd+ retry.
                # We want aN_regen to end up sharing the same TRUE original user
                # message as aN_prev, and uN_regen to be skipped.
                if (
                    len(visible_msgs) >= 4
                    and role_name(visible_msgs[-1]) == "assistant"
                    and role_name(visible_msgs[-2]) == "user"
                ):
                    regen_ai_id = visible_msgs[-1].message_id
                    regen_user_id = visible_msgs[-2].message_id
                    prev_ai_id = visible_msgs[-3].message_id
                    existing_graph = get_regen_graph(partition_id, conversation_id)
                    original_user_id = _resolve_regen_original_user_id(
                        prev_ai_id, visible_msgs[-4].message_id, existing_graph
                    )
                    save_regen_graph(
                        partition_id,
                        conversation_id,
                        {
                            regen_ai_id: original_user_id,
                            regen_user_id: "SKIP",
                        },
                    )
                    logger.warning(
                        "[chat] regen_graph saved regen_ai=%s -> original_user=%s",
                        regen_ai_id,
                        original_user_id,
                    )
            except Exception:
                logger.exception("[chat] stream: failed to save regen graph")
        elif fallback_succeeded and not ctx.get("is_temporary"):
            try:
                bb_msgs = run_async(get_thread_messages(thread_id, ctx.get("bb_client")))
                visible_msgs = [m for m in bb_msgs if is_user_visible_message(m)]
                # Fallback retry appends a second user/assistant pair to the same thread:
                # [..., user_primary, assistant_error, user_fallback, assistant_fallback]
                # Hide the failed attempt and duplicate retry user on reload, and attach the
                # successful fallback assistant to the original user message.
                if (
                    len(visible_msgs) >= 4
                    and role_name(visible_msgs[-1]) == "assistant"
                    and role_name(visible_msgs[-2]) == "user"
                    and role_name(visible_msgs[-3]) == "assistant"
                    and role_name(visible_msgs[-4]) == "user"
                ):
                    fallback_ai_id = visible_msgs[-1].message_id
                    fallback_user_id = visible_msgs[-2].message_id
                    failed_ai_id = visible_msgs[-3].message_id
                    original_user_id = visible_msgs[-4].message_id
                    save_regen_graph(
                        partition_id,
                        conversation_id,
                        {
                            fallback_ai_id: original_user_id,
                            fallback_user_id: "SKIP",
                            failed_ai_id: "SKIP",
                        },
                    )
                    save_fallback_notice(
                        partition_id,
                        conversation_id,
                        {
                            str(fallback_ai_id): persisted_fallback_prefix,
                        },
                    )
                    logger.warning(
                        "[chat] fallback_graph saved fallback_ai=%s -> original_user=%s, skipped failed_ai=%s and retry_user=%s",
                        fallback_ai_id,
                        original_user_id,
                        failed_ai_id,
                        fallback_user_id,
                    )
            except Exception:
                logger.exception("[chat] stream: failed to save fallback graph")
        elif (
            preemptive_override
            and persisted_fallback_prefix
            and not ctx.get("is_temporary")
        ):
            # Preemptive image-orchestrator swap: a SINGLE send (no failed
            # attempt to hide), but the notice must survive reload — key it to
            # the assistant message Backboard just stored.
            try:
                bb_msgs = run_async(get_thread_messages(thread_id, ctx.get("bb_client")))
                visible_msgs = [m for m in bb_msgs if is_user_visible_message(m)]
                if visible_msgs and role_name(visible_msgs[-1]) == "assistant":
                    save_fallback_notice(
                        partition_id,
                        conversation_id,
                        {str(visible_msgs[-1].message_id): persisted_fallback_prefix},
                    )
            except Exception:
                logger.exception("[chat] stream: failed to save preemptive image notice")

        if not ctx.get("is_temporary"):
            try:
                meta = {"endpoint": endpoint, "model": model}
                if should_set_title:
                    meta["title"] = title
                if ctx.get("folder_id"):
                    meta["folderId"] = ctx["folder_id"]
                if image_generated_this_turn[0]:
                    # Mark the conversation so follow-ups ("change the eyes", "another
                    # one", "make it bigger") are recognized as image/edit turns even
                    # when the wording doesn't match the image-intent heuristics.
                    meta["imageGenerated"] = True
                run_async(
                    _save_conversation_meta(partition_id, conversation_id, meta)
                )
            except Exception:
                logger.exception("[chat] stream: failed to save conversation meta")

        # Persist generated images per assistant message so they re-render on
        # reload. They arrive as out-of-band media_generated events and are only
        # inlined into the STREAMED text — Backboard's stored message never carries
        # them, so without this a refresh loses the image. Keyed by the latest
        # visible assistant message id (the answer this run produced). Temporary
        # chats persist nothing.
        if generated_image_doc_ids and not ctx.get("is_temporary"):
            try:
                _gm_msgs = run_async(
                    get_thread_messages(thread_id, ctx.get("bb_client"))
                )
                _gm_visible = [m for m in _gm_msgs if is_user_visible_message(m)]
                if _gm_visible and role_name(_gm_visible[-1]) == "assistant":
                    save_generated_media(
                        partition_id,
                        conversation_id,
                        {str(_gm_visible[-1].message_id): generated_image_doc_ids},
                    )
                    logger.info(
                        "[chat] stream: saved %d generated image(s) for reload, "
                        "assistant_msg=%s",
                        len(generated_image_doc_ids),
                        _gm_visible[-1].message_id,
                    )
            except Exception:
                logger.exception(
                    "[chat] stream: failed to persist generated media for reload"
                )

        if ctx.get("message_files") and not ctx.get("is_temporary"):
            # Authoritative final save — the early poll above usually persisted
            # these already, but this guarantees it (idempotent) and accepts the
            # last-user fallback now that the turn is definitely complete.
            saved = _resolve_and_save_message_files(
                partition_id,
                conversation_id,
                thread_id,
                ctx.get("bb_client"),
                ctx["message_files"],
                files_pre_user_ids,
                user_message_id,
                require_new=False,
            )
            if not saved:
                logger.warning(
                    "[chat] no persisted user message found — message files NOT saved for convo %s",
                    conversation_id,
                )

        _record_stream_event(stream_state, final_event)
        _log_stream_event(
            stream_id,
            "stream_complete",
            totalTokens=total_tokens,
            responseLength=len(full_text),
        )

        yield _sse_payload(final_event)

    # Run generation on a background producer thread so it completes — and
    # persists the conversation + generated image — even if the client
    # disconnects (e.g. a refresh mid-image-generation). generate() records
    # every event into stream_state and does no Flask request/app-context work,
    # so it is safe off the request thread; run_async submits its coroutines to
    # a shared persistent loop. The HTTP response is a pure replay of the
    # buffered events, so a dropped client no longer aborts the pipeline —
    # the thread and its image are saved regardless of the user leaving.
    def _run_generation():
        try:
            for _ in _with_stream_cleanup(stream_id, stream_state, generate()):
                pass
        except Exception:
            logger.exception("[chat] background generation failed stream_id=%s", stream_id)
            stream_state["done"] = True
            stream_state["generating"] = False

    threading.Thread(
        target=_run_generation, name=f"chat-gen-{stream_id}", daemon=True
    ).start()

    return Response(
        _replay_running_stream(stream_id, stream_state, is_resume=False, start_index=0),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@chat_bp.route("/api/agents/chat/active", methods=["GET"])
@require_auth
def active_jobs():
    _evict_stale_chat_streams()
    # Strictly the CALLER's streams. The old fallback clause matched any
    # stream that merely HAD a session key, which enumerated every user's
    # live streams to anyone logged in via session auth.
    active_ids = [
        sid
        for sid, s in _streams.items()
        if _stream_owned_by_caller(s) and not s.get("done") and s.get("generating")
    ]
    logger.warning("[chat] active_jobs active_ids=%s", active_ids)
    return jsonify({"activeJobIds": active_ids})


@chat_bp.route("/api/agents/chat/status/<conversation_id>", methods=["GET"])
@require_auth
def chat_status(conversation_id):
    _evict_stale_chat_streams()
    for sid, s in _streams.items():
        if (
            s.get("conversationId") == conversation_id
            and not s.get("done")
            and _stream_owned_by_caller(s)
        ):
            _log_stream_event(
                sid, "status_active_hit", requestedConversationId=conversation_id
            )
            return jsonify(
                {
                    "active": True,
                    "streamId": sid,
                    "status": "running" if s.get("generating") else "started",
                    "aggregatedContent": s.get("aggregatedContent"),
                    "resumeState": _stream_resume_state(s),
                    # Lets a resuming client keep temp semantics (no sidebar
                    # insert, no title generation) — the flag lives nowhere
                    # else server-side, by design.
                    "isTemporary": bool((s.get("payload") or {}).get("isTemporary")),
                }
            )
    logger.warning("[chat] status_inactive requestedConversationId=%s", conversation_id)
    return jsonify({"active": False})


@chat_bp.route("/api/agents/chat/abort", methods=["POST"])
@require_auth
def abort_chat():
    data = request.get_json() or {}
    stream_id = data.get("streamId")
    conversation_id = data.get("conversationId")
    if not stream_id and conversation_id:
        stream_id = next(
            (
                sid
                for sid, state in _streams.items()
                if state.get("conversationId") == conversation_id
                and not state.get("done")
                and _stream_owned_by_caller(state)
            ),
            None,
        )
    if stream_id and stream_id in _streams:
        stream_state = _streams[stream_id]
        # Only the stream's owner may abort it (404, not 403 — a stream id
        # must not be probeable).
        if not _stream_owned_by_caller(stream_state):
            return jsonify({"success": False, "error": "Stream not found"}), 404
        stream_state["done"] = True
        # Record the aborted final event so a reconnecting client can replay it
        # (resumable SSE). Keep the stream in _streams — the TTL GC
        # (CHAT_STREAM_TTL_SEC) reaps it; popping here would break resume.
        _record_stream_event(stream_state, {"final": True, "completed": True, "aborted": True})
        stream_state["generating"] = False
        _log_stream_event(stream_id, "abort_marked_done")
        return jsonify({"success": True, "aborted": stream_id})
    return jsonify({"success": False, "error": "Stream not found"}), 404


@chat_bp.route("/api/agents/tools/calls", methods=["GET"])
@require_auth
def tool_calls():
    return jsonify([])
