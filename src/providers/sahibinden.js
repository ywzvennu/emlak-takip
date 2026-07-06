// Sahibinden.com provider adapter.
//
// parse(doc, url) reads a listing detail page and returns the normalized record
// (minus provider/key, which capture.js stamps on). Classic script: registers
// itself on the shared registry when present, and is also side-effect-importable
// by tests, which then call the provider's parse() against a jsdom document.
//
// Robustness: URL-slug and <meta> derived fields (id/category/type/title/image)
// are the stable ones. The DOM selectors for price, location and the attribute
// list are the most likely to need tweaks if the site changes markup — they all
// live in SELECTORS below, each with fallbacks.
(function () {
  const root = typeof self !== "undefined" ? self : globalThis;

  const CATEGORIES = { konut: "konut", ticari: "ticari", arsa: "arsa" };
  const TYPES = { satilik: "satilik", kiralik: "kiralik" };

  const SELECTORS = {
    title: [".classifiedDetailTitle h1", "h1.classifiedDetailTitle", "h1"],
    priceScope: [".classifiedInfo", "#classifiedDetail"],
    priceNode: [
      ".classifiedInfo .price-section",
      ".classifiedInfo h3",
      '[class*="classified-price"]',
      '[class*="price"]',
    ],
    infoList: [".classifiedInfoList li", ".classifiedInfo ul li"],
    locationLinks: [".classifiedInfo h2 a", ".searchResultsBreadCrumb a"],
    galleryImg: [
      ".classifiedDetailMainPhoto img",
      "#classifiedDetailPhoto img",
      "img",
    ],
    // Seller / agent box. NOTE: these selectors are best-effort and should be
    // confirmed against a live page — sahibinden changes this area often.
    contactBox: [
      ".classifiedUserBox",
      ".storeInformation",
      ".username-info-area",
      ".user-info-module",
      "#classifiedContactInfo",
    ],
    contactName: [
      ".user-info-agency-name a",
      ".store-user-name",
      ".username-info-area h5",
      ".storeCardMainInfo h3",
      ".user-info-store-name",
    ],
    contactAgency: [
      ".user-info-agency-name a",
      ".storeCardMainInfo h3",
      ".store-name",
    ],
    contactStoreLink: [
      ".user-info-agency-name a",
      "a.storeName",
      'a[href*="/magaza/"]',
      'a[href*="/mağaza/"]',
    ],
    mapEl: [
      "[data-lat][data-lon]",
      "[data-lat][data-lng]",
      "#gmap",
      ".classifiedGmap",
      "#gmapContainer",
    ],
    description: [
      "#classifiedDescription",
      ".classifiedDescription",
      "#descriptionText",
      '[id*="escription"]',
    ],
    photoImgs: [
      ".megaPhotoThumbList img",
      ".classified-detail-gallery img",
      ".classifiedDetailMainPhoto img",
    ],
  };

  const CURRENCY_RE = /(\d[\d.\s]*\d|\d)\s*(TL|₺|USD|\$|EUR|€)/;
  const DETAIL_RE = /\/ilan\/[a-z0-9-]+-\d+\/detay/i;
  // TR mobile/landline, tolerant of +90 / 0 / parens / spaces / dashes.
  const PHONE_RE =
    /(?:\+?90[\s-]?)?(?:0[\s-]?)?\(?\d{3}\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}/g;

  function first(doc, selList, node) {
    const scope = node || doc;
    for (const sel of selList) {
      const el = scope.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function metaOf(doc, names) {
    for (const name of names) {
      const el = doc.querySelector(
        `meta[property="${name}"], meta[name="${name}"]`
      );
      if (el && el.content) return el.content;
    }
    return null;
  }

  function text(el) {
    return el ? el.textContent.trim().replace(/\s+/g, " ") : null;
  }

  function parseSlug(url) {
    // .../ilan/emlak-<kategori>-<tip>-<...>-<ilanNo>/detay
    const m = url.match(/\/ilan\/([a-z0-9-]+?)-(\d+)\/detay/i);
    let category = null;
    let listingType = null;
    let ilanNo = null;
    let slug = null;
    if (m) {
      slug = m[1];
      ilanNo = m[2];
      for (const part of slug.split("-")) {
        if (!category && CATEGORIES[part]) category = CATEGORIES[part];
        if (!listingType && TYPES[part]) listingType = TYPES[part];
        if (category && listingType) break;
      }
    }
    return { category, listingType, ilanNo, slug };
  }

  function parsePrice(raw) {
    if (!raw) return null;
    const currency = /USD|\$/.test(raw)
      ? "USD"
      : /EUR|€/.test(raw)
        ? "EUR"
        : /TL|₺/.test(raw)
          ? "TL"
          : null;
    const digits = raw.replace(/[^\d]/g, "");
    const amount = digits ? parseInt(digits, 10) : null;
    return { amount, currency, raw: raw.trim() };
  }

  function findPrice(doc) {
    for (const scopeSel of SELECTORS.priceScope) {
      const scope = doc.querySelector(scopeSel);
      if (!scope) continue;
      const node = first(doc, SELECTORS.priceNode, scope);
      if (node) {
        const m = node.textContent.match(CURRENCY_RE);
        if (m) return parsePrice(m[0]);
      }
      const m2 = scope.textContent.match(CURRENCY_RE);
      if (m2) return parsePrice(m2[0]);
    }
    return null;
  }

  function parseAttributes(doc) {
    const attrs = {};
    const seen = new Set();
    for (const sel of SELECTORS.infoList) {
      doc.querySelectorAll(sel).forEach((li) => {
        const strong = li.querySelector("strong");
        const span = li.querySelector("span");
        if (!strong || !span) return;
        const k = text(strong).replace(/:$/, "");
        const v = text(span);
        if (k && v && !seen.has(k)) {
          attrs[k] = v;
          seen.add(k);
        }
      });
      if (Object.keys(attrs).length) break;
    }
    return attrs;
  }

  function parseLocation(doc) {
    let anchors = [];
    for (const sel of SELECTORS.locationLinks) {
      anchors = [...doc.querySelectorAll(sel)].map(text).filter(Boolean);
      if (anchors.length) break;
    }
    const [il, ilce, mahalle] = anchors;
    return {
      il: il || null,
      ilce: ilce || null,
      mahalle: mahalle || null,
      raw: anchors.join(" / ") || null,
    };
  }

  function firstImage(doc) {
    const img = first(doc, SELECTORS.galleryImg);
    return img ? img.src : null;
  }

  // Pull TR phone numbers out of a text blob, normalized to 10 national digits.
  function extractPhones(str) {
    if (!str) return [];
    const out = new Set();
    for (const m of str.match(PHONE_RE) || []) {
      let n = m.replace(/\D/g, "");
      if (n.startsWith("90") && n.length === 12) n = n.slice(2);
      if (n.length === 11 && n.startsWith("0")) n = n.slice(1);
      if (n.length === 10) out.add(n);
    }
    return [...out];
  }

  function parseContact(doc) {
    const box = first(doc, SELECTORS.contactBox);
    const name = text(first(doc, SELECTORS.contactName, box || undefined));
    const agency = text(first(doc, SELECTORS.contactAgency, box || undefined));
    const storeLink = first(doc, SELECTORS.contactStoreLink, box || undefined);
    const profileUrl = storeLink && storeLink.href ? storeLink.href : null;
    const phones = extractPhones(box ? box.textContent : "");
    const isStore = !!(storeLink || agency);

    if (!name && !agency && !phones.length && !profileUrl) return null;
    return {
      name: name || null,
      agency: agency || (isStore ? name : null),
      phones,
      phone: phones[0] || null,
      type: isStore ? "emlak_ofisi" : "sahibinden",
      profileUrl,
    };
  }

  function validCoord(lat, lng) {
    return (
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      Math.abs(lat) <= 90 &&
      Math.abs(lng) <= 180 &&
      !(lat === 0 && lng === 0)
    );
  }

  function parseGeo(doc) {
    const el = first(doc, SELECTORS.mapEl);
    if (el) {
      const lat = parseFloat(el.getAttribute("data-lat"));
      const lng = parseFloat(
        el.getAttribute("data-lon") ?? el.getAttribute("data-lng")
      );
      if (validCoord(lat, lng)) return { lat, lng, source: "map-attr" };
    }
    // Fall back to a lat/lng pair embedded in an inline script.
    for (const s of doc.querySelectorAll("script")) {
      const txt = s.textContent;
      if (!txt || !/lat/i.test(txt)) continue;
      const m = txt.match(
        /(?:lat|latitude)["'\s:=]+(-?\d{1,2}\.\d{3,})[\s\S]{0,40}?(?:lon|lng|longitude)["'\s:=]+(-?\d{1,3}\.\d{3,})/i
      );
      if (m) {
        const lat = parseFloat(m[1]);
        const lng = parseFloat(m[2]);
        if (validCoord(lat, lng)) return { lat, lng, source: "script" };
      }
    }
    return null;
  }

  function parseDescription(doc) {
    const el = first(doc, SELECTORS.description);
    if (!el) return null;
    const t = el.textContent
      .replace(/[ \t\u00a0]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return t || null;
  }

  function parsePhotos(doc) {
    const urls = new Set();
    for (const sel of SELECTORS.photoImgs) {
      doc.querySelectorAll(sel).forEach((img) => {
        const src =
          img.getAttribute("data-src") ||
          img.getAttribute("data-lazy") ||
          img.src;
        if (src && /^https?:/.test(src)) urls.add(src);
      });
      if (urls.size) break;
    }
    return [...urls];
  }

  function parse(doc, url) {
    const clean = (url || "").split("#")[0];
    const slug = parseSlug(clean);
    const attributes = parseAttributes(doc);
    const price = findPrice(doc);

    const ilanNo =
      (attributes["İlan No"] && attributes["İlan No"].replace(/\D/g, "")) ||
      slug.ilanNo;
    if (!ilanNo) return null;

    const title =
      text(first(doc, SELECTORS.title)) ||
      metaOf(doc, ["og:title"]) ||
      doc.title;

    return {
      ilanNo,
      url: clean,
      slug: slug.slug,
      title,
      category: slug.category || "diger",
      listingType: slug.listingType,
      price,
      location: parseLocation(doc),
      geo: parseGeo(doc),
      attributes,
      contact: parseContact(doc),
      description: parseDescription(doc),
      photos: parsePhotos(doc),
      thumbnail: metaOf(doc, ["og:image"]) || firstImage(doc),
      ilanTarihi: attributes["İlan Tarihi"] || null,
      capturedAt: Date.now(),
    };
  }

  const provider = {
    id: "sahibinden",
    name: "Sahibinden",
    matches(url) {
      return (
        /^https?:\/\/(www\.)?sahibinden\.com\//i.test(url) &&
        DETAIL_RE.test(url)
      );
    },
    parse,
  };

  if (root.EmlakTakip && root.EmlakTakip.register)
    root.EmlakTakip.register(provider);
  root.EmlakTakipSahibinden = provider;
})();
