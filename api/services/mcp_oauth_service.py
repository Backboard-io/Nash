"""OAuth 2.0 (authorization-code) for OAuth-authenticated MCP servers.

Generic engine: the flow is provider-agnostic and reads its endpoints/scope from
each server's ``config.oauth`` block, so Google Workspace, Slack, GitHub, etc.
all work with no per-provider code. Google Workspace ships as a catalog preset
(``config.oauth.preset == "google-workspace"``) whose client id/secret reuse
env — the secret is resolved only here, server-side, and is never stored per
user or sent to the browser.

Per-user tokens are stored encrypted (AES-256-GCM) in ``state_service`` keyed by
(user_hash, server_name). ``get_valid_access_token`` transparently refreshes a
token that is expired or about to expire, so callers just get a usable bearer.

This module depends on state/dynamo/encryption/config only — never on
``mcp_service`` — so there is no import cycle: the routes and the chat loop
resolve a token here and pass it into ``mcp_service`` as ``access_token``.
"""

from __future__ import annotations

import base64
import hashlib
import logging
import secrets
import time
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

import httpx

from api.config import settings
from api.services import dynamo_service, encryption_service, state_service

logger = logging.getLogger(__name__)

# Refresh a little before the token actually expires so an in-flight tool call
# never races the expiry.
_EXPIRY_SKEW_SEC = 120
_TOKEN_HTTP_TIMEOUT = 30

# Catalog presets whose client credentials live in env, not in the stored row.
_PRESET_ENV_CREDS = {
    "google-workspace": lambda: (
        (settings.google_oauth_client_id or "").strip(),
        (settings.google_oauth_client_secret or "").strip(),
    ),
}


class MCPOAuthError(Exception):
    """OAuth flow / token error for an MCP server."""


# ---------------------------------------------------------------------------
# Config helpers
# ---------------------------------------------------------------------------

def get_oauth_config(server: dict) -> dict | None:
    """Return the server's ``config.oauth`` block, or None if it isn't an OAuth
    server. Accepts either a full stored row or a bare config dict."""
    config = server.get("config", server) if isinstance(server, dict) else {}
    oauth = (config or {}).get("oauth")
    return oauth if isinstance(oauth, dict) and oauth else None


def is_oauth_server(server: dict) -> bool:
    return get_oauth_config(server) is not None


def resolve_client_credentials(oauth_config: dict) -> tuple[str, str]:
    """(client_id, client_secret) for this OAuth config. Preset servers resolve
    from env (secret never stored); generic servers use the stored values."""
    preset = (oauth_config or {}).get("preset")
    if preset in _PRESET_ENV_CREDS:
        return _PRESET_ENV_CREDS[preset]()
    return (
        (oauth_config.get("client_id") or "").strip(),
        (oauth_config.get("client_secret") or "").strip(),
    )


def preset_is_available(preset: str) -> bool:
    """True when a catalog preset has its env credentials configured."""
    getter = _PRESET_ENV_CREDS.get(preset)
    if not getter:
        return False
    client_id, client_secret = getter()
    return bool(client_id and client_secret)


def session_fingerprint(session_key: str | None) -> str:
    """Stable, non-reversible fingerprint of a session key, used to bind an
    OAuth flow to the session that started it. Empty for no session."""
    sk = (session_key or "").strip()
    if not sk:
        return ""
    return hashlib.sha256(sk.encode("utf-8")).hexdigest()


def redirect_uri_for(server_name: str) -> str:
    """The per-server OAuth callback. Must byte-match what is registered in the
    provider's OAuth client (Google Cloud)."""
    base = (settings.domain_server or "").rstrip("/")
    return f"{base}/api/mcp/{server_name}/oauth/callback"


def _with_params(url: str, params: dict) -> str:
    """Merge ``params`` into ``url``'s query string (our params win, no dupes)."""
    parts = urlparse(url)
    merged = dict(parse_qsl(parts.query))
    merged.update({k: v for k, v in params.items() if v is not None})
    return urlunparse(parts._replace(query=urlencode(merged)))


# ---------------------------------------------------------------------------
# PKCE
# ---------------------------------------------------------------------------

def _new_pkce_pair() -> tuple[str, str]:
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(48)).rstrip(b"=").decode("ascii")
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode("ascii")).digest())
        .rstrip(b"=")
        .decode("ascii")
    )
    return verifier, challenge


# ---------------------------------------------------------------------------
# Authorize + token exchange
# ---------------------------------------------------------------------------

def build_authorize_url(
    *, server_name: str, user_hash: str, oauth_config: dict, return_to: str = "",
    session_fingerprint: str = "",
) -> str:
    """Generate the provider consent URL and persist the matching state/PKCE.

    ``session_fingerprint`` binds the flow to the initiating session (see the
    callback). Raises MCPOAuthError if the config or credentials are incomplete.
    """
    client_id, _client_secret = resolve_client_credentials(oauth_config)
    authorization_url = (oauth_config.get("authorization_url") or "").strip()
    scope = (oauth_config.get("scope") or "").strip()
    if not (client_id and authorization_url):
        raise MCPOAuthError("OAuth server is missing client_id or authorization_url")

    state = secrets.token_urlsafe(24)
    verifier, challenge = _new_pkce_pair()
    dynamo_service.store_mcp_oauth_state(
        state=state,
        code_verifier=verifier,
        server_name=server_name,
        user_hash=user_hash,
        return_to=return_to,
        session_fingerprint=session_fingerprint,
    )
    return _with_params(
        authorization_url,
        {
            "client_id": client_id,
            "redirect_uri": redirect_uri_for(server_name),
            "response_type": "code",
            "scope": scope,
            "state": state,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            # Google needs these to return a refresh token; harmless elsewhere.
            "access_type": "offline",
            "prompt": "consent",
            "include_granted_scopes": "true",
        },
    )


