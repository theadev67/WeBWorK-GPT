import { Settings, Cache, Status } from "../modules/storage.js";
import {
    extractProblem,
} from "../modules/prompts.js";
import { typeset, enableClickToCopy, renderMarkdown } from "./math-utils.js";

export async function mountSidebar() {
    const data = await Settings.get();
    if (!data.disclaimerAccepted) return;

    const sidebar = document.createElement("div");
    sidebar.id = "wwgpt-sidebar";
    sidebar.innerHTML = `
        <div class="wwgpt-resize-handle"></div>
        <div class="wwgpt-collapsed-overlay"></div>
        <div class="wwgpt-header">
            <span class="wwgpt-logo">🤖 WeBWorK-GPT</span>
            <div class="wwgpt-header-actions">
                <button class="wwgpt-regen-btn" id="wwgpt-regen" title="Regenerate hints &amp; solution">↺</button>
                <button class="wwgpt-toggle-btn" aria-label="Toggle sidebar">›</button>
            </div>
        </div>
        <div class="wwgpt-tabs">
            <button class="wwgpt-tab active" data-tab="hints">Hints &amp; Solution</button>
            <button class="wwgpt-tab" data-tab="chat">💬 Math Chat</button>
            <button class="wwgpt-tab" data-tab="notes">Notes</button>
        </div>
        <div class="wwgpt-tab-content" id="wwgpt-tab-hints">
            <div class="wwgpt-loading hidden" id="wwgpt-loading">
                <div class="wwgpt-spinner"></div>
                <span id="wwgpt-loading-text">Analyzing problem...</span>
            </div>
            <div class="wwgpt-card" id="wwgpt-hint1">
                <div class="wwgpt-card-header"><span>Hint 1</span><span class="wwgpt-card-toggle">▶</span></div>
                <div class="wwgpt-card-body"></div>
            </div>
            <div class="wwgpt-card" id="wwgpt-hint2">
                <div class="wwgpt-card-header"><span>Hint 2</span><span class="wwgpt-card-toggle">▶</span></div>
                <div class="wwgpt-card-body"></div>
            </div>
            <div class="wwgpt-card" id="wwgpt-hint3">
                <div class="wwgpt-card-header"><span>Hint 3</span><span class="wwgpt-card-toggle">▶</span></div>
                <div class="wwgpt-card-body"></div>
            </div>
            <div class="wwgpt-card" id="wwgpt-solution">
                <div class="wwgpt-card-header"><span>Solution</span><span class="wwgpt-card-toggle">▶</span></div>
                <div class="wwgpt-card-body"></div>
            </div>
        </div>
        <div class="wwgpt-tab-content hidden" id="wwgpt-tab-chat">
            <div class="wwgpt-chat-log" id="wwgpt-chat-log"></div>
            <div class="wwgpt-chat-input-row">
                <textarea id="wwgpt-chat-input" placeholder="Ask anything about this problem..." rows="2"></textarea>
                <button id="wwgpt-chat-send">Send</button>
            </div>
        </div>
        <div class="wwgpt-tab-content hidden" id="wwgpt-tab-notes">
            <div class="wwgpt-notes-container">
                <textarea class="wwgpt-notes-textarea" id="wwgpt-notes-content" placeholder="Take your notes here for this question..."></textarea>
                <div class="wwgpt-notes-status" id="wwgpt-notes-status">All notes saved locally</div>
            </div>
        </div>
        <div id="can-make-mistakes" style="font-size:8px; color:gray; text-align:center; padding:4px">
            LLMs can make mistakes. Hints, solutions, and chats are for reference only.
        </div>
    `;

    document.body.appendChild(sidebar);

    // Set initial width
    if (data.sidebarWidth) {
        sidebar.style.setProperty("--sidebar-width", `${data.sidebarWidth}px`);
    }

    if (data.sidebarCollapsed) {
        sidebar.classList.add("wwgpt-collapsed");
    }

    _setupEvents(sidebar);
    _checkUpdateNotification(sidebar);
    _loadCachedOrGenerate();
}

async function _checkUpdateNotification(sidebar) {
    const { updateAvailable, dismissedUpdateAt } =
        await chrome.storage.local.get([
            "updateAvailable",
            "dismissedUpdateAt",
        ]);

    if (!updateAvailable) return;

    if (dismissedUpdateAt) {
        const lastDate = new Date(dismissedUpdateAt).toDateString();
        const today = new Date().toDateString();
        if (lastDate === today) return;
    }

    const updateDiv = document.createElement("div");
    updateDiv.className = "wwgpt-update-notification";
    updateDiv.innerHTML = `
        <div class="wwgpt-update-content">
            <b>New Version Available! (${updateAvailable})</b>
            <p>Update to the latest version for better performance and fixes.</p>
            <div class="wwgpt-update-actions">
                <a href="https://theadev67.github.io/WeBWorK-GPT/docs/how-to-update" target="_blank">How to update</a>
                <button id="wwgpt-pause-update">Pause for today</button>
            </div>
        </div>
    `;

    sidebar.querySelector(".wwgpt-header").after(updateDiv);

    updateDiv
        .querySelector("#wwgpt-pause-update")
        .addEventListener("click", async () => {
            await chrome.storage.local.set({ dismissedUpdateAt: Date.now() });
            updateDiv.remove();
        });
}

