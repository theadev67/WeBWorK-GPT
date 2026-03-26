import { complete } from "./modules/llm-provider.js";

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
