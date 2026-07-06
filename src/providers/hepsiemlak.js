// Hepsiemlak.com provider adapter.
//
// Hepsiemlak renders client-side but embeds schema.org JSON-LD on listing
// detail pages, so parsing goes through the shared EmlakTakipJsonLd helper.
// NOTE: the URL/id heuristics are best-effort and should be confirmed against
// live pages. Because the site is a SPA, capture works on a full page load of
// the detail URL (client-side navigation does not re-run the content script).
(function () {
  const root = typeof self !== "undefined" ? self : globalThis;

  const HOST = /^https?:\/\/(www\.)?hepsiemlak\.com\//i;
  const ID_RE = /-(\d{5,})(?:[/?#]|$)/;

  function idFromUrl(url) {
    const m = url.match(ID_RE);
    return m ? m[1] : null;
  }

  const provider = {
    id: "hepsiemlak",
    name: "Hepsiemlak",
    matches(url) {
      return HOST.test(url) && (ID_RE.test(url) || /\/detay/i.test(url));
    },
    parse(doc, url) {
      const jl = root.EmlakTakipJsonLd;
      return jl ? jl.toRecord(doc, url, { idFromUrl }) : null;
    },
  };

  if (root.EmlakTakip && root.EmlakTakip.register)
    root.EmlakTakip.register(provider);
  root.EmlakTakipHepsiemlak = provider;
})();
