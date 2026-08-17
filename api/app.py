import json
import mimetypes
import os
import secrets
import threading

from flask import Flask, g, jsonify, request, send_from_directory
from flask_cors import CORS

from api.config import settings
from api.middleware.rate_limit import limiter
from api.services import audit_service

STATIC_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "client", "dist")

_copied_assets: set[str] | None = None
_copied_assets_lock = threading.Lock()


def _copied_asset_paths() -> set[str]:
    """Paths under assets/ that the build copied VERBATIM from public/assets.

    These have stable URLs across deploys (logos, favicons, PWA icons), so
    they must never get immutable caching — a rebrand would otherwise be
    invisible to returning browsers for a year. The build declares them in
    dist/asset-manifest.json (written by client/scripts/post-build.cjs); the
    server never guesses hashed-ness from filename patterns. A missing
    manifest (older build) yields an empty set, which degrades to
    fonts-only exclusion — no worse than the previous behavior.
    """
    global _copied_assets
    if _copied_assets is not None:
        return _copied_assets
    with _copied_assets_lock:
        if _copied_assets is not None:
            return _copied_assets
        paths: set[str] = set()
        try:
            with open(os.path.join(STATIC_DIR, "asset-manifest.json"), "r", encoding="utf-8") as f:
                entries = json.load(f)
            if isinstance(entries, list):
                paths = {entry for entry in entries if isinstance(entry, str)}
        except FileNotFoundError:
            pass
        except Exception:
            logging.warning(
                "asset-manifest.json unreadable; treating all assets as hashed",
                exc_info=True,
            )
        _copied_assets = paths
        return paths


def _serve_client_file(path: str):
    """Serve a built client file, preferring the vite-generated .br/.gz sibling
    when the request accepts that encoding. The Content-Type must come from the
    ORIGINAL filename — sending the .br path raw would yield octet-stream.

    Content-hashed bundles under assets/ are immutable across deploys, so
    they get a year-long cache. Without this, Flask's send_file default
    (SEND_FILE_MAX_AGE_DEFAULT=None) serves them Cache-Control: no-cache,
    forcing a revalidation round-trip per file on every page load. Stable-URL
    files are excluded: everything the build copied verbatim (asset manifest)
    and fonts, which vite deliberately emits UNhashed to assets/fonts/.
    """
    resp = None
    if request.method in ("GET", "HEAD"):
        mimetype = mimetypes.guess_type(path)[0]
        for encoding, suffix in (("br", ".br"), ("gzip", ".gz")):
            if request.accept_encodings.quality(encoding) <= 0:
                continue
            if not os.path.isfile(os.path.join(STATIC_DIR, path + suffix)):
                continue
            resp = send_from_directory(
                STATIC_DIR,
                path + suffix,
                mimetype=mimetype or "application/octet-stream",
            )
            resp.headers["Content-Encoding"] = encoding
            resp.headers.add("Vary", "Accept-Encoding")
            break
    if resp is None:
        resp = send_from_directory(STATIC_DIR, path)
    if (
        path.startswith("assets/")
        and not path.startswith("assets/fonts/")
        and path not in _copied_asset_paths()
    ):
        resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    return resp

import logging
logging.basicConfig(level=logging.INFO)

try:
    from flask_sock import Sock
    sock: "Sock | None" = Sock()
except ImportError:
    # flask-sock is optional — voice-mode realtime degrades to the REST path
    # if the dep isn't installed. The /api/voice/realtime route just won't
    # register, and the frontend falls back accordingly.
    sock = None


