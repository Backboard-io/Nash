"""_format_convo must return conversation.endpoint unchanged.

Regression test for a bug where _normalize_endpoint remapped "", "custom",
and "agents" (Nash's default endpoint) to the literal string "OpenAI" —
which matches none of the frontend's EModelEndpoint enum values ('agents',
'openAI', ...), silently breaking exact-match consumers like the
Regenerate button's branchingSupported whitelist
(useGenerationsByLatest.ts) for any conversation fetched through this
formatter (i.e. everything except the live SSE path, which never
normalized in the first place).
"""
from api.routes.conversations import _format_convo, _normalize_endpoint


def test_normalize_endpoint_is_identity():
    assert _normalize_endpoint("agents") == "agents"
    assert _normalize_endpoint("custom") == "custom"
    assert _normalize_endpoint("openAI") == "openAI"
    assert _normalize_endpoint("") == ""


def test_format_convo_preserves_agents_endpoint():
    convo = _format_convo({"conversationId": "c1", "endpoint": "agents", "title": "Hi"})
    assert convo["endpoint"] == "agents"


def test_format_convo_preserves_custom_endpoint():
    convo = _format_convo({"conversationId": "c1", "endpoint": "custom", "title": "Hi"})
    assert convo["endpoint"] == "custom"
