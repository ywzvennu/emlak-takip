import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

// Real emlakjet detail-page captures, gitignored under test/.live/emlakjet/
// (they carry live data). Each case self-skips when its capture is absent
// (fresh clone / CI), so the suite only runs where the files exist. Emlakjet's
// detail HTML embeds the JSON-LD the provider reads, so a saved page is a valid
// offline fixture (unlike hepsiemlak, whose data is behind its API).
const LIVE_DIR = fileURLToPath(new URL("./.live/emlakjet/", import.meta.url));

await import("../src/providers/registry.js");
await import("../src/providers/util.js");
await import("../src/providers/emlakjet.js");
const R = globalThis.EmlakTakip;

const CASES = {
  "arsa-satilik.html": {
    ilanNo: "19579244",
    category: "arsa",
    type: "satilik",
    price: 3750000,
    il: "İzmir",
  },
  "konut-kiralik.html": {
    ilanNo: "19580093",
    category: "konut",
    type: "kiralik",
    price: 100000,
    il: "Ankara",
  },
  "konut-satilik.html": {
    ilanNo: "19580206",
    category: "konut",
    type: "satilik",
    price: 5155000,
    il: "Antalya",
  },
};

for (const [file, want] of Object.entries(CASES)) {
  const path = LIVE_DIR + file;
  const opts = existsSync(path)
    ? {}
    : { skip: "local capture absent (test/.live is gitignored)" };

  test(`emlakjet live: ${file}`, opts, async () => {
    const html = readFileSync(path, "utf8");
    const url =
      (html.match(/rel="canonical"[^>]*href="([^"]*)"/) || [])[1] ||
      `https://www.emlakjet.com/ilan/x-${want.ilanNo}`;
    const provider = R.getProvider(url);
    assert.equal(provider && provider.id, "emlakjet");

    const doc = new JSDOM(html, { url }).window.document;
    const rec = await R.buildRecord(provider, doc, url);

    assert.equal(rec.ilanNo, want.ilanNo);
    assert.equal(rec.category, want.category);
    assert.equal(rec.listingType, want.type);
    assert.equal(rec.price && rec.price.amount, want.price);
    // location is the field that used to come back empty — assert it resolves
    assert.equal(rec.location.il, want.il);
    assert.ok(rec.location.ilce, "ilçe resolved");
    assert.ok(rec.location.mahalle, "mahalle resolved");
    assert.ok(rec.location.raw, "location raw");
    // attributes mined from the JSON-LD graph
    assert.ok(Object.keys(rec.attributes).length >= 4, "attributes populated");
    assert.ok(rec.title, "title");
    assert.ok(rec.description, "description");
  });
}
