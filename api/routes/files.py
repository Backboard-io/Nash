import glob
from datetime import datetime, timezone
import logging
import os
import time
import uuid

from flask import Blueprint, Response, request, jsonify, g, send_file
from werkzeug.utils import secure_filename

from api.config import settings
from api.middleware.session_auth import require_auth
from api.services import avatar_service, context_service, state_service
from api.services.async_runner import run_async
from api.services.backboard_service import (
    get_request_client,
    get_request_state_partition,
)
from api.services.export_service import (
    build_export,
    export_content_type,
    is_supported_export,
)
from api.services.user_service import find_user_by_id, update_user_field

files_bp = Blueprint("files", __name__)
logger = logging.getLogger(__name__)


def _user_bb_client():
    return get_request_client()


def _upload_dir_key() -> str:
    """Directory key for uploads.

    Sessions keep the exact historical `g.user_id or g.session_key` value —
    download URLs minted at upload time embed this key, so it must stay
    byte-identical for existing files.
    """
    base = getattr(g, "user_id", None) or getattr(g, "session_key", None) or "anonymous"
    return context_service.fs_safe_partition(base)


UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)


def _serialize_file_meta(row: dict) -> dict:
    # media_url is the server-side presigned S3 source for generated images
    # (see chat.refetch_generated_image) — the bucket origin must never reach
    # the client.
    result = {k: v for k, v in row.items() if k not in ("pk", "sk", "media_url")}
    file_id = str(result.get("file_id") or "")
    filepath = str(result.get("filepath") or "")
    # Legacy rows predate timestamp stamping entirely, which left the client's
    # Modified column blank for every old upload. The stored file's own mtime
    # is an honest added-time for those — only consulted when no stamp exists,
    # and only for files that genuinely live under UPLOAD_DIR.
    if not result.get("updatedAt") and not result.get("createdAt") and filepath:
        try:
            real_upload_dir = os.path.realpath(UPLOAD_DIR)
            real_filepath = os.path.realpath(filepath)
            if os.path.commonpath([real_upload_dir, real_filepath]) == real_upload_dir:
                mtime = os.path.getmtime(real_filepath)
                result["createdAt"] = datetime.fromtimestamp(mtime, timezone.utc).isoformat()
        except (OSError, ValueError):
            pass
    if not file_id or not filepath:
        return result
    if filepath.startswith(("/api/files/download/", "http://", "https://", "blob:", "data:")):
        return result

    dir_key = ""
    try:
        real_upload_dir = os.path.realpath(UPLOAD_DIR)
        real_filepath = os.path.realpath(filepath)
        if os.path.commonpath([real_upload_dir, real_filepath]) == real_upload_dir:
            rel_path = os.path.relpath(real_filepath, real_upload_dir)
            first_part = rel_path.split(os.sep, 1)[0]
            if first_part and first_part not in (".", ".."):
                dir_key = first_part
    except (OSError, ValueError):
        dir_key = ""

    if not dir_key:
        dir_key = _upload_dir_key()
    result["filepath"] = f"/api/files/download/{dir_key}/{file_id}"
    return result


def _safe_upload_path(user_dir: str, file_id: str, raw_filename: str) -> str:
    """Build the on-disk path for an upload, guaranteeing it stays inside
    ``user_dir``.

    The client controls ``raw_filename``; a value like ``../../etc/cron.d/x``
    would otherwise let ``os.path.join`` escape the per-user directory and
    overwrite arbitrary files. ``secure_filename`` strips directory separators
    and ``..`` segments; we then resolve the result and re-assert containment
    as defense-in-depth. Raises ``ValueError`` if the path escapes.
    """
    safe = secure_filename(raw_filename or "") or file_id
    filepath = os.path.join(user_dir, f"{file_id}_{safe}")
    real_dir = os.path.realpath(user_dir)
    if os.path.commonpath([real_dir, os.path.realpath(filepath)]) != real_dir:
        raise ValueError("upload path escapes user directory")
    return filepath


