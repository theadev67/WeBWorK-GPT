/**
 * constants-provider.js — provides constants to shared modules.
 * In background context, it must be initialized with registerConstantsProvider().
 * In content scripts, it falls back to message passing.
 */

let provider = null;

/**
 * Call this in background.js to link the actual constants manager.
 */
export function registerConstantsProvider(p) {
    provider = p;
}

/**
 * Shared entry point for getting constants.
 */
export async function getConstants() {
    if (provider) {
        return provider();
    }

    // If we're not in the same module bundle as the background manager,
    // or we're in a content script, use the messaging fallback.
    if (
        typeof chrome !== "undefined" &&
        chrome.runtime &&
        chrome.runtime.sendMessage
    ) {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(
                { type: "GET_CONSTANTS" },
                (response) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                    } else {
                        resolve(response);
                    }
                }
            );
        });
    }

    throw new Error(
        "No constants provider registered and chrome.runtime is unavailable."
    );
}
