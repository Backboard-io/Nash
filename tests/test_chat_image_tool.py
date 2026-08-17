import json
from pathlib import Path

import pytest
from PIL import Image

from api.routes import chat
from api.services.async_runner import run_async


def _image_file(path: Path, **overrides):
    data = {
        "file_id": "img-1",
        "filename": path.name,
        "filepath": str(path),
        "type": "image/png",
        "status": "pending",
    }
    data.update(overrides)
    return data


def test_prepare_stream_routes_uploaded_images_through_native_thread_documents(monkeypatch):
    processed = {}

    async def fake_process_pending_files(**kwargs):
        processed.update(kwargs)

    bb = object()
    monkeypatch.setattr(chat, "_resolve_chat_credentials", lambda *args, **kwargs: ("key", "asst"))
    monkeypatch.setattr(chat, "get_user_client", lambda _key: bb)
    monkeypatch.setattr(
        chat,
        "get_or_create_thread",
        lambda *args, **kwargs: ("thread-1", "convo-1", False),
    )
    monkeypatch.setattr(chat, "_seed_forked_thread_if_needed", lambda *args, **kwargs: None)
    monkeypatch.setattr(chat, "_display_files_from_pasted_payload", lambda **kwargs: [])
    monkeypatch.setattr(chat, "_resolve_image_config", lambda *args, **kwargs: ("", ""))
    monkeypatch.setattr(
        chat,
        "_message_files_from_request",
        lambda *args, **kwargs: [{"file_id": "img-1", "type": "image/png"}],
    )
    monkeypatch.setattr(chat, "_process_pending_files", fake_process_pending_files)
    # Image generation is always-on now, so _prepare_stream loads uploaded image
    # refs on every turn that carries a file. Keep it hermetic (no state_service).
    monkeypatch.setattr(chat, "_load_image_tool_files", lambda *args, **kwargs: [])
    monkeypatch.setattr(chat, "_strip_legacy_assistant_tools_once", lambda *args: None)
    # Image generation is always-on now, so an uploaded image is attached as a
    # vision reference on every turn (even "describe this image"); stub the lookup.
    monkeypatch.setattr(chat, "_load_image_tool_files", lambda *args, **kwargs: [])

    ctx = chat._prepare_stream(
        "stream-1",
        "user-1",
        {
            "conversationId": "convo-1",
            "text": "describe this image",
            "model": "openai/gpt-4.1",
            "files": [{"file_id": "img-1", "type": "image/png"}],
        },
        session_bb_api_key="key",
        session_chat_assistant_id="asst",
        dir_key="user-1",
    )

    assert processed["target_file_ids"] == {"img-1"}
    assert processed["thread_id"] == "thread-1"
    assert ctx["image_tool_files"] == []


def _prepare_with(monkeypatch, payload):
    """Run _prepare_stream with the minimum mocks and no attached files."""
    async def fake_process_pending_files(**kwargs):
        pass

    monkeypatch.setattr(chat, "_resolve_chat_credentials", lambda *a, **k: ("key", "asst"))
    monkeypatch.setattr(chat, "get_user_client", lambda _key: object())
    monkeypatch.setattr(chat, "get_or_create_thread", lambda *a, **k: ("t", "convo-1", True))
    monkeypatch.setattr(chat, "_seed_forked_thread_if_needed", lambda *a, **k: None)
    monkeypatch.setattr(chat, "_display_files_from_pasted_payload", lambda **k: [])
    monkeypatch.setattr(chat, "_resolve_image_config", lambda *a, **k: ("google", "gemini-3-pro-image"))
    monkeypatch.setattr(chat, "_message_files_from_request", lambda *a, **k: [])
    monkeypatch.setattr(chat, "_process_pending_files", fake_process_pending_files)
    monkeypatch.setattr(chat, "_strip_legacy_assistant_tools_once", lambda *a: None)
    return chat._prepare_stream(
        "s", "user-1", payload,
        session_bb_api_key="key", session_chat_assistant_id="asst", dir_key="user-1",
    )


