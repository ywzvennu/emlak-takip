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
    provider: "sahibinden",
    ilanNo: "12345",
    key: "sahibinden:12345",
    url: "https://www.sahibinden.com/ilan/emlak-konut-satilik-daire-12345/detay",
    slug: "emlak-konut-satilik-daire",
    title: "3+1 Satılık Daire",
    category: "konut",
    listingType: "satilik",
    price: { amount: 2500000, currency: "TL", raw: "2.500.000 TL" },
    location: { il: "İl A", ilce: "İlçe B", mahalle: "Mahalle C", raw: null },
    attributes: { "m² (Brüt)": "120", "Oda Sayısı": "3+1" },
    thumbnail: "https://img/1.jpg",
    ilanTarihi: "01.07.2026",
    ...overrides,
  };
}

test("upsert creates a record with user-field defaults and initial price point", async () => {
  const { record, created } = await store.upsert(payload());
  assert.equal(created, true);
  assert.equal(record.key, "sahibinden:12345");
  assert.equal(record.provider, "sahibinden");
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
  await store.updateByKey("sahibinden:12345", {
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
  let rec = await store.getByKey("sahibinden:12345");
  assert.equal(rec.priceHistory.length, 1);

  // changed price -> new point
  await store.upsert(
    payload({ price: { amount: 2400000, currency: "TL", raw: "2.400.000 TL" } })
  );
  rec = await store.getByKey("sahibinden:12345");
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

  const rec = await store.getByKey("sahibinden:12345");
  assert.equal(rec.priceHistory.length, 2);
  assert.equal(rec.price.amount, 2300000);
});

test("removeByKey deletes by composite key", async () => {
  await store.upsert(payload());
  assert.equal(await store.removeByKey("sahibinden:12345"), true);
  assert.equal(await store.removeByKey("sahibinden:12345"), false);
  assert.equal((await store.getAll()).length, 0);
});

test("same ilanNo on different providers does not collide", async () => {
  await store.upsert(payload({ provider: "sahibinden", key: undefined }));
  await store.upsert(
    payload({ provider: "hepsiemlak", key: undefined, title: "Other site" })
  );

  const all = await store.getAll();
  assert.equal(all.length, 2);
  assert.equal(
    (await store.getByKey("sahibinden:12345")).title,
    "3+1 Satılık Daire"
  );
  assert.equal((await store.getByKey("hepsiemlak:12345")).title, "Other site");
});

test("normalize backfills provider and key on legacy records", () => {
  const legacy = { ilanNo: "999", title: "old" }; // no provider/key
  const migrated = store.normalize(legacy);
  assert.equal(migrated.provider, "sahibinden");
  assert.equal(migrated.key, "sahibinden:999");
});

test("legacy records without key are keyed and updatable after read", async () => {
  const { backing } = installChromeMock();
  backing.ilanlar = [{ ilanNo: "555", title: "legacy", status: "kaydedildi" }];

  const rec = await store.getByKey("sahibinden:555");
  assert.ok(rec, "legacy record found by derived key");
  const updated = await store.updateByKey("sahibinden:555", {
    status: "elendi",
  });
  assert.equal(updated.status, "elendi");
});

test("importListings merges by key and reports added count", async () => {
  await store.upsert(payload());
  const res = await store.importListings([
    { ilanNo: "12345", provider: "sahibinden", notes: "merged note" }, // existing
    { ilanNo: "99999", provider: "sahibinden", title: "Another" }, // new
    { title: "no id, skipped" },
  ]);
  assert.equal(res.total, 2);
  assert.equal(res.added, 1);

  const merged = await store.getByKey("sahibinden:12345");
  assert.equal(merged.notes, "merged note");
});

test("importListings with replace clears existing data first", async () => {
  await store.upsert(payload());
  const res = await store.importListings(
    [{ ilanNo: "77777", provider: "sahibinden", title: "Fresh" }],
    { replace: true }
  );
  assert.equal(res.total, 1);
  assert.equal(await store.getByKey("sahibinden:12345"), null);
});

test("storage area defaults to local", async () => {
  assert.equal(await store.getStorageArea(), "local");
});

test("setStorageArea moves data to sync (sharded) and reads follow the area", async () => {
  const { localBacking, syncBacking } = installChromeMock();
  await store.upsert(payload({ raw: { big: "payload" } }));

  const res = await store.setStorageArea("sync");
  assert.equal(res.area, "sync");
  assert.equal(res.moved, 1);
  assert.equal(await store.getStorageArea(), "sync");

  // sync is sharded: an index + one item per record; local copy is gone
  assert.deepEqual(syncBacking["ilan_index"], ["sahibinden:12345"]);
  assert.ok(syncBacking["ilan:sahibinden:12345"]);
  assert.equal(syncBacking["ilan:sahibinden:12345"].raw, undefined); // raw dropped
  assert.equal(localBacking.ilanlar, undefined);
  assert.equal((await store.getAll()).length, 1);

  // a subsequent write goes to the sync shard
  await store.updateByKey("sahibinden:12345", { status: "elendi" });
  assert.equal(syncBacking["ilan:sahibinden:12345"].status, "elendi");
});

test("sharded sync fits records a single blob would exceed", async () => {
  installChromeMock({ syncItemLimit: 2000 }); // per-item cap
  await store.setStorageArea("sync");
  for (let i = 0; i < 5; i++) {
    await store.upsert(payload({ ilanNo: String(i), key: undefined }));
  }
  const all = await store.getAll();
  assert.equal(all.length, 5); // combined > 2000B, but each shard fits
});

test("removing a record drops its sync shard", async () => {
  const { syncBacking } = installChromeMock();
  await store.setStorageArea("sync");
  await store.upsert(payload());
  assert.ok(syncBacking["ilan:sahibinden:12345"]);
  await store.removeByKey("sahibinden:12345");
  assert.equal(syncBacking["ilan:sahibinden:12345"], undefined);
  assert.deepEqual(syncBacking["ilan_index"], []);
});

test("setStorageArea falls back to local when data exceeds the sync quota", async () => {
  installChromeMock({ syncItemLimit: 100 }); // tiny per-item limit
  await store.upsert(payload());

  const res = await store.setStorageArea("sync");
  assert.equal(res.area, "local");
  assert.ok(res.error, "an error is reported");

  // nothing lost: still on local, still readable
  assert.equal(await store.getStorageArea(), "local");
  assert.equal((await store.getAll()).length, 1);
});

test("theme defaults to system and setTheme validates + persists", async () => {
  assert.equal(await store.getTheme(), "system");
  assert.equal(await store.setTheme("dark"), "dark");
  assert.equal(await store.getTheme(), "dark");
  // unknown value falls back to system
  assert.equal(await store.setTheme("neon"), "system");
  assert.equal(await store.getTheme(), "system");
});

test("changing the storage area does not clobber the theme setting", async () => {
  await store.setTheme("dark");
  await store.upsert(payload());
  await store.setStorageArea("sync");
  assert.equal(await store.getStorageArea(), "sync");
  assert.equal(await store.getTheme(), "dark");
});

test("auto-save defaults off, persists, and coexists with other settings", async () => {
  assert.equal(await store.getAutoSave(), false);
  await store.setTheme("dark");
  assert.equal(await store.setAutoSave(true), true);
  assert.equal(await store.getAutoSave(), true);
  // did not clobber theme
  assert.equal(await store.getTheme(), "dark");
});
