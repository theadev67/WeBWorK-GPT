import { mountSidebar } from "./sidebar.js";
import { Settings } from "../modules/storage.js";

async function init() {
    // Only activate on WeBWorK problem pages
    if (!document.querySelector("#output_problem_body")) return;

    const data = await Settings.get();
    if (data.enabled === false) return; // respect user toggle
    if (!data.disclaimerAccepted) return; // user must accept disclaimer first

    mountSidebar();
}

// In some cases, WeBWorK might load its problem body dynamically or late
// We use a small delay or a MutationObserver if needed, but for now idle is fine.
if (
    document.readyState === "complete" ||
    document.readyState === "interactive"
) {
    init();
} else {
    window.addEventListener("DOMContentLoaded", init);
}
