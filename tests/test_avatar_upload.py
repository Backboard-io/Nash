"""Avatar upload : dedicated S3 bucket with permanent public URLs.

The avatar_service S3 behavior (unguessable keys, old-object deletion,
public-read via the avatars/* bucket policy, cache headers) is exercised
against real S3 semantics via moto; these tests cover the route contract:
auth, size limit, S3-vs-local-disk mode selection, and persisting the URL
onto the user record.
"""

import io
from unittest.mock import patch

from api.app import create_app
from api.config import settings
from api.services import avatar_service
from api.services.session_cookie import SESSION_COOKIE_NAME

PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
) + b"\x00" * 32

USER = {
    "id": "user-1",
    "email": "user@example.com",
    "name": "Avatar User",
    "username": "user@example.com",
    "provider": "password",
    "role": "USER",
}

SESSION = {
    "api_key": "",
    "provider": "password",
    "chat_assistant_id": "asst-1",
    "user_id": USER["id"],
    "context_id": "",
    "auth_flow": "password",
}


def _client():
    app = create_app()
    app.config["TESTING"] = True
    client = app.test_client()
    client.set_cookie(SESSION_COOKIE_NAME, "nash_sk_avatar_test")
    return client


def _post_avatar(client, data=PNG, filename="me.png"):
    return client.post(
        "/api/files/images/avatar",
        data={"file": (io.BytesIO(data), filename)},
        content_type="multipart/form-data",
    )


def _authed(**extra_patches):
    return (
        patch("api.middleware.session_auth._resolve_session", return_value=SESSION),
        patch("api.middleware.session_auth.dynamo_service.touch_session"),
    )


def test_avatar_upload_requires_auth():
    app = create_app()
    app.config["TESTING"] = True
    response = _post_avatar(app.test_client())
    assert response.status_code == 401


def test_avatar_upload_rejects_oversize():
    client = _client()
    p1, p2 = _authed()
    with p1, p2:
        response = _post_avatar(client, data=b"x" * (2 * 1024 * 1024 + 1))
    assert response.status_code == 413


def test_avatar_upload_s3_mode_stores_and_persists_url(monkeypatch):
    monkeypatch.setattr(settings, "avatar_bucket", "test-avatar-bucket")
    client = _client()
    stored_url = (
        "https://test-avatar-bucket.s3.us-west-2.amazonaws.com/"
        "avatars/0a0b0c/abc123.png"
    )
    p1, p2 = _authed()
    with p1, p2, patch(
        "api.routes.files.avatar_service.store_avatar", return_value=stored_url
    ) as store, patch(
        "api.routes.files.find_user_by_id", return_value=dict(USER)
    ), patch(
        "api.routes.files.update_user_field"
    ) as update:
        response = _post_avatar(client)

    assert response.status_code == 200
    assert response.get_json()["url"] == stored_url
    user_id, data, filename = store.call_args.args
    assert user_id == USER["id"]
    assert data == PNG
    assert filename == "me.png"
    assert update.call_args.args[1:] == ("avatar", stored_url)


def test_avatar_upload_s3_failure_returns_500(monkeypatch):
    monkeypatch.setattr(settings, "avatar_bucket", "test-avatar-bucket")
    client = _client()
    p1, p2 = _authed()
    with p1, p2, patch(
        "api.routes.files.avatar_service.store_avatar",
        side_effect=RuntimeError("s3 down"),
    ):
        response = _post_avatar(client)
    assert response.status_code == 500


def test_avatar_upload_local_fallback_without_bucket(tmp_path, monkeypatch):
    assert settings.avatar_bucket == ""  # conftest leaves this unset
    monkeypatch.setattr("api.routes.files.UPLOAD_DIR", str(tmp_path))
    client = _client()
    p1, p2 = _authed()
    with p1, p2, patch(
        "api.routes.files.find_user_by_id", return_value=dict(USER)
    ), patch("api.routes.files.update_user_field"):
        response = _post_avatar(client)

    assert response.status_code == 200
    assert response.get_json()["url"] == f"/api/files/images/user/{USER['id']}/avatar"
    assert (tmp_path / USER["id"] / "avatar" / "avatar.png").read_bytes() == PNG


def test_public_url_shapes(monkeypatch):
    monkeypatch.setattr(settings, "avatar_bucket", "b")
    monkeypatch.setattr(settings, "avatar_s3_endpoint", "")
    monkeypatch.setattr(settings, "avatar_s3_region", "us-west-2")
    monkeypatch.setattr(settings, "avatar_public_base_url", "")
    assert (
        avatar_service.public_url("avatars/u/x.png")
        == "https://b.s3.us-west-2.amazonaws.com/avatars/u/x.png"
    )
    # CDN base overrides
    monkeypatch.setattr(settings, "avatar_public_base_url", "https://cdn.nash.app/")
    assert avatar_service.public_url("avatars/u/x.png") == (
        "https://cdn.nash.app/avatars/u/x.png"
    )
    # moto/path-style
    monkeypatch.setattr(settings, "avatar_public_base_url", "")
    monkeypatch.setattr(settings, "avatar_s3_endpoint", "http://localhost:8100")
    assert avatar_service.public_url("avatars/u/x.png") == (
        "http://localhost:8100/b/avatars/u/x.png"
    )


def test_user_prefix_never_leaks_the_raw_id():
    prefix = avatar_service._user_prefix("claire@nash.test")
    assert "claire" not in prefix and "@" not in prefix
    assert prefix.startswith("avatars/") and prefix.endswith("/")
    # deterministic — replace/delete must find prior objects
    assert prefix == avatar_service._user_prefix("claire@nash.test")
