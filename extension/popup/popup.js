const dailyLimitMinutes = 120; // demo limit
const usedMinutes = 92;        // demo usage

const events = [
  { type: "blocked", text: "Blocked: toxic-site.com (unsafe content)" },
  { type: "milestone", text: "You hit 60 min on youtube.com. Break suggested." },
  { type: "wellbeing", text: "Wellbeing tip: Look away from the screen for 20 seconds." }
];

const THEME_KEY = "safespace_theme";
const SAFE_KEY = "safespace_safe_browsing";

document.addEventListener("DOMContentLoaded", () => {
  const usedTimeEl = document.getElementById("usedTime");
  const dailyLimitLabel = document.getElementById("dailyLimitLabel");
  const remainingLabel = document.getElementById("remainingLabel");
  const progressFill = document.getElementById("progressFill");
  const limitStatus = document.getElementById("limitStatus");
  const eventsList = document.getElementById("eventsList");
  const openDashboardBtn = document.getElementById("openDashboardBtn");
  const focusModeBtn = document.getElementById("focusModeBtn");
  const themeToggle = document.getElementById("themeToggle");
  const safeToggle = document.getElementById("safeBrowsingToggle");

  /* --- Screen time demo UI --- */

  usedTimeEl.textContent = formatMinutes(usedMinutes);
  dailyLimitLabel.textContent = formatMinutes(dailyLimitMinutes);

  const ratio = Math.min(usedMinutes / dailyLimitMinutes, 1);
  progressFill.style.width = (ratio * 100) + "%";

  const remaining = dailyLimitMinutes - usedMinutes;

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

  eventsList.innerHTML = "";
  events.forEach(e => {
    const li = document.createElement("li");
    li.classList.add("event-item");
    if (e.type === "blocked") li.classList.add("event-warning");
    else li.classList.add("event-soft");
    li.textContent = prettifyEventText(e.text);
    eventsList.appendChild(li);
  });

  /* --- Dark mode load --- */
  const savedTheme = localStorage.getItem(THEME_KEY) || "light";
  applyTheme(savedTheme);

  themeToggle.addEventListener("click", () => {
    const current = document.body.classList.contains("dark") ? "dark" : "light";
    const next = current === "dark" ? "light" : "dark";
    applyTheme(next);
    localStorage.setItem(THEME_KEY, next);
  });

  /* --- Safe browsing toggle (visual only for now) --- */
  const savedSafe = localStorage.getItem(SAFE_KEY);
  let safeOn = savedSafe !== "off"; // default ON

  updateSafeToggle(safeToggle, safeOn);

  safeToggle.addEventListener("click", () => {
    safeOn = !safeOn;
    updateSafeToggle(safeToggle, safeOn);
    localStorage.setItem(SAFE_KEY, safeOn ? "on" : "off");
    // Here devs can send message to background.js to enable/disable filtering.
  });

  /* --- Focus mode visual toggle --- */
  focusModeBtn.addEventListener("click", () => {
    if (focusModeBtn.classList.contains("active")) {
      focusModeBtn.classList.remove("active");
      focusModeBtn.textContent = "✨ Start Focus Mode";
    } else {
      focusModeBtn.classList.add("active");
      focusModeBtn.textContent = "✅ Focus Mode On";
    }
  });

  /* --- Open dashboard --- */
  openDashboardBtn.addEventListener("click", () => {
    // For now, try to open local dashboard (your devs can adjust).
    const url = chrome?.runtime?.getURL
      ? chrome.runtime.getURL("dashboard/index.html")
      : "../dashboard/index.html";
    window.open(url, "_blank");
  });
});

function formatMinutes(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0) return `${h}h ${m.toString().padStart(2, "0")}m`;
  return `${m}m`;
}

function prettifyEventText(text) {
  return text
    .replace("Blocked:", "⛔ Blocked:")
    .replace("Wellbeing tip:", "🌿 Wellbeing tip:");
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
