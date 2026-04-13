import { mountSidebar } from "./sidebar.js";
import { decorateProblemTable } from "./table-decorator.js";
import { Settings } from "../modules/storage.js";

async function init() {
    const data = await Settings.get();
    if (data.enabled === false) return; // respect user toggle
    if (!data.disclaimerAccepted) return; // user must accept disclaimer first

    // Check if we are on a problem page
    if (document.querySelector("#output_problem_body")) {
        mountSidebar();
    } 
    
    // Check if we are on a problem table page (homework set list)
    if (data.showRobotIcons !== false && document.querySelector(".table-responsive table")) {
        decorateProblemTable();
    }
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
