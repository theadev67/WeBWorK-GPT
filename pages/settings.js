import { PROVIDER_MODELS } from "../modules/llm-provider.js";
import { Settings } from "../modules/storage.js";

const providerSelect = document.getElementById("provider-select");
const modelSelect = document.getElementById("model-select");
const customModelGroup = document.getElementById("custom-model-group");
const customModelInput = document.getElementById("custom-model-input");
const apiKeyInput = document.getElementById("api-key-input");
const acceptCheckbox = document.getElementById("accept-checkbox");
const enabledToggle = document.getElementById("enabled-toggle");
const saveButton = document.getElementById("save-button");
const statusMsg = document.getElementById("status-msg");

// Populate models based on provider
function updateModelList(provider) {
    const models = PROVIDER_MODELS[provider] || [];
    modelSelect.innerHTML = "";

    models.forEach((m) => {
        const opt = document.createElement("option");
        opt.value = m.id;
        opt.textContent = m.label;
        modelSelect.appendChild(opt);
    });

    // Add custom option
    const customOpt = document.createElement("option");
    customOpt.value = "custom";
    customOpt.textContent = "Custom... (Paste ID)";
    modelSelect.appendChild(customOpt);

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

    updateModelList(providerSelect.value);

    if (config.model) {
        // Check if it's one of the predefined models
        const isPredefined = Array.from(modelSelect.options).some(
            (opt) => opt.value === config.model
        );
        if (isPredefined) {
            modelSelect.value = config.model;
        } else {
            modelSelect.value = "custom";
            customModelInput.value = config.model;
        }
    }

    handleModelChange();

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

    if (!modelValue) {
        statusMsg.textContent = "❌ Please select or enter a model.";
        statusMsg.style.color = "red";
        return;
    }

    const llmConfig = {
        provider: providerSelect.value,
        model: modelValue,
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
