import { complete } from "./modules/llm-provider.js";
import { Cache, Status, Settings } from "./modules/storage.js";
import {
    buildHintsPrompt,
    buildSolutionPrompt,
    buildChatSystemPrompt,
} from "./modules/prompts.js";

const SPEC_URL = "https://theadev67.github.io/WeBWorK-GPT/manifest.json";

// Keep track of ongoing tasks to prevent duplicates and handle retries
const activeTasks = new Map();

async function _callWithRetry(fn, maxRetries = 2) {
    let lastErr;
    for (let i = 0; i <= maxRetries; i++) {
        try {
            return await fn();
        } catch (e) {
            lastErr = e;
            if (i < maxRetries) {
                const delay = 1200 * (i + 1);
                console.warn(
                    `[WeBWorK-GPT] Background Retry ${
                        i + 1
                    }/${maxRetries} after ${delay}ms:`,
                    e.message
                );
                await new Promise((r) => setTimeout(r, delay));
            }
        }
    }
    throw lastErr;
}

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

// Main message listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "generate-all") {
        handleGenerateAll(request);
        sendResponse({ status: "started" });
    } else if (request.action === "chat") {
        handleChat(request);
        sendResponse({ status: "started" });
    }
    return true; // Keep channel open for async
});

async function handleGenerateAll({ path, seed, problemText }) {
    const taskKey = `gen_${path}_${seed}`;
    if (activeTasks.has(taskKey)) return;
    activeTasks.set(taskKey, true);

    try {
        const settings = await Settings.get();
        await Status.set(path, seed, { state: "loading", text: "Generating hints..." });

        const hintsPrompt = buildHintsPrompt(problemText);
        const hintsRaw = await _callWithRetry(() => complete(
            [
                { role: "system", content: hintsPrompt.system },
                { role: "user", content: hintsPrompt.user },
            ],
            settings.llmConfig,
            null,
            "hint"
        ));
        const hints = JSON.parse(hintsRaw);

        await Status.set(path, seed, { state: "loading", text: "Writing solution..." });
        const solutionPrompt = buildSolutionPrompt(problemText);
        const solution = await _callWithRetry(() => complete(
            [
                { role: "system", content: solutionPrompt.system },
                { role: "user", content: solutionPrompt.user },
            ],
            settings.llmConfig,
            null,
            "solution"
        ));

        // Persist
        const prev = (await Cache.get(path, seed)) ?? { chatHistory: [], notes: "" };
        await Cache.set(path, seed, {
            hints,
            solution,
            chatHistory: prev.chatHistory,
            notes: prev.notes,
        });

        await Status.clear(path, seed);
        
        // Notify all tabs (sidebar will filter by current path/seed)
        chrome.tabs.query({}, (tabs) => {
            tabs.forEach(tab => {
                chrome.tabs.sendMessage(tab.id, { 
                    action: "generation-complete", 
                    path, seed, hints, solution 
                }).catch(() => {}); // Ignore tabs without content script
            });
        });

    } catch (error) {
        console.error("Background Generation Error:", error);
        await Status.set(path, seed, { state: "error", message: error.message });
    } finally {
        activeTasks.delete(taskKey);
    }
}

async function handleChat({ path, seed, problemText, text }) {
    const taskKey = `chat_${path}_${seed}`;

    try {
        const settings = await Settings.get();
        const cached = (await Cache.get(path, seed)) ?? { chatHistory: [] };

        // Persist the user message immediately so it survives refresh
        cached.chatHistory.push({ role: "user", content: text });
        await Cache.set(path, seed, cached);

        await Status.set(path, seed, { state: "chat-loading" });

        const messages = [
            { role: "system", content: buildChatSystemPrompt(problemText) },
            ...cached.chatHistory, // includes the newly pushed user message
        ];

        const reply = await _callWithRetry(() => complete(
            messages,
            {
                ...settings.llmConfig,
                model: settings.llmConfig.chatModel || "gemma-3-27b-it",
            },
            null,
            "chat"
        ));

        // Append assistant reply
        const updated = (await Cache.get(path, seed)) ?? cached;
        updated.chatHistory.push({ role: "assistant", content: reply });
        await Cache.set(path, seed, updated);

        await Status.clear(path, seed);

        chrome.tabs.query({}, (tabs) => {
            tabs.forEach(tab => {
                chrome.tabs.sendMessage(tab.id, { 
                    action: "chat-complete", 
                    path, seed, reply, userText: text 
                }).catch(() => {});
            });
        });

    } catch (error) {
        console.error("Background Chat Error:", error);
        await Status.set(path, seed, { state: "error", message: error.message });
    }
}

// Broadcast sidebar toggle to content scripts when shortcut is pressed
chrome.commands.onCommand.addListener((command) => {
    if (command === "toggle-sidebar") {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]?.id) {
                chrome.tabs.sendMessage(tabs[0].id, {
                    action: "toggle-sidebar",
                });
            }
        });
    }
});

async function updateBadge() {
    const data = await chrome.storage.sync.get("redoMode");
    if (data.redoMode) {
        chrome.action.setBadgeText({ text: "R" });
        chrome.action.setBadgeBackgroundColor({ color: "#22c55e" }); // Green
    } else {
        chrome.action.setBadgeText({ text: "" });
    }
}

// Update badge when settings change
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes.redoMode) {
        updateBadge();
    }
});

// Initialize badge
updateBadge();
