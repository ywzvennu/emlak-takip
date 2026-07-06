import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const URL_DETAIL =
  "https://www.sahibinden.com/ilan/emlak-konut-satilik-guzel-daire-1234567/detay";

function fixtureHtml(name) {
  return readFileSync(
    fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)),
    "utf8"
  );
}

// The provider files register themselves onto the shared registry via a
// side-effect on globalThis (the same object they use as `self` in the
// browser). Import order mirrors the manifest content_scripts order.
await import("../src/providers/registry.js");
await import("../src/providers/sahibinden.js");
const registry = globalThis.EmlakTakip;

test("registry resolves sahibinden for a listing detail URL", () => {
  const p = registry.getProvider(URL_DETAIL);
  assert.ok(p);
  assert.equal(p.id, "sahibinden");
});

test("registry returns null for non-listing sahibinden URLs", () => {
  assert.equal(
    registry.getProvider("https://www.sahibinden.com/kategori/emlak"),
    null
  );
});

test("sahibinden.parse extracts the normalized fields", () => {
  const doc = new JSDOM(fixtureHtml("sahibinden-ilan.html"), {
    url: URL_DETAIL,
  }).window.document;
  const rec = registry.getProvider(URL_DETAIL).parse(doc, URL_DETAIL);

  assert.equal(rec.ilanNo, "1234567");
  assert.equal(rec.category, "konut");
  assert.equal(rec.listingType, "satilik");
  assert.equal(rec.title, "Güzel 3+1 Satılık Daire");
  assert.equal(rec.price.amount, 2750000);
  assert.equal(rec.price.currency, "TL");
  assert.equal(rec.location.il, "Örnek İl");
  assert.equal(rec.location.ilce, "Örnek İlçe");
  assert.equal(rec.location.mahalle, "Örnek Mahalle");
  assert.equal(rec.attributes["Oda Sayısı"], "3+1");
  assert.equal(rec.attributes["Isıtma"], "Kombi Doğalgaz");
  // og:image is preferred over the gallery <img>
  assert.equal(rec.thumbnail, "https://cdn.sahibinden.com/photo1.jpg");
});

// End-to-end through the generic dispatcher, which stamps provider + key.
test("capture dispatcher stamps provider and composite key", async () => {
  const dom = new JSDOM(fixtureHtml("sahibinden-ilan.html"), {
    url: URL_DETAIL,
  });
  globalThis.document = dom.window.document;
  globalThis.location = dom.window.location;
  await import("../src/content/capture.js");

  const rec = globalThis.EmlakTakipCapture.captureIlan();
  assert.equal(rec.provider, "sahibinden");
  assert.equal(rec.key, "sahibinden:1234567");
  assert.equal(rec.ilanNo, "1234567");
});
