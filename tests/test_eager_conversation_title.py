"""A brand-new chat must appear in the sidebar immediately with a real,
prompt-derived name — not only after the stream completes. _eager_conversation_title
computes that early name; it mirrors the 60-char convention used for the
response-based title so early and final names stay consistent, and falls back to
the 'New Chat' placeholder (which completion later replaces) when the turn has no
text."""

import unittest

from api.routes.chat import _eager_conversation_title
from api.services.conversation_service import PLACEHOLDER_TITLES


class EagerConversationTitleTests(unittest.TestCase):
    def test_uses_the_user_prompt(self):
        self.assertEqual(
            _eager_conversation_title("describe what this image is"),
            "describe what this image is",
        )

    def test_truncates_long_prompts_to_60_chars_with_ellipsis(self):
        long = "x" * 200
        title = _eager_conversation_title(long)
        self.assertEqual(title, "x" * 60 + "...")

    def test_collapses_newlines(self):
        self.assertEqual(_eager_conversation_title("line1\nline2"), "line1 line2")

    def test_blank_prompt_falls_back_to_a_placeholder_title(self):
        # A bare image upload with no text: the fallback MUST be a placeholder so
        # the completion step is still free to overwrite it with a response-based
        # title.
        for blank in ("", "   ", "\n\n"):
            title = _eager_conversation_title(blank)
            self.assertEqual(title, "New Chat")
            self.assertIn(title, PLACEHOLDER_TITLES)

    def test_real_prompt_title_is_not_a_placeholder(self):
        # A real name must NOT be a placeholder, so completion leaves it intact
        # (should_set_title stays False) — the name is stable from the first frame.
        title = _eager_conversation_title("help me plan a trip")
        self.assertNotIn(title, PLACEHOLDER_TITLES)


if __name__ == "__main__":
    unittest.main()
