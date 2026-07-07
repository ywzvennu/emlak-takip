// Hepsiemlak.com provider — client-rendered SPA. Implements the field-method
// contract by delegating to the shared JSON-LD/og helpers. Listing ids follow a
// "/" (e.g. /daire/161766-5), so id detection is digit-run based, not "-"
// anchored. Capture works on a full page load of the detail URL.
(function () {
  const root = typeof self !== "undefined" ? self : globalThis;
  const U = root.EmlakTakipUtil;
  const HOST = /^https?:\/\/(www\.)?hepsiemlak\.com\//i;

  const provider = {
    id: "hepsiemlak",
    name: "Hepsiemlak",
    matches: (url) => HOST.test(url) && U.hasId(url),
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
  };

  if (root.EmlakTakip && root.EmlakTakip.register)
    root.EmlakTakip.register(provider);
  root.EmlakTakipHepsiemlak = provider;
})();
