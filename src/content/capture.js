// Content script (classic, shares scope with the providers and inject.js).
//
// Generic dispatcher: it holds no site-specific selectors. It asks the provider
// registry which provider claims the current URL and delegates parsing to it,
// then stamps the normalized record with `provider` and the composite `key`
// (provider:ilanNo) used everywhere downstream for identity.
//
// No network requests — providers read only the DOM of the page already open.
(function () {
  const root = typeof self !== "undefined" ? self : globalThis;
  const registry = root.EmlakTakip;

  function currentProvider() {
    return registry ? registry.getProvider(location.href) : null;
  }

  function isIlanDetail() {
    return !!currentProvider();
  }

  function captureIlan() {
    const provider = currentProvider();
    if (!provider) return null;
    const url = location.href.split("#")[0];
    let rec;
    try {
      rec = provider.parse(document, url);
    } catch {
      return null;
    }
    if (!rec || !rec.ilanNo) return null;
    rec.provider = provider.id;
    rec.key = `${provider.id}:${rec.ilanNo}`;
    return rec;
  }

  root.EmlakTakipCapture = { captureIlan, isIlanDetail };
})();