def exchange_code(
    *, oauth_config: dict, server_name: str, code: str, code_verifier: str
) -> dict:
    """Exchange an authorization code for tokens (client_secret_post + PKCE)."""
    client_id, client_secret = resolve_client_credentials(oauth_config)
    token_url = (oauth_config.get("token_url") or "").strip()
    if not (client_id and token_url):
        raise MCPOAuthError("OAuth server is missing client_id or token_url")

    data = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": redirect_uri_for(server_name),
        "client_id": client_id,
        "code_verifier": code_verifier,
    }
    if client_secret:
        data["client_secret"] = client_secret
    resp = httpx.post(token_url, data=data, timeout=_TOKEN_HTTP_TIMEOUT)
    if resp.status_code != 200:
        raise MCPOAuthError(
            f"Token exchange failed (HTTP {resp.status_code}): {resp.text[:300]}"
        )
    tokens = resp.json()
    if not isinstance(tokens, dict) or not tokens.get("access_token"):
        raise MCPOAuthError("Token response missing access_token")
    return tokens


def _refresh_access_token(*, oauth_config: dict, refresh_token: str) -> dict:
    client_id, client_secret = resolve_client_credentials(oauth_config)
    token_url = (oauth_config.get("token_url") or "").strip()
    data = {
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "client_id": client_id,
    }
    if client_secret:
        data["client_secret"] = client_secret
    resp = httpx.post(token_url, data=data, timeout=_TOKEN_HTTP_TIMEOUT)
    if resp.status_code != 200:
        raise MCPOAuthError(
            f"Token refresh failed (HTTP {resp.status_code}): {resp.text[:300]}"
        )
    tokens = resp.json()
    if not isinstance(tokens, dict) or not tokens.get("access_token"):
        raise MCPOAuthError("Refresh response missing access_token")
    return tokens


# ---------------------------------------------------------------------------
# Encrypted token storage
# ---------------------------------------------------------------------------

def store_token(user_hash: str, server_name: str, tokens: dict, *, prior: dict | None = None) -> None:
    """Encrypt and persist tokens. A refresh that omits refresh_token keeps the
    prior one (Google only returns refresh_token on the first consent)."""
    access = tokens.get("access_token") or ""
    refresh = tokens.get("refresh_token") or ""
    if not refresh and prior:
        refresh = prior.get("refresh_token") or ""
    # If the provider omits expires_in, assume a conservative 1h so the refresh
    # path still engages (never treat "unknown" as "never expires").
    expires_in = int(tokens.get("expires_in") or 3600)
    row = {
        "serverName": server_name,
        "access_token": encryption_service.encrypt_key(access) if access else "",
        "refresh_token": encryption_service.encrypt_key(refresh) if refresh else "",
        "expires_at": int(time.time()) + expires_in,
        "scope": tokens.get("scope") or (prior or {}).get("scope") or "",
        "token_type": tokens.get("token_type") or "Bearer",
        "obtained_at": int(time.time()),
    }
    state_service.mcp_oauth_tokens.put(user_hash, server_name, row)


def load_token(user_hash: str, server_name: str) -> dict | None:
    """Return the decrypted token row, or None if absent/corrupt."""
    row = state_service.mcp_oauth_tokens.get(user_hash, server_name)
    if not row:
        return None
    try:
        access = row.get("access_token")
        refresh = row.get("refresh_token")
        return {
            "access_token": encryption_service.decrypt_key(access) if access else "",
            "refresh_token": encryption_service.decrypt_key(refresh) if refresh else "",
            "expires_at": int(row.get("expires_at") or 0),
            "scope": row.get("scope") or "",
            "token_type": row.get("token_type") or "Bearer",
        }
    except Exception:
        logger.warning("[mcp-oauth] failed to decrypt token for %s; treating as unauthenticated", server_name)
        return None


def delete_token(user_hash: str, server_name: str) -> bool:
    return state_service.mcp_oauth_tokens.delete(user_hash, server_name)


def has_token(user_hash: str, server_name: str) -> bool:
    return state_service.mcp_oauth_tokens.get(user_hash, server_name) is not None


# ---------------------------------------------------------------------------
# The one function callers use before an MCP request
# ---------------------------------------------------------------------------

def get_valid_access_token(user_hash: str, server: dict) -> str | None:
    """Return a usable access token for (user, server), refreshing if needed.

    Returns None when the server isn't OAuth or the user has no/expired-and-
    unrefreshable token (the caller then surfaces "needs auth").
    """
    oauth_config = get_oauth_config(server)
    if not oauth_config:
        return None
    server_name = server.get("serverName") or (server.get("config", {}) or {}).get("title") or ""
    token = load_token(user_hash, server_name)
    if not token or not token.get("access_token"):
        return None

    expires_at = token.get("expires_at") or 0
    if expires_at and time.time() >= (expires_at - _EXPIRY_SKEW_SEC):
        refresh = token.get("refresh_token")
        if not refresh:
            return None  # expired and no way to refresh → needs re-consent
        try:
            new_tokens = _refresh_access_token(oauth_config=oauth_config, refresh_token=refresh)
        except MCPOAuthError:
            logger.warning("[mcp-oauth] refresh failed for %s", server_name)
            return None
        store_token(user_hash, server_name, new_tokens, prior=token)
        return new_tokens.get("access_token")

    return token.get("access_token")
