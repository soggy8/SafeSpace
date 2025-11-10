// Client-side controller for the dashboard. Polls backend stats and renders UI cards.

const BACKEND_URL = "http://localhost:5000";
const REFRESH_INTERVAL = 10000;

document.addEventListener("DOMContentLoaded", () => {
  const refreshBtn = document.getElementById("refreshBtn");
  refreshBtn.addEventListener("click", loadDashboardData);

  loadDashboardData();
  setInterval(loadDashboardData, REFRESH_INTERVAL);
});

async function loadDashboardData() {
  // Fetch metrics in parallel so the UI remains responsive.
  const [stats, flagged, focus] = await Promise.allSettled([
    fetchJson("/stats"),
    fetchJson("/flagged"),
    fetchJson("/focus/status"),
  ]);

  if (stats.status === "fulfilled") {
    renderStats(stats.value);
  }
  if (flagged.status === "fulfilled") {
    renderFlagged(flagged.value.messages || []);
  }
  if (focus.status === "fulfilled") {
    renderBlockedSites(focus.value.blocked_sites || [], focus.value.active);
  }
}

function renderStats(data) {
  // Update top-level counter cards.
  const totalMessages = document.getElementById("totalMessages");
  const flaggedMessages = document.getElementById("flaggedMessages");
  const focusState = document.getElementById("focusState");
  const focusDuration = document.getElementById("focusDuration");

  totalMessages.textContent = data.total_messages ?? 0;
  flaggedMessages.textContent = data.flagged_messages ?? 0;
  focusState.textContent = data.focus_active ? "Active" : "Inactive";

  const minutes = Math.floor((data.focus_duration_seconds || 0) / 60);
  focusDuration.textContent = `${minutes} minute${minutes === 1 ? "" : "s"} in focus`;
}

function renderFlagged(messages) {
  // Render the table of recently flagged messages.
  const tbody = document.getElementById("flaggedTableBody");
  tbody.innerHTML = "";

  if (!messages.length) {
    const emptyRow = document.createElement("tr");
    emptyRow.innerHTML = `<td colspan="4" class="empty">No flagged messages yet.</td>`;
    tbody.appendChild(emptyRow);
    return;
  }

  messages
    .slice()
    .reverse()
    .forEach((msg) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(msg.user || "unknown")}</td>
        <td>${escapeHtml(msg.text || "")}</td>
        <td>${formatCategories(msg.categories)}</td>
        <td>${formatTime(msg.timestamp)}</td>
      `;
      tbody.appendChild(tr);
    });
}

function renderBlockedSites(sites, active) {
  // Show the domains currently blocked while focus mode is enabled.
  const list = document.getElementById("blockedSitesList");
  list.innerHTML = "";

  if (!active) {
    const item = document.createElement("li");
    item.classList.add("empty");
    item.textContent = "Focus mode is not active.";
    list.appendChild(item);
    return;
  }

  if (!sites.length) {
    const item = document.createElement("li");
    item.classList.add("empty");
    item.textContent = "Focus mode is active with no blocked sites configured.";
    list.appendChild(item);
    return;
  }

  sites.forEach((site) => {
    const li = document.createElement("li");
    li.textContent = site;
    list.appendChild(li);
  });
}

async function fetchJson(path, options = {}) {
  // Basic fetch wrapper with credential passthrough and error surfacing.
  const res = await fetch(`${BACKEND_URL}${path}`, {
    ...options,
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${path} (${res.status})`);
  }
  return res.json();
}

function escapeHtml(value) {
  return (value || "")
    .toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatCategories(categories = {}) {
  const active = Object.entries(categories)
    .filter(([, flagged]) => flagged)
    .map(([key]) => key);

  if (!active.length) return "—";
  return active.join(", ");
}

function formatTime(timestamp) {
  if (!timestamp) return "—";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return date.toLocaleString();
}