import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

// Real hepsiemlak detail-page captures, gitignored under test/.live/hepsiemlak/
// (they carry live PII). Each case self-skips when its capture is absent (fresh
// clone / CI), so the suite only runs where the files exist. Hepsiemlak detail
// pages are server-side rendered — the listing data is embedded in the served
// HTML (.property-spec-table + JSON-LD + window.__NUXT__) — so a saved page is a
// valid offline fixture and the provider reads it with no network.
const LIVE_DIR = fileURLToPath(new URL("./.live/hepsiemlak/", import.meta.url));

await import("../src/providers/registry.js");
await import("../src/providers/util.js");
await import("../src/providers/hepsiemlak.js");
const R = globalThis.EmlakTakip;

// Ground truth read off the captures. Hepsiemlak encodes devren in the url type
// segment and only for ticari — there is no konut-devren (unlike sahibinden).
const CASES = {
  "arsa-kiralik.html": {
    ilanNo: "146865-495",
    category: "arsa",
    type: "kiralik",
    price: 19000,
    il: "Konya",
  },
  "arsa-satilik.html": {
    ilanNo: "68322-438",
    category: "arsa",
    type: "satilik",
    price: 325000,
    il: "İzmir",
  },
  "konut-kiralik.html": {
    ilanNo: "1100-13185",
    category: "konut",
    type: "kiralik",
    price: 87000,
    il: "İstanbul",
  },
  "konut-satilik.html": {
    ilanNo: "147709-91",
    category: "konut",
    type: "satilik",
    price: 4700000,
    il: "İstanbul",
  },
  "ticari-devren-kiralik.html": {
    ilanNo: "161395-81",
    category: "ticari",
    type: "devren-kiralik",
    price: 505000,
    il: "Balıkesir",
  },
  "ticari-devren-satilik.html": {
    ilanNo: "111975-143",
    category: "ticari",
    type: "devren-satilik",
    price: 1650000,
    il: "İstanbul",
  },
  "ticari-kiralik.html": {
    ilanNo: "147709-93",
    category: "ticari",
    type: "kiralik",
    price: 33000,
    il: "İstanbul",
  },
  "ticari-satilik.html": {
    ilanNo: "57563-49",
    category: "ticari",
    type: "satilik",
    price: 11500000,
    il: "Aydın",
  },
};

for (const [file, want] of Object.entries(CASES)) {
  const path = LIVE_DIR + file;
  const opts = existsSync(path)
    ? {}
    : { skip: "local capture absent (test/.live is gitignored)" };

  test(`hepsiemlak live: ${file}`, opts, async () => {
    const html = readFileSync(path, "utf8");
    const url =
      (html.match(/rel="canonical"[^>]*href="([^"]*)"/) || [])[1] ||
      `https://www.hepsiemlak.com/x/${want.ilanNo}`;
    const provider = R.getProvider(url);
    assert.equal(provider && provider.id, "hepsiemlak");

    const doc = new JSDOM(html, { url }).window.document;
    const rec = await R.buildRecord(provider, doc, url);

    assert.equal(rec.ilanNo, want.ilanNo);
    assert.equal(rec.category, want.category);
    assert.equal(rec.listingType, want.type);
    assert.equal(rec.devren, want.type.startsWith("devren-"));
    assert.equal(rec.price && rec.price.amount, want.price);
    assert.equal(rec.price && rec.price.currency, "TL");

    // location comes from the .detail-info-location block (il / ilçe / mahalle)
    assert.equal(rec.location.il, want.il);
    assert.ok(rec.location.ilce, "ilçe resolved");
    assert.ok(rec.location.mahalle, "mahalle resolved");

    // attributes mined from the .property-spec-table
    assert.ok(Object.keys(rec.attributes).length >= 5, "attributes populated");
    // areas type cleanly (the "m2" unit doesn't leak into the number)
    for (const k of ["m²", "m² (Brüt)", "m² (Net)"])
      if (k in rec.attributesTyped)
        assert.ok(
          Number.isInteger(rec.attributesTyped[k]) &&
            rec.attributesTyped[k] < 100000,
          `${k} typed sanely`
        );

    // contact: agency + agent name + a 10-digit phone, no API needed
    assert.ok(rec.contact, "contact resolved");
    assert.ok(rec.contact.agency, "agency");
    assert.ok(rec.contact.agentName, "agent name");
    assert.match(rec.contact.phone || "", /^\d{10}$/, "10-digit phone");

    assert.ok(rec.title, "title");
    assert.ok(rec.description, "description");
    assert.ok(rec.photos.length >= 1, "photos");
    assert.ok(rec.ilanTarihiTs, "listing date parsed");
  });
}
