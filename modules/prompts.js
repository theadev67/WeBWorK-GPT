/**
 * Extracts a clean, LLM-readable version of the WeBWorK problem.
 * Returns an object with { text, images }.
 */
export function extractProblem() {
    const body = document.querySelector("#output_problem_body");
    if (!body) return null;

    // Clone to avoid mutating the live DOM
    const clone = body.cloneNode(true);

    // Replace <script type="math/tex"> with readable LaTeX delimiters
    clone.querySelectorAll('script[type="math/tex"]').forEach((el) => {
        const isDisplay =
            el.hasAttribute("data-display") || el.classList.contains("display");
        el.replaceWith(
            isDisplay
                ? `\\[ ${el.textContent} \\]`
                : `\\( ${el.textContent} \\)`
        );
    });

    // Replace <img> with a placeholder note; collect src URLs
    const images = [];
    clone.querySelectorAll("img").forEach((img, i) => {
        const src = new URL(img.src, location.origin).href;
        images.push(src);
        img.replaceWith(`[Figure ${i + 1}]`);
    });

    // Get clean text
    const text = clone.innerText.replace(/\s{3,}/g, "\n\n").trim();

    return { text, images };
}

/**
 * Fetches images as base64 data URLs for multimodal LLM calls.
 */
export async function fetchImagesAsBase64(urls) {
    return Promise.all(
        urls.map(async (url) => {
            try {
                const res = await fetch(url);
                const blob = await res.blob();
                return new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () =>
                        resolve({
                            url,
                            dataUrl: reader.result,
                            mimeType: blob.type,
                        });
                    reader.readAsDataURL(blob);
                });
            } catch (e) {
                console.error("Failed to fetch image:", url, e);
                return null;
            }
        })
    ).then((imgs) => imgs.filter((img) => img !== null));
}

export const MATH_SYSTEM_PROMPT = `You are a math tutor assistant embedded in WeBWorK, a university mathematics homework system. You will be given a math problem that may contain LaTeX equations written in \\( ... \\) for inline math and \\[ ... \\] for display math.

Your outputs will be rendered with MathJax in a browser sidebar. Always write math using these conventions:
- Inline math: \\( expression \\)
- Display math: \\[ expression \\]
- Never use plain text substitutes for math (e.g. never write "x^2", always write \\( x^2 \\)).
- Never use $...$ or $$...$$ delimiters.

Tone and length rules:
- Be concise. Avoid padding, unnecessary preamble, or summaries.
- For hints: 2-4 sentences maximum. Point to the approach, never compute the final answer.
- For solutions: structured step-by-step. Each step is 1-3 lines. Show key algebra but skip trivial arithmetic.
- For chat: conversational and direct. Match the depth of the user's question.`;

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

Return only the JSON object, no markdown code fences, no extra text.`,
    };
}

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
- End with a clearly labeled final answer: "**Answer:** \\( ... \\)" or in a display block.
- Do not add an introduction like "Sure, here is the solution" — start with Step 1 immediately.
- Do not add a conclusion paragraph after the final answer.
- Total length: aim for 150–350 words. Do not pad.`,
    };
}

export function buildChatSystemPrompt(problemText) {
    return `${MATH_SYSTEM_PROMPT}

The student is working on the following WeBWorK problem:

---
${problemText}
---

Answer their questions about this problem directly and concisely. If they ask for the full answer, give it — they have already seen the hints. Do not be paternalistic. If their question is unrelated to math, politely redirect.`;
}

export function buildMultimodalUserMessage(problemText, imageDataUrls) {
    if (!imageDataUrls || !imageDataUrls.length) {
        return { role: "user", content: problemText };
    }
    // OpenAI/xAI/OpenRouter format
    return {
        role: "user",
        content: [
            { type: "text", text: problemText },
            ...imageDataUrls.map((img) => ({
                type: "image_url",
                image_url: { url: img.dataUrl },
            })),
        ],
    };
}
