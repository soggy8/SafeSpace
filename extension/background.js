const BACKEND_URL = "http://localhost:5000";
const USAGE_PING_INTERVAL = 1000;
const FOCUS_SYNC_INTERVAL = 10000;

let siteTime = {};
let currentDomain = null;
let isUserActive = true;
let lastActivity = Date.now();
let focusState = {
  active: false,
  blocked_sites: [],
  duration_seconds: 0,
};

chrome.storage.local.get(["siteTime", "focusState"], (data) => {
  if (data.siteTime) siteTime = data.siteTime;
  if (data.focusState) focusState = data.focusState;
});

chrome.tabs.onActivated.addListener(async (info) => {
  try {
    const tab = await getTab(info.tabId);
    handleTabInfo(info.tabId, tab.url || "");
  } catch (err) {
    console.warn("[SafeSpace] Failed to fetch tab info:", err);
  }
});

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === "loading" && tab?.url) {
    handleTabInfo(tabId, tab.url);
  }
});

function handleTabInfo(tabId, url) {
  updateDomain(url);
  enforceFocusMode(tabId, url);
}

function updateDomain(url) {
  if (!url || !url.startsWith("http")) {
    currentDomain = null;
    return;
  }

  try {
    currentDomain = new URL(url).hostname;
  } catch (err) {
    currentDomain = null;
  }
}

setInterval(() => {
  if (!currentDomain) return;

  queryTabs({ active: true, currentWindow: true })
    .then(([tab]) => {
      if (!tab) return;

      if (tab.audible) {
        isUserActive = true;
        lastActivity = Date.now();
      }
    })
    .catch((err) => {
      console.warn("[SafeSpace] Failed to query active tab:", err);
    });

  if (Date.now() - lastActivity > 20000) {
    isUserActive = false;
  }

  if (isUserActive && currentDomain) {
    siteTime[currentDomain] = (siteTime[currentDomain] || 0) + 1;
    chrome.storage.local.set({ siteTime });
  }
}, USAGE_PING_INTERVAL);

setInterval(syncFocusStatus, FOCUS_SYNC_INTERVAL);
syncFocusStatus();

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg) return;

  if (msg.type === "user-active") {
    isUserActive = true;
    lastActivity = Date.now();
  }

  if (msg.type === "get-extension-state") {
    sendResponse({
      siteTime,
      focusState,
    });
    return true;
  }

  if (msg.type === "focus-start") {
    startFocus(msg.blockedSites || [])
      .then((status) => {
        sendResponse({ ok: true, status });
      })
      .catch((error) => {
        console.error("[SafeSpace] Focus start failed", error);
        sendResponse({ ok: false, error: error.message || String(error) });
      });
    return true;
  }

  if (msg.type === "focus-stop") {
    stopFocus()
      .then((status) => {
        sendResponse({ ok: true, status });
      })
      .catch((error) => {
        console.error("[SafeSpace] Focus stop failed", error);
        sendResponse({ ok: false, error: error.message || String(error) });
      });
    return true;
  }
});

async function syncFocusStatus() {
  try {
    const res = await apiFetch("/focus/status");
    focusState = res;
    chrome.storage.local.set({ focusState });
    chrome.runtime.sendMessage({ type: "focus-status", status: focusState });
    await enforceFocusAcrossTabs();
  } catch (error) {
    console.warn("[SafeSpace] Unable to sync focus status:", error);
  }
}

async function startFocus(blockedSites) {
  const cleanSites = (blockedSites || [])
    .map((site) => site.trim().toLowerCase())
    .filter(Boolean);

  const status = await apiFetch("/focus/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blocked_sites: cleanSites }),
  });

  focusState = status;
  chrome.storage.local.set({ focusState });
  chrome.runtime.sendMessage({ type: "focus-status", status: focusState });
  await enforceFocusAcrossTabs();
  return status;
}

async function stopFocus() {
  const status = await apiFetch("/focus/stop", { method: "POST" });
  focusState = status;
  chrome.storage.local.set({ focusState });
  chrome.runtime.sendMessage({ type: "focus-status", status: focusState });
  return status;
}

async function enforceFocusAcrossTabs() {
  if (!focusState.active) return;
  try {
    const tabs = await queryTabs({});
    tabs.forEach((tab) => {
      if (tab.id && tab.url) {
        enforceFocusMode(tab.id, tab.url);
      }
    });
  } catch (error) {
    console.warn("[SafeSpace] Failed to enforce focus across tabs:", error);
  }
}

function enforceFocusMode(tabId, url) {
  if (!focusState.active || !url.startsWith("http")) return;

  try {
    const domain = new URL(url).hostname.toLowerCase();
    const blocked = (focusState.blocked_sites || []).includes(domain);
    if (!blocked) return;

    const redirectUrl = chrome.runtime.getURL(`blocked.html?site=${encodeURIComponent(domain)}`);
    chrome.tabs.update(tabId, { url: redirectUrl });
  } catch (error) {
    console.warn("[SafeSpace] Failed to enforce focus mode:", error);
  }
}

async function apiFetch(path, options = {}) {
  const url = `${BACKEND_URL}${path}`;
  const response = await fetch(url, {
    ...options,
    credentials: "include",
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed (${response.status})`);
  }

  return response.json();
}

function getTab(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(tab);
    });
  });
}

function queryTabs(queryInfo) {
  return new Promise((resolve, reject) => {
    chrome.tabs.query(queryInfo, (tabs) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(tabs);
    });
  });
}
