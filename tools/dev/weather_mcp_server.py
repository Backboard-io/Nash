#!/usr/bin/env python3
"""An authenticated weather MCP server (streamable-http) for testing Nash's
static-auth path end to end.

Requires a bearer token on EVERY request:  Authorization: Bearer <TOKEN>
Anything else gets a 401 — which is what exercises Nash's error surfacing.

Weather data is fetched live from Open-Meteo (no API key needed on their side),
so the tool returns real values a model could not have memorized. Geocoding is
also Open-Meteo.

Run:  WEATHER_MCP_TOKEN=... python weather_mcp_server.py   (listens on :9099)
"""

import os

import httpx
import uvicorn
from mcp.server.fastmcp import FastMCP
from starlette.applications import Starlette
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from starlette.routing import Mount

TOKEN = os.environ.get("WEATHER_MCP_TOKEN", "")
if not TOKEN:
    raise SystemExit("set WEATHER_MCP_TOKEN")

mcp = FastMCP("weather", stateless_http=True)


async def _geocode(city: str) -> dict | None:
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.get(
            "https://geocoding-api.open-meteo.com/v1/search",
            params={"name": city, "count": 1},
        )
        r.raise_for_status()
        results = (r.json() or {}).get("results") or []
        return results[0] if results else None


@mcp.tool()
async def get_current_weather(city: str) -> str:
    """Get the CURRENT weather for a city: temperature (C), wind speed, and conditions.

    Use this whenever the user asks about current weather anywhere in the world.
    """
    place = await _geocode(city)
    if not place:
        return f"No such city: {city!r}"
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.get(
            "https://api.open-meteo.com/v1/forecast",
            params={
                "latitude": place["latitude"],
                "longitude": place["longitude"],
                "current": "temperature_2m,wind_speed_10m,relative_humidity_2m",
            },
        )
        r.raise_for_status()
        cur = (r.json() or {}).get("current") or {}
    return (
        f"Current weather in {place['name']}, {place.get('country', '')}:\n"
        f"- temperature: {cur.get('temperature_2m')} °C\n"
        f"- wind speed: {cur.get('wind_speed_10m')} km/h\n"
        f"- relative humidity: {cur.get('relative_humidity_2m')} %\n"
        f"- observed at: {cur.get('time')}\n"
        f"- coordinates: {place['latitude']}, {place['longitude']}"
    )


@mcp.tool()
async def get_forecast_high(city: str, days: int = 3) -> str:
    """Get the daily MAXIMUM temperature forecast (C) for a city for the next N days."""
    place = await _geocode(city)
    if not place:
        return f"No such city: {city!r}"
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.get(
            "https://api.open-meteo.com/v1/forecast",
            params={
                "latitude": place["latitude"],
                "longitude": place["longitude"],
                "daily": "temperature_2m_max",
                "forecast_days": max(1, min(int(days), 7)),
            },
        )
        r.raise_for_status()
        daily = (r.json() or {}).get("daily") or {}
    rows = zip(daily.get("time", []), daily.get("temperature_2m_max", []))
    body = "\n".join(f"- {d}: {t} °C" for d, t in rows)
    return f"Forecast highs for {place['name']}:\n{body}"


class BearerAuth(BaseHTTPMiddleware):
    """Reject every request that does not carry the expected bearer token."""

    async def dispatch(self, request, call_next):
        header = request.headers.get("authorization", "")
        if header != f"Bearer {TOKEN}":
            return JSONResponse(
                {"error": "unauthorized: missing or invalid bearer token"},
                status_code=401,
            )
        return await call_next(request)


# Add the middleware to FastMCP's own app — wrapping it in an outer Starlette
# via Mount() drops its lifespan, and the session manager never starts.
app = mcp.streamable_http_app()
app.add_middleware(BearerAuth)

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=9099, log_level="warning")
