#!/usr/bin/env python3
"""Nash latency probe — request→result timings in ms, cold vs warm.

Measures, without touching app code:
  1. API endpoints: first call ("cold" for this run — pays any server cache
     fill) vs N warm repeats (cache hits). The cold−warm delta is your
     caching time.
  2. Static assets: bytes, Content-Encoding, and Cache-Control for the
     largest JS bundles (verifies the compression/immutable-cache fix).
  3. Optional --chat: one real message send, decomposed into
     POST → stream open → first token → final, plus total SSE bytes
     received (quantifies cumulative-retransmission cost).
  4. Optional --parallel K: K concurrent /api/user calls to expose
     CPU serialization on the single gevent worker (PBKDF2).

Usage:
    uv run python scripts/perf_probe.py --session <SESSION_KEY>
    uv run python scripts/perf_probe.py --base https://your-prod-host --session ... --csv perf.csv
    uv run python scripts/perf_probe.py --session ... --chat "hi" --model openai/gpt-4o-mini
    uv run python scripts/perf_probe.py --session ... --parallel 8

Get SESSION_KEY from the browser while logged in to Nash:
  DevTools → Application → Cookies → `session_key`
  (or sessionStorage → `nash_session_key`). Or set env NASH_SESSION_KEY.

To measure a TRUE cold catalog (post-deploy state): restart the backend,
then run this immediately — the first /api/init row shows the full
Backboard catalog fetch. A warm re-run right after shows the cached path.

--csv appends one row per probe per run (timestamped), so repeated runs
build a before/after record as you land fixes.

NOTE: --chat consumes real Backboard credits and runs a real model turn.
It sends isTemporary=true to keep the conversation out of your sidebar.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import csv
import json
import os
import re
import statistics
import sys
import time
from datetime import datetime, timezone

import httpx

# (name, path, needs_auth)
API_PROBES: list[tuple[str, str, bool]] = [
    ("health", "/health", False),
    ("config", "/api/config", False),
    ("user", "/api/user", True),
    ("init", "/api/init", True),
    ("models", "/api/models", True),
    ("endpoints", "/api/endpoints", True),
    ("convos", "/api/convos", True),
    ("balance", "/api/balance", True),
    ("banner", "/api/banner", False),
]


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def fmt_ms(v: float | None) -> str:
    return "-" if v is None else f"{v:8.1f}"


def fmt_bytes(n: int | None) -> str:
    if n is None:
        return "-"
    if n >= 1_048_576:
        return f"{n / 1_048_576:.2f}MiB"
    if n >= 1024:
        return f"{n / 1024:.1f}KiB"
    return f"{n}B"


class Timing:
    """One request's numbers: TTFB, total (request→full body), size, headers."""

    def __init__(self, status: int, ttfb_ms: float, total_ms: float, size: int,
                 headers: httpx.Headers):
        self.status = status
        self.ttfb_ms = ttfb_ms
        self.total_ms = total_ms
        self.size = size
        self.cache_control = headers.get("cache-control", "")
        self.content_encoding = headers.get("content-encoding", "identity")
        self.has_etag = "etag" in headers


def timed_get(client: httpx.Client, url: str, headers: dict | None = None,
              raw: bool = False) -> Timing:
    t0 = time.perf_counter()
    with client.stream("GET", url, headers=headers) as resp:
        ttfb = (time.perf_counter() - t0) * 1000
        size = 0
        # raw=True counts WIRE bytes (pre-decompression) — httpx transparently
        # decodes Content-Encoding in iter_bytes, which would report a
        # brotli-compressed asset at its decompressed size ("0% saved").
        chunks = resp.iter_raw() if raw else resp.iter_bytes()
        for chunk in chunks:
            size += len(chunk)
        total = (time.perf_counter() - t0) * 1000
        return Timing(resp.status_code, ttfb, total, size, resp.headers)


