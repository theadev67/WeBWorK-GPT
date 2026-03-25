import { Settings, Cache } from "../modules/storage.js";
import {
    extractProblem,
    buildHintsPrompt,
    buildSolutionPrompt,
    buildChatSystemPrompt,
    buildMultimodalUserMessage,
    fetchImagesAsBase64,
} from "../modules/prompts.js";
import { complete } from "../modules/llm-provider.js";
import { typeset, enableClickToCopy, renderMarkdown } from "./math-utils.js";

export async function mountSidebar() {
    const data = await Settings.get();
    if (!data.disclaimerAccepted) return;

    const sidebar = document.createElement("div");
    sidebar.id = "wwgpt-sidebar";

    sidebar.innerHTML = `
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
  `;

    document.body.appendChild(sidebar);
    setupEvents(sidebar);
    loadCachedOrGenerate();
}

function setupEvents(sidebar) {
    // Toggle sidebar collapse (header click, but not buttons inside)
    sidebar.querySelector(".wwgpt-logo").addEventListener("click", () => {
        sidebar.classList.toggle("wwgpt-collapsed");
    });
    sidebar
        .querySelector(".wwgpt-toggle-btn")
        .addEventListener("click", (e) => {
            e.stopPropagation();
            sidebar.classList.toggle("wwgpt-collapsed");
        });

    // Tab switching
    sidebar.querySelectorAll(".wwgpt-tab").forEach((tab) => {
        tab.addEventListener("click", (e) => {
            e.stopPropagation();
            sidebar
                .querySelectorAll(".wwgpt-tab")
                .forEach((t) => t.classList.remove("active"));
            tab.classList.add("active");
            sidebar
                .querySelectorAll(".wwgpt-tab-content")
                .forEach((c) => c.classList.add("hidden"));
            sidebar
                .querySelector(`#wwgpt-tab-${tab.dataset.tab}`)
                .classList.remove("hidden");
            if (tab.dataset.tab === "chat") {
                const log = sidebar.querySelector("#wwgpt-chat-log");
                log.scrollTop = log.scrollHeight;
            }
        });
    });

    // Toggle collapsible cards
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

    // Chat send
    const chatInput = sidebar.querySelector("#wwgpt-chat-input");
    sidebar
        .querySelector("#wwgpt-chat-send")
        .addEventListener("click", () => sendChatMessage());
    chatInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendChatMessage();
        }
    });

    enableClickToCopy(sidebar);
}

async function loadCachedOrGenerate() {
    const problemPath = window.location.pathname;
    const randomSeed = document.querySelector(
        'input[name="effectiveSummarizedRandomSeed"]'
    )?.value;
    const cached = await Cache.get(problemPath, randomSeed);
    if (cached) {
        displayHints(cached.hints, true);
        displaySolution(cached.solution, true);
        displayChatHistory(cached.chatHistory);
    } else {
        generateAll();
    }
}

// ─── Retry helpers ────────────────────────────────────────────────────────────

