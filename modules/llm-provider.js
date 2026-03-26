// ---------------------------------------------------------------------------
// Model list — ordered best → least suitable for math (see rate limit notes)
// ---------------------------------------------------------------------------

// Models and config are now fetched from constants via getConstants().
// See constants.json for the source of truth.
import { getConstants } from "./constants-provider.js";

// Note: llm-provider.js is shared. In content scripts it uses the client.
// In the background service worker, it will be called via complete(),
// which is already async.

async function getLlmConfig() {
    const { config } = await getConstants();
    return {
        models: config.gemini_models,
        modeConfig: config.mode_config,
    };
}

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

// Moved to getLlmConfig()

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
                // This listener is in the content script, receiving messages from the background script.
                // The instruction "Add logging to background.js for port messages" refers to the background script's side.
                // The provided snippet for `const { messages, config, mode } = msg;` is incorrect here,
                // as `msg` from the background script will contain `type` and `data` (e.g., chunk, done, error).
                // The `async` keyword is also not needed here.
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
    const { modeConfig } = await getLlmConfig();

    const { maxOutputTokens, thinkingBudget } = modeConfig?.[mode] ??
        modeConfig?.chat ?? { maxOutputTokens: 2048, thinkingBudget: 0 };
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
                                    inline_data: {
                                        data: base64Data,
                                        mime_type: mimeType,
                                    },
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

    const generation_config = {
        max_output_tokens: maxOutputTokens,
        temperature: 0.3,
        // Hint mode: enforce JSON schema at the API level (no prompt engineering needed)
        ...(isHint
            ? {
                  response_mime_type: "application/json",
                  response_schema: HINT_SCHEMA,
              }
            : {}),
        // Gemma models don't support thinking_config — skip it entirely for them
        ...(!isGemma
            ? { thinking_config: { include_thoughts: thinkingBudget > 0 } }
            : {}),
    };

    const endpoint = streaming
        ? "streamGenerateContent?alt=sse"
        : "generateContent";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:${endpoint}`;

    const res = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": config.apiKey,
        },
        body: JSON.stringify({
            ...(systemMsg?.content
                ? {
                      system_instruction: {
                          parts: [{ text: systemMsg.content }],
                      },
                  }
                : {}),
            contents,
            generation_config,
        }),
    });

    console.log(
        "[WeBWorK-GPT] fetch body:",
        JSON.stringify(
            {
                ...(systemMsg?.content
                    ? {
                          system_instruction: {
                              parts: [{ text: systemMsg.content }],
                          },
                      }
                    : {}),
                contents,
                generation_config,
            },
            null,
            2
        )
    );

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error("[WeBWorK-GPT] Gemini API error payload:", err);
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
