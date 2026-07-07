import { test, before } from "node:test";
import assert from "node:assert/strict";

// Fake catalog served to initI18n() via a mocked fetch.
const CATALOG = {
  plain: { message: "Selam" },
  greet: {
    message: "Merhaba $name$",
    placeholders: { name: { content: "$1" } },
  },
  num: { message: "$1 adet" },
};

let i18n;

before(async () => {
  globalThis.chrome = {
    runtime: { getURL: (p) => `chrome-extension://x/${p}` },
    i18n: {
      getMessage: (k) => `<${k}>`, // sentinel for the fallback path
      getUILanguage: () => "tr-TR",
    },
  };
  globalThis.fetch = async () => ({ json: async () => CATALOG });
  i18n = await import("../src/lib/i18n.js");
});

test("with an explicit language, t() translates from the loaded catalog", async () => {
  const lang = await i18n.initI18n("tr");
  assert.equal(lang, "tr");
  assert.equal(i18n.t("plain"), "Selam");
  // named placeholder + numbered substitution
  assert.equal(i18n.t("greet", ["Ada"]), "Merhaba Ada");
  assert.equal(i18n.t("num", "3"), "3 adet");
  // unknown key falls back to chrome.i18n (sentinel), then key
  assert.equal(i18n.t("missing"), "<missing>");
});

test("auto resolves the browser locale and still translates from a catalog", async () => {
  const lang = await i18n.initI18n("auto");
  assert.equal(lang, "auto");
  assert.equal(i18n.t("plain"), "Selam"); // from the fetched catalog, not chrome.i18n
});

test("falls back to chrome.i18n when the catalog cannot be loaded", async () => {
  const saved = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("no file");
  };
  await i18n.initI18n("auto");
  assert.equal(i18n.t("plain"), "<plain>"); // sentinel from chrome.i18n
  globalThis.fetch = saved;
});
