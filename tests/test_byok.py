"""Unit tests for BYOK encryption and DynamoDB session services.

The session table is mocked with moto — no real AWS access required.
Env vars come from tests/conftest.py.
"""

import pytest
from moto import mock_aws

from api.services.encryption_service import encrypt_key, decrypt_key


def test_encryption_roundtrip():
    for original in (
        "sk-proj-abc123def456",
        "sk-ant-api03-xxxxxxxxxxxx",
        "AIzaSyB-some-google-key",
    ):
        encrypted = encrypt_key(original)
        assert decrypt_key(encrypted) == original


def test_encryption_uses_random_nonce():
    """Same plaintext must encrypt to different ciphertexts each call."""
    enc1 = encrypt_key("sk-test-key")
    enc2 = encrypt_key("sk-test-key")
    assert enc1 != enc2
    assert decrypt_key(enc1) == "sk-test-key"
    assert decrypt_key(enc2) == "sk-test-key"


@mock_aws
def test_dynamo_session_lifecycle():
    """Exercise the full session-row lifecycle against moto-mocked DynamoDB."""
    from api.config import settings
    settings.dynamo_endpoint = ""

    from api.services.dynamo_service import (
        ensure_table,
        store_session,
        get_session,
        delete_session,
        refresh_session,
        generate_session_key,
    )

    ensure_table()

    sk = generate_session_key()
    assert sk.startswith("nash_sk_")

    encrypted = encrypt_key("sk-proj-test-key")
    store_session(
        session_key=sk,
        encrypted_key=encrypted,
        provider="openai",
        chat_assistant_id="chat-asst-123",
    )

    session = get_session(sk)
    assert session is not None
    assert session["provider"] == "openai"
    assert session["chat_assistant_id"] == "chat-asst-123"
    assert decrypt_key(session["encrypted_key"]) == "sk-proj-test-key"

    assert get_session("nash_sk_NOPE") is None

    assert refresh_session(sk) is True
    assert refresh_session("nash_sk_NOPE") is False

    assert delete_session(sk) is True
    assert get_session(sk) is None
    assert delete_session(sk) is False

    # Backward compat: store without assistant ID, get empty string back.
    sk2 = generate_session_key()
    store_session(session_key=sk2, encrypted_key=encrypted, provider="anthropic")
    session2 = get_session(sk2)
    assert session2["chat_assistant_id"] == ""
