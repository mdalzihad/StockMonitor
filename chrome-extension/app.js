// Extension Global State
let state = {
  instruments: {}, // Dict of symbols from API
  watchlists: [],  // Array of watchlists: [{id, name, symbols: []}]
  activeId: '',    // Current active watchlist ID
  isLoading: false,
  showCharts: true, // Default to true
  portfolio: {},   // Symbol-keyed: {symbol, buyPrice, quantity}
  history: [],     // Array of transactions: {id, date, symbol, type, count, price, commission}
  currentView: 'market', // For dashboard: market, portfolio, momentum, history
  chartLayout: 'list',   // Default to list (one per row)
  isDashboard: document.body.classList.contains('dashboard-body')
};

// Initialize the Application
document.addEventListener("DOMContentLoaded", async () => {
  setupEventListeners();
  await loadStateFromStorage();
  
  // Try loading from cache first for instant UI response
  const cacheLoaded = await loadCachedData();
  if (cacheLoaded) {
    renderUI();
  }
  
  // Always fetch fresh data on open
  await fetchFreshData();

  // Start the countdown timer for the next background update
  startNextUpdateTimer();

  // Listen for storage changes from background updates (e.g. periodic fetches)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local") {
      if (changes.instrumentsData) {
        state.instruments = changes.instrumentsData.newValue;
        renderUI();
      }
      if (changes.watchlists) {
        state.watchlists = changes.watchlists.newValue;
        renderUI();
      }
      if (changes.activeWatchlistId) {
        state.activeId = changes.activeWatchlistId.newValue;
        renderUI();
      }
      if (changes.showCharts) {
        state.showCharts = changes.showCharts.newValue;
        renderUI();
      }
      if (changes.alerts) {
        // Re-render alerts list in settings modal if active
        const settingsModal = document.getElementById("settings-modal");
        if (settingsModal && settingsModal.classList.contains("active")) {
          renderAlertsList();
        }
      }
    }
  });
});

// Load Watchlists & Active Selection from chrome.storage.local
async function loadStateFromStorage() {
  const data = await chrome.storage.local.get(["watchlists", "activeWatchlistId", "showCharts", "portfolio", "transactionHistory"]);
  
  if (data.showCharts !== undefined) {
    state.showCharts = data.showCharts;
  }

  if (data.portfolio) {
    state.portfolio = data.portfolio;
  }

  if (data.transactionHistory) {
    state.history = data.transactionHistory;
  }

  if (data.watchlists && data.watchlists.length > 0) {
    state.watchlists = data.watchlists;
    state.activeId = data.activeWatchlistId || data.watchlists[0].id;
  } else {
    // Default initial watchlist
    const defaultList = {
      id: "default-list",
      name: "My Watchlist",
      symbols: ["SQURPHARMA", "ITC", "MARICO", "ROBI", "GP", "OLYMPIC", "BSRMSTEEL"]
    };
    state.watchlists = [defaultList];
    state.activeId = defaultList.id;
    await saveWatchlistsToStorage();
  }
}

// Save Watchlists to chrome.storage.local
async function saveWatchlistsToStorage() {
  await chrome.storage.local.set({
    watchlists: state.watchlists,
    activeWatchlistId: state.activeId,
    portfolio: state.portfolio,
    transactionHistory: state.history
  });
}

// Load cached API data
async function loadCachedData() {
  const cache = await chrome.storage.local.get(["instrumentsData", "instrumentsCachedAt"]);
  if (cache.instrumentsData) {
    state.instruments = cache.instrumentsData;
    // Show cache time in logs or UI if needed
    console.log("Loaded instruments from local cache. Cached at:", new Date(cache.instrumentsCachedAt));
    updateLastReloadTime(cache.instrumentsCachedAt);
    return true;
  }
  return false;
}

