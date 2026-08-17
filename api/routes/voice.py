"""Voice routes.

Phase 1: ``POST /api/voice/transcribe`` — one-shot STT, returns text.

Phase 2: ``POST /api/voice/converse`` + ``GET /api/voice/converse/stream/<id>``
— full voice conversation. The POST accepts the recorded audio + voice
config, hands a stream id back to the client; the GET streams the SSE flow
(stt → content → tts) Backboard returns, with the same no-S3-leak guarantees
we apply to image generation.

"""
from __future__ import annotations
import json
import logging
import os
import re
import shutil
import threading
import time
import urllib.request
import uuid
from typing import Any, AsyncIterator

from flask import Blueprint, Response, g, jsonify, request

from api.config import settings
from api.middleware.session_auth import require_auth
from api.services import context_service, state_service
from api.services.async_runner import iter_async, run_async
from api.services.backboard_service import (
    get_request_assistant_id,
    get_request_client,
    get_request_state_partition,
    stream_message_proxy_compatible,
    stream_tts_narration,
)

voice_bp = Blueprint("voice", __name__)
logger = logging.getLogger(__name__)


# Known batch STT providers/models Backboard exposes (GET /models?model_type=stt).
# ElevenLabs scribe annotates non-speech audio (coughing, music, background
# noise) in its transcript; OpenAI stays the default. The realtime-only
# "scribe_v2_realtime" is intentionally absent — batch dictation/converse use
# the batch scribe models; the realtime variant belongs to the WS path.
STT_MODELS: dict[str, set[str]] = {
    "openai": {
        "gpt-4o-mini-transcribe",
        "gpt-4o-transcribe",
        "gpt-4o-transcribe-diarize",
        "whisper-1",
    },
    "elevenlabs": {"scribe_v1", "scribe_v2"},
}
# Model to use when a request names a provider but no (valid) model.
STT_DEFAULT_MODEL: dict[str, str] = {
    "openai": "gpt-4o-mini-transcribe",
    "elevenlabs": "scribe_v2",
}


def _resolve_stt_config(req_provider: str | None, req_model: str | None) -> tuple[str, str]:
    """Resolve the STT (provider, model) pair for a request.

    Honors an optional per-request override — the preferences selector sends
    ``stt_provider`` / ``stt_model`` form fields — validating both against the
    allow-list so an unknown or malformed value can never reach Backboard.
    Any missing/invalid field falls back to the deploy defaults
    (``settings.voice_stt_provider`` / ``voice_stt_model``). A deploy that
    points at a provider we don't allow-list (e.g. speechmatics) passes
    through untouched, so env overrides keep working.
    """
    provider = (req_provider or "").strip().lower()
    if provider not in STT_MODELS:
        provider = settings.voice_stt_provider
    allowed = STT_MODELS.get(provider, set())

    model = (req_model or "").strip()
    if model not in allowed:
        if provider == settings.voice_stt_provider and settings.voice_stt_model in allowed:
            model = settings.voice_stt_model
        else:
            model = STT_DEFAULT_MODEL.get(provider, settings.voice_stt_model)

    return provider, model


# ---------------------------------------------------------------------------
# Phase 1 — one-shot dictation
# ---------------------------------------------------------------------------


