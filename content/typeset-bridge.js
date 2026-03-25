/**
 * typeset-bridge.js — runs in MAIN world (has access to window.MathJax)
 *
 * Listens for 'wwgpt:typeset' CustomEvents dispatched from the isolated-world
 * content script. Calls MathJax on the element identified by the data attribute.
 */
document.addEventListener("wwgpt:typeset", function (e) {
    var uid = e.detail && e.detail.uid;
    if (!uid) return;

    var el = document.querySelector('[data-wwgpt-ts="' + uid + '"]');
    if (!el) return;

    var MJ = window.MathJax;
    if (!MJ) return;

    try {
        // MathJax 3
        if (typeof MJ.typesetPromise === "function") {
            var ready =
                MJ.startup && MJ.startup.promise
                    ? MJ.startup.promise
                    : Promise.resolve();
            ready
                .then(function () {
                    return MJ.typesetPromise([el]);
                })
                .catch(function () {});
            return;
        }
        // MathJax 2
        if (MJ.Hub && typeof MJ.Hub.Queue === "function") {
            MJ.Hub.Queue(["Typeset", MJ.Hub, el]);
        }
    } catch (_) {}
});
