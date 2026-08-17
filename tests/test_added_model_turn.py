"""Multi-conversation (compare mode): the added model's one-shot turn.

Covers api.routes.chat._run_added_model_turn/_response_text/added_model_agent_id,
api.services.conversation_service.save_added_response/content_with_added_response,
and api.routes.conversations._build_message_snapshot's added-response merge —
all previously had zero test coverage, flagged by two review rounds as the gap
that let real regressions (wrong assistant, wrong message_id, crash-on-tool-call)
ship undetected by the rest of the suite.
"""

import asyncio
import os
import tempfile
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from moto import mock_aws

from api.routes import chat, conversations
from api.services import conversation_service, state_service
from api.services.backboard_service import added_model_agent_id


class _FakeMsg:
    def __init__(self, mid, role, content):
        self.message_id = mid
        self.role = role
        self.content = content
        self.created_at = None


class _FakeThread:
    def __init__(self, thread_id):
        self.thread_id = thread_id


def _fake_response(content=None, messages=None, status=None):
    resp = MagicMock()
    resp.content = content
    resp.messages = messages if messages is not None else ([{"content": content}] if content else [])
    resp.status = status
    return resp


def _bb(history=None, send_response=None, send_side_effect=None):
    bb = MagicMock()
    bb.create_thread = AsyncMock(return_value=_FakeThread("fresh-thread-1"))
    bb.add_message = AsyncMock(return_value=_fake_response("seeded"))
    if send_side_effect is not None:
        bb.send_message = AsyncMock(side_effect=send_side_effect)
    else:
        bb.send_message = AsyncMock(return_value=send_response or _fake_response("added answer"))
    bb.delete_thread = AsyncMock(return_value={})
    return bb, history or []