@voice_bp.route("/api/voice/transcribe", methods=["POST"])
@require_auth
def transcribe():
    """Transcribe an uploaded audio file via Backboard's STT pipeline.

    Multipart form:
      - ``audio_file``: required, the recorded audio (webm/opus default).
      - ``language``: optional ISO-639-1; defaults to settings.
      - ``stt_provider`` / ``stt_model``: optional STT override (``openai`` or
        ``elevenlabs``); validated against the allow-list, falls back to the
        deploy default.

    Returns ``{"text": "..."}``.
    """
    if "audio_file" not in request.files:
        return jsonify({"error": "missing audio_file"}), 400

    audio = request.files["audio_file"]
    if not audio or not audio.filename:
        return jsonify({"error": "empty audio_file"}), 400

    language = (request.form.get("language") or settings.voice_default_language).strip()
    stt_provider, stt_model = _resolve_stt_config(
        request.form.get("stt_provider"), request.form.get("stt_model")
    )
    voice_cfg = {
        "stt": {
            "provider": stt_provider,
            "model": stt_model,
            "language": language,
        }
    }

    bb = get_request_client()
    assistant_id = get_request_assistant_id()
    audio_bytes = audio.read(MAX_AUDIO_BYTES + 1)
    if len(audio_bytes) > MAX_AUDIO_BYTES:
        return jsonify({"error": "audio_file too large"}), 413
    audio_name = audio.filename or "audio.webm"
    audio_type = audio.mimetype or "audio/webm"

    async def _do_transcribe() -> dict:
        thread = await bb.create_thread(assistant_id=assistant_id)
        try:
            response = await bb._make_request(
                "POST",
                "/threads/messages",
                data={
                    "thread_id": str(thread.thread_id),
                    "voice": json.dumps(voice_cfg),
                    "send_to_llm": "false",
                },
                files={"audio_file": (audio_name, audio_bytes, audio_type)},
            )
            try:
                return response.json()
            except Exception:
                return {}
        finally:
            # Scratch thread — must not linger under the main assistant or it
            # would surface in the Backboard thread import.
            try:
                await bb.delete_thread(thread.thread_id)
            except Exception:
                logger.warning("[voice] transcribe scratch-thread delete failed (non-fatal)")

    try:
        result = run_async(_do_transcribe())
    except Exception as exc:
        logger.exception("[voice] transcription failed")
        return jsonify({"error": f"transcription failed: {exc}"}), 502

    stt_record = (result.get("voice_records") or {}).get("stt", {}) or {}
    text = (
        # Backboard's STTUsageInfo carries the transcript as `transcript`.
        stt_record.get("transcript")
        or stt_record.get("text")
        or result.get("text")
        or result.get("transcript")
        or result.get("content")
        or ""
    )
    if not isinstance(text, str):
        text = ""
    text = text.strip()

    logger.warning(
        "[voice] transcribe ok provider=%s model=%s lang=%s bytes=%d text_len=%d",
        stt_provider,
        stt_model,
        language,
        len(audio_bytes),
        len(text),
    )

    return jsonify({"text": text})


# ---------------------------------------------------------------------------
# Phase 2 — full voice conversation (STT + LLM + TTS streaming)
# ---------------------------------------------------------------------------

_voice_streams: dict[str, dict] = {}
_voice_streams_lock = threading.Lock()
VOICE_STREAM_IDLE_TIMEOUT_SEC = 60
VOICE_STREAM_TOTAL_TIMEOUT_SEC = 180
# Drop stream entries older than this whether they were consumed or not.
# Prevents accumulating audio blobs in memory when a client never opens the
# SSE GET (tab closed, network drop, etc.).
VOICE_STREAM_TTL_SEC = 300


def _evict_stale_streams() -> None:
    """Best-effort GC of voice stream entries. Runs opportunistically on
    every POST /converse — no background thread."""
    now = time.time()
    with _voice_streams_lock:
        stale = [
            sid for sid, s in _voice_streams.items()
            if s.get("done") or (now - s.get("created_at", now)) > VOICE_STREAM_TTL_SEC
        ]
        for sid in stale:
            _voice_streams.pop(sid, None)


# Audio persistence — mirrors image-gen. Backboard's TTS audio URLs are
# presigned S3 links; we never expose them. The frontend always points at
# /api/files/download/<dir>/voice_<documentId> instead.
_MIME_TO_EXT = {
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/mp4": "m4a",
    "audio/aac": "aac",
}

_pending_audio_downloads: dict[str, threading.Event] = {}
_pending_audio_lock = threading.Lock()


def voice_audio_file_id(document_id: str) -> str:
    return f"voice_{document_id}"


def predictable_voice_audio_url(dir_key: str, document_id: str) -> str:
    return f"/api/files/download/{dir_key}/{voice_audio_file_id(document_id)}"


def wait_for_pending_voice_audio(file_id: str, timeout: float = 15.0) -> bool:
    with _pending_audio_lock:
        event = _pending_audio_downloads.get(file_id)
    if event is None:
        return False
    return event.wait(timeout=timeout)


