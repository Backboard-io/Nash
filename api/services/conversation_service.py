"""Conversation/thread metadata, backed by DynamoDB.

Every conversation can have several rows in nash_state under USER#{user_id}:
  CONVO#{cid}       — display metadata (title, model, folder, tags, ...)
  THREADMAP#{cid}   — bridge to the Backboard thread_id + the owning assistant
  REGEN#{cid}       — regen-graph for branched message history
  FALLBACK#{cid}    — persisted fallback notice prefixes per message_id
  MESSAGEFILES#{cid} — uploaded file descriptors per Backboard message_id
  DISPLAYTEXT#{cid} — visible-text/file overrides for rewritten user messages

The Backboard thread itself still lives on Backboard; its owner_assistant_id
(the user's main assistant, a folder's assistant, or an agent's assistant) is
recorded in the THREADMAP row.

The per-process thread map is a small read-through cache keyed by
(user_id, conversation_id). Re-keying it on user_id (vs. the previous
process-global dict) is the fix for the cross-user staleness the prior session
flagged.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Iterable

from api.services import state_service
from api.services.async_runner import run_async
from api.services.backboard_service import added_model_agent_id

logger = logging.getLogger(__name__)

# (user_id, conversation_id) -> thread_id. Stays small; OK to keep in-memory.
_thread_map: dict[tuple[str, str], str] = {}
# (user_id,) tuples — set of users whose THREADMAP rows we've loaded once.
_loaded_users: set[str] = set()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean(row: dict) -> dict:
    return {k: v for k, v in row.items() if k not in ("pk", "sk")}


def _load_thread_mappings(user_id: str) -> None:
    """Populate the in-process cache from DynamoDB for this user."""
    if user_id in _loaded_users:
        return
    for row in state_service.thread_map.list_for_user(user_id):
        cid = row.get("conversation_id") or row.get("conversationId")
        tid = row.get("thread_id") or row.get("threadId")
        if cid and tid:
            _thread_map.setdefault((user_id, str(cid)), str(tid))
    _loaded_users.add(user_id)


def clear_thread_cache(user_id: str | None = None) -> None:
    """Drop cached entries for a user (or for everyone if user_id is None)."""
    if user_id is None:
        _thread_map.clear()
        _loaded_users.clear()
        return
    keys_to_drop = [k for k in _thread_map if k[0] == user_id]
    for k in keys_to_drop:
        _thread_map.pop(k, None)
    _loaded_users.discard(user_id)


# ---------------------------------------------------------------------------
# Thread mapping
# ---------------------------------------------------------------------------

def _save_thread_map_row(
    user_id: str, conversation_id: str, thread_id: str, owner_assistant_id: str
) -> None:
    state_service.thread_map.put(
        user_id,
        conversation_id,
        {
            "conversation_id": conversation_id,
            "thread_id": thread_id,
            "owner_assistant_id": owner_assistant_id,
            "createdAt": _now(),
        },
    )
    _thread_map[(user_id, conversation_id)] = thread_id


async def _get_or_create_thread(
    user_id: str,
    owner_assistant_id: str,
    conversation_id: str | None,
    bb_client,
    *,
    persist: bool = True,
) -> tuple[str, str, bool]:
    """Returns (thread_id, conversation_id, is_new)."""
    if not persist:
        # Temporary chat: no conversation data in DynamoDB. A temp conversation
        # adopts its Backboard thread id as the conversation id, so follow-up
        # turns can re-derive the thread from the id alone — no stored mapping,
        # no reliance on the in-process cache (robust across workers/restarts).
        if conversation_id:
            return conversation_id, conversation_id, False
        thread = await bb_client.create_thread(owner_assistant_id)
        thread_id = str(thread.thread_id)
        # Tombstone the fresh thread immediately: the login thread-import
        # (password/SSO sessions) re-imports any non-tombstoned Backboard
        # thread, which would resurrect the "temporary" chat in the sidebar.
        # This is the ONE DynamoDB row a temp chat writes — an exclusion
        # marker (ids + timestamp), never conversation content.
        try:
            state_service.deleted_threads.put(
                user_id,
                thread_id,
                {
                    "thread_id": thread_id,
                    "conversation_id": thread_id,
                    "deletedAt": _now(),
                    "temporary": True,
                },
            )
        except Exception:
            logger.warning(
                "[convos] temp-chat tombstone write failed (non-fatal; thread "
                "may reappear via login import)", exc_info=True,
            )
        return thread_id, thread_id, True

    _load_thread_mappings(user_id)

    if conversation_id:
        cached = _thread_map.get((user_id, conversation_id))
        if cached:
            return cached, conversation_id, False

    thread = await bb_client.create_thread(owner_assistant_id)
    thread_id = str(thread.thread_id)
    if not conversation_id:
        conversation_id = thread_id

    _save_thread_map_row(user_id, conversation_id, thread_id, owner_assistant_id)
    return thread_id, conversation_id, True


def get_or_create_thread(
    user_id: str,
    owner_assistant_id: str,
    conversation_id: str | None = None,
    bb_client=None,
    *,
    persist: bool = True,
) -> tuple[str, str, bool]:
    if bb_client is None:
        raise ValueError("get_or_create_thread requires a Backboard client")
    return run_async(
        _get_or_create_thread(
            user_id, owner_assistant_id, conversation_id, bb_client, persist=persist
        )
    )


def get_thread_id_for_conversation(
    user_id: str, conversation_id: str
) -> str | None:
    _load_thread_mappings(user_id)
    return _thread_map.get((user_id, conversation_id))


def add_thread_mapping(
    user_id: str, conversation_id: str, thread_id: str, owner_assistant_id: str
) -> None:
    _save_thread_map_row(user_id, conversation_id, thread_id, owner_assistant_id)


def remove_thread_mapping(user_id: str, conversation_id: str) -> bool:
    _thread_map.pop((user_id, conversation_id), None)
    return state_service.thread_map.delete(user_id, conversation_id)


def get_thread_owner(user_id: str, conversation_id: str) -> str:
    """Return the Backboard assistant_id that owns this conversation's thread."""
    row = state_service.thread_map.get(user_id, conversation_id)
    if not row:
        return ""
    return str(row.get("owner_assistant_id") or "")