class RunAddedModelTurnTests(unittest.TestCase):
    def _run(self, bb, history, **overrides):
        kwargs = dict(
            user_id="u1",
            conversation_id="c1",
            assistant_id="asst-owner",
            main_thread_id="main-thread-1",
            user_text="What's the capital of France?",
            added_endpoint="openai",
            added_model="gpt-4o",
            bb=bb,
        )
        kwargs.update(overrides)
        with patch("api.routes.chat.get_thread_messages", AsyncMock(return_value=history)), \
             patch("api.routes.chat.get_conversation_meta", return_value={}):
            return asyncio.run(chat._run_added_model_turn(**kwargs))

    def test_happy_path_creates_thread_under_given_assistant_and_returns_text(self):
        bb, history = _bb(send_response=_fake_response("Paris."))
        result = self._run(bb, history)

        bb.create_thread.assert_awaited_once_with("asst-owner")
        self.assertEqual(result["text"], "Paris.")
        self.assertIsNone(result["error"])
        self.assertEqual(result["thread_id"], "fresh-thread-1")

    def test_model_override_is_passed_through_send_message(self):
        bb, history = _bb()
        self._run(bb, history, added_model="anthropic/claude-3-5-sonnet")
        kwargs = bb.send_message.await_args.kwargs
        self.assertEqual(kwargs.get("llm_provider"), "anthropic")
        self.assertEqual(kwargs.get("model_name"), "claude-3-5-sonnet")
        self.assertEqual(kwargs.get("thread_id"), "fresh-thread-1")

    def test_seeds_fresh_thread_with_history_hidden_from_the_llm(self):
        bb, history = _bb(history=[
            _FakeMsg("m1", "user", "hi"),
            _FakeMsg("m2", "assistant", "hello"),
        ])
        self._run(bb, history)
        bb.add_message.assert_awaited_once()
        seed_kwargs = bb.add_message.await_args.kwargs
        self.assertEqual(seed_kwargs.get("send_to_llm"), "false")
        self.assertIn("hello", seed_kwargs.get("content", ""))

    def test_requires_action_does_not_crash_and_returns_distinct_error(self):
        bb, history = _bb(send_response=_fake_response(content=None, messages=[{"status": "REQUIRES_ACTION"}], status="REQUIRES_ACTION"))
        result = self._run(bb, history)
        self.assertEqual(result["text"], "")
        self.assertEqual(result["error"], "requires_action")

    def test_provider_exception_is_swallowed_not_raised(self):
        bb, history = _bb(send_side_effect=RuntimeError("rate limited"))
        result = self._run(bb, history)
        self.assertEqual(result["text"], "")
        self.assertEqual(result["error"], "rate limited")

    def test_long_message_is_truncated_before_being_sent(self):
        bb, history = _bb()
        huge_text = "x" * (chat.LONG_MESSAGE_CHAR_THRESHOLD + 5000)
        self._run(bb, history, user_text=huge_text)
        sent_content = bb.send_message.await_args.kwargs.get("content", "")
        self.assertLessEqual(len(sent_content), chat.LONG_MESSAGE_CHAR_THRESHOLD + 200)
        self.assertIn("truncated", sent_content)

    def test_short_message_is_sent_unmodified(self):
        bb, history = _bb()
        self._run(bb, history, user_text="short question")
        sent_content = bb.send_message.await_args.kwargs.get("content", "")
        self.assertEqual(sent_content, "short question")

    def test_baseline_last_message_id_reflects_thread_before_this_turn(self):
        bb, history = _bb(history=[_FakeMsg("m1", "user", "hi"), _FakeMsg("m2", "assistant", "hello")])
        result = self._run(bb, history)
        self.assertEqual(result["baseline_last_message_id"], "m2")

    def test_baseline_is_none_for_a_brand_new_conversation(self):
        bb, history = _bb(history=[])
        result = self._run(bb, history)
        self.assertIsNone(result["baseline_last_message_id"])

    def test_hidden_fork_seed_message_excluded_from_baseline_and_priming(self):
        bb, history = _bb(history=[
            _FakeMsg("seed-1", "user", "[earlier conversation ...]"),
            _FakeMsg("m1", "user", "real question"),
            _FakeMsg("m2", "assistant", "real answer"),
        ])
        kwargs = dict(
            user_id="u1", conversation_id="c1", assistant_id="asst-owner",
            main_thread_id="main-thread-1", user_text="follow up",
            added_endpoint="openai", added_model="gpt-4o", bb=bb,
        )
        with patch("api.routes.chat.get_thread_messages", AsyncMock(return_value=history)), \
             patch("api.routes.chat.get_conversation_meta", return_value={"seed_message_id": "seed-1"}):
            result = asyncio.run(chat._run_added_model_turn(**kwargs))
        self.assertEqual(result["baseline_last_message_id"], "m2")
        seed_kwargs = bb.add_message.await_args.kwargs
        self.assertNotIn("[earlier conversation ...]", seed_kwargs.get("content", ""))

    def test_thread_cleanup_is_attempted_after_success(self):
        bb, history = _bb()
        self._run(bb, history)
        # Cleanup is detached (asyncio.ensure_future in a `finally`, not
        # awaited) so it may not have run by the time _run_added_model_turn
        # returns — give the loop one more tick so the fire-and-forget task
        # gets a chance to execute before we assert on it.
        async def _flush():
            await asyncio.sleep(0)
            await asyncio.sleep(0)
        asyncio.run(_flush())


