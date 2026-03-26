/**
 * math-utils.js — runs in ISOLATED world
 *
 * Cannot access window.MathJax directly (Chrome isolates content script JS).
 * Instead we dispatch a CustomEvent on the shared DOM; typeset-bridge.js
 * (registered as a MAIN-world content script) receives it and calls MathJax.
 */

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
    element.addEventListener("click", (e) => {
        const mathContainer = e.target.closest("mjx-container, .MathJax");
        if (!mathContainer) return;

        let tex = "";
        const script = mathContainer.previousElementSibling;
        if (
            script &&
            script.tagName === "SCRIPT" &&
            script.type.includes("math/tex")
        ) {
            tex = script.textContent;
        } else {
            const ann = mathContainer.querySelector(
                "mjx-assistive-mml annotation, .MJX_Assistive_MathML annotation"
            );
            if (ann) tex = ann.textContent;
        }

        if (tex) {
            navigator.clipboard.writeText(tex).then(() => {
                const was = mathContainer.style.background;
                mathContainer.style.background = "#d1fae5";
                setTimeout(() => {
                    mathContainer.style.background = was;
                }, 300);
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
export function renderMarkdown(text) {
    if (!text) return "";

    // ── 1. Stash LaTeX ──────────────────────────────────────────────────────
    const stash = [];
    const ph = (math) => {
        stash.push(math);
        return `\x00${stash.length - 1}\x00`;
    };

    let s = text
        // 1a. Display Math: \[...\] or $$...$$
        .replace(/\\\[([\s\S]*?)\\\]/g, (_, m) =>
            ph(`<script type="math/tex; mode=display">${m}</script>`)
        )
        .replace(/\$\$([\s\S]*?)\$\$/g, (_, m) =>
            ph(`<script type="math/tex; mode=display">${m}</script>`)
        )

        // 1b. Special fallback for [ ... ] which is a common LLM near-miss for display math.
        // Triggered only if it contains a backslash (indicating LaTeX).
        .replace(/(?:\n|^)\[([\s\S]*?\\+[\s\S]*?)\](?:\n|$)/g, (_, m) =>
            ph(`\n<script type="math/tex; mode=display">${m}</script>\n`)
        )

        // 1c. Inline Math: \(...\) or $...$
        .replace(/\\\((([\s\S])*?)\\\)/g, (_, m) =>
            ph(`<script type="math/tex">${m}</script>`)
        )
        .replace(/\$([^\$\n]+)\$/g, (_, m) =>
            ph(`<script type="math/tex">${m}</script>`)
        )

        // 1d. Special fallback for ( ... ) if it contains a backslash and looks like math
        .replace(/\(([\s\S]*?\\+[\s\S]*?)\)/g, (_, m) =>
            ph(`<script type="math/tex">${m}</script>`)
        );

    // ── 2. HTML-escape ───────────────────────────────────────────────────────
    s = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    // ── 3. Inline Markdown ───────────────────────────────────────────────────
    s = s
        .replace(/\*\*([^*\x00]+)\*\*/g, "<strong>$1</strong>")
        .replace(/\*([^*\n\x00]+)\*/g, "<em>$1</em>")
        .replace(/`([^`\x00]+)`/g, "<code>$1</code>")
        .replace(/^#{3}\s+(.+)$/gm, "<h4>$1</h4>")
        .replace(/^#{2}\s+(.+)$/gm, "<h3>$1</h3>");

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
        } else if (/^<h[34]/.test(line)) {
            flushPara();
            out.push(line);
        } else if (/^\d+\.\s/.test(line)) {
            flushPara();
            out.push(
                `<p class="wwgpt-step">${line.replace(
                    /^(\d+\.\s)/,
                    "<strong>$1</strong>"
                )}</p>`
            );
        } else if (/^[-*•]\s/.test(line)) {
            flushPara();
            out.push(
                `<p class="wwgpt-bullet">${line.replace(/^[-*•]\s/, "• ")}</p>`
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
