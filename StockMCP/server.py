#!/usr/bin/env python3
"""
MCP Server for StockNow Bangladesh (stocknow.com.bd).

Provides tools to fetch historical OHLCV (Open/High/Low/Close/Volume) chart data
for instruments listed on the Dhaka Stock Exchange (DSE). AI agents can query
intraday (15-min), daily, weekly, and monthly candle data.
"""

import json
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional

import httpx
from mcp.server.fastmcp import FastMCP
from pydantic import BaseModel, ConfigDict, Field, field_validator

# ──────────────────────────────────────────────
# Server Initialisation
# ──────────────────────────────────────────────

mcp = FastMCP("stocknow_mcp")

# ──────────────────────────────────────────────
# Constants
# ──────────────────────────────────────────────

API_BASE_URL = "https://stocknow.com.bd/api/v1/instruments"
REQUEST_TIMEOUT = 30.0

# ──────────────────────────────────────────────
# Enums & Pydantic Models
# ──────────────────────────────────────────────


class Resolution(str, Enum):
    """Chart resolution / timeframe."""

    FIFTEEN_MIN = "15"
    DAILY = "1D"
    WEEKLY = "1W"
    MONTHLY = "1M"


class ChartDataInput(BaseModel):
    """Input for fetching OHLCV chart data."""

    model_config = ConfigDict(str_strip_whitespace=True, validate_assignment=True)

    symbol: str = Field(
        ...,
        description=(
            "DSE trading code of the instrument, e.g. 'BSRMSTEEL', 'BEXIMCO', 'GP'. "
            "Must be uppercase."
        ),
        min_length=1,
        max_length=30,
    )
    resolution: Resolution = Field(
        default=Resolution.DAILY,
        description=(
            "Candle timeframe. '15' = 15-minute, '1D' = daily, '1W' = weekly, '1M' = monthly."
        ),
    )
    skip: int = Field(
        default=0,
        description=(
            "Number of candles to skip (pagination offset). Use 0 for the most recent data. "
            "Increase in multiples of ~300 to page back through history."
        ),
        ge=0,
    )

    @field_validator("symbol")
    @classmethod
    def normalise_symbol(cls, v: str) -> str:
        return v.strip().upper()


class LatestPriceInput(BaseModel):
    """Input for fetching the latest price of a stock."""

    model_config = ConfigDict(str_strip_whitespace=True, validate_assignment=True)

    symbol: str = Field(
        ...,
        description="DSE trading code, e.g. 'BSRMSTEEL'. Must be uppercase.",
        min_length=1,
        max_length=30,
    )

    @field_validator("symbol")
    @classmethod
    def normalise_symbol(cls, v: str) -> str:
        return v.strip().upper()


class PriceRangeInput(BaseModel):
    """Input for fetching price range / summary statistics."""

    model_config = ConfigDict(str_strip_whitespace=True, validate_assignment=True)

    symbol: str = Field(
        ...,
        description="DSE trading code, e.g. 'BSRMSTEEL'. Must be uppercase.",
        min_length=1,
        max_length=30,
    )
    resolution: Resolution = Field(
        default=Resolution.DAILY,
        description="Candle timeframe. '15' = 15-minute, '1D' = daily, '1W' = weekly, '1M' = monthly.",
    )
    skip: int = Field(
        default=0,
        description="Number of candles to skip (pagination offset).",
        ge=0,
    )

    @field_validator("symbol")
    @classmethod
    def normalise_symbol(cls, v: str) -> str:
        return v.strip().upper()


# ──────────────────────────────────────────────
# Shared Utilities
# ──────────────────────────────────────────────


async def _fetch_history(symbol: str, resolution: str, skip: int = 0) -> List[List[Any]]:
    """Fetch raw OHLCV history from the StockNow API.

    Returns a list of 6 sub-arrays: [open, high, low, close, volume, timestamp].
    """
    url = f"{API_BASE_URL}/{symbol}/history"
    params = {"data2": "true", "resolution": resolution, "skip": skip}

    async with httpx.AsyncClient() as client:
        response = await client.get(url, params=params, timeout=REQUEST_TIMEOUT)
        response.raise_for_status()
        return response.json()


