"""Persistent event loop for running async Backboard SDK calls from sync Flask code.

A single event loop lives in a daemon thread for the lifetime of the process.
This avoids the 'Event loop is closed' errors that happen when asyncio.run()
creates and destroys loops, killing the httpx connection pool inside BackboardClient.
"""
import asyncio
import threading
from concurrent.futures import Future

_loop: asyncio.AbstractEventLoop | None = None
_thread: threading.Thread | None = None
_lock = threading.Lock()


def _start_loop(loop: asyncio.AbstractEventLoop) -> None:
    asyncio.set_event_loop(loop)
    loop.run_forever()


def _get_loop() -> asyncio.AbstractEventLoop:
    global _loop, _thread
    if _loop is not None and _loop.is_running():
        return _loop
    with _lock:
        if _loop is not None and _loop.is_running():
            return _loop
        _loop = asyncio.new_event_loop()
        _thread = threading.Thread(target=_start_loop, args=(_loop,), daemon=True)
        _thread.start()
    return _loop


def run_async(coro, *, timeout: float | None = 30):
    """Submit a coroutine to the persistent loop and block until it completes.

    Defaults to a 30-second timeout so a stalled Backboard call never holds
    a Flask worker thread indefinitely.  Pass timeout=None only when the
    caller has its own explicit deadline (e.g. the MCP tool loop uses 120s).
    """
    loop = _get_loop()
    future: Future = asyncio.run_coroutine_threadsafe(coro, loop)
    return future.result(timeout=timeout)


def run_async_background(coro) -> Future:
    """Submit a coroutine to the persistent loop without blocking.

    Runs concurrently with whatever the caller does next (e.g. consuming the
    primary stream) on the same persistent loop. Call ``.result(timeout=...)``
    on the returned Future when the caller is ready to wait for it.
    """
    loop = _get_loop()
    return asyncio.run_coroutine_threadsafe(coro, loop)


_STOP = object()


def iter_async(async_iter, *, idle_timeout: float = 45):
    """Yield items from an async iterator, one at a time, from sync code.

    Each call to ``__next__`` schedules a single ``__anext__`` on the
    persistent event loop and blocks the *current greenlet* (not the
    worker) until the value arrives.  This gives a direct pull-based
    pipeline with no intermediate queue.
    """
    loop = _get_loop()

    async def _next():
        try:
            return await asyncio.wait_for(async_iter.__anext__(), timeout=idle_timeout)
        except StopAsyncIteration:
            return _STOP

    while True:
        future: Future = asyncio.run_coroutine_threadsafe(_next(), loop)
        value = future.result()
        if value is _STOP:
            return
        yield value