def test_capabilities_always_on_by_default(monkeypatch):
    """No regex: web search + image generation are enabled on every turn and the
    model decides. A plain question still gets both capabilities available."""
    ctx = _prepare_with(monkeypatch, {"conversationId": "convo-1", "text": "hello", "model": "openai/gpt-4.1"})
    assert ctx["requested_web_search"] == "Auto"
    assert ctx["requested_image_generation"] is True
    # And a permissive capabilities prompt is applied (not a forced one).
    assert ctx["system_prompt"] == chat.CAPABILITIES_SYSTEM_PROMPT


def test_capabilities_respect_explicit_off(monkeypatch):
    """A user can still force each capability OFF via the ephemeral agent."""
    ctx = _prepare_with(monkeypatch, {
        "conversationId": "convo-1", "text": "hello", "model": "openai/gpt-4.1",
        "ephemeralAgent": {"web_search": False, "image_generation": False},
    })
    assert ctx["requested_web_search"] is None
    assert ctx["requested_image_generation"] is False


def test_image_tool_output_uses_backboard_multimodal_shape(tmp_path):
    image_path = tmp_path / "apple.png"
    image_path.write_bytes(b"fake-image")

    output = json.loads(chat._image_tool_output(_image_file(image_path)))

    assert output["text"] == "Uploaded image: apple.png"
    assert output["__image_media_type"] == "image/png"
    assert output["__image_base64"]


def test_image_tool_output_compresses_images_over_backboard_cap(tmp_path, monkeypatch):
    image_path = tmp_path / "large.png"
    Image.new("RGB", (64, 64), "red").save(image_path)
    monkeypatch.setattr(chat.os.path, "getsize", lambda _: chat.IMAGE_TOOL_MAX_BYTES + 1)
    monkeypatch.setattr(chat, "_encode_jpeg_under_limit", lambda image, _: b"compressed")

    output = json.loads(chat._image_tool_output(_image_file(image_path)))

    assert output["text"] == "Uploaded image: large.png (compressed for inspection)"
    assert output["__image_media_type"] == "image/jpeg"
    assert output["__image_base64"]


def test_image_tool_output_returns_error_when_large_image_cannot_be_compressed(
    tmp_path, monkeypatch
):
    image_path = tmp_path / "large.png"
    Image.new("RGB", (64, 64), "red").save(image_path)
    monkeypatch.setattr(chat.os.path, "getsize", lambda _: chat.IMAGE_TOOL_MAX_BYTES + 1)
    monkeypatch.setattr(chat, "_encode_jpeg_under_limit", lambda image, _: None)

    output = json.loads(chat._image_tool_output(_image_file(image_path)))

    assert output["error"]
    assert output["max_bytes"] == chat.IMAGE_TOOL_MAX_BYTES
    assert "__image_base64" not in output


def test_scrub_uploaded_image_tool_payload_removes_embedded_base64():
    leaked = (
        "The image shows a dog.\n\n"
        '{"text":"Uploaded image: dog.jpg (compressed for inspection)",'
        '"__image_media_type":"image/jpeg",'
        '"__image_base64":"abc123+/="}'
    )

    assert chat.scrub_uploaded_image_tool_payloads(leaked) == "The image shows a dog."


def test_scrub_uploaded_image_tool_payload_holds_partial_stream_fragment():
    partial = (
        "The image shows a dog.\n\n"
        '{"text":"Uploaded image: dog.jpg","__image_media_type":"image/jpeg"'
    )

    assert chat.scrub_uploaded_image_tool_payloads(partial) == "The image shows a dog."


def test_scrub_uploaded_image_tool_payload_complete_text_keeps_incomplete_json():
    text = (
        "Before.\n\n"
        '{"text":"Uploaded image: dog.jpg"\n\n'
        "After."
    )

    assert chat.scrub_uploaded_image_tool_payloads(text, complete_text=True) == text


def test_scrub_uploaded_image_tool_payload_does_not_cross_match_later_object():
    keyless = json.dumps({"text": "Uploaded image: quoted.jpg", "note": "keep me"})
    hidden = json.dumps({
        "text": "Uploaded image: real.jpg",
        "__image_media_type": "image/jpeg",
        "__image_base64": "abc123+/=",
    })
    text = f"Start.\n\n{keyless}\n\nMiddle.\n\n{hidden}\n\nEnd."

    assert chat.scrub_uploaded_image_tool_payloads(text, complete_text=True) == (
        f"Start.\n\n{keyless}\n\nMiddle.\n\nEnd."
    )


