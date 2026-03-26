import { PROVIDER_MODELS } from "../modules/llm-provider.js";
import { Settings } from "../modules/storage.js";

const providerSelect = document.getElementById("provider-select");
const modelSelect = document.getElementById("model-select");
const chatModelSelect = document.getElementById("chat-model-select");
const customModelGroup = document.getElementById("custom-model-group");
const customModelInput = document.getElementById("custom-model-input");
const apiKeyInput = document.getElementById("api-key-input");
const acceptCheckbox = document.getElementById("accept-checkbox");
const enabledToggle = document.getElementById("enabled-toggle");
const saveButton = document.getElementById("save-button");
const statusMsg = document.getElementById("status-msg");

// Populate models based on provider
function updateModelList(provider, currentPrimary = null, currentChat = null) {
    const models = PROVIDER_MODELS[provider] || [];

    // Clear and populate Primary Model (only JSON-capable models)
    modelSelect.innerHTML = "";
    models
        .filter((m) => m.supportsJson !== false)
        .forEach((m) => {
            const opt = document.createElement("option");
            opt.value = m.id;
            opt.textContent =
                m.name + (m.primaryComment ? ` (${m.primaryComment})` : "");
            modelSelect.appendChild(opt);
        });
    // Add custom option to primary
    const customOpt = document.createElement("option");
    customOpt.value = "custom";
    customOpt.textContent = "Custom... (Paste ID)";
    modelSelect.appendChild(customOpt);

    // Clear and populate Chat Model
    chatModelSelect.innerHTML = "";
    models.forEach((m) => {
        const opt = document.createElement("option");
        opt.value = m.id;
        opt.textContent = m.name + (m.chatComment ? ` (${m.chatComment})` : "");
        chatModelSelect.appendChild(opt);
    });

    // Default logic for Gemini
    if (provider === "gemini") {
        if (!currentPrimary) modelSelect.value = "gemini-2.5-flash";
        if (!currentChat) chatModelSelect.value = "gemma-3-27b-it";
    }

    if (currentPrimary) {
        const isPredefined = Array.from(modelSelect.options).some(
            (o) => o.value === currentPrimary
        );
        if (isPredefined) {
            modelSelect.value = currentPrimary;
        } else {
            modelSelect.value = "custom";
            customModelInput.value = currentPrimary;
        }
    }
    if (currentChat) {
        const isPredefined = Array.from(chatModelSelect.options).some(
            (o) => o.value === currentChat
        );
        if (isPredefined) chatModelSelect.value = currentChat;
    }

    handleModelChange();
}

function handleModelChange() {
    customModelGroup.style.display =
        modelSelect.value === "custom" ? "block" : "none";
}

// Load existing settings
async function loadSettings() {
    const data = await Settings.get();
    const config = data.llmConfig || {};

    if (config.provider) {
        providerSelect.value = config.provider;
    }

    updateModelList(providerSelect.value, config.model, config.chatModel);

    if (config.apiKey) apiKeyInput.value = config.apiKey;

    acceptCheckbox.checked = !!data.disclaimerAccepted;
    enabledToggle.checked = data.enabled !== false; // default true
}

// Save settings
async function saveSettings() {
    if (!acceptCheckbox.checked) {
        statusMsg.textContent = "❌ You must accept the disclaimer to save.";
        statusMsg.style.color = "red";
        return;
    }

    const modelValue =
        modelSelect.value === "custom"
            ? customModelInput.value.trim()
            : modelSelect.value;

    const chatModelValue = chatModelSelect.value;

    if (!modelValue || !chatModelValue) {
        statusMsg.textContent = "❌ Please select models.";
        statusMsg.style.color = "red";
        return;
    }

    const llmConfig = {
        provider: providerSelect.value,
        model: modelValue,
        chatModel: chatModelValue,
        apiKey: apiKeyInput.value,
    };

    await Settings.set({
        llmConfig,
        disclaimerAccepted: true,
        enabled: enabledToggle.checked,
    });

    statusMsg.textContent = "✅ Settings saved successfully!";
    statusMsg.style.color = "green";

    setTimeout(() => {
        statusMsg.textContent = "";
    }, 3000);
}

// Listeners
providerSelect.addEventListener("change", (e) =>
    updateModelList(e.target.value)
);
modelSelect.addEventListener("change", handleModelChange);
saveButton.addEventListener("click", saveSettings);

// Init
document.addEventListener("DOMContentLoaded", loadSettings);