def list_folder_conversation_ids(user_id: str, folder_owner_assistant_id: str) -> list[dict]:
    """Return [{conversationId, threadId}] for every conversation whose thread
    is owned by the given folder's Backboard assistant.
    """
    out: list[dict] = []
    seen: set[str] = set()
    for row in state_service.thread_map.list_for_user(user_id):
        if row.get("owner_assistant_id") != folder_owner_assistant_id:
            continue
        cid = row.get("conversation_id") or row.get("conversationId") or ""
        tid = row.get("thread_id") or row.get("threadId") or ""
        if cid and cid not in seen:
            seen.add(str(cid))
            out.append({"conversationId": str(cid), "threadId": str(tid)})
    return out


# ---------------------------------------------------------------------------
# Conversation metadata
# ---------------------------------------------------------------------------

def _merge_meta(existing: dict | None, updates: dict) -> dict:
    now = _now()
    merged: dict = _clean(existing) if existing else {}
    merged.update(updates)
    merged.setdefault("createdAt", merged.get("createdAt") or now)
    merged["updatedAt"] = now
    return merged


def save_conversation_meta(
    user_id: str, conversation_id: str, meta: dict, bb_client=None
) -> None:
    existing = state_service.convo_meta.get(user_id, conversation_id)
    merged = _merge_meta(existing, meta)
    merged["conversationId"] = conversation_id
    state_service.convo_meta.put(user_id, conversation_id, merged)


# Async variant kept for chat.py's hot path so it can await within a coroutine.
async def _save_conversation_meta(
    user_id: str, conversation_id: str, meta: dict, bb_client=None
) -> None:
    save_conversation_meta(user_id, conversation_id, meta, bb_client)


# Titles that mean "not titled yet" — safe to overwrite with a derived one.
PLACEHOLDER_TITLES = {"", "New Chat", "Voice chat"}


