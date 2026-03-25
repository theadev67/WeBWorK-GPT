/**
 * Utility for MathJax typesetting and markdown rendering.
 */

/**
 * Force MathJax to typeset the given element.
 * Retries up to ~3 seconds in case MathJax is still loading.
 */
export function typeset(element) {
    _typesetWithRetry(element, 0);
}

function _typesetWithRetry(element, attempt) {
    if (window.MathJax && window.MathJax.typesetPromise) {
        window.MathJax.typesetPromise([element]).catch(() => {});
    } else if (attempt < 15) {
        // Retry up to 3s (15 × 200ms)
        setTimeout(() => _typesetWithRetry(element, attempt + 1), 200);
    }
    // After 15 attempts, silently give up — page has no MathJax
}

/**
 * Adds click-to-copy functionality to all MathJax equations within an element.
 */
export function enableClickToCopy(element) {
    element.addEventListener("click", (e) => {
        const mathContainer = e.target.closest("mjx-container");
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
            const assistant = mathContainer.querySelector(
                "mjx-assistive-mml annotation"
            );
            if (assistant) tex = assistant.textContent;
        }

        if (tex) {
            navigator.clipboard.writeText(tex).then(() => {
                const originalBg = mathContainer.style.background;
                mathContainer.style.background = "#d1fae5";
                setTimeout(() => {
                    mathContainer.style.background = originalBg;
                }, 300);
            });
        }
    });
}

/**
 * Convert LLM output (markdown + LaTeX) to safe HTML.
 * Handles: **bold**, *italic*, numbered lists, bullet lists, line breaks.
 * Preserves \(...\) and \[...\] LaTeX intact for MathJax.
 */
export function renderMarkdown(text) {
    if (!text) return "";

    // Protect LaTeX blocks from markdown processing
    const latexBlocks = [];
    let safe = text
        // Display math: \[ ... \]
        .replace(/\\\[([\s\S]*?)\\\]/g, (_, math) => {
            latexBlocks.push(`\\[${math}\\]`);
            return `%%LATEX_BLOCK_${latexBlocks.length - 1}%%`;
        })
        // Inline math: \( ... \)
        .replace(/\\\(([\s\S]*?)\\\)/g, (_, math) => {
            latexBlocks.push(`\\(${math}\\)`);
            return `%%LATEX_INLINE_${latexBlocks.length - 1}%%`;
        });

    // Escape HTML (except we re-insert LaTeX later)
    safe = safe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    // Markdown transformations
    safe = safe
        // Bold **text**
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        // Italic *text*
        .replace(/\*([^*]+)\*/g, "<em>$1</em>")
        // Inline code `code`
        .replace(/`([^`]+)`/g, "<code>$1</code>")
        // Numbered list items: "1. text" or "**Step 1:** text"
        .replace(/^(\d+)\.\s+/gm, "<li>")
        // Bullet list items
        .replace(/^[-*]\s+/gm, "<li>")
        // Headers with ## or ###
        .replace(/^###\s+(.+)$/gm, "<h4>$1</h4>")
        .replace(/^##\s+(.+)$/gm, "<h3>$1</h3>")
        // Line breaks
        .replace(/\n\n/g, "</p><p>")
        .replace(/\n/g, "<br>");

    // Wrap in paragraphs if needed
    if (!safe.startsWith("<")) safe = `<p>${safe}</p>`;

    // Re-insert LaTeX
    safe = safe.replace(
        /%%LATEX_BLOCK_(\d+)%%/g,
        (_, i) => latexBlocks[parseInt(i)]
    );
    safe = safe.replace(
        /%%LATEX_INLINE_(\d+)%%/g,
        (_, i) => latexBlocks[parseInt(i)]
    );

    return safe;
}
