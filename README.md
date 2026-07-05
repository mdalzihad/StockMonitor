# StockNow Watchlist Projects

This workspace contains two premium client utilities to track and monitor Dhaka Stock Exchange (DSE) stock watchlists with real-time data from the StockNow Bangladesh API:

1. **Chrome Extension (Popup + Side Panel)**: A browser-integrated client.
2. **Desktop Sticky Widget (Linux + macOS)**: A frameless, transparent widget for your desktop.

---

## 1. Chrome Extension (Popup + Side Panel)

Located in the [chrome-extension/](file:///home/zihad/StockTracker/chrome-extension) directory.

### Key Features
* **Dual-Mode UI**: Quick toolbar Popup dashboard that can be "docked" directly into a persistent Side Panel.
* **Auto-Switching Light & Dark Themes**: Matches your browser's preference dynamically using CSS variables and media queries.
* **SVG Sparklines**: Chronological price trends (`365d` to `close`) rendered using SVG paths and transparent gradients.
* **Autocomplete Search**: Instantly look up and add any of the DSE's 400+ stocks by code or name.
* **Storage Sync**: Watchlists and cache are saved in `chrome.storage.local`.

### How to Install
1. Open **Google Chrome** and navigate to `chrome://extensions/`.
2. Toggle on **Developer mode** (top-right).
3. Click the **Load unpacked** button (top-left).
4. Select the directory: `/home/zihad/StockTracker/chrome-extension`.

---

## 2. Desktop Sticky Widget (Linux + macOS)

Located in the [linux-sticky/](file:///home/zihad/StockTracker/linux-sticky) directory.

This is a standalone, frameless desktop widget written in Python and PyQt6. It acts like a sticky note on your desktop, staying on top of other windows and updating stock prices in the background.

### Key Features
* **Frameless & Translucent**: Sleek glassmorphism QSS theme designed to float cleanly on your wallpaper.
* **Interactive Dragging**: Left-click and hold anywhere on the card to drag the widget. It automatically saves its coordinates `(x, y)` to `config.json` and restores them on launch.
* **Background Fetching**: Uses a responsive Qt Thread (`QThread`) to request StockNow data in the background, keeping the window completely lag-free.
* **Watchlist Manager**: Right-click the widget to open settings and configure which stocks to track.
* **Click to Expand Tickers**: Click on any stock row to expand/collapse detailed statistics inline (Open, High, Low, YCP, and Volume). The widget dynamically wraps its height.
* **Price Alerts & Notifications**: Add custom price threshold alerts (e.g., notify if `GP` is above `300`). Triggering alerts sends:
  * **Native OS Notifications**: Desktop banner alerts (via AppleScript on macOS, or `notify-send` on Linux).
  * **Google Workspace Notifications**: Real-time message alerts posted to a specific Google Chat space using an **Incoming Webhook URL** (enable and configure this in the settings panel).
  Alerts are one-shot to prevent notification spamming.
* **Configurable Refresh**: Adjust refresh loops directly from 1 to 60 minutes.

### How to Run
The widget uses the `uv` Python tool manager to run in an isolated environment without polluting your global system packages.

Navigate to the project root and execute:
```bash
uv run linux-sticky/widget.py
```
*(Dependencies like PyQt6 and requests will be fetched and cached automatically on the first run).*

---

## Workspace Structure

- [chrome-extension/](file:///home/zihad/StockTracker/chrome-extension) — Browser extension source.
- [linux-sticky/](file:///home/zihad/StockTracker/linux-sticky) — Python PyQt6 desktop widget source.
- [linux-sticky/widget.py](file:///home/zihad/StockTracker/linux-sticky/widget.py) — Core widget codebase.
- [linux-sticky/config.json](file:///home/zihad/StockTracker/linux-sticky/config.json) — Sticky widget configurations and alerts.
