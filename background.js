import { complete } from "./modules/llm-provider.js";

const SPEC_URL = "https://theadev67.github.io/WeBWorK-GPT/manifest.json";

async function checkVersion() {
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

chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === "install") {
        chrome.storage.sync.set({ disclaimerAccepted: false });
        chrome.tabs.create({
            url: chrome.runtime.getURL("pages/settings.html"),
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