async function callWithRetry(fn, maxRetries = 2) {
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

/**
 * Extract JSON from LLM response that may wrap it in code fences or have extra text.
 */
function extractJSON(raw) {
    // Remove markdown fences
    let cleaned = raw
        .replace(/```(?:json)?\s*/gi, "")
        .replace(/```\s*/g, "")
        .trim();
    // Try direct parse first
    try {
        return JSON.parse(cleaned);
    } catch {}
    // Find first {...} block
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
        try {
            return JSON.parse(match[0]);
        } catch {}
    }
    // Last resort: try to fix common escape issues then parse
    const fixed = cleaned.replace(/\\(?!["\\/bfnrtu])/g, "\\\\");
    return JSON.parse(fixed);
}

// ─── Main generation ──────────────────────────────────────────────────────────

async function generateAll(force = false) {
    const settings = await Settings.get();
    if (!settings.llmConfig || !settings.llmConfig.apiKey) {
        alert("Please configure your API key in the WeBWorK GPT settings.");
        chrome.runtime.openOptionsPage();
        return;
    }

    const problem = extractProblem();
    if (!problem) return;

    const loadingEl = document.getElementById("wwgpt-loading");
    loadingEl.classList.remove("hidden");

    // Clear previous output
    for (let i = 1; i <= 3; i++) {
        const body = document.querySelector(`#wwgpt-hint${i} .wwgpt-card-body`);
        if (body) {
            body.innerHTML = "";
            document.getElementById(`wwgpt-hint${i}`).classList.remove("open");
        }
    }
    const solCard = document.getElementById("wwgpt-solution");
    const solBody = solCard?.querySelector(".wwgpt-card-body");
    if (solBody) {
        solBody.innerHTML = "";
        solCard.classList.remove("open");
    }

    try {
        const images = await fetchImagesAsBase64(problem.images);

        // ── Hints ──
        document.getElementById("wwgpt-loading-text").textContent =
            "Generating hints...";
        const hintsPrompt = buildHintsPrompt(problem.text);

        const hints = await callWithRetry(async () => {
            const raw = await complete(
                [
                    { role: "system", content: hintsPrompt.system },
                    buildMultimodalUserMessage(hintsPrompt.user, images),
                ],
                settings.llmConfig
            );
            return extractJSON(raw);
        });
        displayHints(hints, true); // auto-open hint 1

        // ── Solution ──
        document.getElementById("wwgpt-loading-text").textContent =
            "Writing solution...";
        const solutionPrompt = buildSolutionPrompt(problem.text);

        const solution = await callWithRetry(() =>
            complete(
                [
                    { role: "system", content: solutionPrompt.system },
                    buildMultimodalUserMessage(solutionPrompt.user, images),
                ],
                settings.llmConfig
            )
        );
        displaySolution(solution, true); // auto-open solution card

        // ── Cache ──
        const problemPath = window.location.pathname;
        const randomSeed = document.querySelector(
            'input[name="effectiveSummarizedRandomSeed"]'
        )?.value;
        await Cache.set(problemPath, randomSeed, {
            hints,
            solution,
            chatHistory: [],
        });
    } catch (err) {
        console.error("Generation failed:", err);
        showError(err.message);
    } finally {
        loadingEl.classList.add("hidden");
    }
}

// ─── Display helpers ──────────────────────────────────────────────────────────

function displayHints(hints, autoOpen = false) {
    if (!hints) return;
    for (let i = 1; i <= 3; i++) {
        const card = document.getElementById(`wwgpt-hint${i}`);
        const body = card?.querySelector(".wwgpt-card-body");
        if (!body) continue;
        body.innerHTML = renderMarkdown(hints[`hint${i}`] || "");
        // Auto-open only the first hint
        if (autoOpen && i === 1) card.classList.add("open");
        typeset(body);
    }
}

function displaySolution(solution, autoOpen = false) {
    if (!solution) return;
    const card = document.getElementById("wwgpt-solution");
    const body = card?.querySelector(".wwgpt-card-body");
    if (!body) return;
    body.innerHTML = renderMarkdown(solution);
    if (autoOpen) card.classList.add("open");
    typeset(body);
}

function displayChatHistory(history) {
    const log = document.getElementById("wwgpt-chat-log");
    log.innerHTML = "";
    if (!history) return;
    history.forEach((msg) => appendMessage(msg.role, msg.content));
}

function appendMessage(role, content) {
    const log = document.getElementById("wwgpt-chat-log");
    const msgDiv = document.createElement("div");
    msgDiv.className = `wwgpt-msg ${role}`;
    msgDiv.innerHTML = renderMarkdown(content);
    log.appendChild(msgDiv);
    log.scrollTop = log.scrollHeight;
    typeset(msgDiv);
}

function showError(msg) {
    const loadingEl = document.getElementById("wwgpt-loading");
    const errDiv = document.createElement("div");
    errDiv.className = "wwgpt-error";
    errDiv.textContent = "⚠️ " + msg;
    loadingEl.insertAdjacentElement("afterend", errDiv);
    setTimeout(() => errDiv.remove(), 10000);
}

// ─── Chat ─────────────────────────────────────────────────────────────────────

async function sendChatMessage() {
    const input = document.getElementById("wwgpt-chat-input");
    const text = input.value.trim();
    if (!text) return;

    const settings = await Settings.get();
    const problem = extractProblem();
    const problemPath = window.location.pathname;
    const randomSeed = document.querySelector(
        'input[name="effectiveSummarizedRandomSeed"]'
    )?.value;
    const cached = (await Cache.get(problemPath, randomSeed)) || {
        chatHistory: [],
    };

    appendMessage("user", text);
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
        { role: "system", content: buildChatSystemPrompt(problem.text) },
        ...cached.chatHistory,
        { role: "user", content: text },
    ];

    try {
        const assistantMsg = await callWithRetry(() =>
            complete(messages, settings.llmConfig)
        );
        document.getElementById("wwgpt-typing")?.remove();
        appendMessage("assistant", assistantMsg);
        cached.chatHistory.push({ role: "user", content: text });
        cached.chatHistory.push({ role: "assistant", content: assistantMsg });
        await Cache.set(problemPath, randomSeed, cached);
    } catch (err) {
        document.getElementById("wwgpt-typing")?.remove();
        appendMessage("assistant", "⚠️ Error: " + err.message);
    }
}
