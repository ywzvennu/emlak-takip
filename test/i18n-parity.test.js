import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Both locale catalogs must define exactly the same keys — a missing key in one
// language silently falls back to the key name in the UI.
function load(locale) {
  const path = fileURLToPath(
    new URL(`../_locales/${locale}/messages.json`, import.meta.url)
  );
  return JSON.parse(readFileSync(path, "utf8"));
}

test("tr and en locale catalogs have identical key sets", () => {
  const tr = Object.keys(load("tr")).sort();
  const en = Object.keys(load("en")).sort();

  const missingInEn = tr.filter((k) => !en.includes(k));
  const missingInTr = en.filter((k) => !tr.includes(k));

  assert.deepEqual(
    missingInEn,
    [],
    `keys present in tr but missing in en: ${missingInEn.join(", ")}`
  );
  assert.deepEqual(
    missingInTr,
    [],
    `keys present in en but missing in tr: ${missingInTr.join(", ")}`
  );
});

test("every message entry has a non-empty message string", () => {
  for (const locale of ["tr", "en"]) {
    const catalog = load(locale);
    for (const [key, entry] of Object.entries(catalog)) {
      assert.ok(
        entry && typeof entry.message === "string" && entry.message.length > 0,
        `${locale}: "${key}" has no message`
      );
    }
  }
});