# Backboard presigned S3 URLs for generated audio. Same defense as for
# images — never let the bucket hostname through.
_BACKBOARD_S3_AUDIO_RE = re.compile(
    r"https?://[\w.-]*\bamazonaws\.com/[^\s)\]\"'>]*?/"
    r"(?P<doc>[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})"
    r"\.(?:mp3|wav|ogg|webm|m4a|aac|flac)(?:\?[^\s)\]\"'>]*)?",
    re.IGNORECASE,
)

# Hard cap on user-uploaded audio so a runaway client can't pin a Nash
# worker by streaming a multi-GB payload before the backend round-trips
# to Backboard. 50 MB comfortably covers OpenAI's documented 25 MB and a
# typical hands-free conversation turn.
MAX_AUDIO_BYTES = 50 * 1024 * 1024


def sanitize_s3_audio_urls(text: str, dir_key: str) -> str:
    if not text or not dir_key or "amazonaws.com" not in text:
        return text

    def _swap(match: re.Match) -> str:
        return predictable_voice_audio_url(dir_key, match.group("doc").lower())

    return _BACKBOARD_S3_AUDIO_RE.sub(_swap, text)


def _persist_voice_audio_async(
    audio_url: str,
    document_id: str,
    mime_type: str,
    user_id: str,
    dir_key: str,
) -> None:
    """Background download of a Backboard TTS audio URL onto local disk so the
    Nash file-download route can serve it without ever revealing the S3
    hostname. Fails silently (the SSE event already streamed the base64
    chunks so the user heard the response; reload won't replay if the
    download failed, which is acceptable for Phase 2)."""
    file_id = voice_audio_file_id(document_id)
    event = threading.Event()
    with _pending_audio_lock:
        _pending_audio_downloads[file_id] = event
    try:
        from api.routes.files import UPLOAD_DIR
        ext = _MIME_TO_EXT.get((mime_type or "").lower(), "mp3")
        filename = f"{file_id}.{ext}"
        user_dir = os.path.join(UPLOAD_DIR, dir_key)
        os.makedirs(user_dir, exist_ok=True)
        local_path = os.path.join(user_dir, filename)
        tmp_path = local_path + ".partial"
        req = urllib.request.Request(audio_url, headers={"User-Agent": "Nash/voice-persist"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            with open(tmp_path, "wb") as f:
                shutil.copyfileobj(resp, f)
        os.replace(tmp_path, local_path)
        file_size = os.path.getsize(local_path)
        state_service.file_meta.put(user_id, file_id, {
            "file_id": file_id,
            "filename": filename,
            "bytes": file_size,
            "type": mime_type or "audio/mpeg",
            "source": "voice",
            "filepath": local_path,
            "status": "indexed",
            "document_id": document_id,
        })
        logger.warning(
            "[voice] persisted TTS audio documentId=%s bytes=%d path=%s",
            document_id, file_size, local_path,
        )
    except Exception as exc:
        logger.warning(
            "[voice] failed to persist TTS audio documentId=%s err=%s",
            document_id, exc,
        )
    finally:
        event.set()
        with _pending_audio_lock:
            _pending_audio_downloads.pop(file_id, None)


@voice_bp.route("/api/voice/converse", methods=["POST"])
@require_auth
def voice_converse_start():
    """Start a full voice-conversation turn.

    Multipart form:
      - ``audio_file``: required, recorded user audio.
      - ``conversationId``: optional — pin to a Nash conversation so the
        thread / message history is preserved. Empty for new convo.
      - ``model``: optional — LLM model spec like ``openai/gpt-4.1``.
      - ``language``: optional ISO-639-1 for STT.
      - ``stt_provider`` / ``stt_model``: optional STT override (``openai`` or
        ``elevenlabs``); validated against the allow-list, falls back to the
        deploy default.
      - ``tts_voice``: optional voice id (e.g. "coral", "alloy").

    Returns ``{"streamId": "...", "conversationId": "..."}``. The client
    immediately opens ``GET /api/voice/converse/stream/<streamId>`` to consume
    the SSE flow.
    """
    if "audio_file" not in request.files:
        return jsonify({"error": "missing audio_file"}), 400

    audio = request.files["audio_file"]
    if not audio or not audio.filename:
        return jsonify({"error": "empty audio_file"}), 400

    audio_bytes = audio.read(MAX_AUDIO_BYTES + 1)
    if len(audio_bytes) > MAX_AUDIO_BYTES:
        return jsonify({"error": "audio_file too large"}), 413
    audio_name = audio.filename or "audio.webm"
    audio_mime = audio.mimetype or "audio/webm"

    language = (request.form.get("language") or settings.voice_default_language).strip()
    stt_provider, stt_model = _resolve_stt_config(
        request.form.get("stt_provider"), request.form.get("stt_model")
    )
    model = request.form.get("model") or ""
    tts_voice = (request.form.get("tts_voice") or settings.voice_tts_voice).strip()
    conversation_id = request.form.get("conversationId") or ""

    from api.routes.files import _upload_dir_key
    user_id = get_request_state_partition()
    bb_api_key = getattr(g, 'bb_api_key', '') or ''
    dir_key = _upload_dir_key()
    assistant_id = get_request_assistant_id()

    # Resolve / create the thread the same way the chat flow does so reload
    # picks the turn up alongside text messages.
    from api.services.conversation_service import (
        get_or_create_thread,
        save_conversation_meta,
    )
    bb = get_request_client()
    if not conversation_id:
        conversation_id = str(uuid.uuid4())
        save_conversation_meta(user_id, conversation_id, {
            "conversationId": conversation_id,
            "title": "Voice chat",
            "endpoint": "agents",
            "model": model or "",
        })
    thread_id, _owner_id, _created = get_or_create_thread(
        user_id, assistant_id, conversation_id, bb_client=bb,
    )

    _evict_stale_streams()
    stream_id = str(uuid.uuid4())
    new_entry = {
        "user_id": user_id,
        "dir_key": dir_key,
        "bb_api_key": bb_api_key,
        "thread_id": thread_id,
        "conversation_id": conversation_id,
        "model": model,
        "audio_bytes": audio_bytes,
        "audio_mime": audio_mime,
        "audio_name": audio_name,
        "voice_cfg": {
            "stt": {
                "provider": stt_provider,
                "model": stt_model,
                "language": language,
            },
            "tts": {
                "provider": settings.voice_tts_provider,
                "model": settings.voice_tts_model,
                "voice": tts_voice,
                # output_format is ElevenLabs-only: Backboard errors the TTS
                # leg when it's sent for OpenAI TTS (observed tts_error /
                # internal error), which left voice turns with no audio. For
                # ElevenLabs the value must come from Backboard's allow-list
                # (codec_samplerate_bitrate); plain "mp3" is rejected.
                **(
                    {"output_format": settings.voice_tts_output_format}
                    if settings.voice_tts_provider == "elevenlabs"
                    else {}
                ),
            },
        },
        "done": False,
        "created_at": time.time(),
    }
    with _voice_streams_lock:
        _voice_streams[stream_id] = new_entry

    logger.info(
        "[voice] converse start stream=%s convo=%s thread=%s audio_bytes=%d",
        stream_id, conversation_id, thread_id, len(audio_bytes),
    )
    return jsonify({"streamId": stream_id, "conversationId": conversation_id})


@voice_bp.route("/api/voice/converse/stream/<stream_id>", methods=["GET"])
@require_auth
def voice_converse_stream(stream_id: str):
    """SSE consumer for a voice turn previously registered via /converse."""
    with _voice_streams_lock:
        state = _voice_streams.get(stream_id)
        if state is None:
            return jsonify({"error": "stream not found"}), 404
        if state.get("done"):
            return jsonify({"error": "stream finished"}), 410
        # Snapshot what the generator needs, then drop the audio bytes from
        # the dict so the worker doesn't hold a 50 MB buffer in shared state
        # for the entire run. The thread closure keeps its own reference.
        audio_bytes = state.pop("audio_bytes", b"")

    user_id = state["user_id"]
    dir_key = state["dir_key"]
    bb_api_key = state["bb_api_key"]
    thread_id = state["thread_id"]
    conversation_id = state["conversation_id"]
    model = state["model"] or None
    audio_mime = state["audio_mime"]
    audio_name = state["audio_name"]
    voice_cfg = state["voice_cfg"]

    # Background download jobs for any TTS audio_url Backboard returns at
    # tts_stream_end. We don't await — the predictable Nash URL is what we
    # send to the client; the download route waits if needed.
    audio_jobs: list[threading.Thread] = []

    def _persist(media_url: str, document_id: str, mime_type: str) -> None:
        t = threading.Thread(
            target=_persist_voice_audio_async,
            args=(media_url, document_id, mime_type, user_id, dir_key),
            daemon=True,
        )
        t.start()
        audio_jobs.append(t)

    def generate():
        nonlocal model
        try:
            async def _open() -> AsyncIterator[dict[str, Any]]:
                return await stream_message_proxy_compatible(
                    thread_id=thread_id,
                    content="",  # content comes from STT
                    model=model,
                    voice=voice_cfg,
                    audio_bytes=audio_bytes,
                    audio_mime=audio_mime,
                    audio_filename=audio_name,
                    send_to_llm=True,
                    api_key=bb_api_key or None,
                )
            async_iter = run_async(_open())
            chunks = iter_async(async_iter, idle_timeout=VOICE_STREAM_IDLE_TIMEOUT_SEC)

            start = time.monotonic()
            transcript_user = ""
            transcript_assistant = ""
            audio_document_id = ""
            audio_mime_out = ""
            yielded_local_url = ""

            event_counts: dict[str, int] = {}
            run_ended_seen = False
            chunk_iter = iter(chunks)
            while True:
                try:
                    chunk = next(chunk_iter)
                except StopIteration:
                    break
                except Exception as e:
                    # Backboard SDK raises BackboardAPIError mid-iteration
                    # for things like an empty STT transcript ("Message
                    # content cannot be empty for user messages."). Without
                    # this catch the exception bubbles out of the SSE
                    # generator → Werkzeug 500 → frontend sees a closed
                    # EventSource and shows a generic "stream interrupted".
                    logger.warning("[voice] stream errored stream=%s err=%s", stream_id, e)
                    yield _sse({"type": "error", "error": str(e)})
                    return
                if time.monotonic() - start >= VOICE_STREAM_TOTAL_TIMEOUT_SEC:
                    logger.warning("[voice] stream timed out after %ss", VOICE_STREAM_TOTAL_TIMEOUT_SEC)
                    yield _sse({"type": "error", "error": "timeout"})
                    return

                t = chunk.get("type", "")
                event_counts[t] = event_counts.get(t, 0) + 1
                if t == "stt_stream_start":
                    yield _sse({"type": "stt_start"})
                elif t == "stt_text_delta":
                    delta = chunk.get("delta") or chunk.get("text") or ""
                    if delta:
                        transcript_user += delta
                        yield _sse({"type": "stt_delta", "text": transcript_user, "delta": delta})
                elif t == "stt_stream_end":
                    # Backboard sends the final transcript as `transcript`
                    # (thread_service stt_stream_end); `text` kept as a
                    # fallback for older deploys. Non-delta STT models (scribe,
                    # whisper-1) ONLY deliver text here, so reading the wrong
                    # key blanked the user transcript entirely.
                    final_text = (
                        chunk.get("transcript") or chunk.get("text") or transcript_user
                    )
                    transcript_user = final_text or transcript_user
                    yield _sse({"type": "stt_end", "text": transcript_user})
                elif t == "content_streaming":
                    content = chunk.get("content", "")
                    if content:
                        transcript_assistant += content
                        # Sanitize on the way out — defense in depth even
                        # though TTS audio normally arrives via tts_*.
                        rendered = sanitize_s3_audio_urls(transcript_assistant, dir_key)
                        yield _sse({"type": "assistant_delta", "text": rendered})
                elif t == "tts_stream_start":
                    audio_mime_out = chunk.get("content_type") or chunk.get("mime_type") or ""
                    yield _sse({"type": "tts_start", "mimeType": audio_mime_out})
                elif t == "tts_audio_chunk":
                    data = chunk.get("data") or ""
                    if data:
                        yield _sse({"type": "tts_chunk", "data": data})
                elif t == "tts_stream_end":
                    audio_url = chunk.get("audio_url") or ""
                    audio_document_id = (
                        str(chunk.get("document_id") or chunk.get("documentId") or "")
                        or audio_document_id
                    )
                    if audio_url and audio_document_id and dir_key:
                        _persist(audio_url, audio_document_id, audio_mime_out)
                        yielded_local_url = predictable_voice_audio_url(dir_key, audio_document_id)
                    yield _sse({
                        "type": "tts_end",
                        "documentId": audio_document_id,
                        "mimeType": audio_mime_out,
                        "url": yielded_local_url,
                    })
                    # Backboard's TTS pipeline emits tts_stream_end as the
                    # last event of a turn (after run_ended). Once we've
                    # seen both, we have everything — exit cleanly so the
                    # frontend's `final` event fires immediately.
                    if run_ended_seen:
                        break
                elif t in ("run_ended", "run_completed"):
                    # Do NOT return here — Backboard sends TTS events
                    # (tts_stream_start / tts_audio_chunk×N / tts_stream_end)
                    # AFTER run_ended. We need to keep iterating until the
                    # tts_stream_end (or the iterator naturally ends).
                    run_ended_seen = True
                    continue
                elif t == "tts_error":
                    # TTS failed but the turn itself succeeded — keep the
                    # transcripts. Tell the client (non-fatal) and stop
                    # waiting for tts_stream_end, which will never come.
                    err = chunk.get("error") or "tts failed"
                    logger.warning("[voice] tts failed stream=%s err=%s", stream_id, err)
                    yield _sse({"type": "tts_error", "error": str(err)})
                    if run_ended_seen:
                        break
                elif t in ("error", "run_failed"):
                    err = chunk.get("error") or chunk.get("message", "unknown error")
                    yield _sse({"type": "error", "error": str(err)})
                    return
            # Reached via StopIteration (Backboard closed the stream) or
            # via `break` after tts_stream_end. Emit the final summary so
            # the frontend stops speaking and loops back to listening with
            # full transcripts in hand.
            if run_ended_seen:
                logger.info(
                    "[voice] stream finished stream=%s events=%s user_text_len=%d assistant_text_len=%d audio_doc=%s",
                    stream_id, event_counts, len(transcript_user),
                    len(transcript_assistant), audio_document_id or "(none)",
                )
                # First completed turn: replace the "Voice chat" placeholder
                # with a title derived from what was actually said.
                from api.services.conversation_service import maybe_autotitle_conversation
                new_title = maybe_autotitle_conversation(
                    user_id, conversation_id, transcript_user or transcript_assistant
                )
                yield _sse({
                    "type": "final",
                    "userText": transcript_user,
                    "assistantText": sanitize_s3_audio_urls(transcript_assistant, dir_key),
                    "documentId": audio_document_id,
                    "audioUrl": yielded_local_url,
                    "conversationId": conversation_id,
                    **({"title": new_title} if new_title else {}),
                })
        finally:
            with _voice_streams_lock:
                if state is _voice_streams.get(stream_id):
                    state["done"] = True

    return Response(generate(), mimetype="text/event-stream", headers={
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
    })


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload)}\n\n"


