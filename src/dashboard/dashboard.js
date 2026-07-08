import * as store from "../lib/store.js";
import { STATUS_VALUES, CATEGORY_VALUES, TYPE_VALUES } from "../lib/store.js";
import {
  t,
  initI18n,
  localizeDom,
  categoryLabel,
  typeLabel,
  statusLabel,
} from "../lib/i18n.js";
import { point, boundsOf, osmUrl } from "../lib/geo.js";
import { initTheme, updateTheme } from "../lib/theme.js";
import { fmtPrice, fmtPhone, specLine } from "../lib/format.js";

/* global L */ // Leaflet, loaded as a classic script before this module

const $ = (sel) => document.querySelector(sel);

const state = {
  all: [],
  filters: {
    category: "",
    type: "",
    status: "",
    tag: "",
    q: "",
    devren: false,
    removed: false,
  },
  sort: "savedAt-desc",
  view: "list",
  selectMode: false,
  selected: new Set(),
};

function fmtDate(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleDateString("tr-TR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c]
  );
}

// Normalize a phone entry (legacy string, or { type, number }).
function phoneEntry(p) {
  return typeof p === "string" ? { type: null, number: p } : p || {};
}

function phoneLabel(type) {
  return type === "cep" ? "Cep" : type === "is" ? "İş" : "";
}

