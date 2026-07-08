import { test } from "node:test";
import assert from "node:assert/strict";

// util.js is a classic script that attaches EmlakTakipUtil to the global.
await import("../src/providers/util.js");
const U = globalThis.EmlakTakipUtil;

test("parseTrDate parses Turkish long and dotted dates (UTC)", () => {
  assert.equal(U.parseTrDate("26 Haziran 2026"), Date.UTC(2026, 5, 26));
  assert.equal(U.parseTrDate("6 Temmuz 2026"), Date.UTC(2026, 6, 6));
  assert.equal(U.parseTrDate("01.07.2026"), Date.UTC(2026, 6, 1));
  assert.equal(U.parseTrDate("Ağustos 2026"), null); // no day
  assert.equal(U.parseTrDate(""), null);
  assert.equal(U.parseTrDate(null), null);
});

test("typeAttributes coerces per-key, resolving the ambiguous dot", () => {
  const typed = U.typeAttributes({
    "m² (Net)": "100",
    "m² Fiyatı": "4.669",
    "Aidat (TL)": "13.000",
    "Depozito (TL)": "Belirtilmemiş",
    "Kaks (Emsal)": "0.75",
    "İlan Tarihi": "26 Haziran 2026",
    Asansör: "Var",
    "Krediye Uygun": "Evet",
    Takas: "Hayır",
    Otopark: "Açık & Kapalı Otopark",
    "Oda Sayısı": "3+1",
    "Bina Yaşı": "11-15 arası",
  });

  // dot-as-thousands (integers) vs dot-as-decimal (floats)
  assert.equal(typed["Aidat (TL)"], 13000);
  assert.equal(typed["m² Fiyatı"], 4669);
  assert.equal(typed["m² (Net)"], 100);
  assert.equal(typed["Kaks (Emsal)"], 0.75);
  // date
  assert.equal(typed["İlan Tarihi"], Date.UTC(2026, 5, 26));
  // booleans
  assert.equal(typed["Asansör"], true);
  assert.equal(typed["Krediye Uygun"], true);
  assert.equal(typed["Takas"], false);
  // "Belirtilmemiş" -> omitted (not typeable)
  assert.ok(!("Depozito (TL)" in typed));
  // descriptive / structured strings stay out of the typed subset
  assert.ok(!("Otopark" in typed));
  assert.ok(!("Oda Sayısı" in typed));
  assert.ok(!("Bina Yaşı" in typed));
});
