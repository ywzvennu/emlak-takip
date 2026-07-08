import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

// Real sahibinden detail-page captures, one per category × type. They live
// under test/.live/sahibinden/ and are gitignored — they are actual listings
// (with names/phones) and must never reach the public repo. So each case
// self-skips when its capture is absent (fresh clone, CI), and only runs on a
// machine that has the local files.
const LIVE_DIR = fileURLToPath(new URL("./.live/sahibinden/", import.meta.url));

await import("../src/providers/registry.js");
await import("../src/providers/util.js");
await import("../src/providers/sahibinden.js");
await import("../src/content/capture.js");
const R = globalThis.EmlakTakip;

// filename -> expected fields. ilanNo/category/listingType/price are frozen with
// the capture; the rest of the record is checked for presence/floors below.
// Two of these are targeted regressions:
//   - arsa-kiralik / ticari-satilik have a "." in the slug ("2.240-m2",
//     "14.kat"); the provider must still route them (getProvider != null).
//   - every ticari-* case must resolve category "ticari" (slug token is
//     "is-yeri", not "ticari").
const CASES = {
  "arsa-kiralik.html": {
    ilanNo: "1321745333",
    category: "arsa",
    type: "kiralik",
    price: 260000,
    devren: false,
  }, // dotted slug
  "arsa-satilik.html": {
    ilanNo: "1318432286",
    category: "arsa",
    type: "satilik",
    price: 3600000,
    devren: false,
  },
  "konut-devren-satilik.html": {
    ilanNo: "1327091086",
    category: "konut",
    type: "satilik",
    price: 14750000,
    devren: true,
  },
  "konut-kiralik.html": {
    ilanNo: "1327189715",
    category: "konut",
    type: "kiralik",
    price: 18000,
    devren: false,
  },
  "konut-satilik.html": {
    ilanNo: "1322031369",
    category: "konut",
    type: "satilik",
    price: 22000000,
    devren: false,
  },
  "ticari-devren-kiralik.html": {
    ilanNo: "1327184082",
    category: "ticari",
    type: "kiralik",
    price: 800000,
    devren: true,
  },
  "ticari-devren-satilik.html": {
    ilanNo: "1323033175",
    category: "ticari",
    type: "satilik",
    price: 2050000,
    devren: true,
  },
  "ticari-kiralik.html": {
    ilanNo: "1190119993",
    category: "ticari",
    type: "kiralik",
    price: 130000,
    devren: false,
  },
  "ticari-satilik.html": {
    ilanNo: "1324217390",
    category: "ticari",
    type: "satilik",
    price: 14400000,
    devren: false,
  }, // dotted slug
};

// Media availability per capture (klibi/sahiDeko are all absent in this set).
const MEDIA = {
  "arsa-kiralik.html": { video: false, tour: false },
  "arsa-satilik.html": { video: true, tour: false },
  "konut-devren-satilik.html": { video: false, tour: true },
  "konut-kiralik.html": { video: true, tour: false },
  "konut-satilik.html": { video: true, tour: false },
  "ticari-devren-kiralik.html": { video: true, tour: false },
  "ticari-devren-satilik.html": { video: true, tour: false },
  "ticari-kiralik.html": { video: false, tour: false },
  "ticari-satilik.html": { video: false, tour: false },
};

for (const [file, want] of Object.entries(CASES)) {
  const path = LIVE_DIR + file;
  const opts = existsSync(path)
    ? {}
    : { skip: "local capture absent (test/.live is gitignored)" };

  test(`sahibinden live: ${file}`, opts, async () => {
    const html = readFileSync(path, "utf8");
    const url = (html.match(/rel="canonical"[^>]*href="([^"]*)"/) || [])[1];
    assert.ok(url, "capture must carry a canonical detail URL");

    // Routing: the URL must resolve to the sahibinden provider. Guards the
    // dot-in-slug regression — a "." in the slug used to fail matches().
    const provider = R.getProvider(url);
    assert.equal(
      provider && provider.id,
      "sahibinden",
      `getProvider() returned no provider for ${url}`
    );

    const doc = new JSDOM(html, { url }).window.document;
    const rec = await R.buildRecord(provider, doc, url);

    // Identity + classification (the frozen, high-signal fields).
    assert.equal(rec.provider, "sahibinden");
    assert.equal(rec.ilanNo, want.ilanNo);
    assert.equal(rec.category, want.category);
    assert.equal(rec.listingType, want.type);
    assert.equal(rec.devren, want.devren);
    assert.equal(rec.price && rec.price.amount, want.price);

    // The rest of the field methods should all produce something.
    assert.ok(
      rec.location.il && rec.location.ilce && rec.location.mahalle,
      "location il/ilçe/mahalle all resolved"
    );
    assert.ok(
      rec.geo && Number.isFinite(rec.geo.lat) && Number.isFinite(rec.geo.lng),
      "geo coordinates parsed"
    );
    assert.ok(
      Object.keys(rec.attributes).length >= 5,
      "attribute list populated"
    );
    // Typed layer: İlan Tarihi -> timestamp, and every typed attr is a
    // number/boolean (never a leftover string).
    assert.ok(
      Number.isFinite(rec.ilanTarihiTs),
      "ilanTarihiTs parsed to a timestamp"
    );
    for (const [k, v] of Object.entries(rec.attributesTyped)) {
      assert.ok(
        typeof v === "number" || typeof v === "boolean",
        `attributesTyped[${k}] is number/boolean`
      );
    }
    assert.ok(rec.photos.length >= 1, "at least one photo");
    assert.ok(rec.contact, "contact block present");
    assert.ok(rec.contact.agentName, "agent (person) name captured");
    assert.ok(
      Array.isArray(rec.contact.phones) &&
        rec.contact.phones.every((p) => p && typeof p.number === "string"),
      "phones are structured { type, number }"
    );
    assert.ok(rec.description, "description present");

    // Media availability + video details.
    const media = MEDIA[file];
    assert.equal(rec.media.hasVideo, media.video, "hasVideo");
    assert.equal(rec.media.hasVirtualTour, media.tour, "hasVirtualTour");
    if (media.video) {
      assert.ok(
        rec.media.video && rec.media.video.url && rec.media.video.uploadDate,
        "uploaded-video details present"
      );
    }
  });
}
