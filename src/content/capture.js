// Content script (classic, shares scope with inject.js).
//
// Pure page-parsing. Reads the DOM of the listing detail page the user is
// *already* viewing — no network requests, no scraping — and returns a plain
// object. Exposes EmlakTakipCapture on the content-script global for inject.js.
//
// Robustness strategy: the parts least likely to break are derived from the URL
// slug and <meta> tags (title/image/id/category/type). DOM selectors for price,
// location and the attribute list are the most likely to need tweaking if the
// site changes its markup — they live in SELECTORS below so they're easy to
// adjust, and each has a fallback.

(function () {
  const CATEGORIES = { konut: "konut", ticari: "ticari", arsa: "arsa" };
  const TYPES = { satilik: "satilik", kiralik: "kiralik" };

  // Adjust here if the site changes its markup.
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
  };

  const CURRENCY_RE = /(\d[\d.\s]*\d|\d)\s*(TL|₺|USD|\$|EUR|€)/;

  function first(selList, root = document) {
    for (const sel of selList) {
      const el = root.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function meta(names) {
    for (const name of names) {
      const el = document.querySelector(
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

  function findPrice() {
    // 1) explicit price node inside the info block
    for (const scopeSel of SELECTORS.priceScope) {
      const scope = document.querySelector(scopeSel);
      if (!scope) continue;
      const node = first(SELECTORS.priceNode, scope);
      if (node) {
        const m = node.textContent.match(CURRENCY_RE);
        if (m) return parsePrice(m[0]);
      }
      // 2) fall back to scanning the whole info block for a currency token
      const m2 = scope.textContent.match(CURRENCY_RE);
      if (m2) return parsePrice(m2[0]);
    }
    return null;
  }

  function parseAttributes() {
    const attrs = {};
    const seen = new Set();
    for (const sel of SELECTORS.infoList) {
      document.querySelectorAll(sel).forEach((li) => {
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

  function parseLocation() {
    let anchors = [];
    for (const sel of SELECTORS.locationLinks) {
      anchors = [...document.querySelectorAll(sel)].map(text).filter(Boolean);
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

  function firstImage() {
    const img = first(SELECTORS.galleryImg);
    return img ? img.src : null;
  }

  function isIlanDetail() {
    return /\/ilan\/[a-z0-9-]+-\d+\/detay/i.test(location.href);
  }

  function captureIlan() {
    if (!isIlanDetail()) return null;
    const url = location.href.split("#")[0];
    const slug = parseSlug(url);
    const attributes = parseAttributes();
    const price = findPrice();

    const ilanNo =
      (attributes["İlan No"] && attributes["İlan No"].replace(/\D/g, "")) ||
      slug.ilanNo;
    if (!ilanNo) return null;

    const title =
      text(first(SELECTORS.title)) || meta(["og:title"]) || document.title;

    return {
      ilanNo,
      url,
      slug: slug.slug,
      title,
      category: slug.category || "diger",
      listingType: slug.listingType,
      price,
      location: parseLocation(),
      attributes,
      thumbnail: meta(["og:image"]) || firstImage(),
      ilanTarihi: attributes["İlan Tarihi"] || null,
      capturedAt: Date.now(),
    };
  }

  self.EmlakTakipCapture = { captureIlan, isIlanDetail };
})();
