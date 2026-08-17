"""Conditional JSON responses with `private, no-cache` semantics.

`no-cache` (not `no-store`): the browser may keep the body but must
revalidate before reusing it, so every request re-runs auth with the CURRENT
session — a context switch or account change can never be served another
identity's payload from the browser cache. Unchanged payloads cost a 304
with an empty body.

flask-compress rewrites strong ETags to "<etag>:<algorithm>" AFTER the view
runs, so the validator a browser sends back is the suffixed one. Matching is
exact string equality against the plain and suffixed forms — no header
parsing anywhere. A view-level 304 is safe from re-compression: flask-compress
returns early for any status outside 2xx.
"""

from __future__ import annotations

from flask import Response, has_request_context, request

# The two algorithms configured in COMPRESS_ALGORITHM (api/app.py). If that
# list ever changes, the suffix set here must follow it.
_COMPRESS_SUFFIXES = (":br", ":gzip")


def _candidate_validators(etag: str) -> tuple[str, ...]:
    quoted = '"' + etag + '"'
    return (quoted,) + tuple('"' + etag + suffix + '"' for suffix in _COMPRESS_SUFFIXES)


def etag_matches(etag: str) -> bool:
    """True when the request's If-None-Match is exactly our ETag (plain or
    flask-compress-suffixed). False without a request context."""
    if not has_request_context():
        return False
    header = request.headers.get("If-None-Match", "").strip()
    if not header:
        return False
    return header in _candidate_validators(etag)


def _apply_cache_control(resp: Response, max_age: int) -> None:
    resp.cache_control.private = True
    if max_age > 0:
        resp.cache_control.max_age = max_age
    else:
        resp.cache_control.no_cache = True


def not_modified(*, max_age: int = 0) -> Response:
    """An empty 304 echoing the client's validator verbatim (the browser
    stored the suffixed variant; echoing it keeps its cache entry keyed)."""
    resp = Response(status=304)
    validator = request.headers.get("If-None-Match", "").strip()
    if validator:
        resp.headers["ETag"] = validator
    _apply_cache_control(resp, max_age)
    return resp


def conditional_json(body: bytes, etag: str, *, max_age: int = 0) -> Response:
    """Serve pre-serialized JSON with conditional revalidation.

    The match check runs BEFORE any response construction, so a revalidation
    hit costs a header compare — no serialization, no compression.
    """
    if etag_matches(etag):
        return not_modified(max_age=max_age)
    resp = Response(body, mimetype="application/json")
    resp.set_etag(etag)
    _apply_cache_control(resp, max_age)
    return resp
