"""Realtime voice WebSocket endpoint.

Browser opens `wss://<host>/api/voice/realtime?conversationId=<id>` once
per voice-mode session. Flask:
  1. Authenticates against the existing session cookie.
  2. Resolves the user's assistant + Backboard thread.
  3. Opens a Backboard `stream_voice` WebSocket via the SDK.
  4. Pumps PCM frames browser→Backboard and JSON events Backboard→browser.
  5. Sanitizes S3 audio URLs and kicks off audio persistence on `tts_stream_end`.

BYOK constraint: the browser cannot connect to Backboard directly (would
leak the API key). Flask is a strict relay — keys never leave the server.
"""
from __future__ import annotations

import json
import logging
import re
import threading
import time
import uuid
from typing import Any

from flask import g, request

from api.app import sock
from api.config import settings
from api.middleware.session_auth import (
    _extract_session_key,
    _populate_g_from_session,
    _resolve_session,
)
from api.routes.voice import (
    predictable_voice_audio_url,
    sanitize_s3_audio_urls,
)
from api.services.async_runner import iter_async, run_async
from api.services.conversation_service import maybe_autotitle_conversation
from api.services.backboard_service import (
    get_request_assistant_id,
    get_request_state_partition,
    new_user_client,
)

logger = logging.getLogger(__name__)


# How long we wait for Backboard's session.begin before treating the relay
# as failed. Matches the SDK's default with a small buffer.
SESSION_OPEN_TIMEOUT_SEC = 20.0
# Per-event idle timeout for the Backboard→browser pump. Longer than the
# voice-mode idle gap so a thoughtful pause between turns doesn't kill the
# session; shorter than infinity so a half-dead WS releases the thread.
EVENTS_IDLE_TIMEOUT_SEC = 120.0
# Hard ceiling on a single dictation session. Press-to-talk dictations last
# seconds, so this is generous — its only job is to auto-close a session that
# got stuck open (backgrounded tab, missed "stop") well before it can reach
# Backboard's ~1h realtime cap and strand a thread.
DICTATION_MAX_SESSION_SEC = 600.0


def _ws_send_error(ws, code: str, message: str) -> None:
    try:
        ws.send(json.dumps({"type": "error", "code": code, "message": message}))
    except Exception:
        pass
    try:
        ws.close()
    except Exception:
        pass


def _build_voice_config(language: str, tts_voice: str) -> dict:
    """Build the realtime `config` payload Backboard's stream_voice expects.

    STT is locked to ElevenLabs `scribe_v2_realtime` (only realtime model
    Backboard exposes). TTS reuses the same OpenAI defaults as the REST
    path so users hear a consistent voice across modes.
    """
    # VAD tuning (docs.backboard.io/concepts/realtime-voice):
    #   - vad_silence_threshold_secs: default 1.5s is the "record-then-send"
    #     feel — drop to 0.5s so the server commits within a normal
    #     conversational pause. Below ~0.3s starts cutting people off mid-
    #     breath; above ~0.8s feels like the assistant is hesitating.
    #   - vad_threshold: 0.4 default. Slightly lower (0.35) is a touch more
    #     sensitive without picking up keyboard noise.
    # Image generation is opt-in per-turn via `image_generation="auto"` on the
    # request (docs.backboard.io/concepts/image-tool) — we deliberately do NOT
    # set it here, so the tool is off for voice turns by default. The LLM
    # can't generate images during voice even if the assistant's text-chat
    # context has the tool enabled.
    return {
        "voice": {
            "stt": {
                "model": "scribe_v2_realtime",
                "sample_rate": 16000,
                "audio_format": "pcm_16000",
                "language": language,
                "vad_silence_threshold_secs": 0.5,
                "vad_threshold": 0.35,
            },
            "tts": {
                "provider": settings.voice_tts_provider,
                "model": settings.voice_tts_model,
                "voice": tts_voice,
                # ElevenLabs-only: Backboard errors the TTS leg when
                # output_format is sent for OpenAI TTS (see routes/voice.py).
                # Must be an ElevenLabs-format value (mp3_44100_128), not "mp3".
                **(
                    {"output_format": settings.voice_tts_output_format}
                    if settings.voice_tts_provider == "elevenlabs"
                    else {}
                ),
            },
        },
        "send_to_llm": True,
        # Memory defaults to "off" on the realtime endpoint (docs). The text
        # chat path defaults to "Auto" (chat.py builds bb_memory), so match it
        # here — otherwise voice turns can't read or write the user's memory
        # and the assistant "forgets" everything said in text chat.
        "memory": "Auto",
    }


