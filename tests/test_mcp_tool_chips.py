"""Tool-call chips: reconstruct the tool trail so the user can see it.

Nash executes MCP tools itself, but Backboard persists the whole round-trip in
the thread. These tests lock that reconstruction in, and pin the two shape rules
the frontend silently depends on:

- a tool_call part must NOT carry a `type` key (Part.tsx only treats it as a
  plain tool call when `type` is absent; Backboard's own type='function' routes
  it to the legacy Assistants renderer instead)
- chips and the multi-model parallel view can't coexist (any part with a
  groupId flips the WHOLE message to ParallelContentRenderer)

The raw payloads below are copied from a real Backboard thread.
"""

from __future__ import annotations

import unittest

from api.routes.chat import _tool_chip_parts
from api.routes.messages import _assistant_content
from api.services.backboard_service import (
    DOCUMENT_EXPORT_TOOL_NAME,
    TOOL_OUTPUT_DISPLAY_LIMIT,
    build_tool_call_parts,
    is_chip_tool,
    is_user_visible_message,
    normalize_raw_messages,
    truncate_tool_output,
)
from api.services.mcp_service import make_openai_tool_name

TOOL_NAME = "aws___search_documentation_mcp_aws-knowledge"
CALL_ID = "call_CG8rp32O74I0gxgdDRoDA2p1"
ARGS = '{"search_phrase": "S3 Express One Zone"}'
OUTPUT = '{"result": [{"title": "Tutorial: Getting started with S3 Express One Zone"}]}'

# What GET /threads/{id} actually returns for a Nash turn. Copied from a real
# thread: Nash submits tool outputs with stream=true, so the visible answer (m4)
# carries ONLY a run_id — the calls live on the hidden stub (m2). An earlier
# version of this suite keyed off `all_run_tool_calls` (which Backboard sets on
# the NON-streaming path) and passed while the feature was broken end-to-end.
RAW_THREAD = [
    {"role": "user", "content": "What is S3 Express One Zone?", "message_id": "m1"},
    {
        "role": "assistant",
        "content": None,  # the stub — never shown
        "message_id": "m2",
        "metadata_": {
            "run_id": "run-1",
            "tool_calls": [
                {"id": CALL_ID, "type": "function",
                 "function": {"name": TOOL_NAME, "arguments": ARGS}},
            ],
        },
    },
    {
        "role": "tool",
        "content": OUTPUT,
        "message_id": "m3",
        "metadata_": {"tool_name": TOOL_NAME, "tool_call_id": CALL_ID, "run_id": "run-1"},
    },
    {
        "role": "assistant",
        "content": "S3 Express One Zone is a high-performance storage class.",
        "message_id": "m4",
        "metadata_": {"run_id": "run-1"},
    },
]


