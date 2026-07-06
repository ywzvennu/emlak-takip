import * as store from "../lib/store.js";
import { STATUS_VALUES, CATEGORY_VALUES, TYPE_VALUES } from "../lib/store.js";
import {
  t,
  localizeDom,
  categoryLabel,
  typeLabel,
  statusLabel,
} from "../lib/i18n.js";

const $ = (sel) => document.querySelector(sel);

const state = {
  all: [],
  filters: { category: "", type: "", status: "", tag: "", q: "" },
  sort: "savedAt-desc",
};

const nf = new Intl.NumberFormat("tr-TR");

function fmtPrice(price) {
  if (!price) return "—";
  if (price.amount != null)
    return `${nf.format(price.amount)} ${price.currency || ""}`.trim();
  return price.raw || "—";
}

function fmtDate(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleDateString("tr-TR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function specLine(attrs) {
  if (!attrs) return "";
  const keys = [
    "m² (Brüt)",
    "m² (Net)",
    "m²",
    "Oda Sayısı",
    "Bina Yaşı",
    "Isıtma",
    "İmar Durumu",
    "Kaks (Emsal)",
  ];
  return keys
    .filter((k) => attrs[k])
    .map(
      (k) =>
        `${k.replace(" (Brüt)", " br.").replace(" (Net)", " net").replace(" Sayısı", "")}: ${attrs[k]}`
    )
    .join(" · ");
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
    { value: "updatedAt-desc", label: t("sortUpdated") },
  ];
  fillSelect($("#sort"), sorts, state.sort, sorts[0].label);
  $("#sort").value = state.sort;
}

// ---------- filtering / sorting ----------

function applyFilters(list) {
  const { category, type, status, tag, q } = state.filters;
  const needle = q.trim().toLowerCase();
  return list.filter((r) => {
    if (category && r.category !== category) return false;
    if (type && r.listingType !== type) return false;
    if (status && r.status !== status) return false;
    if (tag && !(r.tags || []).includes(tag)) return false;
    if (needle) {
      const hay = [
        r.title,
        r.location && r.location.raw,
        r.notes,
        (r.tags || []).join(" "),
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
}

function buildCard(tpl, r) {
  const node = tpl.content.firstElementChild.cloneNode(true);
  node.dataset.ilan = r.ilanNo;

  const thumbA = node.querySelector(".card-thumb");
  thumbA.href = r.url;
  const img = node.querySelector(".card-thumb img");
  if (r.thumbnail) img.src = r.thumbnail;
  else thumbA.classList.add("no-img");

  const badges = [];
  if (r.category) badges.push(categoryLabel(r.category));
  if (r.listingType) badges.push(typeLabel(r.listingType));
  node.querySelector(".card-badges").innerHTML = badges
    .filter(Boolean)
    .map((b) => `<span class="badge">${b}</span>`)
    .join("");

  const titleA = node.querySelector(".card-title");
  titleA.textContent = r.title || "İlan";
  titleA.href = r.url;

  node.querySelector(".price-now").textContent = fmtPrice(r.price);
  const delta = priceDelta(r);
  const deltaEl = node.querySelector(".price-delta");
  if (delta) {
    deltaEl.textContent = `${delta.down ? "▼" : "▲"} ${Math.abs(delta.pct)}%`;
    deltaEl.classList.add(delta.down ? "down" : "up");
  }

  node.querySelector(".card-loc").textContent = r.location
    ? r.location.raw || ""
    : "";
  node.querySelector(".card-specs").textContent = specLine(r.attributes);

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
      return `<div class="hist-row"><span>${fmtDate(p.at)}</span><span>${fmtPrice(p)}${tag}</span></div>`;
    })
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
    state.filters = { category: "", type: "", status: "", tag: "", q: "" };
    state.sort = "savedAt-desc";
    $("#search").value = "";
    rebuildFilters();
    render();
  });
}

function wireGrid() {
  const grid = $("#grid");

  grid.addEventListener("change", async (e) => {
    const card = e.target.closest(".card");
    if (!card) return;
    const ilanNo = card.dataset.ilan;
    if (e.target.classList.contains("status-sel")) {
      await store.updateRecord(ilanNo, { status: e.target.value });
      const rec = state.all.find((x) => x.ilanNo === ilanNo);
      if (rec) rec.status = e.target.value;
    }
  });

  // save tags/notes on blur
  grid.addEventListener(
    "blur",
    async (e) => {
      const card = e.target.closest(".card");
      if (!card) return;
      const ilanNo = card.dataset.ilan;
      if (e.target.classList.contains("tags-input")) {
        const tags = e.target.value
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean);
        await store.updateRecord(ilanNo, { tags });
        const rec = state.all.find((x) => x.ilanNo === ilanNo);
        if (rec) rec.tags = tags;
        rebuildFilters();
      } else if (e.target.classList.contains("notes")) {
        await store.updateRecord(ilanNo, { notes: e.target.value });
        const rec = state.all.find((x) => x.ilanNo === ilanNo);
        if (rec) rec.notes = e.target.value;
      }
    },
    true
  );

  grid.addEventListener("click", async (e) => {
    const card = e.target.closest(".card");
    if (!card) return;
    const ilanNo = card.dataset.ilan;
    if (e.target.classList.contains("del-btn")) {
      if (!confirm(t("confirmDelete"))) return;
      await store.remove(ilanNo);
      await reload();
    } else if (e.target.classList.contains("history-btn")) {
      const box = card.querySelector(".history");
      box.classList.toggle("hidden");
      if (!box.classList.contains("hidden")) {
        renderHistory(
          box,
          state.all.find((x) => x.ilanNo === ilanNo)
        );
      }
    }
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
    "priceAmount",
    "currency",
    "il",
    "ilce",
    "mahalle",
    "status",
    "tags",
    "notes",
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
      r.price ? r.price.amount : "",
      r.price ? r.price.currency : "",
      r.location ? r.location.il : "",
      r.location ? r.location.ilce : "",
      r.location ? r.location.mahalle : "",
      r.status,
      (r.tags || []).join("|"),
      r.notes,
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

// live-update if another surface (popup / content script) changes storage
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.ilanlar) {
    state.all = changes.ilanlar.newValue || [];
    rebuildFilters();
    render();
  }
});

document.title = t("dashTitle");
localizeDom(); // static topbar / filters / empty state
wireFilters();
wireGrid();
wireIo();
reload();