def test_scrub_uploaded_image_tool_payload_preserves_text_after_escaped_filename():
    payload = json.dumps({
        "text": 'Uploaded image: dog "one".jpg',
        "__image_media_type": "image/jpeg",
        "__image_base64": "abc123+/=",
    })
    leaked = f"Before payload.\n\n{payload}\n\nAfter payload."

    assert chat.scrub_uploaded_image_tool_payloads(leaked) == (
        "Before payload.\n\nAfter payload."
    )


def test_scrub_uploaded_image_tool_payload_removes_multiple_payloads():
    payload = json.dumps({
        "text": "Uploaded image: dog.jpg",
        "__image_media_type": "image/jpeg",
        "__image_base64": "abc123+/=",
    })
    leaked = f"Start.\n\n{payload}\n\nMiddle.\n\n{payload}\n\nEnd."

    assert chat.scrub_uploaded_image_tool_payloads(leaked) == (
        "Start.\n\nMiddle.\n\nEnd."
    )


def test_load_image_tool_files_filters_to_requested_existing_images(tmp_path, monkeypatch):
    image_path = tmp_path / "kept.png"
    image_path.write_bytes(b"fake-image")
    doc_path = tmp_path / "notes.txt"
    doc_path.write_text("notes")
    rows = [
        _image_file(image_path, file_id="img-1"),
        {
            "file_id": "doc-1",
            "filename": "notes.txt",
            "filepath": str(doc_path),
            "type": "text/plain",
            "status": "pending",
        },
        _image_file(tmp_path / "missing.png", file_id="img-2"),
    ]
    monkeypatch.setattr(chat.state_service.file_meta, "list_for_user", lambda _: rows)

    files = chat._load_image_tool_files("user-1", {"img-1", "doc-1", "img-2"})

    assert [f["file_id"] for f in files] == ["img-1"]


def test_stream_image_tool_turn_submits_base64_tool_output(tmp_path, monkeypatch):
    image_path = tmp_path / "apple.png"
    image_path.write_bytes(b"fake-image")
    submitted = {}

    class Response:
        def json(self):
            return {
                "status": "REQUIRES_ACTION",
                "run_id": "run-1",
                "tool_calls": [
                    {
                        "id": "tool-call-1",
                        "function": {"name": "inspect_uploaded_image_1"},
                    }
                ],
            }

    class FakeClient:
        async def _make_request(self, method, endpoint, json_data=None):
            submitted["message_body"] = json_data
            return Response()

        async def submit_tool_outputs(self, thread_id, run_id, tool_outputs, stream=False):
            submitted["thread_id"] = thread_id
            submitted["run_id"] = run_id
            submitted["tool_outputs"] = tool_outputs
            submitted["stream"] = stream

            async def gen():
                yield {"type": "content_streaming", "content": "it is an apple"}

            return gen()

    monkeypatch.setattr(chat, "get_user_client", lambda _: FakeClient())
    ctx = {
        "bb_api_key": "key",
        "thread_id": "thread-1",
        "model_text": "what is in this image",
        "model": "openai/gpt-5.5",
        "bb_memory": "off",
        "image_model_provider": "",
        "image_model_name": "",
        "image_tool_files": [_image_file(image_path)],
        "files_corr_token": "client-user-1",
    }

    async def collect():
        return [chunk async for chunk in chat._stream_image_tool_turn(ctx, None)]

    chunks = run_async(collect())

    assert chunks == [{"type": "content_streaming", "content": "it is an apple"}]
    assert submitted["message_body"]["content"] == "what is in this image"
    assert "Available tools" in submitted["message_body"]["system_prompt"]
    assert submitted["message_body"]["tools"][0]["function"]["name"] == "inspect_uploaded_image_1"
    assert submitted["message_body"]["metadata"] == {
        "nash_msg_token": "client-user-1",
    }
    assert submitted["thread_id"] == "thread-1"
    assert submitted["run_id"] == "run-1"
    assert submitted["stream"] is True
    tool_output = json.loads(submitted["tool_outputs"][0]["output"])
    assert tool_output["__image_media_type"] == "image/png"
    assert tool_output["__image_base64"]


