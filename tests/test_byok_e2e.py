"""E2E test for the BYOK session-key flow.

After the JWT removal, /api/keys requires no Bearer token — submitting a valid
BYOK key IS the auth act. DynamoDB stays a blind store: session_key →
encrypted key, no user identity.

Run as a standalone script (not pytest-collected — the Makefile passes
``--ignore=tests/test_byok_e2e.py`` to pytest)::

    .venv/bin/python tests/test_byok_e2e.py
"""
import os
import sys

# Env vars must be set BEFORE importing api.config so Settings picks them up.
os.environ.setdefault("DYNAMO_ENDPOINT", "")
os.environ.setdefault("DYNAMO_TABLE", "nash_keys_e2e")
os.environ.setdefault("DYNAMO_STATE_TABLE", "nash_state_e2e")
os.environ.setdefault("DYNAMO_REGION", "us-east-1")
os.environ.setdefault("ENCRYPTION_KEY", "e2e-test-encryption-key-32chars!")
os.environ.setdefault("FLASK_SECRET_KEY", "e2e-flask-secret-key-32-chars-ok")
os.environ.setdefault("BACKBOARD_API_KEY", "test")
os.environ.setdefault("AWS_ACCESS_KEY_ID", "testing")
os.environ.setdefault("AWS_SECRET_ACCESS_KEY", "testing")
os.environ.setdefault("AWS_SESSION_TOKEN", "testing")

from unittest.mock import MagicMock

from moto import mock_aws


passed = 0
failed = 0


def ok(msg):
    global passed
    passed += 1
    print(f"  PASS: {msg}")


def fail(msg, detail=""):
    global failed
    failed += 1
    print(f"  FAIL: {msg} {detail}")