def _deduped_user_files(user_id: str) -> list[dict]:
    """The caller's file list, deduplicated and serialized.

    Shared by GET /api/files and GET /api/files/usage so the table and the
    usage summary can never disagree about what the account contains.
    """
    rows = state_service.file_meta.list_for_user(user_id)
    # Deduplicate the file list. Backboard emits multiple media_generated
    # events (with distinct document_ids) for the same generated image, so we
    # dedup by content: a stored content_hash when present, else a
    # (source, bytes, type) signature for rows persisted before hashing.
    seen_file_ids: set[str] = set()
    seen_signatures: set[str] = set()
    serialized: list[dict] = []
    for row in rows:
        file_id = str(row.get("file_id") or "")
        if file_id and file_id in seen_file_ids:
            continue

        is_generated = (row.get("source") or "") == "generated"
        # Generated rows that never finished downloading (pre-recorded by the
        # persist worker, then failed/expired) have no local file to serve —
        # keep them out of the file list. They stay in file_meta so the
        # download-route heal can still resolve them.
        if is_generated and not row.get("filepath") and row.get("status") != "indexed":
            continue

        content_hash = str(row.get("content_hash") or "")
        if content_hash:
            signature = f"hash:{content_hash}"
        elif row.get("bytes"):
            signature = "sig:{}:{}:{}".format(
                row.get("source") or "",
                row.get("bytes") or "",
                row.get("type") or "",
            )
        else:
            # No hash and no size: the (source, "", type) tuple would collapse
            # DISTINCT images into one entry — key on identity instead.
            signature = "sig:{}:{}:{}".format(
                row.get("source") or "",
                row.get("document_id") or file_id,
                row.get("type") or "",
            )
        # Only dedup by signature for generated images — uploaded files with
        # identical size/type are legitimately distinct.
        if is_generated and signature in seen_signatures:
            continue

        if file_id:
            seen_file_ids.add(file_id)
        if is_generated:
            seen_signatures.add(signature)
        serialized.append(_serialize_file_meta(row))
    return serialized


@files_bp.route("/api/files", methods=["GET"])
@require_auth
def list_files():
    return jsonify(_deduped_user_files(get_request_state_partition()))


# Mirrors the client's Library categorisation. Kept server-side so the storage
# meter and the Documents/Images/Other cards are computed from one rule.
_DOCUMENT_MIME_PREFIXES = (
    "text/",
    "application/pdf",
    "application/json",
    "application/xml",
    "application/rtf",
    "application/epub",
    "application/msword",
    "application/vnd.ms-",
    "application/vnd.oasis.opendocument",
    "application/vnd.openxmlformats-officedocument",
)


def _usage_category(mime: str) -> str:
    # A MIME type may carry parameters ("text/plain; charset=utf-8").
    base = (mime or "").split(";", 1)[0].strip().lower()
    if base.startswith("image/"):
        return "images"
    if base.startswith(_DOCUMENT_MIME_PREFIXES):
        return "documents"
    return "other"


@files_bp.route("/api/files/usage", methods=["GET"])
@require_auth
def files_usage():
    """Aggregate storage usage for the Library's rail.

    Returns the same numbers the file table is built from, so the cards, the
    total and the meter cannot drift apart. `limitBytes` is a display ceiling
    (STORAGE_LIMIT_BYTES), not an enforced quota — nothing rejects an upload
    for exceeding it.
    """
    files = _deduped_user_files(get_request_state_partition())
    by_category = {
        name: {"count": 0, "bytes": 0} for name in ("documents", "images", "other")
    }
    used = 0
    for f in files:
        try:
            size = int(f.get("bytes") or 0)
        except (TypeError, ValueError):
            size = 0
        if size < 0:
            size = 0
        bucket = by_category[_usage_category(str(f.get("type") or ""))]
        bucket["count"] += 1
        bucket["bytes"] += size
        used += size

    return jsonify(
        {
            "usedBytes": used,
            "fileCount": len(files),
            "limitBytes": int(settings.storage_limit_bytes),
            "byCategory": by_category,
        }
    )


