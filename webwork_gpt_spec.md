# WebWork GPT — Chrome Extension Technical Specification

**Version:** 1.0  
**Target:** Coding Agent Implementation  
**Stack:** Vanilla JS (ES Modules), Chrome Extension Manifest V3, MathJax 3 (host-provided)

---

## 1. Project Overview

A Chrome extension that injects a collapsible sidebar into WeBWorK problem pages, providing AI-generated progressive hints, a full solution, and a freeform math chat. Supports OpenAI, Google Gemini, xAI (Grok), and Anthropic Claude via a unified LLM provider module.

The extension never interferes with WeBWorK's form submission or server communication. All AI calls go directly from the browser to the respective provider API.

---

## 2. File & Directory Structure

```
webwork-gpt/
├── manifest.json
├── background.js                  # service worker (minimal, handles install event)
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
├── content/
│   ├── content.js                 # entry: detects WeBWorK page, mounts sidebar
│   ├── sidebar.js                 # sidebar DOM construction + logic
│   ├── sidebar.css
│   └── math-utils.js             # MathJax typesetting + equation click-to-copy
├── modules/
│   ├── llm-provider.js            # unified LLM abstraction (OpenAI/Gemini/xAI/Claude)
│   ├── storage.js                 # chrome.storage wrapper (sync + local)
│   └── prompts.js                 # all system/user prompt templates
├── pages/
│   ├── disclaimer.html
│   ├── disclaimer.css
│   └── disclaimer.js
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## 3. Manifest (manifest.json)

```json
{
  "manifest_version": 3,
  "name": "WebWork GPT",
  "version": "1.0.0",
  "description": "AI-powered hints, solutions, and math chat for WeBWorK problems.",
  "permissions": [
    "storage",
    "clipboardWrite"
  ],
  "host_permissions": [
    "https://*.elearning.ubc.ca/*",
    "https://webwork.elearning.ubc.ca/*",
    "https://api.openai.com/*",
    "https://generativelanguage.googleapis.com/*",
    "https://api.x.ai/*",
    "https://api.anthropic.com/*"
  ],
  "background": {
    "service_worker": "background.js"
  },
  "action": {
    "default_popup": "popup/popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "content_scripts": [
    {
      "matches": ["https://webwork.elearning.ubc.ca/*"],
      "js": ["content/content.js"],
      "css": ["content/sidebar.css"],
      "run_at": "document_idle"
    }
  ],
  "options_page": "pages/disclaimer.html",
  "web_accessible_resources": [
    {
      "resources": ["pages/*", "popup/*"],
      "matches": ["<all_urls>"]
    }
  ]
}
```

**Note:** Expand `host_permissions` `matches` patterns if WeBWorK is deployed at other UBC subdomains.

---

## 4. Background Service Worker (background.js)

```js
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.storage.local.set({ disclaimerSeen: false });
    chrome.tabs.create({ url: chrome.runtime.getURL('pages/disclaimer.html') });
  }
});
```

That is the entire background script. No persistent state lives here.

---

## 5. LLM Provider Module (modules/llm-provider.js)

This is the core abstraction. All four providers are wrapped behind a single async `complete(messages, options)` interface using `fetch()` — no external SDKs, no bundler required.

### 5.1 Provider Configuration Schema

```js
// Stored in chrome.storage.sync under key "llmConfig"
{
  provider: 'openai' | 'gemini' | 'xai' | 'claude',
  model: string,       // e.g. "gpt-4o", "gemini-2.0-flash", "grok-3", "claude-3-7-sonnet-latest"
  apiKey: string
}
```

### 5.2 Available Models Per Provider

```js
export const PROVIDER_MODELS = {
  openai: [
    { id: 'gpt-4o',       label: 'GPT-4o' },
    { id: 'gpt-4o-mini',  label: 'GPT-4o mini' },
    { id: 'o3-mini',      label: 'o3-mini' },
  ],
  gemini: [
    { id: 'gemini-2.0-flash',         label: 'Gemini 2.0 Flash' },
    { id: 'gemini-2.5-pro-preview',   label: 'Gemini 2.5 Pro' },
  ],
  xai: [
    { id: 'grok-3',       label: 'Grok 3' },
    { id: 'grok-3-mini',  label: 'Grok 3 mini' },
  ],
  claude: [
    { id: 'claude-3-7-sonnet-latest', label: 'Claude 3.7 Sonnet' },
    { id: 'claude-3-5-haiku-latest',  label: 'Claude 3.5 Haiku' },
  ],
};
```

### 5.3 Unified complete() Function

```js
/**
 * @param {Array<{role: 'system'|'user'|'assistant', content: string}>} messages
 * @param {{ provider: string, model: string, apiKey: string, stream?: boolean }} config
 * @param {function(string): void} [onChunk]  - streaming callback, called with each text delta
 * @returns {Promise<string>} full response text
 */
