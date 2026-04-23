import { Cache, Settings } from "../modules/storage.js";

/**
 * Checks the problem table on a set page and adds a robot emoji next to 
 * problems that already have generated hints or solutions in local storage.
 */
export async function decorateProblemTable() {
    const table = document.querySelector(".table-responsive table");
    if (!table) return;

    // Get settings to check if icons should be shown
    const settings = await Settings.get();
    if (settings.showRobotIcons === false && settings.showMemoIcons === false) return;

    // Get all cache entries at once to avoid multiple async calls in the loop
    const allData = await Cache.getAll();
    const storageKeys = Object.keys(allData);

    // Select links that point to problems
    const problemLinks = table.querySelectorAll("tbody tr td:first-child a");

    for (const link of problemLinks) {
        try {
            const url = new URL(link.href, window.location.origin);
            const path = url.pathname;
            
            // Generate the prefix used in storage keys for this problem path
            const safePath = Cache._sanitizePath(path);
            const prefix = `ww_${safePath}_`;
            
            // Check if any key in storage belongs to this problem and has meaningful content
            let hasGeneratedContent = false;
            let hasNotes = false;

            for (const key of storageKeys) {
                if (key.startsWith(prefix)) {
                    const entry = allData[key];
                    if (entry) {
                        if (!hasGeneratedContent && (
                            (entry.hints && Object.keys(entry.hints).length > 0) || 
                            entry.solution
                        )) {
                            hasGeneratedContent = true;
                        }
                        if (!hasNotes && entry.notes && entry.notes.trim().length > 0) {
                            hasNotes = true;
                        }
                    }
                }
                if (hasGeneratedContent && hasNotes) break;
            }

            let emojisToAdd = "";
            if (hasGeneratedContent && settings.showRobotIcons !== false) {
                if (!link.textContent.includes("🤖")) {
                    emojisToAdd += " 🤖";
                }
            }
            if (hasNotes && settings.showMemoIcons !== false) {
                if (!link.textContent.includes("📝")) {
                    emojisToAdd += " 📝";
                }
            }

            if (emojisToAdd) {
                link.textContent = link.textContent.trim() + emojisToAdd;
            }
        } catch (e) {
            console.error("[WeBWorK-GPT] Error decorating link:", e);
        }
    }
}