// Fetch fresh instrument data from StockNow API
async function fetchFreshData() {
  setLoadingState(true);
  
  try {
    const response = await fetch("https://stocknow.com.bd/api/v1/instruments", {
      method: "GET",
      headers: {
        "Accept": "application/json"
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP Error: ${response.status}`);
    }
    
    const data = await response.json();
    state.instruments = data;
    
    const now = Date.now();
    // Save to local cache
    await chrome.storage.local.set({
      instrumentsData: data,
      instrumentsCachedAt: now
    });
    
    updateLastReloadTime(now);
    startNextUpdateTimer();
    
    // Check price target alerts locally
    await checkAlertsLocal(data);
    
    renderUI();
  } catch (error) {
    console.error("Error fetching stock data:", error);
    // If no cache, show error state
    if (Object.keys(state.instruments).length === 0) {
      renderErrorState("Failed to fetch live stock data. Please check your internet connection.");
    }
  } finally {
    setLoadingState(false);
  }
}

// Set Loading spinner state
function setLoadingState(isLoading) {
  state.isLoading = isLoading;
  const refreshBtn = document.getElementById("refresh-btn");
  if (refreshBtn) {
    if (isLoading) {
      refreshBtn.classList.add("active");
    } else {
      refreshBtn.classList.remove("active");
    }
  }
  
  const syncIcon = document.querySelector(".sync-icon");
  if (syncIcon) {
    if (isLoading) {
      syncIcon.classList.add("syncing");
    } else {
      syncIcon.classList.remove("syncing");
    }
  }
}

// Setup Event Listeners
function setupEventListeners() {
  // Refresh Button
  document.getElementById("refresh-btn")?.addEventListener("click", async () => {
    if (!state.isLoading) {
      await fetchFreshData();
    }
  });

  // Watchlist Select Dropdown
  const select = document.getElementById("select-watchlist");
  select?.addEventListener("change", async (e) => {
    state.activeId = e.target.value;
    await saveWatchlistsToStorage();
    renderUI();
  });

  // Search Input (Autocompletion)
  const searchInput = document.getElementById("search-input");
  searchInput?.addEventListener("input", (e) => {
    handleSearch(e.target.value);
  });

  // Close search list on clicking outside
  document.addEventListener("click", (e) => {
    const searchResults = document.getElementById("search-results");
    const searchInputWrapper = document.querySelector(".search-input-wrapper") || document.querySelector(".search-bar");
    if (searchResults && searchInputWrapper && !searchInputWrapper.contains(e.target) && !searchResults.contains(e.target)) {
      searchResults.classList.remove("active");
    }
  });

  // Dock to Side Panel Button (popup only)
  document.getElementById("dock-sidepanel-btn")?.addEventListener("click", async () => {
    try {
      const currentWindow = await chrome.windows.getCurrent();
      if (chrome.sidePanel) {
        await chrome.sidePanel.open({ windowId: currentWindow.id });
        window.close(); // Close the popup
      }
    } catch (error) {
      console.error("Failed to open side panel:", error);
    }
  });

  // Open Full Dashboard Button (popup/sidepanel)
  document.getElementById("open-dashboard-btn")?.addEventListener("click", () => {
    chrome.tabs.create({ url: 'dashboard.html' });
  });

  // Dashboard Navigation Listeners
  if (state.isDashboard) {
    document.querySelectorAll(".nav-item[data-view]").forEach(btn => {
      btn.addEventListener("click", () => {
        const view = btn.dataset.view;
        switchDashboardView(view);
      });
    });

    document.getElementById("portfolio-modal-close")?.addEventListener("click", () => {
      document.getElementById("portfolio-modal")?.classList.remove("active");
    });

    document.getElementById("portfolio-save-btn")?.addEventListener("click", async () => {
      await savePortfolioHolding();
    });
    
    document.getElementById("sort-selector")?.addEventListener("change", (e) => {
      renderDashboardUI();
    });

    document.getElementById("add-holding-btn")?.addEventListener("click", () => {
      const searchInput = document.getElementById("search-input");
      if (searchInput) {
        searchInput.focus();
        searchInput.placeholder = "Search stock to add to portfolio...";
        setTimeout(() => {
          searchInput.placeholder = "Search instruments...";
        }, 3000);
      }
    });

    document.getElementById("go-to-history-btn")?.addEventListener("click", () => {
       switchDashboardView('history');
    });

    document.getElementById("history-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      await addTransactionFromForm();
    });

    document.getElementById("clear-history-btn")?.addEventListener("click", async () => {
      if (confirm("Are you sure you want to clear all transaction history?")) {
        state.history = [];
        await saveWatchlistsToStorage();
        renderDashboardUI();
      }
    });

    // Set default date to today
    const dateInput = document.getElementById("hist-date");
    if (dateInput) {
      dateInput.valueAsDate = new Date();
    }
  }

  // Watchlist Manager Modal Elements
  const manageBtn = document.getElementById("manage-watchlists-btn");
  const modal = document.getElementById("watchlist-modal");
  const modalClose = document.getElementById("modal-close-btn");
  const modalCancel = document.getElementById("modal-cancel-btn");
  const createListBtn = document.getElementById("create-watchlist-btn");
  const newListNameInput = document.getElementById("new-watchlist-name");

  manageBtn?.addEventListener("click", () => {
    renderModalWatchlists();
    modal?.classList.add("active");
  });

  const closeModal = () => {
    modal?.classList.remove("active");
    if (newListNameInput) newListNameInput.value = "";
  };

  modalClose?.addEventListener("click", closeModal);
  modalCancel?.addEventListener("click", closeModal);

  createListBtn?.addEventListener("click", async () => {
    const name = newListNameInput?.value.trim();
    if (!name) return;

    const newList = {
      id: "list-" + Date.now(),
      name: name,
      symbols: []
    };

    state.watchlists.push(newList);
    state.activeId = newList.id;
    await saveWatchlistsToStorage();
    
    closeModal();
    renderUI();
  });

  // Detail Drawer Close Elements
  document.getElementById("drawer-close-btn")?.addEventListener("click", () => {
    document.getElementById("detail-drawer")?.classList.remove("active");
  });

  // Settings & Alerts Modal triggers
  const settingsBtn = document.getElementById("settings-alerts-btn");
  const settingsModal = document.getElementById("settings-modal");
  const settingsCloseBtn = document.getElementById("settings-close-btn");
  const settingsSaveBtn = document.getElementById("settings-save-btn");
  const addAlertBtn = document.getElementById("add-alert-btn");

  settingsBtn?.addEventListener("click", async () => {
    await openSettingsModal();
  });

  const closeSettingsModal = () => {
    settingsModal?.classList.remove("active");
  };

  settingsCloseBtn?.addEventListener("click", closeSettingsModal);

  settingsSaveBtn?.addEventListener("click", async () => {
    const selectInterval = document.getElementById("polling-interval-select");
    const gchatCheckbox = document.getElementById("gchat-alerts-enable");
    const gchatInput = document.getElementById("gchat-webhook-input");
    const telegramCheckbox = document.getElementById("telegram-alerts-enable");
    const telegramTokenInput = document.getElementById("telegram-token-input");
    const telegramChatIdInput = document.getElementById("telegram-chatid-input");
    const chartsCheckbox = document.getElementById("show-charts-enable");
    
    const saveObj = {};
    if (selectInterval) {
      saveObj.pollingInterval = parseInt(selectInterval.value);
    }
    if (chartsCheckbox) {
      saveObj.showCharts = chartsCheckbox.checked;
      state.showCharts = chartsCheckbox.checked;
    }
    if (gchatCheckbox) {
      saveObj.enableGoogleChat = gchatCheckbox.checked;
    }
    if (gchatInput) {
      saveObj.googleChatWebhookUrl = gchatInput.value.trim();
    }
    if (telegramCheckbox) {
      saveObj.enableTelegram = telegramCheckbox.checked;
    }
    if (telegramTokenInput) {
      saveObj.telegramBotToken = telegramTokenInput.value.trim();
    }
    if (telegramChatIdInput) {
      saveObj.telegramChatId = telegramChatIdInput.value.trim();
    }
    await chrome.storage.local.set(saveObj);
    closeSettingsModal();
  });

  addAlertBtn?.addEventListener("click", async () => {
    await addAlert();
  });

  const telegramTestBtn = document.getElementById("telegram-test-btn");
  telegramTestBtn?.addEventListener("click", async () => {
    const tokenInput = document.getElementById("telegram-token-input");
    const chatIdInput = document.getElementById("telegram-chatid-input");
    
    if (!tokenInput || !chatIdInput) return;
    
    const botToken = tokenInput.value.trim();
    const chatId = chatIdInput.value.trim();
    
    if (!botToken || !chatId) {
      alert("Please enter both Bot Token and Chat ID to test.");
      return;
    }
    
    telegramTestBtn.innerText = "Sending Test...";
    telegramTestBtn.disabled = true;
    telegramTestBtn.style.backgroundColor = "";
    telegramTestBtn.style.color = "";
    
    chrome.runtime.sendMessage({
      action: "send-telegram-notification",
      botToken: botToken,
      chatId: chatId,
      messageText: "🔔 *StockNow Connection Test*\n\nYour Telegram bot is configured correctly and alert notifications are working!"
    }, (response) => {
      if (chrome.runtime.lastError) {
        showTestResult(false, "Connection Error");
        console.error(chrome.runtime.lastError.message);
        return;
      }
      
      if (response && response.success) {
        showTestResult(true, "Test Sent! Check Chat");
      } else {
        const err = (response && response.error) ? response.error : "Failed to Send";
        console.error("Telegram connection test failed:", err);
        showTestResult(false, err.length > 20 ? err.substring(0, 18) + "..." : err);
      }
    });

    function showTestResult(success, msg) {
      telegramTestBtn.innerText = msg;
      telegramTestBtn.style.backgroundColor = success ? "#059669" : "#dc2626"; // Green vs Red
      telegramTestBtn.style.color = "white";
      
      setTimeout(() => {
        telegramTestBtn.innerText = "Test Bot Connection";
        telegramTestBtn.disabled = false;
        telegramTestBtn.style.backgroundColor = "";
        telegramTestBtn.style.color = "";
      }, 4000);
    }
  });
}

// Perform Search filtering
function handleSearch(query) {
  const resultsContainer = document.getElementById("search-results");
  if (!resultsContainer) return;

  const sanitizedQuery = query.trim().toUpperCase();
  if (!sanitizedQuery) {
    resultsContainer.classList.remove("active");
    return;
  }

  // Search in all instrument keys and names
  const matches = [];
  const keys = Object.keys(state.instruments);
  
  for (let i = 0; i < keys.length; i++) {
    const symbol = keys[i];
    const details = state.instruments[symbol];
    const name = details.name || "";
    
    if (symbol.includes(sanitizedQuery) || name.toUpperCase().includes(sanitizedQuery)) {
      matches.push({ symbol, name });
    }
    if (matches.length >= 15) break; // Limit to 15 search results
  }

  if (matches.length === 0) {
    resultsContainer.innerHTML = `<div class="search-item" style="cursor: default; font-size: 12px; color: var(--text-muted);">No results found</div>`;
  } else {
    const activeList = state.watchlists.find(l => l.id === state.activeId);
    const activeSymbols = activeList ? activeList.symbols : [];

    resultsContainer.innerHTML = matches.map(match => {
      const isAdded = activeSymbols.includes(match.symbol);
      return `
        <div class="search-item" data-symbol="${match.symbol}">
          <div class="search-item-info">
            <span class="search-item-code">${match.symbol}</span>
            <span class="search-item-name">${match.name}</span>
          </div>
          <div class="search-item-actions" style="display:flex; gap: 8px;">
            ${state.isDashboard ? `
              <button class="btn-secondary btn-search-portfolio" data-symbol="${match.symbol}" style="padding: 4px 8px; font-size: 10px;">
                + Portfolio
              </button>
            ` : ''}
            <button class="btn-add-stock ${isAdded ? 'added' : ''}" data-symbol="${match.symbol}" ${isAdded ? 'disabled' : ''}>
              ${isAdded ? 'Added' : 'Add'}
            </button>
          </div>
        </div>
      `;
    }).join("");

    // Add click handlers for the Portfolio buttons (Dashboard only)
    if (state.isDashboard) {
      resultsContainer.querySelectorAll(".btn-search-portfolio").forEach(btn => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const symbol = btn.dataset.symbol;
          resultsContainer.classList.remove("active");
          openPortfolioEdit(symbol);
        });
      });
    }

    // Add click handlers for the Add buttons
    resultsContainer.querySelectorAll(".btn-add-stock").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const symbol = btn.dataset.symbol;
        await addSymbolToActiveWatchlist(symbol);
        btn.classList.add("added");
        btn.innerText = "Added";
        btn.disabled = true;
        
        // Clear search input
        const searchInput = document.getElementById("search-input");
        if (searchInput) searchInput.value = "";
        resultsContainer.classList.remove("active");
      });
    });

    // Add click handler for list items to show detailed stats
    resultsContainer.querySelectorAll(".search-item").forEach(item => {
      item.addEventListener("click", () => {
        const symbol = item.dataset.symbol;
        if (state.instruments[symbol]) {
          showStockDetails(symbol, state.instruments[symbol]);
        }
      });
    });
  }

  resultsContainer.classList.add("active");
}

// Add stock to active watchlist
async function addSymbolToActiveWatchlist(symbol) {
  const activeList = state.watchlists.find(l => l.id === state.activeId);
  if (activeList && !activeList.symbols.includes(symbol)) {
    activeList.symbols.push(symbol);
    await saveWatchlistsToStorage();
    renderUI();
  }
}

// Remove stock from active watchlist
async function removeSymbolFromActiveWatchlist(symbol) {
  const activeList = state.watchlists.find(l => l.id === state.activeId);
  if (activeList) {
    activeList.symbols = activeList.symbols.filter(s => s !== symbol);
    await saveWatchlistsToStorage();
    renderUI();
  }
}

// Render the Watchlist selector dropdown
function renderWatchlistSelector() {
  const select = document.getElementById("select-watchlist");
  if (!select) return;

  select.innerHTML = state.watchlists.map(list => {
    return `<option value="${list.id}" ${list.id === state.activeId ? 'selected' : ''}>${list.name}</option>`;
  }).join("");
}

// Render List of Watchlists in Management Modal
function renderModalWatchlists() {
  const container = document.getElementById("watchlist-management-list");
  if (!container) return;

  container.innerHTML = state.watchlists.map(list => {
    const canDelete = state.watchlists.length > 1;
    return `
      <div class="management-list-item">
        <span>${list.name} (${list.symbols.length} stocks)</span>
        ${canDelete ? `
          <button class="btn-delete-list" data-id="${list.id}">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2M10 11v6M14 11v6"/></svg>
          </button>
        ` : ''}
      </div>
    `;
  }).join("");

  // Add delete listeners
  container.querySelectorAll(".btn-delete-list").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      state.watchlists = state.watchlists.filter(l => l.id !== id);
      if (state.activeId === id) {
        state.activeId = state.watchlists[0].id;
      }
      await saveWatchlistsToStorage();
      renderModalWatchlists();
      renderUI();
    });
  });
}

// Generate an SVG Sparkline Path and return the SVG string
function generateSparklineSVG(symbol, data, isPositive) {
  // Extract historical prices: 365d, 180d, 90d, 30d, 15d, 7d, ycp, close
  const keys = ['365d', '180d', '90d', '30d', '15d', '7d', 'ycp', 'close'];
  let points = [];
  
  keys.forEach(k => {
    const val = parseFloat(data[k]);
    if (!isNaN(val) && val > 0) {
      points.push(val);
    }
  });

  if (points.length < 2) {
    // If not enough data, return a flat line using ycp and close
    const ycp = parseFloat(data.ycp) || parseFloat(data.close) || 0;
    const close = parseFloat(data.close) || 0;
    points = [ycp, close];
  }

  const width = 80;
  const height = 30;
  const padding = 2;

  const min = Math.min(...points);
  const max = Math.max(...points);
  const diff = max - min === 0 ? 1 : max - min;

  // Compute points mapped to coordinates
  const coords = points.map((val, index) => {
    const x = (index / (points.length - 1)) * (width - 2 * padding) + padding;
    const y = height - padding - ((val - min) / diff) * (height - 2 * padding);
    return { x, y };
  });

  // Construct stroke path
  const linePath = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(" ");

  // Construct filled area path
  const fillPath = `${linePath} L ${coords[coords.length - 1].x.toFixed(1)} ${height} L ${coords[0].x.toFixed(1)} ${height} Z`;

  // Color theme variables
  const color = isPositive ? 'var(--green)' : 'var(--red)';
  const gradientId = `gradient-${symbol.replace(/[^a-zA-Z0-9]/g, '')}`;

  return `
    <svg class="sparkline-svg" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${color}" stop-opacity="0.25" />
          <stop offset="100%" stop-color="${color}" stop-opacity="0" />
        </linearGradient>
      </defs>
      <path d="${fillPath}" fill="url(#${gradientId})" />
      <path d="${linePath}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  `;
}

// Render the main dashboard content
function renderUI() {
  if (state.isDashboard) {
    renderDashboardUI();
    return;
  }
  
  renderWatchlistSelector();
  
  const activeList = state.watchlists.find(l => l.id === state.activeId);
  const dashboard = document.getElementById("dashboard-content");
  if (!dashboard) return;

  if (!activeList || activeList.symbols.length === 0) {
    dashboard.innerHTML = `
      <div class="empty-container">
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <div class="empty-text">This watchlist is empty</div>
        <div class="empty-subtext">Use the search bar above to search and add stock instruments.</div>
      </div>
    `;
    return;
  }

  // Generate Stock Cards
  dashboard.innerHTML = activeList.symbols.map(symbol => {
    const data = state.instruments[symbol];
    if (!data) {
      // Loading or unavailable details
      return `
        <div class="stock-card" data-symbol="${symbol}">
          <div class="stock-info">
            <div class="stock-header">
              <span class="stock-code">${symbol}</span>
            </div>
            <span class="stock-name">Data unavailable</span>
          </div>
          <div class="stock-metrics">
            <span class="stock-price">—</span>
            <span class="stock-change neutral">Pending...</span>
          </div>
          <button class="btn-delete-card" data-symbol="${symbol}">✕</button>
        </div>
      `;
    }

    const price = parseFloat(data.close) || 0;
    const ycp = parseFloat(data.ycp) || 0;
    const change = price - ycp;
    const changePercent = ycp ? (change / ycp) * 100 : 0;
    const isPositive = change >= 0;
    const changeSign = change > 0 ? "+" : "";

    // Draw sparkline
    const sparklineHTML = state.showCharts ? generateSparklineSVG(symbol, data, isPositive) : "";

    // Format Volume nicely (e.g. 1.2M or 450K)
    const rawVolume = parseInt(data.volume) || 0;
    let formattedVolume = rawVolume.toLocaleString();
    if (rawVolume >= 1000000) {
      formattedVolume = (rawVolume / 1000000).toFixed(2) + "M";
    } else if (rawVolume >= 1000) {
      formattedVolume = (rawVolume / 1000).toFixed(1) + "K";
    }

    return `
      <div class="stock-card" data-symbol="${symbol}">
        <div class="stock-info">
          <div class="stock-header">
            <span class="stock-code">${symbol}</span>
            <span class="stock-category">${data.category || 'N/A'}</span>
          </div>
          <span class="stock-name" title="${data.name || ''}">${data.name || ''}</span>
        </div>
        
        <div class="stock-sparkline" style="${state.showCharts ? '' : 'display:none;'}">
          ${sparklineHTML}
        </div>

        <div class="stock-metrics">
          <span class="stock-price">${price.toFixed(2)}</span>
          <span class="stock-change ${change > 0 ? 'positive' : (change < 0 ? 'negative' : 'neutral')}">
            ${changeSign}${change.toFixed(2)} (${changeSign}${changePercent.toFixed(2)}%)
          </span>
        </div>
        
        <button class="btn-delete-card" data-symbol="${symbol}">✕</button>
      </div>
    `;
  }).join("");

  // Card interaction listeners
  dashboard.querySelectorAll(".stock-card").forEach(card => {
    card.addEventListener("click", () => {
      const symbol = card.dataset.symbol;
      if (state.instruments[symbol]) {
        showStockDetails(symbol, state.instruments[symbol]);
      }
    });
  });

  // Delete card listeners
  dashboard.querySelectorAll(".btn-delete-card").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation(); // Avoid triggering details card open
      const symbol = btn.dataset.symbol;
      await removeSymbolFromActiveWatchlist(symbol);
    });
  });
}