def maybe_autotitle_conversation(user_id: str, conversation_id: str, text: str) -> str | None:
    """Derive a title from `text` (first user utterance / reply) and save it,
    but only while the conversation still has a placeholder title. Mirrors the
    text-chat flow's 60-char truncation. Returns the new title, or None if the
    title was left untouched. Never raises — titling is best-effort.
    """
    snippet = (text or "").replace("\n", " ").strip()
    if not snippet or not conversation_id:
        return None
    try:
        current = (get_conversation_meta(user_id, conversation_id).get("title") or "").strip()
        if current not in PLACEHOLDER_TITLES:
            return None
        title = snippet[:60] + ("..." if len(snippet) > 60 else "")
        save_conversation_meta(user_id, conversation_id, {"title": title})
        return title
    except Exception:
        logger.warning("[convos] auto-title failed (non-fatal)", exc_info=True)
        return None


def get_conversation_meta(user_id: str, conversation_id: str, bb_client=None) -> dict:
    row = state_service.convo_meta.get(user_id, conversation_id)
    if not row:
        return {}
    return _clean(row)


async def _get_conversation_meta(user_id: str, conversation_id: str, bb_client=None) -> dict:
    return get_conversation_meta(user_id, conversation_id, bb_client)


def list_conversations(user_id: str, bb_client=None) -> list[dict]:
    """Merge convo_meta + thread_map rows into a UI-shaped conversation list."""
    convos: list[dict] = []
    convos_by_id: dict[str, dict] = {}
    for row in state_service.convo_meta.list_for_user(user_id):
        clean = _clean(row)
        cid = clean.get("conversationId") or row.get("sk", "").removeprefix(state_service.SK_CONVO_PREFIX)
        clean["conversationId"] = cid
        convos.append(clean)
        convos_by_id[cid] = clean

    # Surface thread_map rows that don't have a matching convo_meta as
    # placeholder "New Chat" entries — preserves the lazy-write behavior.
    for row in state_service.thread_map.list_for_user(user_id):
        cid = row.get("conversation_id") or row.get("conversationId") or ""
        if not cid or cid in convos_by_id:
            # Refresh the in-process cache while we're iterating.
            tid = row.get("thread_id") or row.get("threadId")
            if cid and tid:
                _thread_map.setdefault((user_id, str(cid)), str(tid))
            continue
        convos.append({
            "conversationId": cid,
            "title": "New Chat",
            "endpoint": "custom",
            "model": "",
            "createdAt": "",
            "updatedAt": "",
            "isArchived": False,
            "tags": [],
        })

    _loaded_users.add(user_id)
    convos.sort(key=lambda c: c.get("updatedAt", ""), reverse=True)
    return convos


def delete_conversation_meta(user_id: str, conversation_id: str, bb_client=None) -> bool:
    return state_service.convo_meta.delete(user_id, conversation_id)


async def _delete_conversation_meta(user_id: str, conversation_id: str, bb_client=None) -> bool:
    return delete_conversation_meta(user_id, conversation_id, bb_client)


def get_conversation_forked_messages(
    user_id: str, conversation_id: str, bb_client=None
) -> list | None:
    row = state_service.convo_meta.get(user_id, conversation_id)
    if not row:
        return None
    return row.get("forked_messages") or None


# ---------------------------------------------------------------------------
# Regen graph
# ---------------------------------------------------------------------------

def save_regen_graph(
    user_id: str, conversation_id: str, updates: dict, bb_client=None
) -> None:
    existing = state_service.regen_graph.get(user_id, conversation_id)
    graph = (existing or {}).get("graph", {}) if existing else {}
    graph.update(updates)
    state_service.regen_graph.put(
        user_id,
        conversation_id,
        {"conversationId": conversation_id, "graph": graph, "updatedAt": _now()},
    )


def get_regen_graph(user_id: str, conversation_id: str, bb_client=None) -> dict:
    row = state_service.regen_graph.get(user_id, conversation_id)
    if not row:
        return {}
    return dict(row.get("graph", {}))


# ---------------------------------------------------------------------------
# Fallback notices
# ---------------------------------------------------------------------------

def save_fallback_notice(
    user_id: str, conversation_id: str, updates: dict, bb_client=None
) -> None:
    existing = state_service.fallback_notice.get(user_id, conversation_id)
    notices = (existing or {}).get("notices", {}) if existing else {}
    notices.update(updates)
    state_service.fallback_notice.put(
        user_id,
        conversation_id,
        {"conversationId": conversation_id, "notices": notices, "updatedAt": _now()},
    )


