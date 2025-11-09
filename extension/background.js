const BACKEND_URL = "http://localhost:5000";
const USAGE_PING_INTERVAL = 1000;
const FOCUS_SYNC_INTERVAL = 10000;
const KEYWORD_REFRESH_INTERVAL = 10 * 60 * 1000; // 10 minutes
const SAFE_MODE_STORAGE_KEY = "safeBrowsingEnabled";
const REPORT_CACHE_TTL = 60 * 1000; // 1 minute

let siteTime = {};
let currentDomain = null;
let isUserActive = true;
let lastActivity = Date.now();
let focusState = {
  active: false,
  blocked_sites: [],
  duration_seconds: 0,
};
let moderationKeywords = [];
let keywordsFetchedAt = 0;
let keywordsPromise = null;
let safeBrowsingEnabled = true;
const reportedContentCache = new Map();

chrome.storage.local.get(["siteTime", "focusState"], (data) => {
  if (chrome.runtime.lastError) {
    console.warn("[SafeSpace] storage get failed:", chrome.runtime.lastError);
    return;
  }
  const snapshot = data || {};
  if (snapshot.siteTime) siteTime = snapshot.siteTime;
  if (snapshot.focusState) focusState = snapshot.focusState;
});

chrome.storage.local.get([SAFE_MODE_STORAGE_KEY], (data) => {
  if (chrome.runtime.lastError) {
    console.warn("[SafeSpace] safe-mode load failed:", chrome.runtime.lastError);
    return;
  }
  if (typeof data?.[SAFE_MODE_STORAGE_KEY] === "boolean") {
    safeBrowsingEnabled = data[SAFE_MODE_STORAGE_KEY];
  }
  broadcastSafeMode(safeBrowsingEnabled);
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
loadModerationKeywords().catch((error) => {
  console.warn("[SafeSpace] Unable to preload moderation keywords:", error);
});
setInterval(() => {
  loadModerationKeywords(true).catch((error) => {
    console.warn("[SafeSpace] Unable to refresh moderation keywords:", error);
  });
}, KEYWORD_REFRESH_INTERVAL);

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

  if (msg.type === "open-dashboard") {
    openDashboardTab(msg.url || `${BACKEND_URL}/dashboard/`)
      .then((tab) => {
        sendResponse({ ok: true, tabId: tab?.id });
      })
      .catch((error) => {
        console.error("[SafeSpace] Focus dashboard open failed", error);
        sendResponse({ ok: false, error: error.message || String(error) });
      });
    return true;
  }

  if (msg.type === "get-safe-mode") {
    sendResponse({ ok: true, enabled: safeBrowsingEnabled });
    return true;
  }

  if (msg.type === "set-safe-mode") {
    setSafeBrowsing(Boolean(msg.enabled))
      .then(() => {
        sendResponse({ ok: true, enabled: safeBrowsingEnabled });
      })
      .catch((error) => {
        console.error("[SafeSpace] Safe mode update failed", error);
        sendResponse({ ok: false, error: error.message || String(error) });
      });
    return true;
  }

  if (msg.type === "content-flagged") {
    if (!safeBrowsingEnabled) {
      sendResponse({ ok: false, reason: "safe-mode-disabled" });
      return true;
    }
    reportContentFlag(msg)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        console.warn("[SafeSpace] Content report failed", error);
        sendResponse({ ok: false, error: error.message || String(error) });
      });
    return true;
  }

  if (msg.type === "get-keywords") {
    loadModerationKeywords(Boolean(msg.force))
      .then((keywords) => {
        sendResponse({ ok: true, keywords });
      })
      .catch((error) => {
        console.error("[SafeSpace] Keyword fetch failed", error);
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
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed (${response.status})`);
  }

  const text = await response.text();
  return text ? JSON.parse(text) : null;
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

function openDashboardTab(url) {
  return new Promise((resolve, reject) => {
    chrome.tabs.create({ url }, (tab) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(tab);
    });
  });
}

function setSafeBrowsing(enabled) {
  return new Promise((resolve, reject) => {
    safeBrowsingEnabled = enabled;
    chrome.storage.local.set(
      { [SAFE_MODE_STORAGE_KEY]: safeBrowsingEnabled },
      () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        broadcastSafeMode(safeBrowsingEnabled);
        resolve();
      },
    );
  });
}

function loadModerationKeywords(force = false) {
  const now = Date.now();
  if (!force && moderationKeywords.length && now - keywordsFetchedAt < KEYWORD_REFRESH_INTERVAL) {
    return Promise.resolve(moderationKeywords);
  }

  if (!keywordsPromise || force) {
    keywordsPromise = apiFetch("/moderation/keywords")
      .then((data) => {
        const keywords = Array.isArray(data?.keywords) ? data.keywords : [];
        moderationKeywords = keywords.map((keyword) => keyword.toLowerCase());
        keywordsFetchedAt = Date.now();
        broadcastKeywords(moderationKeywords);
        return moderationKeywords;
      })
      .catch((error) => {
        keywordsPromise = null;
        throw error;
      });
  }

  return keywordsPromise;
}

function broadcastKeywords(keywords) {
  try {
    chrome.runtime.sendMessage({ type: "keywords-updated", keywords });
  } catch (error) {
    console.warn("[SafeSpace] Unable to broadcast keyword update:", error);
  }
}

function broadcastSafeMode(enabled) {
  try {
    chrome.runtime.sendMessage({ type: "safe-mode-changed", enabled });
  } catch (error) {
    console.warn("[SafeSpace] Unable to broadcast safe mode:", error);
  }
}

function reportContentFlag(payload) {
  const text = (payload?.text || "").trim();
  if (!text) {
    return Promise.resolve();
  }

  const cacheKey = `${text.toLowerCase()}::${payload?.url || ""}`;
  const now = Date.now();
  const lastReport = reportedContentCache.get(cacheKey);
  if (lastReport && now - lastReport < REPORT_CACHE_TTL) {
    return Promise.resolve();
  }
  reportedContentCache.set(cacheKey, now);

  return apiFetch("/moderate", {
    method: "POST",
    body: JSON.stringify({
      text,
      user: "page-scan",
      url: payload?.url,
      context: payload?.context,
    }),
  }).catch((error) => {
    reportedContentCache.delete(cacheKey);
    throw error;
  });
}
