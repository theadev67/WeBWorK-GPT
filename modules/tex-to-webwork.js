/**
 * tex-to-webwork.js
 *
 * Converts LaTeX math expressions into WeBWorK-compatible math strings.
 * Handles \frac, \boxed, \cdot, implicit multiplication, and matrices.
 */

export function texToWebwork(tex) {
    if (!tex) return "";

    let s = tex.trim();

    // 1. Remove \text{...} but keep content (basic)
    s = s.replace(/\\text\{([^\}]*)\}/g, "$1");

    // 2. Handle \boxed{...} recursively
    // We use a loop to handle nested braces if any, though \boxed is rarely nested.
    while (s.includes("\\boxed{")) {
        const start = s.indexOf("\\boxed{");
        const content = _getBraceContent(s, start + 6);
        if (content === null) break;
        const fullMatch = `\\boxed{${content}}`;
        s = s.replace(fullMatch, content);
    }

    // 3. Handle \frac{A}{B} recursively
    while (s.includes("\\frac{")) {
        const start = s.indexOf("\\frac{");
        const num = _getBraceContent(s, start + 5);
        if (num === null) break;

        const denStart = s.indexOf("{", start + 5 + num.length + 2);
        // Find the second brace after the first one
        let searchFrom = start + 5 + num.length + 2;
        // In LaTeX, \frac{A}{B} or \frac AB (but we usually get braces from LLMs)
        const den = _getBraceContent(s, s.indexOf("{", searchFrom));
        if (den === null) break;

        const fullMatch = `\\frac{${num}}{${den}}`;
        s = s.replace(fullMatch, `(${num})/(${den})`);
    }

    // 4. \cdot -> *
    s = s.replace(/\\cdot/g, "*");

    // 5. Matrices: \begin{bmatrix} 1 & 1 \\ 1 & 0 \end{bmatrix} -> [[1,1],[1,0]]
    // Supports bmatrix, pmatrix, matrix, vmatrix
    const matrixRegex =
        /\\begin\{(?:b|p|v|V)?matrix\}([\s\S]*?)\\end\{(?:b|p|v|V)?matrix\}/g;
    s = s.replace(matrixRegex, (_, content) => {
        const rows = content.trim().split(/\\\\/);
        const webworkRows = rows
            .map((row) => {
                const cols = row
                    .split(/&/)
                    .map((c) => c.trim())
                    .filter((c) => c !== "");
                return `[${cols.join(",")}]`;
            })
            .filter((r) => r !== "[]");
        return `[${webworkRows.join(",")}]`;
    });

    // 6. Explicit multiplication for common LaTeX patterns
    s = s
        .replace(/\\left/g, "")
        .replace(/\\right/g, "")
        // Remove backslashes from common commands if they are just symbols
        .replace(
            /\\(alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|pi|rho|sigma|tau|upsilon|phi|chi|psi|omega)/g,
            "$1"
        )
        .replace(/\\(sin|cos|tan|arcsin|arccos|arctan|log|ln|exp|sqrt)/g, "$1")

        // Implicit multiplication between brackets: (...) (...) -> (...)*(...)
        .replace(/\)\s*\(/g, ")*(")

        // Number followed by bracket: 2(...) -> 2*(...)
        .replace(/(\d+)\s*\(/g, "$1*(")

        // Bracket followed by number: (...)\s*2 -> (...)*2
        .replace(/\)\s*(\d+)/g, ")*$1")

        // Implicit multiplication between number and variable: 2x -> 2*x
        .replace(/(\d+)\s*([a-zA-Z])/g, "$1*$2")

        // Variable followed by bracket: x(...) -> x*(...)
        .replace(/([a-zA-Z])\s*\(/g, "$1*(")

        // Bracket followed by variable: (...)\s*x -> (...)*x
        .replace(/\)\s*([a-zA-Z])/g, ")*$1");

    // 7. Cleanup
    s = s
        .replace(/\{/g, "(")
        .replace(/\}/g, ")")
        .replace(/\\/g, "") // Remove remaining backslashes
        .replace(/\s+/g, " ") // Collapse whitespace
        .trim();

    return s;
}

/**
 * Helper to extract matching brace content starting from a given index (of the opening brace).
 */
function _getBraceContent(str, startIdx) {
    if (startIdx < 0 || str[startIdx] !== "{") return null;
    let depth = 0;
    for (let i = startIdx; i < str.length; i++) {
        if (str[i] === "{") depth++;
        if (str[i] === "}") depth--;
        if (depth === 0) {
            return str.substring(startIdx + 1, i);
        }
    }
    return null;
}