def _build_dictation_config(language: str) -> dict:
    """STT-only realtime config for live dictation (the mic button).

    ``send_to_llm=False`` means Backboard runs only the STT leg and emits
    ``transcript.partial`` / ``transcript.final`` — no assistant turn, no TTS,
    no memory writes. STT is locked to ElevenLabs ``scribe_v2_realtime`` (the
    only realtime model Backboard exposes); the per-user STT *provider*
    preference applies to the batch transcribe/converse paths, not here.
    """
    return {
        "voice": {
            "stt": {
                "model": "scribe_v2_realtime",
                "sample_rate": 16000,
                "audio_format": "pcm_16000",
                "language": language,
                "vad_silence_threshold_secs": 0.5,
                "vad_threshold": 0.35,
            },
        },
        "send_to_llm": False,
    }


# Pulls the doc UUID out of an S3 audio URL like
#   https://...amazonaws.com/generated-audio/<uuid>.mp3
# Returns "" if no match — the realtime tts_stream_end always carries this URL,
# so failure here means an unexpected payload shape worth logging.
_S3_DOC_RE = re.compile(
    r"(?P<doc>[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})"
    r"\.(?:mp3|wav|ogg|webm|m4a|aac|flac)",
    re.IGNORECASE,
)


def _extract_doc_id(audio_url: str) -> str:
    """Pull the doc UUID out of a Backboard S3 audio URL (pre-sanitization)."""
    if not audio_url:
        return ""
    m = _S3_DOC_RE.search(audio_url)
    return m.group("doc").lower() if m else ""


def _persist_audio_from_chunks(
    chunks_b64: list[str],
    document_id: str,
    mime_type: str,
    user_id: str,
    dir_key: str,
) -> None:
    """Write the accumulated TTS audio bytes directly to disk.

    Unlike the REST path's `_persist_voice_audio_async`, we don't refetch
    the audio from Backboard's S3 — the realtime endpoint's presigned URLs
    have rejected our refetch with 403 (likely a sign-method / expiry
    quirk specific to the WS-side audio). We already have every byte from
    `tts_audio_chunk` events, so write them locally and skip the network
    roundtrip entirely. Same registry path as the REST persister so
    reload re-serves identically.
    """
    import base64, os
    from api.routes.files import UPLOAD_DIR
    from api.services import state_service
    from api.routes.voice import voice_audio_file_id, _MIME_TO_EXT, _pending_audio_downloads, _pending_audio_lock

    file_id = voice_audio_file_id(document_id)
    event = threading.Event()
    with _pending_audio_lock:
        _pending_audio_downloads[file_id] = event
    try:
        data = b"".join(base64.b64decode(c) for c in chunks_b64 if c)
        if not data:
            logger.warning("[voice-rt] persist skipped: 0 bytes documentId=%s", document_id)
            return
        ext = _MIME_TO_EXT.get((mime_type or "").lower(), "mp3")
        filename = f"{file_id}.{ext}"
        user_dir = os.path.join(UPLOAD_DIR, dir_key)
        os.makedirs(user_dir, exist_ok=True)
        local_path = os.path.join(user_dir, filename)
        tmp_path = local_path + ".partial"
        with open(tmp_path, "wb") as f:
            f.write(data)
        os.replace(tmp_path, local_path)
        state_service.file_meta.put(user_id, file_id, {
            "file_id": file_id,
            "filename": filename,
            "bytes": len(data),
            "type": mime_type or "audio/mpeg",
            "source": "voice",
            "filepath": local_path,
            "status": "indexed",
            "document_id": document_id,
        })
        logger.info(
            "[voice-rt] persisted TTS audio documentId=%s bytes=%d path=%s",
            document_id, len(data), local_path,
        )
    except Exception as exc:
        logger.warning("[voice-rt] persist failed documentId=%s err=%s", document_id, exc)
    finally:
        event.set()
        with _pending_audio_lock:
            _pending_audio_downloads.pop(file_id, None)