export async function complete(messages, config, onChunk = null) {
  switch (config.provider) {
    case 'openai': return _openai(messages, config, onChunk);
    case 'gemini': return _gemini(messages, config, onChunk);
    case 'xai':    return _xai(messages, config, onChunk);
    case 'claude': return _claude(messages, config, onChunk);
    default: throw new Error(`Unknown provider: ${config.provider}`);
  }
}
```

### 5.4 Provider Implementations

#### OpenAI (also used for xAI — same API shape, different base URL)

```js
async function _openai(messages, config, onChunk) {
  const baseURL = config.provider === 'xai'
    ? 'https://api.x.ai/v1'
    : 'https://api.openai.com/v1';

  const res = await fetch(`${baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      stream: !!onChunk,
      max_tokens: 1024,
      temperature: 0.3,
    }),
  });

  if (!res.ok) throw new Error(`${config.provider} API error: ${res.status}`);

  if (onChunk) {
    return _consumeSSE(res, onChunk, (data) => data.choices?.[0]?.delta?.content ?? '');
  }
  const json = await res.json();
  return json.choices[0].message.content;
}
```

#### Gemini

```js
async function _gemini(messages, config, onChunk) {
  // Gemini uses a different message format: system becomes a systemInstruction
  const systemMsg = messages.find(m => m.role === 'system');
  const userMsgs = messages.filter(m => m.role !== 'system').map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const endpoint = onChunk
    ? `streamGenerateContent?alt=sse&key=${config.apiKey}`
    : `generateContent?key=${config.apiKey}`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:${endpoint}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: systemMsg ? { parts: [{ text: systemMsg.content }] } : undefined,
        contents: userMsgs,
        generationConfig: { maxOutputTokens: 1024, temperature: 0.3 },
      }),
    }
  );

  if (!res.ok) throw new Error(`Gemini API error: ${res.status}`);

  if (onChunk) {
    return _consumeSSE(res, onChunk, (data) => data.candidates?.[0]?.content?.parts?.[0]?.text ?? '');
  }
  const json = await res.json();
  return json.candidates[0].content.parts[0].text;
}
```

#### Claude

```js
async function _claude(messages, config, onChunk) {
  const systemMsg = messages.find(m => m.role === 'system')?.content ?? '';
  const filtered = messages.filter(m => m.role !== 'system');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model,
      system: systemMsg,
      messages: filtered,
      max_tokens: 1024,
      stream: !!onChunk,
    }),
  });

  if (!res.ok) throw new Error(`Claude API error: ${res.status}`);

  if (onChunk) {
    return _consumeSSE(res, onChunk, (data) => {
      if (data.type === 'content_block_delta') return data.delta?.text ?? '';
      return '';
    });
  }
  const json = await res.json();
  return json.content[0].text;
}
```

#### SSE Stream Consumer (shared)

```js
async function _consumeSSE(res, onChunk, extractText) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = '';
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop(); // incomplete last line stays in buffer

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (raw === '[DONE]') continue;
      try {
        const data = JSON.parse(raw);
        const chunk = extractText(data);
        if (chunk) { full += chunk; onChunk(chunk); }
      } catch { /* skip malformed chunks */ }
    }
  }
  return full;
}
```

---

## 6. Storage Module (modules/storage.js)

```js
// chrome.storage.sync — user settings (cross-device)
export const Settings = {
  async get() {
    return new Promise(r => chrome.storage.sync.get(['llmConfig', 'enabled'], r));
  },
  async set(data) {
    return new Promise(r => chrome.storage.sync.set(data, r));
  },
};

// chrome.storage.local — per-question cache
export const Cache = {
  _key(problemPath, randomSeed) {
    // sanitize to valid storage key
    return `ww_${problemPath.replace(/[^a-zA-Z0-9]/g, '_')}_${randomSeed}`;
  },
  async get(problemPath, randomSeed) {
    const key = this._key(problemPath, randomSeed);
    return new Promise(r => chrome.storage.local.get(key, data => r(data[key] ?? null)));
  },
  async set(problemPath, randomSeed, value) {
    const key = this._key(problemPath, randomSeed);
    return new Promise(r => chrome.storage.local.set({ [key]: value }, r));
  },
  async clear(problemPath, randomSeed) {
    const key = this._key(problemPath, randomSeed);
    return new Promise(r => chrome.storage.local.remove(key, r));
  },
};

// Cached object shape:
// {
//   hints: [string, string, string] | null,
//   solution: string | null,
//   chatHistory: Array<{ role: 'user'|'assistant', content: string }>
// }
```

---

## 7. Prompts Module (modules/prompts.js)

### 7.1 Problem Extraction Helper

This runs in the content script before any LLM call.

```js
/**
 * Extracts a clean, LLM-readable version of the WeBWorK problem.
 * Returns an object with { text, hasImages }.
 */
export function extractProblem() {
  const body = document.querySelector('#output_problem_body');
  if (!body) return null;

  // Clone to avoid mutating the live DOM
  const clone = body.cloneNode(true);

  // Replace <script type="math/tex"> with readable LaTeX delimiters
  clone.querySelectorAll('script[type="math/tex"]').forEach(el => {
    const isDisplay = el.hasAttribute('data-display') || el.classList.contains('display');
    el.replaceWith(isDisplay ? `\[ ${el.textContent} \]` : `\( ${el.textContent} \)`);
  });

  // Replace <img> with a placeholder note; collect src URLs
  const images = [];
  clone.querySelectorAll('img').forEach((img, i) => {
    const src = new URL(img.src, location.origin).href;
    images.push(src);
    img.replaceWith(`[Figure ${i + 1}]`);
  });

  // Get clean text
  const text = clone.innerText.replace(/\s{3,}/g, '\n\n').trim();

  return { text, images };
}

/**
 * Fetches images as base64 data URLs for multimodal LLM calls.
 */
export async function fetchImagesAsBase64(urls) {
  return Promise.all(urls.map(async url => {
    const res = await fetch(url);
    const blob = await res.blob();
    return new Promise(resolve => {
      const reader = new FileReader();
      reader.onloadend = () => resolve({ url, dataUrl: reader.result, mimeType: blob.type });
      reader.readAsDataURL(blob);
    });
  }));
}
```

### 7.2 System Prompt (shared across all calls)

```js
export const MATH_SYSTEM_PROMPT = `You are a math tutor assistant embedded in WeBWorK, a university mathematics homework system. You will be given a math problem that may contain LaTeX equations written in \( ... \) for inline math and \[ ... \] for display math.

Your outputs will be rendered with MathJax in a browser sidebar. Always write math using these conventions:
- Inline math: \( expression \)
- Display math: \[ expression \]
- Never use plain text substitutes for math (e.g. never write "x^2", always write \( x^2 \)).
- Never use $...$ or $$...$$ delimiters.

Tone and length rules:
- Be concise. Avoid padding, unnecessary preamble, or summaries.
- For hints: 2-4 sentences maximum. Point to the approach, never compute the final answer.
- For solutions: structured step-by-step. Each step is 1-3 lines. Show key algebra but skip trivial arithmetic.
- For chat: conversational and direct. Match the depth of the user's question.`;
```

### 7.3 Hints Generation Prompt

```js
export function buildHintsPrompt(problemText) {
  return {
    system: MATH_SYSTEM_PROMPT,
    user: `Here is the WeBWorK problem:

---
${problemText}
---

Generate exactly 3 progressive hints. Format your response as valid JSON:
{
  "hint1": "...",
  "hint2": "...",
  "hint3": "..."
}

Hint guidelines:
- Hint 1: Identify the relevant theorem, technique, or concept. Do not give any steps.
- Hint 2: Describe the first concrete step or setup without computing it. Mention what to look for or set up.
- Hint 3: Give a more direct nudge — describe the key algebraic or logical move that unlocks the problem. Still do not give the final answer.
- Each hint must be 2–4 sentences. No bullet points. No headers. Plain prose with LaTeX where needed.
- Hints must be progressive: each one more revealing than the last.
- Do not say things like "I'll give you a hint" or "Good luck!" — just give the hint directly.

Return only the JSON object, no markdown code fences, no extra text.`
  };
}
```

### 7.4 Solution Generation Prompt

```js
export function buildSolutionPrompt(problemText) {
  return {
    system: MATH_SYSTEM_PROMPT,
    user: `Here is the WeBWorK problem:

---
${problemText}
---

Write a complete, worked solution.

Solution format rules:
- Use numbered steps: "**Step 1:** ..."
- Each step is 1–4 lines. Show important algebraic transformations explicitly.
- End with a clearly labeled final answer: "**Answer:** \( ... \)" or in a display block.
- Do not add an introduction like "Sure, here is the solution" — start with Step 1 immediately.
- Do not add a conclusion paragraph after the final answer.
- Total length: aim for 150–350 words. Do not pad.`
  };
}
```

### 7.5 Chat System Prompt Builder

The problem context is re-injected every time a chat message is sent (not just on first message), so the context window always has the full problem regardless of history length.

```js
export function buildChatSystemPrompt(problemText) {
  return `${MATH_SYSTEM_PROMPT}

The student is working on the following WeBWorK problem:

---
${problemText}
---

Answer their questions about this problem directly and concisely. If they ask for the full answer, give it — they have already seen the hints. Do not be paternalistic. If their question is unrelated to math, politely redirect.`;
}
```

### 7.6 Multimodal Message Builder (for problems with images)

```js
export function buildMultimodalUserMessage(problemText, imageDataUrls) {
  if (!imageDataUrls.length) {
    return { role: 'user', content: problemText };
  }
  // OpenAI/xAI format (Claude and Gemini need slight adaptation — handle in provider layer)
  return {
    role: 'user',
    content: [
      { type: 'text', text: problemText },
      ...imageDataUrls.map(img => ({
        type: 'image_url',
        image_url: { url: img.dataUrl },
      })),
    ],
  };
}
```

---

## 8. Content Script Entry (content/content.js)

```js
import { mountSidebar } from './sidebar.js';
import { Settings } from '../modules/storage.js';

async function init() {
  // Only activate on WeBWorK problem pages
  if (!document.querySelector('#output_problem_body')) return;

  const { enabled } = await Settings.get();
  if (enabled === false) return;  // respect user toggle

  mountSidebar();
}

init();
```

---

## 9. Sidebar (content/sidebar.js)

### 9.1 DOM Structure

Inject the sidebar as a `position: fixed` element directly on `document.body`. It must never be inside `#problemMainForm` or any WeBWorK container.

```html
<!-- Injected structure -->
<div id="wwgpt-sidebar" class="wwgpt-sidebar wwgpt-open">
  <div class="wwgpt-header">
    <span class="wwgpt-logo">🤖 WebWork GPT</span>
    <button class="wwgpt-toggle-btn" aria-label="Toggle sidebar">›</button>
  </div>

  <div class="wwgpt-body">
    <!-- Hints section -->
    <div class="wwgpt-section" id="wwgpt-hints-section">
      <div class="wwgpt-card collapsed" id="wwgpt-hint1">
        <div class="wwgpt-card-header">
          <span>Hint 1</span>
          <button class="wwgpt-card-toggle">▶</button>
        </div>
        <div class="wwgpt-card-body"></div>
      </div>
      <!-- hint2, hint3 same structure -->
    </div>

    <!-- Solution section -->
    <div class="wwgpt-card collapsed" id="wwgpt-solution">
      <div class="wwgpt-card-header">
        <span>Solution</span>
        <button class="wwgpt-card-toggle">▶</button>
      </div>
      <div class="wwgpt-card-body"></div>
    </div>

    <!-- Loading state (shown while generating) -->
    <div class="wwgpt-loading hidden" id="wwgpt-loading">
      <span class="wwgpt-spinner"></span> Generating hints...
    </div>

    <!-- Regenerate button -->
    <button class="wwgpt-regen-btn" id="wwgpt-regen">↺ Regenerate</button>

    <!-- Divider -->
    <hr class="wwgpt-divider">

    <!-- Discuss section (collapsible) -->
    <div class="wwgpt-discuss" id="wwgpt-discuss">
      <div class="wwgpt-discuss-header" id="wwgpt-discuss-toggle">
        <span>💬 Discuss</span>
        <button class="wwgpt-card-toggle">▼</button>
      </div>
      <div class="wwgpt-discuss-body" id="wwgpt-discuss-body">
        <div class="wwgpt-chat-log" id="wwgpt-chat-log"></div>
        <div class="wwgpt-chat-input-row">
          <textarea id="wwgpt-chat-input" placeholder="Ask anything about this problem..." rows="2"></textarea>
          <button id="wwgpt-chat-send">Send</button>
        </div>
      </div>
    </div>
  </div>
</div>
```

### 9.2 CSS (content/sidebar.css)

```css
#wwgpt-sidebar {
  position: fixed;
  top: 60px;           /* clear WeBWorK masthead */
  right: 0;
  width: 340px;
  max-height: calc(100vh - 70px);
  overflow-y: auto;
  background: #ffffff;
  border-left: 2px solid #e5e7eb;
  border-radius: 8px 0 0 8px;
  box-shadow: -4px 0 16px rgba(0,0,0,0.08);
  z-index: 99999;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 14px;
  transition: transform 0.25s ease;
  display: flex;
  flex-direction: column;
}

/* Collapsed state — only header tab visible */
#wwgpt-sidebar.wwgpt-collapsed {
  transform: translateX(316px);  /* width - tab width (24px) */
}

.wwgpt-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: #1e40af;
  color: white;
  border-radius: 8px 0 0 0;
  position: sticky;
  top: 0;
  z-index: 1;
}

.wwgpt-toggle-btn {
  background: none;
  border: none;
  color: white;
  font-size: 18px;
  cursor: pointer;
  padding: 0 4px;
  transition: transform 0.2s;
}

#wwgpt-sidebar.wwgpt-collapsed .wwgpt-toggle-btn {
  transform: rotate(180deg);
}

.wwgpt-body {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* Cards */
.wwgpt-card {
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  overflow: hidden;
}

.wwgpt-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: #f9fafb;
  cursor: pointer;
  font-weight: 600;
  user-select: none;
}

.wwgpt-card-header:hover { background: #f3f4f6; }

.wwgpt-card-body {
  padding: 10px 12px;
  line-height: 1.6;
  color: #374151;
  display: none;
}

.wwgpt-card.open .wwgpt-card-body { display: block; }

/* Equation hover + copy */
.wwgpt-card-body mjx-container {
  cursor: pointer;
  border-radius: 3px;
  transition: background 0.1s;
  padding: 1px 3px;
}
.wwgpt-card-body mjx-container:hover { background: #e5e7eb; }

/* Chat */
.wwgpt-discuss-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 6px 6px 0 0;
  cursor: pointer;
  font-weight: 600;
}

.wwgpt-discuss-body {
  border: 1px solid #e5e7eb;
  border-top: none;
  border-radius: 0 0 6px 6px;
  overflow: hidden;
}

#wwgpt-discuss.collapsed .wwgpt-discuss-body { display: none; }
#wwgpt-discuss.collapsed .wwgpt-discuss-header { border-radius: 6px; }

.wwgpt-chat-log {
  max-height: 250px;
  overflow-y: auto;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.wwgpt-msg { padding: 6px 10px; border-radius: 6px; max-width: 100%; word-break: break-word; }
.wwgpt-msg.user { background: #dbeafe; align-self: flex-end; }
.wwgpt-msg.assistant { background: #f3f4f6; align-self: flex-start; }

.wwgpt-chat-input-row {
  display: flex;
  gap: 6px;
  padding: 8px;
  border-top: 1px solid #e5e7eb;
}

#wwgpt-chat-input {
  flex: 1;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  padding: 6px 8px;
  resize: none;
  font-size: 13px;
}

#wwgpt-chat-send {
  background: #1e40af;
  color: white;
  border: none;
  border-radius: 4px;
  padding: 6px 12px;
  cursor: pointer;
  font-size: 13px;
}

#wwgpt-chat-send:hover { background: #1d3899; }

.wwgpt-regen-btn {
  width: 100%;
  background: none;
  border: 1px dashed #9ca3af;
  border-radius: 4px;
  padding: 5px;
  color: #6b7280;
  cursor: pointer;
  font-size: 12px;
}
.wwgpt-regen-btn:hover { border-color: #6b7280; color: #374151; }

.wwgpt-loading { display: flex; align-items: center; gap: 8px; color: #6b7280; font-size: 13px; }
.wwgpt-loading.hidden { display: none; }

.wwgpt-spinner {
  width: 14px; height: 14px;
  border: 2px solid #e5e7eb;
  border-top-color: #1e40af;
  border-radius: 50%;
  display: inline-block;
  animation: wwgpt-spin 0.7s linear infinite;
}
@keyframes wwgpt-spin { to { transform: rotate(360deg); } }
```

### 9.3 Sidebar Logic (content/sidebar.js) — Key Functions

```js
import { Cache, Settings } from '../modules/storage.js';
import { complete } from '../modules/llm-provider.js';
import { buildHintsPrompt, buildSolutionPrompt, buildChatSystemPrompt } from '../modules/prompts.js';
import { extractProblem, fetchImagesAsBase64 } from '../modules/prompts.js';
import { attachEquationListeners, typesetElement } from './math-utils.js';

let problemMeta = null;  // { path, seed, text }
let cache = null;

export async function mountSidebar() {
  // Read problem identity for caching
  const path = document.querySelector('input[name="problemPath"]')?.value ?? 'unknown';
  const seed = document.querySelector('input[name="randomSeed"]')?.value ?? '0';
  const extracted = extractProblem();
  if (!extracted) return;

  problemMeta = { path, seed, text: extracted.text, images: extracted.images };

  // Load or initialize cache
  cache = await Cache.get(path, seed) ?? { hints: null, solution: null, chatHistory: [] };

  // Inject sidebar HTML
  const sidebar = document.createElement('div');
  sidebar.innerHTML = SIDEBAR_TEMPLATE;  // the HTML template from section 9.1
  document.body.appendChild(sidebar.firstElementChild);

  // Wire up events
  bindToggle();
  bindCards();
  bindDiscussToggle();
  bindChat();
  bindRegenerate();

  // Restore chat history
  if (cache.chatHistory.length) renderChatHistory(cache.chatHistory);

  // Load hints/solution (from cache or generate)
  if (cache.hints) {
    populateHints(cache.hints);
  } else {
    generateHintsAndSolution();
  }
}

async function generateHintsAndSolution() {
  const loadingEl = document.getElementById('wwgpt-loading');
  loadingEl.classList.remove('hidden');
  loadingEl.textContent = '⏳ Generating hints...';

  const config = (await Settings.get()).llmConfig;
  const { text, images } = problemMeta;

  let imagesBase64 = [];
  if (images.length) {
    imagesBase64 = await fetchImagesAsBase64(images);
  }

  try {
    // Generate hints
    const hintPrompt = buildHintsPrompt(text);
    const hintMessages = [
      { role: 'system', content: hintPrompt.system },
      { role: 'user', content: hintPrompt.user },
      // Append images if any (for multimodal models)
      ...(imagesBase64.length ? [{ role: 'user', content: imagesBase64.map(img => ({
          type: 'image_url', image_url: { url: img.dataUrl }
      }))}] : []),
    ];

    const hintsRaw = await complete(hintMessages, config);
    const hints = JSON.parse(hintsRaw);
    populateHints([hints.hint1, hints.hint2, hints.hint3]);
    cache.hints = [hints.hint1, hints.hint2, hints.hint3];

    // Generate solution
    loadingEl.textContent = '⏳ Generating solution...';
    const solPrompt = buildSolutionPrompt(text);
    const solMessages = [
      { role: 'system', content: solPrompt.system },
      { role: 'user', content: solPrompt.user },
    ];
    const solution = await complete(solMessages, config);
    populateSolution(solution);
    cache.solution = solution;

    await Cache.set(problemMeta.path, problemMeta.seed, cache);
  } catch (err) {
    loadingEl.textContent = `❌ Error: ${err.message}`;
    return;
  }

  loadingEl.classList.add('hidden');
}

function populateHints(hints) {
  hints.forEach((text, i) => {
    const body = document.querySelector(`#wwgpt-hint${i + 1} .wwgpt-card-body`);
    if (body) {
      body.innerHTML = markdownToHtml(text);  // simple markdown converter, see note
      typesetElement(body);
      attachEquationListeners(body);
    }
  });
}

