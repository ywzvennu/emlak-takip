// Shared JSON-LD extraction used by the SPA-based providers (Hepsiemlak,
// Emlakjet). These sites render client-side, but embed a standardized
// schema.org RealEstateListing/Product block in a
// <script type="application/ld+json">. That is far more stable than CSS
// selectors, so it is the primary parse strategy, with <meta> as a fallback.
//
// Classic script: attaches helpers to the shared global; also side-effect
// importable by tests. Loaded after registry.js and before the providers that
// use it.
(function () {
  const root = typeof self !== "undefined" ? self : globalThis;

  function collect(doc) {
    const out = [];
    doc.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
      let data;
      try {
        data = JSON.parse(s.textContent);
      } catch {
        return;
      }
      const arr = Array.isArray(data)
        ? data
        : data["@graph"]
          ? data["@graph"]
          : [data];
      for (const it of arr) if (it && typeof it === "object") out.push(it);
    });
    return out;
  }

  function typesOf(it) {
    return [].concat(it["@type"] || []).map((x) => String(x).toLowerCase());
  }

  function findType(items, types) {
    const want = new Set(types.map((t) => t.toLowerCase()));
    return items.find((it) => typesOf(it).some((t) => want.has(t))) || null;
  }

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

  function currency(c) {
    const s = String(c || "").toUpperCase();
    if (s === "TRY" || s === "TL") return "TL";
    if (s === "USD") return "USD";
    if (s === "EUR") return "EUR";
    return c || null;
  }

  // Generic TR listing classifier from URL + title text.
  function classifyTr(textStr) {
    const s = (textStr || "").toLowerCase();
    const listingType = /kiral[ıi]k|rent/.test(s)
      ? "kiralik"
      : /sat[ıi]l[ıi]k|sale|for-sale/.test(s)
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
      /daire|konut|residence|home|villa|m[üu]stakil|residential|apart|ev\b/.test(
        s
      )
    )
      category = "konut";
    return { category, listingType };
  }

  function offerOf(listing, items) {
    let o = listing && listing.offers;
    if (Array.isArray(o)) o = o[0];
    if (!o) o = findType(items, ["Offer"]);
    return o || null;
  }

  function contactOf(listing, offer) {
    const seller =
      (offer && (offer.seller || offer.offeredBy)) ||
      (listing && (listing.provider || listing.agent || listing.author)) ||
      null;
    if (!seller) return null;
    const type = String(seller["@type"] || "").toLowerCase();
    const isPerson = type.includes("person");
    const isOrg = type.includes("organization") || type.includes("realestate");
    const phone = seller.telephone ? String(seller.telephone) : null;
    return {
      name: seller.name || null,
      agency: isOrg ? seller.name || null : null,
      phone,
      phones: phone ? [phone] : [],
      type: isPerson ? "sahibinden" : "emlak_ofisi",
      profileUrl: seller.url || null,
    };
  }

  function metaOf(doc, names) {
    for (const n of names) {
      const el = doc.querySelector(`meta[property="${n}"], meta[name="${n}"]`);
      if (el && el.content) return el.content;
    }
    return null;
  }

  // Build a normalized record (minus provider/key) from a page's JSON-LD.
  // opts: { idFromUrl(url), classify(text)=classifyTr }
  function toRecord(doc, url, opts) {
    const classify = opts.classify || classifyTr;
    const items = collect(doc);
    const listing =
      findType(items, [
        "Product",
        "RealEstateListing",
        "Residence",
        "Apartment",
        "House",
        "SingleFamilyResidence",
        "Accommahalletion",
        "Place",
        "Offer",
      ]) || items[0];
    if (!listing) return null;
    const offer = offerOf(listing, items);

    const clean = (url || "").split("#")[0];
    const ilanRaw =
      opts.idFromUrl(clean) ||
      listing.sku ||
      listing.productID ||
      listing.identifier ||
      null;
    if (!ilanRaw) return null;
    const ilanNo = String(ilanRaw).replace(/\D/g, "") || String(ilanRaw);

    const addr = listing.address || {};
    const geoRaw = listing.geo || null;
    const lat = geoRaw ? Number(geoRaw.latitude) : NaN;
    const lng = geoRaw ? Number(geoRaw.longitude) : NaN;
    const geo =
      Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0)
        ? { lat, lng, source: "jsonld" }
        : null;

    const priceVal = offer && offer.price != null ? offer.price : null;
    const price =
      priceVal != null
        ? {
            amount:
              parseInt(String(priceVal).replace(/[^\d]/g, ""), 10) || null,
            currency: currency(offer && offer.priceCurrency),
            raw: String(priceVal),
          }
        : null;

    const attributes = {};
    const ap = listing.additionalProperty;
    if (Array.isArray(ap))
      for (const p of ap)
        if (p && p.name && p.value != null)
          attributes[String(p.name)] = String(p.value);

    const title =
      listing.name || metaOf(doc, ["og:title"]) || doc.title || null;
    const locRaw =
      [addr.addressRegion, addr.addressLocality, addr.streetAddress]
        .filter(Boolean)
        .join(" / ") || null;

    return {
      ilanNo,
      url: clean,
      slug: null,
      title,
      ...classify(`${clean} ${title || ""}`),
      price,
      location: {
        il: addr.addressRegion || null,
        ilce: addr.addressLocality || null,
        mahalle: null,
        raw: locRaw,
      },
      geo,
      attributes,
      contact: contactOf(listing, offer),
      description: listing.description || null,
      photos: allImages(listing.image),
      thumbnail: firstImage(listing.image) || metaOf(doc, ["og:image"]),
      ilanTarihi: listing.datePosted || listing.availabilityStarts || null,
      capturedAt: Date.now(),
    };
  }

  root.EmlakTakipJsonLd = { collect, findType, classifyTr, toRecord };
})();