class BuildToolCallPartsTests(unittest.TestCase):
    def test_chips_land_on_the_answer_not_the_stub(self):
        msgs = normalize_raw_messages(RAW_THREAD)
        parts = build_tool_call_parts(msgs)
        # The stub (m2) is filtered from the UI entirely — a chip there is invisible.
        self.assertNotIn("m2", parts)
        self.assertIn("m4", parts)
        self.assertEqual(len(parts["m4"]), 1)

    def test_chip_carries_name_args_and_the_real_output(self):
        parts = build_tool_call_parts(normalize_raw_messages(RAW_THREAD))
        call = parts["m4"][0]["tool_call"]
        self.assertEqual(call["name"], TOOL_NAME)
        self.assertEqual(call["args"], ARGS)
        # Output is joined from the role='tool' message via tool_call_id.
        self.assertEqual(call["output"], OUTPUT)
        self.assertEqual(call["progress"], 1)

    def test_part_omits_type_key(self):
        # Part.tsx: isToolCall = 'args' in toolCall && (!toolCall.type || ...).
        # Backboard's type='function' would route this to the legacy renderer.
        part = build_tool_call_parts(normalize_raw_messages(RAW_THREAD))["m4"][0]
        self.assertEqual(part["type"], "tool_call")
        self.assertNotIn("type", part["tool_call"])

    def test_stub_and_tool_messages_stay_hidden(self):
        msgs = {m.message_id: m for m in normalize_raw_messages(RAW_THREAD)}
        self.assertFalse(is_user_visible_message(msgs["m2"]))  # empty assistant stub
        self.assertFalse(is_user_visible_message(msgs["m3"]))  # role='tool'
        self.assertTrue(is_user_visible_message(msgs["m4"]))

    def test_multi_round_run_collects_every_call_in_order(self):
        # Two tool rounds inside ONE run: two stubs, two outputs, one answer.
        def stub(mid, call_id, phrase):
            return {
                "role": "assistant", "content": "", "message_id": mid,
                "metadata_": {"run_id": "run-1", "tool_calls": [
                    {"id": call_id, "type": "function",
                     "function": {"name": TOOL_NAME, "arguments": f'{{"q": "{phrase}"}}'}},
                ]},
            }

        def result(mid, call_id, out):
            return {"role": "tool", "content": out, "message_id": mid,
                    "metadata_": {"run_id": "run-1", "tool_call_id": call_id}}

        raw = [
            {"role": "user", "content": "search then read", "message_id": "m1"},
            stub("m2", "call_a", "search"),
            result("m3", "call_a", "SEARCH_OUT"),
            stub("m4", "call_b", "read"),
            result("m5", "call_b", "READ_OUT"),
            {"role": "assistant", "content": "Here is the answer.", "message_id": "m6",
             "metadata_": {"run_id": "run-1"}},
        ]
        parts = build_tool_call_parts(normalize_raw_messages(raw))
        self.assertEqual(list(parts), ["m6"])
        calls = [p["tool_call"] for p in parts["m6"]]
        self.assertEqual([c["output"] for c in calls], ["SEARCH_OUT", "READ_OUT"])

    def test_non_streaming_shape_still_works(self):
        # Backboard's non-streaming submit puts all_run_tool_calls on the answer.
        raw = [
            {"role": "tool", "content": OUTPUT, "message_id": "t1",
             "metadata_": {"run_id": "r9", "tool_call_id": CALL_ID}},
            {"role": "assistant", "content": "answer", "message_id": "a1",
             "metadata_": {"run_id": "r9", "all_run_tool_calls": [
                 {"id": CALL_ID, "type": "function",
                  "function": {"name": TOOL_NAME, "arguments": ARGS}},
             ]}},
        ]
        parts = build_tool_call_parts(normalize_raw_messages(raw))
        self.assertEqual(parts["a1"][0]["tool_call"]["output"], OUTPUT)

    def test_same_call_on_stub_and_answer_is_not_duplicated(self):
        call = {"id": CALL_ID, "type": "function",
                "function": {"name": TOOL_NAME, "arguments": ARGS}}
        raw = [
            {"role": "assistant", "content": "", "message_id": "s1",
             "metadata_": {"run_id": "r1", "tool_calls": [call]}},
            {"role": "tool", "content": OUTPUT, "message_id": "t1",
             "metadata_": {"run_id": "r1", "tool_call_id": CALL_ID}},
            {"role": "assistant", "content": "answer", "message_id": "a1",
             "metadata_": {"run_id": "r1", "all_run_tool_calls": [call]}},
        ]
        self.assertEqual(len(build_tool_call_parts(normalize_raw_messages(raw))["a1"]), 1)

    def test_run_with_no_visible_answer_yields_nothing(self):
        # Aborted/errored run: tools ran but no answer message to hang chips on.
        raw = [
            {"role": "assistant", "content": "", "message_id": "s1",
             "metadata_": {"run_id": "r1", "tool_calls": [
                 {"id": CALL_ID, "type": "function",
                  "function": {"name": TOOL_NAME, "arguments": ARGS}}]}},
            {"role": "tool", "content": OUTPUT, "message_id": "t1",
             "metadata_": {"run_id": "r1", "tool_call_id": CALL_ID}},
        ]
        self.assertEqual(build_tool_call_parts(normalize_raw_messages(raw)), {})

    def test_chips_do_not_bleed_across_runs(self):
        raw = list(RAW_THREAD) + [
            {"role": "user", "content": "and again?", "message_id": "m5"},
            {"role": "assistant", "content": "No tools this time.", "message_id": "m6",
             "metadata_": {"run_id": "run-2"}},
        ]
        parts = build_tool_call_parts(normalize_raw_messages(raw))
        self.assertIn("m4", parts)
        self.assertNotIn("m6", parts)  # different run, no tool calls

    def test_non_mcp_tools_get_no_chip(self):
        # The document-export tool's output embeds a raw Backboard S3 URL that
        # Nash rewrites for display — surfacing it in a chip would leak it.
        raw = [
            {"role": "assistant", "content": "", "message_id": "x0",
             "metadata_": {"run_id": "r1", "tool_calls": [
                 {"id": "c1", "type": "function",
                  "function": {"name": "create_document_export",
                               "arguments": '{"filename": "a.pdf"}'}}]}},
            {"role": "assistant", "content": "Here's your file.", "message_id": "x1",
             "metadata_": {"run_id": "r1"}},
        ]
        self.assertEqual(build_tool_call_parts(normalize_raw_messages(raw)), {})

    def test_thread_without_tools_yields_nothing(self):
        raw = [
            {"role": "user", "content": "hi", "message_id": "a"},
            {"role": "assistant", "content": "hello", "message_id": "b",
             "metadata_": {"run_id": "r1"}},
        ]
        self.assertEqual(build_tool_call_parts(normalize_raw_messages(raw)), {})

    def test_missing_metadata_does_not_explode(self):
        raw = [{"role": "assistant", "content": "hi", "message_id": "b", "metadata_": None}]
        self.assertEqual(build_tool_call_parts(normalize_raw_messages(raw)), {})

    def test_large_output_is_truncated(self):
        huge = "x" * (TOOL_OUTPUT_DISPLAY_LIMIT + 500)
        raw = [RAW_THREAD[1], dict(RAW_THREAD[2], content=huge), RAW_THREAD[3]]
        call = build_tool_call_parts(normalize_raw_messages(raw))["m4"][0]["tool_call"]
        self.assertLess(len(call["output"]), len(huge))
        self.assertTrue(call["output"].endswith("[truncated]"))


