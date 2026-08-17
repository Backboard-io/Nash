"""BackboardClient pooling contract.

A BackboardClient eagerly owns an httpx.AsyncClient (connection pool).
`get_user_client` must return ONE shared, reused client per API key (so we don't
churn/leak connection pools per request), while `new_user_client` must always
return a fresh, caller-owned client for lifecycles that close their own FDs
(voice WebSockets). The pool is LRU-bounded.
"""

import pytest

from api.services import backboard_service as bb


@pytest.fixture(autouse=True)
def _clear_pool():
    bb._client_pool.clear()
    yield
    bb._client_pool.clear()


def test_same_key_returns_same_pooled_client():
    a1 = bb.get_user_client("key-A")
    a2 = bb.get_user_client("key-A")
    assert a1 is a2


def test_different_keys_get_different_clients():
    assert bb.get_user_client("key-A") is not bb.get_user_client("key-B")


def test_new_user_client_is_always_fresh_and_unpooled():
    pooled = bb.get_user_client("key-A")
    owned1 = bb.new_user_client("key-A")
    owned2 = bb.new_user_client("key-A")
    assert owned1 is not pooled
    assert owned1 is not owned2
    # new_user_client must not populate or mutate the shared pool.
    assert len(bb._client_pool) == 1


def test_missing_api_key_is_rejected():
    with pytest.raises(ValueError):
        bb.get_user_client("")
    with pytest.raises(ValueError):
        bb.get_user_client(None)


def test_pool_is_lru_bounded(monkeypatch):
    monkeypatch.setattr(bb, "_CLIENT_POOL_MAX", 3)
    # Avoid scheduling real aclose() coroutines on the loop during eviction.
    # The eviction path imports this lazily from async_runner, so patch there.
    import api.services.async_runner as ar

    monkeypatch.setattr(ar, "run_async_background", lambda coro: getattr(coro, "close", lambda: None)())

    first = bb.get_user_client("k0")
    for i in range(1, 3):
        bb.get_user_client(f"k{i}")
    # Touch k0 so it's most-recently-used, then overflow: k1 (now LRU) evicts.
    assert bb.get_user_client("k0") is first
    bb.get_user_client("k3")

    keys = list(bb._client_pool)
    assert len(bb._client_pool) == 3
    assert bb._client_pool_key("k1") not in keys
    assert bb._client_pool_key("k0") in keys


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-q"]))
