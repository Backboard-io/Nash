"""User avatar storage on a dedicated S3 bucket.

Design: avatars live in their own bucket under unguessable keys
(``avatars/<sha256(user_id)[:16]>/<uuid>.<ext>``) that are publicly readable
via a bucket policy scoped to ``avatars/*``. The user segment is hashed
because user ids can be emails and the key is part of a public URL. The stored URL is therefore permanent —
no presigning, no expiry, no per-view backend load. Re-uploading rotates the
uuid, which both cache-busts and invalidates the old URL (the old object is
deleted).

When no bucket is configured (``AVATAR_BUCKET`` empty) we fall back to the
pre-existing local-disk layout served by the Flask route, so local dev works
with zero AWS setup.
"""

from __future__ import annotations

import hashlib
import logging
import posixpath
import uuid

import boto3
from botocore.config import Config as BotoConfig
from botocore.exceptions import BotoCoreError, ClientError

from api.config import settings

logger = logging.getLogger(__name__)

_ALLOWED_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp"}
_CONTENT_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
}


def s3_enabled() -> bool:
    return bool(settings.avatar_bucket)


def _client():
    kwargs = {
        "region_name": settings.avatar_s3_region or "us-east-1",
        "config": BotoConfig(retries={"max_attempts": 3, "mode": "standard"}),
    }
    if settings.avatar_s3_endpoint:
        kwargs["endpoint_url"] = settings.avatar_s3_endpoint
    return boto3.client("s3", **kwargs)


def normalize_ext(filename: str | None) -> str:
    ext = posixpath.splitext(filename or "")[1].lower()
    return ext if ext in _ALLOWED_EXT else ".png"


def _user_prefix(user_id: str) -> str:
    """Opaque per-user key prefix.

    User ids can be email addresses; the key is part of a PUBLIC URL, so the
    raw id must never appear in it. A truncated sha256 keeps the prefix
    deterministic (delete/replace find prior objects) without leaking PII.
    """
    digest = hashlib.sha256(user_id.encode("utf-8")).hexdigest()[:16]
    return f"avatars/{digest}/"


def public_url(key: str) -> str:
    base = settings.avatar_public_base_url.rstrip("/")
    if base:
        return f"{base}/{key}"
    if settings.avatar_s3_endpoint:
        # moto / custom endpoint: path-style
        return f"{settings.avatar_s3_endpoint.rstrip('/')}/{settings.avatar_bucket}/{key}"
    region = settings.avatar_s3_region or "us-east-1"
    return f"https://{settings.avatar_bucket}.s3.{region}.amazonaws.com/{key}"


def store_avatar(user_id: str, data: bytes, filename: str | None) -> str:
    """Upload a user's avatar and return its permanent public URL.

    Deletes any previous avatar objects for the user so exactly one object
    exists per user and stale URLs stop resolving.
    """
    ext = normalize_ext(filename)
    key = f"{_user_prefix(user_id)}{uuid.uuid4().hex}{ext}"
    client = _client()
    old_keys = _list_user_keys(client, user_id)

    client.put_object(
        Bucket=settings.avatar_bucket,
        Key=key,
        Body=data,
        ContentType=_CONTENT_TYPES[ext],
        CacheControl="public, max-age=31536000, immutable",
    )

    for old in old_keys:
        try:
            client.delete_object(Bucket=settings.avatar_bucket, Key=old)
        except (ClientError, BotoCoreError):
            logger.warning("Failed to delete previous avatar %s", old, exc_info=True)

    return public_url(key)


def delete_avatar(user_id: str) -> None:
    client = _client()
    for key in _list_user_keys(client, user_id):
        try:
            client.delete_object(Bucket=settings.avatar_bucket, Key=key)
        except (ClientError, BotoCoreError):
            logger.warning("Failed to delete avatar %s", key, exc_info=True)


def _list_user_keys(client, user_id: str) -> list[str]:
    try:
        resp = client.list_objects_v2(
            Bucket=settings.avatar_bucket, Prefix=_user_prefix(user_id)
        )
    except (ClientError, BotoCoreError):
        logger.warning("Failed to list avatars for %s", user_id, exc_info=True)
        return []
    return [obj["Key"] for obj in resp.get("Contents", [])]
