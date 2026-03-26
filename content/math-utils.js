/**
 * math-utils.js — runs in ISOLATED world
 *
 * Cannot access window.MathJax directly (Chrome isolates content script JS).
 * Instead we dispatch a CustomEvent on the shared DOM; typeset-bridge.js
 * (registered as a MAIN-world content script) receives it and calls MathJax.
 */
import { texToWebwork } from "../modules/tex-to-webwork.js";
import { getConstants } from "./constants-client.js";

let _typesetCounter = 0;

/**
 * Typeset an element by bridging to the MAIN world via a CustomEvent.
 */
export function typeset(element) {
    if (!element) return;
    const uid = `wwgpt-ts-${++_typesetCounter}`;
    element.dataset.wwgptTs = uid;
    document.dispatchEvent(
        new CustomEvent("wwgpt:typeset", { detail: { uid } })
    );
}

/**
 * Click-to-copy for MathJax SVG math elements.
 */
export function enableClickToCopy(element) {
    element.addEventListener("click", async (e) => {
        const { selectors } = await getConstants();
        const mathContainer = e.target.closest(selectors.math_containers);
        if (!mathContainer) return;

        let tex = "";
        const wrapper = mathContainer.closest(selectors.math_wrapper);
        if (wrapper && wrapper.dataset.tex) {
            tex = wrapper.dataset.tex;
        }

        if (!tex) {
            // Fallback for native WeBWorK or MathJax 2 script tags
            const script = mathContainer.previousElementSibling;
            if (
                script &&
                script.tagName === "SCRIPT" &&
                script.type.includes("math/tex")
            ) {
                tex = script.textContent;
            } else {
                const ann = mathContainer.querySelector(
                    selectors.math_annotations
                );
                if (ann) tex = ann.textContent;
            }
        }

        if (tex) {
            const cleanTex = texToWebwork(tex);
            navigator.clipboard.writeText(cleanTex).then(() => {
                const target = wrapper || mathContainer;
                const hint = document.createElement("span");
                hint.className = "wwgpt-copy-hint";
                hint.textContent = "Copied";
                target.appendChild(hint);

                const was = mathContainer.style.background;
                mathContainer.style.background = "#d1fae5";
                setTimeout(() => {
                    mathContainer.style.background = was;
                    hint.remove();
                }, 2000);
            });
        }
    });
}

/**
 * Convert LLM output (markdown + LaTeX) to safe HTML.
 *
 * LaTeX \(...\) and \[...\] are stashed with null-byte placeholders BEFORE
 * HTML escaping so they survive untouched, then restored verbatim for MathJax.
 */
export async function renderMarkdown(text) {
    if (!text) return "";

    const { regex: r } = await getConstants();

    // ── 1. Stash LaTeX ──────────────────────────────────────────────────────
    const stash = [];
    const _esc = (t) =>
        t
            .replace(new RegExp(r.amp, "g"), "&amp;")
            .replace(new RegExp(r.quot, "g"), "&quot;")
            .replace(new RegExp(r.apos, "g"), "&#39;");
    const ph = (math) => {
        stash.push(math);
        return `\x00${stash.length - 1}\x00`;
    };

    let s = text
        // 1a. Display Math: \[...\] or $$...$$
        .replace(new RegExp(r.display_math_1, "g"), (_, m) =>
            ph(
                `<div class="wwgpt-math-wrapper" data-tex="${_esc(
                    m
                )}"><script type="math/tex; mode=display">${m}</script></div>`
            )
        )
        .replace(new RegExp(r.display_math_2, "g"), (_, m) =>
            ph(
                `<div class="wwgpt-math-wrapper" data-tex="${_esc(
                    m
                )}"><script type="math/tex; mode=display">${m}</script></div>`
            )
        )

        // 1b. Special fallback for [ ... ] which is a common LLM near-miss for display math.
        // Triggered only if it contains a backslash (indicating LaTeX).
        .replace(new RegExp(r.display_math_fallback, "g"), (_, m) =>
            ph(
                `\n<div class="wwgpt-math-wrapper" data-tex="${_esc(
                    m
                )}"><script type="math/tex; mode=display">${m}</script></div>\n`
            )
        )

        // 1c. Inline Math: \(...\) or $...$
        .replace(new RegExp(r.inline_math_1, "g"), (_, m) =>
            ph(
                `<span class="wwgpt-math-wrapper" data-tex="${_esc(
                    m
                )}"><script type="math/tex">${m}</script></span>`
            )
        )
        .replace(new RegExp(r.inline_math_2, "g"), (_, m) =>
            ph(
                `<span class="wwgpt-math-wrapper" data-tex="${_esc(
                    m
                )}"><script type="math/tex">${m}</script></span>`
            )
        )

        // 1d. Special fallback for ( ... ) if it contains a backslash and looks like math
        .replace(new RegExp(r.inline_math_fallback, "g"), (_, m) =>
            ph(
                `<span class="wwgpt-math-wrapper" data-tex="${_esc(
                    m
                )}"><script type="math/tex">${m}</script></span>`
            )
        );

    // ── 2. HTML-escape ───────────────────────────────────────────────────────
    s = s
        .replace(new RegExp(r.amp, "g"), "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    // ── 3. Inline Markdown ───────────────────────────────────────────────────
    s = s
        .replace(new RegExp(r.markdown_bold, "g"), "<strong>$1</strong>")
        .replace(new RegExp(r.markdown_italic, "g"), "<em>$1</em>")
        .replace(new RegExp(r.markdown_code, "g"), "<code>$1</code>")
        .replace(new RegExp(r.markdown_h4, "gm"), "<h4>$1</h4>")
        .replace(new RegExp(r.markdown_h3, "gm"), "<h3>$1</h3>");

    // ── 4. Block structure ───────────────────────────────────────────────────
    const lines = s.split("\n");
    const out = [];
    let para = [];

    const flushPara = () => {
        if (para.length) {
            out.push(`<p>${para.join("<br>")}</p>`);
            para = [];
        }
    };

    for (const raw of lines) {
        const line = raw.trimEnd();
        if (!line) {
            flushPara();
        } else if (new RegExp(r.is_heading).test(line)) {
            flushPara();
            out.push(line);
        } else if (new RegExp(r.is_step).test(line)) {
            flushPara();
            out.push(
                `<p class="wwgpt-step">${line.replace(
                    new RegExp(r.step_replacement),
                    "<strong>$1</strong>"
                )}</p>`
            );
        } else if (new RegExp(r.is_bullet).test(line)) {
            flushPara();
            out.push(
                `<p class="wwgpt-bullet">${line.replace(
                    new RegExp(r.bullet_replacement),
                    "• "
                )}</p>`
            );
        } else {
            para.push(line);
        }
    }
    flushPara();

    s = out.join("");

    // ── 5. Restore LaTeX ─────────────────────────────────────────────────────
    s = s.replace(/\x00(\d+)\x00/g, (_, i) => stash[parseInt(i)]);

    return s;
}