function populateSolution(text) {
  const body = document.querySelector('#wwgpt-solution .wwgpt-card-body');
  if (body) {
    body.innerHTML = markdownToHtml(text);
    typesetElement(body);
    attachEquationListeners(body);
  }
}
```

**Note on `markdownToHtml`:** Implement a minimal converter that handles `**bold**`, numbered lists, and line breaks. Do NOT use a full markdown library (adds bundle weight). About 30 lines of regex is sufficient for what the LLM will output.

---

## 10. Math Utils (content/math-utils.js)

```js
/**
 * Calls MathJax typesetting on a specific element.
 * Uses the host page's already-loaded MathJax 3 instance.
 */
export function typesetElement(el) {
  if (window.MathJax?.typesetPromise) {
    window.MathJax.typesetPromise([el]).catch(console.error);
  }
}

/**
 * Attaches hover highlight and click-to-copy on all mjx-container elements
 * inside a given parent element.
 * Since these are LLM-generated, LaTeX is stored as data-latex attribute
 * (set during markdownToHtml conversion).
 */
export function attachEquationListeners(parent) {
  // Re-run after MathJax finishes
  if (window.MathJax?.typesetPromise) {
    window.MathJax.typesetPromise([parent]).then(() => {
      parent.querySelectorAll('mjx-container').forEach(el => {
        // MathJax 3 stores the source on the element
        const latex = el.getAttribute('data-mjx-texstring') ?? '';
        el.title = 'Click to copy LaTeX';
        el.addEventListener('click', () => {
          const formatted = el.closest('[data-display]') ? `\[${latex}\]` : `\(${latex}\)`;
          navigator.clipboard.writeText(formatted).then(() => showCopyToast());
        });
      });
    });
  }
}

