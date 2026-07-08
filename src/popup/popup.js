import * as store from "../lib/store.js";
import {
  t,
  initI18n,
  localizeDom,
  categoryLabel,
  typeLabel,
} from "../lib/i18n.js";
import { point, osmUrl } from "../lib/geo.js";
import { initTheme } from "../lib/theme.js";
import { fmtPrice, fmtPhone, specLine } from "../lib/format.js";

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
  let badgeHtml = badges
    .filter(Boolean)
    .map((b) => `<span class="badge">${b}</span>`)
    .join("");
  if (payload.devren)
    badgeHtml += `<span class="badge devren">${t("badgeDevren")}</span>`;
  if (payload.expired)
    badgeHtml += `<span class="badge removed">${t("badgeRemoved")}</span>`;
  $("badges").innerHTML = badgeHtml;

  $("price").textContent = fmtPrice(payload.price);
  $("loc").textContent = payload.location ? payload.location.raw || "" : "";
  $("specs").textContent = specLine(payload.attributes, payload.category);

  const c = payload.contact;
  if (c) {
    const who = [
      c.agentName,
      c.agency && c.agency !== c.agentName ? c.agency : null,
    ]
      .filter(Boolean)
      .join(" · ");
    const label =
      who || c.name || (c.type === "sahibinden" ? t("sellerOwner") : "");
    const phones = (c.phones || [])
      .map((p) => (typeof p === "string" ? { type: null, number: p } : p))
      .filter((p) => p && p.number);
    const entries = phones.length
      ? phones
      : c.phone
        ? [{ type: null, number: c.phone }]
        : [];
    const phoneStr = entries
      .map((p) => {
        const lbl = p.type === "cep" ? "Cep " : p.type === "is" ? "İş " : "";
        return `${lbl}${fmtPhone(p.number)}`;
      })
      .join(" · ");
    $("contact").textContent = [label, phoneStr].filter(Boolean).join(" · ");
  } else {
    $("contact").textContent = "";
  }

  const map = $("maplink");
  const pt = point(payload);
  if (pt) {
    map.href = osmUrl(pt[0], pt[1]);
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
  initTheme();
  await initI18n(await store.getLang());
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