@files_bp.route("/api/files", methods=["POST"])
@require_auth
def upload_file():
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files["file"]
    client_file_id = request.form.get("file_id")
    file_id = str(uuid.uuid4())
    filename = file.filename or "unknown"
    user_id = get_request_state_partition()
    dir_key = _upload_dir_key()
    user_dir = os.path.join(UPLOAD_DIR, dir_key)
    os.makedirs(user_dir, exist_ok=True)
    try:
        filepath = _safe_upload_path(user_dir, file_id, filename)
    except ValueError:
        return jsonify({"error": "Invalid filename"}), 400
    file.save(filepath)

    file_size = os.path.getsize(filepath)
    content_type = file.content_type or "application/octet-stream"

    # Persist the disk path internally; the response surface uses a
    # browser-loadable URL pointing at /api/files/download/<dir>/<file_id>.
    # The chat handler matches by file_id, so the disk path is never sent
    # back to or from the client.
    file_meta = {
        "file_id": file_id,
        "filename": filename,
        "bytes": file_size,
        "type": content_type,
        "source": "local",
        "filepath": filepath,
        "status": "pending",
    }
    state_service.file_meta.put(user_id, file_id, file_meta)

    result = dict(file_meta)
    result["filepath"] = f"/api/files/download/{dir_key}/{file_id}"
    if client_file_id:
        result["temp_file_id"] = client_file_id
    return jsonify(result)


def _authorize_download_dir(url_dir: str) -> str | None:
    """Resolve the directory a download URL may serve from, or None (403).

    The URL segment is minted at upload time; it must equal the caller's
    identity.
    """
    base_identity = getattr(g, "user_id", None) or getattr(g, "session_key", None) or ""
    if url_dir == base_identity or url_dir == context_service.fs_safe_partition(base_identity):
        return url_dir
    return None


@files_bp.route("/api/files/download/<user_id>/<file_id>", methods=["GET"])
@require_auth
def download_file(user_id, file_id):
    current_dir = _authorize_download_dir(user_id)
    logger.info(
        "download_file: user_id=%s file_id=%s current_dir=%s",
        user_id,
        file_id,
        current_dir,
    )
    if current_dir is None:
        return jsonify({"error": "Forbidden"}), 403

    user_dir = os.path.join(UPLOAD_DIR, current_dir)

    def _serve_if_exists():
        if not os.path.isdir(user_dir):
            return None
        for fname in os.listdir(user_dir):
            # Ignore .partial atomic-rename leftovers from the image-persist
            # thread; only serve fully-written files.
            if fname.startswith(file_id) and not fname.endswith(".partial"):
                logger.info(
                    "download_file: serving file_id=%s fname=%s dir=%s",
                    file_id,
                    fname,
                    current_dir,
                )
                # Generated document exports (PDF/Word/etc.) must be forced to
                # DOWNLOAD. Served inline the browser opens a PDF in-tab or, for
                # Word, does nothing — the file never lands on disk for the user.
                # Images stay inline so they render via <img>. The on-disk name is
                # "{file_id}_{original}"; hand back the original as the save name.
                if file_id.startswith("export_"):
                    download_name = fname[len(file_id) + 1:] if len(fname) > len(file_id) + 1 else fname
                    return send_file(
                        os.path.join(user_dir, fname),
                        as_attachment=True,
                        download_name=download_name,
                    )
                return send_file(os.path.join(user_dir, fname))
        return None

    response = _serve_if_exists()
    if response is not None:
        return response

    # Generated images and generated voice audio are written async after the
    # streaming endpoint emits the /api/files/download URL. If the browser
    # races us to the file, wait briefly on the in-flight download instead of
    # 404-ing.
    if file_id.startswith("generated_"):
        from api.routes.chat import refetch_generated_image, wait_for_pending_image
        if wait_for_pending_image(file_id, timeout=15):
            response = _serve_if_exists()
            if response is not None:
                return response
        # No in-flight download produced the file (persist thread died — e.g.
        # a dev-server reload — or its retries were exhausted). Heal from the
        # presigned URL recorded in file_meta while it's still valid. The
        # FILEMETA partition is derived from the AUTHORIZED directory (image
        # loads carry no workspace header, so the request partition would be
        # personal even for an org file).
        heal_partition = current_dir.replace("_NORG_", "#NORG#").replace("_ORG_", "#ORG#")
        if refetch_generated_image(heal_partition, current_dir, file_id):
            response = _serve_if_exists()
            if response is not None:
                return response
    elif file_id.startswith("voice_"):
        from api.routes.voice import wait_for_pending_voice_audio
        if wait_for_pending_voice_audio(file_id, timeout=15):
            response = _serve_if_exists()
            if response is not None:
                return response

    return jsonify({"error": "Not found"}), 404