function showCopyToast() {
  const toast = document.createElement('div');
  toast.textContent = 'LaTeX copied!';
  toast.style.cssText = `
    position: fixed; bottom: 80px; right: 360px;
    background: #1e40af; color: white;
    padding: 6px 14px; border-radius: 4px;
    font-size: 13px; z-index: 100000;
    animation: fadeout 1.5s forwards;
  `;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 1600);
}
```

---

## 11. Popup (popup/popup.html + popup.js)

### 11.1 HTML Structure

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <link rel="stylesheet" href="popup.css">
  <title>WebWork GPT</title>
</head>
<body>
  <div class="popup-header">
    <span>🤖 WebWork GPT</span>
    <label class="toggle-switch">
      <input type="checkbox" id="enable-toggle">
      <span class="slider"></span>
    </label>
  </div>

  <div class="popup-body">
    <label>Provider</label>
    <select id="provider-select">
      <option value="openai">OpenAI</option>
      <option value="gemini">Google Gemini</option>
      <option value="xai">xAI (Grok)</option>
      <option value="claude">Anthropic Claude</option>
    </select>

    <label>Model</label>
    <select id="model-select"></select>

    <label>API Key</label>
    <div class="api-key-row">
      <input type="password" id="api-key-input" placeholder="sk-...">
      <button id="api-key-show">👁</button>
    </div>

    <button id="save-btn" class="btn-primary">Save</button>
    <span id="save-status" class="save-status"></span>
  </div>

  <div class="popup-footer">
    <button id="disclaimer-btn" class="btn-link">📋 View Disclaimer</button>
  </div>

  <script src="popup.js" type="module"></script>
</body>
</html>
```

