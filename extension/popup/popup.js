/**
 * Popup UI controller for the SafeSpace extension.
 *
 * Handles theme toggling, safe-browsing state, focus mode controls,
 * stats rendering, and dashboard navigation.
 */

const BACKEND_URL = "http://localhost:5000";
const DAILY_LIMIT_MINUTES = 120;
const THEME_KEY = "safespace_theme";

let focusStatus = {
  active: false,
  duration_seconds: 0,
  blocked_sites: [],
};

document.addEventListener("DOMContentLoaded", () => {
  initThemeControls();
  initSafeToggle();
  initFocusControls();
  initOpenDashboard();
  loadInitialState();

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "focus-status") {
      focusStatus = msg.status;
      updateFocusUI();
    }
  });
});

async function loadInitialState() {
  await Promise.all([refreshUsage(), refreshStats(), refreshFlagged(), refreshFocusStatus()]);
}

function initThemeControls() {
  // Restore and toggle the light/dark theme preference.
  const themeToggle = document.getElementById("themeToggle");
  const savedTheme = localStorage.getItem(THEME_KEY) || "light";
  applyTheme(savedTheme);

  themeToggle.addEventListener("click", () => {
    const current = document.body.classList.contains("dark") ? "dark" : "light";
    const next = current === "dark" ? "light" : "dark";
    applyTheme(next);
    localStorage.setItem(THEME_KEY, next);
  });
}

function initSafeToggle() {
  // Round-trip safe browsing state through the background script.
  const safeToggle = document.getElementById("safeBrowsingToggle");
  fetchSafeMode()
    .then((enabled) => updateSafeToggle(safeToggle, enabled))
    .catch((error) => {
      console.warn("[SafeSpace popup] Unable to load safe mode:", error);
      updateSafeToggle(safeToggle, true);
    });

  safeToggle.addEventListener("click", async () => {
    const enabled = safeToggle.classList.contains("chip-on");
    const next = !enabled;
    updateSafeToggle(safeToggle, next);

    try {
      const result = await sendRuntimeMessage({
        type: "set-safe-mode",
        enabled: next,
      });
      if (!result?.ok) {
        throw new Error(result?.error || "Unable to update safe mode");
      }
      updateSafeToggle(safeToggle, Boolean(result.enabled));
    } catch (error) {
      console.warn("[SafeSpace popup] Unable to toggle safe mode:", error);
      updateSafeToggle(safeToggle, enabled);
    }
  });
}

function initFocusControls() {
  // Allow the user to start/stop focus mode from the popup.
  const focusModeBtn = document.getElementById("focusModeBtn");

  focusModeBtn.addEventListener("click", async () => {
    focusModeBtn.disabled = true;
    try {
      if (focusStatus.active) {
        await sendFocusStop();
      } else {
        await sendFocusStart();
      }
    } finally {
      focusModeBtn.disabled = false;
    }
  });
}

function initOpenDashboard() {
  // Open the backend-hosted dashboard in a new tab.
  const openDashboardBtn = document.getElementById("openDashboardBtn");
  openDashboardBtn.addEventListener("click", async () => {
    const url = `${BACKEND_URL}/dashboard/`;
    try {
      const result = await sendRuntimeMessage({ type: "open-dashboard", url });
      if (!result?.ok) {
        throw new Error(result?.error || "Unable to open dashboard tab");
      }
    } catch (error) {
      console.warn("[SafeSpace popup] Falling back to window.open", error);
      window.open(url, "_blank");
    }
  });
}

async function refreshUsage() {
  // Render the daily usage meter using data stored by the background script.
  const { siteTime = {} } = await chrome.storage.local.get("siteTime");
  const totalSeconds = Object.values(siteTime).reduce((sum, seconds) => sum + seconds, 0);
  const usedMinutes = Math.floor(totalSeconds / 60);

  const usedTimeEl = document.getElementById("usedTime");
  const dailyLimitLabel = document.getElementById("dailyLimitLabel");
  const remainingLabel = document.getElementById("remainingLabel");
  const progressFill = document.getElementById("progressFill");
  const limitStatus = document.getElementById("limitStatus");

  dailyLimitLabel.textContent = formatMinutes(DAILY_LIMIT_MINUTES);
  usedTimeEl.textContent = formatMinutes(usedMinutes);

  const ratio = Math.min(usedMinutes / DAILY_LIMIT_MINUTES, 1);
  progressFill.style.width = `${ratio * 100}%`;

  const remaining = DAILY_LIMIT_MINUTES - usedMinutes;
  if (remaining > 0 && ratio < 0.8) {
    remainingLabel.textContent = `${formatMinutes(remaining)} remaining`;
    limitStatus.textContent = "✅ You’re within your healthy range.";
    limitStatus.className = "limit-status limit-ok";
  } else if (remaining > 0 && ratio >= 0.8) {
    remainingLabel.textContent = `${formatMinutes(remaining)} left · consider a break`;
    limitStatus.textContent = "⚠️ You’re close to your limit. Plan a pause.";
    limitStatus.className = "limit-status limit-warning";
  } else {
    remainingLabel.textContent = "Daily limit reached";
    limitStatus.textContent = "⛔ Limit reached. SafeSpace suggests a full break.";
    limitStatus.className = "limit-status limit-hit";
  }
}