def _forward_event(
    ws,
    event: dict[str, Any],
    *,
    dir_key: str,
    user_id: str,
    conversation_id: str,
    audio_doc_holder: list[str],
    tts_chunks_buffer: list[str],
) -> None:
    """Transform a Backboard event and forward it to the browser.

    On tts_audio_chunk we tee the base64 data into a per-turn buffer.
    On tts_stream_end we spawn a daemon to persist the accumulated bytes
    locally (no S3 refetch), then rewrite the audio_url to its Nash-owned
    form before forwarding. On any defensive S3-URL sighting elsewhere
    we still sanitize.
    """
    et = event.get("type") or ""

    if et == "transcript.final":
        # First completed utterance: replace the "Voice chat" placeholder
        # title. Off-thread so the event pump never blocks on DynamoDB;
        # maybe_autotitle_conversation no-ops once a real title exists.
        text = str(event.get("text") or "")
        if text.strip():
            threading.Thread(
                target=maybe_autotitle_conversation,
                args=(user_id, conversation_id, text),
                daemon=True,
            ).start()

    if et == "tts_audio_chunk":
        data = event.get("data")
        if isinstance(data, str):
            tts_chunks_buffer.append(data)
    elif et == "tts_stream_end":
        original_audio_url = str(event.get("audio_url") or "")
        doc_id = (
            str(event.get("document_id") or event.get("documentId") or "").strip()
            or _extract_doc_id(original_audio_url)
        )
        content_type = event.get("content_type") or "audio/mpeg"
        if doc_id and dir_key and tts_chunks_buffer:
            chunks_for_thread = list(tts_chunks_buffer)
            t = threading.Thread(
                target=_persist_audio_from_chunks,
                args=(chunks_for_thread, doc_id, content_type, user_id, dir_key),
                daemon=True,
            )
            t.start()
            audio_doc_holder[0] = doc_id
            event = {
                **event,
                "audio_url": predictable_voice_audio_url(dir_key, doc_id),
                "document_id": doc_id,
            }
        # Reset the per-turn buffer either way (success or no-doc-id).
        tts_chunks_buffer.clear()

    # Defensive sanitize on any other payload that could carry an S3 URL
    # (assistant text in content_streaming, message_saved, etc.). Cheap —
    # the regex only fires when "amazonaws.com" actually appears.
    if et in ("content_streaming", "message_saved", "user_message"):
        raw = json.dumps(event)
        if "amazonaws.com" in raw:
            event = json.loads(sanitize_s3_audio_urls(raw, dir_key))

    try:
        ws.send(json.dumps(event))
    except Exception as e:
        logger.info("[voice-rt] forward send failed: %s", e)
        raise


