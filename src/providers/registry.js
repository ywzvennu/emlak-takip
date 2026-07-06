// Provider registry, shared through the content-script global.
//
// This file is loaded first in the content_scripts list; each site provider
// (sahibinden.js, …) registers itself here, and capture.js dispatches to the
// provider whose matches(url) returns true. Classic script — no import/export —
// so it can run both as a content script and be side-effect-imported by tests.
(function () {
  const root = typeof self !== "undefined" ? self : globalThis;
  if (root.EmlakTakip && root.EmlakTakip.register) return;

  const providers = [];
  root.EmlakTakip = {
    providers,
    register(provider) {
      providers.push(provider);
    },
    // First provider that claims this URL, or null.
    getProvider(url) {
      return providers.find((p) => p.matches(url)) || null;
    },
  };
})();