def test_stream_image_tool_turn_handles_sequential_tool_rounds(tmp_path, monkeypatch):
    first_path = tmp_path / "first.png"
    second_path = tmp_path / "second.png"
    first_path.write_bytes(b"first-image")
    second_path.write_bytes(b"second-image")
    submissions = []

    class Response:
        def json(self):
            return {
                "status": "REQUIRES_ACTION",
                "run_id": "run-1",
                "tool_calls": [{
                    "id": "call-1",
                    "function": {"name": "inspect_uploaded_image_1"},
                }],
            }

    class FakeClient:
        async def _make_request(self, method, endpoint, json_data=None):
            return Response()

        async def submit_tool_outputs(self, thread_id, run_id, tool_outputs, stream=False):
            submissions.append((run_id, tool_outputs))

            async def gen():
                if run_id == "run-1":
                    yield {
                        "type": "tool_submit_required",
                        "run_id": "run-2",
                        "tool_calls": [{
                            "id": "call-2",
                            "function": {"name": "inspect_uploaded_image_2"},
                        }],
                    }
                else:
                    yield {"type": "content_streaming", "content": "both images checked"}

            return gen()

    monkeypatch.setattr(chat, "get_user_client", lambda _: FakeClient())
    ctx = {
        "bb_api_key": "key",
        "thread_id": "thread-1",
        "model_text": "compare these images",
        "model": "openai/gpt-5.5",
        "bb_memory": "off",
        "image_model_provider": "",
        "image_model_name": "",
        "image_tool_files": [
            _image_file(first_path, file_id="img-1"),
            _image_file(second_path, file_id="img-2"),
        ],
    }

    async def collect():
        return [chunk async for chunk in chat._stream_image_tool_turn(ctx, None)]

    chunks = run_async(collect())

    assert chunks == [{"type": "content_streaming", "content": "both images checked"}]
    assert [run_id for run_id, _ in submissions] == ["run-1", "run-2"]
    assert "first-image" not in submissions[0][1][0]["output"]
    assert json.loads(submissions[0][1][0]["output"])["__image_base64"]
    assert json.loads(submissions[1][1][0]["output"])["__image_base64"]


def test_stream_image_tool_turn_stops_after_bounded_rounds(tmp_path, monkeypatch):
    image_path = tmp_path / "image.png"
    image_path.write_bytes(b"image")
    submissions = []

    class Response:
        def json(self):
            return {
                "status": "REQUIRES_ACTION",
                "run_id": "run-1",
                "tool_calls": [{
                    "id": "call-1",
                    "function": {"name": "inspect_uploaded_image_1"},
                }],
            }

    class FakeClient:
        async def _make_request(self, method, endpoint, json_data=None):
            return Response()

        async def submit_tool_outputs(self, thread_id, run_id, tool_outputs, stream=False):
            submissions.append(run_id)
            next_round = len(submissions) + 1

            async def gen():
                yield {
                    "type": "tool_submit_required",
                    "run_id": f"run-{next_round}",
                    "tool_calls": [{
                        "id": f"call-{next_round}",
                        "function": {"name": "inspect_uploaded_image_1"},
                    }],
                }

            return gen()

    monkeypatch.setattr(chat, "get_user_client", lambda _: FakeClient())
    ctx = {
        "bb_api_key": "key",
        "thread_id": "thread-1",
        "model_text": "inspect this image",
        "model": "openai/gpt-5.5",
        "bb_memory": "off",
        "image_model_provider": "",
        "image_model_name": "",
        "image_tool_files": [_image_file(image_path)],
    }

    async def collect():
        return [chunk async for chunk in chat._stream_image_tool_turn(ctx, None)]

    with pytest.raises(chat.BackboardAPIError, match="exceeded 3 rounds"):
        run_async(collect())

    assert submissions == ["run-1", "run-2", "run-3"]


def test_extract_run_id_accepts_backboard_response_shapes():
    assert chat._extract_run_id({"run_id": "run-top"}) == "run-top"
    assert chat._extract_run_id({"runId": "run-camel"}) == "run-camel"
    assert (
        chat._extract_run_id({
            "messages": [{"metadata": {"run_id": "run-metadata"}}],
        })
        == "run-metadata"
    )
