// chrome.storage.sync — user settings (cross-device)
export const Settings = {
    async get() {
        return new Promise((r) =>
            chrome.storage.sync.get(
                ["llmConfig", "enabled", "disclaimerAccepted"],
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
    _key(problemPath, randomSeed) {
        // sanitize to valid storage key
        const safePath = (problemPath || "unknown").replace(
            /[^a-zA-Z0-9]/g,
            "_"
        );
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
};

// Cached object shape:
// {
//   hints: { hint1: string, hint2: string, hint3: string } | null,
//   solution: string | null,
//   chatHistory: Array<{ role: 'user'|'assistant', content: string }>
// }
