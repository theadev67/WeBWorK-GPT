import { Cache } from "../modules/storage.js";

/**
 * Checks the problem table on a set page and adds a robot emoji next to 
 * problems that already have generated hints or solutions in local storage.
 */
export async function decorateProblemTable() {
    const table = document.querySelector(".table-responsive table");
    if (!table) return;

    // Get all cache entries at once to avoid multiple async calls in the loop
    const allData = await Cache.getAll();
    const storageKeys = Object.keys(allData);

    // Select links that point to problems
    // Typical selector based on user input: .table-responsive table > tbody > tr > td > a
    const problemLinks = table.querySelectorAll("tbody tr td:first-child a");

    for (const link of problemLinks) {
        try {
            const url = new URL(link.href, window.location.origin);
            const path = url.pathname;
            
            // Generate the prefix used in storage keys for this problem path
            const safePath = Cache._sanitizePath(path);
            const prefix = `ww_${safePath}_`;
            
            // Check if any key in storage belongs to this problem and has meaningful content
            const hasGeneratedContent = storageKeys.some(key => {
                if (key.startsWith(prefix)) {
                    const entry = allData[key];
                    // An entry is considered "generated" if it has hints or a solution
                    return entry && (
                        (entry.hints && Object.keys(entry.hints).length > 0) || 
                        entry.solution
                    );
                }
                return false;
            });

            if (hasGeneratedContent) {
                // Only add if not already present
                if (!link.textContent.includes("🤖")) {
                    link.textContent = link.textContent.trim() + " 🤖";
                }
            }
        } catch (e) {
            console.error("[WeBWorK-GPT] Error decorating link:", e);
        }
    }
}
