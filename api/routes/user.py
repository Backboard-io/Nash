import hashlib
import logging
import os
import time
from datetime import datetime, timezone

import httpx
from flask import Blueprint, jsonify, request, g, make_response

from api.config import settings
from api.middleware.session_auth import require_auth
from api.services import audit_service, context_service, conversation_service, state_service
from api.services.async_runner import run_async
from api.services.backboard_service import (
    get_request_assistant_id,
    get_request_client,
    get_request_state_partition,
    get_user_client,
)
from api.services.user_service import (
    delete_user,
    find_user_by_id,
    update_user_field,
)

user_bp = Blueprint("user", __name__)
logger = logging.getLogger(__name__)


def _user_bb_client():
    return get_request_client()


def _get_user_or_none():
    """Get the user record for the session, or None for keyless sessions."""
    uid = getattr(g, 'user_id', None)
    return find_user_by_id(uid) if uid else None


# Per-user state rows that are "chat data" and should clear on chat-data wipe.
# Folders/tags/presets/agents/prompts/MCP/favorites are kept across wipes.
_CHAT_DATA_SK_PREFIXES = (
    state_service.SK_CONVO_PREFIX,
    state_service.SK_THREADMAP_PREFIX,
    state_service.SK_REGEN_PREFIX,
    state_service.SK_FALLBACK_PREFIX,
    state_service.SK_FILEMETA_PREFIX,
)


def _is_chat_data_row(sk: str) -> bool:
    return any(sk.startswith(p) for p in _CHAT_DATA_SK_PREFIXES)


@user_bp.route("/api/user", methods=["GET"])
@require_auth
def get_user():
    user = _get_user_or_none()
    if not user:
        # Session auth: return synthetic user profile
        return jsonify({
            "id": "byok-user",
            "email": "",
            "name": "BYOK User",
            "username": "byok-user",
            "nickname": "",
            "avatar": "",
            "provider": "apikey",
            "role": "USER",
            "emailVerified": True,
            "hasApiKey": True,
            "personalization": {"memories": True},
            "createdAt": "",
            "updatedAt": "",
        })
    return jsonify({
        "id": user["id"],
        "email": user.get("email", ""),
        "name": user.get("name", ""),
        "username": user.get("username", ""),
        "nickname": user.get("nickname", ""),
        "avatar": user.get("avatar", ""),
        "provider": user.get("provider", ""),
        "role": user.get("role", "USER"),
        "emailVerified": user.get("emailVerified", True),
        "hasApiKey": bool(user.get("bbApiKey")),
        "personalization": user.get("personalization") or {"memories": True},
        "createdAt": user.get("createdAt", ""),
        "updatedAt": user.get("updatedAt", ""),
    })


@user_bp.route("/api/user/profile", methods=["PATCH"])
@require_auth
def update_profile():
    data = request.get_json() or {}
    user = _get_user_or_none()
    if not user:
        return jsonify({"error": "User not found"}), 404
    if "nickname" in data:
        nickname = str(data["nickname"]).strip()[:64]
        update_user_field(user, "nickname", nickname)
    return jsonify({
        "id": user["id"],
        "nickname": user.get("nickname", ""),
        "hasApiKey": True,
    })


@user_bp.route("/api/user/chat-data", methods=["DELETE"])
@require_auth
def delete_chat_data():
    # Scoped to the ACTIVE context: the session's partition, assistant and
    # key all belong to it, so org data clears under the org world and
    # personal data under the personal one.
    user_id = get_request_state_partition()
    assistant_id = get_request_assistant_id()
    bb = _user_bb_client()

    # Snapshot thread IDs from the thread_map before we delete it.
    thread_ids: set[str] = set()
    for row in state_service.query_prefix(state_service.user_pk(user_id), state_service.SK_THREADMAP_PREFIX):
        tid = row.get("thread_id") or row.get("threadId")
        if tid:
            thread_ids.add(str(tid))

    # Delete all chat-data rows from DynamoDB.
    deleted_rows = 0
    for row in state_service.query_user(state_service.user_pk(user_id)):
        sk = row.get("sk", "")
        if _is_chat_data_row(sk):
            state_service.delete_item(row["pk"], sk)
            deleted_rows += 1

    async def _delete_backboard_side():
        threads_deleted = 0
        documents_deleted = 0
        memories_deleted = 0

        # Delete threads.
        for thread_id in thread_ids:
            try:
                await bb._make_request("DELETE", f"threads/{thread_id}")
                threads_deleted += 1
            except Exception:
                pass

        # Delete user-uploaded documents from the assistant.
        try:
            live_docs = await bb.list_assistant_documents(assistant_id)
            for doc in live_docs:
                try:
                    await bb.delete_document(doc.document_id)
                    documents_deleted += 1
                except Exception:
                    pass
        except Exception:
            pass

        # Wipe Backboard's user-fact memories on the assistant.
        try:
            response = await bb.get_memories(assistant_id)
            for m in response.memories:
                try:
                    await bb.delete_memory(assistant_id=assistant_id, memory_id=m.id)
                    memories_deleted += 1
                except Exception:
                    pass
        except Exception:
            pass

        return threads_deleted, documents_deleted, memories_deleted

    threads_deleted, documents_deleted, memories_deleted = run_async(_delete_backboard_side())

    # Clear in-memory thread cache for this user.
    conversation_service.clear_thread_cache(user_id)

    audit_service.emit(
        "user.data_deleted",
        user_id=getattr(g, 'user_id', None) or 'byok-user',
        deleted_count=deleted_rows + memories_deleted,
        threads_deleted=threads_deleted,
        documents_deleted=documents_deleted,
    )
    return jsonify({
        "message": f"Cleared {deleted_rows + memories_deleted} records",
        "threads_deleted": threads_deleted,
        "documents_deleted": documents_deleted,
    })