def probe_endpoint(client: httpx.Client, base: str, path: str, repeats: int,
                   auth_headers: dict) -> dict:
    url = base + path
    cold = timed_get(client, url, headers=auth_headers)
    warm: list[Timing] = []
    for _ in range(repeats):
        warm.append(timed_get(client, url, headers=auth_headers))
    warm_totals = [t.total_ms for t in warm]
    return {
        "status": cold.status,
        "cold_ms": cold.total_ms,
        "cold_ttfb_ms": cold.ttfb_ms,
        "warm_min_ms": min(warm_totals) if warm_totals else None,
        "warm_p50_ms": statistics.median(warm_totals) if warm_totals else None,
        "warm_max_ms": max(warm_totals) if warm_totals else None,
        "bytes": cold.size,
        "cache_control": cold.cache_control,
        "content_encoding": cold.content_encoding,
        "etag": cold.has_etag,
    }


def probe_assets(client: httpx.Client, base: str, top_n: int = 4) -> list[dict]:
    """Find JS bundles in index.html, probe the largest with and without
    Accept-Encoding — verifies compression + cache headers end to end."""
    rows: list[dict] = []
    try:
        index = client.get(base + "/", headers={"Accept-Encoding": "identity"})
    except Exception as e:
        print(f"  ! could not fetch index.html: {e}")
        return rows
    paths = sorted(set(re.findall(r'/assets/[^"\']+\.js', index.text)))
    if not paths:
        print("  ! no /assets/*.js references found in index.html")
        return rows

    sized: list[tuple[int, str]] = []
    for p in paths:
        try:
            head = client.head(base + p, headers={"Accept-Encoding": "identity"})
            sized.append((int(head.headers.get("content-length") or 0), p))
        except Exception:
            continue
    sized.sort(reverse=True)

    for _, path in sized[:top_n]:
        name = path.rsplit("/", 1)[-1]
        plain = timed_get(client, base + path, headers={"Accept-Encoding": "identity"}, raw=True)
        compressed = timed_get(client, base + path, headers={"Accept-Encoding": "br, gzip"}, raw=True)
        rows.append({
            "probe": f"asset:{name}",
            "identity_bytes": plain.size,
            "identity_ms": plain.total_ms,
            "negotiated_bytes": compressed.size,
            "negotiated_ms": compressed.total_ms,
            "negotiated_encoding": compressed.content_encoding,
            "cache_control": compressed.cache_control or plain.cache_control,
        })
    return rows


def probe_chat(client: httpx.Client, base: str, auth_headers: dict, text: str,
               model: str | None, endpoint: str | None) -> dict | None:
    """One real send: POST /api/agents/chat then read the SSE stream.
    Reports POST ms, stream-open ms, first-event, first-text-token, final,
    plus SSE volume (events, bytes, largest event) — the cumulative-
    retransmission signature."""
    payload: dict = {"text": text, "conversationId": "", "isTemporary": True}
    if model:
        payload["model"] = model
    if endpoint:
        payload["endpoint"] = endpoint

    t0 = time.perf_counter()
    resp = client.post(base + "/api/agents/chat", json=payload, headers=auth_headers)
    post_ms = (time.perf_counter() - t0) * 1000
    if resp.status_code != 200:
        print(f"  ! chat POST failed: {resp.status_code} {resp.text[:200]}")
        return None
    stream_id = resp.json().get("streamId")
    if not stream_id:
        print(f"  ! chat POST returned no streamId: {resp.text[:200]}")
        return None

    url = f"{base}/api/agents/chat/stream/{stream_id}"
    t_stream_req = time.perf_counter()
    first_event_ms = first_text_ms = final_ms = None
    events = sse_bytes = 0
    largest_event = 0
    last_text_len = 0

    with client.stream("GET", url, headers=auth_headers, timeout=180) as sse:
        open_ms = (time.perf_counter() - t_stream_req) * 1000
        buf = ""
        for chunk in sse.iter_text():
            sse_bytes += len(chunk.encode("utf-8", "ignore"))
            buf += chunk
            while "\n\n" in buf:
                raw, buf = buf.split("\n\n", 1)
                data_lines = [l[5:].strip() for l in raw.splitlines() if l.startswith("data:")]
                if not data_lines:
                    continue
                events += 1
                elapsed = (time.perf_counter() - t0) * 1000
                if first_event_ms is None:
                    first_event_ms = elapsed
                body = "\n".join(data_lines)
                largest_event = max(largest_event, len(body))
                try:
                    evt = json.loads(body)
                except json.JSONDecodeError:
                    continue
                if evt.get("type") == "text":
                    if first_text_ms is None:
                        first_text_ms = elapsed
                    last_text_len = len(((evt.get("text") or {}).get("value")) or "")
                if evt.get("final") is not None:
                    final_ms = elapsed
            if final_ms is not None:
                break

    return {
        "post_ms": post_ms,
        "stream_open_ms": open_ms,
        "first_event_ms": first_event_ms,
        "first_text_ms": first_text_ms,
        "final_ms": final_ms,
        "sse_events": events,
        "sse_bytes": sse_bytes,
        "largest_event_bytes": largest_event,
        "final_text_chars": last_text_len,
    }