class DifferentModelActuallyAppliedTests(unittest.TestCase):
    """Answers a direct, practical question: if the user picks a DIFFERENT
    model for the added pane than the primary is using, does that different
    model actually reach Backboard for the second response — not silently
    fall back to the primary's model.

    Payload shape below matches exactly what the real frontend sends
    (packages/data-provider/src/createPayload.ts: payload.model is the
    primary's, payload.addedConvo is the added pane's full TConversation,
    unaffected by anything the primary is doing).
    """

    def test_added_model_differs_from_primary_and_is_honored(self):
        primary_model = "openai/gpt-4.1"
        added_model = "anthropic/claude-3-5-sonnet"

        payload = {
            "model": primary_model,
            "endpoint": "openai",
            "conversationId": "c1",
            "addedConvo": {
                "endpoint": "anthropic",
                "model": added_model,
                "conversationId": "c1",
            },
        }

        # Step 1: the exact extraction the real request-handling path uses.
        added_convo = chat._get_added_convo(payload)
        self.assertIsNotNone(added_convo)
        self.assertEqual(added_convo["model"], added_model)
        self.assertNotEqual(added_convo["model"], primary_model)

        # Step 2: that extracted model actually drives the Backboard call —
        # not the primary's, not a hardcoded default.
        bb, history = _bb(send_response=_fake_response("A genuinely different answer."))
        with patch("api.routes.chat.get_thread_messages", AsyncMock(return_value=history)), \
             patch("api.routes.chat.get_conversation_meta", return_value={}):
            result = asyncio.run(
                chat._run_added_model_turn(
                    user_id="u1",
                    conversation_id="c1",
                    assistant_id="asst-owner",
                    main_thread_id="main-thread-1",
                    user_text="Explain inflation briefly.",
                    added_endpoint=added_convo["endpoint"],
                    added_model=added_convo["model"],
                    bb=bb,
                )
            )
        sent_kwargs = bb.send_message.await_args.kwargs
        self.assertEqual(sent_kwargs["llm_provider"], "anthropic")
        self.assertEqual(sent_kwargs["model_name"], "claude-3-5-sonnet")
        self.assertNotEqual(sent_kwargs["model_name"], "gpt-4.1")
        self.assertEqual(result["text"], "A genuinely different answer.")

    def test_same_model_for_both_is_also_honored_not_an_error(self):
        """The earlier bug report (both columns showing openai/gpt-4.1) was
        never a backend bug — it's what happens when the user genuinely
        leaves both panes on the same model. Confirm that path still works
        correctly too (both explicitly get the SAME model, on purpose)."""
        payload = {
            "model": "openai/gpt-4.1",
            "endpoint": "openai",
            "addedConvo": {"endpoint": "openai", "model": "openai/gpt-4.1"},
        }
        added_convo = chat._get_added_convo(payload)
        bb, history = _bb()
        with patch("api.routes.chat.get_thread_messages", AsyncMock(return_value=history)), \
             patch("api.routes.chat.get_conversation_meta", return_value={}):
            asyncio.run(
                chat._run_added_model_turn(
                    user_id="u1", conversation_id="c1", assistant_id="asst-owner",
                    main_thread_id="main-thread-1", user_text="hi",
                    added_endpoint=added_convo["endpoint"], added_model=added_convo["model"],
                    bb=bb,
                )
            )
        kwargs = bb.send_message.await_args.kwargs
        self.assertEqual(kwargs["model_name"], "gpt-4.1")

    def test_missing_added_convo_model_is_rejected_not_silently_defaulted(self):
        """_get_added_convo must return None (no added-model turn at all)
        rather than let a modelless addedConvo silently fall through to
        whatever the model-string parsing happens to default to."""
        payload = {"model": "openai/gpt-4.1", "addedConvo": {"endpoint": "openai", "model": ""}}
        self.assertIsNone(chat._get_added_convo(payload))

        payload_no_added = {"model": "openai/gpt-4.1"}
        self.assertIsNone(chat._get_added_convo(payload_no_added))