@user_bp.route("/api/user/terms", methods=["GET"])
@require_auth
def get_terms():
    user = _get_user_or_none()
    if not user:
        return jsonify({"termsAccepted": True, "termsAcceptedAt": None})
    terms_accepted_at = user.get("termsAcceptedAt") or None
    return jsonify({
        "termsAccepted": terms_accepted_at is not None,
        "termsAcceptedAt": terms_accepted_at,
    })


@user_bp.route("/api/user/terms/accept", methods=["POST"])
@require_auth
def accept_terms():
    user = _get_user_or_none()
    if not user:
        return jsonify({"message": "ok", "termsAcceptedAt": None})
    accepted_at = datetime.now(timezone.utc).isoformat()
    update_user_field(user, "termsAcceptedAt", accepted_at)
    audit_service.emit("user.terms_accepted", user_id=getattr(g, 'user_id', None) or 'byok-user')
    return jsonify({"message": "ok", "termsAcceptedAt": accepted_at})


_COOKIE_CHOICES = {"accept_all", "essential_only"}


@user_bp.route("/api/user/cookie-consent", methods=["GET"])
@require_auth
def get_cookie_consent():
    user = _get_user_or_none()
    if not user:
        return jsonify({"accepted": False, "choice": None, "at": None})
    at = user.get("cookieConsentAt") or None
    return jsonify({
        "accepted": at is not None,
        "choice": user.get("cookieConsentChoice") or None,
        "at": at,
    })


@user_bp.route("/api/user/cookie-consent", methods=["POST"])
@require_auth
def set_cookie_consent():
    user = _get_user_or_none()
    if not user:
        return jsonify({"message": "ok", "at": None})
    data = request.get_json(silent=True) or {}
    choice = (data.get("choice") or "").strip()
    if choice not in _COOKIE_CHOICES:
        return jsonify({"error": "invalid choice"}), 400
    at = datetime.now(timezone.utc).isoformat()
    update_user_field(user, "cookieConsentAt", at)
    update_user_field(user, "cookieConsentChoice", choice)
    return jsonify({"message": "ok", "at": at, "choice": choice})


@user_bp.route("/api/user/chat-assistant", methods=["GET"])
@require_auth
def get_chat_assistant():
    try:
        assistant_id = get_request_assistant_id()
    except ValueError:
        return jsonify({"error": "User has no chat assistant"}), 404
    bb = _user_bb_client()

    async def _fetch():
        assistant = await bb.get_assistant(assistant_id)
        prompt = getattr(assistant, "system_prompt", None) or getattr(
            assistant, "instructions", None
        ) or ""
        return str(prompt) if prompt is not None else ""

    system_prompt = run_async(_fetch())
    return jsonify({"system_prompt": system_prompt})


@user_bp.route("/api/user/chat-assistant", methods=["PATCH"])
@require_auth
def update_chat_assistant():
    data = request.get_json(silent=True) or {}
    system_prompt = data.get("system_prompt")
    if system_prompt is None:
        return jsonify({"error": "system_prompt is required"}), 400
    system_prompt = str(system_prompt).strip()

    try:
        assistant_id = get_request_assistant_id()
    except ValueError:
        return jsonify({"error": "User has no chat assistant"}), 404
    bb = _user_bb_client()

    async def _update():
        await bb.update_assistant(
            assistant_id=assistant_id,
            system_prompt=system_prompt or "",
        )

    run_async(_update())
    audit_service.emit("user.chat_assistant_updated", user_id=getattr(g, 'user_id', None) or 'byok-user')
    return jsonify({"system_prompt": system_prompt or ""})


