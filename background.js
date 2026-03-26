import { complete } from "./modules/llm-provider.js";
import {
    registerConstantsListener,
    getConstants,
} from "./modules/constants-manager.js";
import { registerConstantsProvider } from "./modules/constants-provider.js";

registerConstantsListener();
registerConstantsProvider(getConstants);

async function checkVersion() {
    const { config } = await getConstants();
    const SPEC_URL = config.spec_url;
    const { lastCheckedAt, dismissedUpdateAt } = await chrome.storage.local.get(
        ["lastCheckedAt", "dismissedUpdateAt"]
    );

    const today = new Date().toDateString();

    if (dismissedUpdateAt) {
        if (new Date(dismissedUpdateAt).toDateString() === today) return;
    }

    if (lastCheckedAt) {
        if (new Date(lastCheckedAt).toDateString() === today) return;
    }

    try {
        const response = await fetch(SPEC_URL);
        // We set lastCheckedAt even on failure to avoid spamming on every sw wake-up if offline
        await chrome.storage.local.set({ lastCheckedAt: Date.now() });

        if (!response.ok) return; // silently fail
        const data = await response.json();
        const remoteVersion = data.version;
        const localVersion = chrome.runtime.getManifest().version;

        if (isBehindByMinor(localVersion, remoteVersion)) {
            await chrome.storage.local.set({
                updateAvailable: remoteVersion,
            });
        } else {
            // If they fixed it (e.g. they updated), remove the flag.
            await chrome.storage.local.remove("updateAvailable");
        }
    } catch (e) {
        // Silently fail if remote cannot be fetched
    }
}

function isBehindByMinor(local, remote) {
    const l = local.split(".").map(Number);
    const r = remote.split(".").map(Number);
    // [major, minor, patch]
    if (r[0] > l[0]) return true; // major version behind
    if (r[0] === l[0] && r[1] > l[1]) return true; // minor version behind
    return false;
}

// Check on extension load (service worker wake up)
checkVersion();

chrome.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === "install") {
        const { config } = await getConstants();
        chrome.storage.sync.set({ disclaimerAccepted: false });
        chrome.tabs.create({
            url: chrome.runtime.getURL(config.settings_page),
        });
    }
});

// Listener for LLM requests via long-lived port connection (streaming support)
chrome.runtime.onConnect.addListener((port) => {
    if (port.name === "llm-stream") {
        port.onMessage.addListener(async (msg) => {
            const { messages, config, mode } = msg;
            try {
                const response = await complete(
                    messages,
                    config,
                    (chunk) => {
                        port.postMessage({ type: "chunk", data: chunk });
                    },
                    mode
                );
                port.postMessage({ type: "done", data: response });
            } catch (error) {
                console.error("Background LLM Error:", error);
                port.postMessage({ type: "error", data: error.message });
            }
        });
    }
});