# ---------------------------------------------------------------------------
# Phase 3 — per-message narration ("Read aloud" — pure TTS of given text)
# ---------------------------------------------------------------------------
#
# Sibling to the message hover toolbar's Copy / Fork / Feedback actions: read
# one assistant message aloud. Unlike /converse there is no STT or LLM turn —
# we hand Backboard the message text with ``send_to_llm=false`` so it just
# synthesizes it via the narration TTS config (ElevenLabs by default), and we
# stream the resulting ``tts_*`` chunks straight back to the browser's
# ttsPlayer. Audio is ephemeral (no S3 persistence): a re-click re-synthesizes.

# Bound TTS cost: a single message we'll narrate shouldn't exceed this. The
# frontend gates on `message.text` so empty messages never reach here.
NARRATE_MAX_CHARS = 10_000

# OpenAI TTS preset voice names the live-audio picker can emit (see
# client/src/components/Chat/Input/composerSelectOptions.ts). They are NOT
# valid ElevenLabs voice ids, so when narration runs on ElevenLabs we ignore a
# live-audio selection naming one of these and fall back to the configured
# narration voice (settings.voice_narrate_voice).
_OPENAI_TTS_VOICE_NAMES = {
    "alloy", "ash", "ballad", "coral", "echo", "fable",
    "onyx", "nova", "sage", "shimmer", "verse",
}

