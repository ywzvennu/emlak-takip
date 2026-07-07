// Emlakjet.com provider — client-rendered SPA. Implements the field-method
// contract by delegating to the shared JSON-LD/og helpers. Emlakjet's JSON-LD
// is only a BreadcrumbList, so price/location/title come from og-meta and the
// breadcrumb. Detail pages live under /ilan/. Capture works on a full page load.
(function () {
  const root = typeof self !== "undefined" ? self : globalThis;
  const U = root.EmlakTakipUtil;
  const HOST = /^https?:\/\/(www\.)?emlakjet\.com\//i;

  const provider = {
    id: "emlakjet",
    name: "Emlakjet",
    matches: (url) => HOST.test(url) && (/\/ilan\//i.test(url) || U.hasId(url)),
    ilanNo: (doc, url) => U.urlId(url) || U.ogId(doc),
    title: (doc) => U.jTitle(doc),
    category: (doc, url) => U.jClassify(doc, url).category,
    listingType: (doc, url) => U.jClassify(doc, url).listingType,
    price: (doc) => U.jPrice(doc),
    location: (doc) => U.jLocation(doc),
    geo: (doc) => U.jGeo(doc),
    attributes: (doc) => U.jAttributes(doc),
    features: () => ({}),
    contact: (doc) => U.jContact(doc),
    description: (doc) => U.jDescription(doc),
    photos: (doc) => U.jPhotos(doc),
    thumbnail: (doc) => U.jThumbnail(doc),
    ilanTarihi: (doc) => U.jDate(doc),
    // Emlakjet's listing API isn't publicly reachable; keep all meta + JSON-LD
    // as the raw payload so nothing available is lost.
    raw: (doc) => U.rawSignals(doc),
  };

  if (root.EmlakTakip && root.EmlakTakip.register)
    root.EmlakTakip.register(provider);
  root.EmlakTakipEmlakjet = provider;
})();
