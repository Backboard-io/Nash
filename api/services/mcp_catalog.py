"""Curated catalog of one-click OAuth MCP servers.

Today: Google Workspace's five official remote MCP servers. Each catalog entry
carries a fixed ``serverName`` (so its OAuth redirect URI is stable and can be
registered in Google Cloud once) and a ready-to-store ``config`` whose
``oauth.preset`` tells ``mcp_oauth_service`` to resolve client id/secret from
env — the secret is never stored per user or sent to the browser.

Adding another provider later is a data change here plus (if it uses env creds)
a preset in ``mcp_oauth_service._PRESET_ENV_CREDS`` — no flow code.
"""

from __future__ import annotations

from api.services import mcp_oauth_service, state_service

_GOOGLE_AUTHZ = "https://accounts.google.com/o/oauth2/v2/auth"
_GOOGLE_TOKEN = "https://oauth2.googleapis.com/token"

# serverName -> catalog entry. serverName MUST stay stable (redirect URIs).
GOOGLE_WORKSPACE: dict[str, dict] = {
    "google-gmail": {
        "title": "Gmail",
        "description": "Read and compose Gmail messages.",
        "url": "https://gmailmcp.googleapis.com/mcp/v1",
        "scope": "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose",
    },
    "google-drive": {
        "title": "Google Drive",
        "description": "Browse and read your Google Drive files.",
        "url": "https://drivemcp.googleapis.com/mcp/v1",
        "scope": "https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file",
    },
    "google-calendar": {
        "title": "Google Calendar",
        "description": "Read calendars, events, and free/busy.",
        "url": "https://calendarmcp.googleapis.com/mcp/v1",
        "scope": (
            "https://www.googleapis.com/auth/calendar.calendarlist.readonly "
            "https://www.googleapis.com/auth/calendar.events.freebusy "
            "https://www.googleapis.com/auth/calendar.events.readonly"
        ),
    },
    "google-chat": {
        "title": "Google Chat",
        "description": "Read spaces, memberships, and messages; post messages.",
        "url": "https://chatmcp.googleapis.com/mcp/v1",
        "scope": (
            "https://www.googleapis.com/auth/chat.spaces.readonly "
            "https://www.googleapis.com/auth/chat.memberships.readonly "
            "https://www.googleapis.com/auth/chat.messages.readonly "
            "https://www.googleapis.com/auth/chat.messages.create "
            "https://www.googleapis.com/auth/chat.users.readstate.readonly"
        ),
    },
    "google-people": {
        "title": "Google Contacts",
        "description": "Read directory, profile, and contacts.",
        "url": "https://people.googleapis.com/mcp/v1",
        "scope": (
            "https://www.googleapis.com/auth/directory.readonly "
            "https://www.googleapis.com/auth/userinfo.profile "
            "https://www.googleapis.com/auth/contacts.readonly"
        ),
    },
}

_PRESET = "google-workspace"


def _catalog() -> dict[str, dict]:
    return GOOGLE_WORKSPACE


def is_available() -> bool:
    """True when the Google Workspace OAuth client env creds are configured."""
    return mcp_oauth_service.preset_is_available(_PRESET)


def get_entry(server_name: str) -> dict | None:
    return _catalog().get(server_name)


def build_config(server_name: str) -> dict | None:
    """The ``config`` to store on the MCP row for a catalog server."""
    entry = get_entry(server_name)
    if not entry:
        return None
    return {
        "type": "streamable-http",
        "url": entry["url"],
        "title": entry["title"],
        "description": entry.get("description", ""),
        # Per Google's MCP spec: generous init handshake (remote servers can be
        # slow to initialize) and a 60s per-call timeout.
        "timeout": 60000,
        "initTimeout": 150000,
        "oauth": {
            "preset": _PRESET,
            "authorization_url": _GOOGLE_AUTHZ,
            "token_url": _GOOGLE_TOKEN,
            "scope": entry["scope"],
        },
    }


def list_catalog(user_hash: str) -> list[dict]:
    """Client-facing catalog: what can be one-click connected, and whether the
    user already added each. Empty when the provider isn't configured."""
    if not is_available():
        return []
    existing = {
        row.get("serverName")
        for row in state_service.mcp_servers.list_for_user(user_hash)
    }
    out = []
    for server_name, entry in _catalog().items():
        out.append({
            "serverName": server_name,
            "title": entry["title"],
            "description": entry.get("description", ""),
            "provider": "google-workspace",
            "alreadyAdded": server_name in existing,
        })
    return out
