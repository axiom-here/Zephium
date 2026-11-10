// A classic script, not a module: the parser runs it before the body exists,
// so the chosen theme is on <html> for the very first paint. A module here
// would be deferred, and a popup that paints the default and then switches
// flashes every single time it opens.
//
// The choice itself lives in chrome.storage.local; this file reads the mirror
// kept in localStorage, which is the only store that can be read without
// waiting.
(() => {
  try {
    const theme = localStorage.getItem("foflow-theme");
    const root = document.documentElement;
    if (theme === "light" || theme === "dark" || theme === "mocha") {
      root.dataset.theme = theme;
    } else {
      delete root.dataset.theme;
    }
    root.dataset.themeChoice = theme ?? "system";
  } catch {
    // Storage can be denied; the system then decides, as in the default.
  }
})();
