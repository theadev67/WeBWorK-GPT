import { Settings, Cache } from "../modules/storage.js";
import {
    extractProblem,
    buildHintsPrompt,
    buildSolutionPrompt,
    buildChatSystemPrompt,
} from "../modules/prompts.js";
import { complete } from "../modules/llm-provider.js";
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
            <span class="wwgpt-logo">🤖 WeBWorK GPT</span>
            <div class="wwgpt-header-actions">
                <button class="wwgpt-regen-btn" id="wwgpt-regen" title="Regenerate hints &amp; solution">↺</button>
                <button class="wwgpt-toggle-btn" aria-label="Toggle sidebar">›</button>
            </div>
        </div>
        <div class="wwgpt-tabs">
            <button class="wwgpt-tab active" data-tab="hints">Hints &amp; Solution</button>
            <button class="wwgpt-tab" data-tab="chat">💬 Math Chat</button>
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
        <div id="can-make-mistakes" style="font-size:8px; color:gray; text-align:center; padding:4px">
            LLMs can make mistakes. Hints, solutions, and chats are for reference only.
        </div>
    `;

    document.body.appendChild(sidebar);

    // Set initial width
    if (data.sidebarWidth) {
        sidebar.style.setProperty("--sidebar-width", `${data.sidebarWidth}px`);
    }

    _setupEvents(sidebar);
    _loadCachedOrGenerate();
}

// ---------------------------------------------------------------------------
// Event wiring
// ---------------------------------------------------------------------------

function _setupEvents(sidebar) {
    // Toggle collapse — logo or toggle button, not card headers
    sidebar.querySelector(".wwgpt-logo").addEventListener("click", () => {
        sidebar.classList.toggle("wwgpt-collapsed");
    });
    sidebar
        .querySelector(".wwgpt-toggle-btn")
        .addEventListener("click", (e) => {
            e.stopPropagation();
            sidebar.classList.toggle("wwgpt-collapsed");
        });

    // Expand when clicking anywhere on collapsed sidebar
    sidebar
        .querySelector(".wwgpt-collapsed-overlay")
        .addEventListener("click", (e) => {
            e.stopPropagation();
            sidebar.classList.remove("wwgpt-collapsed");
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
    if (cached) {
        _displayHints(cached.hints, false);
        _displaySolution(cached.solution, false);
        _displayChatHistory(cached.chatHistory);
    } else {
        generateAll();
    }
}

// ---------------------------------------------------------------------------
// Retry helper — handles transient network / 503 errors
// ---------------------------------------------------------------------------

async function _callWithRetry(fn, maxRetries = 2) {
    let lastErr;
    for (let i = 0; i <= maxRetries; i++) {
        try {
            return await fn();
        } catch (e) {
            lastErr = e;
            if (i < maxRetries) {
                const delay = 1200 * (i + 1);
                console.warn(
                    `[WeBWorK GPT] Retry ${
                        i + 1
                    }/${maxRetries} after ${delay}ms:`,
                    e.message
                );
                await new Promise((r) => setTimeout(r, delay));
            }
        }
    }
    throw lastErr;
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

    const loadingEl = document.getElementById("wwgpt-loading");
    const loadingTextEl = document.getElementById("wwgpt-loading-text");
    loadingEl.classList.remove("hidden");

    const stuckTimeout = setTimeout(() => {
        if (loadingTextEl)
            loadingTextEl.textContent =
                "Taking longer than usual... try refreshing if stuck.";
    }, 20000);

    // Clear previous output
    for (let i = 1; i <= 3; i++) {
        const body = document.querySelector(`#wwgpt-hint${i} .wwgpt-card-body`);
        if (body) body.innerHTML = "";
        document.getElementById(`wwgpt-hint${i}`)?.classList.remove("open");
    }
    const solBody = document.querySelector("#wwgpt-solution .wwgpt-card-body");
    if (solBody) solBody.innerHTML = "";
    document.getElementById("wwgpt-solution")?.classList.remove("open");

    try {
        // Hints — JSON mode, responseSchema enforced at the API level.
        // JSON.parse is safe here: the model physically cannot emit malformed JSON in this mode.
        loadingTextEl.textContent = "Generating hints...";
        const hintsPrompt = buildHintsPrompt(problem.text);
        const hints = await _callWithRetry(async () => {
            const raw = await complete(
                [
                    { role: "system", content: hintsPrompt.system },
                    { role: "user", content: hintsPrompt.user },
                ],
                settings.llmConfig,
                null, // no streaming — JSON streaming is not useful
                "hint"
            );
            return JSON.parse(raw);
        });
        _displayHints(hints, false);

        // Solution — free-form markdown, no JSON schema
        loadingTextEl.textContent = "Writing solution...";
        const solutionPrompt = buildSolutionPrompt(problem.text);
        const solution = await _callWithRetry(() =>
            complete(
                [
                    { role: "system", content: solutionPrompt.system },
                    { role: "user", content: solutionPrompt.user },
                ],
                settings.llmConfig,
                null,
                "solution"
            )
        );
        _displaySolution(solution, false);
        _showSuccessNotification();

        // Persist — preserve existing chat history across regeneration
        const { path, seed } = _problemKey();
        const prev = (await Cache.get(path, seed)) ?? { chatHistory: [] };
        await Cache.set(path, seed, {
            hints,
            solution,
            chatHistory: prev.chatHistory,
        });
    } catch (err) {
        console.error("Generation failed:", err);
        _showError(err.message);
    } finally {
        clearTimeout(stuckTimeout);
        loadingEl.classList.add("hidden");
    }
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

    const settings = await Settings.get();
    const problem = extractProblem();
    const { path, seed } = _problemKey();
    const cached = (await Cache.get(path, seed)) ?? { chatHistory: [] };

    _appendMessage("user", text);
    input.value = "";

    // Typing indicator
    const log = document.getElementById("wwgpt-chat-log");
    const typing = document.createElement("div");
    typing.id = "wwgpt-typing";
    typing.className = "wwgpt-msg assistant wwgpt-typing";
    typing.innerHTML = "<span></span><span></span><span></span>";
    log.appendChild(typing);
    log.scrollTop = log.scrollHeight;

    const messages = [
        { role: "system", content: buildChatSystemPrompt(problem?.text ?? "") },
        ...cached.chatHistory,
        { role: "user", content: text },
    ];

    try {
        const reply = await _callWithRetry(() =>
            complete(messages, settings.llmConfig, null, "chat")
        );
        document.getElementById("wwgpt-typing")?.remove();
        _appendMessage("assistant", reply);

        cached.chatHistory.push({ role: "user", content: text });
        cached.chatHistory.push({ role: "assistant", content: reply });
        await Cache.set(path, seed, cached);
    } catch (err) {
        document.getElementById("wwgpt-typing")?.remove();
        _appendMessage("assistant", `⚠️ Error: ${err.message}`);
    }
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
