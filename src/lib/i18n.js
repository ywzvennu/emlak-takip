// i18n helpers for extension pages (popup, dashboard). Content scripts call
// chrome.i18n.getMessage directly since they can't import modules.

// Look up a message. `subs` is a string or array of up to 9 substitutions.
export function t(key, subs) {
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
};
const STATUS_MSG = {
  kaydedildi: "statusKaydedildi",
  ilgileniliyor: "statusIlgileniliyor",
  arandi: "statusArandi",
  elendi: "statusElendi",
};

export const categoryLabel = (v) => (v && CATEGORY_MSG[v] ? t(CATEGORY_MSG[v]) : v || "");
export const typeLabel = (v) => (v && TYPE_MSG[v] ? t(TYPE_MSG[v]) : v || "");
export const statusLabel = (v) => (v && STATUS_MSG[v] ? t(STATUS_MSG[v]) : v || "");

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