// Render Error State inside the dashboard
function renderErrorState(message) {
  const dashboard = document.getElementById("dashboard-content");
  if (!dashboard) return;
  dashboard.innerHTML = `
    <div class="empty-container">
      <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--red)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/></svg>
      <div class="empty-text" style="color: var(--red);">${message}</div>
      <button class="btn-secondary" id="retry-btn" style="margin-top: 8px;">Retry Connection</button>
    </div>
  `;

  document.getElementById("retry-btn")?.addEventListener("click", async () => {
    await fetchFreshData();
  });
}

// Display details of clicked stock in drawer
function showStockDetails(symbol, data) {
  const drawer = document.getElementById("detail-drawer");
  if (!drawer) return;

  const ycp = parseFloat(data.ycp) || 0;
  const close = parseFloat(data.close) || 0;
  const change = close - ycp;
  const changePercent = ycp ? (change / ycp) * 100 : 0;
  const isPositive = change >= 0;
  const changeSign = change > 0 ? "+" : "";

  document.getElementById("drawer-code").innerText = symbol;
  document.getElementById("drawer-name").innerText = data.name || "N/A";
  
  // Custom format the values inside the grid
  document.getElementById("stat-close").innerText = close.toFixed(2);
  
  const changeBadge = document.getElementById("stat-change");
  changeBadge.innerText = `${changeSign}${change.toFixed(2)} (${changeSign}${changePercent.toFixed(2)}%)`;
  changeBadge.className = `drawer-grid-value stock-change ${change > 0 ? 'positive' : (change < 0 ? 'negative' : 'neutral')}`;

  document.getElementById("stat-open").innerText = (parseFloat(data.open) || 0).toFixed(2);
  document.getElementById("stat-high").innerText = (parseFloat(data.high) || 0).toFixed(2);
  document.getElementById("stat-low").innerText = (parseFloat(data.low) || 0).toFixed(2);
  document.getElementById("stat-ycp").innerText = ycp.toFixed(2);
  
  document.getElementById("stat-volume").innerText = (parseInt(data.volume) || 0).toLocaleString();
  document.getElementById("stat-value").innerText = data.value ? parseFloat(data.value).toFixed(2) + "M" : "—";
  document.getElementById("stat-category").innerText = data.category || "N/A";
  document.getElementById("stat-sector").innerText = data.sector_id || "N/A";
  document.getElementById("stat-updated").innerText = data.updated_at || "N/A";

  drawer.classList.add("active");
}