### 11.2 popup.js Logic

```js
import { PROVIDER_MODELS } from '../modules/llm-provider.js';
import { Settings } from '../modules/storage.js';

const providerSelect = document.getElementById('provider-select');
const modelSelect = document.getElementById('model-select');
const apiKeyInput = document.getElementById('api-key-input');
const enableToggle = document.getElementById('enable-toggle');
const saveBtn = document.getElementById('save-btn');
const saveStatus = document.getElementById('save-status');

function populateModels(provider) {
  modelSelect.innerHTML = '';
  PROVIDER_MODELS[provider].forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.label;
    modelSelect.appendChild(opt);
  });
}

async function loadSettings() {
  const { llmConfig, enabled } = await Settings.get();
  if (llmConfig) {
    providerSelect.value = llmConfig.provider;
    populateModels(llmConfig.provider);
    modelSelect.value = llmConfig.model;
    apiKeyInput.value = llmConfig.apiKey;
  } else {
    populateModels('openai');
  }
  enableToggle.checked = enabled !== false;
}

providerSelect.addEventListener('change', () => populateModels(providerSelect.value));

saveBtn.addEventListener('click', async () => {
  await Settings.set({
    llmConfig: {
      provider: providerSelect.value,
      model: modelSelect.value,
      apiKey: apiKeyInput.value.trim(),
    },
    enabled: enableToggle.checked,
  });
  saveStatus.textContent = '✓ Saved';
  setTimeout(() => saveStatus.textContent = '', 2000);
});

document.getElementById('api-key-show').addEventListener('click', () => {
  apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
});

document.getElementById('disclaimer-btn').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('pages/disclaimer.html') });
});

loadSettings();
```