// ---------------------------------------------------------------------------
// Event wiring
// ---------------------------------------------------------------------------

function _setupEvents(sidebar) {
    // Toggle collapse — logo or toggle button, not card headers
    // Toggle collapse — logo or toggle button, not card headers
    const updateCollapse = async (isCollapsed) => {
        const data = await Settings.get();
        data.sidebarCollapsed = isCollapsed;
        await Settings.set(data);
    };

    sidebar.querySelector(".wwgpt-logo").addEventListener("click", async () => {
        const isCollapsed = sidebar.classList.toggle("wwgpt-collapsed");
        await updateCollapse(isCollapsed);
    });
    sidebar
        .querySelector(".wwgpt-toggle-btn")
        .addEventListener("click", async (e) => {
            e.stopPropagation();
            const isCollapsed = sidebar.classList.toggle("wwgpt-collapsed");
            await updateCollapse(isCollapsed);
        });

    // Expand when clicking anywhere on collapsed sidebar
    sidebar
        .querySelector(".wwgpt-collapsed-overlay")
        .addEventListener("click", async (e) => {
            e.stopPropagation();
            sidebar.classList.remove("wwgpt-collapsed");
            await updateCollapse(false);
        });

    // Tab switching
    sidebar.querySelectorAll(".wwgpt-tab").forEach((tab) => {
        tab.addEventListener("click", (e) => {
            e.stopPropagation();
            sidebar
                .querySelectorAll(".wwgpt-tab")
                .forEach((t) => t.classList.remove("active"));
            sidebar
                .querySelectorAll(".wwgpt-tab-content")
                .forEach((c) => c.classList.add("hidden"));
            tab.classList.add("active");
            sidebar
                .querySelector(`#wwgpt-tab-${tab.dataset.tab}`)
                .classList.remove("hidden");
            if (tab.dataset.tab === "chat") {
                const log = sidebar.querySelector("#wwgpt-chat-log");
                log.scrollTop = log.scrollHeight;
            }
        });
    });

    // Collapsible cards
    sidebar.querySelectorAll(".wwgpt-card-header").forEach((header) => {
        header.addEventListener("click", (e) => {
            e.stopPropagation();
            header.parentElement.classList.toggle("open");
        });
    });

    // Regenerate
    sidebar.querySelector("#wwgpt-regen").addEventListener("click", (e) => {
        e.stopPropagation();
        generateAll(true);
    });

    // Chat — send button and Enter key
    const chatInput = sidebar.querySelector("#wwgpt-chat-input");
    sidebar
        .querySelector("#wwgpt-chat-send")
        .addEventListener("click", _sendChatMessage);
    chatInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            _sendChatMessage();
        }
    });

    _setupResizer(sidebar);
    enableClickToCopy(sidebar);
    _setupNotesEvents(sidebar);

    // Toggle via native chrome command
    chrome.runtime.onMessage.addListener(async (req) => {
        if (req.action === "toggle-sidebar") {
            const isCollapsed = sidebar.classList.toggle("wwgpt-collapsed");
            await updateCollapse(isCollapsed);
        } else if (req.action === "generation-complete") {
            const { path, seed } = _problemKey();
            if (req.path === path && req.seed === seed) {
                _displayHints(req.hints, false);
                _displaySolution(req.solution, false);
                _showSuccessNotification();
                document.getElementById("wwgpt-loading")?.classList.add("hidden");
            }
        } else if (req.action === "chat-complete") {
            const { path, seed } = _problemKey();
            if (req.path === path && req.seed === seed) {
                document.getElementById("wwgpt-typing")?.remove();
                _appendMessage("assistant", req.reply);
            }
        }
    });

    // Listen for status changes
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === "local") {
            const { path, seed } = _problemKey();
            const statusKey = `status_${Cache._sanitizePath(path)}_${seed || "0"}`;
            if (changes[statusKey]) {
                const status = changes[statusKey].newValue;
                if (status) {
                    _handleStatusUpdate(status);
                } else {
                    // Status cleared, hide loading if it was loading
                    document.getElementById("wwgpt-loading")?.classList.add("hidden");
                }
            }
        }
    });
}