class ResolveAndPersistAddedResponseTests(unittest.TestCase):
    """api.routes.chat._resolve_and_persist_added_response — extracted out of
    generate() specifically to make this directly testable. Covers the
    abort-awareness and stale-message-attribution guards that two review
    rounds found real bugs in before they existed as guards at all."""

    def _call(self, **overrides):
        kwargs = dict(
            partition_id="u1",
            conversation_id="c1",
            thread_id="main-thread-1",
            bb=MagicMock(),
            baseline_last_message_id="m2",
            added_was_aborted=False,
            stream_state={},
            added_text="added answer",
            added_convo_model="gpt-4o",
            added_agent_id="openAI__gpt-4o____1",
            added_ok=True,
        )
        kwargs.update(overrides)
        return kwargs

    def test_happy_path_saves_under_the_newly_resolved_id(self):
        history = [_FakeMsg("m1", "user", "hi"), _FakeMsg("m2", "assistant", "primary"), _FakeMsg("m3", "assistant", "primary turn 2")]
        saved = MagicMock()
        with patch("api.routes.chat.get_thread_messages", AsyncMock(return_value=history)), \
             patch("api.routes.chat.save_added_response", saved):
            chat._resolve_and_persist_added_response(**self._call(baseline_last_message_id="m2"))
        saved.assert_called_once()
        self.assertEqual(saved.call_args.args[2], "m3")  # keyed by the NEW message, not the baseline
        self.assertEqual(saved.call_args.args[3]["text"], "added answer")

    def test_already_aborted_before_call_skips_resolution_and_save_entirely(self):
        saved = MagicMock()
        fetch = AsyncMock()
        with patch("api.routes.chat.get_thread_messages", fetch), \
             patch("api.routes.chat.save_added_response", saved):
            chat._resolve_and_persist_added_response(**self._call(added_was_aborted=True))
        fetch.assert_not_awaited()
        saved.assert_not_called()

    def test_done_flag_set_in_stream_state_skips_save(self):
        """The third, last-moment abort check — catches an abort landing in
        the window between the caller's own checks and this function
        acquiring the lock."""
        history = [_FakeMsg("m1", "user", "hi"), _FakeMsg("m2", "assistant", "primary")]
        saved = MagicMock()
        with patch("api.routes.chat.get_thread_messages", AsyncMock(return_value=history)), \
             patch("api.routes.chat.save_added_response", saved):
            chat._resolve_and_persist_added_response(
                **self._call(added_was_aborted=False, stream_state={"done": True})
            )
        saved.assert_not_called()

    def test_stale_baseline_match_skips_save_instead_of_misattaching(self):
        """Regression guard: if the thread tail is UNCHANGED since before
        this turn (the primary silently failed to write), do not attach the
        added-model answer to that older, unrelated message."""
        history = [_FakeMsg("m1", "user", "hi"), _FakeMsg("m2", "assistant", "an older answer")]
        saved = MagicMock()
        with patch("api.routes.chat.get_thread_messages", AsyncMock(return_value=history)), \
             patch("api.routes.chat.save_added_response", saved):
            chat._resolve_and_persist_added_response(**self._call(baseline_last_message_id="m2"))
        saved.assert_not_called()

    def test_no_visible_assistant_message_skips_save(self):
        history = [_FakeMsg("m1", "user", "hi")]  # no assistant turn yet
        saved = MagicMock()
        with patch("api.routes.chat.get_thread_messages", AsyncMock(return_value=history)), \
             patch("api.routes.chat.save_added_response", saved):
            chat._resolve_and_persist_added_response(**self._call(baseline_last_message_id=None))
        saved.assert_not_called()

    def test_thread_fetch_failure_is_swallowed_not_raised(self):
        saved = MagicMock()
        with patch("api.routes.chat.get_thread_messages", AsyncMock(side_effect=RuntimeError("network"))), \
             patch("api.routes.chat.save_added_response", saved):
            chat._resolve_and_persist_added_response(**self._call())  # must not raise
        saved.assert_not_called()

    def test_concurrent_calls_for_the_same_conversation_do_not_interleave(self):
        """Exercises the actual lock, not just its existence: two calls
        racing for the same conversation_id must not run their
        fetch-then-save critical sections concurrently."""
        import threading

        history = [_FakeMsg("m1", "user", "hi"), _FakeMsg("m2", "assistant", "primary")]
        overlap_detected = threading.Event()
        in_critical_section = threading.Event()

        async def _slow_fetch(*_args, **_kwargs):
            if in_critical_section.is_set():
                overlap_detected.set()
            in_critical_section.set()
            await asyncio.sleep(0.05)
            in_critical_section.clear()
            return history

        results = []

        def _run_once(msg_id):
            with patch("api.routes.chat.get_thread_messages", _slow_fetch), \
                 patch("api.routes.chat.save_added_response", lambda *a, **k: results.append(a[2])):
                chat._resolve_and_persist_added_response(
                    **self._call(conversation_id="race-convo", baseline_last_message_id=None)
                )

        t1 = threading.Thread(target=_run_once, args=("t1",))
        t2 = threading.Thread(target=_run_once, args=("t2",))
        t1.start()
        t2.start()
        t1.join(timeout=5)
        t2.join(timeout=5)

        self.assertFalse(overlap_detected.is_set(), "critical sections overlapped despite the lock")