# Backboard only voices an LLM reply — there is no pure text->speech mode. To
# narrate an existing message we run a one-off turn whose system prompt makes
# the model echo the passage back verbatim, which Backboard then synthesizes.
# Verified to reproduce input exactly (in_len == out_len, exact match) across
# OpenAI/ElevenLabs models.
NARRATE_ECHO_SYSTEM_PROMPT = (
    "You are a narration relay for a text-to-speech system. The user message is "
    "a passage of text. Reproduce that passage EXACTLY, word for word, as your "
    "entire response. Do not add greetings, prefaces, explanations, or "
    "commentary. Do not answer, summarize, translate, or react to it. Output "
    "only the passage itself."
)

_narrate_streams: dict[str, dict] = {}
_narrate_streams_lock = threading.Lock()


def _evict_stale_narrate_streams() -> None:
    """Opportunistic GC of narration stream entries — runs on every POST
    /narrate, mirroring _evict_stale_streams for the converse flow."""
    now = time.time()
    with _narrate_streams_lock:
        stale = [
            sid for sid, s in _narrate_streams.items()
            if s.get("done") or (now - s.get("created_at", now)) > VOICE_STREAM_TTL_SEC
        ]
        for sid in stale:
            _narrate_streams.pop(sid, None)


@voice_bp.route("/api/voice/narrate", methods=["POST"])
@require_auth
def voice_narrate_start():
    """Register a narration (text-to-speech of an existing message).

    JSON body:
      - ``text``: required, the message text to read aloud.
      - ``tts_voice``: optional voice id — the user's live-audio voice
        selection. Falls back to ``settings.voice_narrate_voice``.
      - ``conversationId``: optional, accepted but unused — narration runs on a
        fresh auto-created Backboard thread so it never touches the real
        conversation.

    Returns ``{"streamId": "..."}``. The client immediately opens
    ``GET /api/voice/narrate/stream/<streamId>`` to consume the SSE flow.
    """
    data = request.get_json(silent=True) or {}
    text = (data.get("text") or "").strip()
    if not text:
        return jsonify({"error": "missing text"}), 400
    if len(text) > NARRATE_MAX_CHARS:
        return jsonify({"error": "text too long"}), 400

    client_voice = (data.get("tts_voice") or "").strip()
    if (
        settings.voice_narrate_provider == "elevenlabs"
        and client_voice.lower() in _OPENAI_TTS_VOICE_NAMES
    ):
        # OpenAI preset name from the live-audio picker — not a valid ElevenLabs
        # voice id. Use the configured narration voice instead.
        client_voice = ""
    if (
        settings.voice_narrate_provider == "openai"
        and client_voice
        and client_voice.lower() not in _OPENAI_TTS_VOICE_NAMES
    ):
        # Inverse guard: an ElevenLabs voice id (e.g. persisted from an earlier
        # deploy) is not a valid OpenAI preset and would fail the synthesis.
        client_voice = ""
    tts_voice = client_voice or settings.voice_narrate_voice

    bb_api_key = getattr(g, "bb_api_key", "") or ""
    tts_cfg = {
        "provider": settings.voice_narrate_provider,
        "model": settings.voice_narrate_model,
        "voice": tts_voice,
    }
    if settings.voice_narrate_provider == "elevenlabs":
        # Backboard rejects output_format for OpenAI TTS (500s the whole turn);
        # it is only meaningful — and required to avoid WAV — for ElevenLabs.
        tts_cfg["output_format"] = settings.voice_narrate_output_format
    voice_cfg = {"tts": tts_cfg}

    _evict_stale_narrate_streams()
    stream_id = str(uuid.uuid4())
    with _narrate_streams_lock:
        _narrate_streams[stream_id] = {
            "text": text,
            "bb_api_key": bb_api_key,
            "voice_cfg": voice_cfg,
            "done": False,
            "created_at": time.time(),
        }

    logger.info(
        "[voice] narrate start stream=%s voice=%s text_len=%d",
        stream_id, tts_voice, len(text),
    )
    return jsonify({"streamId": stream_id})