def _parse_candles(raw: List[List[Any]]) -> List[Dict[str, Any]]:
    """Transform raw positional arrays into a list of named candle objects.

    Raw format: [open[], high[], low[], close[], volume[], timestamp[]]
    Output:     [{open, high, low, close, volume, timestamp, datetime}, ...]
    """
    if not raw or len(raw) < 6:
        return []

    opens, highs, lows, closes, volumes, timestamps = raw[0], raw[1], raw[2], raw[3], raw[4], raw[5]
    candle_count = len(timestamps)

    candles = []
    for i in range(candle_count):
        ts = int(timestamps[i])
        dt = datetime.fromtimestamp(ts, tz=timezone.utc)
        candles.append(
            {
                "open": opens[i],
                "high": highs[i],
                "low": lows[i],
                "close": closes[i],
                "volume": int(volumes[i]),
                "timestamp": ts,
                "datetime": dt.strftime("%Y-%m-%d %H:%M:%S UTC"),
            }
        )
    return candles


def _handle_api_error(e: Exception) -> str:
    """Produce a clear, actionable error message."""
    if isinstance(e, httpx.HTTPStatusError):
        status = e.response.status_code
        if status == 404:
            return (
                "Error: Instrument not found. Please check the trading code is correct "
                "(e.g. 'BSRMSTEEL', 'GP', 'BEXIMCO'). Symbols must match the DSE trading code exactly."
            )
        if status == 429:
            return "Error: Rate limit exceeded. Please wait a moment before retrying."
        return f"Error: StockNow API returned status {status}."
    if isinstance(e, httpx.TimeoutException):
        return "Error: Request to StockNow timed out. The server may be slow — please retry."
    if isinstance(e, httpx.ConnectError):
        return "Error: Could not connect to stocknow.com.bd. Check network connectivity."
    return f"Error: {type(e).__name__} — {e}"


# ──────────────────────────────────────────────
# Tool Definitions
# ──────────────────────────────────────────────


@mcp.tool(
    name="stocknow_get_chart_data",
    annotations={
        "title": "Get Stock Chart Data (OHLCV)",
        "readOnlyHint": True,
        "destructiveHint": False,
        "idempotentHint": True,
        "openWorldHint": True,
    },
)
async def stocknow_get_chart_data(params: ChartDataInput) -> str:
    """Fetch OHLCV candlestick chart data for any DSE-listed instrument.

    Returns an array of candle objects with open, high, low, close, volume,
    unix timestamp, and a human-readable datetime.  Supports 15-minute,
    daily, weekly, and monthly resolutions.

    Use ``skip`` to paginate through older data (e.g. skip=300 for the next
    batch of 300 older candles).

    Args:
        params (ChartDataInput): Validated input parameters containing:
            - symbol (str): DSE trading code (e.g. 'BSRMSTEEL')
            - resolution (str): '15' | '1D' | '1W' | '1M'
            - skip (int): Pagination offset (default 0)

    Returns:
        str: JSON string with schema:
            {
                "symbol": str,
                "resolution": str,
                "skip": int,
                "count": int,
                "candles": [
                    {
                        "open": float,
                        "high": float,
                        "low": float,
                        "close": float,
                        "volume": int,
                        "timestamp": int,
                        "datetime": str
                    }, ...
                ]
            }
    """
    try:
        raw = await _fetch_history(params.symbol, params.resolution.value, params.skip)
        candles = _parse_candles(raw)

        if not candles:
            return f"No chart data found for '{params.symbol}' at resolution {params.resolution.value}."

        result = {
            "symbol": params.symbol,
            "resolution": params.resolution.value,
            "skip": params.skip,
            "count": len(candles),
            "candles": candles,
        }
        return json.dumps(result, indent=2)

    except Exception as e:
        return _handle_api_error(e)


