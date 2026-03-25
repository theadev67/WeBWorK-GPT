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
import { typeset, enableClickToCopy } from "./math-utils.js";

export async function mountSidebar() {
    const data = await Settings.get();
    if (!data.disclaimerAccepted) return;

    const sidebar = document.createElement("div");
    sidebar.id = "wwgpt-sidebar";
    sidebar.className = "wwgpt-sidebar";

    sidebar.innerHTML = `
    <div class="wwgpt-header">
      <span class="wwgpt-logo">🤖 WeBWorK GPT</span>
      <button class="wwgpt-toggle-btn" aria-label="Toggle sidebar">›</button>
    </div>
    <div class="wwgpt-body">
      <div class="wwgpt-section" id="wwgpt-hints-section">
        <div class="wwgpt-card" id="wwgpt-hint1">
          <div class="wwgpt-card-header"><span>Hint 1</span> <span class="wwgpt-card-toggle">▶</span></div>
          <div class="wwgpt-card-body"></div>
        </div>
        <div class="wwgpt-card" id="wwgpt-hint2">
          <div class="wwgpt-card-header"><span>Hint 2</span> <span class="wwgpt-card-toggle">▶</span></div>
          <div class="wwgpt-card-body"></div>
        </div>
        <div class="wwgpt-card" id="wwgpt-hint3">
          <div class="wwgpt-card-header"><span>Hint 3</span> <span class="wwgpt-card-toggle">▶</span></div>
          <div class="wwgpt-card-body"></div>
        </div>
      </div>

      <div class="wwgpt-card" id="wwgpt-solution">
        <div class="wwgpt-card-header"><span>Solution</span> <span class="wwgpt-card-toggle">▶</span></div>
        <div class="wwgpt-card-body"></div>
      </div>

      <div class="wwgpt-loading hidden" id="wwgpt-loading">
        <div class="wwgpt-spinner"></div> <span id="wwgpt-loading-text">Analyzing problem...</span>
      </div>

      <button class="wwgpt-regen-btn" id="wwgpt-regen">↺ Regenerate All</button>

      <div class="wwgpt-discuss collapsed" id="wwgpt-discuss">
        <div class="wwgpt-discuss-header">
          <span>💬 Math Chat</span>
          <button class="wwgpt-card-toggle">▼</button>
        </div>
        <div class="wwgpt-discuss-body">
          <div class="wwgpt-chat-log" id="wwgpt-chat-log"></div>
          <div class="wwgpt-chat-input-row">
            <textarea id="wwgpt-chat-input" placeholder="Ask about this problem..." rows="2"></textarea>
            <button id="wwgpt-chat-send">Send</button>
          </div>
        </div>
      </div>
    </div>
  `;

    document.body.appendChild(sidebar);
    setupEvents(sidebar);
    loadCachedOrGenerate();
}

function setupEvents(sidebar) {
    // Toggle sidebar
    sidebar.querySelector(".wwgpt-header").addEventListener("click", () => {
        sidebar.classList.toggle("wwgpt-collapsed");
    });

    // Toggle cards
    sidebar.querySelectorAll(".wwgpt-card-header").forEach((header) => {
        header.addEventListener("click", (e) => {
            e.stopPropagation();
            header.parentElement.classList.toggle("open");
        });
    });

    // Toggle chat
    sidebar
        .querySelector(".wwgpt-discuss-header")
        .addEventListener("click", () => {
            sidebar
                .querySelector("#wwgpt-discuss")
                .classList.toggle("collapsed");
        });

    // Regenerate
    sidebar
        .querySelector("#wwgpt-regen")
        .addEventListener("click", () => generateAll(true));

    // Chat send
    const chatInput = sidebar.querySelector("#wwgpt-chat-input");
    const chatSend = sidebar.querySelector("#wwgpt-chat-send");
    chatSend.addEventListener("click", () => sendChatMessage());
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
        displayHints(cached.hints);
        displaySolution(cached.solution);
        displayChatHistory(cached.chatHistory);
    } else {
        generateAll();
    }
}

async function generateAll(force = false) {
    const settings = await Settings.get();
    if (!settings.llmConfig || !settings.llmConfig.apiKey) {
        alert("Please configure your API key in the WeBWorK GPT settings.");
        chrome.runtime.openOptionsPage();
        return;
    }

    const problem = extractProblem();
    if (!problem) return;

    const loading = document.getElementById("wwgpt-loading");
    loading.classList.remove("hidden");

    try {
        const images = await fetchImagesAsBase64(problem.images);

        // 1. Generate Hints
        document.getElementById("wwgpt-loading-text").textContent =
            "Generating hints...";
        const hintsPrompt = buildHintsPrompt(problem.text);
        const hintsResponse = await complete(
            [buildMultimodalUserMessage(hintsPrompt.user, images)],
            { ...settings.llmConfig, system: hintsPrompt.system }
        );
        const hints = JSON.parse(
            hintsResponse.replace(/```json|```/g, "").trim()
        );
        displayHints(hints);

        // 2. Generate Solution
        document.getElementById("wwgpt-loading-text").textContent =
            "Writing solution...";
        const solutionPrompt = buildSolutionPrompt(problem.text);
        const solution = await complete(
            [buildMultimodalUserMessage(solutionPrompt.user, images)],
            { ...settings.llmConfig, system: solutionPrompt.system }
        );
        displaySolution(solution);

        // Cache results
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
        alert("Failed to generate content: " + err.message);
    } finally {
        loading.classList.add("hidden");
    }
}

function displayHints(hints) {
    if (!hints) return;
    for (let i = 1; i <= 3; i++) {
        const body = document.querySelector(`#wwgpt-hint${i} .wwgpt-card-body`);
        body.innerHTML = hints[`hint${i}`] || "";
        typeset(body);
    }
}

function displaySolution(solution) {
    if (!solution) return;
    const body = document.querySelector("#wwgpt-solution .wwgpt-card-body");
    body.innerHTML = solution.replace(/\n/g, "<br>");
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
    msgDiv.innerHTML = content.replace(/\n/g, "<br>");
    log.appendChild(msgDiv);
    log.scrollTop = log.scrollHeight;
    typeset(msgDiv);
}

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

    const messages = [
        { role: "system", content: buildChatSystemPrompt(problem.text) },
        ...cached.chatHistory,
        { role: "user", content: text },
    ];

    try {
        const assistantMsg = await complete(messages, settings.llmConfig);
        appendMessage("assistant", assistantMsg);

        cached.chatHistory.push({ role: "user", content: text });
        cached.chatHistory.push({ role: "assistant", content: assistantMsg });
        await Cache.set(problemPath, randomSeed, cached);
    } catch (err) {
        appendMessage("assistant", "Error: " + err.message);
    }
}
