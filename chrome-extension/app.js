// Extension Global State
let state = {
  instruments: {}, // Dict of symbols from API
  watchlists: [],  // Array of watchlists: [{id, name, symbols: []}]
  activeId: '',    // Current active watchlist ID
  defaultWatchlistId: '', // ID of the default watchlist (auto-selected on load)
  isLoading: false,
  showCharts: true, // Default to true
  portfolio: {},   // Symbol-keyed: {symbol, buyPrice, quantity}
  stockNotes: {},  // Symbol-keyed notes: {SYMBOL: "note text"}
  history: [],     // Array of transactions: {id, date, symbol, type, count, price, commission}
  editingTransactionId: null, // ID of transaction currently being edited (null = add mode)
  currentView: 'market', // For dashboard: market, portfolio, momentum, history
  chartLayout: 'list',   // Default to list (one per row)
  isDashboard: document.body.classList.contains('dashboard-body'),
  portfolioSort: { key: 'symbol', dir: 'asc' }, // Current sort for portfolio table
  portfolioSearch: '',      // Search filter text
  portfolioFilterPL: 'all', // 'all' | 'profit' | 'loss'
  portfolioFilterHolding: 'all', // 'all' | 'active' | 'closed'
  portfolioViewMode: 'table', // 'table' | 'cards'
  drawerSymbol: null,
  editingSymbol: null,
  chartInterval: 'D',
  historySort: { key: 'date', dir: 'desc' },
  historySearch: '',
  historyFilterType: 'all',
  marketSort: { key: 'symbol', dir: 'asc' },
  marketSearch: '',
  momentumSort: { key: 'ret1m', dir: 'desc' },
  momentumSearch: ''
};

let portfolioSearchTimer;
let historySearchTimer;
let marketSearchTimer;
let momentumSearchTimer;

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
  const data = await chrome.storage.local.get(["watchlists", "activeWatchlistId", "defaultWatchlistId", "showCharts", "portfolio", "transactionHistory", "stockNotes"]);
  
  if (data.showCharts !== undefined) {
    state.showCharts = data.showCharts;
  }

  if (data.portfolio) {
    state.portfolio = data.portfolio;
  }

  if (data.transactionHistory) {
    state.history = data.transactionHistory;
  }

  if (data.stockNotes) {
    state.stockNotes = data.stockNotes;
  }

  if (data.watchlists && data.watchlists.length > 0) {
    state.watchlists = data.watchlists;
    // On load, prefer the default watchlist, then the last active, then the first
    const defaultId = data.defaultWatchlistId;
    const lastActiveId = data.activeWatchlistId;
    if (defaultId && state.watchlists.find(l => l.id === defaultId)) {
      state.activeId = defaultId;
    } else if (lastActiveId && state.watchlists.find(l => l.id === lastActiveId)) {
      state.activeId = lastActiveId;
    } else {
      state.activeId = state.watchlists[0].id;
    }
    state.defaultWatchlistId = defaultId || state.watchlists[0].id;
  } else {
    // Default initial watchlist
    const defaultList = {
      id: "default-list",
      name: "My Watchlist",
      symbols: ["SQURPHARMA", "ITC", "MARICO", "ROBI", "GP", "OLYMPIC", "BSRMSTEEL"]
    };
    state.watchlists = [defaultList];
    state.activeId = defaultList.id;
    state.defaultWatchlistId = defaultList.id;
    await saveWatchlistsToStorage();
  }
}

