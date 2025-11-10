/**
 * Content script responsible for:
 *   - Reporting user activity back to the background worker.
 *   - Fetching moderation keywords and blurring matching text nodes.
 *   - Reporting flagged phrases to the backend (so the dashboard stays up to date).
 */

const ACTIVITY_EVENTS = ["mousemove", "keydown", "scroll", "click"];
const MASK_STYLE_ID = "safespace-blur-style";
const SKIP_PARENT_TAGS = new Set([
  // Avoid modifying code snippets or inputs to minimise false positives.
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "TEXTAREA",
  "INPUT",
  "OPTION",
  "CODE",
  "PRE",
  "KBD",
  "SAMP",
]);

let lastSent = 0;
let keywordList = [];
let keywordRegex = null;
let mutationObserver = null;
let safeModeEnabled = true;
const reportedMatches = new Set();

ACTIVITY_EVENTS.forEach((eventName) => {
  window.addEventListener(eventName, reportActivity, { passive: true });
});

initializeModerationMask();

function reportActivity() {
  const now = Date.now();
  if (now - lastSent > 2000) {
    chrome.runtime.sendMessage({ type: "user-active" });
    lastSent = now;
  }
}

function initializeModerationMask() {
  // Kick off initial keyword fetch and subscribe to background updates.
  requestKeywords();

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "keywords-updated") {
      updateKeywordMask(msg.keywords || []);
    }
    if (msg?.type === "safe-mode-changed") {
      updateSafeMode(Boolean(msg.enabled));
    }
  });

  requestSafeMode();
}

function requestKeywords() {
  // Ask the background worker for the latest keyword list.
  sendBackgroundMessage({ type: "get-keywords" })
    .then((response) => {
      if (response?.ok) {
        updateKeywordMask(response.keywords || []);
      }
    })
    .catch((error) => {
      console.warn("[SafeSpace content] Unable to fetch keywords:", error);
    });
}

function requestSafeMode() {
  // Sync the safe-mode toggle so masking can be turned off remotely.
  sendBackgroundMessage({ type: "get-safe-mode" })
    .then((response) => {
      if (response?.ok) {
        updateSafeMode(Boolean(response.enabled));
      }
    })
    .catch((error) => {
      console.warn("[SafeSpace content] Unable to fetch safe mode:", error);
    });
}

function updateSafeMode(enabled) {
  if (safeModeEnabled === enabled) return;
  safeModeEnabled = enabled;

  if (!safeModeEnabled) {
    disconnectObserver();
    removeExistingMasks();
    reportedMatches.clear();
  } else if (keywordList.length) {
    reportedMatches.clear();
    updateKeywordMask(keywordList);
  }
}

function updateKeywordMask(keywords) {
  // Rebuild the regex and reprocess the DOM when the keyword list changes.
  const normalized = Array.isArray(keywords)
    ? Array.from(new Set(keywords.map((kw) => kw.trim().toLowerCase()))).sort()
    : [];

  if (arraysEqual(normalized, keywordList)) {
    return;
  }

  keywordList = normalized;
  keywordRegex = buildKeywordRegex(keywordList);

  if (!keywordRegex || !safeModeEnabled) {
    disconnectObserver();
    removeExistingMasks();
    return;
  }

  ensureMaskStyle();

  const applyMask = () => {
    if (!keywordRegex) return;
    if (document.body) {
      processNode(document.body);
      startObserver();
    } else {
      document.addEventListener(
        "DOMContentLoaded",
        () => {
          if (keywordRegex && document.body) {
            processNode(document.body);
            startObserver();
          }
        },
        { once: true },
      );
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyMask, { once: true });
  } else {
    applyMask();
  }
}

function processNode(node) {
  // Traverse the DOM recursively and blur eligible text nodes.
  if (!node || !keywordRegex) return;

  if (node.nodeType === Node.TEXT_NODE) {
    maskTextNode(node);
    return;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return;

  const element = node;
  if (element.classList?.contains("safespace-blur")) return;

  if (SKIP_PARENT_TAGS.has(element.tagName)) return;

  let child = element.firstChild;
  while (child) {
    const next = child.nextSibling;
    processNode(child);
    child = next;
  }
}

function maskTextNode(node) {
  // Replace offending text with a masked span and record the match.
  if (!safeModeEnabled || !keywordRegex || !node?.textContent || !node.parentNode)
    return;

  const parentElement = node.parentElement;
  if (!parentElement) return;
  if (parentElement.classList?.contains("safespace-blur")) return;
  if (SKIP_PARENT_TAGS.has(parentElement.tagName)) return;

  const text = node.textContent;
  keywordRegex.lastIndex = 0;
  if (!keywordRegex.test(text)) return;

  keywordRegex.lastIndex = 0;
  const fragment = document.createDocumentFragment();
  let lastIndex = 0;
  let match;

  while ((match = keywordRegex.exec(text)) !== null) {
    const matchText = match[0];
    const index = match.index;

    if (index > lastIndex) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex, index)));
    }

    const span = document.createElement("span");
    span.className = "safespace-blur";
    span.setAttribute("data-mask", "CENSORED");
    span.setAttribute("data-original", matchText);
    span.title = "Sensitive content hidden by SafeSpace";
    span.textContent = matchText;
    fragment.appendChild(span);

    lastIndex = index + matchText.length;

    maybeReportSensitiveMatch(matchText);
  }

  if (lastIndex < text.length) {
    fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
  }

  node.parentNode.replaceChild(fragment, node);
}

