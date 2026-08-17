"""Image generation is ALWAYS on: Backboard's generate_image tool is attached on
every turn (image_generation="auto") and the chat model decides when to call it,
guided by CAPABILITIES_SYSTEM_PROMPT. There is no prompt-regex intent
heuristic. These tests lock in that contract:

* ``requested_image_generation`` is True on every turn (plain chat included).
* The capabilities prompt is always present so the model knows it can generate
  or edit — and only does so when the user asks.
* Deterministic image *context* (an uploaded image this turn, or a previously
  generated image) is what drives vision-reference attachment and the
  tool-capable-orchestrator swap — not the user's wording.
"""

import pytest

from api.routes import chat
from api.routes.chat import CAPABILITIES_SYSTEM_PROMPT


async def _noop_process_pending_files(**kwargs):
    return None


def _base_monkeypatch(monkeypatch, *, message_files, convo_meta=None):
    monkeypatch.setattr(chat, "_resolve_chat_credentials", lambda *a, **k: ("key", "asst"))
    monkeypatch.setattr(chat, "get_user_client", lambda _key: object())
    monkeypatch.setattr(
        chat, "get_or_create_thread", lambda *a, **k: ("thread-1", "convo-1", False)
    )
    monkeypatch.setattr(chat, "_seed_forked_thread_if_needed", lambda *a, **k: None)
    monkeypatch.setattr(chat, "_display_files_from_pasted_payload", lambda **k: [])
    monkeypatch.setattr(chat, "_resolve_image_config", lambda *a, **k: ("openrouter", "img"))
    monkeypatch.setattr(chat, "_message_files_from_request", lambda *a, **k: message_files)
    monkeypatch.setattr(chat, "_load_image_tool_files", lambda _uid, ids: [
        f for f in message_files if str(f.get("type", "")).startswith("image/")
    ])
    monkeypatch.setattr(chat, "_process_pending_files", _noop_process_pending_files)
    monkeypatch.setattr(chat, "_strip_legacy_assistant_tools_once", lambda *a: None)
    monkeypatch.setattr(
        chat.state_service.convo_meta, "get", lambda *a, **k: convo_meta or {}
    )


def _prepare(payload):
    return chat._prepare_stream(
        "stream-1",
        "user-1",
        payload,
        session_bb_api_key="key",
        session_chat_assistant_id="asst",
        dir_key="user-1",
    )


def test_plain_chat_still_enables_image_tool(monkeypatch):
    """No files, no image words — the tool is STILL attached; the model decides."""
    _base_monkeypatch(monkeypatch, message_files=[])

    ctx = _prepare(
        {
            "conversationId": "convo-1",
            "text": "what is the capital of France?",
            "model": "openai/gpt-4.1",
        }
    )

    assert ctx["requested_image_generation"] is True
    # No image context, so no vision refs, no orchestrator swap, no placeholder.
    assert ctx["image_context_this_turn"] is False
    assert ctx["image_gen_ref_files"] == []
    assert ctx["image_orchestrator_override"] is None
    # Image guidance is always present, but instructs "generate only when asked".
    assert CAPABILITIES_SYSTEM_PROMPT in (ctx["system_prompt"] or "")


def test_uploaded_image_is_image_context_and_attached_as_vision_ref(monkeypatch):
    """Uploading an image (with any edit-ish prompt) is treated as image context
    regardless of wording — the upload rides along as a vision reference."""
    files = [{"file_id": "img-1", "type": "image/png"}]
    _base_monkeypatch(monkeypatch, message_files=files)

    ctx = _prepare(
        {
            "conversationId": "convo-1",
            "text": "turn this into a watercolor",  # no legacy-regex match
            "model": "openai/gpt-4.1",
            "files": files,
        }
    )

    assert ctx["requested_image_generation"] is True
    assert ctx["image_context_this_turn"] is True
    assert [f["file_id"] for f in ctx["image_gen_ref_files"]] == ["img-1"]


def test_prior_generated_image_marks_context_without_upload(monkeypatch):
    """A conversation that already produced an image keeps image context on so a
    bare follow-up ("another one") still routes through the image path."""
    _base_monkeypatch(monkeypatch, message_files=[], convo_meta={"imageGenerated": True})

    ctx = _prepare(
        {
            "conversationId": "convo-1",
            "text": "another one",
            "model": "openai/gpt-4.1",
        }
    )

    assert ctx["requested_image_generation"] is True
    assert ctx["image_context_this_turn"] is True


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-q"]))
