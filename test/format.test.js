import { test } from "node:test";
import assert from "node:assert/strict";
import { fmtPrice, fmtPhone, specLine } from "../src/lib/format.js";

test("fmtPrice formats amount with tr grouping and currency", () => {
  assert.equal(fmtPrice({ amount: 2750000, currency: "TL" }), "2.750.000 TL");
  assert.equal(fmtPrice({ amount: 18000, currency: "TL" }), "18.000 TL");
});

test("fmtPrice falls back to raw, then to the empty placeholder", () => {
  assert.equal(fmtPrice({ raw: "Fiyat sorunuz" }), "Fiyat sorunuz");
  assert.equal(fmtPrice(null), "");
  assert.equal(fmtPrice(null, "—"), "—");
  assert.equal(fmtPrice({ amount: null, currency: "TL" }, "—"), "—");
});

test("fmtPhone groups a 10-digit national number, passes others through", () => {
  assert.equal(fmtPhone("5321112233"), "0532 111 22 33");
  assert.equal(fmtPhone("123"), "123");
  assert.equal(fmtPhone(""), "");
});

test("specLine picks category-relevant keys, in priority order, shortened", () => {
  const konut = {
    "Oda Sayısı": "3+1",
    "m² (Net)": "120",
    "Bina Yaşı": "5",
    Isıtma: "Kombi",
  };
  assert.equal(
    specLine(konut, "konut"),
    "Oda: 3+1 · m² net: 120 · Bina Yaşı: 5 · Isıtma: Kombi"
  );

  const arsa = { "İmar Durumu": "Konut", "m²": "500", "Kaks (Emsal)": "1.5" };
  assert.equal(
    specLine(arsa, "arsa"),
    "İmar Durumu: Konut · m²: 500 · Kaks: 1.5"
  );

  const ticari = {
    Türü: "Dükkan & Mağaza",
    "m²": "80",
    "Yapının Durumu": "Sıfır",
  };
  assert.equal(
    specLine(ticari, "ticari"),
    "Türü: Dükkan & Mağaza · m²: 80 · Yapının Durumu: Sıfır"
  );
});

test("specLine caps the number of shown attributes and tolerates empties", () => {
  const many = {
    "Oda Sayısı": "5+1",
    "m² (Net)": "200",
    "m² (Brüt)": "230",
    "Bina Yaşı": "3",
    "Bulunduğu Kat": "4",
    Isıtma: "Doğalgaz",
    "Aidat (TL)": "1500",
  };
  assert.equal(specLine(many, "konut").split(" · ").length, 5);
  assert.equal(specLine(null, "konut"), "");
  assert.equal(specLine({}, "konut"), "");
});

test("specLine falls back to the generic key set for unknown categories", () => {
  const attrs = { "m²": "60", "Oda Sayısı": "2+1" };
  assert.equal(specLine(attrs, "diger"), "m²: 60 · Oda: 2+1");
  assert.equal(specLine(attrs, undefined), "m²: 60 · Oda: 2+1");
});
