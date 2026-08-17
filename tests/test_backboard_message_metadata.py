"""Per-message metadata round-trip: Nash stamps a correlation token into the
Backboard message metadata on send and reads it back on GET, so uploaded files
bind to the exact user message THIS request created (deterministic, no snapshot
race). Covers the read side (normalize_raw_messages) and the send side
(stream_message_proxy_compatible forwards metadata into the request)."""

import unittest
from unittest.mock import MagicMock, patch

from api.services import backboard_service as bb


class NormalizeMetadataTests(unittest.TestCase):
    def test_metadata_is_carried_onto_the_thread_message(self):
        raw = [{"id": "U_A", "role": "user", "content": "hi",
                "metadata": {"nash_msg_token": "tok-1"}}]
        msg = bb.normalize_raw_messages(raw)[0]
        self.assertEqual(msg.metadata, {"nash_msg_token": "tok-1"})

    def test_metadata_underscore_alias_is_accepted(self):
        raw = [{"id": "U_A", "role": "user", "content": "hi",
                "metadata_": {"nash_msg_token": "tok-2"}}]
        self.assertEqual(
            bb.normalize_raw_messages(raw)[0].metadata, {"nash_msg_token": "tok-2"}
        )

    def test_metadata_spellings_are_merged_with_canonical_precedence(self):
        raw = [{
            "id": "U_A",
            "role": "user",
            "content": "hi",
            "metadata_": {"run_id": "run-1", "shared": "alias"},
            "metadata": {"nash_msg_token": "tok-3", "shared": "canonical"},
        }]

        self.assertEqual(
            bb.normalize_raw_messages(raw)[0].metadata,
            {
                "run_id": "run-1",
                "nash_msg_token": "tok-3",
                "shared": "canonical",
            },
        )

    def test_missing_or_non_dict_metadata_defaults_to_empty(self):
        raw = [
            {"id": "U_A", "role": "user", "content": "a"},              # absent
            {"id": "U_B", "role": "user", "content": "b", "metadata": "x"},  # wrong type
        ]
        out = bb.normalize_raw_messages(raw)
        self.assertEqual(out[0].metadata, {})
        self.assertEqual(out[1].metadata, {})


class StreamForwardsMetadataTests(unittest.TestCase):
    def _capture_body(self, **kwargs):
        client = MagicMock()
        client._parse_streaming_response_iter.return_value = iter(())
        with patch.object(bb, "get_user_client", return_value=client), patch.object(
            bb, "parse_model_spec", return_value=(None, None)
        ):
            import asyncio

            asyncio.run(
                bb.stream_message_proxy_compatible(
                    "thread-1", content="hello", **kwargs
                )
            )
        return client._parse_streaming_response_iter.call_args.kwargs

    def test_metadata_forwarded_into_json_body(self):
        call = self._capture_body(metadata={"nash_msg_token": "tok-9"})
        self.assertEqual(call["json_data"]["metadata"], {"nash_msg_token": "tok-9"})

    def test_no_metadata_key_when_none(self):
        call = self._capture_body()
        self.assertNotIn("metadata", call["json_data"])


if __name__ == "__main__":
    unittest.main()
