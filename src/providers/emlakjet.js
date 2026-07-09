// Emlakjet.com provider — client-rendered SPA, but its detail HTML embeds rich
// JSON-LD: a Product (price/title/description/image), a RealEstateListing (whose
// `address` carries il/ilçe/mahalle), and `itemOffered` = a Residence with an
// `additionalProperty` list (the attribute table). Price/title/desc come from
// the shared og/JSON-LD helpers; location + attributes are mined from that graph
// (the generic `listing()` picks the Product first, which has no address, so we
// read RealEstateListing explicitly). Detail pages live under /ilan/.
(function () {
  const root = typeof self !== "undefined" ? self : globalThis;
  const U = root.EmlakTakipUtil;
  const HOST = /^https?:\/\/(www\.)?emlakjet\.com\//i;

  const relListing = (doc) => U.findType(U.jsonld(doc), ["RealEstateListing"]);

  // The offered unit (Residence/Apartment/…) that holds additionalProperty.
  function residenceOf(doc) {
    const io = (relListing(doc) || {}).itemOffered;
    if (io && !Array.isArray(io) && typeof io === "object") return io;
    return U.findType(U.jsonld(doc), ["Residence", "Apartment", "House"]);
  }

  // additionalProperty names that duplicate dedicated fields, so skip them.
  const DATE_ATTR = "İlan Güncelleme Tarihi";
  const SKIP_ATTR = new Set([
    "İlan Numarası",
    "İlan No",
    "Kategori",
    DATE_ATTR,
  ]);

  function ldAttributes(doc) {
    const res = residenceOf(doc);
    const out = {};
    if (!res) return out;
    const fs = res.floorSize && Number(res.floorSize.value);
    if (Number.isFinite(fs) && fs > 0) out["m²"] = String(fs);
    for (const p of res.additionalProperty || []) {
      if (p && p.name && p.value != null && !SKIP_ATTR.has(p.name))
        out[p.name] = String(p.value);
    }
    return out;
  }

  const provider = {
    id: "emlakjet",
    name: "Emlakjet",
    matches: (url) => HOST.test(url) && (/\/ilan\//i.test(url) || U.hasId(url)),
    ilanNo: (doc, url) => U.urlId(url) || U.ogId(doc),
    title: (doc) => U.jTitle(doc),
    category: (doc, url) => U.jClassify(doc, url).category,
    listingType: (doc, url) => U.jClassify(doc, url).listingType,
    price: (doc) => U.jPrice(doc),
    location(doc) {
      const a = (relListing(doc) || {}).address;
      if (a && (a.addressRegion || a.addressLocality || a.streetAddress))
        return {
          il: a.addressRegion || null,
          ilce: a.addressLocality || null,
          mahalle: a.streetAddress || null,
          raw:
            [a.addressRegion, a.addressLocality, a.streetAddress]
              .filter(Boolean)
              .join(" / ") || null,
        };
      return U.jLocation(doc);
    },
    geo: (doc) => U.jGeo(doc),
    // JSON-LD attributes, with og-derived m²/oda taking precedence where present.
    attributes: (doc) => ({ ...ldAttributes(doc), ...U.jAttributes(doc) }),
    features: () => ({}),
    contact: (doc) => U.jContact(doc),
    description: (doc) => U.jDescription(doc),
    photos: (doc) => U.jPhotos(doc),
    thumbnail: (doc) => U.jThumbnail(doc),
    ilanTarihi(doc) {
      const d = ((residenceOf(doc) || {}).additionalProperty || []).find(
        (p) => p && p.name === DATE_ATTR
      );
      return (
        (d && d.value) || (relListing(doc) || {}).dateModified || U.jDate(doc)
      );
    },
    // Keep all meta + JSON-LD as the raw payload so nothing available is lost.
    raw: (doc) => U.rawSignals(doc),
  };

  if (root.EmlakTakip && root.EmlakTakip.register)
    root.EmlakTakip.register(provider);
  root.EmlakTakipEmlakjet = provider;
})();