@voice_bp.route("/api/voice/narrate/stream/<stream_id>", methods=["GET"])
@require_auth
def voice_narrate_stream(stream_id: str):
    """SSE consumer for a narration previously registered via /narrate."""
    with _narrate_streams_lock:
        state = _narrate_streams.get(stream_id)
        if state is None:
            return jsonify({"error": "stream not found"}), 404
        if state.get("done"):
            return jsonify({"error": "stream finished"}), 410

    text = state["text"]
    bb_api_key = state["bb_api_key"]
    voice_cfg = state["voice_cfg"]

    def generate():
        try:
            async def _open() -> AsyncIterator[dict[str, Any]]:
                return await stream_tts_narration(
                    text=text,
                    voice_tts=voice_cfg["tts"],
                    system_prompt=NARRATE_ECHO_SYSTEM_PROMPT,
                    api_key=bb_api_key or None,
                )
            async_iter = run_async(_open())
            chunks = iter_async(async_iter, idle_timeout=VOICE_STREAM_IDLE_TIMEOUT_SEC)

            start = time.monotonic()
            mime_out = ""
            chunk_count = 0
            ended_sent = False
            chunk_iter = iter(chunks)
            while True:
                try:
                    chunk = next(chunk_iter)
                except StopIteration:
                    break
                except Exception as e:
                    # Backboard SDK can raise mid-iteration (e.g. an invalid
                    # voice id for the provider). Surface it as an SSE error so
                    # the client stops the spinner instead of hanging.
                    logger.warning("[voice] narrate stream errored stream=%s err=%s", stream_id, e)
                    yield _sse({"type": "error", "error": str(e)})
                    return
                if time.monotonic() - start >= VOICE_STREAM_TOTAL_TIMEOUT_SEC:
                    logger.warning("[voice] narrate stream timed out after %ss", VOICE_STREAM_TOTAL_TIMEOUT_SEC)
                    yield _sse({"type": "error", "error": "timeout"})
                    return

                t = chunk.get("type", "")
                if t == "tts_stream_start":
                    mime_out = chunk.get("content_type") or chunk.get("mime_type") or ""
                    yield _sse({"type": "tts_start", "mimeType": mime_out})
                elif t == "tts_audio_chunk":
                    audio = chunk.get("data") or ""
                    if audio:
                        chunk_count += 1
                        yield _sse({"type": "tts_chunk", "data": audio})
                elif t == "tts_stream_end":
                    yield _sse({"type": "tts_end", "mimeType": mime_out})
                    ended_sent = True
                    break
                elif t in ("error", "run_failed", "tts_error"):
                    # tts_error (e.g. an unauthorized TTS provider) previously
                    # fell through silently: the client saw tts_start and then
                    # nothing, so the speaker button appeared to do nothing.
                    err = chunk.get("error") or chunk.get("message", "unknown error")
                    logger.warning("[voice] narrate tts failed stream=%s err=%s", stream_id, err)
                    yield _sse({"type": "error", "error": str(err)})
                    return
                # The echo turn also emits content_streaming / run_* events for
                # the verbatim reply; narration only cares about the tts_* audio,
                # so everything else is ignored.

            # If Backboard closed the stream without an explicit tts_stream_end
            # but we did get audio, still tell the client to finalize playback.
            if not ended_sent and chunk_count > 0:
                yield _sse({"type": "tts_end", "mimeType": mime_out})
            logger.info(
                "[voice] narrate finished stream=%s chunks=%d mime=%s",
                stream_id, chunk_count, mime_out or "(none)",
            )
        finally:
            with _narrate_streams_lock:
                if state is _narrate_streams.get(stream_id):
                    state["done"] = True

    return Response(generate(), mimetype="text/event-stream", headers={
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
    })
