/**
 * Utility for MathJax typesetting and equation interaction.
 */

/**
 * Force MathJax to typeset the given element.
 * Assumes MathJax 3 is available on the page (WeBWorK usually provides it).
 * If not, this fails gracefully.
 */
export function typeset(element) {
    if (window.MathJax && window.MathJax.typesetPromise) {
        window.MathJax.typesetPromise([element]).catch((err) => {
            console.error("MathJax typesetting failed:", err);
        });
    } else {
        // Fallback: try to find MathJax on the parent window if in an iframe (though we aren't)
        console.warn("MathJax not found for typesetting");
    }
}

/**
 * Adds click-to-copy functionality to all MathJax equations within an element.
 */
export function enableClickToCopy(element) {
    element.addEventListener("click", (e) => {
        const mathContainer = e.target.closest("mjx-container");
        if (!mathContainer) return;

        // MathJax 3 stores the original TeX in an assistant or data attribute
        let tex = "";
        const script = mathContainer.previousElementSibling;
        if (
            script &&
            script.tagName === "SCRIPT" &&
            script.type.includes("math/tex")
        ) {
            tex = script.textContent;
        } else {
            // Look for data-tex or similar
            const assistant = mathContainer.querySelector(
                "mjx-assistive-mml annotation"
            );
            if (assistant) {
                tex = assistant.textContent;
            }
        }

        if (tex) {
            navigator.clipboard.writeText(tex).then(() => {
                // Subtle visual feedback
                const originalBg = mathContainer.style.background;
                mathContainer.style.background = "#d1fae5";
                setTimeout(() => {
                    mathContainer.style.background = originalBg;
                }, 300);
            });
        }
    });
}
