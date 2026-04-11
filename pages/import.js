document.getElementById("file-input").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const statusEl = document.getElementById("status");
    const showStatus = (msg, type) => {
        statusEl.textContent = msg;
        statusEl.className = `status-${type}`;
        statusEl.classList.remove("hidden");
    };

    showStatus("Processing backup file...", "info");

    const reader = new FileReader();
    reader.onload = async (event) => {
        try {
            const data = JSON.parse(event.target.result);

            if (!data.local || !data.sync) {
                throw new Error(
                    "Invalid backup format: the file is missing required storage data."
                );
            }

            showStatus("Restoring data... please do not close this tab.", "info");

            // Overwrite keys
            await chrome.storage.local.set(data.local);
            try {
                await chrome.storage.sync.set(data.sync);
            } catch (syncErr) {
                console.warn("Sync restore failed:", syncErr);
                // We continue because local data (history/notes) is usually more important
            }

            showStatus(
                "✅ Restore successful! Your data has been recovered. Closing in 3 seconds...",
                "status-success"
            );

            // Signal successes to all tabs
            chrome.tabs.query({}, (tabs) => {
                tabs.forEach((tab) => {
                    if (tab.url?.includes("webwork")) {
                        chrome.tabs.reload(tab.id);
                    }
                });
            });

            setTimeout(() => {
                window.close();
            }, 3000);
        } catch (err) {
            console.error("Restore failed:", err);
            showStatus(`❌ Error: ${err.message}`, "error");
        }
    };

    reader.onerror = () => {
        showStatus("❌ Error reading the file from your computer.", "error");
    };

    reader.readAsText(file);
});
