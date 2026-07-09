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
const U = globalThis.EmlakTakipUtil;

// Offline: the hepsiemlak provider reads its /api/realties endpoint. Feed a
// synthetic response instead of hitting the network, so the API-mapping is
// verified without touching the live site.
const HEPSI_API = JSON.parse(fixtureHtml("hepsiemlak-api.json"));
U.fetchJson = async (url) =>
  /hepsiemlak\.com\/api\/realties\//.test(url) ? HEPSI_API : null;

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
  assert.equal(rec.baseCategory, "konut");
  assert.equal(rec.listingType, "satilik");
  assert.equal(rec.devren, false);
  assert.equal(rec.price.amount, 2750000);
  assert.equal(rec.location.mahalle, "Mahalle C");
  assert.equal(rec.attributes["Oda Sayısı"], "3+1");
  assert.deepEqual(rec.features, {
    Cephe: ["Kuzey", "Güney"],
    "İç Özellikler": ["Ankastre Fırın", "Ebeveyn Banyosu"],
  });
  assert.ok(rec.raw && rec.raw.meta); // meta/JSON-LD kept as raw
});

test("sahibinden: devren is its own category, base type kept separately", async () => {
  const url =
    "https://www.sahibinden.com/ilan/emlak-is-yeri-devren-kiralik-ornek-7654321/detay";
  const { rec } = await build(url, "sahibinden-ilan.html");
  assert.equal(rec.ilanNo, "7654321");
  assert.equal(rec.category, "devren");
  assert.equal(rec.baseCategory, "ticari");
  assert.equal(rec.listingType, "kiralik");
  assert.equal(rec.devren, true);
});

test("sahibinden: media() reads video JSON-LD + tab availability", () => {
  const P = R.getProvider(SAHIBINDEN_URL);
  const ld = JSON.stringify({
    "@type": "VideoObject",
    embedUrl: "https://cdn.example/x.m3u8",
    thumbnailUrl: ["https://cdn.example/t.jpg"],
    uploadDate: "2026-06-14T22:48:20+03:00",
  });
  const html =
    '<ul class="classifiedDetailMegaVideo">' +
    '<li><a class="megaPhotoLink">Foto</a></li>' +
    '<li class="passive"><a class="photo-clip-link">İlan Klibi</a></li>' +
    '<li><a class="videoLink trackClick">Video</a></li>' +
    '<li><a class="virtualTourLink passive">Sanal Tur</a></li>' +
    "</ul>" +
    `<script type="application/ld+json">${ld}</script>`;
  const doc = new JSDOM(html, { url: SAHIBINDEN_URL }).window.document;
  const m = P.media(doc);
  assert.equal(m.hasVideo, true);
  assert.equal(m.hasIlanKlibi, false); // wrapper is passive
  assert.equal(m.hasVirtualTour, false); // link is passive
  assert.equal(m.hasSahiDeko, false);
  assert.equal(m.video.url, "https://cdn.example/x.m3u8");
  assert.equal(m.video.thumbnail, "https://cdn.example/t.jpg");
  assert.equal(m.video.uploadDate, "2026-06-14T22:48:20+03:00");
});

test("sahibinden: contact separates agent from agency + labelled phones", () => {
  const P = R.getProvider(SAHIBINDEN_URL);
  const html =
    '<div class="user-info-module">' +
    '<div class="user-info-store-name">REMAX ÖRNEK</div>' +
    "<h3>Ayşe Yılmaz</h3>" +
    '<div class="user-info-phones"><dl>' +
    '<div class="dl-group"><dt>İş</dt><dd>0 (212) 111 22 33</dd></div>' +
    '<div class="dl-group"><dt>Cep</dt><dd>0 (532) 444 55 66</dd></div>' +
    "</dl></div></div>";
  const doc = new JSDOM(html, { url: SAHIBINDEN_URL }).window.document;
  const c = P.contact(doc);
  assert.equal(c.type, "emlak_ofisi");
  assert.equal(c.agency, "REMAX ÖRNEK");
  assert.equal(c.agentName, "Ayşe Yılmaz");
  assert.deepEqual(c.phones, [
    { type: "is", number: "2121112233" },
    { type: "cep", number: "5324445566" },
  ]);
  assert.equal(c.phone, "5324445566"); // primary prefers the mobile (Cep)
});

test("sahibinden: individual name from CSS ::before; support line excluded", () => {
  const P = R.getProvider(SAHIBINDEN_URL);
  const html =
    '<div class="classifiedUserBox"><div class="username-info-area">' +
    "<style>.cssX:before {content: 'Ali V.';}</style></div>" +
    '<ul class="classifiedInfoList"><li><strong>7/24 Müşteri Hizmetleri</strong>' +
    "<span>0 850 222 44 44</span></li></ul></div>";
  const doc = new JSDOM(html, { url: SAHIBINDEN_URL }).window.document;
  const c = P.contact(doc);
  assert.equal(c.type, "sahibinden");
  assert.equal(c.agentName, "Ali V.");
  assert.equal(c.agency, null);
  assert.equal(c.phones.length, 0); // 0850 support number is not captured
});

test("sahibinden: expired() flags a removed page, never a live one", () => {
  const P = R.getProvider(SAHIBINDEN_URL);
  const removed = new JSDOM(
    "<h1>Bu ilan yayından kaldırılmıştır</h1><p>Başka ilanlara göz atın.</p>",
    { url: SAHIBINDEN_URL }
  ).window.document;
  assert.equal(P.expired(removed), true);

  // a live listing page is never flagged, even if some text mentions removal
  const live = new JSDOM(fixtureHtml("sahibinden-ilan.html"), {
    url: SAHIBINDEN_URL,
  }).window.document;
  assert.equal(P.expired(live), false);
});

test("hepsiemlak: maps its /api/realties response (offline)", async () => {
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