def probe_parallel(base: str, auth_headers: dict, k: int) -> dict:
    """K concurrent /api/user calls. On the current single gevent worker,
    CPU-bound auth (PBKDF2) serializes these — expect max >> min. After the
    lru_cache fix the spread should collapse."""
    url = base + "/api/user"

    def one() -> float:
        with httpx.Client(timeout=30) as c:
            t0 = time.perf_counter()
            c.get(url, headers=auth_headers)
            return (time.perf_counter() - t0) * 1000

    with concurrent.futures.ThreadPoolExecutor(max_workers=k) as pool:
        times = sorted(f.result() for f in [pool.submit(one) for _ in range(k)])
    return {
        "k": k,
        "min_ms": times[0],
        "p50_ms": statistics.median(times),
        "max_ms": times[-1],
        "spread_ms": times[-1] - times[0],
    }


def append_csv(path: str, rows: list[dict]) -> None:
    fields = ["ts", "base", "probe", "status", "cold_ms", "cold_ttfb_ms",
              "warm_min_ms", "warm_p50_ms", "warm_max_ms", "bytes",
              "cache_control", "content_encoding", "etag",
              "identity_bytes", "identity_ms", "negotiated_bytes",
              "negotiated_ms", "negotiated_encoding",
              "post_ms", "stream_open_ms", "first_event_ms", "first_text_ms",
              "final_ms", "sse_events", "sse_bytes", "largest_event_bytes",
              "final_text_chars", "k", "min_ms", "p50_ms", "max_ms", "spread_ms"]
    new_file = not os.path.exists(path)
    with open(path, "a", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        if new_file:
            writer.writeheader()
        writer.writerows(rows)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", default="http://localhost:3080",
                    help="backend origin (default: %(default)s)")
    ap.add_argument("--session", default=os.getenv("NASH_SESSION_KEY", ""),
                    help="Nash session key (or env NASH_SESSION_KEY)")
    ap.add_argument("--repeat", type=int, default=5,
                    help="warm repeats per endpoint (default: %(default)s)")
    ap.add_argument("--csv", help="append results to this CSV (tracks runs over time)")
    ap.add_argument("--chat", metavar="TEXT",
                    help="ALSO send one real message (costs Backboard credits)")
    ap.add_argument("--model", help="model id for --chat, e.g. openai/gpt-4o-mini")
    ap.add_argument("--endpoint", help="endpoint name for --chat, e.g. OpenAI")
    ap.add_argument("--parallel", type=int, metavar="K",
                    help="ALSO run K concurrent /api/user calls (serialization test)")
    ap.add_argument("--skip-assets", action="store_true", help="skip static asset probes")
    args = ap.parse_args()

    base = args.base.rstrip("/")
    auth = {"X-Session-Key": args.session} if args.session else {}
    ts = now_iso()
    csv_rows: list[dict] = []

    with httpx.Client(timeout=60, follow_redirects=False) as client:
        # -- API endpoints ----------------------------------------------------
        print(f"\n== API endpoints @ {base}  ({ts})")
        print("   cold = first call this run (pays cache fill); warm = repeats (hits)")
        header = (f"  {'probe':<10} {'st':>3} {'cold_ms':>8} {'ttfb':>8} "
                  f"{'warm_min':>8} {'warm_p50':>8} {'warm_max':>8} {'size':>9}  cache-control / enc / etag")
        print(header)
        authed_ok = True
        for name, path, needs_auth in API_PROBES:
            if needs_auth and (not args.session or not authed_ok):
                print(f"  {name:<10} skipped (no/invalid --session)")
                continue
            try:
                r = probe_endpoint(client, base, path, args.repeat, auth if needs_auth else {})
            except Exception as e:
                print(f"  {name:<10} ERROR: {e}")
                continue
            if needs_auth and r["status"] == 401:
                authed_ok = False
                print(f"  {name:<10} 401 — session key invalid/expired; skipping authed probes")
                continue
            flags = (f"{r['cache_control'] or 'none'} / {r['content_encoding']}"
                     f" / {'etag' if r['etag'] else 'no-etag'}")
            print(f"  {name:<10} {r['status']:>3} {fmt_ms(r['cold_ms'])} {fmt_ms(r['cold_ttfb_ms'])} "
                  f"{fmt_ms(r['warm_min_ms'])} {fmt_ms(r['warm_p50_ms'])} {fmt_ms(r['warm_max_ms'])} "
                  f"{fmt_bytes(r['bytes']):>9}  {flags}")
            csv_rows.append({"ts": ts, "base": base, "probe": name, **r})

        # -- static assets ----------------------------------------------------
        if not args.skip_assets:
            print("\n== Largest JS assets (identity vs negotiated encoding)")
            for row in probe_assets(client, base):
                saved = (1 - row["negotiated_bytes"] / row["identity_bytes"]) * 100 \
                    if row["identity_bytes"] else 0
                print(f"  {row['probe']:<40} raw {fmt_bytes(row['identity_bytes']):>9} "
                      f"{row['identity_ms']:7.1f}ms | negotiated {fmt_bytes(row['negotiated_bytes']):>9} "
                      f"{row['negotiated_ms']:7.1f}ms ({row['negotiated_encoding']}, {saved:.0f}% saved) | "
                      f"cache: {row['cache_control'] or 'none'}")
                csv_rows.append({"ts": ts, "base": base, **row})

        # -- one real message send -------------------------------------------
        if args.chat:
            if not args.session:
                print("\n== chat probe skipped (needs --session)")
            else:
                print("\n== Message send (real turn — consumes credits)")
                r = probe_chat(client, base, auth, args.chat, args.model, args.endpoint)
                if r:
                    print(f"  POST /api/agents/chat        {fmt_ms(r['post_ms'])} ms")
                    print(f"  stream open (headers)        {fmt_ms(r['stream_open_ms'])} ms")
                    print(f"  first SSE event (from send)  {fmt_ms(r['first_event_ms'])} ms")
                    print(f"  first text token (from send) {fmt_ms(r['first_text_ms'])} ms   <-- perceived latency")
                    print(f"  final event (from send)      {fmt_ms(r['final_ms'])} ms")
                    ratio = (r["sse_bytes"] / r["final_text_chars"]) if r["final_text_chars"] else 0
                    print(f"  SSE: {r['sse_events']} events, {fmt_bytes(r['sse_bytes'])} received "
                          f"for a {fmt_bytes(r['final_text_chars'])} answer "
                          f"({ratio:.0f}x amplification), largest event {fmt_bytes(r['largest_event_bytes'])}")
                    csv_rows.append({"ts": ts, "base": base, "probe": "chat", **r})

        # -- concurrency serialization test ----------------------------------
        if args.parallel:
            if not args.session:
                print("\n== parallel probe skipped (needs --session)")
            else:
                print(f"\n== {args.parallel} concurrent /api/user calls (serialization test)")
                r = probe_parallel(base, auth, args.parallel)
                print(f"  min {fmt_ms(r['min_ms'])} ms   p50 {fmt_ms(r['p50_ms'])} ms   "
                      f"max {fmt_ms(r['max_ms'])} ms   spread {fmt_ms(r['spread_ms'])} ms")
                print("  (large max-vs-min spread = requests serializing on CPU-bound auth)")
                csv_rows.append({"ts": ts, "base": base, "probe": f"parallel{args.parallel}", **r})

    if args.csv and csv_rows:
        append_csv(args.csv, csv_rows)
        print(f"\nAppended {len(csv_rows)} rows to {args.csv}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
