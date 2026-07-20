# StockNow MCP Server

A Python FastMCP server that wraps the StockNow Bangladesh API (`stocknow.com.bd`), giving AI agents structured access to Dhaka Stock Exchange historical price data.

## Files

| File | Purpose |
|------|---------|
| `server.py` | Main MCP server — 3 tools wrapping the StockNow API |
| `requirements.txt` | Python dependencies (`mcp[cli]`, `httpx`, `pydantic`) |
| `.gitignore` | Ignores `.venv/` and `__pycache__/` |

## Tools Registered

| Tool | What It Does |
|------|-------------|
| `stocknow_get_chart_data` | Fetch OHLCV candles (15min/daily/weekly/monthly) with pagination |
| `stocknow_get_latest_price` | Get the most recent price for any stock |
| `stocknow_get_price_range` | Summary stats: min/max/avg price & volume over the period |

## Installation

```bash
cd StockMCP
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Configuration

> **Important:** Since the server uses a virtual environment, the MCP config must point to the `.venv/bin/python` binary, not the system Python.

### Antigravity (Gemini)

Create/edit `~/.gemini/config/mcp/stocknow.json`:

```json
{
  "mcpServers": {
    "stocknow": {
      "command": "/absolute/path/to/StockMCP/.venv/bin/python",
      "args": ["/absolute/path/to/StockMCP/server.py"],
      "timeout": 30
    }
  }
}
```

### Claude Desktop

Edit your Claude Desktop config file:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "stocknow": {
      "command": "/absolute/path/to/StockMCP/.venv/bin/python",
      "args": ["/absolute/path/to/StockMCP/server.py"]
    }
  }
}
```

> Replace `/absolute/path/to/StockMCP/` with the actual path on your machine.

## Key Design Decisions

- **Raw array → structured objects**: The API returns `[open[], high[], low[], close[], volume[], timestamp[]]` positional arrays. The MCP transforms these into named `{open, high, low, close, volume, timestamp, datetime}` objects.
- **ISO timestamps**: Unix epoch seconds are converted to `YYYY-MM-DD HH:MM:SS UTC` strings for readability.
- **Venv Python path**: Both Antigravity and Claude configs point to `.venv/bin/python` to avoid system Python dependency issues.

## Supported Resolutions

| Value | Meaning |
|-------|---------|
| `15` | 15-minute intraday candles |
| `1D` | Daily candles |
| `1W` | Weekly candles |
| `1M` | Monthly candles |

## How Pagination Works

The `skip` parameter controls how many candles to skip from the most recent. Use `skip=0` for the latest data, `skip=300` for the next batch of older candles, etc.

## Usage Examples

Once configured, AI agents can use prompts like:

- *"Get the latest price of BSRMSTEEL"*
- *"Show me the daily chart data for GP"*
- *"What's the price range of BEXIMCO over weekly candles?"*
- *"Fetch 15-minute candles for BSRMSTEEL with skip=300 for older data"*