@user_bp.route("/api/user/account", methods=["DELETE"])
# The client's deleteUser() calls DELETE /api/user/delete (see
# packages/data-provider api-endpoints.ts). That path was never registered, so
# the "Delete account" button 404'd while the UI's onMutate=logout() masked the
# failure — the account looked deleted but nothing (profile, chats, Backboard
# threads) was actually wiped. Accept both paths so the real erasure runs.
@user_bp.route("/api/user/delete", methods=["DELETE"])
@require_auth
def delete_account():
    """Permanent full account deletion (right to erasure).

    Multi-org: the account owns one state partition per context — the
    personal one (= the raw user id) plus USER#{id}#ORG#{clientId} for every
    org in bbContexts. For each partition:
      1. Snapshot thread/document ids from DynamoDB.
      2. Delete Backboard threads, documents, and assistant memories using
         THAT context's stored key (the session's key cannot touch other
         contexts' threads; contexts with a dead/missing key are wiped from
         Nash state only).
      3. Wipe every row in the partition.
    Then delete the PROFILE + EMAIL/SUB lookup index rows.
    """
    user = _get_user_or_none()
    if not user:
        return jsonify({"error": "User not found"}), 404

    user_id = user["id"]

    # One wipe target: the personal partition.
    personal_key = context_service.get_context_api_key(
        user, context_service.PERSONAL_CONTEXT_ID
    )
    if not personal_key:
        # Legacy account with no bbContexts yet: a personal session's key IS
        # the personal key.
        personal_key = getattr(g, "bb_api_key", "") or ""

    targets = [{
        "partition": user_id,
        "context_id": context_service.PERSONAL_CONTEXT_ID,
        "api_key": personal_key,
        "assistant_id": user.get("bbAssistantId", ""),
    }]

    async def _wipe_backboard(bb, thread_ids, document_ids, chat_assistant_id):
        threads_deleted = 0
        documents_deleted = 0
        memories_deleted = 0

        # Enumerate EVERY thread under the assistant on Backboard, not just the
        # ones Nash tracked in THREADMAP. A re-login with the same identity
        # is handed the SAME Backboard assistant, and
        # GET /api/convos re-imports any thread still living under it
        # (thread_import_service). So a thread we miss here reappears as a chat
        # on the "new" account — deleting at the source is what makes the
        # erasure actually stick. Union with the THREADMAP-derived ids so we
        # still cover anything the listing endpoint can't page to.
        all_thread_ids: set[str] = set(thread_ids)
        live_listed_count = 0
        if chat_assistant_id:
            skip, limit = 0, 200
            # Safety cap on pages; breaks early when a short page ends the list.
            for _ in range(1000):
                try:
                    resp = await bb._make_request(
                        "GET",
                        f"/assistants/{chat_assistant_id}/threads",
                        params={"skip": skip, "limit": limit},
                    )
                    batch = resp.json() or []
                except Exception:
                    logger.warning(
                        "account_deletion: thread listing failed for assistant %s",
                        chat_assistant_id, exc_info=True,
                    )
                    break
                if not isinstance(batch, list) or not batch:
                    break
                for r in batch:
                    if isinstance(r, dict):
                        tid = str(r.get("thread_id") or r.get("id") or "")
                        if tid:
                            all_thread_ids.add(tid)
                            live_listed_count += 1
                if len(batch) < limit:
                    break
                skip += limit
        else:
            logger.warning(
                "account_deletion: no chat_assistant_id — skipping live thread "
                "listing and memory wipe, only THREADMAP-known threads will be tried"
            )

        logger.info(
            "account_deletion: assistant=%r live_listed_threads=%d "
            "threadmap_threads=%d union=%d",
            chat_assistant_id, live_listed_count, len(thread_ids), len(all_thread_ids),
        )

        for thread_id in all_thread_ids:
            try:
                await bb._make_request("DELETE", f"threads/{thread_id}")
                threads_deleted += 1
            except Exception:
                logger.warning(
                    "account_deletion: failed to delete Backboard thread %s",
                    thread_id, exc_info=True,
                )

        # Same gap as threads had: document_ids alone is only what Nash's own
        # FILEMETA# rows happen to track. A document ingested on the
        # assistant through any path Nash didn't record (a dropped/failed
        # FILEMETA write, a document uploaded straight through Backboard,
        # a thread re-import that brings its own already-uploaded docs)
        # would never be deleted and would sit on the Backboard dashboard
        # forever. List what's actually on the assistant and union it in.
        all_document_ids: set[str] = set(document_ids)
        live_listed_docs = 0
        if chat_assistant_id:
            try:
                docs = await bb.list_assistant_documents(chat_assistant_id)
                for doc in docs:
                    did = str(getattr(doc, "document_id", "") or "")
                    if did:
                        all_document_ids.add(did)
                        live_listed_docs += 1
            except Exception:
                logger.warning(
                    "account_deletion: document listing failed for assistant %s",
                    chat_assistant_id, exc_info=True,
                )

        logger.info(
            "account_deletion: assistant=%r live_listed_documents=%d "
            "filemeta_documents=%d union=%d",
            chat_assistant_id, live_listed_docs, len(document_ids), len(all_document_ids),
        )

        for did in all_document_ids:
            try:
                await bb.delete_document(did)
                documents_deleted += 1
            except Exception:
                logger.warning(
                    "account_deletion: failed to delete Backboard document %s",
                    did, exc_info=True,
                )

        if chat_assistant_id:
            try:
                response = await bb.get_memories(chat_assistant_id)
                for m in response.memories:
                    try:
                        await bb.delete_memory(assistant_id=chat_assistant_id, memory_id=m.id)
                        memories_deleted += 1
                    except Exception:
                        logger.warning(
                            "account_deletion: failed to delete Backboard memory %s "
                            "(assistant %s)", m.id, chat_assistant_id, exc_info=True,
                        )
            except Exception:
                logger.warning(
                    "account_deletion: failed to fetch memories for assistant %s",
                    chat_assistant_id, exc_info=True,
                )

        return threads_deleted, documents_deleted, memories_deleted

    threads_deleted = documents_deleted = memories_deleted = 0
    skipped_contexts: list[str] = []
    for target in targets:
        partition = target["partition"]
        partition_pk = state_service.user_pk(partition)

        thread_ids: set[str] = set()
        for row in state_service.query_prefix(partition_pk, state_service.SK_THREADMAP_PREFIX):
            tid = row.get("thread_id") or row.get("threadId")
            if tid:
                thread_ids.add(str(tid))

        document_ids: list[str] = []
        for row in state_service.query_prefix(partition_pk, state_service.SK_FILEMETA_PREFIX):
            did = row.get("document_id")
            if did:
                document_ids.append(str(did))

        logger.info(
            "account_deletion: partition=%s assistant_id=%r api_key_present=%s "
            "threadmap_threads=%d filemeta_docs=%d",
            partition, target["assistant_id"], bool(target["api_key"]),
            len(thread_ids), len(document_ids),
        )

        # Never fall back to the system client here — an empty key must skip
        # the Backboard wipe, not delete under some other account.
        bb = get_user_client(target["api_key"]) if target["api_key"] else None
        if bb is not None:
            t, d, m = run_async(
                _wipe_backboard(bb, thread_ids, document_ids, target["assistant_id"])
            )
            threads_deleted += t
            documents_deleted += d
            memories_deleted += m
        else:
            skipped_contexts.append(target["context_id"])
            logger.warning(
                "account_deletion: no Backboard API key for partition %s — "
                "Backboard-side wipe skipped entirely (%d threads, %d docs left "
                "on Backboard)", partition, len(thread_ids), len(document_ids),
            )

        # Wipe every row in this partition (folders, tags, presets, agents,
        # prompts, MCP, favorites, file_meta, conversation state, etc.).
        for row in state_service.query_user(partition_pk):
            # file_meta rows point at Nash's own on-disk copy of an
            # uploaded/generated image. Deleting the DynamoDB row alone would
            # leave the blob orphaned on disk, so remove the file too — a
            # true "delete everything" account erasure, matching what
            # single-file delete already does.
            local_path = row.get("filepath", "")
            if local_path and os.path.exists(local_path):
                try:
                    os.remove(local_path)
                except OSError:
                    pass
            try:
                state_service.delete_item(row["pk"], row["sk"])
            except Exception:
                pass

        conversation_service.clear_thread_cache(partition)

    # Profile + lookup indices.
    delete_user(user)

    audit_service.emit(
        "user.account_deleted",
        user_id=getattr(g, 'user_id', None) or 'byok-user',
        memories_deleted=memories_deleted,
        threads_deleted=threads_deleted,
        documents_deleted=documents_deleted,
        backboard_wipe_incomplete=bool(skipped_contexts),
        contexts_skipped=len(skipped_contexts),
    )

    # Nash's own data is always fully gone at this point. But if any context
    # partition had no stored Backboard API key, that partition's threads,
    # documents, and memories were never wiped on Backboard (see the "Never
    # fall back to the system client" branch above) — the response must say
    # so rather than reporting a clean "Account permanently deleted" while
    # Backboard content silently survives.
    body = {"message": "Account permanently deleted"}
    if skipped_contexts:
        body["backboardWipeIncomplete"] = True
        body["contextsSkipped"] = skipped_contexts
        body["message"] = (
            "Account permanently deleted. Backboard content for "
            f"{len(skipped_contexts)} context(s) could not be wiped "
            "(no stored API key) and may still appear on the Backboard "
            "dashboard."
        )
    else:
        body["backboardWipeIncomplete"] = False

    response = make_response(jsonify(body))
    return response


