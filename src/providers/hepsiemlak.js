// Hepsiemlak.com provider — the page is client-rendered from its own
// same-origin JSON API (/api/realties/<listingId>), so DOM/og at load time is
// empty. fetchData() reads that API (through the background worker) and the
// field methods map from it, falling back to og/DOM if the fetch fails. The
// whole realtyDetail is kept as `raw` so no detail is lost.
(function () {
  const root = typeof self !== "undefined" ? self : globalThis;
  const U = root.EmlakTakipUtil;
  const HOST = /^https?:\/\/(www\.)?hepsiemlak\.com\//i;
  const IMG_BASE = "https://image-cdn.hepsiemlak.com/";

  const GROUP_LABELS = {
    inAttributes: "İç Özellikler",
    outAttributes: "Dış Özellikler",
    locationAttributes: "Muhit",
    roomAttributes: "Oda Özellikleri",
    roomSocialInstitutionAttributes: "Sosyal Olanaklar",
    infrastructureAttributes: "Altyapı",
    usageAttributes: "Kullanım",
    serviceAttributes: "Hizmetler",
  };

  const rd = (data) => (data && data.realtyDetail) || null;
  const one = (v) => (Array.isArray(v) ? v[0] : v);

  function attrsFromRd(r) {
    const a = {};
    const sqm = r.sqm || {};
    const gross = one(sqm.grossSqm);
    if (gross) a["m² (Brüt)"] = String(gross);
    if (sqm.netSqm) a["m² (Net)"] = String(sqm.netSqm);
    const room = one(r.room);
    const living = one(r.livingRoom);
    if (room != null)
      a["Oda Sayısı"] = living != null ? `${room}+${living}` : String(room);
    if (r.bathRoom != null) a["Banyo Sayısı"] = String(r.bathRoom);
    if (r.age != null) a["Bina Yaşı"] = String(r.age);
    if (r.floor && r.floor.name) a["Bulunduğu Kat"] = r.floor.name;
    if (r.floor && r.floor.count) a["Kat Sayısı"] = String(r.floor.count);
    if (r.heating && r.heating.name) a["Isıtma"] = r.heating.name;
    if (r.usage && r.usage.name) a["Kullanım Durumu"] = r.usage.name;
    if (r.credit && r.credit.name) a["Krediye Uygun"] = r.credit.name;
    if (r.landRegisterName) a["Tapu Durumu"] = r.landRegisterName;
    if (typeof r.furnished === "boolean")
      a["Eşyalı"] = r.furnished ? "Evet" : "Hayır";
    if (r.barter && r.barter.name) a["Takas"] = r.barter.name;
    if (r.residence && r.residence.name) a["Konut Şekli"] = r.residence.name;
    return a;
  }

  function featuresFromRd(r) {
    const out = {};
    const attrs = r.attributes || {};
    for (const [key, label] of Object.entries(GROUP_LABELS)) {
      const arr = attrs[key];
      if (Array.isArray(arr)) {
        const names = arr.map((x) => x && x.name).filter(Boolean);
        if (names.length) out[label] = names;
      }
    }
    if (Array.isArray(r.sides) && r.sides.length) {
      const sides = r.sides
        .map((s) => (typeof s === "string" ? s : s && s.name))
        .filter(Boolean);
      if (sides.length) out["Cephe"] = sides;
    }
    return out;
  }

  function contactFromRd(r) {
    const fu = r.firmUser || {};
    const name =
      [fu.firstName, fu.lastName].filter(Boolean).join(" ").trim() || null;
    const phones = (fu.phones || [])
      .map((p) =>
        `${p.countryCode || ""}${p.areaCode || ""}${p.phoneNumber || ""}`.replace(
          /[^\d+]/g,
          ""
        )
      )
      .filter((s) => s.length >= 7);
    const agency = (r.firm && r.firm.name) || null;
    if (!name && !phones.length && !agency) return null;
    return {
      name,
      agency,
      phone: phones[0] || null,
      phones,
      type: agency ? "emlak_ofisi" : "sahibinden",
      profileUrl: fu.url || (r.firm && r.firm.url) || null,
    };
  }

  const photosFromRd = (r) =>
    (r.images || [])
      .map((p) => (typeof p === "string" ? IMG_BASE + p : p && p.url))
      .filter(Boolean);

  const provider = {
    id: "hepsiemlak",
    name: "Hepsiemlak",
    matches: (url) => HOST.test(url) && U.hasId(url),

    // The page is client-rendered from its own same-origin API
    // (/api/realties/<id>) — the listing data is NOT embedded in the served
    // HTML — so we read that API (via the background worker). The URL id may be
    // "169799-41" (the API needs that full id); the record key uses the stable
    // base number.
    sources: [
      (doc, url) => {
        const seg = U.lastSegment(url);
        const id = /^\d+-\d+$/.test(seg) ? seg : U.urlId(url);
        if (!id) return null;
        const origin =
          (typeof location !== "undefined" && location.origin) ||
          "https://www.hepsiemlak.com";
        return U.fetchJson(`${origin}/api/realties/${id}`);
      },
    ],

    ilanNo: (doc, url) => U.urlId(url) || U.ogId(doc),
    title: (doc, url, data) => (rd(data) || {}).title || U.jTitle(doc),
    category(doc, url, data) {
      const r = rd(data);
      if (r)
        return U.classifyTr(
          `${(r.subCategory || {}).typeName || ""} ${(r.mainCategory || {}).name || ""}`
        ).category;
      return U.jClassify(doc, url).category;
    },
    listingType(doc, url, data) {
      const r = rd(data);
      if (r) return U.classifyTr((r.category || {}).typeName || "").listingType;
      return U.jClassify(doc, url).listingType;
    },
    price(doc, url, data) {
      const r = rd(data);
      if (r && r.price != null)
        return {
          amount: Math.round(r.price),
          currency: U.currency(r.currency) || "TL",
          raw: `${r.price} ${r.currency || ""}`.trim(),
        };
      return U.jPrice(doc);
    },
    location(doc, url, data) {
      const r = rd(data);
      if (r) {
        const parts = [r.city, r.county, r.district].map((x) => x && x.name);
        return {
          il: parts[0] || null,
          ilce: parts[1] || null,
          mahalle: parts[2] || null,
          raw: parts.filter(Boolean).join(" / ") || null,
        };
      }
      return U.jLocation(doc);
    },
    geo(doc, url, data) {
      const r = rd(data);
      const m = r && r.mapLocation;
      if (m && !r.isMapHidden) {
        const lat = Number(m.lat);
        const lng = Number(m.lon);
        if (
          Number.isFinite(lat) &&
          Number.isFinite(lng) &&
          !(lat === 0 && lng === 0)
        )
          return { lat, lng, source: "site" };
      }
      return U.jGeo(doc);
    },
    attributes(doc, url, data) {
      const r = rd(data);
      return r ? attrsFromRd(r) : U.jAttributes(doc);
    },
    features(doc, url, data) {
      const r = rd(data);
      return r ? featuresFromRd(r) : {};
    },
    contact(doc, url, data) {
      const r = rd(data);
      return r ? contactFromRd(r) : U.jContact(doc);
    },
    description(doc, url, data) {
      const r = rd(data);
      return (r && U.htmlToText(r.description)) || U.jDescription(doc);
    },
    photos(doc, url, data) {
      const r = rd(data);
      const p = r ? photosFromRd(r) : [];
      return p.length ? p : U.jPhotos(doc);
    },
    thumbnail(doc, url, data) {
      const r = rd(data);
      if (r && r.imageUrl) return IMG_BASE + r.imageUrl;
      return this.photos(doc, url, data)[0] || U.jThumbnail(doc);
    },
    ilanTarihi(doc, url, data) {
      const r = rd(data);
      return (r && (r.startDate || r.listingUpdatedDate)) || U.jDate(doc);
    },
    // full source payload — model decided later
    raw: (doc, url, data) => rd(data) || U.rawSignals(doc),
  };

  if (root.EmlakTakip && root.EmlakTakip.register)
    root.EmlakTakip.register(provider);
  root.EmlakTakipHepsiemlak = provider;
})();
