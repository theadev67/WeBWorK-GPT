import { Settings } from "../modules/storage.js";

const enabledToggle = document.getElementById("enabled-toggle");
const openSettings = document.getElementById("open-settings");

async function init() {
    const data = await Settings.get();
    enabledToggle.checked = data.enabled !== false;
}

enabledToggle.addEventListener("change", async () => {
    await Settings.set({ enabled: enabledToggle.checked });
});

openSettings.addEventListener("click", () => {
    if (chrome.runtime.openOptionsPage) {
        chrome.runtime.openOptionsPage();
    } else {
        window.open(chrome.runtime.getURL("pages/disclaimer.html"));
    }
});

init();
