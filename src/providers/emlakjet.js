// Emlakjet.com provider adapter.
//
// Like Hepsiemlak, Emlakjet is a client-rendered SPA that embeds schema.org
// JSON-LD on listing detail pages (path under /ilan/). Parsing goes through the
// shared EmlakTakipJsonLd helper. NOTE: URL/id heuristics are best-effort and
// should be confirmed against live pages; capture works on a full page load of
// the detail URL.
(function () {
  const root = typeof self !== "undefined" ? self : globalThis;

  const HOST = /^https?:\/\/(www\.)?emlakjet\.com\//i;
  const ID_RE = /-(\d{5,})(?:[/?#]|$)/;

  function idFromUrl(url) {
    const m = url.match(ID_RE);
    return m ? m[1] : null;
  }

  const provider = {
    id: "emlakjet",
    name: "Emlakjet",
    matches(url) {
      return HOST.test(url) && (/\/ilan\//i.test(url) || ID_RE.test(url));
    },
    parse(doc, url) {
      const jl = root.EmlakTakipJsonLd;
      return jl ? jl.toRecord(doc, url, { idFromUrl }) : null;
    },
  };

  if (root.EmlakTakip && root.EmlakTakip.register)
    root.EmlakTakip.register(provider);
  root.EmlakTakipEmlakjet = provider;
})();
