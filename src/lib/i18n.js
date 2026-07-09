// i18n helpers for extension pages (popup, dashboard). Content scripts call
// chrome.i18n.getMessage directly since they can't import modules.
//
// By default `t()` uses chrome.i18n (which follows the browser UI language).
// When the user picks an explicit language, initI18n(lang) loads that locale's
// messages.json and t() translates from it instead.

let catalog = null; // active override catalog, or null to use chrome.i18n

// Reproduce chrome.i18n's substitution for an override entry: named `$ph$`
// placeholders resolve via `placeholders`, then `$1..$9` fill from `subs`.
function applyMessage(entry, subs) {
  const arr = Array.isArray(subs) ? subs : subs != null ? [subs] : [];
  const ph = entry.placeholders || {};
  let msg = String(entry.message).replace(/\$(\w+)\$/g, (m, name) => {
    const p = ph[name] || ph[name.toLowerCase()];
    return p && p.content != null ? p.content : m;
  });
  msg = msg.replace(/\$(\d)/g, (m, d) => {
    const i = Number(d) - 1;
    return i >= 0 && i < arr.length ? arr[i] : "";
  });
  return msg.replace(/\$\$/g, "$");
}

const AVAILABLE = ["tr", "en"];
const DEFAULT_LOCALE = "tr";

// Which catalog "auto" should use: the browser UI language if we have it,
// otherwise the default locale (mirrors the manifest's default_locale).
function resolveAuto() {
  try {
    const ui = (chrome.i18n.getUILanguage?.() || "").toLowerCase();
    const base = ui.split("-")[0];
    return AVAILABLE.includes(base) ? base : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

// Load the messages catalog for the chosen language (or the resolved browser
// language for "auto") and translate from it. We read _locales JSON directly
// rather than via chrome.i18n so newly added strings show on a normal reload —
// chrome.i18n's message table is cached and doesn't refresh on a soft reload.
export async function initI18n(lang) {
  const explicit = lang && lang !== "auto" && AVAILABLE.includes(lang);
  const target = explicit ? lang : resolveAuto();
  try {
    const url = chrome.runtime.getURL(`_locales/${target}/messages.json`);
    catalog = await (await fetch(url)).json();
  } catch {
    catalog = null; // fall back to chrome.i18n at lookup time
  }
  return explicit ? lang : "auto";
}

// Look up a message. `subs` is a string or array of up to 9 substitutions.
export function t(key, subs) {
  if (catalog && catalog[key]) return applyMessage(catalog[key], subs);
  return chrome.i18n.getMessage(key, subs) || key;
}

// Map domain values -> message keys, so labels are localized in one place.
const CATEGORY_MSG = {
  konut: "catKonut",
  ticari: "catTicari",
  arsa: "catArsa",
  diger: "catDiger",
};
const TYPE_MSG = {
  satilik: "typeSatilik",
  kiralik: "typeKiralik",
  "devren-satilik": "typeDevrenSatilik",
  "devren-kiralik": "typeDevrenKiralik",
};
const STATUS_MSG = {
  kaydedildi: "statusKaydedildi",
  ilgileniliyor: "statusIlgileniliyor",
  arandi: "statusArandi",
  elendi: "statusElendi",
};

export const categoryLabel = (v) =>
  v && CATEGORY_MSG[v] ? t(CATEGORY_MSG[v]) : v || "";
export const typeLabel = (v) => (v && TYPE_MSG[v] ? t(TYPE_MSG[v]) : v || "");
export const statusLabel = (v) =>
  v && STATUS_MSG[v] ? t(STATUS_MSG[v]) : v || "";

// Apply message strings to static markup:
//   <span data-i18n="popupBrand"></span>            -> textContent
//   <input data-i18n-attr="placeholder:searchPlaceholder;title:statusTip">
export function localizeDom(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  root.querySelectorAll("[data-i18n-attr]").forEach((el) => {
    el.dataset.i18nAttr.split(";").forEach((pair) => {
      const [attr, key] = pair.split(":").map((s) => s.trim());
      if (attr && key) el.setAttribute(attr, t(key));
    });
  });
}
