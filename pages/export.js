const includeKeys = document.getElementById("include-keys");
const warning = document.getElementById("warning");
const exportBtn = document.getElementById("export-confirm-btn");
const statusEl = document.getElementById("status");

includeKeys.addEventListener("change", () => {
    warning.classList.toggle("hidden", !includeKeys.checked);
});

exportBtn.addEventListener("click", async () => {
    try {
        exportBtn.disabled = true;
        exportBtn.textContent = "Generating...";

        // Fetch all data
        const localData = await chrome.storage.local.get(null);
        const syncData = await chrome.storage.sync.get(null);

        // Strip keys if not requested
        if (!includeKeys.checked && syncData.llmConfig) {
            // Create a copy to avoid mutating actual storage if we were using references
            const cleanedSync = JSON.parse(JSON.stringify(syncData));
            if (cleanedSync.llmConfig) {
                cleanedSync.llmConfig.apiKey = "";
            }
            // Update the data we'll export
            var dataToExport = {
                version: chrome.runtime.getManifest().version,
                timestamp: Date.now(),
                type: includeKeys.checked ? "full" : "shareable",
                local: localData,
                sync: cleanedSync,
            };
        } else {
            var dataToExport = {
                version: chrome.runtime.getManifest().version,
                timestamp: Date.now(),
                type: "full",
                local: localData,
                sync: syncData,
            };
        }

        const blob = new Blob([JSON.stringify(dataToExport, null, 2)], {
            type: "application/json",
        });
        const url = URL.createObjectURL(blob);
        const dateStr = new Date().toISOString().split("T")[0];
        const typeStr = includeKeys.checked ? "with-api-keys" : "no-api-keys";

        const a = document.createElement("a");
        a.href = url;
        a.download = `webwork-gpt-${typeStr}-${dateStr}.json`;
        a.click();
        URL.revokeObjectURL(url);

        statusEl.textContent = "✅ Backup downloaded successfully!";
        statusEl.style.color = "#16a34a";

        setTimeout(() => window.close(), 2000);
    } catch (err) {
        console.error("Export failed:", err);
        statusEl.textContent = "❌ Export failed: " + err.message;
        statusEl.style.color = "#dc2626";
        exportBtn.disabled = false;
        exportBtn.textContent = "🚀 Download Backup";
    }
});
