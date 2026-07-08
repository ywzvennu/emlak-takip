// Sahibinden.com provider adapter — server-rendered, parsed via DOM selectors.
// Implements the field-method contract (see registry.js). Selectors that are
// most likely to drift live in SELECTORS; each field method is small and
// independent, so a broken selector only affects its own field.
(function () {
  const root = typeof self !== "undefined" ? self : globalThis;
  const U = root.EmlakTakipUtil;

  const CATEGORIES = { konut: "konut", ticari: "ticari", arsa: "arsa" };
  const TYPES = { satilik: "satilik", kiralik: "kiralik" };
  // Slugs may contain "." (e.g. "14.kat", "2.240-m2"), so the char class must
  // allow it — otherwise those listings fail matches() and never get captured.
  const DETAIL_RE = /\/ilan\/[a-z0-9.-]+-\d+\/detay/i;
  // Commercial listings use the "is-yeri" slug token, not "ticari".
  const IS_YERI_RE = /(?:^|-)is-yeri(?:-|$)/;

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
    propsBox: [
      "#classifiedProperties",
      ".classifiedProperties",
      '[class*="classifiedProperties"]',
    ],
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
    contactStoreLink: [
      ".user-info-agency-name a",
      "a.storeName",
      'a[href*="/magaza/"]',
    ],
    mapEl: [
      "[data-lat][data-lon]",
      "[data-lat][data-lng]",
      "#gmap",
      ".classifiedGmap",
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

  const PHONE_RE =
    /(?:\+?90[\s-]?)?(?:0[\s-]?)?\(?\d{3}\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}/g;

  const slugMatch = (url) => url.match(/\/ilan\/([a-z0-9.-]+?)-(\d+)\/detay/i);

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

  function validCoord(lat, lng) {
    return (
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      Math.abs(lat) <= 90 &&
      Math.abs(lng) <= 180 &&
      !(lat === 0 && lng === 0)
    );
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

    ilanNo(doc, url) {
      const m = slugMatch(url);
      if (m) return m[2];
      const a = this.attributes(doc, url);
      return a["İlan No"] ? a["İlan No"].replace(/\D/g, "") : null;
    },

    title(doc) {
      return U.text(U.q(doc, SELECTORS.title)) || U.ogTitle(doc) || doc.title;
    },

    category(doc, url) {
      const m = slugMatch(url);
      if (m) {
        if (IS_YERI_RE.test(m[1])) return "ticari";
        for (const p of m[1].split("-"))
          if (CATEGORIES[p]) return CATEGORIES[p];
      }
      return "diger";
    },

    listingType(doc, url) {
      const m = slugMatch(url);
      if (m) for (const p of m[1].split("-")) if (TYPES[p]) return TYPES[p];
      return null;
    },

    price(doc) {
      for (const scopeSel of SELECTORS.priceScope) {
        const scope = doc.querySelector(scopeSel);
        if (!scope) continue;
        const node = U.q(scope, SELECTORS.priceNode);
        const src = (node && node.textContent) || scope.textContent;
        const p = U.parsePriceText(src);
        if (p) return p;
      }
      return null;
    },

    location(doc) {
      let anchors = [];
      for (const sel of SELECTORS.locationLinks) {
        anchors = U.qa(doc, sel).map(U.text).filter(Boolean);
        if (anchors.length) break;
      }
      const [il, ilce, mahalle] = anchors;
      return {
        il: il || null,
        ilce: ilce || null,
        mahalle: mahalle || null,
        raw: anchors.join(" / ") || null,
      };
    },

    geo(doc) {
      const el = U.q(doc, SELECTORS.mapEl);
      if (el) {
        const lat = parseFloat(el.getAttribute("data-lat"));
        const lng = parseFloat(
          el.getAttribute("data-lon") ?? el.getAttribute("data-lng")
        );
        if (validCoord(lat, lng)) return { lat, lng, source: "map-attr" };
      }
      for (const s of U.qa(doc, "script")) {
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
    },

    attributes(doc) {
      const attrs = {};
      const seen = new Set();
      for (const sel of SELECTORS.infoList) {
        U.qa(doc, sel).forEach((li) => {
          const strong = li.querySelector("strong");
          const span = li.querySelector("span");
          if (!strong || !span) return;
          const k = U.text(strong).replace(/:$/, "");
          const v = U.text(span);
          if (k && v && !seen.has(k)) {
            attrs[k] = v;
            seen.add(k);
          }
        });
        if (Object.keys(attrs).length) break;
      }
      return attrs;
    },

    // The "Özellikler" section: groups (Cephe, İç/Dış Özellikler, Muhit, …)
    // each with checkbox items; the selected ones carry class "selected".
    features(doc) {
      const box = U.q(doc, SELECTORS.propsBox);
      if (!box) return {};
      const out = {};
      box.querySelectorAll("h3").forEach((h) => {
        const name = U.text(h);
        const ul = h.nextElementSibling;
        if (!name || !ul) return;
        const sel = [...ul.querySelectorAll("li.selected")]
          .map(U.text)
          .filter(Boolean);
        if (sel.length) out[name] = sel;
      });
      return out;
    },

    contact(doc) {
      const box = U.q(doc, SELECTORS.contactBox);
      const name = U.text(U.q(box || doc, SELECTORS.contactName));
      const storeLink = U.q(box || doc, SELECTORS.contactStoreLink);
      const profileUrl = storeLink && storeLink.href ? storeLink.href : null;
      const phones = extractPhones(box ? box.textContent : "");
      const isStore = !!(storeLink || name);
      if (!name && !phones.length && !profileUrl) return null;
      return {
        name: name || null,
        agency: isStore ? name : null,
        phone: phones[0] || null,
        phones,
        type: isStore ? "emlak_ofisi" : "sahibinden",
        profileUrl,
      };
    },

    description(doc) {
      const el = U.q(doc, SELECTORS.description);
      if (!el) return null;
      const t = el.textContent
        .replace(/[ \t\u00a0]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      return t || null;
    },

    photos(doc) {
      const urls = new Set();
      for (const sel of SELECTORS.photoImgs) {
        U.qa(doc, sel).forEach((img) => {
          const src =
            img.getAttribute("data-src") ||
            img.getAttribute("data-lazy") ||
            img.src;
          if (src && /^https?:/.test(src)) urls.add(src);
        });
        if (urls.size) break;
      }
      return [...urls];
    },

    thumbnail(doc) {
      return U.ogImage(doc) || this.photos(doc)[0] || null;
    },

    ilanTarihi(doc, url) {
      return this.attributes(doc, url)["İlan Tarihi"] || null;
    },
    // Sahibinden is fully DOM-mapped above; keep meta + JSON-LD as extra raw.
    raw: (doc) => U.rawSignals(doc),
  };

  if (root.EmlakTakip && root.EmlakTakip.register)
    root.EmlakTakip.register(provider);
  root.EmlakTakipSahibinden = provider;
})();