@files_bp.route("/api/files", methods=["DELETE"])
@require_auth
def delete_file():
    data = request.get_json(silent=True) or {}
    file_ids = []
    if "files" in data and isinstance(data["files"], list):
        for f in data["files"]:
            if isinstance(f, dict) and f.get("file_id"):
                file_ids.append(f["file_id"])
    single = data.get("file_id") or request.args.get("file_id")
    if single:
        file_ids.append(single)

    if not file_ids:
        return jsonify({"message": "Deleted"})

    user_id = get_request_state_partition()
    bb = _user_bb_client()

    for file_id in file_ids:
        row = state_service.file_meta.get(user_id, file_id)
        if not row:
            continue
        doc_id = row.get("document_id")
        if doc_id:
            async def _del_doc(did=doc_id):
                try:
                    await bb.delete_document(did)
                except Exception as e:
                    logger.warning("Failed to delete Backboard document %s: %s", did, e)
            run_async(_del_doc())
        local_path = row.get("filepath", "")
        if local_path and os.path.exists(local_path):
            try:
                os.remove(local_path)
            except OSError:
                pass
        state_service.file_meta.delete(user_id, file_id)

    return jsonify({"message": "Deleted"})


@files_bp.route("/api/files/config", methods=["GET"])
@require_auth
def file_config():
    return jsonify({
        "endpoints": {},
        "serverFileSizeLimit": 50 * 1024 * 1024,
        "avatarSizeLimit": AVATAR_SIZE_LIMIT,
    })


@files_bp.route("/api/files/export", methods=["POST"])
@require_auth
def export_file():
    data = request.get_json(silent=True) or {}
    filename = secure_filename(str(data.get("filename") or "")).strip()
    content = str(data.get("content") or "")

    if not filename:
        return jsonify({"error": "filename required"}), 400
    if not is_supported_export(filename):
        return jsonify({"error": "Unsupported export file type"}), 400
    if not content.strip():
        return jsonify({"error": "content required"}), 400
    if len(content.encode("utf-8")) > 2 * 1024 * 1024:
        return jsonify({"error": "content exceeds 2 MB"}), 400

    payload = build_export(filename, content)
    return Response(
        payload,
        mimetype=export_content_type(filename),
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(len(payload)),
            "X-Content-Type-Options": "nosniff",
        },
    )


@files_bp.route("/api/files/images", methods=["POST"])
@require_auth
def upload_image():
    """Image upload endpoint - mirrors /api/files but used for image attachments."""
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files["file"]
    client_file_id = request.form.get("file_id")
    file_id = str(uuid.uuid4())
    filename = file.filename or "unknown"
    user_id = get_request_state_partition()
    dir_key = _upload_dir_key()
    user_dir = os.path.join(UPLOAD_DIR, dir_key)
    os.makedirs(user_dir, exist_ok=True)
    try:
        filepath = _safe_upload_path(user_dir, file_id, filename)
    except ValueError:
        return jsonify({"error": "Invalid filename"}), 400
    file.save(filepath)

    file_size = os.path.getsize(filepath)
    content_type = file.content_type or "image/png"

    file_meta = {
        "file_id": file_id,
        "filename": filename,
        "bytes": file_size,
        "type": content_type,
        "source": "local",
        "filepath": filepath,
        "status": "pending",
    }
    state_service.file_meta.put(user_id, file_id, file_meta)

    result = dict(file_meta)
    result["filepath"] = f"/api/files/download/{dir_key}/{file_id}"
    if client_file_id:
        result["temp_file_id"] = client_file_id
    return jsonify(result)


AVATAR_SIZE_LIMIT = 2 * 1024 * 1024  # matches avatarSizeLimit in /api/files/config


