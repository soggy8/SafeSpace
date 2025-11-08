const BACKEND_URL = "http://localhost:5000";
const DAILY_LIMIT_MINUTES = 120;
const THEME_KEY = "safespace_theme";
const SAFE_KEY = "safespace_safe_browsing";

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
  const safeToggle = document.getElementById("safeBrowsingToggle");
  const savedSafe = localStorage.getItem(SAFE_KEY);
  let safeOn = savedSafe !== "off";
  updateSafeToggle(safeToggle, safeOn);

  safeToggle.addEventListener("click", () => {
    safeOn = !safeOn;
    updateSafeToggle(safeToggle, safeOn);
    localStorage.setItem(SAFE_KEY, safeOn ? "on" : "off");
  });
}

function initFocusControls() {
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
  const openDashboardBtn = document.getElementById("openDashboardBtn");
  openDashboardBtn.addEventListener("click", () => {
    const url = chrome?.runtime?.getURL
      ? chrome.runtime.getURL("dashboard/index.html")
      : "../dashboard/index.html";
    window.open(url, "_blank");
  });
}

async function refreshUsage() {
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
  try {
    const stats = await fetchJSON("/stats");
    updateFooter(stats.focus_active);
  } catch (error) {
    console.warn("[SafeSpace popup] Failed to load stats:", error);
  }
}

async function refreshFlagged() {
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
  try {
    const status = await fetchJSON("/focus/status");
    focusStatus = status;
    updateFocusUI();
  } catch (error) {
    console.warn("[SafeSpace popup] Could not fetch focus status:", error);
  }
}

function updateFocusUI() {
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
  return value
    .split(",")
    .map((site) => site.trim().toLowerCase())
    .filter(Boolean);
}

async function fetchJSON(path, options = {}) {
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