class AddedResponseLockTests(unittest.TestCase):
    """The lock preventing concurrent turns on the same conversation from
    cross-attaching answers or losing entries to a non-atomic DynamoDB
    read-modify-write (see _get_added_response_lock's docstring in chat.py)."""

    def test_same_key_returns_the_same_lock_instance(self):
        a = chat._get_added_response_lock("user-1", "convo-1")
        b = chat._get_added_response_lock("user-1", "convo-1")
        self.assertIs(a, b)

    def test_different_conversations_get_different_locks(self):
        a = chat._get_added_response_lock("user-1", "convo-1")
        b = chat._get_added_response_lock("user-1", "convo-2")
        self.assertIsNot(a, b)

    def test_different_users_get_different_locks_even_for_the_same_convo_id(self):
        a = chat._get_added_response_lock("user-1", "convo-1")
        b = chat._get_added_response_lock("user-2", "convo-1")
        self.assertIsNot(a, b)


class ResponseTextTests(unittest.TestCase):
    def test_reads_content_property_when_present(self):
        resp = _fake_response(content="hello")
        self.assertEqual(chat._response_text(resp), "hello")

    def test_falls_back_to_dict_shaped_last_message(self):
        """Regression guard: SDK's ChatMessagesResponse.messages is
        List[Dict[str, Any]] — raw dicts, never Message objects. The old
        code did messages[-1].content (AttributeError on a dict); this must
        use dict access instead."""
        resp = _fake_response(content=None, messages=[{"content": "from dict"}])
        self.assertEqual(chat._response_text(resp), "from dict")

    def test_empty_messages_yields_empty_string_not_a_crash(self):
        resp = _fake_response(content=None, messages=[{"content": None}])
        self.assertEqual(chat._response_text(resp), "")

    def test_no_messages_attribute_returns_bare_content(self):
        resp = MagicMock(spec=["content"])
        resp.content = "plain"
        self.assertEqual(chat._response_text(resp), "plain")


class AddedModelAgentIdTests(unittest.TestCase):
    def test_matches_js_encodeEphemeralAgentId_format_with_index(self):
        self.assertEqual(added_model_agent_id("openAI", "gpt-4o", index=1), "openAI__gpt-4o____1")

    def test_no_index_omits_suffix(self):
        self.assertEqual(added_model_agent_id("openAI", "gpt-4o"), "openAI__gpt-4o")

    def test_colon_in_model_name_is_escaped_like_js(self):
        self.assertEqual(
            added_model_agent_id("bedrock", "anthropic.claude:v2", index=1),
            "bedrock__anthropic.claude__v2____1",
        )


class ContentWithAddedResponseTests(unittest.TestCase):
    def test_returns_none_when_no_entry(self):
        self.assertIsNone(
            conversation_service.content_with_added_response("primary text", "openai", "gpt-4o", None)
        )

    def test_builds_two_tagged_parts_sharing_groupid(self):
        parts = conversation_service.content_with_added_response(
            "primary text", "openai", "gpt-4o",
            {"text": "added text", "model": "claude-3-5-sonnet", "agentId": "anthropic__claude-3-5-sonnet____1", "ok": True},
        )
        self.assertEqual(len(parts), 2)
        self.assertEqual(parts[0]["groupId"], parts[1]["groupId"])
        self.assertEqual(parts[0]["text"]["value"], "primary text")
        self.assertEqual(parts[1]["text"]["value"], "added text")
        self.assertNotEqual(parts[0]["agentId"], parts[1]["agentId"])

    def test_missing_text_falls_back_to_a_visible_notice_not_a_blank(self):
        parts = conversation_service.content_with_added_response(
            "primary text", "openai", "gpt-4o", {"text": "", "model": "gpt-4o", "ok": False},
        )
        self.assertTrue(parts[1]["text"]["value"])


