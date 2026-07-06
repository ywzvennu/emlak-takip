import * as store from "../lib/store.js";
import { t, localizeDom, categoryLabel, typeLabel } from "../lib/i18n.js";

const $ = (id) => document.getElementById(id);

function sendToTab(tabId, message) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, message, (res) => {
        if (chrome.runtime.lastError) resolve(null);
        else resolve(res);
      });
    } catch {
      resolve(null);
    }
  });
}

function fmtPrice(price) {
  if (!price) return "";
  if (price.amount != null) {
    const n = new Intl.NumberFormat("tr-TR").format(price.amount);
    const cur = price.currency || "";
    return `${n} ${cur}`.trim();
  }
  return price.raw || "";
}

function fmtPhone(p) {
  const d = String(p || "");
  if (d.length !== 10) return d;
  return `0${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6, 8)} ${d.slice(8)}`;
}

function specLine(attrs) {
  if (!attrs) return "";
  const keys = [
    "m² (Brüt)",
    "m² (Net)",
    "m²",
    "Oda Sayısı",
    "Bina Yaşı",
    "İmar Durumu",
  ];
  return keys
    .filter((k) => attrs[k])
    .map((k) => `${k.replace("Sayısı", "").trim()}: ${attrs[k]}`)
    .join(" · ");
}

function render(payload, saved) {
  $("loading").classList.add("hidden");
  if (!payload) {
    $("notfound").classList.remove("hidden");
    return;
  }
  $("ilan").classList.remove("hidden");
  $("save").classList.remove("hidden");

  $("thumb").src = payload.thumbnail || "";
  $("thumb").style.display = payload.thumbnail ? "" : "none";
  $("title").textContent = payload.title || "İlan";

  const badges = [];
  if (payload.category) badges.push(categoryLabel(payload.category));
  if (payload.listingType) badges.push(typeLabel(payload.listingType));
  $("badges").innerHTML = badges
    .filter(Boolean)
    .map((b) => `<span class="badge">${b}</span>`)
    .join("");

  $("price").textContent = fmtPrice(payload.price);
  $("loc").textContent = payload.location ? payload.location.raw || "" : "";
  $("specs").textContent = specLine(payload.attributes);

  const c = payload.contact;
  if (c) {
    const label =
      c.agency || c.name || (c.type === "sahibinden" ? t("sellerOwner") : "");
    const phone = c.phone ? fmtPhone(c.phone) : "";
    $("contact").textContent = [label, phone].filter(Boolean).join(" · ");
  } else {
    $("contact").textContent = "";
  }

  const map = $("maplink");
  if (payload.geo && payload.geo.lat != null && payload.geo.lng != null) {
    const { lat, lng } = payload.geo;
    map.href = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;
    map.classList.remove("hidden");
  } else {
    map.classList.add("hidden");
  }

  updateSaveBtn(saved);
}

function updateSaveBtn(saved) {
  const btn = $("save");
  btn.textContent = saved ? t("btnSaveUpdate") : t("btnSave");
  btn.classList.toggle("saved", saved);
}

async function refreshCount() {
  const all = await store.getAll();
  $("count").textContent = t("ilanCount", String(all.length));
}

async function main() {
  localizeDom();
  refreshCount();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let payload = null;
  if (tab && tab.id != null) {
    const res = await sendToTab(tab.id, { type: "CAPTURE" });
    payload = res && res.ok ? res.payload : null;
  }

  let saved = false;
  if (payload) {
    const existing = await store.getByKey(payload.key);
    saved = !!existing;
  }
  render(payload, saved);

  $("save").addEventListener("click", async () => {
    if (!payload) return;
    $("save").disabled = true;
    const { created } = await store.upsert(payload);
    $("save").disabled = false;
    updateSaveBtn(true);
    $("save").textContent = created ? t("savedDone") : t("updatedDone");
    refreshCount();
  });

  $("open").addEventListener("click", () => {
    chrome.tabs.create({
      url: chrome.runtime.getURL("src/dashboard/dashboard.html"),
    });
  });
}

main();