function startObserver() {
  // Observe future DOM changes so late-loaded content is also masked.
  if (mutationObserver || !document.body) return;

  mutationObserver = new MutationObserver((mutations) => {
    if (!keywordRegex) return;
    for (const mutation of mutations) {
      if (mutation.type === "characterData") {
        maskTextNode(mutation.target);
      } else {
        mutation.addedNodes.forEach((added) => {
          if (added.nodeType === Node.TEXT_NODE) {
            maskTextNode(added);
          } else if (added.nodeType === Node.ELEMENT_NODE) {
            processNode(added);
          }
        });
      }
    }
  });

  mutationObserver.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}

function disconnectObserver() {
  if (mutationObserver) {
    mutationObserver.disconnect();
    mutationObserver = null;
  }
}

function ensureMaskStyle() {
  // Inject the CSS used for the blurred span overlays.
  if (document.getElementById(MASK_STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = MASK_STYLE_ID;
  style.textContent = `
    .safespace-blur {
      position: relative;
      display: inline-block;
      color: transparent !important;
      filter: blur(6px);
      transition: filter 0.2s ease;
      user-select: none;
    }
    .safespace-blur::after {
      content: attr(data-mask);
      position: absolute;
      inset: -1px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0 4px;
      border-radius: 4px;
      background: rgba(239, 68, 68, 0.8);
      color: #ffffff;
      font-size: 0.75em;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      pointer-events: none;
    }
    .safespace-blur:hover {
      filter: blur(4px);
    }
    .safespace-blur:hover::after {
      content: attr(data-original);
      max-width: 320px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      background: rgba(17, 24, 39, 0.9);
      color: #f9fafb;
      letter-spacing: normal;
    }
  `;

  (document.head || document.documentElement).appendChild(style);
}

function removeExistingMasks() {
  // Restore plaintext when safe-mode is disabled or keywords are cleared.
  document.querySelectorAll(".safespace-blur").forEach((span) => {
    const original = span.getAttribute("data-original") || span.textContent;
    if (span.replaceWith) {
      span.replaceWith(document.createTextNode(original));
    } else if (span.parentNode) {
      span.parentNode.replaceChild(document.createTextNode(original), span);
    }
  });
}

function buildKeywordRegex(keywords) {
  // Build a single regex that matches any keyword (word boundary aware).
  if (!keywords.length) return null;

  const patterns = keywords
    .map((keyword) => keyword.trim())
    .filter(Boolean)
    .map((keyword) => {
      const escaped = escapeRegex(keyword).replace(/\s+/g, "\\s+");
      const startsWithWord = /^[\p{L}\p{N}_]/u.test(keyword);
      const endsWithWord = /[\p{L}\p{N}_]$/u.test(keyword);
      const prefix = startsWithWord ? "\\b" : "";
      const suffix = endsWithWord ? "\\b" : "";
      return `${prefix}${escaped}${suffix}`;
    })
    .filter(Boolean);

  if (!patterns.length) return null;
  return new RegExp(`(${patterns.join("|")})`, "giu");
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function sendBackgroundMessage(message) {
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

function maybeReportSensitiveMatch(matchText) {
  // Notify the background script so the backend records this occurrence.
  if (!safeModeEnabled) return;
  const normalized = matchText.trim().toLowerCase();
  if (!normalized) return;

  const key = `${normalized}::${window.location.href}`;
  if (reportedMatches.has(key)) return;
  reportedMatches.add(key);

  sendBackgroundMessage({
    type: "content-flagged",
    text: matchText,
    url: window.location.href,
    context: document.title || "",
  }).catch((error) => {
    console.warn("[SafeSpace content] Unable to report match:", error);
  });
}