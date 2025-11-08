let lastSent = 0;

function report() {
  const now = Date.now();
  if (now - lastSent > 2000) {
    chrome.runtime.sendMessage({ type: "user-active" });
    lastSent = now;
  }
}

["mousemove", "keydown", "scroll", "click"].forEach((eventName) => {
  window.addEventListener(eventName, report, { passive: true });
});