"""GET /api/files/usage — the aggregate behind the Library rail.

The rail's three category cards, its "N files · X total" caption and its
storage meter all read this one payload, so the numbers can never disagree
with each other or with the file table (both are built from the same
deduplicated list).
"""

from unittest.mock import patch

from api.app import create_app
from api.config import settings
from api.services.session_cookie import SESSION_COOKIE_NAME

SESSION = {
    "api_key": "",
    "provider": "password",
    "chat_assistant_id": "asst-1",
    "user_id": "user-usage",
    "context_id": "",
    "auth_flow": "password",
}


def _row(file_id, mime, size, source="local"):
    return {
        "file_id": file_id,
        "filename": f"{file_id}.bin",
        "type": mime,
        "bytes": size,
        "source": source,
        "filepath": f"/uploads/x/{file_id}",
        "content_hash": file_id,
    }


def _client():
    app = create_app()
    app.config["TESTING"] = True
    c = app.test_client()
    c.set_cookie(SESSION_COOKIE_NAME, "nash_sk_usage")
    return c


def _authed():
    return (
        patch("api.middleware.session_auth._resolve_session", return_value=SESSION),
        patch("api.middleware.session_auth.dynamo_service.touch_session"),
    )


def _get(rows):
    client = _client()
    p1, p2 = _authed()
    with p1, p2, patch(
        "api.routes.files.state_service.file_meta.list_for_user", return_value=rows
    ):
        return client.get("/api/files/usage")


def test_usage_requires_auth():
    app = create_app()
    app.config["TESTING"] = True
    assert app.test_client().get("/api/files/usage").status_code == 401


def test_usage_empty_account_is_all_zeros():
    body = _get([]).get_json()
    assert body["usedBytes"] == 0
    assert body["fileCount"] == 0
    assert body["limitBytes"] == settings.storage_limit_bytes
    for name in ("documents", "images", "other"):
        assert body["byCategory"][name] == {"count": 0, "bytes": 0}


def test_usage_buckets_by_mime_and_sums_bytes():
    rows = [
        _row("a", "application/pdf", 100),
        _row("b", "text/plain; charset=utf-8", 50),  # parameters must be stripped
        _row("c", "image/png", 200),
        _row("d", "image/jpeg", 300),
        _row("e", "application/zip", 25),
        _row("f", "video/mp4", 5),
    ]
    body = _get(rows).get_json()

    assert body["byCategory"]["documents"] == {"count": 2, "bytes": 150}
    assert body["byCategory"]["images"] == {"count": 2, "bytes": 500}
    assert body["byCategory"]["other"] == {"count": 2, "bytes": 30}
    assert body["usedBytes"] == 680
    assert body["fileCount"] == 6
    # The parts must reconcile with the whole — this is the property the rail relies on.
    assert sum(c["bytes"] for c in body["byCategory"].values()) == body["usedBytes"]
    assert sum(c["count"] for c in body["byCategory"].values()) == body["fileCount"]


def test_usage_tolerates_missing_and_bad_sizes():
    rows = [
        _row("a", "image/png", None),
        _row("b", "image/png", "not-a-number"),
        _row("c", "image/png", -10),
        _row("d", "image/png", 42),
    ]
    body = _get(rows).get_json()
    assert body["usedBytes"] == 42
    assert body["fileCount"] == 4


def test_usage_counts_a_deduplicated_file_once():
    # Generated images arrive as several rows sharing a content hash; the file
    # table dedups them, so usage must not double-count.
    dupe = _row("g1", "image/png", 100, source="generated")
    other = dict(dupe, file_id="g2")
    body = _get([dupe, other]).get_json()
    assert body["fileCount"] == 1
    assert body["usedBytes"] == 100


def test_usage_limit_follows_settings(monkeypatch):
    monkeypatch.setattr(settings, "storage_limit_bytes", 12345)
    assert _get([]).get_json()["limitBytes"] == 12345


def test_serializer_falls_back_to_disk_mtime_for_legacy_rows(tmp_path, monkeypatch):
    """Rows written before timestamp stamping get an honest added-time from the
    stored file's own mtime — but only when no stamp exists."""
    import os
    from api.routes import files as files_mod

    monkeypatch.setattr(files_mod, "UPLOAD_DIR", str(tmp_path))
    f = tmp_path / "user" / "legacy.bin"
    f.parent.mkdir(parents=True)
    f.write_bytes(b"x")
    os.utime(f, (1700000000, 1700000000))  # 2023-11-14T22:13:20Z

    legacy = {"file_id": "legacy", "filepath": str(f), "type": "application/pdf"}
    out = files_mod._serialize_file_meta(legacy)
    assert out["createdAt"].startswith("2023-11-14")

    stamped = {
        "file_id": "stamped", "filepath": str(f), "type": "application/pdf",
        "createdAt": "2026-01-01T00:00:00+00:00",
    }
    out = files_mod._serialize_file_meta(stamped)
    assert out["createdAt"] == "2026-01-01T00:00:00+00:00"  # stamp wins over mtime

    # The download-path rewrite below the timestamp block touches flask.g for
    # off-upload-dir paths, so this sub-case needs a request context.
    from api.app import create_app

    app = create_app()
    with app.test_request_context('/'):
        outside = {"file_id": "o", "filepath": "/etc/hosts", "type": "text/plain"}
        out = files_mod._serialize_file_meta(outside)
    assert "createdAt" not in out  # never stat outside the upload dir


def test_file_meta_put_stamps_created_at_once(monkeypatch):
    from api.services import state_service

    written = {}
    monkeypatch.setattr(state_service, "put_item", lambda pk, sk, attrs: written.update(attrs))

    state_service.file_meta.put("u", "f1", {"file_id": "f1"})
    first = written["createdAt"]
    assert first  # stamped on first write

    written.clear()
    state_service.file_meta.put("u", "f1", {"file_id": "f1", "createdAt": "2020-01-01T00:00:00+00:00"})
    assert written["createdAt"] == "2020-01-01T00:00:00+00:00"  # setdefault, not overwrite