// Load and display settings modal data
async function openSettingsModal() {
  const settingsModal = document.getElementById("settings-modal");
  const selectInterval = document.getElementById("polling-interval-select");
  const symbolSelect = document.getElementById("alert-symbol-select");
  const gchatCheckbox = document.getElementById("gchat-alerts-enable");
  const gchatInput = document.getElementById("gchat-webhook-input");
  const telegramCheckbox = document.getElementById("telegram-alerts-enable");
  const telegramTokenInput = document.getElementById("telegram-token-input");
  const telegramChatIdInput = document.getElementById("telegram-chatid-input");
  const chartsCheckbox = document.getElementById("show-charts-enable");

  if (!settingsModal) return;

  // Load refresh interval, Google Chat Webhook, and Telegram settings
  const { pollingInterval, enableGoogleChat, googleChatWebhookUrl, enableTelegram, telegramBotToken, telegramChatId, showCharts } = await chrome.storage.local.get([
    "pollingInterval", "enableGoogleChat", "googleChatWebhookUrl", "enableTelegram", "telegramBotToken", "telegramChatId", "showCharts"
  ]);

  if (selectInterval) {
    selectInterval.value = pollingInterval !== undefined ? pollingInterval : 1;
  }
  if (chartsCheckbox) {
    chartsCheckbox.checked = showCharts !== undefined ? showCharts : true;
  }
  if (gchatCheckbox) {
    gchatCheckbox.checked = !!enableGoogleChat;
  }
  if (gchatInput) {
    gchatInput.value = googleChatWebhookUrl || "";
  }
  if (telegramCheckbox) {
    telegramCheckbox.checked = !!enableTelegram;
  }
  if (telegramTokenInput) {
    telegramTokenInput.value = telegramBotToken || "";
  }
  if (telegramChatIdInput) {
    telegramChatIdInput.value = telegramChatId || "";
  }

  // Populate alert symbol options with active watchlist stocks, or first 20 instruments
  if (symbolSelect) {
    const activeList = state.watchlists.find(l => l.id === state.activeId);
    let optionsSymbols = [];
    if (activeList && activeList.symbols.length > 0) {
      optionsSymbols = activeList.symbols;
    } else {
      optionsSymbols = Object.keys(state.instruments).slice(0, 20);
    }

    symbolSelect.innerHTML = optionsSymbols.map(sym => {
      return `<option value="${sym}">${sym}</option>`;
    }).join("");
  }

  // Render active alerts
  await renderAlertsList();

  settingsModal.classList.add("active");
}

// Render active price alerts list
async function renderAlertsList() {
  const container = document.getElementById("alerts-list-container");
  if (!container) return;

  const { alerts } = await chrome.storage.local.get("alerts");
  if (!alerts || alerts.length === 0) {
    container.innerHTML = `<div class="management-list-item" style="color: var(--text-muted); font-size: 11px; justify-content: center;">No active alerts</div>`;
    return;
  }

  container.innerHTML = alerts.map((alert, idx) => {
    const status = alert.triggered ? "Triggered" : "Armed";
    return `
      <div class="management-list-item">
        <span><strong>${alert.symbol}</strong> ${alert.condition} ${alert.value.toFixed(2)} (${status})</span>
        <button class="btn-delete-alert" data-index="${idx}" style="background:none; border:none; color:var(--red); cursor:pointer; display:flex; align-items:center; justify-content:center; padding:0;">
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2M10 11v6M14 11v6"/></svg>
        </button>
      </div>
    `;
  }).join("");

  // Add click handlers for delete buttons
  container.querySelectorAll(".btn-delete-alert").forEach(btn => {
    btn.addEventListener("click", async () => {
      const idx = parseInt(btn.dataset.index);
      await deleteAlert(idx);
    });
  });
}

