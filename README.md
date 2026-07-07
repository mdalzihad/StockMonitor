<p align="center">
  <img src="chrome-extension/icons/icon-128.png" alt="StockNow Logo" width="80" height="80">
</p>

<h1 align="center">StockNow Pro</h1>
<p align="center">
  <strong>Real-time DSE stock monitoring suite for Dhaka Stock Exchange investors</strong>
</p>

<p align="center">
  <a href="#chrome-extension"><img src="https://img.shields.io/badge/Chrome-Extension-4285F4?logo=googlechrome&logoColor=white" alt="Chrome Extension"></a>
  <a href="#desktop-widget"><img src="https://img.shields.io/badge/Desktop-Widget-blueviolet?logo=linux&logoColor=white" alt="Desktop Widget"></a>
  <img src="https://img.shields.io/badge/Manifest-V3-green" alt="Manifest V3">
  <img src="https://img.shields.io/badge/License-MIT-blue" alt="License">
</p>

---

## Overview

StockNow Pro is a multi-platform toolkit for tracking Dhaka Stock Exchange (DSE) stocks. It pulls live market data from the StockNow Bangladesh API and presents it through two purpose-built clients:

| Platform | Description |
|----------|-------------|
| **Chrome Extension** | Browser-integrated popup, side panel, and full dashboard |
| **Desktop Widget** | Frameless PyQt6 sticky widget for Linux & macOS |

---

## Chrome Extension

> **Location:** [`chrome-extension/`](chrome-extension/)

### Features

#### 📊 Market Dashboard
- **Live watchlist** with auto-refreshing prices, change %, volume, and sparkline charts
- **Market indices** (DSEX, DSES, DS30) with real-time tracking
- **Autocomplete search** across 400+ DSE-listed instruments
- **Multiple watchlists** — create, rename, and manage separate lists

#### 📈 Technical Analysis
- Embedded **TradingView charts** with configurable intervals (1m to Monthly)
- **Grid and list** layout modes for multi-chart comparison
- **Momentum scanner** with calculated signals (Strong Buy → Strong Sell)

#### 💼 Portfolio Tracker
- **Transaction history** — log buy/sell trades with date, price, quantity, and commission
- **Weighted-average P/L** — Realised, Unrealised, and Total Profit/Loss per stock
- **Sortable & filterable** portfolio table with search
- **Pie chart** visualisation of portfolio allocation
- **Import/export** transaction history as JSON

#### 🔔 Price Alerts
- Set custom **price threshold alerts** (above/below/at target)
- **Desktop notifications** when alerts trigger
- Configurable polling interval (1–60 minutes)

#### 🎨 UI & UX
- **Light & dark themes** — auto-switches based on system preference
- **Three view modes** — Popup, Side Panel, and full-page Dashboard
- **SVG sparklines** for price trends (365d → close)
- Responsive, premium design with glassmorphism and micro-animations

### Installation

1. Open **Chrome** → `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `chrome-extension/` folder

### Screenshots

| Popup View | Dashboard |
|:----------:|:---------:|
| Compact toolbar view | Full analytics dashboard |

---

## Desktop Widget

> **Location:** [`linux-sticky/`](linux-sticky/)

A standalone, frameless desktop widget built with Python and PyQt6. Designed to float on your desktop like a sticky note with live stock data.

### Features

- **Frameless & translucent** — glassmorphism QSS theme
- **Draggable** — click-and-drag; position saved to `config.json` automatically
- **Background fetching** — QThread-based, zero UI lag
- **Expandable rows** — click any stock to see Open, High, Low, YCP, Volume
- **Price alerts** — native OS notifications + Google Chat webhook support
- **Configurable refresh** — 1 to 60 minute intervals

### Running

Requires [`uv`](https://github.com/astral-sh/uv) (Python tool manager):

```bash
uv run linux-sticky/widget.py
```

Dependencies (PyQt6, requests) are fetched automatically on first run.

---

## Project Structure

```
StockNow-Pro/
├── chrome-extension/
│   ├── manifest.json          # Chrome Extension manifest (V3)
│   ├── app.js                 # Core application logic (~2200 lines)
│   ├── app.css                # Themes, layouts, and component styles
│   ├── dashboard.html         # Full-page analytics dashboard
│   ├── popup.html             # Toolbar popup view
│   ├── sidepanel.html         # Browser side panel view
│   ├── background.js          # Service worker (alarms, alerts, polling)
│   ├── icons/                 # Extension icons (16, 48, 128px)
│   └── generate_icons.py      # Icon generator script (Pillow)
├── linux-sticky/
│   ├── widget.py              # PyQt6 desktop widget
│   └── config.json            # Widget settings and alert rules
└── README.md
```

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Extension UI | Vanilla HTML/CSS/JS |
| Charts | TradingView Widget |
| Data Source | [StockNow Bangladesh API](https://stocknow.com.bd) |
| Storage | `chrome.storage.local` |
| Notifications | Chrome Notifications API |
| Desktop Widget | Python 3, PyQt6 |
| Package Manager | `uv` (for desktop widget) |

---

## API

All market data is sourced from the **StockNow Bangladesh API**:

```
GET https://stocknow.com.bd/api/data
```

Returns live DSE instrument data including close, YCP, high, low, volume, and moving averages (30d, 365d).

---

## License

MIT © [Md. Al Zihad](https://github.com/mdalzihad)
