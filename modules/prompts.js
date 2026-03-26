/**
 * Extracts a clean, LLM-readable version of the WeBWorK problem.
 * Returns an object with { text, images }.
 */
import { getConstants } from "./constants-provider.js";

export async function extractProblem() {
    const { selectors } = await getConstants();
    const body = document.querySelector(selectors.problem_body);
    if (!body) return null;

    const clone = body.cloneNode(true);

    // Remove UI noise: buttons, hidden inputs, answer blanks
    clone
        .querySelectorAll(selectors.problem_noise)
        .forEach((el) => el.remove());

    // Collect images before stripping them from text
    const images = [];
    clone.querySelectorAll(selectors.images).forEach((img) => {
        if (img.src && !img.src.startsWith("data:")) {
            images.push({ src: img.src, alt: img.alt || "" });
            img.replaceWith(`[Image: ${img.alt || img.src}]`);
        }
    });

    // Replace input fields with a placeholder so the model knows where blanks are
    clone.querySelectorAll(selectors.answer_blanks).forEach((inp) => {
        inp.replaceWith("[ANSWER BLANK]");
    });

    return {
        text: clone.textContent.replace(/\s+/g, " ").trim(),
        images,
    };
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

export async function buildHintsPrompt(problemText) {
    const { prompts } = await getConstants();
    return {
        system: prompts.math_system,
        user: prompts.hints_user.replace("{{problemText}}", problemText),
    };
}

export async function buildSolutionPrompt(problemText) {
    const { prompts } = await getConstants();
    return {
        system: prompts.math_system,
        user: prompts.solution_user.replace("{{problemText}}", problemText),
    };
}

export async function buildChatSystemPrompt(problemText) {
    const { prompts } = await getConstants();
    return prompts.chat_system
        .replace("{{systemPrompt}}", prompts.math_system)
        .replace("{{problemText}}", problemText);
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
