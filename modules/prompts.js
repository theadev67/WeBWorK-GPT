/**
 * Extracts a clean, LLM-readable version of the WeBWorK problem.
 * Returns an object with { text, images }.
 */
export function extractProblem() {
    const body = document.querySelector("#output_problem_body");
    if (!body) return null;

    const clone = body.cloneNode(true);

    // Remove UI noise: buttons, hidden inputs, answer blanks
    clone
        .querySelectorAll(
            "input[type=submit], button, .attemptResults, .problem-grader-hint"
        )
        .forEach((el) => el.remove());

    // Collect images before stripping them from text
    const images = [];
    clone.querySelectorAll("img").forEach((img) => {
        if (img.src && !img.src.startsWith("data:")) {
            images.push({ src: img.src, alt: img.alt || "" });
            img.replaceWith(`[Image: ${img.alt || img.src}]`);
        }
    });

    // Replace input fields with a placeholder so the model knows where blanks are
    clone
        .querySelectorAll("input[type=text], input[type=number]")
        .forEach((inp) => {
            inp.replaceWith("[ANSWER BLANK]");
        });

    return {
        text: clone.textContent.replace(/\s+/g, " ").trim(),
        images,
    };
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

export const MATH_SYSTEM_PROMPT = `You are a math tutor assistant embedded in WeBWorK, a university mathematics homework system. You will be given a math problem that may contain LaTeX equations written in \\( ... \\) for inline math and \\[ ... \\] for display math.

Your outputs will be rendered with MathJax in a browser sidebar. Always write math using these conventions:
- Inline math: \\( expression \\)
- Display math: \\[ expression \\]
- ALL equations, matrices, and variables MUST be in LaTeX. Never use plain text substitutes.
  Example: \\( A = \\begin{bmatrix} 1 & 2 \\\\ 3 & 4 \\end{bmatrix} \\)
- Break long equations across multiple lines at each equals sign when appropriate.

Tone and length rules:
- Be concise. No padding, preamble, or summaries.
- For hints: 2-4 sentences each. Point to the approach, never compute the final answer.
- For solutions: numbered step-by-step. Each step is 1-3 lines. Show key algebra, skip trivial arithmetic. Always end with the final answer in a \\boxed{} macro.
- For chat: conversational and direct. Match the depth of the user's question.`;

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

export function buildHintsPrompt(problemText) {
    return {
        system: MATH_SYSTEM_PROMPT,
        user: `Here is the WeBWorK problem:

---
${problemText}
---

Generate exactly 3 progressive hints following these guidelines:

- hint1: Identify the relevant theorem, technique, or concept only. Give no steps and no computation.
- hint2: Describe the first concrete setup or step without computing it. Mention what to look for or configure.
- hint3: Give a more direct nudge — describe the key algebraic or logical move that unlocks the problem. Still do not give the final answer.

Each hint must be 2-4 sentences. No bullet points. No headers. Plain prose with LaTeX where needed. No sign-off phrases like "Good luck!".`,
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

Rules:
- Start immediately with "**Step 1:**" — no introduction.
- Each step is 1-4 lines. Show important algebraic transformations explicitly.
- End with "**Answer:** \\( ... \\)" or a display block for the final answer, wrapped in \\boxed{}.
- No conclusion paragraph after the final answer.
- Target 150-350 words. Do not pad.`,
    };
}

export function buildChatSystemPrompt(problemText) {
    return `${MATH_SYSTEM_PROMPT}

The student is working on the following WeBWorK problem:

---
${problemText}
---

Answer their questions directly and concisely. If they ask for the full answer, give it — they have already seen the hints. Do not be paternalistic. If their question is unrelated to math, politely redirect.`;
}

export function buildMultimodalUserMessage(problemText, imageDataUrls) {
    if (!imageDataUrls || !imageDataUrls.length) {
        return { role: "user", content: problemText };
    }
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