---

## 12. Disclaimer Page (pages/disclaimer.html)

### Content to include:

1. **What the extension does** — injects a sidebar, sends the problem text and any images to a third-party AI API using your own API key.
2. **Data handling** — your API key and problem data are sent directly to the chosen provider (OpenAI/Google/Anthropic/xAI). This extension does not collect or transmit any data to its own servers.
3. **Academic integrity warning** — Using AI assistance on graded coursework may violate your institution's academic integrity policy. By using this extension, you accept full responsibility for compliance with UBC's academic integrity policies.
4. **No guarantees** — AI-generated hints and solutions may contain errors. Always verify answers independently.
5. An **"I Understand"** button that sets `chrome.storage.local` key `disclaimerSeen: true` and closes the tab.

```js
// disclaimer.js
document.getElementById('accept-btn').addEventListener('click', () => {
  chrome.storage.local.set({ disclaimerSeen: true });
  window.close();
});
```

---

## 13. Data Flow Diagram

```
User visits WeBWorK problem page
         │
         ▼
content.js checks Settings.enabled
         │ yes
         ▼
sidebar.js mounts fixed sidebar
         │
         ▼
Reads problemPath + randomSeed from hidden form fields
         │
         ▼
Cache.get(path, seed)
    ┌────┴────┐
    │ hit     │ miss
    ▼         ▼
render    extractProblem() → clean text + images
from       │
cache      ▼
          fetchImagesAsBase64() (if images present)
           │
           ▼
          complete(hintMessages, llmConfig)  → hints JSON
           │
           ▼
          complete(solutionMessages, llmConfig)  → solution markdown
           │
           ▼
          Cache.set(path, seed, { hints, solution, chatHistory: [] })
           │
           ▼
          populateHints() + populateSolution()
           │
           ▼
          typesetElement() + attachEquationListeners()

Chat message flow:
User types → send → buildChatSystemPrompt(problemText) → 
complete([system, ...chatHistory, newUserMsg], config, onChunk) →
stream into chat bubble → append to chatHistory → Cache.set()
```

