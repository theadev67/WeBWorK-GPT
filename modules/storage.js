// chrome.storage.sync — user settings (cross-device)
export const Settings = {
    async get() {
        return new Promise((r) =>
            chrome.storage.sync.get(
                [
                    "llmConfig",
                    "enabled",
                    "disclaimerAccepted",
                    "sidebarWidth",
                    "sidebarCollapsed",
                    "autoGenerate",
                    "showRobotIcons",
                    "showMemoIcons",
                    "redoMode",
                ],
                r
            )
        );
    },
    async set(data) {
        return new Promise((r) => chrome.storage.sync.set(data, r));
    },
};

// chrome.storage.local — per-question cache
export const Cache = {
    _sanitizePath(problemPath) {
        return (problemPath || "unknown").replace(/[^a-zA-Z0-9]/g, "_");
    },
    _key(problemPath, randomSeed) {
        // sanitize to valid storage key
        const safePath = this._sanitizePath(problemPath);
        return `ww_${safePath}_${randomSeed || "0"}`;
    },
    async get(problemPath, randomSeed) {
        const key = this._key(problemPath, randomSeed);
        return new Promise((r) =>
            chrome.storage.local.get(key, (data) => r(data[key] ?? null))
        );
    },
    async set(problemPath, randomSeed, value) {
        const key = this._key(problemPath, randomSeed);
        return new Promise((r) =>
            chrome.storage.local.set({ [key]: value }, r)
        );
    },
    async clear(problemPath, randomSeed) {
        const key = this._key(problemPath, randomSeed);
        return new Promise((r) => chrome.storage.local.remove(key, r));
    },
    async getAll() {
        return new Promise((r) => chrome.storage.local.get(null, r));
    },
};

// chrome.storage.local — track background task status
export const Status = {
    async get(problemPath, randomSeed) {
        const key = `status_${Cache._sanitizePath(problemPath)}_${randomSeed || "0"}`;
        return new Promise((r) =>
            chrome.storage.local.get(key, (data) => r(data[key] ?? null))
        );
    },
    async set(problemPath, randomSeed, status) {
        const key = `status_${Cache._sanitizePath(problemPath)}_${randomSeed || "0"}`;
        return new Promise((r) =>
            chrome.storage.local.set({ [key]: status }, r)
        );
    },
    async clear(problemPath, randomSeed) {
        const key = `status_${Cache._sanitizePath(problemPath)}_${randomSeed || "0"}`;
        return new Promise((r) => chrome.storage.local.remove(key, r));
    },
};

// Cached object shape:
// {
//   hints: { hint1: string, hint2: string, hint3: string } | null,
//   solution: string | null,
//   notes: string | null,
//   chatHistory: Array<{ role: 'user'|'assistant', content: string }>
// }
