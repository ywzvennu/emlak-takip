// Content script (classic, shares scope with providers + inject.js).
//
// Generic dispatcher: finds the provider whose matches(url) claims the current
// URL and asks the registry to assemble a record from that provider's field
// methods. No site-specific logic here. No network — providers read only the
// DOM of the page already open.
(function () {
  const root = typeof self !== "undefined" ? self : globalThis;
  const registry = root.EmlakTakip;

  function currentProvider() {
    return registry ? registry.getProvider(location.href) : null;
  }

  // Light check for "is this a listing detail page": a matching provider that
  // can read a listing id here. Avoids a full parse on every matched page.
  function isIlanDetail() {
    const p = currentProvider();
    if (!p) return false;
    try {
      return !!p.ilanNo(document, location.href.split("#")[0]);
    } catch {
      return false;
    }
  }

  function captureIlan() {
    const provider = currentProvider();
    if (!provider) return null;
    return registry.buildRecord(provider, document, location.href);
  }

  root.EmlakTakipCapture = { captureIlan, isIlanDetail };
})();