@files_bp.route("/api/files/images/avatar", methods=["POST"])
@require_auth
def upload_avatar():
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files["file"]
    user_id = getattr(g, 'user_id', None) or getattr(g, 'session_key', 'anonymous')

    # Bounded read: reject oversize without ever buffering more than the
    # limit + 1 byte into memory (content_length can be absent/spoofed).
    if request.content_length and request.content_length > AVATAR_SIZE_LIMIT + 4096:
        return jsonify({"error": "Avatar exceeds 2 MB limit"}), 413
    data = file.read(AVATAR_SIZE_LIMIT + 1)
    if len(data) > AVATAR_SIZE_LIMIT:
        return jsonify({"error": "Avatar exceeds 2 MB limit"}), 413

    if avatar_service.s3_enabled():
        # Avatars: dedicated S3 bucket, permanent public URL (unguessable key).
        try:
            avatar_url = avatar_service.store_avatar(user_id, data, file.filename)
        except Exception as e:
            logger.exception("Failed to store avatar in S3: %s", e)
            return jsonify({"error": "Failed to save avatar"}), 500
    else:
        # Local-disk fallback (dev without AWS), served by the Flask route below.
        avatar_dir = os.path.join(UPLOAD_DIR, user_id, "avatar")
        os.makedirs(avatar_dir, exist_ok=True)
        avatar_path = os.path.join(avatar_dir, "avatar.png")
        try:
            with open(avatar_path, "wb") as f:
                f.write(data)
        except Exception as e:
            logger.exception("Failed to save avatar: %s", e)
            return jsonify({"error": "Failed to save avatar"}), 500
        avatar_url = f"/api/files/images/user/{user_id}/avatar"

    user = find_user_by_id(user_id)
    if user:
        update_user_field(user, "avatar", avatar_url)

    return jsonify({"url": avatar_url})


@files_bp.route("/api/files/images/user/<user_id>/avatar", methods=["GET"])
def serve_user_avatar(user_id):
    avatar_path = os.path.join(UPLOAD_DIR, user_id, "avatar", "avatar.png")
    if not os.path.exists(avatar_path):
        return jsonify({"error": "Not found"}), 404
    return send_file(avatar_path, mimetype="image/png")


AGENT_AVATAR_DIR = os.path.join(UPLOAD_DIR, "agent-avatars")


def _agent_avatar_paths(agent_id: str) -> list[str]:
    safe = secure_filename(agent_id)
    if not safe:
        return []
    return glob.glob(os.path.join(AGENT_AVATAR_DIR, f"{safe}.*"))


@files_bp.route("/api/files/images/agents/<agent_id>/avatar", methods=["POST"])
@require_auth
def upload_agent_avatar(agent_id):
    """Persist an agent's avatar and write it onto the agent record.

    The frontend mutation expects the updated Agent back (it seeds the agent
    caches from the response and does not issue a follow-up PATCH), so the
    avatar must be saved here and the agent row returned with `avatar` set.
    """
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    user_id = get_request_state_partition()
    row = state_service.agents.get(user_id, agent_id)
    if not row:
        return jsonify({"error": "Not found"}), 404

    safe_agent = secure_filename(agent_id)
    if not safe_agent:
        return jsonify({"error": "Invalid agent id"}), 400

    file = request.files["file"]
    _, ext = os.path.splitext(file.filename or "")
    ext = ext.lower()
    if ext not in (".png", ".jpg", ".jpeg", ".gif", ".webp"):
        ext = ".png"

    os.makedirs(AGENT_AVATAR_DIR, exist_ok=True)
    # Clear any prior avatar so a new upload with a different extension does not
    # leave a stale file that the serve route might pick up instead.
    for old in _agent_avatar_paths(agent_id):
        try:
            os.remove(old)
        except OSError:
            pass

    avatar_path = os.path.join(AGENT_AVATAR_DIR, f"{safe_agent}{ext}")
    try:
        file.save(avatar_path)
    except Exception as e:
        logger.exception("Failed to save agent avatar: %s", e)
        return jsonify({"error": "Failed to save avatar"}), 500

    # Cache-bust so the freshly uploaded image replaces the previous one in the
    # browser (the serve URL is otherwise identical across re-uploads).
    avatar_url = f"/api/files/images/agents/{agent_id}/avatar?t={int(time.time())}"
    row = {k: v for k, v in row.items() if k not in ("pk", "sk")}
    row["avatar"] = {"filepath": avatar_url, "source": "local"}
    if not row.get("_id") and row.get("id"):
        row["_id"] = row["id"]
    state_service.agents.put(user_id, agent_id, row)
    return jsonify(row)


@files_bp.route("/api/files/images/agents/<agent_id>/avatar", methods=["GET"])
def serve_agent_avatar(agent_id):
    paths = _agent_avatar_paths(agent_id)
    if not paths:
        return jsonify({"error": "Not found"}), 404
    return send_file(paths[0])


@files_bp.route("/api/files/images/<path:subpath>", methods=["GET"])
def serve_image(subpath):
    return jsonify({"error": "Not found"}), 404