if sock is not None:

    @sock.route("/api/voice/realtime")
    def voice_realtime_ws(ws) -> None:
        # ----- 1. Authenticate ------------------------------------------------
        session_key = _extract_session_key()
        if not session_key:
            return _ws_send_error(ws, "auth_failed", "missing session key")
        data = _resolve_session(session_key)
        if not data:
            return _ws_send_error(ws, "auth_failed", "invalid or expired session")
        _populate_g_from_session(session_key, data)

        # ----- 2. Resolve user / assistant / thread ---------------------------
        try:
            user_id = get_request_state_partition()
            assistant_id = get_request_assistant_id()
        except Exception as e:
            return _ws_send_error(ws, "auth_failed", f"context unavailable: {e}")

        bb_api_key = data["api_key"]
        # Mirror the REST path so realtime + REST turns under the same
        # user land in the same /api/files/download/<dir_key>/... namespace.
        from api.routes.files import _upload_dir_key
        dir_key = _upload_dir_key()
        conversation_id = (request.args.get("conversationId") or "").strip()
        # "new" is the client's placeholder for the /c/new route, not a real
        # conversation id. Treat it as empty so we mint a fresh conversation +
        # thread instead of collapsing every voice chat onto a shared "new"
        # thread (which also pollutes the convo list with a CONVO#new row).
        if conversation_id == "new":
            conversation_id = ""
        language = (request.args.get("language") or settings.voice_default_language).strip()
        tts_voice = (request.args.get("ttsVoice") or settings.voice_tts_voice).strip()

        # Reuse the REST path's thread resolver so realtime turns land on
        # the same Backboard thread as text turns for a given conversation.
        from api.services.conversation_service import (
            get_or_create_thread,
            save_conversation_meta,
        )

        # Owned client: this WebSocket session explicitly aclose()s it on
        # teardown, so it must NOT come from the shared pool.
        client = new_user_client(bb_api_key)
        if client is None:
            return _ws_send_error(ws, "auth_failed", "no Backboard client (BYOK key missing)")

        if not conversation_id:
            conversation_id = str(uuid.uuid4())
            save_conversation_meta(user_id, conversation_id, {
                "conversationId": conversation_id,
                "title": "Voice chat",
                "endpoint": "agents",
                "model": "",
            })
        else:
            # Touch updatedAt so the convo bubbles to the top of the sidebar
            # after a voice interaction (mirrors what text chat does on send).
            save_conversation_meta(user_id, conversation_id, {})
        try:
            thread_id, _owner, _created = get_or_create_thread(
                user_id, assistant_id, conversation_id, bb_client=client,
            )
        except Exception as e:
            logger.warning("[voice-rt] thread resolve failed: %s", e)
            return _ws_send_error(ws, "not_found", f"thread resolve failed: {e}")

        session_id = str(uuid.uuid4())
        logger.info(
            "[voice-rt] open session=%s user=%s assistant=%s convo=%s thread=%s",
            session_id, user_id, assistant_id, conversation_id, thread_id,
        )

        # ----- 3. Open the Backboard voice session -----------------------------
        config = _build_voice_config(language, tts_voice)
        try:
            bb_session = run_async(
                client.stream_voice(thread_id, config, timeout=SESSION_OPEN_TIMEOUT_SEC),
                timeout=SESSION_OPEN_TIMEOUT_SEC + 5.0,
            )
        except Exception as e:
            logger.warning("[voice-rt] stream_voice open failed: %s", e)
            return _ws_send_error(ws, "session_create_failed", str(e))

        # Log the resolved pipeline so we can see exactly which STT/LLM/TTS
        # Backboard picked. We don't send llm_provider/llm_model in the config,
        # so the LLM here is the assistant's default model.
        logger.info("[voice-rt] pipeline session=%s %s", session_id, bb_session.pipeline)

        # Tell the browser the session is live, alongside identifiers it
        # may want to log. Nash-owned conversation_id is added so the
        # frontend can route to /c/<id> after the first turn.
        try:
            ws.send(json.dumps({
                "type": "session.begin",
                "session_id": session_id,
                "conversation_id": conversation_id,
                "assistant_id": assistant_id,
                "thread_id": thread_id,
                "pipeline": bb_session.pipeline,
            }))
        except Exception as e:
            logger.warning("[voice-rt] failed to send session.begin: %s", e)
            try:
                run_async(bb_session.close(), timeout=5.0)
            except Exception:
                pass
            return

        # ----- 4. Pump events ------------------------------------------------
        # Two pumps:
        #   A. browser→Backboard (this thread): ws.receive() blocks; binary
        #      frames become PCM send_audio, text frames become control JSON.
        #   B. Backboard→browser (daemon thread): SDK's events() async
        #      iterator pulled via iter_async, forwarded to ws.send().
        # Either side closing flips `shutdown` so the other unwinds.

        shutdown = threading.Event()
        audio_doc_holder = ["",]  # mutable holder so _forward_event can capture last doc id
        # Per-turn TTS chunk accumulator. Cleared on each tts_stream_end so
        # multi-turn sessions don't blend audio across turns.
        tts_chunks_buffer: list[str] = []

        def backboard_pump() -> None:
            try:
                for event in iter_async(
                    bb_session.events(timeout=EVENTS_IDLE_TIMEOUT_SEC),
                    idle_timeout=EVENTS_IDLE_TIMEOUT_SEC + 5.0,
                ):
                    if shutdown.is_set():
                        break
                    try:
                        _forward_event(
                            ws, event,
                            dir_key=dir_key,
                            user_id=user_id,
                            conversation_id=conversation_id,
                            audio_doc_holder=audio_doc_holder,
                            tts_chunks_buffer=tts_chunks_buffer,
                        )
                    except Exception:
                        break  # browser side likely closed
            except Exception as e:
                logger.info("[voice-rt] backboard pump exit: %s", e)
            finally:
                shutdown.set()
                # Best-effort close on browser side so its receive() returns None.
                try:
                    ws.close()
                except Exception:
                    pass

        pump_thread = threading.Thread(target=backboard_pump, daemon=True)
        pump_thread.start()

        try:
            while not shutdown.is_set():
                # simple-websocket returns None on either an actual close
                # OR a poll timeout with the connection still alive. We
                # only want to bail on the former — a long assistant turn
                # (10-30s of LLM + TTS) is a normal lull on the browser
                # side and shouldn't kill the relay.
                msg = ws.receive(timeout=30)
                if msg is None:
                    if not getattr(ws, "connected", True):
                        break  # actually closed
                    continue  # just an idle tick, keep waiting
                if isinstance(msg, (bytes, bytearray)):
                    # Binary frame = PCM 16-bit 16 kHz mono LE.
                    try:
                        run_async(bb_session.send_audio(bytes(msg)), timeout=10.0)
                    except Exception as e:
                        logger.info("[voice-rt] send_audio failed: %s", e)
                        break
                else:
                    # Text frame = JSON control message (commit, etc.).
                    try:
                        payload = json.loads(msg)
                    except Exception:
                        continue
                    ctl = payload.get("type")
                    if ctl == "commit":
                        try:
                            run_async(bb_session.commit(), timeout=10.0)
                        except Exception as e:
                            logger.info("[voice-rt] commit failed: %s", e)
                            break
                    elif ctl == "close":
                        # Nash-side close: tear down both legs of the relay.
                        # `stop` is reserved for forwarding to Backboard
                        # (interrupt-in-flight-TTS) and NOT for closing the
                        # Nash session.
                        break
                    else:
                        # Forward arbitrary control frames to Backboard
                        # verbatim — including `{"type": "stop"}` which
                        # cancels the current Backboard turn (interrupt
                        # mid-TTS), and any future control types.
                        try:
                            run_async(bb_session.send_json(payload), timeout=10.0)
                        except Exception as e:
                            logger.info("[voice-rt] send_json failed: %s", e)
                            break
        except Exception as e:
            logger.info("[voice-rt] browser pump exit: %s", e)
        finally:
            shutdown.set()
            try:
                run_async(bb_session.close(), timeout=5.0)
            except Exception:
                pass
            # Release the per-session BackboardClient's httpx connection
            # pool so FDs are reclaimed promptly. Without this, ~0.6 FDs
            # per session linger as TCP keep-alive sockets — measurable
            # under rapid open/close churn.
            try:
                run_async(client.aclose(), timeout=5.0)
            except Exception:
                pass
            pump_thread.join(timeout=5.0)
            logger.info(
                "[voice-rt] close session=%s convo=%s audio_doc=%s",
                session_id, conversation_id, audio_doc_holder[0] or "(none)",
            )

    @sock.route("/api/voice/dictation")
    def voice_dictation_ws(ws) -> None:
        """STT-only realtime dictation relay (the mic button).

        Replaces the REST POST /api/voice/transcribe path for the composer mic:
        the browser opens this socket on press, streams PCM, and receives
        transcript.partial / transcript.final live so text lands in the input
        as the user speaks.

        Unlike /api/voice/realtime this never touches the conversation list — it
        runs on a throwaway "scratch" Backboard thread, produces no assistant
        turn (send_to_llm=False, no TTS), and forwards only transcript + error
        events.
        """
        # ----- 1. Authenticate ------------------------------------------------
        session_key = _extract_session_key()
        if not session_key:
            return _ws_send_error(ws, "auth_failed", "missing session key")
        data = _resolve_session(session_key)
        if not data:
            return _ws_send_error(ws, "auth_failed", "invalid or expired session")
        _populate_g_from_session(session_key, data)

        # ----- 2. Resolve user / assistant (no conversation, no saved thread) -
        try:
            user_id = get_request_state_partition()
            assistant_id = get_request_assistant_id()
        except Exception as e:
            return _ws_send_error(ws, "auth_failed", f"context unavailable: {e}")

        bb_api_key = data["api_key"]
        language = (request.args.get("language") or settings.voice_default_language).strip()

        # Owned client: this WebSocket session explicitly aclose()s it on
        # teardown, so it must NOT come from the shared pool.
        client = new_user_client(bb_api_key)
        if client is None:
            return _ws_send_error(ws, "auth_failed", "no Backboard client (BYOK key missing)")

        # Scratch thread — dictation must NOT show up in the conversation list,
        # so we mint a throwaway Backboard thread (same approach as the REST
        # transcribe path) instead of resolving a conversation's real thread.
        try:
            thread = run_async(client.create_thread(assistant_id=assistant_id), timeout=15.0)
            thread_id = str(thread.thread_id)
        except Exception as e:
            logger.warning("[voice-dictation] scratch thread create failed: %s", e)
            try:
                run_async(client.aclose(), timeout=5.0)
            except Exception:
                pass
            return _ws_send_error(ws, "session_create_failed", f"thread create failed: {e}")

        session_id = str(uuid.uuid4())
        logger.info(
            "[voice-dictation] open session=%s user=%s assistant=%s thread=%s",
            session_id, user_id, assistant_id, thread_id,
        )

        def _delete_scratch_thread() -> None:
            # The scratch thread must not linger under the main assistant or
            # it would surface in the Backboard thread import.
            try:
                run_async(client.delete_thread(thread_id), timeout=10.0)
            except Exception:
                logger.warning("[voice-dictation] scratch-thread delete failed (non-fatal)")

        # ----- 3. Open the Backboard voice session (STT-only) ------------------
        config = _build_dictation_config(language)
        try:
            bb_session = run_async(
                client.stream_voice(thread_id, config, timeout=SESSION_OPEN_TIMEOUT_SEC),
                timeout=SESSION_OPEN_TIMEOUT_SEC + 5.0,
            )
        except Exception as e:
            logger.warning("[voice-dictation] stream_voice open failed: %s", e)
            _delete_scratch_thread()
            try:
                run_async(client.aclose(), timeout=5.0)
            except Exception:
                pass
            return _ws_send_error(ws, "session_create_failed", str(e))

        # The browser's openRealtimeSession() blocks until it sees session.begin,
        # so this frame is mandatory or the client open times out.
        try:
            ws.send(json.dumps({
                "type": "session.begin",
                "session_id": session_id,
                "thread_id": thread_id,
                "pipeline": bb_session.pipeline,
            }))
        except Exception as e:
            logger.warning("[voice-dictation] failed to send session.begin: %s", e)
            try:
                run_async(bb_session.close(), timeout=5.0)
            except Exception:
                pass
            _delete_scratch_thread()
            try:
                run_async(client.aclose(), timeout=5.0)
            except Exception:
                pass
            return

        # ----- 4. Pump events --------------------------------------------------
        # Same two-pump shape as the conversation relay, but the downstream pump
        # forwards ONLY transcript/error frames — STT-only has no TTS or content
        # events to persist or sanitize.
        shutdown = threading.Event()

        def backboard_pump() -> None:
            try:
                for event in iter_async(
                    bb_session.events(timeout=EVENTS_IDLE_TIMEOUT_SEC),
                    idle_timeout=EVENTS_IDLE_TIMEOUT_SEC + 5.0,
                ):
                    if shutdown.is_set():
                        break
                    et = (event.get("type") or "") if isinstance(event, dict) else ""
                    if et not in ("transcript.partial", "transcript.final", "error"):
                        continue
                    try:
                        ws.send(json.dumps(event))
                    except Exception:
                        break  # browser side likely closed
            except Exception as e:
                logger.info("[voice-dictation] backboard pump exit: %s", e)
            finally:
                shutdown.set()
                try:
                    ws.close()
                except Exception:
                    pass

        pump_thread = threading.Thread(target=backboard_pump, daemon=True)
        pump_thread.start()

        started_at = time.monotonic()
        try:
            while not shutdown.is_set():
                if time.monotonic() - started_at > DICTATION_MAX_SESSION_SEC:
                    logger.info(
                        "[voice-dictation] session=%s hit max duration, closing", session_id
                    )
                    break
                msg = ws.receive(timeout=30)
                if msg is None:
                    if not getattr(ws, "connected", True):
                        break  # actually closed
                    continue  # idle tick, keep waiting
                if isinstance(msg, (bytes, bytearray)):
                    try:
                        run_async(bb_session.send_audio(bytes(msg)), timeout=10.0)
                    except Exception as e:
                        logger.info("[voice-dictation] send_audio failed: %s", e)
                        break
                else:
                    try:
                        payload = json.loads(msg)
                    except Exception:
                        continue
                    ctl = payload.get("type")
                    if ctl == "commit":
                        # Flush any buffered audio so the tail of speech comes
                        # back as a transcript.final before we tear down.
                        try:
                            run_async(bb_session.commit(), timeout=10.0)
                        except Exception as e:
                            logger.info("[voice-dictation] commit failed: %s", e)
                            break
                    elif ctl == "close":
                        break
                    # Any other control frame is ignored — dictation has no TTS
                    # to interrupt and no other server-side knobs.
        except Exception as e:
            logger.info("[voice-dictation] browser pump exit: %s", e)
        finally:
            shutdown.set()
            try:
                run_async(bb_session.close(), timeout=5.0)
            except Exception:
                pass
            _delete_scratch_thread()
            try:
                run_async(client.aclose(), timeout=5.0)
            except Exception:
                pass
            pump_thread.join(timeout=5.0)
            logger.info("[voice-dictation] close session=%s thread=%s", session_id, thread_id)
