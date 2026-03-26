// ---------------------------------------------------------------------------
// Model list — ordered best → least suitable for math (see rate limit notes)
// ---------------------------------------------------------------------------

export const GEMINI_MODELS = [
    // Primary workhorse: thinking=true, 500 RPD, 15 RPM
    {
        id: "gemini-3.1-flash-lite-preview",
        label: "Gemini 3.1 Flash Lite (Latest, Fast)",
    },
    // Step up for hard problems: thinking=true, 20 RPD
    { id: "gemini-3-flash-preview", label: "Gemini 3 Flash (Latest, Best)" },
    // Fallback: well-proven math, thinking=true, 5 RPM / 20 RPD
    {
        id: "gemini-2.5-flash",
        label: "Gemini 2.5 Flash (Balanced, Recommended ⭐)",
    },
    // Lighter fallback: thinking=true, 10 RPM / 20 RPD
    { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite" },
    // Last resort: no thinking, but 30 RPM / 14.4K RPD — virtually unlimited for personal use
    { id: "gemma-3-27b-it", label: "Gemma 3 27B (Highest Rate Limit ✨)" },
    { id: "gemma-3-12b-it", label: "Gemma 3 12B" },
    { id: "gemma-3-4b-it", label: "Gemma 3 4B" },
    { id: "gemma-3-1b-it", label: "Gemma 3 1B" },
];

export const PROVIDER_MODELS = {
    gemini: GEMINI_MODELS,
};

// ---------------------------------------------------------------------------
// Hint JSON schema — enforced at the API level via responseSchema
// ---------------------------------------------------------------------------

const HINT_SCHEMA = {
    type: "OBJECT",
    properties: {
        hint1: { type: "STRING" },
        hint2: { type: "STRING" },
        hint3: { type: "STRING" },
    },
    required: ["hint1", "hint2", "hint3"],
};

// ---------------------------------------------------------------------------
// Per-mode generation config
// thinkingBudget: 0 = off (fast, good for hints), higher = more reasoning depth
// ---------------------------------------------------------------------------

const MODE_CONFIG = {
    hint: { maxOutputTokens: 1024, thinkingBudget: 0 },
    solution: { maxOutputTokens: 4096, thinkingBudget: 1024 },
    chat: { maxOutputTokens: 2048, thinkingBudget: 256 },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Unified entry point for LLM completions.
 * Proxies to the background service worker when called from a content script
 * or popup (required to bypass CSP and keep the API key out of page context).
 *
 * @param {Array}    messages  - Chat history in { role, content } format.
 * @param {Object}   config    - { model: string, apiKey: string }
 * @param {Function} onChunk   - Optional streaming callback (solution/chat only).
 * @param {string}   mode      - "hint" | "solution" | "chat"
 */
export async function complete(
    messages,
    config,
    onChunk = null,
    mode = "chat"
) {
    if (
        typeof window !== "undefined" &&
        typeof chrome !== "undefined" &&
        chrome.runtime?.id
    ) {
        return _proxyToBackground(messages, config, onChunk, mode);
    }
    return _callGemini(messages, config, onChunk, mode);
}

// ---------------------------------------------------------------------------
// Background proxy (content script → service worker via port)
// ---------------------------------------------------------------------------

function _proxyToBackground(messages, config, onChunk, mode) {
    return new Promise((resolve, reject) => {
        try {
            const port = chrome.runtime.connect({ name: "llm-stream" });

            port.onMessage.addListener((msg) => {
                if (msg.type === "chunk") {
                    onChunk?.(msg.data);
                } else if (msg.type === "done") {
                    resolve(msg.data);
                    port.disconnect();
                } else if (msg.type === "error") {
                    reject(new Error(msg.data));
                    port.disconnect();
                }
            });

            port.onDisconnect.addListener(() => {
                const err = chrome.runtime.lastError;
                if (err) reject(new Error("Port disconnected: " + err.message));
            });

            port.postMessage({ messages, config, mode });
        } catch (err) {
            reject(err);
        }
    });
}

// ---------------------------------------------------------------------------
// Gemini REST call
// ---------------------------------------------------------------------------

async function _callGemini(messages, config, onChunk, mode) {
    const { maxOutputTokens, thinkingBudget } =
        MODE_CONFIG[mode] ?? MODE_CONFIG.chat;
    const isGemma = config.model.startsWith("gemma-");
    const isHint = mode === "hint";

    // JSON streaming is not useful — accumulating and then parsing loses the point.
    // Force non-streaming for hints; respect caller preference for everything else.
    const streaming = !!onChunk && !isHint;

    const systemMsg = messages.find((m) => m.role === "system");
    const contents = messages
        .filter((m) => m.role !== "system")
        .map((m) => {
            if (Array.isArray(m.content)) {
                return {
                    role: m.role === "assistant" ? "model" : "user",
                    parts: m.content
                        .map((c) => {
                            if (c.type === "text") return { text: c.text };
                            if (c.type === "image_url") {
                                const base64Data =
                                    c.image_url.url.split(",")[1];
                                const mimeType = c.image_url.url
                                    .split(":")[1]
                                    .split(";")[0];
                                return {
                                    inlineData: { data: base64Data, mimeType },
                                };
                            }
                            return null;
                        })
                        .filter(Boolean),
                };
            }
            return {
                role: m.role === "assistant" ? "model" : "user",
                parts: [{ text: m.content }],
            };
        });

    const generationConfig = {
        maxOutputTokens,
        temperature: 0.3,
        // Hint mode: enforce JSON schema at the API level (no prompt engineering needed)
        ...(isHint
            ? {
                  responseMimeType: "application/json",
                  responseSchema: HINT_SCHEMA,
              }
            : {}),
        // Gemma models don't support thinkingConfig — skip it entirely for them
        ...(!isGemma ? { thinkingConfig: { thinkingBudget } } : {}),
    };

    const endpoint = streaming
        ? "streamGenerateContent?alt=sse"
        : "generateContent";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:${endpoint}`;

    const body = {
        contents,
        generationConfig,
    };

    // If using Gemma, some API configurations don't support systemInstruction.
    // Also, per user request, chat does not really need it.
    if (systemMsg && !isGemma) {
        body.systemInstruction = {
            parts: [{ text: systemMsg.content }],
        };
    } else if (systemMsg && isGemma) {
        // Gemma models: prepend the instructions to the first user message.
        // This ensures the model knows it's a math tutor and has the problem context
        // even if the API endpoint or configuration doesn't support a dedicated system field.
        const firstUserIndex = contents.findIndex((c) => c.role === "user");
        if (firstUserIndex !== -1) {
            const firstPart = contents[firstUserIndex].parts[0];
            if (firstPart && firstPart.text) {
                firstPart.text = `${systemMsg.content}\n\n---\n\n${firstPart.text}`;
            }
        }
    }

    const res = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": config.apiKey,
        },
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
            `Gemini API error: ${res.status} ${err.error?.message || ""}`
        );
    }

    if (streaming) {
        return _consumeSSE(
            res,
            onChunk,
            (data) => data.candidates?.[0]?.content?.parts?.[0]?.text ?? ""
        );
    }

    const json = await res.json();
    return json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

// ---------------------------------------------------------------------------
// SSE streaming helper
// ---------------------------------------------------------------------------

async function _consumeSSE(res, onChunk, extractText) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let full = "";
    let buffer = "";

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop(); // keep incomplete trailing line

        for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const raw = line.slice(6).trim();
            if (raw === "[DONE]") continue;
            try {
                const data = JSON.parse(raw);
                const chunk = extractText(data);
                if (chunk) {
                    full += chunk;
                    onChunk(chunk);
                }
            } catch {
                /* skip malformed SSE frames */
            }
        }
    }
    return full;
}
