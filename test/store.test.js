import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { installChromeMock } from "./helpers/chrome-mock.js";

// store.js reads the global `chrome` lazily inside each function, so a fresh
// mock per test isolates storage state even though the module is cached.
installChromeMock();
const store = await import("../src/lib/store.js");

beforeEach(() => {
  installChromeMock();
});

function payload(overrides = {}) {
  return {
    ilanNo: "12345",
    url: "https://www.sahibinden.com/ilan/emlak-konut-satilik-daire-12345/detay",
    slug: "emlak-konut-satilik-daire",
    title: "3+1 Satılık Daire",
    category: "konut",
    listingType: "satilik",
    price: { amount: 2500000, currency: "TL", raw: "2.500.000 TL" },
    location: { il: "Örnek İl", ilce: "Örnek İlçe", mahalle: "Örnek Mahalle", raw: null },
    attributes: { "m² (Brüt)": "120", "Oda Sayısı": "3+1" },
    thumbnail: "https://img/1.jpg",
    ilanTarihi: "01.07.2026",
    ...overrides,
  };
}

test("upsert creates a record with user-field defaults and initial price point", async () => {
  const { record, created } = await store.upsert(payload());
  assert.equal(created, true);
  assert.equal(record.ilanNo, "12345");
  assert.equal(record.notes, "");
  assert.deepEqual(record.tags, []);
  assert.equal(record.status, "kaydedildi");
  assert.equal(record.priceHistory.length, 1);
  assert.equal(record.priceHistory[0].amount, 2500000);

  const all = await store.getAll();
  assert.equal(all.length, 1);
});

test("upsert refreshes captured fields but preserves user-authored fields", async () => {
  await store.upsert(payload());
  await store.updateRecord("12345", {
    notes: "call agent",
    tags: ["favorite"],
    status: "ilgileniliyor",
  });

  const { record, created } = await store.upsert(
    payload({ title: "Updated title" })
  );
  assert.equal(created, false);
  assert.equal(record.title, "Updated title");
  // user fields survive a re-capture
  assert.equal(record.notes, "call agent");
  assert.deepEqual(record.tags, ["favorite"]);
  assert.equal(record.status, "ilgileniliyor");
});

test("upsert appends a price point only when the price changes", async () => {
  await store.upsert(payload());
  // same price -> no new point
  await store.upsert(payload());
  let rec = await store.getByIlanNo("12345");
  assert.equal(rec.priceHistory.length, 1);

  // changed price -> new point
  await store.upsert(
    payload({ price: { amount: 2400000, currency: "TL", raw: "2.400.000 TL" } })
  );
  rec = await store.getByIlanNo("12345");
  assert.equal(rec.priceHistory.length, 2);
  assert.equal(rec.price.amount, 2400000);
});

test("recordSeen only tracks saved listings and grows price history", async () => {
  // not saved yet
  let res = await store.recordSeen(payload());
  assert.equal(res.tracked, false);

  await store.upsert(payload());
  res = await store.recordSeen(
    payload({ price: { amount: 2300000, currency: "TL", raw: "2.300.000 TL" } })
  );
  assert.equal(res.tracked, true);
  assert.equal(res.priceChanged, true);

  const rec = await store.getByIlanNo("12345");
  assert.equal(rec.priceHistory.length, 2);
  assert.equal(rec.price.amount, 2300000);
});

test("remove deletes by ilanNo", async () => {
  await store.upsert(payload());
  assert.equal(await store.remove("12345"), true);
  assert.equal(await store.remove("12345"), false);
  assert.equal((await store.getAll()).length, 0);
});

test("importListings merges by ilanNo and reports added count", async () => {
  await store.upsert(payload());
  const res = await store.importListings([
    { ilanNo: "12345", notes: "merged note" }, // existing -> merge
    { ilanNo: "99999", title: "Another" }, // new
    { title: "no id, skipped" },
  ]);
  assert.equal(res.total, 2);
  assert.equal(res.added, 1);

  const merged = await store.getByIlanNo("12345");
  assert.equal(merged.notes, "merged note");
});

test("importListings with replace clears existing data first", async () => {
  await store.upsert(payload());
  const res = await store.importListings(
    [{ ilanNo: "77777", title: "Fresh" }],
    {
      replace: true,
    }
  );
  assert.equal(res.total, 1);
  assert.equal(await store.getByIlanNo("12345"), null);
});
