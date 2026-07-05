// Initialize default watchlists on install
chrome.runtime.onInstalled.addListener(async () => {
  console.log("StockNow Watchlist extension installed.");

  // Check if watchlists exist in storage
  const { watchlists } = await chrome.storage.local.get("watchlists");
  if (!watchlists) {
    const defaultWatchlists = [
      {
        id: "default-list",
        name: "My Watchlist",
        symbols: ["SQURPHARMA", "ITC", "MARICO", "ROBI", "GP", "OLYMPIC", "BSRMSTEEL"]
      }
    ];
    await chrome.storage.local.set({
      watchlists: defaultWatchlists,
      activeWatchlistId: "default-list"
    });
  }

  // Set default polling interval on install
  const { pollingInterval } = await chrome.storage.local.get("pollingInterval");
  if (pollingInterval === undefined) {
    await chrome.storage.local.set({ pollingInterval: 1 });
  }

  // Setup side panel behavior
  if (chrome.sidePanel && chrome.sidePanel.setOptions) {
    await chrome.sidePanel.setOptions({
      path: 'sidepanel.html',
      enabled: true
    });
  }

  // Create context menu to open side panel
  chrome.contextMenus.create({
    id: "open-side-panel",
    title: "Open StockNow Side Panel",
    contexts: ["all"]
  });
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "open-side-panel" && tab) {
    try {
      await chrome.sidePanel.open({ windowId: tab.windowId });
    } catch (error) {
      console.error("Error opening side panel from context menu:", error);
    }
  }
});

// Setup background alarm scheduling and fetch checking
async function setupAlarm(interval) {
  await chrome.alarms.clear("fetch-data-alarm");
  if (interval > 0) {
    chrome.alarms.create("fetch-data-alarm", {
      periodInMinutes: Number(interval)
    });
    console.log(`Alarm configured to run every ${interval} minutes.`);
  } else {
    console.log("Background polling is disabled.");
  }
}

// Background alarm listener
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "fetch-data-alarm") {
    console.log("Background alarm fired. Fetching fresh data...");
    await fetchAndCheckAlerts();
  }
});

// Watch storage changes to dynamically adjust refresh interval
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === "local" && changes.pollingInterval) {
    await setupAlarm(changes.pollingInterval.newValue);
  }
});

// Fetch fresh data and validate price alerts
async function fetchAndCheckAlerts() {
  try {
    const response = await fetch("https://stocknow.com.bd/api/v1/instruments", {
      method: "GET",
      headers: { "Accept": "application/json" }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP Error: ${response.status}`);
    }
    
    const data = await response.json();
    
    // Cache the data
    await chrome.storage.local.set({
      instrumentsData: data,
      instrumentsCachedAt: Date.now()
    });
    
    // Check price target alerts
    const { alerts, enableGoogleChat, googleChatWebhookUrl, enableTelegram, telegramBotToken, telegramChatId } = await chrome.storage.local.get([
      "alerts", "enableGoogleChat", "googleChatWebhookUrl", "enableTelegram", "telegramBotToken", "telegramChatId"
    ]);
    
    if (alerts && alerts.length > 0) {
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
          
          // Trigger browser native banner alert notification
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
      }
    }
  } catch (error) {
    console.error("Error in background fetchAndCheckAlerts:", error);
  }
}

// Initialize alarms on worker wake-up
async function initializeAlarms() {
  const { pollingInterval } = await chrome.storage.local.get("pollingInterval");
  const interval = pollingInterval !== undefined ? pollingInterval : 1;
  await setupAlarm(interval);
}
initializeAlarms();

// Dispatch notification to Google Chat via Webhook
function sendGoogleChatNotification(webhookUrl, title, message) {
  if (!webhookUrl) return;
  const payload = {
    text: `🔔 *${title}*\n${message}`
  };
  fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  }).catch(err => console.error("Error sending Google Chat notification:", err));
}

// Dispatch notification to Telegram via Bot API
function sendTelegramNotification(botToken, chatId, message, callback) {
  if (!botToken || !chatId) {
    if (callback) callback({ success: false, error: "Missing credentials" });
    return;
  }
  const payload = {
    chat_id: chatId,
    text: message,
    parse_mode: "Markdown"
  };
  fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  })
  .then(async (response) => {
    if (!response.ok) {
      const errText = await response.text();
      let errMsg = "API Error";
      try {
        const errJson = JSON.parse(errText);
        errMsg = errJson.description || errMsg;
      } catch (e) {}
      console.error(`Telegram API Error (Status ${response.status}):`, errText);
      if (callback) callback({ success: false, error: errMsg });
    } else {
      console.log("Telegram notification sent successfully.");
      if (callback) callback({ success: true });
    }
  })
  .catch(err => {
    console.error("Error sending Telegram notification:", err);
    if (callback) callback({ success: false, error: err.message || "Network Error" });
  });
}

// Listen for messages from popup/sidepanel to delegate webhooks (bypassing CORS)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "send-gchat-notification") {
    sendGoogleChatNotification(
      message.webhookUrl,
      message.title,
      message.messageText
    );
    sendResponse({ success: true });
  } else if (message.action === "send-telegram-notification") {
    sendTelegramNotification(
      message.botToken,
      message.chatId,
      message.messageText,
      (result) => {
        sendResponse(result);
      }
    );
    return true; // Keep message channel open for asynchronous sendResponse
  }
});
