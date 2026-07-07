import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const SAHIBINDEN_URL =
  "https://www.sahibinden.com/ilan/emlak-konut-satilik-guzel-daire-1234567/detay";
const HEPSI_URL =
  "https://www.hepsiemlak.com/il-ilce-mahalle-satilik/daire/123456-5";
const EMLAKJET_URL =
  "https://www.emlakjet.com/ilan/ornek-2-1-satilik-daire-1234567";

function fixtureHtml(name) {
  return readFileSync(
    fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)),
    "utf8"
  );
}

// Import order mirrors the manifest content_scripts order. Providers register
// themselves onto the shared registry via a side effect on globalThis.
await import("../src/providers/registry.js");
await import("../src/providers/util.js");
await import("../src/providers/sahibinden.js");
await import("../src/providers/hepsiemlak.js");
await import("../src/providers/emlakjet.js");
await import("../src/content/capture.js");
const R = globalThis.EmlakTakip;

// Assemble a record the way the content script does: pick the provider, then
// build from its field methods.
function build(url, fixture) {
  const doc = new JSDOM(fixtureHtml(fixture), { url }).window.document;
  const p = R.getProvider(url);
  return { p, rec: p && R.buildRecord(p, doc, url) };
}

test("registry routes each host to its own provider", () => {
  assert.equal(R.getProvider(SAHIBINDEN_URL).id, "sahibinden");
  assert.equal(R.getProvider(HEPSI_URL).id, "hepsiemlak");
  assert.equal(R.getProvider(EMLAKJET_URL).id, "emlakjet");
  // non-detail pages resolve to no provider
  assert.equal(
    R.getProvider("https://www.hepsiemlak.com/il-satilik"),
    null
  );
  assert.equal(
    R.getProvider("https://www.sahibinden.com/kategori/emlak"),
    null
  );
});

test("sahibinden: full record incl. features (Özellikler)", () => {
  const { rec } = build(SAHIBINDEN_URL, "sahibinden-ilan.html");
  assert.equal(rec.provider, "sahibinden");
  assert.equal(rec.ilanNo, "1234567");
  assert.equal(rec.key, "sahibinden:1234567");
  assert.equal(rec.category, "konut");
  assert.equal(rec.listingType, "satilik");
  assert.equal(rec.title, "Güzel 3+1 Satılık Daire");
  assert.equal(rec.price.amount, 2750000);
  assert.equal(rec.price.currency, "TL");
  assert.equal(rec.location.il, "Örnek İl");
  assert.equal(rec.location.mahalle, "Örnek Mahalle");
  assert.equal(rec.attributes["Oda Sayısı"], "3+1");
  assert.equal(rec.geo.source, "map-attr");
  assert.equal(rec.contact.agency, "Örnek Emlak Ofisi");
  assert.deepEqual(rec.contact.phones, ["5321112233"]);
  assert.match(rec.description, /Deniz manzaralı/);
  assert.deepEqual(rec.photos, [
    "https://cdn.sahibinden.com/p1.jpg",
    "https://cdn.sahibinden.com/p2.jpg",
  ]);
  // the Özellikler checkbox groups, selected items only
  assert.deepEqual(rec.features, {
    Cephe: ["Doğu", "Güney"],
    "İç Özellikler": ["Ankastre Fırın", "Ebeveyn Banyosu"],
  });
});

test("hepsiemlak: id read after a slash, record from JSON-LD", () => {
  const { rec } = build(HEPSI_URL, "hepsiemlak-ilan.html");
  assert.equal(rec.provider, "hepsiemlak");
  assert.equal(rec.ilanNo, "123456"); // /daire/123456-5 -> 123456
  assert.equal(rec.category, "konut");
  assert.equal(rec.listingType, "satilik");
  assert.equal(rec.price.amount, 4750000);
  assert.equal(rec.price.currency, "TL");
  assert.equal(rec.geo.source, "jsonld");
  assert.equal(rec.contact.agency, "Örnek Emlak Ofisi");
  assert.equal(rec.attributes["Oda Sayısı"], "3+1");
  assert.deepEqual(rec.features, {}); // this site has no features section
});

test("emlakjet: record from og-meta + breadcrumb (no Product JSON-LD)", () => {
  const { rec } = build(EMLAKJET_URL, "emlakjet-ilan.html");
  assert.equal(rec.provider, "emlakjet");
  assert.equal(rec.ilanNo, "1234567");
  assert.equal(rec.category, "konut");
  assert.equal(rec.listingType, "satilik");
  assert.equal(rec.price.amount, 5250000); // "5,250,000 TL" from og
  assert.equal(rec.price.currency, "TL");
  assert.equal(rec.location.il, "Örnek İl");
  assert.equal(rec.location.ilce, "Örnek İlçe");
  assert.equal(rec.location.mahalle, "Örnek Mahallesi");
  assert.equal(rec.attributes["m²"], "105");
  assert.equal(rec.attributes["Oda Sayısı"], "2+1");
  assert.equal(rec.thumbnail, "https://img.example.test/1234567.jpg");
});

test("capture dispatcher stamps provider + composite key", () => {
  const dom = new JSDOM(fixtureHtml("hepsiemlak-ilan.html"), {
    url: HEPSI_URL,
  });
  globalThis.document = dom.window.document;
  globalThis.location = dom.window.location;
  const rec = globalThis.EmlakTakipCapture.captureIlan();
  assert.equal(rec.provider, "hepsiemlak");
  assert.equal(rec.key, "hepsiemlak:123456");
  assert.equal(globalThis.EmlakTakipCapture.isIlanDetail(), true);
});