// Create a new price alert
async function addAlert() {
  const symbolSelect = document.getElementById("alert-symbol-select");
  const condSelect = document.getElementById("alert-condition-select");
  const valueInput = document.getElementById("alert-value-input");

  if (!symbolSelect || !condSelect || !valueInput) return;

  const symbol = symbolSelect.value;
  const condition = condSelect.value;
  const value = parseFloat(valueInput.value);

  if (isNaN(value) || value <= 0) {
    alert("Please enter a valid price target.");
    return;
  }

  // Load, append, and save alerts
  const { alerts } = await chrome.storage.local.get("alerts");
  const activeAlerts = alerts || [];
  
  activeAlerts.push({
    symbol,
    condition,
    value,
    triggered: false
  });

  await chrome.storage.local.set({ alerts: activeAlerts });

  // Reset input and refresh UI
  valueInput.value = "";
  await renderAlertsList();

  // Instantly validate alerts against current cached data
  if (state.instruments && Object.keys(state.instruments).length > 0) {
    await checkAlertsLocal(state.instruments);
  }
}

// Delete price alert
async function deleteAlert(index) {
  const { alerts } = await chrome.storage.local.get("alerts");
  if (alerts && alerts[index] !== undefined) {
    alerts.splice(index, 1);
    await chrome.storage.local.set({ alerts });
    await renderAlertsList();
  }
}

// Check target alerts locally during fetches
async function checkAlertsLocal(data) {
  const { alerts, enableGoogleChat, googleChatWebhookUrl, enableTelegram, telegramBotToken, telegramChatId } = await chrome.storage.local.get([
    "alerts", "enableGoogleChat", "googleChatWebhookUrl", "enableTelegram", "telegramBotToken", "telegramChatId"
  ]);
  
  if (!alerts || alerts.length === 0) return;

  let alertsChanged = false;
  const updatedAlerts = alerts.map(alert => {
    if (alert.triggered) return alert;

    const details = data[alert.symbol];
    if (!details) return alert;

    const price = parseFloat(details.close) || 0;
    let isTriggered = false;

    if (alert.condition === "above" && price >= alert.value) {
      isTriggered = true;
    } else if (alert.condition === "below" && price <= alert.value) {
      isTriggered = true;
    }

    if (isTriggered) {
      alert.triggered = true;
      alertsChanged = true;
      
      const alertMsg = `${alert.symbol} is ${alert.condition} target ${alert.value.toFixed(2)}! Current price: ${price.toFixed(2)}`;

      // Trigger notification immediately
      chrome.notifications.create(`alert-${alert.symbol}-${Date.now()}`, {
        type: "basic",
        iconUrl: "icons/icon-48.png",
        title: `Stock Alert: ${alert.symbol}`,
        message: alertMsg,
        priority: 2
      });

      // Dispatch alert to Google Workspace Chat if enabled
      if (enableGoogleChat && googleChatWebhookUrl) {
        sendGoogleChatNotification(
          googleChatWebhookUrl,
          `Stock Alert: ${alert.symbol}`,
          alertMsg
        );
      }

      // Dispatch alert to Telegram if enabled
      if (enableTelegram && telegramBotToken && telegramChatId) {
        sendTelegramNotification(
          telegramBotToken,
          telegramChatId,
          `🔔 *Stock Alert: ${alert.symbol}*\n${alertMsg}`
        );
      }
    }
    return alert;
  });

  if (alertsChanged) {
    await chrome.storage.local.set({ alerts: updatedAlerts });
    // Re-render list if settings modal is active
    const settingsModal = document.getElementById("settings-modal");
    if (settingsModal && settingsModal.classList.contains("active")) {
      await renderAlertsList();
    }
  }
}

// Dispatch notification to Google Chat via background service worker delegation (bypassing CORS)
function sendGoogleChatNotification(webhookUrl, title, message) {
  if (!webhookUrl) return;
  chrome.runtime.sendMessage({
    action: "send-gchat-notification",
    webhookUrl: webhookUrl,
    title: title,
    messageText: message
  });
}

// Dispatch notification to Telegram via background service worker delegation (bypassing CORS)
function sendTelegramNotification(botToken, chatId, message) {
  if (!botToken || !chatId) return;
  chrome.runtime.sendMessage({
    action: "send-telegram-notification",
    botToken: botToken,
    chatId: chatId,
    messageText: message
  });
}

// Update the last reload time text in UI footer
function updateLastReloadTime(timestamp) {
  const timeSpan = document.getElementById("last-reload-time");
  if (!timeSpan || !timestamp) return;
  
  const date = new Date(timestamp);
  let hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  const timeStr = `${hours}:${minutes}:${seconds} ${ampm}`;
  timeSpan.innerText = timeStr;
}

// Manage the next update countdown timer in UI footer
let nextUpdateInterval = null;
function startNextUpdateTimer() {
  if (nextUpdateInterval) clearInterval(nextUpdateInterval);
  
  const updateTimerElement = () => {
    const timerSpan = document.getElementById("next-update-countdown");
    if (!timerSpan) return;
    
    chrome.alarms.get("fetch-data-alarm", (alarm) => {
      if (chrome.runtime.lastError || !alarm) {
        timerSpan.innerText = "Disabled";
        return;
      }
      
      const diffMs = alarm.scheduledTime - Date.now();
      if (diffMs <= 0) {
        timerSpan.innerText = "Syncing...";
        return;
      }
      
      const diffSecs = Math.ceil(diffMs / 1000);
      const mins = Math.floor(diffSecs / 60);
      const secs = diffSecs % 60;
      timerSpan.innerText = `${mins}m ${secs}s`;
    });
  };
  
  updateTimerElement();
  nextUpdateInterval = setInterval(updateTimerElement, 1000);
}

// =========================================
// DASHBOARD SPECIFIC LOGIC
// =========================================

function renderDashboardUI() {
  renderSidebarWatchlists();
  
  const activeList = state.watchlists.find(l => l.id === state.activeId);
  const title = document.getElementById("current-watchlist-name");
  if (title && activeList) title.innerText = activeList.name;

  if (state.currentView === 'market') {
    renderMarketWatchlist();
    updateMarketIndices();
  } else if (state.currentView === 'portfolio') {
    renderPortfolioView();
  } else if (state.currentView === 'momentum') {
    renderMomentumView();
  } else if (state.currentView === 'technical') {
    renderTechnicalView();
  } else if (state.currentView === 'history') {
    renderHistoryView();
  }
}

function switchDashboardView(view) {
  state.currentView = view;
  
  // Update UI active states
  document.querySelectorAll(".nav-item").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.view === view);
  });
  
  document.querySelectorAll(".dashboard-view").forEach(v => {
    v.classList.toggle("active", v.id === `${view}-view`);
  });

  const viewTitles = {
    'market': 'Market Dashboard',
    'portfolio': 'Portfolio Viewer',
    'technical': 'Technical Chart Gallery',
    'momentum': 'Momentum Trends',
    'history': 'Transaction History'
  };
  document.getElementById("view-title").innerText = viewTitles[view];

  renderDashboardUI();
}

function renderSidebarWatchlists() {
  const container = document.getElementById("sidebar-watchlists");
  if (!container) return;

  container.innerHTML = state.watchlists.map(list => {
    return `
      <button class="nav-item ${list.id === state.activeId ? 'active' : ''}" data-id="${list.id}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        ${list.name}
      </button>
    `;
  }).join("");

  container.querySelectorAll(".nav-item").forEach(btn => {
    btn.addEventListener("click", async () => {
      state.activeId = btn.dataset.id;
      await saveWatchlistsToStorage();
      renderDashboardUI();
    });
  });
}

