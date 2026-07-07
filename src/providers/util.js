// Shared low-level helpers for provider adapters. These are NOT the provider
// contract — they are utilities a provider's field methods can call. DOM
// helpers for selector-based sites (Sahibinden) and JSON-LD/og helpers for
// SPA sites (Hepsiemlak, Emlakjet) live here so each provider stays small.
//
// Classic script: attaches EmlakTakipUtil to the shared global; also
// side-effect importable by tests. Loaded after registry.js, before providers.
(function () {
  const root = typeof self !== "undefined" ? self : globalThis;

  const CURRENCY = { TRY: "TL", TL: "TL", USD: "USD", EUR: "EUR" };
  const PRICE_RE = /(\d[\d.,\s]*\d)\s*(TL|₺|USD|\$|EUR|€)/i;

  // ---- DOM ----
  function q(doc, sels) {
    for (const s of Array.isArray(sels) ? sels : [sels]) {
      const el = doc.querySelector(s);
      if (el) return el;
    }
    return null;
  }
  const qa = (doc, sel) => [...doc.querySelectorAll(sel)];
  const text = (el) => (el ? el.textContent.trim().replace(/\s+/g, " ") : null);

  function metaOf(doc, names) {
    for (const n of names) {
      const el = doc.querySelector(`meta[property="${n}"], meta[name="${n}"]`);
      if (el && el.content) return el.content;
    }
    return null;
  }
  const ogTitle = (doc) => metaOf(doc, ["og:title"]);
  const ogDesc = (doc) => metaOf(doc, ["og:description", "description"]);
  const ogImage = (doc) => metaOf(doc, ["og:image"]);

  // ---- URL ----
  const lastSegment = (url) =>
    String(url).split(/[#?]/)[0].replace(/\/+$/, "").split("/").pop() || "";
  // The listing id is the longest run of >=5 digits in the path — works whether
  // the id follows a "-" (emlakjet) or a "/" (hepsiemlak: /daire/161766-5).
  function urlId(url) {
    const runs =
      String(url)
        .split(/[#?]/)[0]
        .match(/\d{5,}/g) || [];
    return runs.sort((a, b) => b.length - a.length)[0] || null;
  }
  const hasId = (url) => /\d{5,}/.test(lastSegment(url));

  // ---- price / classify ----
  function parsePriceText(str) {
    const m = String(str || "").match(PRICE_RE);
    if (!m) return null;
    const amount = parseInt(m[1].replace(/[^\d]/g, ""), 10) || null;
    const cur = /USD|\$/i.test(m[2])
      ? "USD"
      : /EUR|€/i.test(m[2])
        ? "EUR"
        : "TL";
    return { amount, currency: cur, raw: m[0].trim() };
  }
  const currency = (c) => CURRENCY[String(c || "").toUpperCase()] || c || null;

  function classifyTr(str) {
    const s = (str || "").toLowerCase();
    const listingType = /kiral[ıi]k|rent/.test(s)
      ? "kiralik"
      : /sat[ıi]l[ıi]k|for-sale|\bsale\b/.test(s)
        ? "satilik"
        : null;
    let category = "diger";
    if (/arsa|tarla|land|parsel/.test(s)) category = "arsa";
    else if (
      /[ıi]s.?yeri|ticari|d[üu]kkan|ofis|office|commercial|depo|ma[ğg]aza|store/.test(
        s
      )
    )
      category = "ticari";
    else if (
      /daire|konut|residence|home|villa|m[üu]stakil|residential|apart|rezidans/.test(
        s
      )
    )
      category = "konut";
    return { category, listingType };
  }

  // ---- JSON-LD ----
  function jsonld(doc) {
    const out = [];
    doc.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
      let d;
      try {
        d = JSON.parse(s.textContent);
      } catch {
        return;
      }
      const arr = Array.isArray(d) ? d : d["@graph"] ? d["@graph"] : [d];
      for (const it of arr) if (it && typeof it === "object") out.push(it);
    });
    return out;
  }
  const typesOf = (it) =>
    [].concat(it["@type"] || []).map((x) => String(x).toLowerCase());
  function findType(items, types) {
    const w = new Set(types.map((t) => t.toLowerCase()));
    return items.find((it) => typesOf(it).some((t) => w.has(t))) || null;
  }
  const LISTING_TYPES = [
    "product",
    "realestatelisting",
    "residence",
    "apartment",
    "house",
    "singlefamilyresidence",
    "accommahalletion",
    "place",
  ];
  const listing = (doc) => findType(jsonld(doc), LISTING_TYPES);

  function firstImage(img) {
    if (!img) return null;
    if (typeof img === "string") return img;
    if (Array.isArray(img)) return firstImage(img[0]);
    if (typeof img === "object") return img.url || img.contentUrl || null;
    return null;
  }
  function allImages(img) {
    if (!img) return [];
    if (typeof img === "string") return [img];
    if (Array.isArray(img)) return img.map(firstImage).filter(Boolean);
    if (typeof img === "object")
      return [img.url || img.contentUrl].filter(Boolean);
    return [];
  }

  // Location + category text from a BreadcrumbList (e.g. emlakjet).
  function breadcrumb(items) {
    const bl = findType(items, ["BreadcrumbList"]);
    if (!bl || !Array.isArray(bl.itemListElement)) return null;
    const names = bl.itemListElement
      .map((x) => (x && (x.name || (x.item && x.item.name))) || null)
      .filter(Boolean);
    const catRe =
      /sat[ıi]l[ıi]k|kiral[ıi]k|daire|arsa|konut|villa|i[şs]yeri|ofis|d[üu]kkan|residence|apart/i;
    const rootRe = /emlakjet|hepsiemlak|sahibinden|anasayfa|home|ilan/i;
    const catText = names.filter((n) => catRe.test(n)).join(" ");
    const places = names.filter((n) => !catRe.test(n) && !rootRe.test(n));
    if (!places.length) return { location: null, catText };
    const n = places.length;
    const location = {
      il: n >= 3 ? places[n - 3] : null,
      ilce: n >= 2 ? places[n - 2] : null,
      mahalle: places[n - 1] || null,
      raw: places.slice(-3).join(" / ") || null,
    };
    return { location, catText };
  }

  // ---- field-level helpers shared by JSON-LD/og providers ----
  const offerOf = (doc) => {
    const l = listing(doc);
    let o = l && l.offers;
    if (Array.isArray(o)) o = o[0];
    return o || findType(jsonld(doc), ["Offer"]);
  };
  const jTitle = (doc) =>
    (listing(doc) || {}).name ||
    ogTitle(doc) ||
    text(q(doc, "h1")) ||
    doc.title;
  function jPrice(doc) {
    const o = offerOf(doc);
    if (o && o.price != null)
      return {
        amount: parseInt(String(o.price).replace(/[^\d]/g, ""), 10) || null,
        currency: currency(o.priceCurrency),
        raw: String(o.price),
      };
    return parsePriceText(`${ogTitle(doc) || ""} ${ogDesc(doc) || ""}`);
  }
  function jLocation(doc) {
    const l = listing(doc);
    const addr = l && l.address;
    if (addr)
      return {
        il: addr.addressRegion || null,
        ilce: addr.addressLocality || null,
        mahalle: null,
        raw:
          [addr.addressRegion, addr.addressLocality, addr.streetAddress]
            .filter(Boolean)
            .join(" / ") || null,
      };
    const bc = breadcrumb(jsonld(doc));
    return (
      (bc && bc.location) || { il: null, ilce: null, mahalle: null, raw: null }
    );
  }
  function jGeo(doc) {
    const g = (listing(doc) || {}).geo;
    if (!g) return null;
    const lat = Number(g.latitude);
    const lng = Number(g.longitude);
    return Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      !(lat === 0 && lng === 0)
      ? { lat, lng, source: "jsonld" }
      : null;
  }
  function jAttributes(doc) {
    const a = {};
    const ap = (listing(doc) || {}).additionalProperty;
    if (Array.isArray(ap))
      for (const p of ap)
        if (p && p.name && p.value != null) a[String(p.name)] = String(p.value);
    const t = `${ogTitle(doc) || ""} ${ogDesc(doc) || ""}`;
    const m2 = t.match(/(\d+)\s*m²/i);
    if (m2 && !a["m²"]) a["m²"] = m2[1];
    const oda = t.match(/(\d+\s*\+\s*\d+|stüdyo)\s*oda/i);
    if (oda && !a["Oda Sayısı"]) a["Oda Sayısı"] = oda[1].replace(/\s+/g, "");
    return a;
  }
  function jContact(doc) {
    const l = listing(doc);
    const o = offerOf(doc);
    const seller =
      (o && (o.seller || o.offeredBy)) ||
      (l && (l.provider || l.agent || l.author)) ||
      null;
    if (!seller) return null;
    const type = String(seller["@type"] || "").toLowerCase();
    const phone = seller.telephone ? String(seller.telephone) : null;
    return {
      name: seller.name || null,
      agency:
        type.includes("organization") || type.includes("realestate")
          ? seller.name || null
          : null,
      phone,
      phones: phone ? [phone] : [],
      type: type.includes("person") ? "sahibinden" : "emlak_ofisi",
      profileUrl: seller.url || null,
    };
  }
  const jDescription = (doc) =>
    (listing(doc) || {}).description || ogDesc(doc) || null;
  function jPhotos(doc) {
    const imgs = allImages((listing(doc) || {}).image);
    if (imgs.length) return imgs;
    const og = ogImage(doc);
    return og ? [og] : [];
  }
  const jThumbnail = (doc) =>
    firstImage((listing(doc) || {}).image) || ogImage(doc);
  function jClassify(doc, url) {
    const l = listing(doc);
    const bc = breadcrumb(jsonld(doc));
    return classifyTr(
      `${url || ""} ${ogTitle(doc) || ""} ${(bc && bc.catText) || ""} ${(l && l.name) || ""}`
    );
  }
  const jDate = (doc) => {
    const l = listing(doc) || {};
    return l.datePosted || l.availabilityStarts || null;
  };
  function ogId(doc) {
    const m = `${ogTitle(doc) || ""} ${ogDesc(doc) || ""}`.match(/#(\d{5,})/);
    return m ? m[1] : null;
  }

  root.EmlakTakipUtil = {
    q,
    qa,
    text,
    metaOf,
    ogTitle,
    ogDesc,
    ogImage,
    lastSegment,
    urlId,
    hasId,
    parsePriceText,
    currency,
    classifyTr,
    jsonld,
    findType,
    listing,
    firstImage,
    allImages,
    breadcrumb,
    jTitle,
    jPrice,
    jLocation,
    jGeo,
    jAttributes,
    jContact,
    jDescription,
    jPhotos,
    jThumbnail,
    jClassify,
    jDate,
    ogId,
  };
})();
