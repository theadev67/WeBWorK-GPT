(async () => {
    const src = chrome.runtime.getURL("content/main.js");
    await import(src);
})();