class AssistantContentCompositionTests(unittest.TestCase):
    """messages.py: chips + text, and the parallel-view carve-out."""

    TOOL_PARTS = [
        {"type": "tool_call",
         "tool_call": {"name": TOOL_NAME, "args": ARGS, "output": OUTPUT, "progress": 1}},
    ]

    def test_chips_precede_the_answer_text(self):
        content = _assistant_content("The answer.", "openai", "gpt-4.1", None, self.TOOL_PARTS)
        self.assertEqual(len(content), 2)
        self.assertEqual(content[0]["type"], "tool_call")
        self.assertEqual(content[1]["type"], "text")
        self.assertEqual(content[1]["text"]["value"], "The answer.")

    def test_plain_message_keeps_flat_text(self):
        # None => the route leaves `content` off entirely and the client renders `text`.
        self.assertIsNone(_assistant_content("hi", "openai", "gpt-4.1", None, None))

    def test_added_model_response_wins_and_stays_parallel(self):
        added = {"text": "second model says hi", "model": "gpt-4o", "agentId": "a2"}
        content = _assistant_content("primary", "openai", "gpt-4.1", added, self.TOOL_PARTS)
        # Every part must carry a groupId — one ungrouped chip would make
        # ContentParts route the message to ParallelContentRenderer and drop it.
        self.assertTrue(all(p.get("groupId") is not None for p in content))
        self.assertTrue(all(p["type"] == "text" for p in content))


