from flask import Response

from api.config import settings

SESSION_COOKIE_NAME = "session_key"


def session_cookie_max_age_seconds() -> int:
    return settings.session_ttl_days * 86400


def set_session_cookie(response: Response, session_key: str) -> None:
    response.set_cookie(
        SESSION_COOKIE_NAME,
        session_key,
        httponly=True,
        secure=not settings.domain_server.startswith("http://localhost"),
        samesite="Lax",
        max_age=session_cookie_max_age_seconds(),
        path="/",
    )
