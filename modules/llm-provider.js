export const PROVIDER_MODELS = {
    openai: [
        { id: "gpt-4o", label: "GPT-4o" },
        { id: "gpt-4o-mini", label: "GPT-4o mini" },
        { id: "o3-mini", label: "o3-mini" },
    ],
    gemini: [
        { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
        { id: "gemini-2.0-pro-exp-02-05", label: "Gemini 2.0 Pro" },
    ],
    xai: [
        { id: "grok-2-1212", label: "Grok 2" },
        { id: "grok-beta", label: "Grok Beta" },
    ],
    claude: [
        { id: "claude-3-7-sonnet-20250219", label: "Claude 3.7 Sonnet" },
        { id: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku" },
    ],
    openrouter: [
        { id: "openrouter/auto", label: "Auto (Best for budget/quality)" },
        {
            id: "google/gemini-2.0-flash-exp:free",
            label: "Gemini 2.0 Flash (Free)",
        },
        {
            id: "nvidia/nemotron-3-super-120b-a12b:free",
            label: "Nemotron 3 Super (Free)",
        },
        { id: "openrouter/free", label: "OpenRouter Free (Dynamic)" },
    ],
};

/**
 * Unified entry point for LLM completions.
 * It automatically detects if it needs to proxy the request to the background script
 * (to bypass CSP and ensure header consistency) or call the API directly.
 */
export async function complete(messages, config, onChunk = null) {
    // If we are in a window (content script, popup, options) and the extension is available,
    // we proxy to the background script.
    if (
        typeof window !== "undefined" &&
        typeof chrome !== "undefined" &&
        chrome.runtime &&
        chrome.runtime.id
    ) {
        return _proxyToBackground(messages, config, onChunk);
    }
    // Otherwise, we are in the background script or a non-extension environment
    return _directComplete(messages, config, onChunk);
}

/**
 * Perform the actual API call.
 */
async function _directComplete(messages, config, onChunk = null) {
    switch (config.provider) {
        case "openai":
        case "xai":
        case "openrouter":
            return _openaiCompatible(messages, config, onChunk);
        case "gemini":
            return _gemini(messages, config, onChunk);
        case "claude":
            return _claude(messages, config, onChunk);
        default:
            throw new Error(`Unknown provider: ${config.provider}`);
    }
}

/**
 * Proxy the request to the background service worker using a port (for streaming support).
 */
function _proxyToBackground(messages, config, onChunk) {
    return new Promise((resolve, reject) => {
        try {
            const port = chrome.runtime.connect({ name: "llm-stream" });

            port.onMessage.addListener((msg) => {
                if (msg.type === "chunk") {
                    if (onChunk) onChunk(msg.data);
                } else if (msg.type === "done") {
                    resolve(msg.data);
                    port.disconnect();
                } else if (msg.type === "error") {
                    reject(new Error(msg.data));
                    port.disconnect();
                }
            });

            port.onDisconnect.addListener(() => {
                const lastError = chrome.runtime.lastError;
                if (lastError) {
                    reject(
                        new Error(
                            "Extension port disconnected: " + lastError.message
                        )
                    );
                } else {
                    // Normal disconnect (or other side disconnected without error message)
                }
            });

            port.postMessage({ messages, config });
        } catch (err) {
            reject(err);
        }
    });
}

async function _openaiCompatible(messages, config, onChunk) {
    let baseURL = "https://api.openai.com/v1";
    if (config.provider === "xai") baseURL = "https://api.x.ai/v1";
    if (config.provider === "openrouter")
        baseURL = "https://openrouter.ai/api/v1";

    const res = await fetch(`${baseURL}/chat/completions`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
            ...(config.provider === "openrouter"
                ? {
                      "HTTP-Referer":
                          "https://github.com/theadev67/WeBWorK-GPT",
                      "X-Title": "WeBWorK GPT",
                  }
                : {}),
        },
        body: JSON.stringify({
            model: config.model,
            messages,
            stream: !!onChunk,
            max_tokens: 2048,
            temperature: 0.3,
        }),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
            `${config.provider} API error: ${res.status} ${
                err.error?.message || ""
            }`
        );
    }

    if (onChunk) {
        return _consumeSSE(
            res,
            onChunk,
            (data) => data.choices?.[0]?.delta?.content ?? ""
        );
    }
    const json = await res.json();
    return json.choices[0].message.content;
}

async function _gemini(messages, config, onChunk) {
    const systemMsg = messages.find((m) => m.role === "system");
    const userMsgs = messages
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

    const endpoint = onChunk
        ? `streamGenerateContent?alt=sse&key=${config.apiKey}`
        : `generateContent?key=${config.apiKey}`;

    const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:${endpoint}`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                systemInstruction: systemMsg
                    ? { parts: [{ text: systemMsg.content }] }
                    : undefined,
                contents: userMsgs,
                generationConfig: { maxOutputTokens: 2048, temperature: 0.3 },
            }),
        }
    );

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
            `Gemini API error: ${res.status} ${err.error?.message || ""}`
        );
    }

    if (onChunk) {
        return _consumeSSE(
            res,
            onChunk,
            (data) => data.candidates?.[0]?.content?.parts?.[0]?.text ?? ""
        );
    }
    const json = await res.json();
    return json.candidates[0].content.parts[0].text;
}

async function _claude(messages, config, onChunk) {
    const systemMsg = messages.find((m) => m.role === "system")?.content ?? "";
    const filtered = messages
        .filter((m) => m.role !== "system")
        .map((m) => {
            if (Array.isArray(m.content)) {
                return {
                    role: m.role,
                    content: m.content
                        .map((c) => {
                            if (c.type === "text")
                                return { type: "text", text: c.text };
                            if (c.type === "image_url") {
                                const base64Data =
                                    c.image_url.url.split(",")[1];
                                const mimeType = c.image_url.url
                                    .split(":")[1]
                                    .split(";")[0];
                                return {
                                    type: "image",
                                    source: {
                                        type: "base64",
                                        media_type: mimeType,
                                        data: base64Data,
                                    },
                                };
                            }
                            return null;
                        })
                        .filter(Boolean),
                };
            }
            return m;
        });

    const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
            "x-api-key": config.apiKey,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
            "dangerously-allow-browser": "true",
        },
        body: JSON.stringify({
            model: config.model,
            system: systemMsg,
            messages: filtered,
            max_tokens: 2048,
            stream: !!onChunk,
        }),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
            `Claude API error: ${res.status} ${err.error?.message || ""}`
        );
    }

    if (onChunk) {
        return _consumeSSE(res, onChunk, (data) => {
            if (data.type === "content_block_delta")
                return data.delta?.text ?? "";
            return "";
        });
    }
    const json = await res.json();
    return json.content[0].text;
}

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
        buffer = lines.pop();

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
                /* skip malformed chunks */
            }
        }
    }
    return full;
}
