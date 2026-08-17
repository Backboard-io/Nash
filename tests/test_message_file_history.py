from api.routes import messages
from api.services.backboard_service import normalize_raw_messages, role_name
from api.services import conversation_service


def test_save_message_files_migrates_existing_conversation_metadata(monkeypatch):
    saved = {}
    monkeypatch.setattr(
        conversation_service.state_service.message_files,
        "get",
        lambda user_id, conversation_id: None,
    )
    monkeypatch.setattr(
        conversation_service,
        "get_conversation_meta",
        lambda user_id, conversation_id: {
            "messageFiles": {
                "msg-1": [{"file_id": "file-1", "filename": "one.png"}],
            },
        },
    )
    monkeypatch.setattr(
        conversation_service.state_service.message_files,
        "put",
        lambda user_id, conversation_id, row: saved.update(row),
    )

    conversation_service.save_message_files(
        "user-1",
        "convo-1",
        "msg-2",
        [{"file_id": "file-2", "filename": "two.png"}],
    )

    assert saved["files"] == {
        "msg-1": [{"file_id": "file-1", "filename": "one.png"}],
        "msg-2": [{"file_id": "file-2", "filename": "two.png"}],
    }


def test_attach_message_files_restores_files_by_message_id():
    msg = {"messageId": "msg-1", "text": "describe this"}
    files_map = {"msg-1": [{"file_id": "file-1", "filename": "image.png"}]}

    assert messages._attach_message_files(msg, files_map)["files"] == files_map["msg-1"]


def test_scrub_backboard_s3_removes_uploaded_image_tool_payload():
    text = (
        "A close-up of a handwritten note.\n\n"
        '{"text":"Uploaded image: note.jpg",'
        '"__image_media_type":"image/jpeg",'
        '"__image_base64":"abc123"}'
    )

    assert (
        messages._scrub_backboard_s3(text, "user-1")
        == "A close-up of a handwritten note."
    )


def test_scrub_backboard_s3_does_not_truncate_complete_keyless_payload():
    text = (
        'Before {"text":"Uploaded image: quoted.jpg","note":"no bytes"} '
        "and this must remain"
    )

    assert messages._scrub_backboard_s3(text, "user-1") == text


def test_normalize_raw_messages_preserves_tool_role():
    [msg] = normalize_raw_messages(
        [{"id": "tool-1", "role": "tool", "content": "{}", "created_at": None}]
    )

    assert msg.role == "tool"


def test_role_name_normalizes_enum_like_values():
    class Role:
        value = "tool"

    class Message:
        role = Role()

    assert role_name(Message()) == "tool"
