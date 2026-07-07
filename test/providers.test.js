import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const SAHIBINDEN_URL =
  "https://www.sahibinden.com/ilan/emlak-konut-satilik-guzel-daire-1234567/detay";
const HEPSI_URL =
  "https://www.hepsiemlak.com/il-a-ilce-b-mahalle-c-satilik/daire/123456-7";
const EMLAKJET_URL =
  "https://www.emlakjet.com/ilan/ornek-2-1-satilik-daire-1234567";

function fixtureHtml(name) {
  return readFileSync(
    fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)),
    "utf8"
  );
}

await import("../src/providers/registry.js");
await import("../src/providers/util.js");
await import("../src/providers/sahibinden.js");
await import("../src/providers/hepsiemlak.js");
await import("../src/providers/emlakjet.js");
await import("../src/content/capture.js");
const R = globalThis.EmlakTakip;

// Assemble a record the way the content script does. buildRecord is async
// (a provider may pull from an embedded-state source before the field methods).
async function build(url, fixture) {
  const doc = new JSDOM(fixtureHtml(fixture), { url }).window.document;
  const p = R.getProvider(url);
  return { p, rec: p && (await R.buildRecord(p, doc, url)) };
}

test("registry routes each host to its own provider", () => {
  assert.equal(R.getProvider(SAHIBINDEN_URL).id, "sahibinden");
  assert.equal(R.getProvider(HEPSI_URL).id, "hepsiemlak");
  assert.equal(R.getProvider(EMLAKJET_URL).id, "emlakjet");
  assert.equal(R.getProvider("https://www.hepsiemlak.com/il-a-satilik"), null);
  assert.equal(
    R.getProvider("https://www.sahibinden.com/kategori/emlak"),
    null
  );
});

test("sahibinden: full record incl. features (Özellikler)", async () => {
  const { rec } = await build(SAHIBINDEN_URL, "sahibinden-ilan.html");
  assert.equal(rec.provider, "sahibinden");
  assert.equal(rec.ilanNo, "1234567");
  assert.equal(rec.category, "konut");
  assert.equal(rec.listingType, "satilik");
  assert.equal(rec.price.amount, 2750000);
  assert.equal(rec.location.mahalle, "Mahalle C");
  assert.equal(rec.attributes["Oda Sayısı"], "3+1");
  assert.deepEqual(rec.features, {
    Cephe: ["Kuzey", "Güney"],
    "İç Özellikler": ["Ankastre Fırın", "Ebeveyn Banyosu"],
  });
  assert.ok(rec.raw && rec.raw.meta); // meta/JSON-LD kept as raw
});

test("hepsiemlak: everything from the embedded state JSON (no network)", async () => {
  const { rec } = await build(HEPSI_URL, "hepsiemlak-ilan.html");
  assert.equal(rec.provider, "hepsiemlak");
  assert.equal(rec.ilanNo, "123456");
  assert.equal(rec.key, "hepsiemlak:123456");
  assert.equal(rec.title, "Örnek 3+1 Satılık Daire");
  assert.equal(rec.category, "konut");
  assert.equal(rec.listingType, "satilik");
  assert.equal(rec.price.amount, 24100000);
  assert.equal(rec.price.currency, "TL");
  assert.equal(rec.location.il, "İl A");
  assert.equal(rec.location.ilce, "İlçe B");
  assert.equal(rec.location.mahalle, "Mahalle C");
  assert.equal(rec.geo.source, "site");
  assert.ok(Math.abs(rec.geo.lat - 41.0086) < 1e-6);
  assert.equal(rec.attributes["m² (Net)"], "117");
  assert.equal(rec.attributes["Oda Sayısı"], "3+1");
  assert.equal(rec.attributes["Isıtma"], "Kombi");
  assert.equal(rec.attributes["Bina Yaşı"], "1");
  assert.deepEqual(rec.features, {
    "İç Özellikler": ["Ankastre Fırın", "Ebeveyn Banyolu"],
    "Dış Özellikler": ["Otopark"],
    Cephe: ["Kuzey", "Güney"],
  });
  assert.equal(rec.contact.agency, "Örnek Emlak Ofisi");
  assert.equal(rec.contact.name, "Ad Soyad");
  assert.equal(rec.contact.phone, "+905550001122");
  assert.match(rec.description, /Örnek açıklama/);
  assert.deepEqual(rec.photos, [
    "https://image-cdn.hepsiemlak.com/ds01/a/1.jpg",
    "https://image-cdn.hepsiemlak.com/ds01/a/2.jpg",
  ]);
  // full source payload retained
  assert.equal(rec.raw.listingId, "123456-7");
});

test("emlakjet: record from og-meta + breadcrumb", async () => {
  const { rec } = await build(EMLAKJET_URL, "emlakjet-ilan.html");
  assert.equal(rec.provider, "emlakjet");
  assert.equal(rec.ilanNo, "1234567");
  assert.equal(rec.listingType, "satilik");
  assert.equal(rec.price.amount, 5250000);
  assert.equal(rec.location.ilce, "İlçe B");
  assert.equal(rec.attributes["m²"], "105");
  assert.ok(rec.raw && rec.raw.meta);
});

test("capture dispatcher stamps provider + composite key (async)", async () => {
  const dom = new JSDOM(fixtureHtml("hepsiemlak-ilan.html"), {
    url: HEPSI_URL,
  });
  globalThis.document = dom.window.document;
  globalThis.location = dom.window.location;
  const rec = await globalThis.EmlakTakipCapture.captureIlan();
  assert.equal(rec.provider, "hepsiemlak");
  assert.equal(rec.key, "hepsiemlak:123456");
  assert.equal(globalThis.EmlakTakipCapture.isIlanDetail(), true);
});