---

## 14. Edge Cases & Implementation Notes

| Situation | Handling |
|---|---|
| No `#output_problem_body` on page | `content.js` early-returns, no sidebar mounted |
| LLM returns malformed JSON for hints | Wrap `JSON.parse` in try/catch, show error card with retry button |
| MathJax not yet loaded when sidebar renders | `typesetElement` polls `window.MathJax` with a 200ms retry loop, max 10 attempts |
| User navigates to next problem (SPA-like) | Use `MutationObserver` on `#output_problem_body` to detect problem changes and re-run `mountSidebar` |
| Image fetch fails (CORS/auth) | Skip image, include a note in the prompt: `[Image could not be loaded]` |
| API key not set | On load, check `llmConfig` in storage; if missing, show a "Configure API key" prompt card in sidebar instead of generating |
| WeBWorK page uses `effectiveUser` param | Already handled — problem identity keys off `problemPath` + `randomSeed`, not URL |
| Streaming not supported by model/config | `onChunk = null` falls back to non-streaming in all providers |

---

## 15. Build & Packaging Notes

- No bundler required — all files are plain ES modules loaded via `type="module"` in popup/pages. Content scripts do NOT support ES module imports natively in MV3; use a bundler (esbuild recommended) to bundle `content/content.js` and its imports into a single IIFE, or use Chrome's `world: "MAIN"` trick.
- Recommended build: `esbuild content/content.js --bundle --outfile=dist/content.bundle.js --format=iife`
- Update `manifest.json` to point to `dist/content.bundle.js` for the content script.

---

*End of Specification*
