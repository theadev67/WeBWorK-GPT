import { Settings } from "../modules/storage.js";

const enabledToggle = document.getElementById("enabled-toggle");
const redoToggle = document.getElementById("redo-toggle");
const openSettings = document.getElementById("open-settings");

async function init() {
    const data = await Settings.get();
    enabledToggle.checked = data.enabled !== false;
    redoToggle.checked = !!data.redoMode;
}

enabledToggle.addEventListener("change", async () => {
    await Settings.set({ enabled: enabledToggle.checked });
});

redoToggle.addEventListener("change", async () => {
    await Settings.set({ redoMode: redoToggle.checked });
});

openSettings.addEventListener("click", () => {
    if (chrome.runtime.openOptionsPage) {
        chrome.runtime.openOptionsPage();
    } else {
        window.open(chrome.runtime.getURL("pages/settings.html"));
    }
});

// --- Backup & Restore ---

const exportBtn = document.getElementById("export-btn");
const importBtn = document.getElementById("import-btn");
const statusEl = document.getElementById("popup-status");

const showStatus = (msg, type) => {
    statusEl.textContent = msg;
    statusEl.className = `status-message ${type}`;
    statusEl.classList.remove("hidden");
};

exportBtn.addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("pages/export.html") });
});

importBtn.addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("pages/import.html") });
});

init();
