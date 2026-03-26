import { Settings } from "../modules/storage.js";

async function getConstants() {
    return chrome.runtime.sendMessage({ type: "GET_CONSTANTS" });
}

async function init() {
    const { config } = await getConstants();
    const data = await Settings.get();

    const enabledToggle = document.getElementById("enabled-toggle");
    const openSettings = document.getElementById("open-settings");

    enabledToggle.checked = data.enabled !== false;

    enabledToggle.addEventListener("change", async () => {
        await Settings.set({ enabled: enabledToggle.checked });
    });

    openSettings.addEventListener("click", () => {
        if (chrome.runtime.openOptionsPage) {
            chrome.runtime.openOptionsPage();
        } else {
            window.open(chrome.runtime.getURL(config.settings_page));
        }
    });
}

init();
