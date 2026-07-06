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
await import("../src/providers/jsonld.js");
await import("../src/providers/sahibinden.js");
await import("../src/providers/hepsiemlak.js");
await import("../src/providers/emlakjet.js");
await import("../src/content/capture.js");
const registry = globalThis.EmlakTakip;

const HEPSI_URL =
  "https://www.hepsiemlak.com/il-ilce-satilik/daire/ornek-3-1-satilik-daire-11223344";
const EMLAKJET_URL =
  "https://www.emlakjet.com/ilan/il-ilce-kiralik-daire-9988776/";

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

test("sahibinden.parse extracts contact, geo, description and photos", () => {
  const doc = new JSDOM(fixtureHtml("sahibinden-ilan.html"), {
    url: URL_DETAIL,
  }).window.document;
  const rec = registry.getProvider(URL_DETAIL).parse(doc, URL_DETAIL);

  // contact
  assert.equal(rec.contact.agency, "Örnek Emlak Ofisi");
  assert.equal(rec.contact.type, "emlak_ofisi");
  assert.deepEqual(rec.contact.phones, ["5321112233"]);
  assert.equal(rec.contact.phone, "5321112233");
  assert.equal(
    rec.contact.profileUrl,
    "https://www.sahibinden.com/magaza/ornek-emlak"
  );

  // geo
  assert.equal(rec.geo.source, "map-attr");
  assert.ok(Math.abs(rec.geo.lat - 10.0) < 1e-6);
  assert.ok(Math.abs(rec.geo.lng - 20.0) < 1e-6);

  // description + photos
  assert.match(rec.description, /Deniz manzaralı/);
  assert.deepEqual(rec.photos, [
    "https://cdn.sahibinden.com/p1.jpg",
    "https://cdn.sahibinden.com/p2.jpg",
  ]);
});

test("parseGeo falls back to a lat/lng pair in an inline script", () => {
  const html = `<!doctype html><html><body>
    <script>var cfg = { "latitude": 10.0, "longitude": 20.0 };</script>
  </body></html>`;
  const doc = new JSDOM(html, { url: URL_DETAIL }).window.document;
  const rec = registry.getProvider(URL_DETAIL).parse(doc, URL_DETAIL);
  assert.equal(rec.geo.source, "script");
  assert.ok(Math.abs(rec.geo.lat - 10.0) < 1e-6);
  assert.ok(Math.abs(rec.geo.lng - 20.0) < 1e-6);
});

test("registry routes each host to its own provider", () => {
  assert.equal(registry.getProvider(HEPSI_URL).id, "hepsiemlak");
  assert.equal(registry.getProvider(EMLAKJET_URL).id, "emlakjet");
  assert.equal(registry.getProvider(URL_DETAIL).id, "sahibinden");
  // non-detail pages resolve to no provider
  assert.equal(registry.getProvider("https://www.hepsiemlak.com/"), null);
});

test("hepsiemlak.parse reads schema.org JSON-LD", () => {
  const doc = new JSDOM(fixtureHtml("hepsiemlak-ilan.html"), {
    url: HEPSI_URL,
  }).window.document;
  const rec = registry.getProvider(HEPSI_URL).parse(doc, HEPSI_URL);

  assert.equal(rec.ilanNo, "11223344");
  assert.equal(rec.category, "konut");
  assert.equal(rec.listingType, "satilik");
  assert.equal(rec.title, "Örnek 3+1 Satılık Daire");
  assert.equal(rec.price.amount, 4750000);
  assert.equal(rec.price.currency, "TL");
  assert.equal(rec.location.il, "Örnek İl");
  assert.equal(rec.location.ilce, "Örnek İlçe");
  assert.equal(rec.geo.source, "jsonld");
  assert.ok(Math.abs(rec.geo.lat - 10.0) < 1e-6);
  assert.equal(rec.contact.agency, "Örnek Emlak Ofisi");
  assert.equal(rec.contact.type, "emlak_ofisi");
  assert.equal(rec.contact.phone, "+902161112233");
  assert.equal(rec.attributes["Oda Sayısı"], "3+1");
  assert.deepEqual(rec.photos, [
    "https://img.hepsiemlak.com/a.jpg",
    "https://img.hepsiemlak.com/b.jpg",
  ]);
});

test("emlakjet.parse reads JSON-LD (array + Person seller + numeric price)", () => {
  const doc = new JSDOM(fixtureHtml("emlakjet-ilan.html"), {
    url: EMLAKJET_URL,
  }).window.document;
  const rec = registry.getProvider(EMLAKJET_URL).parse(doc, EMLAKJET_URL);

  assert.equal(rec.ilanNo, "9988776");
  assert.equal(rec.listingType, "kiralik");
  assert.equal(rec.category, "konut");
  assert.equal(rec.price.amount, 32000);
  assert.equal(rec.price.currency, "TL");
  assert.equal(rec.location.ilce, "Örnek İlçe");
  assert.equal(rec.contact.name, "Ad Soyad");
  assert.equal(rec.contact.type, "sahibinden");
  assert.equal(rec.geo.source, "jsonld");
});

test("capture stamps composite keys per provider (no cross-site collision)", async () => {
  const dom = new JSDOM(fixtureHtml("hepsiemlak-ilan.html"), {
    url: HEPSI_URL,
  });
  globalThis.document = dom.window.document;
  globalThis.location = dom.window.location;
  const rec = globalThis.EmlakTakipCapture.captureIlan();
  assert.equal(rec.provider, "hepsiemlak");
  assert.equal(rec.key, "hepsiemlak:11223344");
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