// Save Watchlists to chrome.storage.local
async function saveWatchlistsToStorage() {
  await chrome.storage.local.set({
    watchlists: state.watchlists,
    activeWatchlistId: state.activeId,
    defaultWatchlistId: state.defaultWatchlistId || state.activeId,
    portfolio: state.portfolio,
    transactionHistory: state.history,
    stockNotes: state.stockNotes
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
    
    // Market search (debounced)
    document.getElementById("market-search")?.addEventListener("input", (e) => {
      clearTimeout(marketSearchTimer);
      marketSearchTimer = setTimeout(() => {
        state.marketSearch = e.target.value.trim().toUpperCase();
        renderMarketWatchlist();
      }, 200);
    });

    // Market table column sort
    document.getElementById("watchlist-table")?.addEventListener("click", (e) => {
      const th = e.target.closest(".sortable-th");
      if (!th) return;
      const key = th.dataset.sortKey;
      if (state.marketSort.key === key) {
        state.marketSort.dir = state.marketSort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        state.marketSort = { key, dir: key === 'symbol' ? 'asc' : 'desc' };
      }
      renderMarketWatchlist();
    });

    // History search (debounced)
    document.getElementById("history-search")?.addEventListener("input", (e) => {
      clearTimeout(historySearchTimer);
      historySearchTimer = setTimeout(() => {
        state.historySearch = e.target.value.trim().toUpperCase();
        renderHistoryView();
      }, 200);
    });

    // History type filter
    document.getElementById("history-filter-type")?.addEventListener("change", (e) => {
      state.historyFilterType = e.target.value;
      renderHistoryView();
    });

    // History table column sort
    document.getElementById("history-table")?.addEventListener("click", (e) => {
      const th = e.target.closest(".sortable-th");
      if (!th) return;
      const key = th.dataset.sortKey;
      if (state.historySort.key === key) {
        state.historySort.dir = state.historySort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        state.historySort = { key, dir: key === 'date' ? 'desc' : 'asc' };
      }
      renderHistoryView();
    });

    // Momentum search (debounced)
    document.getElementById("momentum-search")?.addEventListener("input", (e) => {
      clearTimeout(momentumSearchTimer);
      momentumSearchTimer = setTimeout(() => {
        state.momentumSearch = e.target.value.trim().toUpperCase();
        renderMomentumView();
      }, 200);
    });

    // Momentum table column sort
    document.getElementById("momentum-table")?.addEventListener("click", (e) => {
      const th = e.target.closest(".sortable-th");
      if (!th) return;
      const key = th.dataset.sortKey;
      if (state.momentumSort.key === key) {
        state.momentumSort.dir = state.momentumSort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        state.momentumSort = { key, dir: key === 'symbol' ? 'asc' : 'desc' };
      }
      renderMomentumView();
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

    document.getElementById("download-portfolio-btn")?.addEventListener("click", () => {
      downloadPortfolioCSV();
    });

    // Portfolio view mode toggle (table / cards)
    document.getElementById("portfolio-table-view-btn")?.addEventListener("click", () => {
      state.portfolioViewMode = 'table';
      document.getElementById("portfolio-table-view-btn")?.classList.add('active');
      document.getElementById("portfolio-card-view-btn")?.classList.remove('active');
      renderPortfolioView();
    });
    document.getElementById("portfolio-card-view-btn")?.addEventListener("click", () => {
      state.portfolioViewMode = 'cards';
      document.getElementById("portfolio-card-view-btn")?.classList.add('active');
      document.getElementById("portfolio-table-view-btn")?.classList.remove('active');
      renderPortfolioView();
    });

    // Helper: compute remaining shares for a symbol from transaction history
    function getPortfolioShares(symbol) {
      if (!symbol) return 0;
      const sym = symbol.toUpperCase();
      let shares = 0;
      for (const tx of state.history) {
        if (tx.symbol.toUpperCase() !== sym) continue;
        const count = parseFloat(tx.count) || 0;
        if (tx.type === 'buy' || tx.type === 'stock_dividend') shares += count;
        else if (tx.type === 'sell') shares -= count;
      }
      return Math.max(0, shares);
    }

    // Auto-fill shares held when type is cash_dividend and symbol is set
    function autoFillSharesHeld() {
      const type = document.getElementById("hist-type")?.value;
      const symbol = document.getElementById("hist-symbol")?.value;
      const countInput = document.getElementById("hist-count");
      if (type === 'cash_dividend' && symbol && countInput) {
        const shares = getPortfolioShares(symbol);
        if (shares > 0) {
          countInput.value = shares;
        }
      }
    }

    // Adapt form fields based on transaction type
    document.getElementById("hist-type")?.addEventListener("change", (e) => {
      const type = e.target.value;
      const commGroup = document.getElementById("hist-commission")?.closest('.form-group');
      const priceLabel = document.querySelector('label[for="hist-price"]');
      const countLabel = document.querySelector('label[for="hist-count"]');
      
      if (type === 'cash_dividend') {
        if (commGroup) commGroup.style.display = 'none';
        if (priceLabel) priceLabel.textContent = 'Dividend / Share';
        if (countLabel) countLabel.textContent = 'Shares Held';
        autoFillSharesHeld();
      } else if (type === 'stock_dividend') {
        if (commGroup) commGroup.style.display = 'none';
        if (priceLabel) priceLabel.textContent = 'Price (set 0)';
        if (countLabel) countLabel.textContent = 'Bonus Shares';
      } else {
        if (commGroup) commGroup.style.display = '';
        if (priceLabel) priceLabel.textContent = 'Price / Stock';
        if (countLabel) countLabel.textContent = 'Count (Quantity)';
      }
    });

    // Auto-fill shares held when symbol changes (for cash dividend)
    document.getElementById("hist-symbol")?.addEventListener("change", autoFillSharesHeld);
    document.getElementById("hist-symbol")?.addEventListener("blur", autoFillSharesHeld);

    // Portfolio search (debounced)
    document.getElementById("portfolio-search")?.addEventListener("input", (e) => {
      clearTimeout(portfolioSearchTimer);
      portfolioSearchTimer = setTimeout(() => {
        state.portfolioSearch = e.target.value.trim().toUpperCase();
        renderPortfolioView();
      }, 200);
    });

    // Portfolio P/L filter
    document.getElementById("portfolio-filter-pl")?.addEventListener("change", (e) => {
      state.portfolioFilterPL = e.target.value;
      renderPortfolioView();
    });

    // Portfolio holding filter
    document.getElementById("portfolio-filter-holding")?.addEventListener("change", (e) => {
      state.portfolioFilterHolding = e.target.value;
      renderPortfolioView();
    });

    // Portfolio sortable column headers
    document.querySelectorAll("#portfolio-table .sortable-th").forEach(th => {
      th.addEventListener("click", () => {
        const key = th.dataset.sortKey;
        if (state.portfolioSort.key === key) {
          state.portfolioSort.dir = state.portfolioSort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          state.portfolioSort.key = key;
          state.portfolioSort.dir = key === 'symbol' ? 'asc' : 'desc'; // default desc for numbers, asc for name
        }
        renderPortfolioView();
      });
    });

    document.getElementById("history-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      await addTransactionFromForm();
    });

    document.getElementById("cancel-edit-btn")?.addEventListener("click", () => {
      cancelEditTransaction();
      renderHistoryView();
    });

    document.getElementById("clear-history-btn")?.addEventListener("click", async () => {
      if (confirm("Are you sure you want to clear all transaction history?")) {
        state.history = [];
        await saveWatchlistsToStorage();
        renderDashboardUI();
      }
    });

    // Export transaction history as JSON file
    document.getElementById("export-history-btn")?.addEventListener("click", () => {
      if (state.history.length === 0) {
        alert("No transactions to export.");
        return;
      }
      const data = JSON.stringify(state.history, null, 2);
      const blob = new Blob([data], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `stocknow-transactions-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });

    // Import transaction history from JSON file
    document.getElementById("import-history-btn")?.addEventListener("click", () => {
      document.getElementById("import-history-file")?.click();
    });

    document.getElementById("import-history-file")?.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      try {
        const text = await file.text();
        const imported = JSON.parse(text);

        if (!Array.isArray(imported)) {
          alert("Invalid file: expected a JSON array of transactions.");
          return;
        }

        // Validate each transaction has required fields
        const valid = imported.every(tx =>
          tx.date && typeof tx.date === 'string' &&
          tx.symbol && typeof tx.symbol === 'string' &&
          (tx.type === 'buy' || tx.type === 'sell' || tx.type === 'cash_dividend' || tx.type === 'stock_dividend') &&
          typeof tx.count === 'number' && tx.count > 0 &&
          typeof tx.price === 'number' && tx.price >= 0
        );
        if (!valid) {
          alert("Invalid file: each transaction must have date, symbol, type (buy/sell), count (>0), and price (>=0).");
          return;
        }

        const mergeChoice = confirm(
          `Found ${imported.length} transaction(s).\n\nOK = Merge with existing (${state.history.length} records)\nCancel = Abort import`
        );
        if (!mergeChoice) {
          alert("Import cancelled.");
          return;
        }

        // Merge: add imported, avoid duplicates by id
        const existingIds = new Set(state.history.map(tx => tx.id));
        const newTxns = imported.map(tx => ({
          ...tx,
          id: tx.id && !existingIds.has(tx.id) ? tx.id : Date.now() + Math.floor(Math.random() * 100000),
          count: parseFloat(tx.count),
          price: parseFloat(tx.price)
        }));
        state.history = [...state.history, ...newTxns];

        state.history.sort((a, b) => new Date(b.date) - new Date(a.date));
        await saveWatchlistsToStorage();
        renderDashboardUI();
        alert(`Successfully imported ${imported.length} transaction(s).`);
      } catch (err) {
        alert("Failed to import: " + err.message);
      }

      // Reset file input so same file can be re-imported
      e.target.value = "";
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

  // Sidebar quick-create button (dashboard) — opens modal with focus on name input
  document.getElementById("sidebar-add-watchlist-btn")?.addEventListener("click", () => {
    renderModalWatchlists();
    modal?.classList.add("active");
    setTimeout(() => newListNameInput?.focus(), 100);
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
      saveObj.pollingInterval = parseInt(selectInterval.value, 10);
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
    const isDefault = list.id === state.defaultWatchlistId;
    return `<option value="${list.id}" ${list.id === state.activeId ? 'selected' : ''}>${isDefault ? '★ ' : ''}${list.name}</option>`;
  }).join("");
}

// Render List of Watchlists in Management Modal
function renderModalWatchlists() {
  const container = document.getElementById("watchlist-management-list");
  if (!container) return;

  container.innerHTML = state.watchlists.map(list => {
    const canDelete = state.watchlists.length > 1;
    const isDefault = list.id === state.defaultWatchlistId;
    return `
      <div class="management-list-item">
        <span>${isDefault ? '★ ' : ''}${list.name} (${list.symbols.length} stocks)${isDefault ? ' — Default' : ''}</span>
        <div style="display:flex; gap:4px; align-items:center;">
          ${!isDefault ? `
            <button class="btn-set-default" data-id="${list.id}" title="Set as default" style="border:none; background:none; cursor:pointer; color:var(--text-muted); padding:4px;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
            </button>
          ` : `
            <span style="color:var(--primary); padding:4px;" title="Default watchlist">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
            </span>
          `}
          ${canDelete ? `
            <button class="btn-delete-list" data-id="${list.id}" title="Delete watchlist">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2M10 11v6M14 11v6"/></svg>
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }).join("");

  // Set default listeners
  container.querySelectorAll(".btn-set-default").forEach(btn => {
    btn.addEventListener("click", async () => {
      state.defaultWatchlistId = btn.dataset.id;
      await saveWatchlistsToStorage();
      renderModalWatchlists();
      renderUI();
    });
  });

  // Add delete listeners
  container.querySelectorAll(".btn-delete-list").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      state.watchlists = state.watchlists.filter(l => l.id !== id);
      if (state.activeId === id) {
        state.activeId = state.watchlists[0].id;
      }
      // If deleting the default, reassign
      if (state.defaultWatchlistId === id) {
        state.defaultWatchlistId = state.watchlists[0].id;
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
    const rawVolume = parseInt(data.volume, 10) || 0;
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
  
  document.getElementById("stat-volume").innerText = (parseInt(data.volume, 10) || 0).toLocaleString();
  document.getElementById("stat-value").innerText = data.value ? parseFloat(data.value).toFixed(2) + "M" : "—";
  document.getElementById("stat-category").innerText = data.category || "N/A";
  document.getElementById("stat-sector").innerText = data.sector_id || "N/A";
  document.getElementById("stat-updated").innerText = data.updated_at || "N/A";

  // Store current drawer symbol for alert operations
  state.drawerSymbol = symbol;

  // Render alerts for this stock
  renderDrawerAlerts(symbol);

  // Setup add alert button (remove old listener by replacing element)
  const addBtn = document.getElementById("drawer-add-alert-btn");
  if (addBtn) {
    const newBtn = addBtn.cloneNode(true);
    addBtn.parentNode.replaceChild(newBtn, addBtn);
    newBtn.addEventListener("click", async () => {
      const condition = document.getElementById("drawer-alert-condition")?.value;
      const value = parseFloat(document.getElementById("drawer-alert-value")?.value);
      
      if (isNaN(value) || value <= 0) {
        alert("Please enter a valid target price.");
        return;
      }

      const { alerts } = await chrome.storage.local.get("alerts");
      const activeAlerts = alerts || [];
      
      activeAlerts.push({
        symbol: state.drawerSymbol,
        condition,
        value,
        triggered: false
      });

      await chrome.storage.local.set({ alerts: activeAlerts });
      
      // Clear input
      const valInput = document.getElementById("drawer-alert-value");
      if (valInput) valInput.value = "";
      
      renderDrawerAlerts(state.drawerSymbol);
    });
  }

  // Watchlist add/remove controls
  updateDrawerWatchlistControls(symbol);

  drawer.classList.add("active");
}

// Update the watchlist star button and dropdown for the given symbol
function updateDrawerWatchlistControls(symbol) {
  const toggleBtn = document.getElementById("drawer-watchlist-toggle");
  const wlIcon = document.getElementById("drawer-wl-icon");
  const dropdown = document.getElementById("drawer-wl-dropdown");
  const wlList = document.getElementById("drawer-wl-list");

  if (!toggleBtn || !wlIcon) return;

  // Check if symbol is in the active watchlist
  const activeList = state.watchlists.find(l => l.id === state.activeId);
  const isInActive = activeList?.symbols.includes(symbol) || false;

  // Update star icon: filled if in active watchlist, outline if not
  if (isInActive) {
    wlIcon.setAttribute("fill", "var(--primary)");
    wlIcon.setAttribute("stroke", "var(--primary)");
    toggleBtn.style.background = "var(--primary-glow)";
    toggleBtn.title = "In watchlist (click to manage)";
  } else {
    wlIcon.setAttribute("fill", "none");
    wlIcon.setAttribute("stroke", "currentColor");
    toggleBtn.style.background = "var(--bg-card)";
    toggleBtn.title = "Add to watchlist";
  }

  // Toggle dropdown on star click (replace listener)
  const newToggle = toggleBtn.cloneNode(true);
  toggleBtn.parentNode.replaceChild(newToggle, toggleBtn);
  newToggle.addEventListener("click", (e) => {
    e.stopPropagation();
    if (dropdown.style.display === "none") {
      renderDrawerWatchlistDropdown(symbol);
      dropdown.style.display = "block";
    } else {
      dropdown.style.display = "none";
    }
  });

  // Close dropdown when clicking outside
  document.addEventListener("click", function closeWlDropdown(e) {
    if (dropdown && !dropdown.contains(e.target) && e.target !== newToggle && !newToggle.contains(e.target)) {
      dropdown.style.display = "none";
    }
  }, { once: false });
}

// Render the multi-watchlist checkbox dropdown for the drawer
function renderDrawerWatchlistDropdown(symbol) {
  const wlList = document.getElementById("drawer-wl-list");
  if (!wlList) return;

  wlList.innerHTML = state.watchlists.map(list => {
    const isIn = list.symbols.includes(symbol);
    const isDefault = list.id === state.defaultWatchlistId;
    return `
      <label class="drawer-wl-item" data-list-id="${list.id}" style="display:flex; align-items:center; gap:8px; padding:6px 12px; cursor:pointer; font-size:13px; color:var(--text-primary); transition:background 0.15s;" onmouseover="this.style.background='var(--bg-hover)'" onmouseout="this.style.background='transparent'">
        <input type="checkbox" ${isIn ? 'checked' : ''} data-list-id="${list.id}" style="cursor:pointer; width:15px; height:15px; accent-color:var(--primary);">
        <span style="flex:1;">${isDefault ? '★ ' : ''}${list.name}</span>
        <span style="font-size:11px; color:var(--text-muted);">${list.symbols.length}</span>
      </label>
    `;
  }).join("");

  // Checkbox change listeners
  wlList.querySelectorAll("input[type='checkbox']").forEach(cb => {
    cb.addEventListener("change", async () => {
      const listId = cb.dataset.listId;
      const list = state.watchlists.find(l => l.id === listId);
      if (!list) return;

      if (cb.checked) {
        if (!list.symbols.includes(symbol)) {
          list.symbols.push(symbol);
        }
      } else {
        list.symbols = list.symbols.filter(s => s !== symbol);
      }

      await saveWatchlistsToStorage();
      renderUI();
      updateDrawerWatchlistControls(symbol);
      // Re-render dropdown to update counts
      renderDrawerWatchlistDropdown(symbol);
    });
  });
}

async function renderDrawerAlerts(symbol) {
  const container = document.getElementById("drawer-alerts-list");
  if (!container) return;

  const { alerts } = await chrome.storage.local.get("alerts");
  const stockAlerts = (alerts || [])
    .map((a, idx) => ({ ...a, _idx: idx }))
    .filter(a => a.symbol === symbol);

  if (stockAlerts.length === 0) {
    container.innerHTML = `<div class="drawer-alert-empty">No alerts set for this stock</div>`;
    return;
  }

  container.innerHTML = stockAlerts.map(a => {
    const dotClass = a.triggered ? 'triggered' : 'armed';
    const statusText = a.triggered ? 'Triggered' : 'Armed';
    return `
      <div class="drawer-alert-item">
        <div class="drawer-alert-item-info">
          <span class="drawer-alert-dot ${dotClass}"></span>
          <span class="drawer-alert-condition">${a.condition === 'above' ? '↑ Above' : '↓ Below'} ৳${a.value.toFixed(2)}</span>
          <span class="drawer-alert-status">${statusText}</span>
        </div>
        <button class="drawer-alert-delete-btn" data-index="${a._idx}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
        </button>
      </div>
    `;
  }).join('');

  container.querySelectorAll(".drawer-alert-delete-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const idx = parseInt(btn.dataset.index, 10);
      const { alerts } = await chrome.storage.local.get("alerts");
      if (alerts && alerts[idx] !== undefined) {
        alerts.splice(idx, 1);
        await chrome.storage.local.set({ alerts });
        renderDrawerAlerts(symbol);
      }
    });
  });
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
      const idx = parseInt(btn.dataset.index, 10);
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
  } else if (state.currentView === 'sellplan') {
    renderSellPlanView();
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
    'history': 'Transaction History',
    'sellplan': 'Sell Plan'
  };
  document.getElementById("view-title").innerText = viewTitles[view];

  renderDashboardUI();
}

function renderSidebarWatchlists() {
  const container = document.getElementById("sidebar-watchlists");
  if (!container) return;

  container.innerHTML = state.watchlists.map(list => {
    const isDefault = list.id === state.defaultWatchlistId;
    return `
      <button class="nav-item ${list.id === state.activeId ? 'active' : ''}" data-id="${list.id}" title="Right-click to set as default">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="${isDefault ? 'var(--primary)' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        <span style="flex:1; text-align:left;">${list.name}</span>
        <span style="font-size:10px; color:var(--text-muted); min-width:16px; text-align:right;">${list.symbols.length}</span>
      </button>
    `;
  }).join("");

  container.querySelectorAll(".nav-item").forEach(btn => {
    // Left click: switch to this watchlist
    btn.addEventListener("click", async () => {
      state.activeId = btn.dataset.id;
      await saveWatchlistsToStorage();
      renderDashboardUI();
    });

    // Right click: set as default
    btn.addEventListener("contextmenu", async (e) => {
      e.preventDefault();
      const id = btn.dataset.id;
      if (state.defaultWatchlistId !== id) {
        state.defaultWatchlistId = id;
        await saveWatchlistsToStorage();
        renderSidebarWatchlists();
      }
    });
  });
}

function renderMarketWatchlist() {
  const activeList = state.watchlists.find(l => l.id === state.activeId);
  const tbody = document.getElementById("dashboard-content");
  if (!tbody || !activeList) return;

  // Build data array
  let rows = activeList.symbols.map(symbol => {
    const data = state.instruments[symbol];
    if (!data) return null;
    const price = parseFloat(data.close) || 0;
    const ycp = parseFloat(data.ycp) || 0;
    const change = price - ycp;
    const changePercent = ycp ? (change / ycp) * 100 : 0;
    const volume = parseInt(data.volume, 10) || 0;
    return { symbol, data, price, ycp, change, changePercent, volume, isPositive: change >= 0 };
  }).filter(r => r !== null);

  // Filter by search
  if (state.marketSearch) {
    rows = rows.filter(r => r.symbol.includes(state.marketSearch));
  }

  // Sort
  const { key, dir } = state.marketSort;
  rows.sort((a, b) => {
    let cmp = 0;
    if (key === 'symbol') cmp = a.symbol.localeCompare(b.symbol);
    else if (key === 'price') cmp = a.price - b.price;
    else if (key === 'change') cmp = a.change - b.change;
    else if (key === 'changePercent') cmp = a.changePercent - b.changePercent;
    else if (key === 'volume') cmp = a.volume - b.volume;
    return dir === 'asc' ? cmp : -cmp;
  });

  tbody.innerHTML = rows.map(({ symbol, data, price, change, changePercent, volume, isPositive }) => `
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
        <td>${volume.toLocaleString()}</td>
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
    `).join("");

  // Sort indicators
  document.querySelectorAll("#watchlist-table .sortable-th").forEach(th => {
    const indicator = th.querySelector(".sort-indicator");
    if (th.dataset.sortKey === state.marketSort.key) {
      indicator.textContent = state.marketSort.dir === 'asc' ? ' ▲' : ' ▼';
      th.classList.add('sort-active');
    } else {
      indicator.textContent = '';
      th.classList.remove('sort-active');
    }
  });

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
    const pct = ycp ? (change / ycp) * 100 : 0;
    
    document.querySelector("#index-dsex .stat-value").innerText = price.toLocaleString();
    const changeEl = document.querySelector("#index-dsex .stat-change");
    changeEl.innerText = `${change > 0 ? '+' : ''}${change.toFixed(2)} (${pct.toFixed(2)}%)`;
    changeEl.className = `stat-change ${change >= 0 ? 'positive' : 'negative'}`;
  }
}

function renderPortfolioView() {
  const tbody = document.getElementById("portfolio-content");
  if (!tbody) return;

  // ── Step 1: Aggregate history into holdings ──
  const holdings = {};
  let totalCashFlow = 0;

  // Sort chronologically (oldest first) for correct cost-basis tracking
  const sortedHistory = [...state.history].sort((a, b) => new Date(a.date) - new Date(b.date) || (a.id || 0) - (b.id || 0));

  sortedHistory.forEach(tx => {
    const symbol = tx.symbol;
    if (!holdings[symbol]) {
      holdings[symbol] = {
        totalSharesBought: 0,
        totalCashInvested: 0,
        totalRawInvested: 0,  // cumulative raw cost of all buys
        totalRawEarned: 0,    // cumulative raw proceeds of all sells
        remainingShares: 0,
        realisedPL: 0,
        netCashFlow: 0,
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
      holdings[symbol].totalRawInvested += rawTotal;
      holdings[symbol].remainingShares += txCount;
      holdings[symbol].netCashFlow -= spent;
      totalCashFlow -= spent;
    } else if (tx.type === 'sell') {
      const earned = rawTotal - commission;
      // Clamp to prevent negative remaining shares
      const sellCount = Math.min(txCount, holdings[symbol].totalSharesBought);

      const avgCostPerShare = holdings[symbol].totalSharesBought > 0 ? (holdings[symbol].totalCashInvested / holdings[symbol].totalSharesBought) : 0;
      const costOfSoldShares = sellCount * avgCostPerShare;
      holdings[symbol].realisedPL += (earned - costOfSoldShares);

      // Track actual raw sell proceeds (for effective avg price)
      holdings[symbol].totalRawEarned += rawTotal;
      holdings[symbol].totalSharesBought -= sellCount;
      holdings[symbol].totalCashInvested -= costOfSoldShares;

      holdings[symbol].remainingShares -= txCount;
      holdings[symbol].netCashFlow += earned;
      totalCashFlow += earned;
    } else if (tx.type === 'cash_dividend') {
      // Cash dividend: income received = count * price_per_share (dividend rate)
      const dividendIncome = rawTotal;
      holdings[symbol].realisedPL += dividendIncome;
      holdings[symbol].totalRawEarned += dividendIncome;
      holdings[symbol].netCashFlow += dividendIncome;
      totalCashFlow += dividendIncome;
    } else if (tx.type === 'stock_dividend') {
      // Stock/bonus dividend: free shares received at zero cost
      holdings[symbol].totalSharesBought += txCount;
      holdings[symbol].remainingShares += txCount;
      // No cash impact, no cost impact - this naturally lowers the avg price
    }
  });

  // ── Step 2: Build data rows with computed values ──
  const allSymbols = Object.keys(holdings).filter(s => holdings[s].remainingShares !== 0 || holdings[s].netCashFlow !== 0);

  let rows = allSymbols.map(symbol => {
    const h = holdings[symbol];
    const data = state.instruments[symbol];
    const currentPrice = data ? (parseFloat(data.close) || 0) : 0;

    // Effective avg price per share = (total raw spent on buys - total raw earned from sells) / remaining shares
    const netAvgPrice = h.remainingShares > 0 ? ((h.totalRawInvested - h.totalRawEarned) / h.remainingShares) : 0;
    // Cost basis per share (with commission) for P/L calculations
    const costBasisPerShare = h.totalSharesBought > 0 ? (h.totalCashInvested / h.totalSharesBought) : 0;
    const remainingValue = h.remainingShares * currentPrice;

    const unrealisedPL = h.remainingShares > 0 ? (remainingValue - (h.remainingShares * costBasisPerShare)) : 0;
    const totalPL = h.realisedPL + unrealisedPL;

    // Extra computed fields for richer display
    const totalInvested = h.remainingShares > 0 ? (h.remainingShares * costBasisPerShare) : 0;
    const totalPLPct = totalInvested > 0 ? (totalPL / totalInvested) * 100 : 0;
    const unrealisedPLPct = totalInvested > 0 ? (unrealisedPL / totalInvested) * 100 : 0;
    const priceVsAvg = netAvgPrice > 0 ? ((currentPrice - netAvgPrice) / netAvgPrice) * 100 : 0;

    return {
      symbol,
      currentPrice,
      remainingShares: h.remainingShares,
      netCashFlow: h.netCashFlow,
      netAvgPrice,
      unrealisedPL,
      unrealisedPLPct,
      realisedPL: h.realisedPL,
      totalPL,
      totalPLPct,
      remainingValue,
      priceVsAvg
    };
  });

  // ── Step 3: Apply search filter ──
  if (state.portfolioSearch) {
    rows = rows.filter(r => r.symbol.includes(state.portfolioSearch));
  }

  // ── Step 4: Apply P/L filter ──
  if (state.portfolioFilterPL === 'profit') {
    rows = rows.filter(r => r.totalPL > 0);
  } else if (state.portfolioFilterPL === 'loss') {
    rows = rows.filter(r => r.totalPL < 0);
  }

  // ── Step 5: Apply holding filter ──
  if (state.portfolioFilterHolding === 'active') {
    rows = rows.filter(r => r.remainingShares > 0);
  } else if (state.portfolioFilterHolding === 'closed') {
    rows = rows.filter(r => r.remainingShares === 0);
  }

  // ── Step 6: Apply sort ──
  const { key: sortKey, dir: sortDir } = state.portfolioSort;
  rows.sort((a, b) => {
    let valA = a[sortKey];
    let valB = b[sortKey];
    if (typeof valA === 'string') {
      valA = valA.toLowerCase();
      valB = valB.toLowerCase();
      return sortDir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
    }
    return sortDir === 'asc' ? valA - valB : valB - valA;
  });

  // ── Step 7: Update sort indicators in header ──
  document.querySelectorAll("#portfolio-table .sortable-th").forEach(th => {
    const indicator = th.querySelector(".sort-indicator");
    if (!indicator) return;
    if (th.dataset.sortKey === sortKey) {
      indicator.textContent = sortDir === 'asc' ? ' ▲' : ' ▼';
      th.classList.add('sort-active');
    } else {
      indicator.textContent = '';
      th.classList.remove('sort-active');
    }
  });

  // ── Step 8: Compute totals (from ALL unfiltered data for summary cards) ──
  let totalPortfolioValue = 0;
  let totalRealisedPL = 0;
  let totalUnrealisedPL = 0;
  const pieData = [];

  // Use allSymbols for summary cards (unfiltered)
  allSymbols.forEach(symbol => {
    const h = holdings[symbol];
    const data = state.instruments[symbol];
    const currentPrice = data ? (parseFloat(data.close) || 0) : 0;
    const remainingValue = h.remainingShares * currentPrice;
    const origAvgCost = h.totalSharesBought > 0 ? (h.totalCashInvested / h.totalSharesBought) : 0;
    const unrealisedPL = h.remainingShares > 0 ? (remainingValue - (h.remainingShares * origAvgCost)) : 0;

    totalPortfolioValue += remainingValue;
    totalRealisedPL += h.realisedPL;
    totalUnrealisedPL += unrealisedPL;

    if (h.remainingShares > 0 && remainingValue > 0) {
      pieData.push({ symbol, value: remainingValue, shares: h.remainingShares });
    }
  });

  // ── Step 9: Render table rows ──
  const noResults = document.getElementById("portfolio-no-results");
  const tableEl = document.getElementById("portfolio-table");

  if (rows.length === 0 && allSymbols.length > 0) {
    // Have data but filters hid everything
    if (noResults) noResults.style.display = '';
    if (tableEl) tableEl.style.display = 'none';
    tbody.innerHTML = '';
  } else {
    if (noResults) noResults.style.display = 'none';
    if (tableEl) tableEl.style.display = '';

    tbody.innerHTML = rows.map(r => {
      const plColor = r.totalPL >= 0 ? 'var(--green)' : 'var(--red)';
      const plBg = r.totalPL >= 0 ? 'var(--green-bg)' : 'var(--red-bg)';
      const plSign = r.totalPL >= 0 ? '+' : '';
      const priceCompare = r.priceVsAvg >= 0 ? '▲' : '▼';
      const priceCompareColor = r.priceVsAvg >= 0 ? 'var(--green)' : 'var(--red)';
      const isActive = r.remainingShares > 0;
      const hasNote = !!(state.stockNotes[r.symbol] && state.stockNotes[r.symbol].trim());

      return `
      <tr style="border-left:3px solid ${isActive ? plColor : 'var(--border-color)'}; ${!isActive ? 'opacity:0.55;' : ''}">
        <td>
          <div style="display:flex; align-items:center; gap:6px;">
            <span style="font-weight:700;">${r.symbol}</span>
            <span class="stock-note-btn" data-symbol="${r.symbol}" title="${hasNote ? 'View/edit notes' : 'Add notes'}" style="cursor:pointer; font-size:12px; opacity:${hasNote ? '1' : '0.3'}; transition:opacity 0.15s;">${hasNote ? '📝' : '📝'}</span>
          </div>
          ${isActive ? `<div style="font-size:10px; color:var(--text-muted);">${r.remainingShares} shares</div>` : '<div style="font-size:10px; color:var(--text-muted);">Closed</div>'}
        </td>
        <td>
          <div>${r.currentPrice > 0 ? '৳' + r.currentPrice.toFixed(2) : '—'}</div>
          ${r.netAvgPrice > 0 && r.currentPrice > 0 ? `<div style="font-size:10px; color:${priceCompareColor};">${priceCompare} ${Math.abs(r.priceVsAvg).toFixed(1)}% vs avg</div>` : ''}
        </td>
        <td>
          <div>৳ ${r.remainingValue.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 0})}</div>
          ${isActive ? `<div style="font-size:10px; color:var(--text-muted);">${r.remainingShares} × ৳${r.currentPrice.toFixed(2)}</div>` : ''}
        </td>
        <td class="avg-price-clickable" data-symbol="${r.symbol}" style="cursor:pointer; text-decoration:underline dotted; text-underline-offset:3px;" title="Click to see breakdown">
          ৳${r.netAvgPrice.toFixed(2)}
        </td>
        <td>
          <div class="${r.unrealisedPL >= 0 ? 'positive' : 'negative'}">৳ ${r.unrealisedPL.toLocaleString(undefined, {minimumFractionDigits: 2})}</div>
          ${isActive ? `<span class="pl-badge ${r.unrealisedPLPct >= 0 ? 'profit' : 'loss'}">${r.unrealisedPLPct >= 0 ? '+' : ''}${r.unrealisedPLPct.toFixed(1)}%</span>` : ''}
        </td>
        <td class="${r.realisedPL >= 0 ? 'positive' : 'negative'}">৳ ${r.realisedPL.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
        <td>
          <div style="font-weight:700; color:${plColor};">৳ ${r.totalPL.toLocaleString(undefined, {minimumFractionDigits: 2})}</div>
          <span class="pl-badge ${r.totalPL >= 0 ? 'profit' : 'loss'}">${plSign}${r.totalPLPct.toFixed(1)}%</span>
        </td>
      </tr>
    `;
    }).join("");
  }

  // ── Step 9b: Render card view ──
  const cardsContainer = document.getElementById("portfolio-cards-container");
  if (cardsContainer) {
    if (rows.length === 0 && allSymbols.length > 0) {
      cardsContainer.innerHTML = '';
    } else {
      cardsContainer.innerHTML = rows.map(r => {
        const plColor = r.totalPL >= 0 ? 'var(--green)' : 'var(--red)';
        const isActive = r.remainingShares > 0;
        const plSign = r.totalPL >= 0 ? '+' : '';
        const accentClass = !isActive ? 'neutral' : (r.totalPL >= 0 ? 'profit' : 'loss');
        const priceCompare = r.priceVsAvg >= 0 ? '▲' : '▼';
        const priceCompareColor = r.priceVsAvg >= 0 ? 'var(--green)' : 'var(--red)';
        const hasNote = !!(state.stockNotes[r.symbol] && state.stockNotes[r.symbol].trim());
        const notePreview = hasNote ? state.stockNotes[r.symbol].trim().slice(0, 60) + (state.stockNotes[r.symbol].trim().length > 60 ? '…' : '') : '';

        return `
        <div class="portfolio-card ${!isActive ? 'closed' : ''}">
          <div class="card-accent ${accentClass}"></div>
          <div class="card-top">
            <div>
              <div class="card-symbol" style="display:flex; align-items:center; gap:6px;">
                ${r.symbol}
                <span class="stock-note-btn" data-symbol="${r.symbol}" title="${hasNote ? 'View/edit notes' : 'Add notes'}" style="cursor:pointer; font-size:12px; opacity:${hasNote ? '1' : '0.3'};">${hasNote ? '📝' : '📝'}</span>
              </div>
              <div class="card-shares">${isActive ? r.remainingShares + ' shares' : 'Closed'}</div>
            </div>
            <div class="card-pl-total">
              <div class="amount" style="color:${plColor};">${plSign}৳${Math.abs(r.totalPL).toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 0})}</div>
              <span class="pl-badge ${r.totalPL >= 0 ? 'profit' : 'loss'}">${plSign}${r.totalPLPct.toFixed(1)}%</span>
            </div>
          </div>
          <div class="card-metrics">
            <div class="metric">
              <span class="metric-label">Current Price</span>
              <span class="metric-value">${r.currentPrice > 0 ? '৳' + r.currentPrice.toFixed(2) : '—'}</span>
            </div>
            <div class="metric">
              <span class="metric-label">Market Value</span>
              <span class="metric-value">৳${r.remainingValue.toLocaleString(undefined, {maximumFractionDigits: 0})}</span>
            </div>
            <div class="metric">
              <span class="metric-label">Unrealised P/L</span>
              <span class="metric-value ${r.unrealisedPL >= 0 ? 'positive' : 'negative'}">৳${r.unrealisedPL.toLocaleString(undefined, {minimumFractionDigits: 0})} <span class="pl-badge ${r.unrealisedPLPct >= 0 ? 'profit' : 'loss'}">${r.unrealisedPLPct >= 0 ? '+' : ''}${r.unrealisedPLPct.toFixed(1)}%</span></span>
            </div>
            <div class="metric">
              <span class="metric-label">Realised P/L</span>
              <span class="metric-value ${r.realisedPL >= 0 ? 'positive' : 'negative'}">৳${r.realisedPL.toLocaleString(undefined, {minimumFractionDigits: 0})}</span>
            </div>
          </div>
          <div class="card-footer">
            <span class="avg-link avg-price-card-clickable" data-symbol="${r.symbol}">Avg ৳${r.netAvgPrice.toFixed(2)}</span>
            ${r.netAvgPrice > 0 && r.currentPrice > 0 ? `<span class="price-vs-avg" style="color:${priceCompareColor};">${priceCompare} ${Math.abs(r.priceVsAvg).toFixed(1)}% vs avg</span>` : ''}
          </div>
          ${hasNote ? `<div style="margin-top:8px; padding:8px 10px; background:var(--bg-hover); border-radius:6px; font-size:11px; color:var(--text-muted); line-height:1.4; cursor:pointer;" class="stock-note-btn" data-symbol="${r.symbol}">💡 ${notePreview}</div>` : ''}
        </div>`;
      }).join('');
    }
  }

  // ── Toggle visibility based on view mode ──
  const tableWrapper = document.getElementById('portfolio-table')?.closest('.table-container');
  if (state.portfolioViewMode === 'cards') {
    if (tableWrapper) tableWrapper.style.display = 'none';
    if (cardsContainer) cardsContainer.style.display = '';
  } else {
    if (tableWrapper) tableWrapper.style.display = '';
    if (cardsContainer) cardsContainer.style.display = 'none';
  }

  // Avg price breakdown click handlers (table)
  tbody.querySelectorAll(".avg-price-clickable").forEach(td => {
    td.addEventListener("click", (e) => {
      e.stopPropagation();
      showAvgPriceBreakdown(td.dataset.symbol);
    });
  });

  // Avg price breakdown click handlers (cards)
  if (cardsContainer) {
    cardsContainer.querySelectorAll(".avg-price-card-clickable").forEach(el => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        showAvgPriceBreakdown(el.dataset.symbol);
      });
    });
  }

  // Stock notes click handlers (table + cards)
  document.querySelectorAll(".stock-note-btn").forEach(el => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      showStockNotesModal(el.dataset.symbol);
    });
  });

  // ── Step 10: Update summary cards ──
  const totalPL = totalRealisedPL + totalUnrealisedPL;
  const totalInvestment = totalPortfolioValue - totalUnrealisedPL;
  const totalPLPct = totalInvestment > 0 ? (totalPL / Math.abs(totalInvestment)) * 100 : 0;

  // Portfolio Value card
  const pvEl = document.getElementById("portfolio-total-value");
  if (pvEl) {
    pvEl.innerText = `৳ ${totalPortfolioValue.toLocaleString(undefined, {maximumFractionDigits: 0})}`;
  }

  // Total Investment card
  const tiEl = document.getElementById("portfolio-total-invested");
  if (tiEl) tiEl.innerText = `৳ ${totalInvestment.toLocaleString(undefined, {maximumFractionDigits: 0})}`;

  // Cash Balance card
  const cbEl = document.getElementById("portfolio-cash-balance");
  if (cbEl) {
    cbEl.innerText = `৳ ${totalCashFlow.toLocaleString(undefined, {maximumFractionDigits: 0})}`;
    cbEl.className = `stat-value ${totalCashFlow >= 0 ? 'positive' : 'negative'}`;
  }

  // Holdings count
  const hcEl = document.getElementById("portfolio-holdings-count");
  if (hcEl) {
    const activeCount = rows.filter(r => r.remainingShares > 0).length;
    const profitCount = rows.filter(r => r.totalPL > 0).length;
    const lossCount = rows.filter(r => r.totalPL < 0).length;
    hcEl.innerHTML = `<span style="font-size:24px; font-weight:800;">${activeCount}</span><span style="font-size:13px; color:var(--text-muted);"> / ${rows.length}</span>`;
    const hcSub = document.getElementById("portfolio-holdings-breakdown");
    if (hcSub) hcSub.innerHTML = `<span class="positive">${profitCount} profit</span> · <span class="negative">${lossCount} loss</span>`;
  }

  // Unrealised P/L card
  const upEl = document.getElementById("portfolio-unrealised-pl");
  if (upEl) {
    upEl.innerText = `৳ ${totalUnrealisedPL.toLocaleString(undefined, {maximumFractionDigits: 0})}`;
    upEl.className = `stat-value ${totalUnrealisedPL >= 0 ? 'positive' : 'negative'}`;
  }

  // Realised P/L card
  const rpEl = document.getElementById("portfolio-realised-pl");
  if (rpEl) {
    rpEl.innerText = `৳ ${totalRealisedPL.toLocaleString(undefined, {maximumFractionDigits: 0})}`;
    rpEl.className = `stat-value ${totalRealisedPL >= 0 ? 'positive' : 'negative'}`;
  }

  // Total P/L card
  const plEl = document.getElementById("portfolio-total-pl");
  if (plEl) {
    plEl.innerText = `৳ ${totalPL.toLocaleString(undefined, {maximumFractionDigits: 0})}`;
    plEl.className = `stat-value ${totalPL >= 0 ? 'positive' : 'negative'}`;
  }
  const plPctEl = document.getElementById("portfolio-total-pl-percent");
  if (plPctEl) {
    plPctEl.innerText = `${totalPL >= 0 ? '+' : ''}${totalPLPct.toFixed(2)}%`;
    plPctEl.className = `stat-change ${totalPL >= 0 ? 'positive' : 'negative'}`;
  }

  // Render Pie Chart
  renderPortfolioPieChart(pieData, totalPortfolioValue);
}

// Show a modal breaking down how the avg price/share was derived for a symbol
// Download portfolio data as CSV
function downloadPortfolioCSV() {
  // Replay transaction history to compute holdings (same logic as renderPortfolioView)
  const sortedHistory = [...state.history].sort((a, b) => new Date(a.date) - new Date(b.date) || (a.id || 0) - (b.id || 0));
  const holdings = {};

  sortedHistory.forEach(tx => {
    const symbol = tx.symbol;
    if (!holdings[symbol]) {
      holdings[symbol] = {
        totalSharesBought: 0, totalCashInvested: 0,
        totalRawInvested: 0, totalRawEarned: 0,
        remainingShares: 0, realisedPL: 0, netCashFlow: 0
      };
    }
    const txCount = parseFloat(tx.count);
    const txPrice = parseFloat(tx.price);
    const commPct = getEffectiveCommission(tx.commission);
    const rawTotal = txCount * txPrice;
    const commission = rawTotal * (commPct / 100);

    if (tx.type === 'buy') {
      const spent = rawTotal + commission;
      holdings[symbol].totalSharesBought += txCount;
      holdings[symbol].totalCashInvested += spent;
      holdings[symbol].totalRawInvested += rawTotal;
      holdings[symbol].remainingShares += txCount;
      holdings[symbol].netCashFlow -= spent;
    } else if (tx.type === 'sell') {
      const earned = rawTotal - commission;
      const sellCount = Math.min(txCount, holdings[symbol].totalSharesBought);
      const avgCostPerShare = holdings[symbol].totalSharesBought > 0 ? (holdings[symbol].totalCashInvested / holdings[symbol].totalSharesBought) : 0;
      const costOfSoldShares = sellCount * avgCostPerShare;
      holdings[symbol].realisedPL += (earned - costOfSoldShares);
      holdings[symbol].totalRawEarned += rawTotal;
      holdings[symbol].totalSharesBought -= sellCount;
      holdings[symbol].totalCashInvested -= costOfSoldShares;
      holdings[symbol].remainingShares -= txCount;
      holdings[symbol].netCashFlow += earned;
    } else if (tx.type === 'cash_dividend') {
      const dividendIncome = rawTotal;
      holdings[symbol].realisedPL += dividendIncome;
      holdings[symbol].totalRawEarned += dividendIncome;
      holdings[symbol].netCashFlow += dividendIncome;
    } else if (tx.type === 'stock_dividend') {
      holdings[symbol].totalSharesBought += txCount;
      holdings[symbol].remainingShares += txCount;
    }
  });

  // Build rows
  const rows = Object.keys(holdings)
    .filter(s => holdings[s].remainingShares !== 0 || holdings[s].netCashFlow !== 0)
    .map(symbol => {
      const h = holdings[symbol];
      const data = state.instruments[symbol];
      const currentPrice = data ? (parseFloat(data.close) || 0) : 0;
      const netAvgPrice = h.remainingShares > 0 ? ((h.totalRawInvested - h.totalRawEarned) / h.remainingShares) : 0;
      const costBasisPerShare = h.totalSharesBought > 0 ? (h.totalCashInvested / h.totalSharesBought) : 0;
      const remainingValue = h.remainingShares * currentPrice;
      const unrealisedPL = h.remainingShares > 0 ? (remainingValue - (h.remainingShares * costBasisPerShare)) : 0;
      const totalPL = h.realisedPL + unrealisedPL;

      return {
        symbol,
        currentPrice,
        remainingShares: h.remainingShares,
        netCashFlow: h.netCashFlow,
        netAvgPrice,
        remainingValue,
        unrealisedPL,
        realisedPL: h.realisedPL,
        totalPL
      };
    })
    .sort((a, b) => a.symbol.localeCompare(b.symbol));

  if (rows.length === 0) {
    alert("No portfolio data to download. Add some transactions first.");
    return;
  }

  // CSV header and rows
  const headers = ["Stock", "Current Price", "Remaining Shares", "Net Cash Balance", "Eff. Avg Price/Share", "Market Value", "Unrealised P/L", "Realised P/L", "Total P/L"];
  const csvLines = [
    headers.join(","),
    ...rows.map(r => [
      r.symbol,
      r.currentPrice.toFixed(2),
      r.remainingShares,
      r.netCashFlow.toFixed(2),
      r.netAvgPrice.toFixed(2),
      r.remainingValue.toFixed(2),
      r.unrealisedPL.toFixed(2),
      r.realisedPL.toFixed(2),
      r.totalPL.toFixed(2)
    ].join(","))
  ];

  // Summary row
  const totalValue = rows.reduce((s, r) => s + r.remainingValue, 0);
  const totalUnrealised = rows.reduce((s, r) => s + r.unrealisedPL, 0);
  const totalRealised = rows.reduce((s, r) => s + r.realisedPL, 0);
  const totalNetCash = rows.reduce((s, r) => s + r.netCashFlow, 0);
  const grandTotalPL = totalRealised + totalUnrealised;
  csvLines.push("");
  csvLines.push(["TOTAL", "", "", totalNetCash.toFixed(2), "", totalValue.toFixed(2), totalUnrealised.toFixed(2), totalRealised.toFixed(2), grandTotalPL.toFixed(2)].join(","));

  // Download
  const blob = new Blob([csvLines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const date = new Date().toISOString().slice(0, 10);
  a.download = `portfolio_${date}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function showAvgPriceBreakdown(symbol) {
  // Gather all transactions for this symbol, sorted chronologically
  const txs = state.history
    .filter(tx => tx.symbol === symbol)
    .sort((a, b) => new Date(a.date) - new Date(b.date) || (a.id || 0) - (b.id || 0));

  if (txs.length === 0) {
    alert(`No transactions found for ${symbol}.`);
    return;
  }

  // Replay transactions step-by-step to build the breakdown
  let totalShares = 0;
  let totalRawSpent = 0;   // cumulative raw cost of buys
  let totalRawEarned = 0;  // cumulative raw proceeds from sells
  const steps = [];

  txs.forEach(tx => {
    const count = parseFloat(tx.count);
    const price = parseFloat(tx.price);
    const rawTotal = count * price;
    const commPct = getEffectiveCommission(tx.commission);

    if (tx.type === 'buy') {
      totalShares += count;
      totalRawSpent += rawTotal;
      const netPool = totalRawSpent - totalRawEarned;
      const avgAfter = totalShares > 0 ? (netPool / totalShares) : 0;
      steps.push({
        date: tx.date,
        type: 'Buy',
        count,
        price,
        rawTotal,
        commPct,
        totalShares,
        totalRawSpent,
        totalRawEarned,
        netPool,
        avgAfter
      });
    } else if (tx.type === 'sell') {
      const sellCount = Math.min(count, totalShares);
      totalShares -= sellCount;
      totalRawEarned += rawTotal;
      const netPool = totalRawSpent - totalRawEarned;
      const avgAfter = totalShares > 0 ? (netPool / totalShares) : 0;
      steps.push({
        date: tx.date,
        type: 'Sell',
        count: sellCount,
        price,
        rawTotal,
        commPct,
        totalShares,
        totalRawSpent,
        totalRawEarned,
        netPool,
        avgAfter
      });
    } else if (tx.type === 'cash_dividend') {
      totalRawEarned += rawTotal;
      const netPool = totalRawSpent - totalRawEarned;
      const avgAfter = totalShares > 0 ? (netPool / totalShares) : 0;
      steps.push({
        date: tx.date,
        type: 'Cash Div',
        count,
        price,
        rawTotal,
        commPct: 0,
        totalShares,
        totalRawSpent,
        totalRawEarned,
        netPool,
        avgAfter
      });
    } else if (tx.type === 'stock_dividend') {
      totalShares += count;
      const netPool = totalRawSpent - totalRawEarned;
      const avgAfter = totalShares > 0 ? (netPool / totalShares) : 0;
      steps.push({
        date: tx.date,
        type: 'Stock Div',
        count,
        price: 0,
        rawTotal: 0,
        commPct: 0,
        totalShares,
        totalRawSpent,
        totalRawEarned,
        netPool,
        avgAfter
      });
    }
  });

  const finalNetPool = totalRawSpent - totalRawEarned;
  const finalAvg = totalShares > 0 ? (finalNetPool / totalShares) : 0;

  // Build modal HTML
  const modalHTML = `
    <div id="avg-price-modal" class="modal active" style="z-index:1000;">
      <div class="modal-content" style="max-width:1100px; width:95vw; max-height:90vh; overflow:hidden; display:flex; flex-direction:column;">
        <div class="modal-header">
          <div>
            <h3 style="margin:0;">Effective Avg Price — ${symbol}</h3>
            <p style="margin:4px 0 0; font-size:12px; color:var(--text-muted);">How your effective cost per share changed with each transaction</p>
          </div>
          <button id="avg-price-modal-close" class="btn-icon" style="border:none; width:24px; height:24px; cursor:pointer;">✕</button>
        </div>
        <div class="modal-body" style="overflow-y:auto; flex:1;">
          <table class="pro-table" style="width:100%; font-size:12px;">
            <thead>
              <tr>
                <th>#</th>
                <th>Date</th>
                <th>Type</th>
                <th>Qty</th>
                <th>Price</th>
                <th>Amount</th>
                <th>Total Bought</th>
                <th>Total Sold</th>
                <th>Net Pool</th>
                <th>Shares</th>
                <th>Eff. Avg</th>
              </tr>
            </thead>
            <tbody>
              ${steps.map((s, i) => `
                <tr>
                  <td style="color:var(--text-muted);">${i + 1}</td>
                  <td>${s.date}</td>
                  <td><span class="type-pill ${s.type === 'Cash Div' ? 'dividend' : s.type === 'Stock Div' ? 'bonus' : s.type.toLowerCase()}">${s.type}</span></td>
                  <td>${s.count}</td>
                  <td>৳${s.price.toFixed(2)}</td>
                  <td class="${s.type === 'Buy' ? '' : 'positive'}">৳${s.rawTotal.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                  <td>৳${s.totalRawSpent.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                  <td>৳${s.totalRawEarned.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                  <td style="font-weight:600;">৳${s.netPool.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                  <td>${s.totalShares}</td>
                  <td style="font-weight:700; color:var(--primary);">৳${s.avgAfter.toFixed(2)}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>

          <div style="margin-top:16px; padding:12px 16px; background:var(--primary-glow); border-radius:10px; border:1px solid var(--primary);">
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
              <div>
                <div style="font-size:11px; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.5px;">Effective Avg Price / Share</div>
                <div style="font-size:22px; font-weight:800; color:var(--primary); margin-top:2px;">৳ ${finalAvg.toFixed(2)}</div>
              </div>
              <div style="text-align:right;">
                <div style="font-size:11px; color:var(--text-muted);">Remaining Shares: <strong>${totalShares}</strong></div>
                <div style="font-size:11px; color:var(--text-muted);">Total Spent (Buys): <strong>৳${totalRawSpent.toLocaleString(undefined, {minimumFractionDigits: 2})}</strong></div>
                <div style="font-size:11px; color:var(--text-muted);">Total Earned (Sells): <strong>৳${totalRawEarned.toLocaleString(undefined, {minimumFractionDigits: 2})}</strong></div>
                <div style="font-size:11px; color:var(--text-muted);">Net Investment Pool: <strong>৳${finalNetPool.toLocaleString(undefined, {minimumFractionDigits: 2})}</strong></div>
              </div>
            </div>
          </div>

          <div style="margin-top:12px; font-size:11px; color:var(--text-muted); line-height:1.6;">
            <strong>How it works:</strong> Each <span class="type-pill buy" style="font-size:10px;">Buy</span> adds to your total spent.
            Each <span class="type-pill sell" style="font-size:10px;">Sell</span> adds to your total earned.
            <strong>Net Pool</strong> = Total Spent − Total Earned. <strong>Effective Avg</strong> = Net Pool ÷ Remaining Shares.
            Selling at a profit reduces your effective cost; selling at a loss increases it. Commission excluded from avg display but included in P/L.
          </div>
        </div>
        <div class="modal-footer">
          <button id="avg-price-modal-done" class="btn-primary" style="width:100%;">Done</button>
        </div>
      </div>
    </div>
  `;

  // Remove existing modal if any
  document.getElementById("avg-price-modal")?.remove();

  // Insert modal
  document.body.insertAdjacentHTML("beforeend", modalHTML);

  // Close handlers
  const closeModal = () => document.getElementById("avg-price-modal")?.remove();
  document.getElementById("avg-price-modal-close")?.addEventListener("click", closeModal);
  document.getElementById("avg-price-modal-done")?.addEventListener("click", closeModal);
  document.getElementById("avg-price-modal")?.addEventListener("click", (e) => {
    if (e.target.id === "avg-price-modal") closeModal();
  });
}

function renderPortfolioPieChart(data, totalValue) {
  const container = document.getElementById("portfolio-pie-container");
  const card = document.getElementById("portfolio-pie-card");
  if (!container || !card) return;

  if (data.length === 0) {
    card.style.display = "none";
    return;
  }
  card.style.display = "";

  const COLORS = [
    '#6366f1', '#f59e0b', '#10b981', '#ef4444', '#3b82f6',
    '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#06b6d4',
    '#84cc16', '#e11d48', '#7c3aed', '#0ea5e9', '#d946ef'
  ];

  const size = 200;
  const cx = size / 2;
  const cy = size / 2;
  const outerR = 90;
  const innerR = 55; // donut hole

  let cumAngle = -Math.PI / 2; // start from top
  const paths = [];

  data.forEach((item, i) => {
    const pct = item.value / totalValue;
    const angle = pct * 2 * Math.PI;

    if (data.length === 1) {
      // Full circle for single holding
      paths.push(`<circle cx="${cx}" cy="${cy}" r="${outerR}" fill="${COLORS[i % COLORS.length]}" />`);
      paths.push(`<circle cx="${cx}" cy="${cy}" r="${innerR}" fill="var(--bg-card)" />`);
    } else {
      const x1o = cx + outerR * Math.cos(cumAngle);
      const y1o = cy + outerR * Math.sin(cumAngle);
      const x1i = cx + innerR * Math.cos(cumAngle);
      const y1i = cy + innerR * Math.sin(cumAngle);

      const x2o = cx + outerR * Math.cos(cumAngle + angle);
      const y2o = cy + outerR * Math.sin(cumAngle + angle);
      const x2i = cx + innerR * Math.cos(cumAngle + angle);
      const y2i = cy + innerR * Math.sin(cumAngle + angle);

      const largeArc = angle > Math.PI ? 1 : 0;

      const d = [
        `M ${x1o} ${y1o}`,
        `A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2o} ${y2o}`,
        `L ${x2i} ${y2i}`,
        `A ${innerR} ${innerR} 0 ${largeArc} 0 ${x1i} ${y1i}`,
        `Z`
      ].join(' ');

      paths.push(`<path d="${d}" fill="${COLORS[i % COLORS.length]}" stroke="var(--bg-card)" stroke-width="1.5" />`);
    }

    cumAngle += angle;
  });

  // Center text
  const centerText = `
    <text x="${cx}" y="${cy - 6}" text-anchor="middle" fill="var(--text-primary)" font-size="14" font-weight="700">
      ৳${totalValue >= 1000 ? (totalValue / 1000).toFixed(0) + 'K' : totalValue.toFixed(0)}
    </text>
    <text x="${cx}" y="${cx + 12}" text-anchor="middle" fill="var(--text-muted)" font-size="10">
      ${data.length} stock${data.length > 1 ? 's' : ''}
    </text>
  `;

  const svg = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${paths.join('')}${centerText}</svg>`;

  // Legend
  const legend = [...data]
    .sort((a, b) => b.value - a.value)
    .map((item, i) => {
      const pct = ((item.value / totalValue) * 100).toFixed(1);
      const color = COLORS[data.indexOf(item) % COLORS.length];
      return `
        <div class="pie-legend-item">
          <span class="pie-legend-dot" style="background:${color};"></span>
          <span class="pie-legend-symbol">${item.symbol}</span>
          <span class="pie-legend-shares">${item.shares} shares</span>
          <span class="pie-legend-pct">${pct}%</span>
        </div>
      `;
    }).join('');

  container.innerHTML = `
    <div class="pie-chart-wrap">${svg}</div>
    <div class="pie-legend-wrap">${legend}</div>
  `;
}

function getSellPlanHoldings() {
  const holdings = {};
  state.history.forEach(tx => {
    const symbol = tx.symbol;
    if (!holdings[symbol]) holdings[symbol] = { remainingShares: 0, netCashFlow: 0 };
    const txCount = parseFloat(tx.count);
    const txPrice = parseFloat(tx.price);
    const commPct = getEffectiveCommission(tx.commission);
    const rawTotal = txCount * txPrice;
    const comm = rawTotal * (commPct / 100);
    if (tx.type === 'buy') {
      holdings[symbol].remainingShares += txCount;
      holdings[symbol].netCashFlow -= (rawTotal + comm);
    } else {
      holdings[symbol].remainingShares -= txCount;
      holdings[symbol].netCashFlow += (rawTotal - comm);
    }
  });
  return holdings;
}

function renderSellPlanView() {
  renderCapitalRecovery();
  renderTieredProfitTaking();
}

function renderCapitalRecovery() {
  const tbody = document.getElementById("sellplan-recovery-content");
  if (!tbody) return;

  const holdings = getSellPlanHoldings();
  const symbols = Object.keys(holdings).filter(s => holdings[s].remainingShares > 0);

  if (symbols.length === 0) {
    tbody.innerHTML = `<tr><td colspan="13" style="text-align:center; padding:32px; color:var(--text-muted);">No active holdings.</td></tr>`;
    return;
  }

  const fmtP = v => `৳${v.toFixed(2)}`;
  const fmtR = v => `৳${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

  let totalInvested = 0, totalFreeVal8 = 0, totalFreeVal12 = 0, totalFreeVal20 = 0;

  const rows = symbols.map(symbol => {
    const h = holdings[symbol];
    const data = state.instruments[symbol];
    const currentPrice = data ? (parseFloat(data.close) || 0) : 0;
    const totalShares = h.remainingShares;
    const invested = -h.netCashFlow;
    const avgCost = totalShares > 0 ? Math.max(0, invested / totalShares) : 0;
    const stopLossPrice = avgCost * 0.97;

    // At each target price, how many shares must be sold to recover full investment?
    const calcRecovery = (targetPrice) => {
      if (targetPrice <= 0) return { sell: totalShares, free: 0, freeVal: 0 };
      const sharesToSell = Math.ceil(invested / targetPrice);
      const sell = Math.min(sharesToSell, totalShares);
      const free = totalShares - sell;
      return { sell, free, freeVal: free * targetPrice };
    };

    const p8Price = avgCost * 1.08;
    const p12Price = avgCost * 1.12;
    const p20Price = avgCost * 1.20;

    const r8 = calcRecovery(p8Price);
    const r12 = calcRecovery(p12Price);
    const r20 = calcRecovery(p20Price);

    totalInvested += invested;
    totalFreeVal8 += r8.freeVal;
    totalFreeVal12 += r12.freeVal;
    totalFreeVal20 += r20.freeVal;

    const renderTier = (r, price) => `
      <td class="sellplan-cell-profit" style="text-align:center;">${r.sell}
        <span class="sellplan-total">@ ${fmtP(price)}</span>
      </td>
      <td class="sellplan-cell-profit" style="text-align:center;">
        <span class="sellplan-free">${r.free}</span>
      </td>
      <td class="sellplan-cell-profit" style="text-align:center;">
        <span class="sellplan-free-value">${fmtR(r.freeVal)}</span>
      </td>
    `;

    return `
      <tr>
        <td style="font-weight:700;">${symbol}</td>
        <td>${totalShares}</td>
        <td>${fmtR(invested)}</td>
        <td class="sellplan-cell-loss">
          <div class="sellplan-target-price">${fmtP(stopLossPrice)}</div>
          <span class="sellplan-total">${fmtR(stopLossPrice * totalShares)}</span>
        </td>
        ${renderTier(r8, p8Price)}
        ${renderTier(r12, p12Price)}
        ${renderTier(r20, p20Price)}
      </tr>
    `;
  }).join("");

  const footer = `
    <tr style="border-top:2px solid var(--border-color); font-weight:700;">
      <td colspan="2" style="text-align:right;">Totals</td>
      <td>${fmtR(totalInvested)}</td>
      <td class="sellplan-cell-loss"></td>
      <td class="sellplan-cell-profit"></td>
      <td class="sellplan-cell-profit"></td>
      <td class="sellplan-cell-profit sellplan-free-value">${fmtR(totalFreeVal8)}</td>
      <td class="sellplan-cell-profit"></td>
      <td class="sellplan-cell-profit"></td>
      <td class="sellplan-cell-profit sellplan-free-value">${fmtR(totalFreeVal12)}</td>
      <td class="sellplan-cell-profit"></td>
      <td class="sellplan-cell-profit"></td>
      <td class="sellplan-cell-profit sellplan-free-value">${fmtR(totalFreeVal20)}</td>
    </tr>
  `;

  tbody.innerHTML = rows + footer;
}

function renderTieredProfitTaking() {
  const tbody = document.getElementById("sellplan-content");
  if (!tbody) return;

  const pct1 = parseInt(document.getElementById("sellplan-pct1")?.value) || 30;
  const pct2 = parseInt(document.getElementById("sellplan-pct2")?.value) || 30;
  const pct3 = parseInt(document.getElementById("sellplan-pct3")?.value) || 40;

  const thP8 = document.getElementById("sellplan-th-p8");
  const thP12 = document.getElementById("sellplan-th-p12");
  const thP20 = document.getElementById("sellplan-th-p20");
  if (thP8) thP8.textContent = `Sell ${pct1}% @ +8%`;
  if (thP12) thP12.textContent = `Sell ${pct2}% @ +12%`;
  if (thP20) thP20.textContent = `Sell ${pct3}% @ +20%`;

  const applyBtn = document.getElementById("sellplan-apply-btn");
  if (applyBtn && !applyBtn._bound) {
    applyBtn._bound = true;
    applyBtn.addEventListener("click", () => renderTieredProfitTaking());
  }

  const holdings = getSellPlanHoldings();
  const symbols = Object.keys(holdings).filter(s => holdings[s].remainingShares > 0);

  if (symbols.length === 0) {
    tbody.innerHTML = `<tr><td colspan="12" style="text-align:center; padding:32px; color:var(--text-muted);">No active holdings.</td></tr>`;
    return;
  }

  const fmtP = v => `৳${v.toFixed(2)}`;
  const fmtR = v => `৳${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

  let grandInvested = 0, grandRev1 = 0, grandRev2 = 0, grandRev3 = 0;

  const rows = symbols.map(symbol => {
    const h = holdings[symbol];
    const data = state.instruments[symbol];
    const currentPrice = data ? (parseFloat(data.close) || 0) : 0;
    const totalShares = h.remainingShares;
    const invested = -h.netCashFlow;
    const avgCost = totalShares > 0 ? Math.max(0, invested / totalShares) : 0;

    const stopLossPrice = avgCost * 0.97;
    const p8Price = avgCost * 1.08;
    const p12Price = avgCost * 1.12;
    const p20Price = avgCost * 1.20;

    const sell1 = Math.floor(totalShares * pct1 / 100);
    const sell2 = Math.floor(totalShares * pct2 / 100);
    const sell3 = totalShares - sell1 - sell2;

    const rev1 = sell1 * p8Price;
    const rev2 = sell2 * p12Price;
    const rev3 = sell3 * p20Price;

    grandInvested += invested;
    grandRev1 += rev1;
    grandRev2 += rev2;
    grandRev3 += rev3;

    const plPct = avgCost > 0 ? ((currentPrice - avgCost) / avgCost) * 100 : 0;
    let status = '', statusClass = '';
    if (currentPrice <= 0) {
      status = '—';
    } else if (currentPrice <= stopLossPrice) {
      status = '🔴 Stop Loss'; statusClass = 'negative';
    } else if (currentPrice >= p20Price) {
      status = '🟢 Sell All'; statusClass = 'positive';
    } else if (currentPrice >= p12Price) {
      status = '🟢 Sell T1+T2'; statusClass = 'positive';
    } else if (currentPrice >= p8Price) {
      status = '🟡 Sell T1'; statusClass = '';
    } else {
      status = `${plPct >= 0 ? '⬆' : '⬇'} ${plPct >= 0 ? '+' : ''}${plPct.toFixed(1)}%`;
      statusClass = plPct >= 0 ? 'positive' : 'negative';
    }

    return `
      <tr>
        <td style="font-weight:700;">${symbol}</td>
        <td>${totalShares}</td>
        <td>${fmtP(avgCost)}</td>
        <td style="font-weight:600;">${currentPrice > 0 ? fmtP(currentPrice) : '—'}</td>
        <td class="sellplan-cell-loss">
          <div class="sellplan-target-price">${fmtP(stopLossPrice)}</div>
          <span class="sellplan-total">${fmtR(stopLossPrice * totalShares)}</span>
        </td>
        <td class="sellplan-cell-profit">${sell1}</td>
        <td class="sellplan-cell-profit">
          <div class="sellplan-target-price">${fmtP(p8Price)}</div>
          <span class="sellplan-total">${fmtR(rev1)}</span>
        </td>
        <td class="sellplan-cell-profit">${sell2}</td>
        <td class="sellplan-cell-profit">
          <div class="sellplan-target-price">${fmtP(p12Price)}</div>
          <span class="sellplan-total">${fmtR(rev2)}</span>
        </td>
        <td class="sellplan-cell-profit">${sell3}</td>
        <td class="sellplan-cell-profit">
          <div class="sellplan-target-price">${fmtP(p20Price)}</div>
          <span class="sellplan-total">${fmtR(rev3)}</span>
        </td>
        <td class="${statusClass}" style="font-weight:600; white-space:nowrap;">${status}</td>
      </tr>
    `;
  }).join("");

  const totalRev = grandRev1 + grandRev2 + grandRev3;
  const totalProfit = totalRev - grandInvested;
  const profitPct = grandInvested > 0 ? (totalProfit / grandInvested * 100) : 0;

  const footer = `
    <tr style="border-top:2px solid var(--border-color); font-weight:700;">
      <td colspan="4" style="text-align:right;">Total Invested: ${fmtR(grandInvested)}</td>
      <td class="sellplan-cell-loss"></td>
      <td class="sellplan-cell-profit"></td>
      <td class="sellplan-cell-profit">${fmtR(grandRev1)}</td>
      <td class="sellplan-cell-profit"></td>
      <td class="sellplan-cell-profit">${fmtR(grandRev2)}</td>
      <td class="sellplan-cell-profit"></td>
      <td class="sellplan-cell-profit">${fmtR(grandRev3)}</td>
      <td class="${totalProfit >= 0 ? 'positive' : 'negative'}" style="white-space:nowrap;">
        ${totalProfit >= 0 ? '+' : ''}${fmtR(totalProfit)} (${profitPct.toFixed(1)}%)
      </td>
    </tr>
  `;

  tbody.innerHTML = rows + footer;
}

async function addTransactionFromForm() {
  const submitBtn = document.querySelector("#history-form button[type='submit']");
  if (submitBtn?.disabled) return;
  if (submitBtn) submitBtn.disabled = true;

  const date = document.getElementById("hist-date").value;
  const symbol = document.getElementById("hist-symbol").value.toUpperCase();
  const type = document.getElementById("hist-type").value;
  const count = parseFloat(document.getElementById("hist-count").value);
  const price = parseFloat(document.getElementById("hist-price").value);
  const commission = getEffectiveCommission(document.getElementById("hist-commission").value);

  if (!symbol || isNaN(count) || isNaN(price)) {
    alert("Please fill all required fields correctly.");
    if (submitBtn) submitBtn.disabled = false;
    return;
  }

  if (state.editingTransactionId !== null) {
    // Edit mode: update existing transaction
    const idx = state.history.findIndex(tx => tx.id === state.editingTransactionId);
    if (idx !== -1) {
      state.history[idx] = {
        id: state.editingTransactionId,
        date,
        symbol,
        type,
        count,
        price,
        commission: document.getElementById("hist-commission").value
      };
    }
    state.editingTransactionId = null;
  } else {
    // Add mode: create new transaction
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
  }

  state.history.sort((a, b) => new Date(b.date) - new Date(a.date)); // Sort by date desc

  await saveWatchlistsToStorage();
  
  // Clear inputs & reset form state
  document.getElementById("hist-symbol").value = "";
  document.getElementById("hist-count").value = "";
  document.getElementById("hist-price").value = "";
  
  renderDashboardUI();
  if (submitBtn) submitBtn.disabled = false;
}

function editTransaction(id) {
  const tx = state.history.find(tx => tx.id === id);
  if (!tx) return;

  state.editingTransactionId = id;

  // Populate form fields with the transaction data
  document.getElementById("hist-date").value = tx.date;
  document.getElementById("hist-symbol").value = tx.symbol;
  document.getElementById("hist-type").value = tx.type;
  document.getElementById("hist-count").value = tx.count;
  document.getElementById("hist-price").value = tx.price;
  document.getElementById("hist-commission").value = tx.commission !== undefined && tx.commission !== null ? tx.commission : "0.4";

  // Update form UI to edit mode
  const formTitle = document.getElementById("history-form-title");
  if (formTitle) formTitle.textContent = "Edit Transaction";

  const submitBtn = document.querySelector("#history-form button[type='submit']");
  if (submitBtn) submitBtn.textContent = "Update Transaction";

  const cancelBtn = document.getElementById("cancel-edit-btn");
  if (cancelBtn) cancelBtn.style.display = "inline-flex";

  // Scroll the form into view
  document.querySelector(".history-form-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function cancelEditTransaction() {
  state.editingTransactionId = null;

  // Clear form inputs
  document.getElementById("hist-date").value = new Date().toISOString().slice(0, 10);
  document.getElementById("hist-symbol").value = "";
  document.getElementById("hist-type").value = "buy";
  document.getElementById("hist-count").value = "";
  document.getElementById("hist-price").value = "";
  document.getElementById("hist-commission").value = "0.4";

  // Restore form UI to add mode
  const formTitle = document.getElementById("history-form-title");
  if (formTitle) formTitle.textContent = "Add New Transaction";

  const submitBtn = document.querySelector("#history-form button[type='submit']");
  if (submitBtn) submitBtn.textContent = "Add to History";

  const cancelBtn = document.getElementById("cancel-edit-btn");
  if (cancelBtn) cancelBtn.style.display = "none";
}

function renderHistoryView() {
  const tbody = document.getElementById("history-content");
  if (!tbody) return;

  // Populate symbols datalist for autocompletion
  const datalist = document.getElementById("symbols-list");
  if (datalist) {
    datalist.innerHTML = Object.keys(state.instruments).map(sym => `<option value="${sym}">`).join("");
  }

  // Build computed rows
  let rows = state.history.map(tx => {
    const rawComm = tx.commission;
    const effectiveComm = getEffectiveCommission(rawComm);
    const rawTotal = tx.count * tx.price;
    const commissionVal = rawTotal * (effectiveComm / 100);
    const total = tx.type === 'buy' ? (rawTotal + commissionVal) : (rawTotal - commissionVal);
    return { ...tx, effectiveComm, total };
  });

  // Filter by search
  if (state.historySearch) {
    rows = rows.filter(r => r.symbol.toUpperCase().includes(state.historySearch));
  }

  // Filter by type
  if (state.historyFilterType !== 'all') {
    rows = rows.filter(r => r.type === state.historyFilterType);
  }

  // Sort
  const { key, dir } = state.historySort;
  rows.sort((a, b) => {
    let cmp = 0;
    if (key === 'date') cmp = new Date(a.date) - new Date(b.date);
    else if (key === 'symbol') cmp = a.symbol.localeCompare(b.symbol);
    else if (key === 'type') cmp = a.type.localeCompare(b.type);
    else if (key === 'count') cmp = a.count - b.count;
    else if (key === 'price') cmp = a.price - b.price;
    else if (key === 'total') cmp = a.total - b.total;
    return dir === 'asc' ? cmp : -cmp;
  });

  tbody.innerHTML = rows.map(tx => {
    const typeLabel = tx.type === 'cash_dividend' ? 'Cash Div' : tx.type === 'stock_dividend' ? 'Stock Div' : tx.type;
    const typeClass = tx.type === 'cash_dividend' ? 'dividend' : tx.type === 'stock_dividend' ? 'bonus' : tx.type;
    return `
      <tr${state.editingTransactionId === tx.id ? ' class="editing-row"' : ''}>
        <td>${tx.date}</td>
        <td style="font-weight:700;">${tx.symbol}</td>
        <td><span class="type-pill ${typeClass}">${typeLabel}</span></td>
        <td>${tx.count}</td>
        <td>${parseFloat(tx.price).toFixed(2)}</td>
        <td>${tx.type === 'cash_dividend' || tx.type === 'stock_dividend' ? '—' : tx.effectiveComm + '%'}</td>
        <td style="font-weight:600;">৳ ${tx.total.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
        <td>
          <div class="history-actions">
            <button class="btn-edit-history" data-id="${tx.id}" title="Edit transaction">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="btn-delete-history" data-id="${tx.id}" title="Delete transaction">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2M10 11v6M14 11v6"/></svg>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  // Sort indicators
  document.querySelectorAll("#history-table .sortable-th").forEach(th => {
    const indicator = th.querySelector(".sort-indicator");
    if (th.dataset.sortKey === state.historySort.key) {
      indicator.textContent = state.historySort.dir === 'asc' ? ' ▲' : ' ▼';
      th.classList.add('sort-active');
    } else {
      indicator.textContent = '';
      th.classList.remove('sort-active');
    }
  });

  tbody.querySelectorAll(".btn-edit-history").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = parseInt(btn.dataset.id, 10);
      editTransaction(id);
      renderHistoryView(); // Re-render to highlight the editing row
    });
  });

  tbody.querySelectorAll(".btn-delete-history").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = parseInt(btn.dataset.id, 10);
      // If deleting the transaction being edited, cancel edit mode
      if (state.editingTransactionId === id) {
        cancelEditTransaction();
      }
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
  const layout = state.chartLayout || "list";

  // Apply layout class to container
  container.className = `charts-grid ${layout}-layout`;

  activeList.symbols.forEach(symbol => {
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
          style="border:none;" 
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
  if (buyInput) buyInput.value = current.buyPrice;
  if (qtyInput) qtyInput.value = current.quantity;

  modal.classList.add("active");
}

async function savePortfolioHolding() {
  const symbol = state.editingSymbol;
  const buyPrice = parseFloat(document.getElementById("buy-price-input").value) || 0;
  const quantity = parseInt(document.getElementById("buy-quantity-input").value, 10) || 0;

  if (quantity <= 0) {
    delete state.portfolio[symbol];
  } else {
    state.portfolio[symbol] = { buyPrice, quantity };
  }

  await saveWatchlistsToStorage();
  document.getElementById("portfolio-modal")?.classList.remove("active");
}

function renderMomentumView() {
  const tbody = document.getElementById("momentum-content");
  if (!tbody) return;

  const activeList = state.watchlists.find(l => l.id === state.activeId);
  if (!activeList) return;

  const combinedSymbols = [...new Set([...activeList.symbols, ...Object.keys(state.portfolio)])];

  let momentumData = combinedSymbols.map(sym => {
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

  // Filter by search
  if (state.momentumSearch) {
    momentumData = momentumData.filter(r => r.symbol.includes(state.momentumSearch));
  }

  // Sort
  const { key, dir } = state.momentumSort;
  momentumData.sort((a, b) => {
    let cmp = 0;
    if (key === 'symbol') cmp = a.symbol.localeCompare(b.symbol);
    else if (key === 'ret1m') cmp = a.ret1m - b.ret1m;
    else if (key === 'ret3m') cmp = a.ret3m - b.ret3m;
    else if (key === 'ret6m') cmp = a.ret6m - b.ret6m;
    else if (key === 'ret1y') cmp = a.ret1y - b.ret1y;
    return dir === 'asc' ? cmp : -cmp;
  });

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

  // Sort indicators
  document.querySelectorAll("#momentum-table .sortable-th").forEach(th => {
    const indicator = th.querySelector(".sort-indicator");
    if (th.dataset.sortKey === state.momentumSort.key) {
      indicator.textContent = state.momentumSort.dir === 'asc' ? ' ▲' : ' ▼';
      th.classList.add('sort-active');
    } else {
      indicator.textContent = '';
      th.classList.remove('sort-active');
    }
  });
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
  
  const dailyChange = ycp ? ((price - ycp) / ycp) * 100 : 0;
  
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
  const volume = parseInt(data.volume, 10) || 0;
  
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

// ═══════════════════════════════════════════════════════
//  Stock Notes Modal
// ═══════════════════════════════════════════════════════
function showStockNotesModal(symbol) {
  const existingNote = (state.stockNotes[symbol] || '').trim();

  const modalHTML = `
    <div id="stock-notes-modal" class="modal active" style="z-index:1000;">
      <div class="modal-content" style="max-width:600px; width:90vw; max-height:85vh; overflow:hidden; display:flex; flex-direction:column;">
        <div class="modal-header">
          <div>
            <h3 style="margin:0;">Notes — ${symbol}</h3>
            <p style="margin:4px 0 0; font-size:12px; color:var(--text-muted);">Your research findings and observations</p>
          </div>
          <button id="stock-notes-modal-close" class="btn-icon" style="border:none; width:24px; height:24px; cursor:pointer;">✕</button>
        </div>
        <div class="modal-body" style="flex:1; padding:16px;">
          <textarea id="stock-notes-textarea" placeholder="Write your findings, observations, key metrics, reasons for buying/holding, target prices, risks, etc..."
            style="width:100%; min-height:250px; padding:12px; border:1px solid var(--border-color); border-radius:8px; background:var(--bg-card); color:var(--text-primary); font-size:13px; line-height:1.6; resize:vertical; font-family:inherit;">${existingNote}</textarea>
          <div style="margin-top:8px; font-size:11px; color:var(--text-muted);">
            💡 Tip: Note down key findings like EPS trends, sector outlook, support/resistance levels, upcoming events, etc.
          </div>
        </div>
        <div class="modal-footer" style="display:flex; gap:8px; justify-content:space-between;">
          <button id="stock-notes-delete" class="btn-secondary" style="color:var(--red); border-color:var(--red); ${existingNote ? '' : 'display:none;'}">Delete Note</button>
          <div style="display:flex; gap:8px;">
            <button id="stock-notes-cancel" class="btn-secondary">Cancel</button>
            <button id="stock-notes-save" class="btn-primary">Save Note</button>
          </div>
        </div>
      </div>
    </div>
  `;

  // Remove existing modal if any
  document.getElementById("stock-notes-modal")?.remove();

  // Insert modal
  document.body.insertAdjacentHTML("beforeend", modalHTML);

  // Focus textarea
  const textarea = document.getElementById("stock-notes-textarea");
  setTimeout(() => textarea?.focus(), 100);

  // Close handler
  const closeModal = () => document.getElementById("stock-notes-modal")?.remove();

  document.getElementById("stock-notes-modal-close")?.addEventListener("click", closeModal);
  document.getElementById("stock-notes-cancel")?.addEventListener("click", closeModal);
  document.getElementById("stock-notes-modal")?.addEventListener("click", (e) => {
    if (e.target.id === "stock-notes-modal") closeModal();
  });

  // Save handler
  document.getElementById("stock-notes-save")?.addEventListener("click", async () => {
    const noteText = textarea?.value?.trim() || '';
    if (noteText) {
      state.stockNotes[symbol] = noteText;
    } else {
      delete state.stockNotes[symbol];
    }
    await saveWatchlistsToStorage();
    closeModal();
    renderPortfolioView();
  });

  // Delete handler
  document.getElementById("stock-notes-delete")?.addEventListener("click", async () => {
    delete state.stockNotes[symbol];
    await saveWatchlistsToStorage();
    closeModal();
    renderPortfolioView();
  });
}