def get_fallback_notice_map(
    user_id: str, conversation_id: str, bb_client=None
) -> dict:
    row = state_service.fallback_notice.get(user_id, conversation_id)
    if not row:
        return {}
    return dict(row.get("notices", {}))


def save_generated_media(
    user_id: str, conversation_id: str, updates: dict[str, list[str]]
) -> None:
    """Persist the generated-image document IDs produced for each assistant
    message, keyed by its Backboard message id.

    Generated images arrive as an out-of-band ``media_generated`` event and are
    only inlined into the STREAMED text — Backboard's stored message content
    never contains them, so a refresh would otherwise lose them. Persisting the
    doc ids lets the message reload re-inject the (already-persisted) image, the
    same way an S3-bucket image in the message text is rewritten and rendered.
    """
    existing = state_service.generated_media.get(user_id, conversation_id)
    media = (existing or {}).get("media", {}) if existing else {}
    for msg_id, doc_ids in updates.items():
        merged = list(dict.fromkeys([*media.get(msg_id, []), *doc_ids]))
        media[msg_id] = merged
    state_service.generated_media.put(
        user_id,
        conversation_id,
        {"conversationId": conversation_id, "media": media, "updatedAt": _now()},
    )


def get_generated_media_map(
    user_id: str, conversation_id: str
) -> dict[str, list[str]]:
    row = state_service.generated_media.get(user_id, conversation_id)
    if not row:
        return {}
    media = row.get("media", {})
    return dict(media) if isinstance(media, dict) else {}


# ---------------------------------------------------------------------------
# Message files
# ---------------------------------------------------------------------------

def get_message_files_map(user_id: str, conversation_id: str) -> dict[str, list[dict]]:
    row = state_service.message_files.get(user_id, conversation_id)
    if row:
        files = row.get("files", {})
        return dict(files) if isinstance(files, dict) else {}

    # Compatibility with conversations written before MESSAGEFILES became a
    # dedicated row. The next save migrates this map into the dedicated entity.
    try:
        legacy = get_conversation_meta(user_id, conversation_id).get("messageFiles", {})
    except Exception:
        legacy = {}
    return dict(legacy) if isinstance(legacy, dict) else {}


def save_message_files(
    user_id: str, conversation_id: str, message_id: str, files: list[dict]
) -> None:
    if not message_id or not files:
        return
    files_by_message = get_message_files_map(user_id, conversation_id)
    files_by_message[str(message_id)] = files
    state_service.message_files.put(
        user_id,
        conversation_id,
        {
            "conversationId": conversation_id,
            "files": files_by_message,
            "updatedAt": _now(),
        },
    )


# ---------------------------------------------------------------------------
# Display text overrides
#
# Some text sent to Backboard is intentionally rewritten for model routing
# (for example, long pasted text is uploaded as a document and replaced with a
# short "read document X" instruction). These overrides preserve what Nash
# should show in the chat UI when rehydrating from the Backboard thread.
# ---------------------------------------------------------------------------

def save_display_text_overrides(
    user_id: str, conversation_id: str, updates: dict, bb_client=None
) -> None:
    existing = state_service.display_text.get(user_id, conversation_id)
    overrides = (existing or {}).get("overrides", {}) if existing else {}
    overrides.update({str(k): str(v) for k, v in updates.items() if k and v is not None})
    state_service.display_text.put(
        user_id,
        conversation_id,
        {
            "conversationId": conversation_id,
            "overrides": overrides,
            "files": (existing or {}).get("files", {}) if existing else {},
            "updatedAt": _now(),
        },
    )


def get_display_text_map(
    user_id: str, conversation_id: str, bb_client=None
) -> dict:
    row = state_service.display_text.get(user_id, conversation_id)
    if not row:
        return {}
    return dict(row.get("overrides", {}))


def save_display_file_overrides(
    user_id: str, conversation_id: str, updates: dict, bb_client=None
) -> None:
    existing = state_service.display_text.get(user_id, conversation_id)
    files = (existing or {}).get("files", {}) if existing else {}
    files.update({str(k): v for k, v in updates.items() if k and v is not None})
    state_service.display_text.put(
        user_id,
        conversation_id,
        {
            "conversationId": conversation_id,
            "overrides": (existing or {}).get("overrides", {}) if existing else {},
            "files": files,
            "updatedAt": _now(),
        },
    )