@mcp.tool(
    name="stocknow_get_latest_price",
    annotations={
        "title": "Get Latest Stock Price",
        "readOnlyHint": True,
        "destructiveHint": False,
        "idempotentHint": True,
        "openWorldHint": True,
    },
)
async def stocknow_get_latest_price(params: LatestPriceInput) -> str:
    """Get the most recent price data for a DSE-listed stock.

    Fetches the latest candle from the 15-minute intraday chart and returns
    the last known open, high, low, close, and volume.

    Args:
        params (LatestPriceInput): Validated input containing:
            - symbol (str): DSE trading code (e.g. 'BSRMSTEEL')

    Returns:
        str: JSON string with schema:
            {
                "symbol": str,
                "close": float,
                "open": float,
                "high": float,
                "low": float,
                "volume": int,
                "timestamp": int,
                "datetime": str
            }
    """
    try:
        raw = await _fetch_history(params.symbol, Resolution.FIFTEEN_MIN.value, skip=0)
        candles = _parse_candles(raw)

        if not candles:
            return f"No price data available for '{params.symbol}'."

        latest = candles[-1]
        result = {
            "symbol": params.symbol,
            "close": latest["close"],
            "open": latest["open"],
            "high": latest["high"],
            "low": latest["low"],
            "volume": latest["volume"],
            "timestamp": latest["timestamp"],
            "datetime": latest["datetime"],
        }
        return json.dumps(result, indent=2)

    except Exception as e:
        return _handle_api_error(e)


@mcp.tool(
    name="stocknow_get_price_range",
    annotations={
        "title": "Get Price Range & Summary Stats",
        "readOnlyHint": True,
        "destructiveHint": False,
        "idempotentHint": True,
        "openWorldHint": True,
    },
)
async def stocknow_get_price_range(params: PriceRangeInput) -> str:
    """Get summary statistics (min, max, average) for price and volume over
    the fetched history of a DSE-listed instrument.

    Useful for quickly understanding the trading range and volume profile
    without processing every individual candle.

    Args:
        params (PriceRangeInput): Validated input containing:
            - symbol (str): DSE trading code (e.g. 'BSRMSTEEL')
            - resolution (str): '15' | '1D' | '1W' | '1M'
            - skip (int): Pagination offset (default 0)

    Returns:
        str: JSON string with schema:
            {
                "symbol": str,
                "resolution": str,
                "candle_count": int,
                "start_date": str,
                "end_date": str,
                "close_min": float,
                "close_max": float,
                "close_avg": float,
                "volume_min": int,
                "volume_max": int,
                "volume_avg": int,
                "high_of_period": float,
                "low_of_period": float
            }
    """
    try:
        raw = await _fetch_history(params.symbol, params.resolution.value, params.skip)
        candles = _parse_candles(raw)

        if not candles:
            return f"No data found for '{params.symbol}' at resolution {params.resolution.value}."

        closes = [c["close"] for c in candles]
        highs = [c["high"] for c in candles]
        lows = [c["low"] for c in candles]
        volumes = [c["volume"] for c in candles]

        result = {
            "symbol": params.symbol,
            "resolution": params.resolution.value,
            "candle_count": len(candles),
            "start_date": candles[0]["datetime"],
            "end_date": candles[-1]["datetime"],
            "close_min": round(min(closes), 2),
            "close_max": round(max(closes), 2),
            "close_avg": round(sum(closes) / len(closes), 2),
            "volume_min": min(volumes),
            "volume_max": max(volumes),
            "volume_avg": round(sum(volumes) / len(volumes)),
            "high_of_period": round(max(highs), 2),
            "low_of_period": round(min(lows), 2),
        }
        return json.dumps(result, indent=2)

    except Exception as e:
        return _handle_api_error(e)


# ──────────────────────────────────────────────
# Entry point
# ──────────────────────────────────────────────

if __name__ == "__main__":
    mcp.run()