class StreamFinalizeChipTests(unittest.TestCase):
    """chat.py: the `final` SSE event must carry the same chips."""

    def test_executed_calls_become_parts(self):
        parts = _tool_chip_parts([
            {"name": TOOL_NAME, "args": ARGS, "output": OUTPUT, "progress": 1},
        ])
        self.assertEqual(len(parts), 1)
        self.assertEqual(parts[0]["type"], "tool_call")
        self.assertEqual(parts[0]["tool_call"]["name"], TOOL_NAME)
        self.assertNotIn("type", parts[0]["tool_call"])

    def test_no_calls_means_no_parts(self):
        self.assertEqual(_tool_chip_parts([]), [])

    def test_output_truncated_like_history(self):
        huge = "y" * (TOOL_OUTPUT_DISPLAY_LIMIT + 100)
        parts = _tool_chip_parts([{"name": TOOL_NAME, "args": ARGS, "output": huge}])
        self.assertTrue(parts[0]["tool_call"]["output"].endswith("[truncated]"))

    def test_export_tool_never_chips_on_either_path(self):
        self.assertEqual(_tool_chip_parts([{"name": DOCUMENT_EXPORT_TOOL_NAME, "args": "{}"}]), [])

    def test_internal_uploaded_image_tool_never_exposes_base64_chip(self):
        name = "inspect_uploaded_image_1"
        self.assertFalse(is_chip_tool(name))
        self.assertEqual(_tool_chip_parts([{"name": name, "args": "{}", "output": "base64"}]), [])


class LiveAndReloadMustAgreeTests(unittest.TestCase):
    """The streaming chip and the reloaded chip are the same chip.

    They are built by different functions on different data sources; if their
    predicates or truncation ever diverge, a chip appears while streaming and
    vanishes on refresh (or vice versa) — the exact bug this feature exists to
    kill. These tests pin them together.
    """

    def test_long_tool_name_that_lost_the_mcp_delimiter_still_chips(self):
        # make_openai_tool_name() truncates from the HEAD at 64 chars, which chops
        # the trailing "_mcp_{server}" off long names. A delimiter-based filter
        # would drop this chip on reload while the live stream still showed it.
        long_name = make_openai_tool_name("a" * 60, "aws-knowledge")
        self.assertNotIn("_mcp_", long_name)  # the exact condition that broke it
        self.assertTrue(is_chip_tool(long_name))

        raw = [
            {"role": "assistant", "content": "", "message_id": "s1",
             "metadata_": {"run_id": "r1", "tool_calls": [
                 {"id": "c1", "type": "function",
                  "function": {"name": long_name, "arguments": "{}"}}]}},
            {"role": "tool", "content": "OUT", "message_id": "t1",
             "metadata_": {"run_id": "r1", "tool_call_id": "c1"}},
            {"role": "assistant", "content": "answer", "message_id": "a1",
             "metadata_": {"run_id": "r1"}},
        ]
        reloaded = build_tool_call_parts(normalize_raw_messages(raw))["a1"]
        live = _tool_chip_parts([{"id": "c1", "name": long_name, "args": "{}", "output": "OUT"}])
        self.assertEqual(len(reloaded), 1)
        self.assertEqual(reloaded[0]["tool_call"]["name"], long_name)
        self.assertEqual(live, reloaded)

    def test_same_call_produces_identical_parts_on_both_paths(self):
        raw = [
            {"role": "assistant", "content": "", "message_id": "s1",
             "metadata_": {"run_id": "r1", "tool_calls": [
                 {"id": CALL_ID, "type": "function",
                  "function": {"name": TOOL_NAME, "arguments": ARGS}}]}},
            {"role": "tool", "content": OUTPUT, "message_id": "t1",
             "metadata_": {"run_id": "r1", "tool_call_id": CALL_ID}},
            {"role": "assistant", "content": "answer", "message_id": "a1",
             "metadata_": {"run_id": "r1"}},
        ]
        reloaded = build_tool_call_parts(normalize_raw_messages(raw))["a1"]
        live = _tool_chip_parts([
            {"id": CALL_ID, "name": TOOL_NAME, "args": ARGS, "output": OUTPUT, "progress": 1},
        ])
        self.assertEqual(live, reloaded)

    def test_truncation_is_idempotent_across_the_two_hops(self):
        # The live SSE event is already truncated; _tool_chip_parts truncates the
        # collected call again. Double-truncation must not stack suffixes.
        huge = "z" * (TOOL_OUTPUT_DISPLAY_LIMIT + 500)
        once = truncate_tool_output(huge)
        twice = truncate_tool_output(once)
        self.assertEqual(once, twice)
        self.assertEqual(twice.count("[truncated]"), 1)


if __name__ == "__main__":
    unittest.main()
