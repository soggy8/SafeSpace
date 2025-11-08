let siteTime = {};

let currentDomain = null;
let isUserActive = true;
let lastActivity = Date.now();

chrome.storage.local.get(["siteTime"], (data) => {
    if(data.siteTime) siteTime = data.siteTime;
});

chrome.tabs.onActivated.addListener(async (info) => {
    const tab = await chrome.tabs.get(info.tabId);
    updateDomain(tab.url);
});

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
    if (info.status === "complete") updateDomain(tab.url);
});

function updateDomain(url) {
    if(!url || !url.startWith("http")) return;
    try {
        currentDomain = new URL(url).hostname;
    }
    catch {
        currentDomain = null;
    }
}

setInterval(() => {
    if (!currentDomain) return;

    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
        if (!tabs[0]) return;

        const tab = tabs[0];
        const audible = tab.audible || false;
        
        if (audible){
            userActive = true;
            lastActivity = Date.now();
        }
    });

    if(Date.now() - lastActivity > 20000) userActive = false;

    if (userActive) {
        siteTime[currentDomain] = (setTime[currentDomain] || 0)+1;
        chrome.storage.local.set({siteTime});
    }
}, 1000);

chrome.runtime.onMessage.addListener((msg) => {
    if(msg === "active"){
        userActive = true;
        lastActivity = Date.now();
    }
});

