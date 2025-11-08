let lastSent = 0;

function report() {
    const now = Date.now();
    if (now - lastSent > 2000) {
        chrome.runtime.sendMessage("active");
        lastSent = now;
    }
}

window.addEventListener("mousemove", report);
window.addEventListener("keydown", report);
window.addEventListener("scroll", report);
window.addEventListener("click", report);