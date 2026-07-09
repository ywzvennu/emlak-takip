// Hepsiemlak.com provider — detail pages are server-side rendered (Nuxt): the
// listing data is embedded in the served HTML, so we read it straight from the
// DOM (no network). Three embedded sources are combined:
//   - the visible `.property-spec-table` (attributes, İlan no, İlan Durumu, date)
//   - the `.detail-info-location` block, `.firm-*` card and `tel:` link
//   - the RealEstateListing JSON-LD (photos) and the `window.__NUXT__` state blob
//     (the authoritative `mainCategory` name, and map coordinates when present)
// The old /api/realties fetch is gone — it was Cloudflare-gated to non-browser
// requests and made the provider impossible to verify offline.
(function () {
  const root = typeof self !== "undefined" ? self : globalThis;
  const U = root.EmlakTakipUtil;
  const HOST = /^https?:\/\/(www\.)?hepsiemlak\.com\//i;
  // Detail URLs end in the listing id "<num>-<num>" (e.g. .../daire/147709-91).
  const DETAIL_RE = /\/\d+-\d+(?:[/?#]|$)/;

  // Spec-table rows we don't surface as attributes: the id and listing status are
  // modelled elsewhere (ilanNo / listingType), the update date becomes ilanTarihi.
  const SKIP_SPEC = new Set([
    "İlan no",
    "İlan No",
    "İlan Durumu",
    "Son Güncelleme",
  ]);

  // Read the `.property-spec-table` into a raw { label: value } map. The label
  // lives in a tooltip-wrapper <div> inside the <th>; the value is a `.value-txt`
  // span, a <time>, or an <a> inside the <td> — textContent covers all three.
  // Long labels render truncated ("Metrekare Birim…") followed by the full
  // tooltip text, so keep only the part after the ellipsis.
  const cellKey = (th) => {
    const parts = U.text(th).split(/\.\.\.|…/);
    return parts[parts.length - 1].trim();
  };
  function specRows(doc) {
    const rows = {};
    for (const tr of U.qa(doc, ".property-spec-table tr")) {
      const th = tr.querySelector("th");
      const td = tr.querySelector("td");
      if (!th || !td) continue;
      const k = cellKey(th);
      const v = U.text(td);
      if (k && v && !(k in rows)) rows[k] = v;
    }
    return rows;
  }

  // Digits from an area value, dropping the "m2"/"m²" unit first — otherwise the
  // literal "2" in the ascii "m2" unit gets read as part of the number.
  const areaDigits = (s) =>
    String(s).replace(/m²|m2/gi, "").replace(/[^\d]/g, "");

  // window.__NUXT__ carries mainCategory:{id,name:"Konut"|"Arsa"|"İşyeri"} as a
  // literal — the authoritative property category (slugs like "imarli-konut"
  // (arsa) or "genel"/"kuafor-guzellik-merkezi" (ticari) can't be keyword-guessed).
  function mainCatName(doc) {
    for (const s of U.qa(doc, "script")) {
      const m = (s.textContent || "").match(
        /mainCategory:\s*\{[^}]*name:\s*"([^"]+)"/
      );
      if (m) return m[1];
    }
    return null;
  }
  function catFromName(name) {
    if (!name) return null;
    // Substring checks (no toLowerCase — Turkish "İ".toLowerCase() inserts a
    // combining dot and breaks equality/regex matching).
    if (name.includes("Konut")) return "konut";
    if (name.includes("Arsa")) return "arsa";
    if (
      name.includes("İşyeri") ||
      name.includes("İş") ||
      name.includes("Ticari")
    )
      return "ticari";
    return null;
  }

  // "Satılık" | "Devren Satılık" | "Kiralık" | "Devren Kiralık" (or the url slug)
  // -> satilik | devren-satilik | kiralik | devren-kiralik.
  function typeFromText(s) {
    if (!s) return null;
    const dev = /devren/i.test(s);
    const base = /kiral/i.test(s)
      ? "kiralik"
      : /sat[ıi]l/i.test(s)
        ? "satilik"
        : null;
    return base ? (dev ? `devren-${base}` : base) : null;
  }

  // "tel:+905449439739" -> "5449439739" (national 10-digit form).
  function normPhone(href) {
    if (!href) return null;
    let n = String(href).replace(/\D/g, "");
    if (n.startsWith("90") && n.length === 12) n = n.slice(2);
    if (n.length === 11 && n.startsWith("0")) n = n.slice(1);
    return n.length === 10 ? n : n || null;
  }

  const provider = {
    id: "hepsiemlak",
    name: "Hepsiemlak",
    matches: (url) => HOST.test(url) && DETAIL_RE.test(url),

    // The id is the full "<num>-<num>" last path segment — it equals the spec
    // table's "İlan no". Both parts matter: two listings from one firm can share
    // the first part and differ only in the second (147709-91 vs 147709-93).
    ilanNo(doc, url) {
      const seg = U.lastSegment(url);
      if (/^\d+-\d+$/.test(seg)) return seg;
      return specRows(doc)["İlan no"] || U.urlId(url);
    },

    title(doc) {
      return U.text(U.q(doc, ["h1.detail-title", "h1"])) || U.jTitle(doc);
    },

    category(doc) {
      const fromNuxt = catFromName(mainCatName(doc));
      if (fromNuxt) return fromNuxt;
      const rows = specRows(doc);
      return U.classifyTr(
        `${rows["Konut Tipi"] || ""} ${rows["İşyeri Tipi"] || ""} ${rows["İlan Durumu"] || ""}`
      ).category;
    },

    // Transaction type — devren (business transfer) is part of this dimension,
    // alongside satılık/kiralık. Hepsiemlak encodes it in the url type segment
    // (.../-devren-satilik/<subcat>/<id>) and in the "İlan Durumu" row.
    listingType(doc, url) {
      const m = String(url).match(
        /-(devren-satilik|devren-kiralik|satilik|kiralik)(?:[/?#]|$)/i
      );
      if (m) return m[1].toLowerCase();
      return typeFromText(specRows(doc)["İlan Durumu"]);
    },
    devren(doc, url) {
      const lt = this.listingType(doc, url);
      return !!lt && lt.startsWith("devren-");
    },

    price(doc) {
      const el = U.q(doc, [
        ".price",
        "p.fz24-text",
        ".detail-modal-price-wrap",
      ]);
      return U.parsePriceText(el ? el.textContent : "") || U.jPrice(doc);
    },

    location(doc) {
      const leaves = U.qa(doc, ".detail-info-location *")
        .filter((e) => e.children.length === 0)
        .map(U.text)
        .filter(Boolean)
        .slice(0, 3);
      const [il, ilce, mahalle] = leaves;
      return {
        il: il || null,
        ilce: ilce || null,
        mahalle: mahalle || null,
        raw: leaves.join(" / ") || null,
      };
    },

    geo(doc) {
      for (const s of U.qa(doc, "script")) {
        const m = (s.textContent || "").match(
          /mapLocation:\s*\{\s*lat:\s*(-?\d{1,2}\.\d{3,})\s*,\s*lon:\s*(-?\d{1,3}\.\d{3,})/
        );
        if (m) {
          const lat = Number(m[1]);
          const lng = Number(m[2]);
          if (
            Number.isFinite(lat) &&
            Number.isFinite(lng) &&
            !(lat === 0 && lng === 0)
          )
            return { lat, lng, source: "nuxt" };
        }
      }
      return U.jGeo(doc);
    },

    attributes(doc) {
      const rows = specRows(doc);
      const a = {};
      for (const [k, v] of Object.entries(rows)) {
        if (SKIP_SPEC.has(k)) continue;
        if (k === "Oda Sayısı") {
          a[k] = v.replace(/\s+/g, ""); // "2 + 1" -> "2+1"
        } else if (k === "Brüt / Net M2") {
          const [gross, net] = v.split("/").map(areaDigits);
          if (gross) a["m² (Brüt)"] = gross;
          if (net) a["m² (Net)"] = net;
        } else if (k === "Metrekare") {
          const n = areaDigits(v); // arsa area -> shared "m²" key
          if (n) a["m²"] = n;
        } else if (k === "Isınma Tipi") {
          a["Isıtma"] = v; // align with the shared "Isıtma" attribute key
        } else {
          a[k] = v;
        }
      }
      return a;
    },
    attributesTyped(doc) {
      return U.typeAttributes(this.attributes(doc));
    },

    // Agency (firm) + the individual agent, and the single visible phone. The
    // firm-user line trails a certification blurb ("… Mesleki Yeterlilik Belgesine
    // Sahiptir") — keep only the name before it.
    contact(doc) {
      const agency = U.text(U.q(doc, [".firm-name"])) || null;
      const rawUser = U.text(U.q(doc, [".firm-user-name"]));
      const agentName = rawUser
        ? rawUser.split(/mesleki yeterlilik/i)[0].trim() || null
        : null;
      const tel = U.q(doc, ["a[href^='tel:']"]);
      const phone = normPhone(tel && tel.getAttribute("href"));
      const link = U.q(doc, [".firm-name a", "a.firm-link", ".firm-info a"]);
      const profileUrl = (link && link.href) || null;
      if (!agency && !agentName && !phone) return null;
      return {
        type: agency ? "emlak_ofisi" : "sahibinden",
        agency,
        agentName,
        name: agentName || agency,
        phone,
        phones: phone ? [{ type: null, number: phone }] : [],
        profileUrl,
      };
    },

    description(doc) {
      const el = U.q(doc, [".description-content", ".ql-editor"]);
      if (!el) return U.jDescription(doc);
      const t = el.textContent
        .replace(/[ \t\u00a0]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      return t || null;
    },

    photos(doc) {
      const rel = U.findType(U.jsonld(doc), ["RealEstateListing"]);
      const imgs = U.allImages(rel && rel.about && rel.about.image);
      if (imgs.length) return imgs;
      const urls = new Set();
      for (const img of U.qa(doc, ".gallery img, .swiper-slide img")) {
        const src = img.getAttribute("data-src") || img.src;
        if (src && /^https?:/.test(src)) urls.add(src);
      }
      return [...urls];
    },
    thumbnail(doc) {
      return U.ogImage(doc) || this.photos(doc)[0] || null;
    },

    // Listing media. Uploaded-video details come from a JSON-LD VideoObject; the
    // 360°/virtual-tour badge (when present) sets hasVirtualTour.
    media(doc) {
      const out = {
        video: null,
        hasVideo: false,
        hasIlanKlibi: false,
        hasVirtualTour: false,
        hasSahiDeko: false,
      };
      for (const o of U.jsonld(doc)) {
        const ty = [].concat(o["@type"] || []);
        if (!ty.includes("VideoObject")) continue;
        const thumb = Array.isArray(o.thumbnailUrl)
          ? o.thumbnailUrl[0]
          : o.thumbnailUrl;
        out.video = {
          url: o.embedUrl || o.contentUrl || null,
          thumbnail: thumb || null,
          uploadDate: o.uploadDate || null,
        };
        out.hasVideo = true;
      }
      if (
        U.q(doc, [
          ".video-360",
          "[class*='threeSixty' i]",
          "[class*='sanalTur' i]",
        ])
      )
        out.hasVirtualTour = true;
      return out;
    },

    ilanTarihi(doc) {
      return specRows(doc)["Son Güncelleme"] || U.jDate(doc);
    },
    ilanTarihiTs(doc) {
      return U.parseTrDate(this.ilanTarihi(doc));
    },

    // Removed/expired detection (best-effort, not grounded in a real removed
    // capture): only when the live-listing markers are gone AND a removal notice
    // is present. Fails toward under-firing.
    expired(doc) {
      if (U.q(doc, [".property-spec-table", ".detail-info-location"]))
        return false;
      const txt = (doc.body && doc.body.textContent) || "";
      return /(yay[ıi]nda de[ğg]il|yay[ıi]ndan kald[ıi]r[ıi]l|kald[ıi]r[ıi]lan ilan)/i.test(
        txt
      );
    },

    raw: (doc) => U.rawSignals(doc),
  };

  if (root.EmlakTakip && root.EmlakTakip.register)
    root.EmlakTakip.register(provider);
  root.EmlakTakipHepsiemlak = provider;
})();
