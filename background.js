import { complete } from "./modules/llm-provider.js";

chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === "install") {
        chrome.storage.sync.set({ disclaimerAccepted: false });
        chrome.tabs.create({
            url: chrome.runtime.getURL("pages/disclaimer.html"),
        });
    }
});

// Listener for LLM requests via Long-lived connection (streaming support)
chrome.runtime.onConnect.addListener((port) => {
    if (port.name === "llm-stream") {
        port.onMessage.addListener(async (msg) => {
            const { messages, config } = msg;
            try {
                // We use the direct logic here to avoid infinite recursion
                // (the complete function we import will be the one that handles the fetch)
                const response = await complete(messages, config, (chunk) => {
                    port.postMessage({ type: "chunk", data: chunk });
                });
                port.postMessage({ type: "done", data: response });
            } catch (error) {
                console.error("Background LLM Error:", error);
                port.postMessage({ type: "error", data: error.message });
            }
        });
    }
});
