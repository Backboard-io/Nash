"""Tests for nash-main assistant discovery in api.services.backboard_service.

These cover the contract:
  - discover_main_assistant() returns the earliest-created assistant named
    `nash-main`, or None if no match.
  - ensure_nash_main_assistant() is idempotent: it never creates a new
    assistant when one already exists.
  - Pagination loops until short page; hard cap is respected.
  - On the rare concurrent-first-login race (two `nash-main` exist after the
    create), the earliest is chosen as the winner.
"""

from __future__ import annotations

import asyncio
import unittest
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

from api.services import backboard_service
from api.services.backboard_service import (
    NASH_MAIN_ASSISTANT_NAME,
    _LIST_ASSISTANTS_PAGE_SIZE,
    discover_main_assistant,
    ensure_nash_main_assistant,
)


@dataclass
class _FakeAssistant:
    assistant_id: str
    name: str
    created_at: datetime | None


def _now(offset_seconds: int = 0) -> datetime:
    return datetime(2026, 1, 1, tzinfo=timezone.utc) + timedelta(seconds=offset_seconds)


class _PaginatedListMock:
    """Mimics BackboardClient.list_assistants(skip, limit) over a fixed corpus."""

    def __init__(self, corpus: list[_FakeAssistant]):
        self._corpus = corpus
        self.call_log: list[tuple[int, int]] = []

    async def __call__(self, *, skip: int = 0, limit: int = 100) -> list[_FakeAssistant]:
        self.call_log.append((skip, limit))
        return self._corpus[skip : skip + limit]


def _client_with_corpus(corpus: list[_FakeAssistant]) -> tuple[object, _PaginatedListMock]:
    """Build a fake BackboardClient that returns `corpus` via list_assistants."""
    paginated = _PaginatedListMock(corpus)
    client = type("FakeClient", (), {})()
    client.list_assistants = paginated  # type: ignore[attr-defined]
    client.create_assistant = AsyncMock()
    return client, paginated


class DiscoverMainAssistantTests(unittest.TestCase):
    def test_returns_none_when_no_match(self):
        client, _ = _client_with_corpus([
            _FakeAssistant("a-1", "some-other", _now(0)),
            _FakeAssistant("a-2", "yet-another", _now(1)),
        ])
        result = asyncio.run(discover_main_assistant(client))
        self.assertIsNone(result)

    def test_returns_single_match(self):
        client, _ = _client_with_corpus([
            _FakeAssistant("main-1", NASH_MAIN_ASSISTANT_NAME, _now(0)),
            _FakeAssistant("other", "something-else", _now(1)),
        ])
        result = asyncio.run(discover_main_assistant(client))
        self.assertEqual(result, "main-1")

    def test_picks_earliest_when_duplicates_exist(self):
        # Concurrent-first-login race: two `nash-main` exist. The winner is
        # the earliest-created, so both racers converge on the same handle.
        client, _ = _client_with_corpus([
            _FakeAssistant("late", NASH_MAIN_ASSISTANT_NAME, _now(10)),
            _FakeAssistant("early", NASH_MAIN_ASSISTANT_NAME, _now(0)),
            _FakeAssistant("middle", NASH_MAIN_ASSISTANT_NAME, _now(5)),
        ])
        result = asyncio.run(discover_main_assistant(client))
        self.assertEqual(result, "early")

    def test_ties_break_on_assistant_id_string(self):
        # If created_at is somehow identical (or missing), the lexicographically
        # smaller assistant_id wins so the choice is still deterministic.
        client, _ = _client_with_corpus([
            _FakeAssistant("zzz", NASH_MAIN_ASSISTANT_NAME, _now(0)),
            _FakeAssistant("aaa", NASH_MAIN_ASSISTANT_NAME, _now(0)),
        ])
        result = asyncio.run(discover_main_assistant(client))
        self.assertEqual(result, "aaa")


class ListAllAssistantsPaginationTests(unittest.TestCase):
    def test_paginates_until_short_page(self):
        # 250 assistants → expect calls at skip=0, 100, 200 then stop on short page.
        corpus = [_FakeAssistant(f"a-{i}", "noise", _now(i)) for i in range(250)]
        client, paginated = _client_with_corpus(corpus)
        result = asyncio.run(backboard_service._list_all_assistants(client))
        self.assertEqual(len(result), 250)
        self.assertEqual(paginated.call_log, [
            (0, _LIST_ASSISTANTS_PAGE_SIZE),
            (100, _LIST_ASSISTANTS_PAGE_SIZE),
            (200, _LIST_ASSISTANTS_PAGE_SIZE),
        ])

    def test_stops_when_page_is_empty(self):
        # First page already empty — no further calls.
        client, paginated = _client_with_corpus([])
        result = asyncio.run(backboard_service._list_all_assistants(client))
        self.assertEqual(result, [])
        self.assertEqual(paginated.call_log, [(0, _LIST_ASSISTANTS_PAGE_SIZE)])


class EnsureNashMainAssistantTests(unittest.TestCase):
    def test_discovers_existing_does_not_create(self):
        client, _ = _client_with_corpus([
            _FakeAssistant("existing", NASH_MAIN_ASSISTANT_NAME, _now(0)),
        ])
        result = asyncio.run(ensure_nash_main_assistant(client))
        self.assertEqual(result, "existing")
        client.create_assistant.assert_not_awaited()

    def test_creates_when_none_then_returns_id(self):
        # The corpus is mutable across awaits: list returns empty first,
        # then yields the newly-created assistant on the second discover.
        corpus: list[_FakeAssistant] = []
        client, _ = _client_with_corpus(corpus)

        async def _fake_create(**kwargs):
            corpus.append(_FakeAssistant("brand-new", NASH_MAIN_ASSISTANT_NAME, _now(0)))
            return _FakeAssistant("brand-new", NASH_MAIN_ASSISTANT_NAME, _now(0))

        client.create_assistant = AsyncMock(side_effect=_fake_create)

        result = asyncio.run(ensure_nash_main_assistant(client))
        self.assertEqual(result, "brand-new")
        client.create_assistant.assert_awaited_once()
        kwargs = client.create_assistant.await_args.kwargs
        self.assertEqual(kwargs["name"], NASH_MAIN_ASSISTANT_NAME)

    def test_concurrent_race_returns_earliest(self):
        # Simulate two racing creates: by the time we re-discover, the corpus
        # has two `nash-main` assistants. The earlier one wins so both racers
        # land on the same id.
        corpus: list[_FakeAssistant] = []
        client, _ = _client_with_corpus(corpus)

        async def _fake_create(**kwargs):
            corpus.append(_FakeAssistant("racer-late", NASH_MAIN_ASSISTANT_NAME, _now(10)))
            corpus.append(_FakeAssistant("racer-early", NASH_MAIN_ASSISTANT_NAME, _now(0)))
            return _FakeAssistant("racer-late", NASH_MAIN_ASSISTANT_NAME, _now(10))

        client.create_assistant = AsyncMock(side_effect=_fake_create)

        result = asyncio.run(ensure_nash_main_assistant(client))
        self.assertEqual(result, "racer-early")

    def test_raises_if_create_silently_disappears(self):
        # Defensive: if Backboard accepts the create but the assistant still
        # isn't listable, we want a loud error rather than returning "".
        client, _ = _client_with_corpus([])
        client.create_assistant = AsyncMock(return_value=None)
        with self.assertRaises(RuntimeError):
            asyncio.run(ensure_nash_main_assistant(client))


if __name__ == "__main__":
    unittest.main()