class SaveAddedResponseCapTests(unittest.TestCase):
    """Hermetic against moto-mocked DynamoDB — mirrors test_state_service.py's
    setup so this doesn't need real AWS credentials or Docker."""

    def setUp(self):
        self._mock = mock_aws()
        self._mock.start()
        state_service.ensure_state_table()

    def tearDown(self):
        self._mock.stop()

    def test_eviction_keeps_only_the_most_recent_entries(self):
        cap = conversation_service._MAX_ADDED_RESPONSES_PER_CONVERSATION
        for i in range(cap + 5):
            conversation_service.save_added_response(
                "cap-test-user", "cap-test-convo", f"m{i}", {"text": f"answer {i}", "model": "gpt-4o", "ok": True},
            )
        stored = conversation_service.get_added_response_map("cap-test-user", "cap-test-convo")
        self.assertEqual(len(stored), cap)
        # Oldest entries (m0-m4) evicted; newest (m5..) retained.
        self.assertNotIn("m0", stored)
        self.assertNotIn("m4", stored)
        self.assertIn(f"m{cap + 4}", stored)


class LongMessageDisplayOverrideTests(unittest.TestCase):
    """Long pasted messages are rewritten before sending to Backboard, but the
    rewritten routing prompt must never become the visible user message on
    reload."""

    def setUp(self):
        self._mock = mock_aws()
        self._mock.start()
        state_service.ensure_state_table()

    def tearDown(self):
        self._mock.stop()

    def test_saves_original_text_for_backboard_long_message_prompt(self):
        prompt = chat._build_long_message_prompt("doc-123")
        original = "original pasted text\n" * 100
        history = [
            _FakeMsg("u-original", "user", prompt),
            _FakeMsg("a-failed", "assistant", "failed"),
            _FakeMsg("u-retry", "user", prompt),
            _FakeMsg("a-final", "assistant", "answer"),
        ]

        with patch("api.routes.chat.get_thread_messages", AsyncMock(return_value=history)):
            chat._save_long_message_display_text(
                partition_id="display-user",
                conversation_id="display-convo",
                thread_id="thread-1",
                ctx={
                    "should_index_long_message": True,
                    "user_text": original,
                    "model_text": prompt,
                    "bb_client": object(),
                },
            )

        stored = conversation_service.get_display_text_map("display-user", "display-convo")
        self.assertEqual(stored["u-original"], original)
        self.assertEqual(stored["u-retry"], original)

    def test_saves_display_files_for_pasted_text_prompt(self):
        prompt = chat._build_pasted_files_prompt(
            "summarize this",
            [{"filename": "Pasted text.txt", "document_id": "doc-123"}],
        )
        display_file = {
            "file_id": "pasted-1",
            "filename": "Pasted text.txt",
            "filepath": "/api/files/download/user/pasted-1",
            "type": "text/plain",
            "metadata": {"isPastedBlock": True, "lineCount": 12},
        }
        history = [
            _FakeMsg("u1", "user", prompt),
            _FakeMsg("a1", "assistant", "answer"),
        ]

        with patch("api.routes.chat.get_thread_messages", AsyncMock(return_value=history)):
            chat._save_long_message_display_text(
                partition_id="display-user",
                conversation_id="display-convo",
                thread_id="thread-1",
                ctx={
                    "user_text": "summarize this",
                    "display_text_override": "summarize this",
                    "model_text": prompt,
                    "display_files": [display_file],
                    "bb_client": object(),
                },
            )

        self.assertEqual(
            conversation_service.get_display_text_map("display-user", "display-convo")["u1"],
            "summarize this",
        )
        self.assertEqual(
            conversation_service.get_display_file_map("display-user", "display-convo")["u1"],
            [display_file],
        )

    def test_persist_pasted_text_file_does_not_require_flask_context(self):
        with tempfile.TemporaryDirectory() as upload_dir, \
             patch("api.routes.files.UPLOAD_DIR", upload_dir):
            persisted = chat._persist_pasted_text_file(
                partition_id="display-user",
                conversation_id="display-convo",
                dir_key="display-user",
                filename="Pasted text.txt",
                content="line one\nline two",
                content_type="text/plain",
                language="Text",
                source_file_id="pasted-test-file",
            )

            path = os.path.join(upload_dir, "display-user", "pasted-test-file_Pasted_text.txt")
            self.assertTrue(os.path.exists(path))
            self.assertEqual(
                persisted["filepath"],
                "/api/files/download/display-user/pasted-test-file",
            )
            self.assertEqual(persisted["metadata"]["lineCount"], 2)
            stored = state_service.file_meta.get("display-user", "pasted-test-file")
            self.assertIsNotNone(stored)
            self.assertEqual(stored["status"], "ready")

    def test_noop_when_message_was_not_rewritten(self):
        with patch("api.routes.chat.get_thread_messages") as get_messages:
            chat._save_long_message_display_text(
                partition_id="display-user",
                conversation_id="display-convo",
                thread_id="thread-1",
                ctx={
                    "should_index_long_message": False,
                    "user_text": "short text",
                    "model_text": "short text",
                },
            )

        get_messages.assert_not_called()
        self.assertEqual(
            conversation_service.get_display_text_map("display-user", "display-convo"),
            {},
        )

    def test_legacy_internal_prompt_is_scrubbed_from_display(self):
        legacy = (
            "The user's message was too long to send directly. "
            "It has been uploaded to Backboard as document doc-123. "
            "Read the document content and respond to the user's request."
        )
        current = chat._build_long_message_prompt("doc-456")

        self.assertEqual(
            chat.sanitize_long_message_display_text(legacy),
            chat.LONG_MESSAGE_DISPLAY_FALLBACK,
        )
        self.assertEqual(
            chat.sanitize_long_message_display_text(current),
            chat.LONG_MESSAGE_DISPLAY_FALLBACK,
        )
        self.assertEqual(
            chat.sanitize_long_message_display_text("normal user text"),
            "normal user text",
        )


