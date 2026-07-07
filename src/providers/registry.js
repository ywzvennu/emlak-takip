// Provider registry + generic record assembler, shared via the content-script
// global. Loaded first; each provider registers itself, and capture.js builds a
// record by calling the provider's field methods over the fixed FIELDS list.
//
// The provider contract: `id`, `name`, `matches(url)`, and one method per field
// below — each `field(doc, url)` returns that field's value (or nothing, in
// which case the default is used). Same method names for every provider, so
// adding a site is: implement these methods.
(function () {
  const root = typeof self !== "undefined" ? self : globalThis;
  if (root.EmlakTakip && root.EmlakTakip.register) return;

  const FIELDS = [
    "title",
    "category",
    "listingType",
    "price",
    "location",
    "geo",
    "attributes",
    "features",
    "contact",
    "description",
    "photos",
    "thumbnail",
    "ilanTarihi",
  ];

  function defaultFor(field) {
    if (field === "photos") return [];
    if (field === "attributes" || field === "features") return {};
    if (field === "location")
      return { il: null, ilce: null, mahalle: null, raw: null };
    if (field === "category") return "diger";
    return null;
  }

  function call(provider, name, doc, url, data) {
    const fn = provider[name];
    if (typeof fn !== "function") return undefined;
    try {
      return fn.call(provider, doc, url, data);
    } catch {
      return undefined;
    }
  }

  // Assemble the normalized record by calling each field method. If the provider
  // exposes async fetchData(url), its result is fetched once and passed to every
  // field method as the 3rd arg. `raw` keeps the fullest source payload so no
  // detail is lost regardless of the normalized model. Returns null if there's
  // no listing id (i.e. this isn't a detail page). Async.
  async function buildRecord(provider, doc, url) {
    const clean = (url || "").split("#")[0];

    // A provider may declare an ordered list of data sources (each returns a
    // data object or null): e.g. embedded-state (DOM) first, its API as a
    // fallback. The first that yields data is passed to every field method.
    let data = null;
    const sources = Array.isArray(provider.sources)
      ? provider.sources
      : typeof provider.fetchData === "function"
        ? [provider.fetchData]
        : [];
    for (const src of sources) {
      try {
        data = await src.call(provider, doc, clean);
      } catch {
        data = null;
      }
      if (data) break;
    }

    const idRaw = call(provider, "ilanNo", doc, clean, data);
    const ilanNo = idRaw ? String(idRaw) : null;
    if (!ilanNo) return null;

    const rec = {
      provider: provider.id,
      ilanNo,
      key: `${provider.id}:${ilanNo}`,
      url: clean,
      capturedAt: Date.now(),
    };
    for (const f of FIELDS) {
      const v = call(provider, f, doc, clean, data);
      rec[f] = v === undefined || v === null ? defaultFor(f) : v;
    }
    const raw = call(provider, "raw", doc, clean, data);
    rec.raw = raw === undefined ? (data ?? null) : raw;
    return rec;
  }

  const providers = [];
  root.EmlakTakip = {
    providers,
    FIELDS,
    register(provider) {
      providers.push(provider);
    },
    getProvider(url) {
      return providers.find((p) => p.matches(url)) || null;
    },
    buildRecord,
  };
})();
