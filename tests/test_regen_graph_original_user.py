"""_resolve_regen_original_user_id must find the TRUE original user message
across multiple regenerations of the same exchange, not just the first one.

Regression test: a fixed positional offset (visible_msgs[-4] in the caller)
is only correct on the first regeneration. On the 2nd+ regeneration, the
thread has grown by 2 messages per prior retry, so the fixed offset lands
on a previous retry's hidden (SKIP) duplicate user message instead of the
real original — orphaning the newest response's parent to a message the
frontend never receives (observed live: a regenerated response's
parentMessageId pointed at an id absent from GET /api/messages entirely).
"""
from api.routes.chat import _resolve_regen_original_user_id


def test_first_regeneration_uses_positional_fallback():
    # No prior regen_graph entry for the response being regenerated (it IS
    # the original) — must fall back to the positional guess.
    original_user_id = _resolve_regen_original_user_id(
        prev_ai_id="a1_original",
        positional_fallback_id="u1_original",
        existing_graph={},
    )
    assert original_user_id == "u1_original"


def test_second_regeneration_chains_through_existing_graph():
    # a2_regen1 was itself a regeneration, already resolved to u1_original.
    # The positional fallback for THIS regeneration would incorrectly be
    # u2_dup (the first regeneration's hidden duplicate user message) —
    # must be ignored in favor of the chained lookup.
    existing_graph = {"a2_regen1": "u1_original", "u2_dup": "SKIP"}
    original_user_id = _resolve_regen_original_user_id(
        prev_ai_id="a2_regen1",
        positional_fallback_id="u2_dup",  # the wrong, positionally-derived guess
        existing_graph=existing_graph,
    )
    assert original_user_id == "u1_original"


def test_third_regeneration_still_chains_correctly():
    existing_graph = {
        "a2_regen1": "u1_original",
        "u2_dup": "SKIP",
        "a3_regen2": "u1_original",
        "u3_dup": "SKIP",
    }
    original_user_id = _resolve_regen_original_user_id(
        prev_ai_id="a3_regen2",
        positional_fallback_id="u3_dup",
        existing_graph=existing_graph,
    )
    assert original_user_id == "u1_original"