function renderMarketWatchlist() {
  const activeList = state.watchlists.find(l => l.id === state.activeId);
  const tbody = document.getElementById("dashboard-content");
  if (!tbody || !activeList) return;

  const sortVal = document.getElementById("sort-selector")?.value || 'symbol';
  
  let symbols = [...activeList.symbols];
  
  if (sortVal === 'change') {
    symbols.sort((a, b) => {
      const dataA = state.instruments[a];
      const dataB = state.instruments[b];
      const changeA = dataA ? (parseFloat(dataA.close) - parseFloat(dataA.ycp)) / parseFloat(dataA.ycp) : -999;
      const changeB = dataB ? (parseFloat(dataB.close) - parseFloat(dataB.ycp)) / parseFloat(dataB.ycp) : -999;
      return changeB - changeA;
    });
  } else if (sortVal === 'price') {
    symbols.sort((a, b) => {
      const dataA = state.instruments[a];
      const dataB = state.instruments[b];
      return (parseFloat(dataB?.close) || 0) - (parseFloat(dataA?.close) || 0);
    });
  }

  tbody.innerHTML = symbols.map(symbol => {
    const data = state.instruments[symbol];
    if (!data) return "";

    const price = parseFloat(data.close) || 0;
    const ycp = parseFloat(data.ycp) || 0;
    const change = price - ycp;
    const changePercent = ycp ? (change / ycp) * 100 : 0;
    const isPositive = change >= 0;

    return `
      <tr data-symbol="${symbol}">
        <td>
          <div style="display:flex; flex-direction:column;">
            <span style="font-weight:700;">${symbol}</span>
            <span style="font-size:10px; color:var(--text-muted);">${data.category}</span>
          </div>
        </td>
        <td style="font-weight:700;">${price.toFixed(2)}</td>
        <td class="${isPositive ? 'positive' : 'negative'}">${change.toFixed(2)}</td>
        <td>
          <span class="stock-change ${isPositive ? 'positive' : 'negative'}">
            ${isPositive ? '+' : ''}${changePercent.toFixed(2)}%
          </span>
        </td>
        <td>
          <div style="width:80px; height:24px;">
            ${generateSparklineSVG(symbol, data, isPositive)}
          </div>
        </td>
        <td>
          ${renderSignalPill(data)}
        </td>
        <td style="font-size:11px; font-weight:600;">
          ${calculateTechnicalInsight(data)}
        </td>
        <td>${(parseInt(data.volume) || 0).toLocaleString()}</td>
        <td>
          <div style="display:flex; gap:8px;">
            <button class="btn-icon btn-portfolio-edit" data-symbol="${symbol}" title="Add to Portfolio" style="width:28px; height:28px; border-radius:6px; background:var(--primary-glow); color:var(--primary); border:none;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
            </button>
            <button class="btn-icon btn-remove-stock" data-symbol="${symbol}" title="Remove from Watchlist" style="width:28px; height:28px; border-radius:6px; background:var(--red-bg); color:var(--red); border:none;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2M10 11v6M14 11v6"/></svg>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  tbody.querySelectorAll(".btn-portfolio-edit").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openPortfolioEdit(btn.dataset.symbol);
    });
  });

  tbody.querySelectorAll(".btn-remove-stock").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await removeSymbolFromActiveWatchlist(btn.dataset.symbol);
    });
  });

  tbody.querySelectorAll("tr").forEach(tr => {
    tr.addEventListener("click", () => {
      const sym = tr.dataset.symbol;
      if (state.instruments[sym]) showStockDetails(sym, state.instruments[sym]);
    });
  });
}

function updateMarketIndices() {
  // Mock data if not available in API, but try to find DSEX
  const dsex = state.instruments['DSEX'];
  if (dsex) {
    const price = parseFloat(dsex.close);
    const ycp = parseFloat(dsex.ycp);
    const change = price - ycp;
    const pct = (change / ycp) * 100;
    
    document.querySelector("#index-dsex .stat-value").innerText = price.toLocaleString();
    const changeEl = document.querySelector("#index-dsex .stat-change");
    changeEl.innerText = `${change > 0 ? '+' : ''}${change.toFixed(2)} (${pct.toFixed(2)}%)`;
    changeEl.className = `stat-change ${change >= 0 ? 'positive' : 'negative'}`;
  }
}

function renderPortfolioView() {
  const tbody = document.getElementById("portfolio-content");
  if (!tbody) return;

  // Pivot Table Logic: Aggregate history into holdings
  const holdings = {};
  let totalCashFlow = 0; // Net cash from buys (-) and sells (+)

  state.history.forEach(tx => {
    const symbol = tx.symbol;
    if (!holdings[symbol]) {
      holdings[symbol] = {
        totalSharesBought: 0,
        totalCashInvested: 0,
        remainingShares: 0,
        realisedPL: 0,
        netCashFlow: 0, // Individual stock cash flow
        txCount: 0
      };
    }

    const txCount = parseFloat(tx.count);
    const txPrice = parseFloat(tx.price);
    const commissionPct = getEffectiveCommission(tx.commission);
    const rawTotal = txCount * txPrice;
    const commission = rawTotal * (commissionPct / 100);

    if (tx.type === 'buy') {
      const spent = rawTotal + commission;
      holdings[symbol].totalSharesBought += txCount;
      holdings[symbol].totalCashInvested += spent;
      holdings[symbol].remainingShares += txCount;
      holdings[symbol].netCashFlow -= spent;
      totalCashFlow -= spent;
    } else {
      const earned = rawTotal - commission;
      holdings[symbol].remainingShares -= txCount;
      holdings[symbol].netCashFlow += earned;
      totalCashFlow += earned;
      
      // Calculate Realised P/L for this sell
      // Pro-rata cost of shares sold
      const avgCostPerShare = holdings[symbol].totalSharesBought > 0 ? (holdings[symbol].totalCashInvested / holdings[symbol].totalSharesBought) : 0;
      const costOfSoldShares = txCount * avgCostPerShare;
      holdings[symbol].realisedPL += (earned - costOfSoldShares);
    }
  });

  const symbols = Object.keys(holdings).filter(s => holdings[s].remainingShares !== 0 || holdings[s].netCashFlow !== 0);
  
  let totalPortfolioValue = 0;
  let totalRealisedPL = 0;
  let totalUnrealisedPL = 0;

  tbody.innerHTML = symbols.map(symbol => {
    const h = holdings[symbol];
    const data = state.instruments[symbol];
    const currentPrice = data ? (parseFloat(data.close) || 0) : 0;
    
    // Net Avg Price (break-even) = net money spent / remaining shares
    // netCashFlow is negative for net spending, so -netCashFlow = money still invested
    const netMoneyInvested = -h.netCashFlow; // positive = you've spent more than earned
    const netAvgPrice = h.remainingShares > 0 ? Math.max(0, netMoneyInvested / h.remainingShares) : 0;
    
    const remainingValue = h.remainingShares * currentPrice;
    
    // Original avg cost for unrealised P/L (avoids double-counting with realised P/L)
    const origAvgCost = h.totalSharesBought > 0 ? (h.totalCashInvested / h.totalSharesBought) : 0;
    const unrealisedPL = h.remainingShares > 0 ? (remainingValue - (h.remainingShares * origAvgCost)) : 0;
    const totalPL = h.realisedPL + unrealisedPL;

    totalPortfolioValue += remainingValue;
    totalRealisedPL += h.realisedPL;
    totalUnrealisedPL += unrealisedPL;

    return `
      <tr>
        <td style="font-weight:700;">${symbol}</td>
        <td>${currentPrice > 0 ? currentPrice.toFixed(2) : '—'}</td>
        <td>${h.remainingShares}</td>
        <td>৳ ${h.netCashFlow.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
        <td>${netAvgPrice.toFixed(2)}</td>
        <td class="${unrealisedPL >= 0 ? 'positive' : 'negative'}">৳ ${unrealisedPL.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
        <td class="${h.realisedPL >= 0 ? 'positive' : 'negative'}">৳ ${h.realisedPL.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
        <td class="${totalPL >= 0 ? 'positive' : 'negative'}" style="font-weight:700;">৳ ${totalPL.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
      </tr>
    `;
  }).join("");

  const totalPL = totalRealisedPL + totalUnrealisedPL;
  const totalInvestment = totalPortfolioValue - totalUnrealisedPL; // Not perfect but a proxy
  const totalPLPct = totalInvestment > 0 ? (totalPL / Math.abs(totalInvestment)) * 100 : 0;

  document.getElementById("portfolio-total-value").innerText = `৳ ${totalPortfolioValue.toLocaleString(undefined, {maximumFractionDigits: 0})}`;
  document.getElementById("portfolio-cash-balance").innerText = `৳ ${totalCashFlow.toLocaleString(undefined, {maximumFractionDigits: 0})}`;
  
  const plEl = document.getElementById("portfolio-total-pl");
  plEl.innerText = `৳ ${totalPL.toLocaleString(undefined, {maximumFractionDigits: 0})}`;
  plEl.className = `stat-value ${totalPL >= 0 ? 'positive' : 'negative'}`;

  const plPctEl = document.getElementById("portfolio-total-pl-percent");
  plPctEl.innerText = `${totalPL >= 0 ? '+' : ''}${totalPLPct.toFixed(2)}%`;
  plPctEl.className = `stat-change ${totalPL >= 0 ? 'positive' : 'negative'}`;
}

async function addTransactionFromForm() {
  const date = document.getElementById("hist-date").value;
  const symbol = document.getElementById("hist-symbol").value.toUpperCase();
  const type = document.getElementById("hist-type").value;
  const count = parseFloat(document.getElementById("hist-count").value);
  const price = parseFloat(document.getElementById("hist-price").value);
  const commission = getEffectiveCommission(document.getElementById("hist-commission").value);

  if (!symbol || isNaN(count) || isNaN(price)) {
    alert("Please fill all required fields correctly.");
    return;
  }

  const transaction = {
    id: Date.now(),
    date,
    symbol,
    type,
    count,
    price,
    commission: document.getElementById("hist-commission").value
  };

  state.history.push(transaction);
  state.history.sort((a, b) => new Date(b.date) - new Date(a.date)); // Sort by date desc

  await saveWatchlistsToStorage();
  
  // Clear inputs
  document.getElementById("hist-symbol").value = "";
  document.getElementById("hist-count").value = "";
  document.getElementById("hist-price").value = "";
  
  renderDashboardUI();
}

function renderHistoryView() {
  const tbody = document.getElementById("history-content");
  if (!tbody) return;

  // Populate symbols datalist for autocompletion
  const datalist = document.getElementById("symbols-list");
  if (datalist) {
    datalist.innerHTML = Object.keys(state.instruments).map(sym => `<option value="${sym}">`).join("");
  }

  tbody.innerHTML = state.history.map(tx => {
    const rawComm = tx.commission;
    const effectiveComm = getEffectiveCommission(rawComm);
    const rawTotal = tx.count * tx.price;
    const commissionVal = rawTotal * (effectiveComm / 100);
    const total = tx.type === 'buy' ? (rawTotal + commissionVal) : (rawTotal - commissionVal);

    return `
      <tr>
        <td>${tx.date}</td>
        <td style="font-weight:700;">${tx.symbol}</td>
        <td><span class="type-pill ${tx.type}">${tx.type}</span></td>
        <td>${tx.count}</td>
        <td>${tx.price.toFixed(2)}</td>
        <td>${effectiveComm}%</td>
        <td style="font-weight:600;">৳ ${total.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
        <td>
          <button class="btn-delete-history" data-id="${tx.id}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2M10 11v6M14 11v6"/></svg>
          </button>
        </td>
      </tr>
    `;
  }).join("");

  tbody.querySelectorAll(".btn-delete-history").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = parseInt(btn.dataset.id);
      state.history = state.history.filter(tx => tx.id !== id);
      await saveWatchlistsToStorage();
      renderHistoryView();
    });
  });
}

function getEffectiveCommission(val) {
  if (val === "" || val === null || val === undefined) return 0.4;
  const comm = parseFloat(val);
  return isNaN(comm) ? 0.4 : comm;
}

function renderTechnicalView() {
  const container = document.getElementById("technical-grid");
  if (!container) return;

  const activeList = state.watchlists.find(l => l.id === state.activeId);
  if (!activeList || activeList.symbols.length === 0) {
    container.innerHTML = `<div class="empty-container">No symbols in watchlist</div>`;
    return;
  }

  // Clear container
  container.innerHTML = "";
  
  const interval = state.chartInterval || "D";
  const layout = state.chartLayout || "grid";

  // Apply layout class to container
  container.className = `charts-grid ${layout}-layout`;

  activeList.symbols.forEach(symbol => {
    const interval = state.chartInterval || "D";
    const layout = state.chartLayout || "list";

    // Apply layout class to container
    container.className = `charts-grid ${layout}-layout`;

    const card = document.createElement("div");
    card.className = `chart-card technical-card ${layout}-card`;
    
    const chartHeight = layout === 'list' ? '500px' : '320px';
    
    card.innerHTML = `
      <div class="chart-card-header">
        <span class="chart-card-symbol">${symbol}</span>
      </div>
      <div class="chart-canvas-wrapper" style="height: ${chartHeight};">
        <iframe 
          src="https://s.tradingview.com/widgetembed/?symbol=DSEBD:${symbol}&interval=${interval}&hidesidetoolbar=1&symboledit=1&saveimage=1&toolbarbg=f1f3f6&studies=[]&hideideas=1&theme=dark&style=1&timezone=Asia/Dhaka&withdateranges=1&showpopupbutton=1&locale=en" 
          width="100%" 
          height="100%" 
          frameborder="0" 
          allowtransparency="true" 
          scrolling="no" 
          allowfullscreen>
        </iframe>
      </div>
    `;
    container.appendChild(card);
  });

  // Setup timeframe buttons
  document.querySelectorAll(".btn-timeframe").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.interval === interval);
    btn.onclick = () => {
      state.chartInterval = btn.dataset.interval;
      renderTechnicalView();
    };
  });

  // Setup layout buttons
  document.querySelectorAll(".btn-layout").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.layout === layout);
    btn.onclick = () => {
      state.chartLayout = btn.dataset.layout;
      renderTechnicalView();
    };
  });
}

function generateLargeChartSVG(symbol, data, isPositive) {
  // Use the same keys as sparkline but with more resolution/size
  const keys = ['365d', '180d', '90d', '30d', '15d', '7d', 'ycp', 'close'];
  let points = [];
  keys.forEach(k => {
    const val = parseFloat(data[k]);
    if (!isNaN(val) && val > 0) points.push(val);
  });

  if (points.length < 2) {
    const ycp = parseFloat(data.ycp) || parseFloat(data.close) || 0;
    const close = parseFloat(data.close) || 0;
    points = [ycp, close];
  }

  const width = 300;
  const height = 120;
  const padding = 10;

  const min = Math.min(...points);
  const max = Math.max(...points);
  const diff = max - min === 0 ? 1 : max - min;

  const coords = points.map((val, index) => {
    const x = (index / (points.length - 1)) * (width - 2 * padding) + padding;
    const y = height - padding - ((val - min) / diff) * (height - 2 * padding);
    return { x, y };
  });

  const linePath = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(" ");
  const fillPath = `${linePath} L ${coords[coords.length - 1].x.toFixed(1)} ${height} L ${coords[0].x.toFixed(1)} ${height} Z`;
  
  const color = isPositive ? 'var(--green)' : 'var(--red)';
  const gradientId = `lg-gradient-${symbol.replace(/[^a-zA-Z0-9]/g, '')}`;

  return `
    <svg width="100%" height="100%" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${color}" stop-opacity="0.2" />
          <stop offset="100%" stop-color="${color}" stop-opacity="0" />
        </linearGradient>
      </defs>
      <path d="${fillPath}" fill="url(#${gradientId})" />
      <path d="${linePath}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
      ${coords.map(c => `<circle cx="${c.x}" cy="${c.y}" r="2" fill="${color}" />`).join("")}
    </svg>
  `;
}

function openPortfolioEdit(symbol) {
  const modal = document.getElementById("portfolio-modal");
  const symbolSpan = document.getElementById("holding-symbol");
  const buyInput = document.getElementById("buy-price-input");
  const qtyInput = document.getElementById("buy-quantity-input");

  if (!modal || !symbolSpan) return;

  const current = state.portfolio[symbol] || { buyPrice: state.instruments[symbol]?.close || 0, quantity: 0 };
  
  state.editingSymbol = symbol;
  symbolSpan.innerText = symbol;
  buyInput.value = current.buyPrice;
  qtyInput.value = current.quantity;

  modal.classList.add("active");
}

async function savePortfolioHolding() {
  const symbol = state.editingSymbol;
  const buyPrice = parseFloat(document.getElementById("buy-price-input").value) || 0;
  const quantity = parseInt(document.getElementById("buy-quantity-input").value) || 0;

  if (quantity <= 0) {
    delete state.portfolio[symbol];
  } else {
    state.portfolio[symbol] = { buyPrice, quantity };
  }

  await saveWatchlistsToStorage();
  document.getElementById("portfolio-modal").classList.remove("active");
}

function renderMomentumView() {
  const tbody = document.getElementById("momentum-content");
  if (!tbody) return;

  const activeList = state.watchlists.find(l => l.id === state.activeId);
  if (!activeList) return;

  const combinedSymbols = [...new Set([...activeList.symbols, ...Object.keys(state.portfolio)])];

  const momentumData = combinedSymbols.map(sym => {
    const data = state.instruments[sym];
    if (!data) return null;

    const price = parseFloat(data.close) || 0;
    const p30 = parseFloat(data['30d']) || 0;
    const p90 = parseFloat(data['90d']) || 0;
    const p180 = parseFloat(data['180d']) || 0;
    const p365 = parseFloat(data['365d']) || 0;

    return {
      symbol: sym,
      data: data,
      ret1m: p30 > 0 ? ((price - p30) / p30) * 100 : 0,
      ret3m: p90 > 0 ? ((price - p90) / p90) * 100 : 0,
      ret6m: p180 > 0 ? ((price - p180) / p180) * 100 : 0,
      ret1y: p365 > 0 ? ((price - p365) / p365) * 100 : 0
    };
  }).filter(d => d !== null);

  momentumData.sort((a, b) => b.ret1m - a.ret1m);

  tbody.innerHTML = momentumData.map(item => `
    <tr>
      <td><span style="font-weight:700;">${item.symbol}</span></td>
      <td class="${item.ret1m >= 0 ? 'positive' : 'negative'}">
        <span class="trend-val">${item.ret1m >= 0 ? '+' : ''}${item.ret1m.toFixed(1)}%</span>
      </td>
      <td class="${item.ret3m >= 0 ? 'positive' : 'negative'}">
        <span class="trend-val">${item.ret3m >= 0 ? '+' : ''}${item.ret3m.toFixed(1)}%</span>
      </td>
      <td class="${item.ret6m >= 0 ? 'positive' : 'negative'}">
        <span class="trend-val">${item.ret6m >= 0 ? '+' : ''}${item.ret6m.toFixed(1)}%</span>
      </td>
      <td class="${item.ret1y >= 0 ? 'positive' : 'negative'}">
        <span class="trend-val">${item.ret1y >= 0 ? '+' : ''}${item.ret1y.toFixed(1)}%</span>
      </td>
      <td>${renderSignalPill(item.data)}</td>
      <td style="font-size:11px; font-weight:600;">${calculateTechnicalInsight(item.data)}</td>
    </tr>
  `).join("");
}

function renderSignalPill(data) {
  const signal = calculateSignal(data);
  let color = "var(--text-muted)";
  let bg = "rgba(255,255,255,0.05)";
  
  if (signal === "STRONG BUY") { color = "white"; bg = "#059669"; }
  else if (signal === "BUY") { color = "#34d399"; bg = "rgba(52, 211, 153, 0.1)"; }
  else if (signal === "SELL") { color = "#f87171"; bg = "rgba(248, 113, 113, 0.1)"; }
  else if (signal === "STRONG SELL") { color = "white"; bg = "#dc2626"; }
  else if (signal === "HOLD") { color = "#fbbf24"; bg = "rgba(251, 191, 36, 0.1)"; }

  return `
    <span style="padding: 4px 10px; border-radius: 20px; font-size: 10px; font-weight: 700; background: ${bg}; color: ${color}; white-space: nowrap;">
      ${signal}
    </span>
  `;
}

function calculateSignal(data) {
  const price = parseFloat(data.close) || 0;
  const ycp = parseFloat(data.ycp) || 0;
  const ma30 = parseFloat(data['30d']) || price;
  const ma365 = parseFloat(data['365d']) || price;
  
  const dailyChange = ((price - ycp) / ycp) * 100;
  
  // Trend Analysis
  const isAboveMA30 = price > ma30;
  const isAboveMA365 = price > ma365;
  
  if (isAboveMA30 && isAboveMA365 && dailyChange > 0.5) return "STRONG BUY";
  if (isAboveMA30 && dailyChange > 0) return "BUY";
  if (!isAboveMA30 && !isAboveMA365 && dailyChange < -0.5) return "STRONG SELL";
  if (!isAboveMA30 && dailyChange < 0) return "SELL";
  
  return "HOLD";
}

function calculateTechnicalInsight(data) {
  const price = parseFloat(data.close) || 0;
  const high = parseFloat(data.high) || 0;
  const low = parseFloat(data.low) || price;
  const volume = parseInt(data.volume) || 0;
  
  const historyKeys = ['7d', '15d', '30d', '90d', '180d'];
  const history = historyKeys.map(k => parseFloat(data[k])).filter(v => !isNaN(v) && v > 0);
  
  if (history.length === 0) return "--";

  const insights = [];
  const maxRecent = Math.max(...history);
  const minRecent = Math.min(...history);
  const avgHistory = history.reduce((a, b) => a + b, 0) / history.length;
  
  // 1. Breakout Factor
  if (price > maxRecent) {
    const isMajor = price > (parseFloat(data['180d']) || 0);
    insights.push(`<span class="insight-badge breakout">${isMajor ? '💎 MAJOR' : '🚀'} BREAKOUT</span>`);
  } else if (((maxRecent - price) / price) < 0.015) {
    insights.push(`<span class="insight-badge resistance">🎯 NEAR RESIST</span>`);
  }

  // 2. Trend Factor
  const p15 = parseFloat(data['15d']) || 0;
  const p90 = parseFloat(data['90d']) || 0;
  if (p15 > p90 && p90 > 0) {
    insights.push(`<span class="insight-badge bullish">📈 BULLISH CROSS</span>`);
  } else if (p15 < p90 && p90 > 0) {
    insights.push(`<span class="insight-badge bearish">📉 BEARISH CROSS</span>`);
  }

  // 3. Volatility/Pattern Factor
  const range = (maxRecent - minRecent) / avgHistory;
  if (range < 0.04) {
    insights.push(`<span class="insight-badge pattern">💤 CONSOLIDATING</span>`);
  }
  
  const dailyRange = (high - low) / price;
  if (dailyRange > 0.05) {
    insights.push(`<span class="insight-badge volatility">⚡ VOLATILE</span>`);
  }

  // 4. Volume Factor (Simulated)
  if (volume > 1000000) {
    insights.push(`<span class="insight-badge volume">📊 HIGH VOL</span>`);
  }

  if (insights.length === 0) return `<span style="color:var(--text-muted); font-size:10px;">Neutral</span>`;

  return `<div class="insight-tags">${insights.join("")}</div>`;
}