function _handleStatusUpdate(status) {
    const loadingEl = document.getElementById("wwgpt-loading");
    const loadingTextEl = document.getElementById("wwgpt-loading-text");
    const typing = document.getElementById("wwgpt-typing");

    if (status.state === "loading") {
        loadingEl.classList.remove("hidden");
        if (loadingTextEl) loadingTextEl.textContent = status.text || "Working...";
    } else if (status.state === "chat-loading") {
        if (!typing) {
            const log = document.getElementById("wwgpt-chat-log");
            const typingDiv = document.createElement("div");
            typingDiv.id = "wwgpt-typing";
            typingDiv.className = "wwgpt-msg assistant wwgpt-typing";
            typingDiv.innerHTML = "<span></span><span></span><span></span>";
            log.appendChild(typingDiv);
            log.scrollTop = log.scrollHeight;
        }
    } else if (status.state === "error") {
        _showError(status.message);
        loadingEl.classList.add("hidden");
        typing?.remove();
    }
}

// ---------------------------------------------------------------------------
// Resize Logic
// ---------------------------------------------------------------------------

function _setupResizer(sidebar) {
    const handle = sidebar.querySelector(".wwgpt-resize-handle");
    let isResizing = false;

    handle.addEventListener("mousedown", (e) => {
        isResizing = true;
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
        sidebar.style.transition = "none"; // disable transition during drag
    });

    window.addEventListener("mousemove", (e) => {
        if (!isResizing) return;

        // WebWork is fixed at the right
        // The width is (window width) - (mouse X)
        let newWidth = window.innerWidth - e.clientX;

        // Constrain width
        if (newWidth < 300) newWidth = 300;
        if (newWidth > 800) newWidth = 800;

        sidebar.style.setProperty("--sidebar-width", `${newWidth}px`);
    });

    window.addEventListener("mouseup", async () => {
        if (!isResizing) return;
        isResizing = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        sidebar.style.transition = ""; // restore transition

        const currentWidth = parseInt(
            getComputedStyle(sidebar).getPropertyValue("--sidebar-width")
        );
        const data = await Settings.get();
        data.sidebarWidth = currentWidth;
        await Settings.set(data);
    });
}

// ---------------------------------------------------------------------------
// Cache / initial load
// ---------------------------------------------------------------------------

async function _loadCachedOrGenerate() {
    const { path, seed } = _problemKey();
    const cached = await Cache.get(path, seed);
    const status = await Status.get(path, seed);

    if (cached) {
        _displayHints(cached.hints, false);
        _displaySolution(cached.solution, false);
        _displayChatHistory(cached.chatHistory);
        _displayNotes(cached.notes);
    }

    if (status) {
        _handleStatusUpdate(status);
    } else if (!cached) {
        const settings = await Settings.get();
        if (settings.autoGenerate) {
            generateAll();
        } else {
            _showGenerateButton();
        }
    }
}

function _showGenerateButton() {
    const tabHints = document.getElementById("wwgpt-tab-hints");
    if (!tabHints) return;

    // Don't add if already exists or loading
    if (
        document.getElementById("wwgpt-manual-generate") ||
        !document.getElementById("wwgpt-loading")?.classList.contains("hidden")
    ) {
        return;
    }

    const btn = document.createElement("button");
    btn.id = "wwgpt-manual-generate";
    btn.className = "wwgpt-generate-btn";
    btn.textContent = "Generate Hints & Solutions";

    btn.addEventListener("click", async () => {
        btn.classList.add("fade-out");
        setTimeout(() => {
            btn.remove();
            generateAll(true);
        }, 300);
    });

    // Insert before loading indicator
    const loadingEl = document.getElementById("wwgpt-loading");
    if (loadingEl) {
        loadingEl.insertAdjacentElement("beforebegin", btn);
    } else {
        tabHints.prepend(btn);
    }
}

// ---------------------------------------------------------------------------
// Main generation
// ---------------------------------------------------------------------------