def get_display_file_map(
    user_id: str, conversation_id: str, bb_client=None
) -> dict:
    row = state_service.display_text.get(user_id, conversation_id)
    if not row:
        return {}
    return dict(row.get("files", {}))


# ---------------------------------------------------------------------------
# Added-model (multi-conversation) responses
#
# The added model's turn runs on a disposable, one-shot Backboard thread (see
# chat._run_added_model_turn) — there's no persistent thread to read back from
# on refresh. This is the durable copy, merged into GET /api/messages.
# ---------------------------------------------------------------------------

# Every entry lives in ONE DynamoDB item (nested dict, read-modify-write —
# see save_added_response), unlike fallback_notice's short fixed-template
# strings written only on rare provider fallback. A long-lived compare-mode
# conversation's full model replies, one per turn, unbounded, risk the 400KB
# per-item limit. Cap to the most recent N turns — DynamoDB write failures
# past that point would otherwise be silent (caller only logs and swallows).
_MAX_ADDED_RESPONSES_PER_CONVERSATION = 100


def save_added_response(
    user_id: str, conversation_id: str, message_id: str, response: dict
) -> None:
    """response: {"text": str, "model": str, "agentId": str, "ok": bool}."""
    existing = state_service.added_response.get(user_id, conversation_id)
    responses = (existing or {}).get("responses", {}) if existing else {}
    responses[message_id] = response
    if len(responses) > _MAX_ADDED_RESPONSES_PER_CONVERSATION:
        # Dicts preserve insertion order — oldest entries were inserted
        # first. Evict enough of them to get back under the cap; forked
        # copies of the trimmed messages already froze their own content at
        # fork time (conversations.py), so this doesn't affect them. Logged
        # (not silent) since eviction permanently loses an old turn's
        # added-model answer — worth being able to see it happening.
        overflow = len(responses) - _MAX_ADDED_RESPONSES_PER_CONVERSATION
        evicted_ids = list(responses.keys())[:overflow]
        for stale_id in evicted_ids:
            del responses[stale_id]
        logger.warning(
            "[conversation_service] added_response cap hit for conversation %s — "
            "evicted %d oldest entr%s: %s",
            conversation_id,
            len(evicted_ids),
            "y" if len(evicted_ids) == 1 else "ies",
            evicted_ids,
        )
    state_service.added_response.put(
        user_id,
        conversation_id,
        {"conversationId": conversation_id, "responses": responses, "updatedAt": _now()},
    )


def get_added_response_map(user_id: str, conversation_id: str) -> dict:
    row = state_service.added_response.get(user_id, conversation_id)
    if not row:
        return {}
    return dict(row.get("responses", {}))


def content_with_added_response(
    text: str, convo_endpoint: str, convo_model: str, added_entry: dict | None
) -> list[dict] | None:
    """Build a 2-column parallel content array for a message that has a
    durably-stored added-model response, tagged the same way chat.py tags the
    live SSE turn (agentId/groupId) so ParallelContent.tsx renders identically
    whether the message just streamed in or was loaded on refresh/shared.

    Returns None when there's no added response for this message — callers
    keep the existing flat-text shape for every ordinary message.
    """
    if not added_entry:
        return None
    # chat.py already bakes a distinguishable "⚠️ ..." message into `text`
    # itself for failures before saving (there's no per-content-part error
    # flag the frontend renders on today) — this fallback only covers rows
    # saved before that existed, or a somehow-empty text on an "ok" row.
    added_text = added_entry.get("text") or "⚠️ _This model didn't respond. Please try again._"
    # "openai" fallback (not "") matches chat.py's primary-endpoint resolution —
    # an empty endpoint produces a leading "__" in the encoded agentId, which
    # parseEphemeralAgentId (client-side) can't parse back into a clean label.
    added_agent_id = added_entry.get("agentId") or added_model_agent_id(
        "openai", added_entry.get("model") or "", index=1
    )
    primary_agent_id = added_model_agent_id(convo_endpoint or "openai", convo_model or "")
    return [
        {"type": "text", "text": {"value": text}, "agentId": primary_agent_id, "groupId": 1},
        {"type": "text", "text": {"value": added_text}, "agentId": added_agent_id, "groupId": 1},
    ]
