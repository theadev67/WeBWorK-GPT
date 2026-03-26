const STORAGE_KEY = "remote_constants";
const FETCHED_AT_KEY = "constants_fetched_at";
const BUNDLED_PATH = "constants.json";

/**
 * Attempt to fetch remote JSON and persist to chrome.storage.local.
 * Returns parsed object on success, null on any failure.
 */
async function fetchRemote(remoteUrl) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    try {
        const response = await fetch(remoteUrl, { signal: controller.signal });
        if (!response.ok) return null;

        const data = await response.json();
        if (data && typeof data === "object") {
            await chrome.storage.local.set({
                [STORAGE_KEY]: data,
                [FETCHED_AT_KEY]: Date.now(),
            });
            return data;
        }
        return null;
    } catch (err) {
        console.error("[ConstantsManager] Remote fetch failed:", err);
        return null;
    } finally {
        clearTimeout(timeoutId);
    }
}

/**
 * Read from chrome.storage.local if fresh (within TTL).
 * Returns cached object or null if missing/stale.
 */
async function getCached(ttlMs) {
    const data = await chrome.storage.local.get([STORAGE_KEY, FETCHED_AT_KEY]);
    if (!data[STORAGE_KEY] || !data[FETCHED_AT_KEY]) return null;

    const age = Date.now() - data[FETCHED_AT_KEY];
    if (age > ttlMs) return null;

    return data[STORAGE_KEY];
}

/**
 * Load the bundled constants.json using chrome.runtime.getURL.
 * This is the final fallback and must never throw.
 */
async function getLocal() {
    try {
        const url = chrome.runtime.getURL(BUNDLED_PATH);
        const response = await fetch(url);
        return await response.json();
    } catch (err) {
        console.error(
            "[ConstantsManager] Local fallback failed (this should not happen):",
            err
        );
        return {};
    }
}

/**
 * Primary export. Resolution order:
 *   1. Valid cache in chrome.storage.local (within TTL)
 *   2. Fresh fetch from REMOTE_URL, update cache
 *   3. Bundled constants.json
 */
export async function getConstants() {
    const local = await getLocal();
    const { remote_url, ttl_ms } = (local && local.config) || {};

    if (!remote_url) return local;

    // 1. Try cache
    const cached = await getCached(ttl_ms || 3600000);
    if (cached) {
        console.log("[ConstantsManager] using cached constants");
        return cached;
    }

    // 2. Try remote
    const remote = await fetchRemote(remote_url);
    if (remote) {
        console.log(
            "[ConstantsManager] using freshly fetched remote constants"
        );
        return remote;
    }

    // 3. Fallback to local
    console.log("[ConstantsManager] falling back to local constants");
    return local;
}

/**
 * Register a message listener so content scripts can request constants.
 */
export function registerConstantsListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === "GET_CONSTANTS") {
            getConstants().then(sendResponse);
            return true; // keep channel open for async response
        }
    });
}