@mock_aws
def run_e2e():
    global passed, failed

    from api.config import settings
    settings.dynamo_endpoint = ""

    from api.app import create_app
    app = create_app()
    c = app.test_client()

    # Mock the Backboard side: list_assistants validates the key (returns
    # without error) and create_assistant persists into a tiny in-memory store
    # so ensure_nash_main_assistant's discover→create→re-discover cycle works.
    _assistants_store: list[MagicMock] = []
    _counter = [0]
    mock_client = MagicMock()

    async def _list_assistants(skip: int = 0, limit: int = 100):
        return _assistants_store[skip:skip + limit]

    async def _create_assistant(**kwargs):
        _counter[0] += 1
        rec = MagicMock()
        rec.assistant_id = f"mock-asst-{_counter[0]:04d}"
        rec.name = kwargs.get("name") or ""
        rec.created_at = f"2026-01-01T00:00:{_counter[0]:02d}Z"
        _assistants_store.append(rec)
        return rec

    mock_client.list_assistants = _list_assistants
    mock_client.create_assistant = _create_assistant

    def _fake_run_async(coro):
        import asyncio
        if asyncio.iscoroutine(coro):
            loop = asyncio.new_event_loop()
            try:
                return loop.run_until_complete(coro)
            finally:
                loop.close()
        return coro

    import api.routes.keys as keys_module
    keys_module.get_user_client = lambda api_key: mock_client
    keys_module.run_async = _fake_run_async

    print("=" * 60)
    print("E2E TEST: BYOK Session-Key Flow")
    print("=" * 60)

    r = c.get("/api/health")
    assert r.status_code == 200, f"Got {r.status_code}"
    ok("Health check")

    # Store OpenAI key → session_key
    r = c.post("/api/keys", json={
        "provider": "openai",
        "apiKey": "sk-proj-REAL-OPENAI-KEY-12345",
    })
    assert r.status_code == 200, f"Got {r.status_code}: {r.data!r}"
    data = r.get_json()
    assert data["session_key"].startswith("nash_sk_")
    assert data["provider"] == "openai"
    assert data["ttl_hours"] == settings.session_ttl_days * 24
    openai_session = data["session_key"]
    ok(f"Stored OpenAI key → session_key={openai_session[:20]}...")

    # Store Anthropic key → separate session_key
    r = c.post("/api/keys", json={
        "provider": "anthropic",
        "apiKey": "sk-ant-REAL-ANTHROPIC-KEY-67890",
    })
    assert r.status_code == 200
    anthropic_session = r.get_json()["session_key"]
    assert anthropic_session != openai_session
    ok("Stored Anthropic key → different session_key")

    # Verify
    r = c.post("/api/keys/verify", json={"session_key": openai_session})
    assert r.status_code == 200
    assert r.get_json()["valid"] is True
    assert r.get_json()["provider"] == "openai"
    ok("Verify: OpenAI session is valid")

    r = c.post("/api/keys/verify", json={"session_key": "nash_sk_GARBAGE"})
    assert r.get_json()["valid"] is False
    ok("Verify: invalid session_key returns valid=false")

    # Internal decrypt — what the chat route would do
    from api.routes.keys import get_decrypted_key
    with app.app_context():
        key, provider = get_decrypted_key(openai_session)
        assert key == "sk-proj-REAL-OPENAI-KEY-12345"
        assert provider == "openai"
    ok("Internal decrypt: OpenAI key matches")

    with app.app_context():
        key, _ = get_decrypted_key("nash_sk_NONEXISTENT")
        assert key is None
    ok("Internal decrypt: non-existent session returns None")

    # Raw DynamoDB scan — confirm no user identity in the session row
    from api.services.dynamo_service import _get_table
    table = _get_table()
    items = table.scan()["Items"]
    for item in items:
        assert "email" not in item, "LEAKED: email in DynamoDB session row"
        assert "pk" not in item, "LEAKED: legacy pk in DynamoDB session row"
    ok(f"DynamoDB has {len(items)} sessions — no email or legacy-pk leakage")

    # Refresh
    r = c.post("/api/keys/refresh", json={"session_key": openai_session})
    assert r.status_code == 200
    ok("Refresh: session TTL extended")

    r = c.post("/api/keys/refresh", json={"session_key": "nash_sk_GONE"})
    assert r.status_code == 404
    ok("Refresh: non-existent session returns 404")

    # Revoke
    r = c.delete(
        "/api/keys",
        headers={"Content-Type": "application/json"},
        json={"session_key": anthropic_session},
    )
    assert r.status_code == 200
    ok("Revoke: Anthropic session deleted")

    r = c.post("/api/keys/verify", json={"session_key": anthropic_session})
    assert r.get_json()["valid"] is False
    ok("Verify: revoked session returns valid=false")

    with app.app_context():
        key, _ = get_decrypted_key(openai_session)
        assert key == "sk-proj-REAL-OPENAI-KEY-12345"
    ok("Other session unaffected by revocation")

    r = c.delete(
        "/api/keys",
        headers={"Content-Type": "application/json"},
        json={"session_key": "nash_sk_NOPE"},
    )
    assert r.status_code == 404
    ok("Revoke: non-existent session returns 404")

    # Validation
    r = c.post("/api/keys", json={"provider": "bad_provider", "apiKey": "x"})
    assert r.status_code == 400
    ok("Validation: bad provider rejected")

    r = c.post("/api/keys", json={"provider": "openai", "apiKey": ""})
    assert r.status_code == 400
    ok("Validation: empty apiKey rejected")

    r = c.post("/api/keys", json={"provider": "openai"})
    assert r.status_code == 400
    ok("Validation: missing apiKey rejected")

    # Expired session
    original_ttl = settings.session_ttl_days
    settings.session_ttl_days = 0
    r = c.post("/api/keys", json={"provider": "google", "apiKey": "AIzaSy-EXPIRED-KEY"})
    assert r.status_code == 200
    expired_session = r.get_json()["session_key"]
    settings.session_ttl_days = original_ttl

    r = c.post("/api/keys/verify", json={"session_key": expired_session})
    assert r.get_json()["valid"] is False
    ok("Expired session returns valid=false")

    with app.app_context():
        key, _ = get_decrypted_key(expired_session)
        assert key is None
    ok("Internal decrypt: expired session returns None")

    print()
    print("=" * 60)
    print(f"  Results: {passed} passed, {failed} failed")
    if failed == 0:
        print("  ALL E2E TESTS PASSED")
    else:
        print("  SOME TESTS FAILED")
    print("=" * 60)
    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    run_e2e()
