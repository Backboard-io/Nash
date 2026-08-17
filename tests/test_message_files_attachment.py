"""#3 — message files must attach to the user message THIS request created,
not the thread's current last user message (which a concurrent reload/turn can
advance, landing the attachment on the wrong turn)."""

import unittest

from api.routes.chat import _pick_message_files_user_id


class _Msg:
    def __init__(self, message_id, role, metadata=None):
        self.message_id = message_id
        self.role = role
        self.metadata = metadata or {}


def _thread(*pairs):
    # pairs are (id, role[, metadata]) in chronological (oldest -> newest) order.
    return [_Msg(*p) for p in pairs]


class PickMessageFilesUserIdTests(unittest.TestCase):
    def test_picks_the_user_message_this_request_created(self):
        """The reviewer's race: our request (U_A) is still generating when a
        reload starts a second request (U_B). At save time the thread's last
        user message is U_B — but our files belong to U_A."""
        pre = {"U_prev"}  # only the prior turn existed when we opened our stream
        bb_msgs = _thread(
            ("U_prev", "user"),
            ("A_prev", "assistant"),
            ("U_A", "user"),  # created by THIS request
            ("U_B", "user"),  # created by a concurrent reload/turn
        )
        picked = _pick_message_files_user_id(bb_msgs, {}, pre)
        self.assertEqual(picked, "U_A")

    def test_naive_last_user_would_be_wrong(self):
        """Guards the regression: the old 'last user message' logic returns U_B."""
        bb_msgs = _thread(("U_A", "user"), ("U_B", "user"))
        last_user = str(
            next(m for m in reversed(bb_msgs) if m.role == "user").message_id
        )
        self.assertEqual(last_user, "U_B")  # what the buggy code did
        picked = _pick_message_files_user_id(bb_msgs, {}, {"U_prev"})
        self.assertNotEqual(picked, last_user)
        self.assertEqual(picked, "U_A")

    def test_single_turn_no_snapshot_falls_back_to_last_user(self):
        bb_msgs = _thread(("U_1", "user"), ("A_1", "assistant"))
        self.assertEqual(_pick_message_files_user_id(bb_msgs, {}, None), "U_1")

    def test_skipped_user_messages_are_ignored(self):
        bb_msgs = _thread(("U_A", "user"), ("U_regen", "user"))
        regen_graph = {"U_regen": "SKIP"}
        # U_regen is skipped, so U_A is the only real candidate.
        self.assertEqual(
            _pick_message_files_user_id(bb_msgs, regen_graph, {"U_prev"}), "U_A"
        )

    def test_no_user_messages_returns_none(self):
        bb_msgs = _thread(("A_1", "assistant"))
        self.assertIsNone(_pick_message_files_user_id(bb_msgs, {}, None))


class PickMessageFilesByMetadataTokenTests(unittest.TestCase):
    """Deterministic binding via the correlation token Nash stamps into the
    Backboard message metadata on send — the primary mechanism, immune to the
    snapshot race."""

    def test_token_match_is_authoritative_over_snapshot(self):
        # Even if the snapshot would pick a DIFFERENT "new" message, the token
        # match wins — it names our exact message with no timing assumption.
        bb_msgs = _thread(
            ("U_prev", "user"),
            ("U_A", "user", {"nash_msg_token": "tok-123"}),  # THIS request
            ("U_B", "user"),  # a concurrent turn, also "new" vs the snapshot
        )
        picked = _pick_message_files_user_id(
            bb_msgs, {}, {"U_prev"}, corr_token="tok-123"
        )
        self.assertEqual(picked, "U_A")

    def test_token_match_works_without_any_snapshot(self):
        bb_msgs = _thread(
            ("U_A", "user", {"nash_msg_token": "tok-xyz"}),
            ("U_B", "user"),
        )
        picked = _pick_message_files_user_id(
            bb_msgs, {}, None, corr_token="tok-xyz"
        )
        self.assertEqual(picked, "U_A")

    def test_no_metadata_returned_falls_back_to_snapshot(self):
        # Backboard didn't round-trip metadata: no candidate carries the token,
        # so we fall back to the new-relative-to-snapshot pick — never worse
        # than before this change.
        bb_msgs = _thread(
            ("U_prev", "user"),
            ("U_A", "user"),  # new vs snapshot, but no metadata
            ("U_B", "user"),
        )
        picked = _pick_message_files_user_id(
            bb_msgs, {}, {"U_prev"}, corr_token="tok-missing"
        )
        self.assertEqual(picked, "U_A")

    def test_require_new_refuses_last_user_fallback(self):
        # Early-persistence path: before Backboard creates THIS turn's user
        # message, the thread still ends with a PRIOR turn's user message. With
        # require_new we must return None (keep waiting), never that stale id.
        bb_msgs = _thread(("U_prev", "user"))
        self.assertIsNone(
            _pick_message_files_user_id(
                bb_msgs, {}, {"U_prev"}, corr_token="tok", require_new=True
            )
        )

    def test_require_new_accepts_a_genuinely_new_message(self):
        bb_msgs = _thread(("U_prev", "user"), ("U_new", "user"))
        self.assertEqual(
            _pick_message_files_user_id(
                bb_msgs, {}, {"U_prev"}, corr_token="tok", require_new=True
            ),
            "U_new",
        )

    def test_token_never_selects_a_skipped_message(self):
        # A SKIP'd user message is not a candidate even if it carries the token.
        bb_msgs = _thread(
            ("U_regen", "user", {"nash_msg_token": "tok-1"}),
            ("U_A", "user"),
        )
        picked = _pick_message_files_user_id(
            bb_msgs, {"U_regen": "SKIP"}, {"U_prev"}, corr_token="tok-1"
        )
        self.assertEqual(picked, "U_A")


if __name__ == "__main__":
    unittest.main()