async function generateAll(force = false) {
    const settings = await Settings.get();
    if (!settings.llmConfig?.apiKey) {
        alert("Please configure your API key in the WeBWorK GPT settings.");
        chrome.runtime.openOptionsPage();
        return;
    }

    const problem = extractProblem();
    if (!problem) return;

    // Ensure the manual button is gone if we're generating
    document.getElementById("wwgpt-manual-generate")?.remove();

    const { path, seed } = _problemKey();

    // Clear previous output in UI
    for (let i = 1; i <= 3; i++) {
        const body = document.querySelector(`#wwgpt-hint${i} .wwgpt-card-body`);
        if (body) body.innerHTML = "";
        document.getElementById(`wwgpt-hint${i}`)?.classList.remove("open");
    }
    const solBody = document.querySelector("#wwgpt-solution .wwgpt-card-body");
    if (solBody) solBody.innerHTML = "";
    document.getElementById("wwgpt-solution")?.classList.remove("open");

    chrome.runtime.sendMessage({
        action: "generate-all",
        path,
        seed,
        problemText: problem.text,
    });
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

function _displayHints(hints, autoOpen = false) {
    if (!hints) return;
    for (let i = 1; i <= 3; i++) {
        const card = document.getElementById(`wwgpt-hint${i}`);
        const body = card?.querySelector(".wwgpt-card-body");
        if (!body) continue;
        body.innerHTML = renderMarkdown(hints[`hint${i}`] ?? "");
        if (autoOpen && i === 1) card.classList.add("open");
        typeset(body);
    }
}

function _displaySolution(solution, autoOpen = false) {
    if (!solution) return;
    const card = document.getElementById("wwgpt-solution");
    const body = card?.querySelector(".wwgpt-card-body");
    if (!body) return;
    body.innerHTML = renderMarkdown(solution);
    if (autoOpen) card.classList.add("open");
    typeset(body);
}

function _displayChatHistory(history) {
    const log = document.getElementById("wwgpt-chat-log");
    log.innerHTML = "";
    if (!history) return;
    history.forEach((msg) => _appendMessage(msg.role, msg.content));
}

function _appendMessage(role, content) {
    const log = document.getElementById("wwgpt-chat-log");
    const msgDiv = document.createElement("div");
    msgDiv.className = `wwgpt-msg ${role}`;
    msgDiv.innerHTML = renderMarkdown(content);
    log.appendChild(msgDiv);
    log.scrollTop = log.scrollHeight;
    typeset(msgDiv);
}

function _displayNotes(notes) {
    const textarea = document.getElementById("wwgpt-notes-content");
    if (textarea) {
        textarea.value = notes || "";
        _updateNotesDot(textarea.value);
    }
}

function _updateNotesDot(text) {
    const tab = document.querySelector('.wwgpt-tab[data-tab="notes"]');
    if (tab) {
        if (text && text.trim().length > 0) {
            tab.classList.add("has-notes");
        } else {
            tab.classList.remove("has-notes");
        }
    }
}

function _showError(msg) {
    const loadingEl = document.getElementById("wwgpt-loading");
    const errDiv = document.createElement("div");
    errDiv.className = "wwgpt-error";
    errDiv.textContent = msg;
    loadingEl.insertAdjacentElement("afterend", errDiv);
    setTimeout(() => errDiv.remove(), 10000);
}

function _showSuccessNotification() {
    const tabHints = document.getElementById("wwgpt-tab-hints");
    if (!tabHints) return;

    // Remove any existing notification
    const existing = tabHints.querySelector(".wwgpt-success");
    if (existing) existing.remove();

    const notification = document.createElement("div");
    notification.className = "wwgpt-success";
    notification.innerHTML = `
        <span class="wwgpt-success-icon">✅</span>
        <span class="wwgpt-success-text">Hints and Solutions generated</span>
    `;

    // Insert after loading indicator
    const loadingEl = document.getElementById("wwgpt-loading");
    if (loadingEl) {
        loadingEl.insertAdjacentElement("afterend", notification);
    } else {
        tabHints.prepend(notification);
    }

    // Trigger reflow for animation
    requestAnimationFrame(() => {
        notification.classList.add("show");
    });

    setTimeout(() => {
        notification.classList.remove("show");
        setTimeout(() => notification.remove(), 500);
    }, 5000);
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

async function _sendChatMessage() {
    const input = document.getElementById("wwgpt-chat-input");
    const text = input.value.trim();
    if (!text) return;

    const problem = extractProblem();
    const { path, seed } = _problemKey();

    _appendMessage("user", text);
    input.value = "";

    chrome.runtime.sendMessage({
        action: "chat",
        path,
        seed,
        problemText: problem?.text ?? "",
        text,
    });
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

function _setupNotesEvents(sidebar) {
    const textarea = sidebar.querySelector("#wwgpt-notes-content");
    const status = sidebar.querySelector("#wwgpt-notes-status");
    let saveTimeout;

    textarea.addEventListener("input", () => {
        status.textContent = "Saving...";
        _updateNotesDot(textarea.value);
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(async () => {
            const { path, seed } = _problemKey();
            const cached = (await Cache.get(path, seed)) ?? {
                hints: null,
                solution: null,
                chatHistory: [],
            };
            cached.notes = textarea.value;
            await Cache.set(path, seed, cached);
            status.textContent = "All notes saved locally";
            _updateNotesDot(textarea.value);
        }, 800);
    });
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function _problemKey() {
    return {
        path: window.location.pathname,
        seed:
            document.querySelector("input[name=effectiveSummarizedRandomSeed]")
                ?.value ?? "",
    };
}