async function refreshStats() {
  // Pull aggregated moderation stats from the backend.
  try {
    const stats = await fetchJSON("/stats");
    updateFooter(stats.focus_active);
  } catch (error) {
    console.warn("[SafeSpace popup] Failed to load stats:", error);
  }
}

async function refreshFlagged() {
  // Show the latest flagged messages (if any).
  const flaggedList = document.getElementById("flaggedList");
  flaggedList.innerHTML = "";

  try {
    const { messages = [] } = await fetchJSON("/flagged");
    if (!messages.length) {
      flaggedList.appendChild(createEventItem("No flagged messages in focus window.", "soft"));
      return;
    }

    messages.slice(-5).reverse().forEach((message) => {
      const text = `⛔ ${message.user}: "${message.text}"`;
      flaggedList.appendChild(createEventItem(text, "warning"));
    });
  } catch (error) {
    flaggedList.appendChild(createEventItem("Unable to load flagged messages.", "warning"));
    console.warn("[SafeSpace popup] Failed to load flagged messages:", error);
  }
}

async function refreshFocusStatus() {
  // Keep the focus controls aligned with server state.
  try {
    const status = await fetchJSON("/focus/status");
    focusStatus = status;
    updateFocusUI();
  } catch (error) {
    console.warn("[SafeSpace popup] Could not fetch focus status:", error);
  }
}

function updateFocusUI() {
  // Reflect focus state in the button, footer, and blocked site input field.
  const focusModeBtn = document.getElementById("focusModeBtn");
  const input = document.getElementById("blockedSitesInput");
  const footerText = document.querySelector(".footer-text");

  if (focusStatus.active) {
    focusModeBtn.classList.add("active");
    focusModeBtn.textContent = "✅ Focus Mode On";
    footerText.textContent = "Monitoring active · Focus mode enabled";

    if (input && focusStatus.blocked_sites?.length) {
      input.value = focusStatus.blocked_sites.join(", ");
    }
  } else {
    focusModeBtn.classList.remove("active");
    focusModeBtn.textContent = "✨ Start Focus Mode";
    footerText.textContent = "Monitoring active · Safe browsing enabled";
  }
}

async function sendFocusStart() {
  // Ask the background script to start focus mode and handle errors gracefully.
  const input = document.getElementById("blockedSitesInput");
  const blockedSites = parseSites(input?.value || "");
  const result = await sendRuntimeMessage({ type: "focus-start", blockedSites });

  if (!result?.ok) {
    throw new Error(result?.error || "Unable to start focus mode");
  }

  focusStatus = result.status;
  updateFocusUI();
}

async function sendFocusStop() {
  // Stop focus mode via the background script.
  const result = await sendRuntimeMessage({ type: "focus-stop" });
  if (!result?.ok) {
    throw new Error(result?.error || "Unable to stop focus mode");
  }
  focusStatus = result.status;
  updateFocusUI();
}

function updateFooter(focusActive) {
  const footerText = document.querySelector(".footer-text");
  if (!footerText) return;

  footerText.textContent = focusActive
    ? "Monitoring active · Focus mode enabled"
    : "Monitoring active · Safe browsing enabled";
}

function createEventItem(text, type = "soft") {
  const li = document.createElement("li");
  li.classList.add("event-item");
  li.classList.add(type === "warning" ? "event-warning" : "event-soft");
  li.textContent = text;
  return li;
}

function formatMinutes(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0) return `${h}h ${m.toString().padStart(2, "0")}m`;
  return `${m}m`;
}

function parseSites(value) {
  // Convert comma-separated sites into an array used by the background worker.
  return value
    .split(",")
    .map((site) => site.trim().toLowerCase())
    .filter(Boolean);
}

async function fetchJSON(path, options = {}) {
  // Helper for hitting backend REST endpoints.
  const res = await fetch(`${BACKEND_URL}${path}`, {
    ...options,
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(`Request failed with status ${res.status}`);
  }
  return res.json();
}

function applyTheme(mode) {
  if (mode === "dark") {
    document.body.classList.add("dark");
    const t = document.getElementById("themeToggle");
    if (t) t.textContent = "☀️ Light mode";
  } else {
    document.body.classList.remove("dark");
    const t = document.getElementById("themeToggle");
    if (t) t.textContent = "🌙 Dark mode";
  }
}

function updateSafeToggle(el, on) {
  if (!el) return;
  if (on) {
    el.classList.add("chip-on");
    el.textContent = "🛡 Safe browsing: On";
  } else {
    el.classList.remove("chip-on");
    el.textContent = "🛡 Safe browsing: Off";
  }
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

async function fetchSafeMode() {
  const result = await sendRuntimeMessage({ type: "get-safe-mode" });
  if (!result?.ok) {
    throw new Error(result?.error || "Unable to fetch safe mode state");
  }
  return Boolean(result.enabled);
}