def create_app() -> Flask:
    logging.info("starting app")
    has_static = os.path.isdir(STATIC_DIR)
    app = Flask(__name__)
    logging.info("app created")
    if settings.flask_secret_key:
        app.secret_key = settings.flask_secret_key
    else:
        app.secret_key = secrets.token_hex(32)
        logging.warning(
            "FLASK_SECRET_KEY is not set — generated an ephemeral value for this "
            "process. Multi-replica deploys must set FLASK_SECRET_KEY explicitly "
            "so signed cookies survive across replicas."
        )
    # Flask session cookie config (localhost-friendly defaults)
    app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
    app.config["SESSION_COOKIE_SECURE"] = False  # localhost is HTTP, not HTTPS
    app.config["SESSION_COOKIE_HTTPONLY"] = True
    logging.info("session ttl configured: %s days", settings.session_ttl_days)
    limiter.init_app(app)
    logging.info("secret key set")
    origins = [settings.domain_client, settings.domain_server]
    if settings.domain_client.startswith("http://localhost") or settings.domain_server.startswith("http://localhost"):
        origins.extend(["http://localhost:3090", "http://localhost:3080"])
    CORS(app, supports_credentials=True, origins=origins)
    logging.info("cors set")
    try:
        from flask_compress import Compress

        # Compresses JSON API responses (/api/init is ~82KB raw, ~8KB
        # compressed). SSE is safe: text/event-stream is not in
        # COMPRESS_MIMETYPES, and responses that already carry
        # Content-Encoding (the precompressed client assets) are skipped.
        # No zstd — flask-compress 1.24 otherwise prefers zstd for Chrome,
        # and Chrome's service-worker script fetch rejects zstd-encoded
        # /sw.js ("An unknown error occurred when fetching the script"),
        # breaking SW registration. Both lists matter: file/passthrough
        # responses (like /sw.js) negotiate via COMPRESS_ALGORITHM_STREAMING.
        app.config["COMPRESS_ALGORITHM"] = ["br", "gzip"]
        app.config["COMPRESS_ALGORITHM_STREAMING"] = ["br", "deflate"]
        # flask-compress suffixes strong ETags ("E" -> "E:br") but only
        # re-runs make_conditional for STREAMED responses whose endpoint is
        # in this list. serve_spa's send_from_directory responses are
        # streamed, so without it index.html/sw.js revalidations can never
        # match their suffixed validator — the app shell would re-download
        # (plus a fresh brotli pass) on every page load.
        app.config["COMPRESS_STREAMING_ENDPOINT_CONDITIONAL"] = ["static", "serve_spa"]
        Compress(app)
        logging.info("response compression enabled")
    except ImportError:
        logging.warning("flask-compress not installed; API responses served uncompressed")
    from api.routes.config_routes import config_bp
    from api.routes.auth import auth_bp
    from api.routes.user import user_bp
    from api.routes.conversations import conversations_bp
    from api.routes.messages import messages_bp
    from api.routes.chat import chat_bp
    from api.routes.presets import presets_bp
    from api.routes.folders import folders_bp
    from api.routes.tags import tags_bp
    from api.routes.saved_messages import saved_messages_bp
    from api.routes.search import search_bp
    from api.routes.files import files_bp
    from api.routes.agents import agents_bp
    from api.routes.memories import memories_bp
    from api.routes.share import share_bp
    from api.routes.misc import misc_bp
    from api.routes.init import init_bp
    from api.routes.keys import keys_bp
    from api.routes.voice import voice_bp
    from api.routes.analytics import analytics_bp
    logging.info("routes imported")

    @app.route("/api/health")
    def health():
        import asyncio
        from api.services.async_runner import run_async
        try:
            run_async(asyncio.sleep(0), timeout=2)
        except Exception:
            return jsonify({"status": "degraded", "reason": "event_loop_stuck"}), 503
        return jsonify({"status": "ok"})

    @app.errorhandler(429)
    def ratelimit_handler(e):
        audit_service.emit(
            "rate_limit.exceeded",
            result="blocked",
            limit=str(getattr(e, "description", "")),
        )
        return jsonify({"message": "Too many requests. Please slow down and try again."}), 429

    @app.after_request
    def log_server_errors(response):
        if response.status_code >= 500:
            from flask import request as req
            audit_service.emit(
                "http.error",
                result="fail",
                status_code=response.status_code,
                path=req.path,
                method=req.method,
            )
        return response

    @app.after_request
    def refresh_session_cookie(response):
        session_key = getattr(g, "session_key", None)
        if session_key and 200 <= response.status_code < 400:
            from api.services.session_cookie import set_session_cookie

            set_session_cookie(response, session_key)
        return response
    app.register_blueprint(config_bp)
    app.register_blueprint(auth_bp)
    app.register_blueprint(user_bp)
    app.register_blueprint(conversations_bp)
    app.register_blueprint(messages_bp)
    app.register_blueprint(chat_bp)
    app.register_blueprint(presets_bp)
    app.register_blueprint(folders_bp)
    app.register_blueprint(tags_bp)
    app.register_blueprint(saved_messages_bp)
    app.register_blueprint(search_bp)
    app.register_blueprint(files_bp)
    app.register_blueprint(agents_bp)
    app.register_blueprint(memories_bp)
    app.register_blueprint(share_bp)
    app.register_blueprint(misc_bp)
    app.register_blueprint(init_bp)
    app.register_blueprint(keys_bp)
    app.register_blueprint(voice_bp)
    app.register_blueprint(analytics_bp)
    if sock is not None:
        sock.init_app(app)
        # Importing the realtime WS module attaches its sock.route handler
        # to the Sock instance. Importing inside create_app() (not at module
        # load) avoids the circular import on `sock`.
        try:
            from api.routes import voice_realtime  # noqa: F401
        except Exception as e:
            logging.warning("voice realtime WS not registered: %s", e)
    logging.info("routes registered")

    # Ensure DynamoDB tables exist on startup
    try:
        from api.services.dynamo_service import ensure_table
        ensure_table()
        logging.info("DynamoDB session table ready")
    except Exception as e:
        logging.warning("DynamoDB session table init skipped: %s", e)
    try:
        from api.services.state_service import ensure_state_table
        ensure_state_table()
        logging.info("DynamoDB state table ready")
    except Exception as e:
        logging.warning("DynamoDB state table init skipped: %s", e)
    # Restore the last-good Backboard catalog snapshot so the first request
    # after a deploy serves real models instead of paying the cold catalog
    # fetch (or falling back to the yaml provisional config).
    try:
        from api.services.model_catalog_service import load_persisted_snapshot
        if load_persisted_snapshot():
            logging.info("model catalog restored from persisted snapshot")
    except Exception as e:
        logging.warning("model catalog snapshot load skipped: %s", e)
    if has_static:
        # Files whose URL is stable across deploys must be revalidated on every
        # load. Otherwise the PWA service worker + browser keep serving a stale
        # app shell (old index.html -> old hashed bundle) until a hard refresh.
        # Hashed assets under /assets/ get immutable caching + precompressed
        # serving in _serve_client_file.
        no_cache_files = {"index.html", "sw.js", "registerSW.js", "manifest.webmanifest"}

        @app.route("/", defaults={"path": ""})
        @app.route("/<path:path>")
        def serve_spa(path):
            full_path = os.path.join(STATIC_DIR, path)
            if path and os.path.isfile(full_path):
                resp = _serve_client_file(path)
                if os.path.basename(path) in no_cache_files:
                    resp.headers["Cache-Control"] = "no-cache"
                return resp
            resp = send_from_directory(STATIC_DIR, "index.html")
            resp.headers["Cache-Control"] = "no-cache"
            return resp
    logging.info("spa registered")
    return app


if __name__ == "__main__":
    logging.info("starting app")
    app = create_app()
    logging.info("app created")
    # Werkzeug's debugger exposes an interactive RCE console on unhandled
    # exceptions, so it must never be on by default. Opt in explicitly for
    # local debugging via NASH_DEBUG=1.
    debug = os.environ.get("NASH_DEBUG", "").strip().lower() in {"1", "true", "yes", "on"}
    app.run(host=settings.host, port=settings.port, debug=debug)
    logging.info("app started")