# Per-user (hashed key) balance cache. The upstream read is a synchronous
# Backboard call with a 10s timeout, and the client refetches balance on
# window focus and after every completed generation — uncached, each of
# those stalls a request on the single worker for the full upstream RTT
# (measured 620-780ms). Failures are negative-cached briefly so an outage
# costs one probe per window instead of a 10s stall per call.
_balance_cache: dict[str, tuple[float, dict, bool]] = {}
_BALANCE_CACHE_TTL_SEC = 60.0
_BALANCE_FAIL_TTL_SEC = 15.0
# Cheap bound (same pattern as dynamo_service._last_touch): one entry per
# distinct API key, cleared wholesale at the cap so the dict can't grow for
# the life of a long-running worker.
_BALANCE_CACHE_MAX_ENTRIES = 10_000
_balance_http = httpx.Client(timeout=10)


def invalidate_balance_cache(api_key: str) -> None:
    """Drop the cached wallet for this key.

    Called from the chat generation-completion path: the wallet just changed,
    so the client's SSE-final refetch must read the post-spend value instead
    of a cached pre-spend snapshot.
    """
    if not api_key:
        return
    _balance_cache.pop(hashlib.sha256(api_key.encode("utf-8")).hexdigest(), None)


@user_bp.route("/api/balance", methods=["GET"])
@require_auth
def get_balance():
    """The caller's Nash pool + Backboard wallet balances (personal key).

    Drives the plan badge: a paid plan with nash credits shows the plan name;
    an empty pool (or no plan) means the Backboard wallet is paying, so the
    badge swaps to "Backboard plan". Nulls mean "could not read" — the client
    must treat that as unknown, never as an empty pool.
    """
    payload = {
        "tokenCredits": 0,
        "tokenCreditsUsd": 0,
        "nashCreditsUsd": None,
        "nashAllocationUsd": None,
        "backboardCreditsUsd": None,
    }
    api_key = str(getattr(g, "bb_api_key", "") or "")
    if not api_key:
        user = find_user_by_id(g.user_id)
        if user:
            api_key = (
                context_service.get_context_api_key(user, context_service.PERSONAL_CONTEXT_ID)
                or str(user.get("bbApiKey") or "")
            )
    if api_key:
        cache_key = hashlib.sha256(api_key.encode("utf-8")).hexdigest()
        cached = _balance_cache.get(cache_key)
        if cached is not None:
            ts, cached_payload, ok = cached
            ttl = _BALANCE_CACHE_TTL_SEC if ok else _BALANCE_FAIL_TTL_SEC
            if (time.monotonic() - ts) < ttl:
                return jsonify(cached_payload)
        ok = False
        try:
            resp = _balance_http.get(
                f"{settings.backboard_api_url.rstrip('/')}/billing/balance",
                headers={"X-API-Key": api_key},
            )
            if resp.status_code == 200:
                wallet = resp.json()
                payload["nashCreditsUsd"] = float(wallet.get("nash_credit_usd") or 0)
                payload["nashAllocationUsd"] = float(wallet.get("nash_allocation_usd") or 0)
                payload["backboardCreditsUsd"] = float(wallet.get("paid_credit_usd") or 0) + float(
                    wallet.get("subscription_credits_usd") or 0
                )
                ok = True
        except Exception:
            logger.warning("[balance] Backboard wallet read failed", exc_info=True)
        if not ok and cached is not None:
            # A blip serves the last-known value for the short failure TTL
            # instead of nulls (which the client renders as "could not read").
            payload = cached[1]
        if len(_balance_cache) >= _BALANCE_CACHE_MAX_ENTRIES:
            _balance_cache.clear()
        _balance_cache[cache_key] = (time.monotonic(), payload, ok)
    return jsonify(payload)
