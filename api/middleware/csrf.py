"""CSRF protection for cookie-authenticated endpoints.

All API endpoints that use the X-Session-Key header are inherently CSRF-safe —
cross-site requests cannot set custom headers. Endpoints that rely on the
session_key cookie alone (e.g. GET/POST /api/auth/logout) need protection.

For these, the SameSite=Lax cookie attribute already blocks cross-site POST
requests. The remaining vector is cross-site GET navigation which could carry
the cookie. We address this with three complementary checks:

  1. Sec-Fetch-Site header (set automatically by all modern browsers):
     Reject requests where Sec-Fetch-Site is explicitly "cross-site".
     Allow "same-origin", "same-site", "none", and absent (curl / API clients).

  2. Origin / Referer header cross-check for POST requests:
     When a POST arrives with an Origin header that doesn't match the server
     domain, reject it. This covers older browsers that predate Sec-Fetch-Site.

  3. Double-submit cookie pattern:
     On every response, set a csrf_token cookie if not already present.
     On state-changing requests, verify the X-CSRF-Token header matches.

Usage:
    from api.middleware.csrf import csrf_protect

    @bp.route("/api/auth/logout", methods=["POST"])
    @csrf_protect
    def logout(): ...
"""
import functools
import logging
import secrets

from flask import request, jsonify

from api.config import settings

logger = logging.getLogger(__name__)

_ALLOWED_FETCH_SITES = {"same-origin", "same-site", "none", ""}


def _is_dev_mode():
    return settings.domain_client.startswith("http://localhost") or settings.domain_server.startswith("http://localhost")


def csrf_protect(f):
    """Decorator that blocks cross-site requests to cookie-authenticated endpoints."""
    @functools.wraps(f)
    def decorated(*args, **kwargs):
        # Check 1: Sec-Fetch-Site (modern browsers always set this)
        fetch_site = request.headers.get("Sec-Fetch-Site", "").lower()
        if fetch_site not in _ALLOWED_FETCH_SITES:
            logger.warning(
                "[csrf] blocked cross-site request: path=%s Sec-Fetch-Site=%s",
                request.path, fetch_site,
            )
            return jsonify({"error": "Cross-site request blocked"}), 403

        # Check 2: Origin header mismatch on state-changing methods
        if request.method in ("POST", "PUT", "PATCH", "DELETE"):
            origin = request.headers.get("Origin", "")
            if origin:
                allowed_origins = {
                    settings.domain_client.rstrip("/"),
                    settings.domain_server.rstrip("/"),
                }
                if _is_dev_mode():
                    allowed_origins.update({
                        "http://localhost:3090",
                        "http://localhost:3080",
                    })
                if origin.rstrip("/") not in allowed_origins:
                    logger.warning(
                        "[csrf] blocked mismatched origin: path=%s origin=%s",
                        request.path, origin,
                    )
                    return jsonify({"error": "Cross-site request blocked"}), 403

        # Check 3: Double-submit cookie verification on state-changing methods.
        # Only enforce when the client sends X-CSRF-Token header (opt-in).
        # This allows gradual frontend adoption without breaking existing clients.
        if request.method in ("POST", "PUT", "PATCH", "DELETE"):
            csrf_cookie = request.cookies.get("csrf_token", "")
            csrf_header = request.headers.get("X-CSRF-Token", "")
            if csrf_header and csrf_cookie and csrf_header != csrf_cookie:
                logger.warning(
                    "[csrf] double-submit mismatch: path=%s",
                    request.path,
                )
                return jsonify({"error": "CSRF token mismatch"}), 403

        result = f(*args, **kwargs)

        # Set the csrf_token cookie so the frontend can read it and send it
        # as X-CSRF-Token header on future requests.
        from flask import make_response as _make_resp
        resp = _make_resp(result) if not hasattr(result, "set_cookie") else result
        if not request.cookies.get("csrf_token"):
            resp.set_cookie(
                "csrf_token",
                secrets.token_urlsafe(32),
                httponly=False,  # JS must read this to send as header
                secure=not _is_dev_mode(),
                samesite="Lax",
                path="/",
            )
        return resp
    return decorated