function contactLine(c) {
  if (!c) return "";
  const parts = [];
  const who = [
    c.agentName,
    c.agency && c.agency !== c.agentName ? c.agency : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const label =
    who || c.name || (c.type === "sahibinden" ? t("sellerOwner") : "");
  if (label) parts.push(`<span class="c-name">${escapeHtml(label)}</span>`);

  const phones = (c.phones || []).map(phoneEntry).filter((p) => p.number);
  const entries = phones.length
    ? phones
    : c.phone
      ? [{ type: null, number: c.phone }]
      : [];
  for (const p of entries) {
    const lbl = phoneLabel(p.type);
    parts.push(
      `<a class="c-phone" href="tel:+90${p.number}">${lbl ? escapeHtml(lbl) + " " : ""}${fmtPhone(p.number)}</a>`
    );
  }
  return parts.join(" · ");
}

function priceDelta(record) {
  const h = record.priceHistory || [];
  if (h.length < 2) return null;
  const first = h[0].amount;
  const last = h[h.length - 1].amount;
  if (first == null || last == null || first === last) return null;
  const diff = last - first;
  const pct = Math.round((diff / first) * 100);
  return { diff, pct, down: diff < 0 };
}

// ---------- filter option population ----------

function fillSelect(el, options, current, allLabel) {
  el.innerHTML =
    `<option value="">${allLabel}</option>` +
    options
      .map(
        (o) =>
          `<option value="${o.value}"${o.value === current ? " selected" : ""}>${o.label}</option>`
      )
      .join("");
}

function rebuildFilters() {
  fillSelect(
    $("#fCategory"),
    CATEGORY_VALUES.map((v) => ({ value: v, label: categoryLabel(v) })),
    state.filters.category,
    t("filterAllCategories")
  );
  fillSelect(
    $("#fType"),
    TYPE_VALUES.map((v) => ({ value: v, label: typeLabel(v) })),
    state.filters.type,
    t("filterAllTypes")
  );
  fillSelect(
    $("#fStatus"),
    STATUS_VALUES.map((v) => ({ value: v, label: statusLabel(v) })),
    state.filters.status,
    t("filterAllStatuses")
  );

  const tags = [...new Set(state.all.flatMap((r) => r.tags || []))].sort(
    (a, b) => a.localeCompare(b, "tr")
  );
  fillSelect(
    $("#fTag"),
    tags.map((tag) => ({ value: tag, label: tag })),
    state.filters.tag,
    t("filterAllTags")
  );

  const sorts = [
    { value: "savedAt-desc", label: t("sortSavedDesc") },
    { value: "savedAt-asc", label: t("sortSavedAsc") },
    { value: "price-asc", label: t("sortPriceAsc") },
    { value: "price-desc", label: t("sortPriceDesc") },
    { value: "ilanTarihiTs-desc", label: t("sortIlanDate") },
    { value: "updatedAt-desc", label: t("sortUpdated") },
  ];
  fillSelect($("#sort"), sorts, state.sort, sorts[0].label);
  $("#sort").value = state.sort;
}

// ---------- filtering / sorting ----------

function applyFilters(list) {
  const { category, type, status, tag, q, devren, removed } = state.filters;
  const needle = q.trim().toLowerCase();
  return list.filter((r) => {
    if (category && r.category !== category) return false;
    if (type && r.listingType !== type) return false;
    if (devren && !r.devren) return false;
    if (removed && !r.removed) return false;
    if (status && r.status !== status) return false;
    if (tag && !(r.tags || []).includes(tag)) return false;
    if (needle) {
      const hay = [
        r.title,
        r.location && r.location.raw,
        r.notes,
        (r.tags || []).join(" "),
        r.devren ? "devren" : "",
        r.removed ? "kaldırıldı yayından removed" : "",
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
}

function sortList(list) {
  const [key, dir] = state.sort.split("-");
  const mul = dir === "asc" ? 1 : -1;
  return [...list].sort((a, b) => {
    let av, bv;
    if (key === "price") {
      av = a.price && a.price.amount != null ? a.price.amount : Infinity * mul;
      bv = b.price && b.price.amount != null ? b.price.amount : Infinity * mul;
    } else {
      av = a[key] || 0;
      bv = b[key] || 0;
    }
    return (av - bv) * mul;
  });
}

// ---------- map view ----------

let map = null;
let markerLayer = null;
let markerByKey = new Map(); // record key -> its map marker, for list↔map jumps

function pinIcon() {
  return L.divIcon({
    className: "emt-pin",
    html: '<span class="emt-pin-dot"></span>',
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    popupAnchor: [0, -8],
  });
}

function ensureMap() {
  if (map) return;
  map = L.map("map", { scrollWheelZoom: true }).setView([39, 35], 5);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap",
  }).addTo(map);
  markerLayer = L.layerGroup().addTo(map);
}

function mapPopupHtml(r) {
  const cat = [
    categoryLabel(r.category),
    typeLabel(r.listingType),
    r.devren ? t("badgeDevren") : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const loc = (r.location && r.location.raw) || "";
  return (
    `<div class="map-pop">` +
    `<a href="${escapeHtml(r.url)}" target="_blank" rel="noopener">` +
    `<strong>${escapeHtml(r.title || "İlan")}</strong></a>` +
    `<div class="mp-price">${escapeHtml(fmtPrice(r.price, "—"))}</div>` +
    (cat ? `<div class="mp-cat">${escapeHtml(cat)}</div>` : "") +
    (loc ? `<div class="mp-loc">${escapeHtml(loc)}</div>` : "") +
    `<button class="mp-tolist" data-key="${escapeHtml(r.key)}">${t("toListBtn")}</button>` +
    `</div>`
  );
}

function renderMap(rows) {
  ensureMap();
  markerLayer.clearLayers();
  markerByKey = new Map();
  const located = rows.filter((r) => point(r));
  for (const r of located) {
    const marker = L.marker(point(r), { icon: pinIcon() }).bindPopup(
      mapPopupHtml(r)
    );
    marker.addTo(markerLayer);
    markerByKey.set(r.key, marker);
  }
  const b = boundsOf(located);
  if (b) map.fitBounds(b, { padding: [30, 30], maxZoom: 15 });
  $("#mapNote").classList.toggle("hidden", located.length !== 0);
  // the container was hidden when the map was created -> recompute its size
  setTimeout(() => map.invalidateSize(), 0);
}

function setView(view) {
  state.view = view;
  const isMap = view === "map";
  $("#grid").classList.toggle("hidden", isMap);
  $("#map").classList.toggle("hidden", !isMap);
  $("#viewList").classList.toggle("active", !isMap);
  $("#viewMap").classList.toggle("active", isMap);
  if (!isMap) $("#mapNote").classList.add("hidden");
  render();
}

// Jump from a list card to its pin on the map (switches to the map view).
function focusOnMap(key) {
  setView("map"); // rebuilds markers synchronously
  const marker = markerByKey.get(key);
  if (!marker) return;
  const zoom = Math.max(map.getZoom() || 0, 15);
  map.setView(marker.getLatLng(), zoom);
  marker.openPopup();
  // container was just unhidden — make sure Leaflet has the right size
  setTimeout(() => map.invalidateSize(), 0);
}

// Jump from a map pin back to its card in the list (switches to the list view).
function focusInList(key) {
  setView("list");
  const card = $(`#grid .card[data-key="${key}"]`);
  if (!card) return;
  card.scrollIntoView({ behavior: "smooth", block: "center" });
  card.classList.add("flash");
  setTimeout(() => card.classList.remove("flash"), 1500);
}

// ---------- rendering ----------

function render() {
  const grid = $("#grid");
  grid.innerHTML = "";
  const rows = sortList(applyFilters(state.all));

  $("#count").textContent = `${rows.length}/${state.all.length}`;
  $("#empty").classList.toggle("hidden", state.all.length !== 0);

  const tpl = $("#card-tpl");
  for (const r of rows) {
    grid.appendChild(buildCard(tpl, r));
  }

  if (state.view === "map") renderMap(rows);
}

function buildCard(tpl, r) {
  const node = tpl.content.firstElementChild.cloneNode(true);
  node.dataset.key = r.key;

  const thumbA = node.querySelector(".card-thumb");
  thumbA.href = r.url;
  const img = node.querySelector(".card-thumb img");
  if (r.thumbnail) img.src = r.thumbnail;
  else thumbA.classList.add("no-img");

  const badges = [];
  if (r.category) badges.push(categoryLabel(r.category));
  if (r.listingType) badges.push(typeLabel(r.listingType));
  let badgeHtml = badges
    .filter(Boolean)
    .map((b) => `<span class="badge">${b}</span>`)
    .join("");
  if (r.devren)
    badgeHtml += `<span class="badge devren">${t("badgeDevren")}</span>`;
  if (r.removed)
    badgeHtml += `<span class="badge removed">${t("badgeRemoved")}</span>`;
  node.querySelector(".card-badges").innerHTML = badgeHtml;
  node.classList.toggle("removed", !!r.removed);

  const titleA = node.querySelector(".card-title");
  titleA.textContent = r.title || "İlan";
  titleA.href = r.url;

  node.querySelector(".price-now").textContent = fmtPrice(r.price, "—");
  const delta = priceDelta(r);
  const deltaEl = node.querySelector(".price-delta");
  if (delta) {
    deltaEl.textContent = `${delta.down ? "▼" : "▲"} ${Math.abs(delta.pct)}%`;
    deltaEl.classList.add(delta.down ? "down" : "up");
  }

  node.querySelector(".loc-text").textContent = r.location
    ? r.location.raw || ""
    : "";
  const mapLink = node.querySelector(".map-link");
  const pt = point(r);
  if (pt) {
    mapLink.href = osmUrl(pt[0], pt[1]);
    mapLink.classList.remove("hidden");
    node.querySelector(".locate-btn").classList.remove("hidden");
  }
  node.querySelector(".card-specs").textContent = specLine(
    r.attributes,
    r.category
  );

  const contactHtml = contactLine(r.contact);
  if (contactHtml) {
    const contactEl = node.querySelector(".card-contact");
    contactEl.innerHTML = contactHtml;
    contactEl.classList.remove("hidden");
  }

  const photoCount = node.querySelector(".photo-count");
  if (r.photos && r.photos.length) {
    photoCount.textContent = `📷 ${r.photos.length}`;
    photoCount.classList.remove("hidden");
  }

  const media = r.media || {};
  const mediaFlags = [];
  if (media.hasVideo) mediaFlags.push(["🎥", t("mediaVideo")]);
  if (media.hasIlanKlibi) mediaFlags.push(["🎬", t("mediaIlanKlibi")]);
  if (media.hasVirtualTour) mediaFlags.push(["🧭", t("mediaVirtualTour")]);
  if (media.hasSahiDeko) mediaFlags.push(["🛋", t("mediaSahiDeko")]);
  if (mediaFlags.length) {
    const mf = node.querySelector(".media-flags");
    mf.textContent = mediaFlags.map((x) => x[0]).join(" ");
    mf.title = mediaFlags.map((x) => x[1]).join(", ");
    mf.classList.remove("hidden");
  }

  if (r.description) node.querySelector(".desc-btn").classList.remove("hidden");
  if (r.features && Object.keys(r.features).length)
    node.querySelector(".features-btn").classList.remove("hidden");
  if (r.attributes && Object.keys(r.attributes).length)
    node.querySelector(".attrs-btn").classList.remove("hidden");
  if (r.photos && r.photos.length)
    node.querySelector(".gallery-btn").classList.remove("hidden");

  const statusSel = node.querySelector(".status-sel");
  statusSel.innerHTML = STATUS_VALUES.map(
    (v) =>
      `<option value="${v}"${v === r.status ? " selected" : ""}>${statusLabel(v)}</option>`
  ).join("");
  statusSel.dataset.status = r.status;

  node.querySelector(".tags-input").value = (r.tags || []).join(", ");
  node.querySelector(".notes").value = r.notes || "";
  node.querySelector(".saved-at").textContent = t(
    "addedOn",
    fmtDate(r.savedAt)
  );

  // selection state (bulk delete)
  const check = node.querySelector(".sel-check");
  if (check) check.checked = state.selected.has(r.key);
  node.classList.toggle("selected", state.selected.has(r.key));

  localizeDom(node); // template placeholders/titles (data-i18n-attr)
  return node;
}

function renderHistory(container, record) {
  const h = record.priceHistory || [];
  if (!h.length) {
    container.innerHTML = "<em>" + t("noPriceHistory") + "</em>";
    return;
  }
  container.innerHTML = h
    .map((p, i) => {
      const prev = h[i - 1];
      let tag = "";
      if (
        prev &&
        prev.amount != null &&
        p.amount != null &&
        prev.amount !== p.amount
      ) {
        const down = p.amount < prev.amount;
        tag = ` <span class="hist-delta ${down ? "down" : "up"}">${down ? "▼" : "▲"}</span>`;
      }
      return `<div class="hist-row"><span>${fmtDate(p.at)}</span><span>${fmtPrice(p, "—")}${tag}</span></div>`;
    })
    .join("");
}

function renderAttrs(container, record) {
  const rows = Object.entries((record && record.attributes) || {});
  if (!rows.length) {
    container.innerHTML = "<em>—</em>";
    return;
  }
  container.innerHTML = rows
    .map(
      ([k, v]) =>
        `<div class="attr-row"><span class="attr-k">${escapeHtml(k)}</span><span class="attr-v">${escapeHtml(v)}</span></div>`
    )
    .join("");
}

function renderGallery(container, record) {
  const photos = (record && record.photos) || [];
  if (!photos.length) {
    container.innerHTML = "<em>—</em>";
    return;
  }
  container.innerHTML = photos
    .map(
      (src) =>
        `<a href="${escapeHtml(src)}" target="_blank" rel="noopener"><img loading="lazy" src="${escapeHtml(src)}" alt="" /></a>`
    )
    .join("");
}

function renderFeatures(container, record) {
  const groups = Object.entries((record && record.features) || {});
  if (!groups.length) {
    container.innerHTML = "<em>" + t("noFeatures") + "</em>";
    return;
  }
  container.innerHTML = groups
    .map(
      ([group, items]) =>
        `<div class="feat-group"><strong>${escapeHtml(group)}</strong>: ${items
          .map(escapeHtml)
          .join(", ")}</div>`
    )
    .join("");
}

// ---------- event wiring ----------

async function reload() {
  state.all = await store.getAll();
  rebuildFilters();
  render();
}

function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

function wireFilters() {
  $("#fCategory").addEventListener("change", (e) => {
    state.filters.category = e.target.value;
    render();
  });
  $("#fType").addEventListener("change", (e) => {
    state.filters.type = e.target.value;
    render();
  });
  $("#fStatus").addEventListener("change", (e) => {
    state.filters.status = e.target.value;
    render();
  });
  $("#fTag").addEventListener("change", (e) => {
    state.filters.tag = e.target.value;
    render();
  });
  $("#fDevren").addEventListener("change", (e) => {
    state.filters.devren = e.target.checked;
    render();
  });
  $("#fRemoved").addEventListener("change", (e) => {
    state.filters.removed = e.target.checked;
    render();
  });
  $("#sort").addEventListener("change", (e) => {
    state.sort = e.target.value;
    render();
  });
  $("#search").addEventListener(
    "input",
    debounce((e) => {
      state.filters.q = e.target.value;
      render();
    }, 180)
  );
  $("#clearFilters").addEventListener("click", () => {
    state.filters = {
      category: "",
      type: "",
      status: "",
      tag: "",
      q: "",
      devren: false,
      removed: false,
    };
    state.sort = "savedAt-desc";
    $("#search").value = "";
    $("#fDevren").checked = false;
    $("#fRemoved").checked = false;
    rebuildFilters();
    render();
  });
  $("#viewList").addEventListener("click", () => setView("list"));
  $("#viewMap").addEventListener("click", () => setView("map"));
}

// The map popup's "show in list" button (Leaflet renders popup HTML into #map,
// so delegate from the container).
function wireMap() {
  $("#map").addEventListener("click", (e) => {
    const btn = e.target.closest(".mp-tolist");
    if (btn) focusInList(btn.dataset.key);
  });
}

function wireGrid() {
  const grid = $("#grid");

  grid.addEventListener("change", async (e) => {
    const card = e.target.closest(".card");
    if (!card) return;
    const key = card.dataset.key;
    if (e.target.classList.contains("status-sel")) {
      await store.updateByKey(key, { status: e.target.value });
      const rec = state.all.find((x) => x.key === key);
      if (rec) rec.status = e.target.value;
    }
  });

  // save tags/notes on blur
  grid.addEventListener(
    "blur",
    async (e) => {
      const card = e.target.closest(".card");
      if (!card) return;
      const key = card.dataset.key;
      if (e.target.classList.contains("tags-input")) {
        const tags = e.target.value
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean);
        await store.updateByKey(key, { tags });
        const rec = state.all.find((x) => x.key === key);
        if (rec) rec.tags = tags;
        rebuildFilters();
      } else if (e.target.classList.contains("notes")) {
        await store.updateByKey(key, { notes: e.target.value });
        const rec = state.all.find((x) => x.key === key);
        if (rec) rec.notes = e.target.value;
      }
    },
    true
  );

  grid.addEventListener("click", async (e) => {
    const card = e.target.closest(".card");
    if (!card) return;
    const key = card.dataset.key;

    // In selection mode a click anywhere on the card toggles selection.
    if (state.selectMode) {
      e.preventDefault();
      toggleSelect(key, card);
      return;
    }

    if (e.target.classList.contains("locate-btn")) {
      focusOnMap(key);
    } else if (e.target.classList.contains("history-btn")) {
      const box = card.querySelector(".history");
      box.classList.toggle("hidden");
      if (!box.classList.contains("hidden")) {
        renderHistory(
          box,
          state.all.find((x) => x.key === key)
        );
      }
    } else if (e.target.classList.contains("desc-btn")) {
      const box = card.querySelector(".desc");
      box.classList.toggle("hidden");
      if (!box.classList.contains("hidden")) {
        const rec = state.all.find((x) => x.key === key);
        box.textContent = (rec && rec.description) || t("noDescription");
      }
    } else if (e.target.classList.contains("features-btn")) {
      const box = card.querySelector(".features-box");
      box.classList.toggle("hidden");
      if (!box.classList.contains("hidden")) {
        renderFeatures(
          box,
          state.all.find((x) => x.key === key)
        );
      }
    } else if (e.target.classList.contains("attrs-btn")) {
      const box = card.querySelector(".attrs-box");
      box.classList.toggle("hidden");
      if (!box.classList.contains("hidden")) {
        renderAttrs(
          box,
          state.all.find((x) => x.key === key)
        );
      }
    } else if (e.target.classList.contains("gallery-btn")) {
      const box = card.querySelector(".gallery-box");
      box.classList.toggle("hidden");
      if (!box.classList.contains("hidden")) {
        renderGallery(
          box,
          state.all.find((x) => x.key === key)
        );
      }
    }
  });
}

// ---------- bulk delete (selection mode) ----------

function updateSelCount() {
  $("#selCount").textContent = t("selectedCount", String(state.selected.size));
  $("#deleteSelected").disabled = state.selected.size === 0;
}

function toggleSelect(key, card) {
  if (state.selected.has(key)) state.selected.delete(key);
  else state.selected.add(key);
  if (card) {
    const on = state.selected.has(key);
    card.classList.toggle("selected", on);
    const c = card.querySelector(".sel-check");
    if (c) c.checked = on;
  }
  updateSelCount();
}

function setSelectMode(on) {
  state.selectMode = on;
  if (!on) state.selected.clear();
  document.body.classList.toggle("select-mode", on);
  $("#selectBar").classList.toggle("hidden", !on);
  $("#selectMode").classList.toggle("active", on);
  render();
  updateSelCount();
}

function wireSelect() {
  $("#selectMode").addEventListener("click", () =>
    setSelectMode(!state.selectMode)
  );
  $("#cancelSelect").addEventListener("click", () => setSelectMode(false));
  $("#selectAll").addEventListener("click", () => {
    for (const r of sortList(applyFilters(state.all)))
      state.selected.add(r.key);
    render();
    updateSelCount();
  });
  $("#deleteSelected").addEventListener("click", async () => {
    const keys = [...state.selected];
    if (!keys.length) return;
    if (!confirm(t("confirmDeleteMany", String(keys.length)))) return;
    for (const k of keys) await store.removeByKey(k);
    state.selected.clear();
    await reload();
    setSelectMode(false);
  });
}

// ---------- export / import ----------

function download(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

function toCsv(list) {
  const attrKeys = [
    ...new Set(list.flatMap((r) => Object.keys(r.attributes || {}))),
  ];
  const base = [
    "ilanNo",
    "title",
    "category",
    "listingType",
    "devren",
    "priceAmount",
    "currency",
    "il",
    "ilce",
    "mahalle",
    "status",
    "removed",
    "tags",
    "notes",
    "agency",
    "phone",
    "lat",
    "lng",
    "features",
    "hasVideo",
    "videoUrl",
    "agentName",
    "description",
    "ilanTarihi",
    "ilanTarihiIso",
    "savedAt",
    "url",
  ];
  const header = [...base, ...attrKeys];
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = list.map((r) => {
    const row = [
      r.ilanNo,
      r.title,
      r.category,
      r.listingType,
      r.devren ? "1" : "",
      r.price ? r.price.amount : "",
      r.price ? r.price.currency : "",
      r.location ? r.location.il : "",
      r.location ? r.location.ilce : "",
      r.location ? r.location.mahalle : "",
      r.status,
      r.removed ? "1" : "",
      (r.tags || []).join("|"),
      r.notes,
      r.contact ? r.contact.agency || r.contact.name || "" : "",
      r.contact
        ? (r.contact.phones || [])
            .map((p) => (typeof p === "string" ? p : p.number))
            .join("|")
        : "",
      r.geo ? r.geo.lat : "",
      r.geo ? r.geo.lng : "",
      Object.entries(r.features || {})
        .map(([g, items]) => `${g}: ${items.join("/")}`)
        .join(" | "),
      r.media && r.media.hasVideo ? "1" : "",
      r.media && r.media.video ? r.media.video.url || "" : "",
      r.contact ? r.contact.agentName || "" : "",
      r.description || "",
      r.ilanTarihi || "",
      r.ilanTarihiTs ? new Date(r.ilanTarihiTs).toISOString() : "",
      r.savedAt ? new Date(r.savedAt).toISOString() : "",
      r.url,
      ...attrKeys.map((k) => (r.attributes ? r.attributes[k] || "" : "")),
    ];
    return row.map(esc).join(",");
  });
  return [header.join(","), ...rows].join("\n");
}

function wireIo() {
  $("#exportJson").addEventListener("click", () => {
    download(
      `emlak-takip-ilanlarim-${stamp()}.json`,
      JSON.stringify(state.all, null, 2),
      "application/json"
    );
  });
  $("#exportCsv").addEventListener("click", () => {
    download(
      `emlak-takip-ilanlarim-${stamp()}.csv`,
      "﻿" + toCsv(state.all),
      "text/csv"
    );
  });
  $("#importFile").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const list = Array.isArray(data) ? data : data.ilanlar || [];
      const { total, added } = await store.importListings(list, {
        replace: false,
      });
      alert(t("importResult", [String(added), String(total)]));
      await reload();
    } catch (err) {
      alert(t("importFail", err.message));
    } finally {
      e.target.value = "";
    }
  });
}

function wireTheme() {
  const sel = $("#theme");
  initTheme().then((pref) => (sel.value = pref));
  sel.addEventListener("change", (e) => updateTheme(e.target.value));
}

function wireLang() {
  const sel = $("#lang");
  store.getLang().then((l) => (sel.value = l));
  sel.addEventListener("change", async (e) => {
    await store.setLang(e.target.value);
    location.reload(); // re-render the whole UI in the chosen language
  });
}

function wireAutoSave() {
  const el = $("#autoSave");
  store.getAutoSave().then((on) => (el.checked = on));
  el.addEventListener("change", (e) => store.setAutoSave(e.target.checked));
}

function wireStorage() {
  const sel = $("#storageArea");
  store.getStorageArea().then((a) => (sel.value = a));
  sel.addEventListener("change", async (e) => {
    const res = await store.setStorageArea(e.target.value);
    if (res.error) {
      alert(t("storageSyncFail"));
      e.target.value = res.area; // stayed on the previous area; reflect that
    } else if (res.moved) {
      alert(t("storageMoved", String(res.moved)));
    }
    await reload();
  });
}

// live-update if another surface (popup / content script) changes storage
chrome.storage.onChanged.addListener((changes) => {
  // data may live in local or sync depending on the storage-area setting
  if (changes.ilanlar) {
    state.all = store.normalizeList(changes.ilanlar.newValue || []);
    rebuildFilters();
    render();
  }
});

async function boot() {
  await initI18n(await store.getLang());
  document.title = t("dashTitle");
  localizeDom(); // static topbar / filters / empty state
  wireFilters();
  wireGrid();
  wireMap();
  wireIo();
  wireStorage();
  wireAutoSave();
  wireSelect();
  wireTheme();
  wireLang();
  reload();
}

boot();
