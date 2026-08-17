"""Chat-time model resolution against Backboard's live LLM catalog.

Picker ids that Backboard cannot run (stale librechat.yaml entries,
Bedrock-style "anthropic.claude-…-v1:0" names, ids without a provider) must be
re-anchored to a real catalog model instead of erroring the turn and silently
falling back to GPT-4.1."""

import unittest
from unittest import mock

from api.routes import chat


CATALOG = {
    "anthropic/claude-opus-4-7": {"supports_tools": True},
    "anthropic/claude-opus-4-1-20250805": {"supports_tools": True},
    "anthropic/claude-sonnet-4-5-20250929": {"supports_tools": True},
    "openai/gpt-4.1": {"supports_tools": True},
    "aws-bedrock/meta.llama3-3-70b-instruct-v1:0": {"supports_tools": False},
}


def resolve(model, catalog=CATALOG):
    with mock.patch.object(chat, "_fetch_llm_models", return_value=catalog):
        return chat._resolve_chat_model_spec(model, api_key="k")


class ResolveChatModelSpecTests(unittest.TestCase):
    def test_valid_catalog_id_passes_through(self):
        self.assertEqual(resolve("openai/gpt-4.1"), "openai/gpt-4.1")

    def test_valid_bedrock_catalog_id_passes_through(self):
        self.assertEqual(
            resolve("aws-bedrock/meta.llama3-3-70b-instruct-v1:0"),
            "aws-bedrock/meta.llama3-3-70b-instruct-v1:0",
        )

    def test_stale_bedrock_id_resolves_to_native_vendor(self):
        # The exact failing id from the bug report: hand-added yaml entry that
        # does not exist upstream under aws-bedrock.
        self.assertEqual(
            resolve("aws-bedrock/anthropic.claude-opus-4-7"),
            "anthropic/claude-opus-4-7",
        )

    def test_versioned_bedrock_id_resolves_to_bare_catalog_name(self):
        self.assertEqual(
            resolve("aws-bedrock/anthropic.claude-opus-4-1-20250805-v1:0"),
            "anthropic/claude-opus-4-1-20250805",
        )

    def test_provider_less_dotted_id_resolves(self):
        self.assertEqual(
            resolve("anthropic.claude-opus-4-7"), "anthropic/claude-opus-4-7"
        )

    def test_undated_id_resolves_to_newest_dated_variant(self):
        self.assertEqual(
            resolve("anthropic/claude-sonnet-4-5"),
            "anthropic/claude-sonnet-4-5-20250929",
        )

    def test_unknown_model_returned_unchanged(self):
        self.assertEqual(resolve("foo/bar-model"), "foo/bar-model")

    def test_empty_catalog_returns_original(self):
        self.assertEqual(
            resolve("aws-bedrock/anthropic.claude-opus-4-7", catalog={}),
            "aws-bedrock/anthropic.claude-opus-4-7",
        )

    def test_empty_model_returned_unchanged(self):
        self.assertEqual(resolve(""), "")
        self.assertIsNone(resolve(None))

    def test_version_number_not_mistaken_for_date_suffix(self):
        # "grok-4" must NOT resolve to "grok-4.20-multi-agent-0309" (a
        # different model whose normalized name merely starts with "grok-4-2"),
        # and the xAI-style MMDD date variant IS a valid dated match.
        catalog = {
            "xai/grok-4.20-multi-agent-0309": {"supports_tools": True},
            "xai/grok-4-0709": {"supports_tools": True},
        }
        self.assertEqual(resolve("xai/grok-4", catalog), "xai/grok-4-0709")

    def test_dotted_id_resolves_via_bedrock_only_catalog(self):
        # A key whose ONLY Anthropic access is via aws-bedrock: the catalog
        # name carries the vendor prefix and a version tag, and must still
        # match after symmetric normalization.
        catalog = {
            "aws-bedrock/anthropic.claude-sonnet-4-5-20250929-v2:0": {
                "supports_tools": True
            },
        }
        self.assertEqual(
            resolve("anthropic/claude-sonnet-4-5", catalog),
            "aws-bedrock/anthropic.claude-sonnet-4-5-20250929-v2:0",
        )


class ImageTurnOrchestratorTests(unittest.TestCase):
    """Image turns need a tool-calling thread LLM (Backboard's generate_image
    is a tool). A catalog-confirmed tools-incapable model is swapped for the
    turn; capable or unknown models are not."""

    def _orchestrate(self, model, fallback="openai/gpt-4.1", catalog=None):
        with mock.patch.object(
            chat, "_fetch_llm_models", return_value=catalog or {}
        ):
            return chat._image_turn_orchestrator(model, fallback, api_key="k")

    def test_tools_incapable_model_is_swapped(self):
        catalog = {
            "aws-bedrock/anthropic.claude-opus-4-7": {"supports_tools": False},
        }
        self.assertEqual(
            self._orchestrate("aws-bedrock/anthropic.claude-opus-4-7", catalog=catalog),
            "openai/gpt-4.1",
        )

    def test_tools_capable_model_is_kept(self):
        catalog = {"anthropic/claude-opus-4-7": {"supports_tools": True}}
        self.assertIsNone(
            self._orchestrate("anthropic/claude-opus-4-7", catalog=catalog)
        )

    def test_unknown_capability_is_kept(self):
        # Not in catalog, or supports_tools=None → Backboard is the authority.
        self.assertIsNone(self._orchestrate("anthropic/claude-opus-4-7"))
        catalog = {"anthropic/claude-opus-4-7": {"supports_tools": None}}
        self.assertIsNone(
            self._orchestrate("anthropic/claude-opus-4-7", catalog=catalog)
        )

    def test_fallback_opt_out_is_respected(self):
        catalog = {
            "aws-bedrock/anthropic.claude-opus-4-7": {"supports_tools": False},
        }
        self.assertIsNone(
            self._orchestrate(
                "aws-bedrock/anthropic.claude-opus-4-7", fallback=None, catalog=catalog
            )
        )


class FriendlyModelNameTests(unittest.TestCase):
    def test_bedrock_name_drops_vendor_prefix_and_version(self):
        self.assertEqual(
            chat._friendly_model_name("aws-bedrock/anthropic.claude-opus-4-7"),
            "Claude Opus 4 7",
        )
        self.assertEqual(
            chat._friendly_model_name(
                "aws-bedrock/anthropic.claude-opus-4-1-20250805-v1:0"
            ),
            "Claude Opus 4 1 20250805",
        )

    def test_known_map_still_wins(self):
        self.assertEqual(
            chat._friendly_model_name("anthropic/claude-opus-4-5"),
            "Claude Opus 4.5",
        )


if __name__ == "__main__":
    unittest.main()
