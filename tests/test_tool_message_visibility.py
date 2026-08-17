"""Tool-call result messages must not appear as duplicate assistant turns."""

from api.services.backboard_service import (
    _ThreadMessage,
    is_user_visible_message,
    normalize_raw_messages,
)


def test_normalize_raw_messages_preserves_tool_role():
    raw = [
        {"id": "u1", "role": "user", "content": "make me an excel file"},
        {
            "id": "t1",
            "role": "tool",
            "content": '{"filename": "sales.xlsx", "url": "/api/files/download/user/export_1"}',
        },
        {
            "id": "a1",
            "role": "assistant",
            "content": "Here is your Excel file.\n\n[Download sales.xlsx](/api/files/download/user/export_1)",
        },
    ]

    messages = normalize_raw_messages(raw)

    assert [m.role for m in messages] == ["user", "tool", "assistant"]
    assert is_user_visible_message(messages[0]) is True
    assert is_user_visible_message(messages[1]) is False
    assert is_user_visible_message(messages[2]) is True

    visible = [m for m in messages if is_user_visible_message(m)]
    assert len(visible) == 2
    assert visible[1].content.startswith("Here is your Excel file")


def test_hides_empty_assistant_tool_call_stub():
    stub = _ThreadMessage("a0", "", "assistant", None)
    assert is_user_visible_message(stub) is False


def test_hides_enum_valued_tool_and_empty_assistant_roles():
    class Role:
        def __init__(self, value):
            self.value = value

    tool = _ThreadMessage("t1", "internal output", Role("tool"), None)
    stub = _ThreadMessage("a0", "", Role("assistant"), None)

    assert is_user_visible_message(tool) is False
    assert is_user_visible_message(stub) is False


def test_hides_export_json_leaked_as_assistant():
    leaked = _ThreadMessage(
        "a0",
        '{"filename": "sales.xlsx", "url": "/api/files/download/user/export_1", "bytes": 123}',
        "assistant",
        None,
    )
    assert is_user_visible_message(leaked) is False


def test_document_export_thread_keeps_only_user_and_summary():
    messages = [
        _ThreadMessage("u1", "make me an excel file", "user", None),
        _ThreadMessage("a0", "", "assistant", None),
        _ThreadMessage(
            "t1",
            '{"filename": "sales.xlsx", "url": "/api/files/download/user/export_1"}',
            "tool",
            None,
        ),
        _ThreadMessage(
            "a1",
            "Here is your Excel file.\n\n[Download sales.xlsx](/api/files/download/user/export_1)",
            "assistant",
            None,
        ),
    ]

    visible = [m for m in messages if is_user_visible_message(m)]
    assert len(visible) == 2
    assert visible[0].role == "user"
    assert visible[1].role == "assistant"
    assert visible[1].content.startswith("Here is your Excel file")