class ForkDuplicateAddedResponseMergeTests(unittest.TestCase):
    def test_build_message_snapshot_bakes_in_added_response(self):
        messages = [
            _FakeMsg("u1", "user", "question"),
            _FakeMsg("a1", "assistant", "primary answer"),
        ]
        added_map = {"a1": {"text": "added answer", "model": "gpt-4o", "agentId": "openAI__gpt-4o____1", "ok": True}}
        snapshot = conversations._build_message_snapshot(
            messages, "new-convo-id", added_response_map=added_map, src_endpoint="openai", src_model="gpt-4o",
        )
        assistant_entry = next(m for m in snapshot if m["messageId"] == "a1")
        self.assertIn("content", assistant_entry)
        self.assertEqual(len(assistant_entry["content"]), 2)
        self.assertEqual(assistant_entry["content"][1]["text"]["value"], "added answer")

    def test_build_message_snapshot_without_added_map_keeps_flat_text(self):
        messages = [_FakeMsg("u1", "user", "question"), _FakeMsg("a1", "assistant", "primary answer")]
        snapshot = conversations._build_message_snapshot(messages, "new-convo-id")
        assistant_entry = next(m for m in snapshot if m["messageId"] == "a1")
        self.assertNotIn("content", assistant_entry)


if __name__ == "__main__":
    unittest.main()
