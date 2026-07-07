// Applies the saved theme preference to the current page (popup/dashboard) by
// setting `data-theme` on <html>. "system" resolves via prefers-color-scheme
// and keeps following the OS live. CSS in each page defines the two palettes.
import { getTheme, setTheme } from "./store.js";

const mql =
  typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;

let currentPref = "system";

function resolve(pref) {
  if (pref === "light" || pref === "dark") return pref;
  return mql && mql.matches ? "dark" : "light";
}

function apply() {
  document.documentElement.dataset.theme = resolve(currentPref);
}

// Read the saved preference, apply it, and keep tracking the OS while "system".
export async function initTheme() {
  currentPref = await getTheme();
  apply();
  if (mql) mql.addEventListener("change", apply);
  return currentPref;
}

// Persist a new preference and re-apply immediately.
export async function updateTheme(pref) {
  currentPref = await setTheme(pref);
  apply();
  return currentPref;
}
