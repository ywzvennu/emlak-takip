// Storage / data layer.
//
// Backed by chrome.storage.local. It is the only file that touches storage, so
// swapping in chrome.storage.sync or a remote backend later means changing just
// `read`/`write`. Imported by the background service worker, the popup and the
// dashboard. Content scripts do NOT import this; they message the worker.
//
// Identity: records are keyed by a composite `key` = `${provider}:${ilanNo}`,
// so listings that happen to share a numeric id across different sites never
// collide. Legacy records (pre-provider) are migrated on read: they get
// provider "sahibinden" and a derived key.

const KEY = "ilanlar";
// The chosen storage area ("local" | "sync") is itself always kept in local,
// so reading it never depends on the toggle.
const SETTINGS_KEY = "emt_settings";

// Canonical domain values. Human-readable labels live in src/lib/i18n.js so
// they can be localized; keep the value order here as the display order.
export const STATUS_VALUES = [
  "kaydedildi",
  "ilgileniliyor",
  "arandi",
  "elendi",
];
export const CATEGORY_VALUES = ["konut", "ticari", "arsa", "devren", "diger"];
export const TYPE_VALUES = ["satilik", "kiralik"];

const DEFAULT_PROVIDER = "sahibinden";

export function keyOf(provider, ilanNo) {
  return `${provider || DEFAULT_PROVIDER}:${ilanNo}`;
}

function recordKey(rec) {
  return rec.key || keyOf(rec.provider, rec.ilanNo);
}

// Backfill provider/key on legacy records so old data keeps working. Also
// promotes older devren records (a flag beside category) to the current model
// where devren is its own category and the property type lives in baseCategory.
export function normalize(rec) {
  if (!rec) return rec;
  const provider = rec.provider || DEFAULT_PROVIDER;
  let { category, baseCategory } = rec;
  if (rec.devren && category !== "devren") {
    baseCategory = baseCategory || category || "diger";
    category = "devren";
  }
  return {
    ...rec,
    provider,
    category,
    baseCategory,
    key: rec.key || keyOf(provider, rec.ilanNo),
  };
}

export function normalizeList(list) {
  return Array.isArray(list) ? list.map(normalize) : [];
}

function areaFor(name) {
  return name === "sync" ? chrome.storage.sync : chrome.storage.local;
}

// Extension settings (storage area, theme, …) always live in local, as one
// object. Read/patch it as a whole so writing one field never clobbers another.
async function getSettings() {
  const d = await chrome.storage.local.get(SETTINGS_KEY);
  return d[SETTINGS_KEY] || {};
}

async function patchSettings(patch) {
  const s = await getSettings();
  await chrome.storage.local.set({ [SETTINGS_KEY]: { ...s, ...patch } });
}

async function getArea() {
  return (await getSettings()).area === "sync" ? "sync" : "local";
}

export async function getStorageArea() {
  return getArea();
}

export const THEME_VALUES = ["system", "light", "dark"];

export async function getTheme() {
  const t = (await getSettings()).theme;
  return THEME_VALUES.includes(t) ? t : "system";
}

export async function setTheme(theme) {
  const value = THEME_VALUES.includes(theme) ? theme : "system";
  await patchSettings({ theme: value });
  return value;
}

// UI language for the extension pages: "auto" follows the browser.
export const LANG_VALUES = ["auto", "tr", "en"];

export async function getLang() {
  const l = (await getSettings()).lang;
  return LANG_VALUES.includes(l) ? l : "auto";
}

export async function setLang(lang) {
  const value = LANG_VALUES.includes(lang) ? lang : "auto";
  await patchSettings({ lang: value });
  return value;
}

// Auto-save: when on, supported listings are saved on page load without the
// user clicking.
export async function getAutoSave() {
  return !!(await getSettings()).autoSave;
}

export async function setAutoSave(on) {
  await patchSettings({ autoSave: !!on });
  return !!on;
}

// Sync storage is sharded: one item per record (keyed SHARD+key) plus an index
// of keys, so a large collection isn't limited by sync's per-item (~8KB) blob
// size. Local keeps the simple single-item array. The sync copy also drops the
// heavy `raw` payload (kept only in local) so individual records fit sync.
const SHARD = "ilan:";
const INDEX = "ilan_index";

function slimForSync(rec) {
  const copy = { ...rec };
  delete copy.raw;
  return copy;
}

async function readArea(area) {
  const api = areaFor(area);
  if (area !== "sync") return normalizeList((await api.get(KEY))[KEY]);
  const idx = (await api.get(INDEX))[INDEX];
  if (!Array.isArray(idx)) {
    // legacy single-item copy in sync (pre-sharding)
    return normalizeList((await api.get(KEY))[KEY]);
  }
  const itemKeys = idx.map((k) => SHARD + k);
  const items = itemKeys.length ? await api.get(itemKeys) : {};
  return normalizeList(idx.map((k) => items[SHARD + k]).filter(Boolean));
}

async function writeArea(area, list) {
  const api = areaFor(area);
  const norm = normalizeList(list);
  if (area !== "sync") {
    await api.set({ [KEY]: norm });
    return;
  }
  const keys = norm.map((r) => r.key);
  const prevIdx = (await api.get(INDEX))[INDEX] || [];
  const setObj = { [INDEX]: keys };
  for (const r of norm) setObj[SHARD + r.key] = slimForSync(r);
  await api.set(setObj);
  const stale = prevIdx.filter((k) => !keys.includes(k)).map((k) => SHARD + k);
  if (api.remove) await api.remove([KEY, ...stale]); // + drop legacy single item
}

async function clearArea(area) {
  const api = areaFor(area);
  if (!api.remove) return;
  if (area !== "sync") {
    await api.remove(KEY);
    return;
  }
  const idx = (await api.get(INDEX))[INDEX] || [];
  await api.remove([KEY, INDEX, ...idx.map((k) => SHARD + k)]);
}

// Switch where listings are stored, moving existing data across. If the target
// is sync and the data doesn't fit (sync's per-item/total quota), the move is
// aborted, the area is left unchanged, and nothing is lost.
export async function setStorageArea(area) {
  const target = area === "sync" ? "sync" : "local";
  const current = await getArea();
  if (target === current) return { area: current, moved: 0 };

  const list = await readArea(current);
  try {
    await writeArea(target, list);
  } catch (e) {
    return { area: current, moved: 0, error: String((e && e.message) || e) };
  }
  await patchSettings({ area: target });
  await clearArea(current);
  return { area: target, moved: list.length };
}

async function read() {
  return readArea(await getArea());
}

async function write(list) {
  await writeArea(await getArea(), list);
}

export async function getAll() {
  return read();
}

export async function getByKey(key) {
  const list = await read();
  return list.find((x) => x.key === key) || null;
}

function pricePoint(price, at) {
  return {
    amount: price.amount,
    currency: price.currency,
    raw: price.raw,
    at,
  };
}

function hasNewPrice(record, price) {
  if (!price || price.amount == null) return false;
  const hist = record.priceHistory || [];
  const last = hist[hist.length - 1];
  return (
    !last || last.amount !== price.amount || last.currency !== price.currency
  );
}

// Insert a freshly captured listing, or refresh an existing one while keeping
// user-authored fields (notes / tags / status) intact. Returns { record, created }.
export async function upsert(payload) {
  const list = await read();
  const now = Date.now();
  const key = recordKey(normalize(payload));
  const idx = list.findIndex((x) => x.key === key);

  if (idx === -1) {
    const record = {
      ...payload,
      provider: payload.provider || DEFAULT_PROVIDER,
      key,
      notes: "",
      tags: [],
      status: "kaydedildi",
      removed: false,
      removedAt: null,
      savedAt: now,
      updatedAt: now,
      lastSeenAt: now,
      priceHistory:
        payload.price && payload.price.amount != null
          ? [pricePoint(payload.price, now)]
          : [],
    };
    list.push(record);
    await write(list);
    return { record, created: true };
  }

  const existing = list[idx];
  const merged = {
    ...existing,
    // refresh captured fields
    title: payload.title ?? existing.title,
    url: payload.url ?? existing.url,
    slug: payload.slug ?? existing.slug,
    category: payload.category ?? existing.category,
    baseCategory: payload.baseCategory ?? existing.baseCategory,
    listingType: payload.listingType ?? existing.listingType,
    devren: payload.devren ?? existing.devren,
    location: payload.location ?? existing.location,
    geo: payload.geo ?? existing.geo,
    attributes: payload.attributes ?? existing.attributes,
    attributesTyped: payload.attributesTyped ?? existing.attributesTyped,
    features: payload.features ?? existing.features,
    contact: payload.contact ?? existing.contact,
    description: payload.description ?? existing.description,
    photos: payload.photos ?? existing.photos,
    media: payload.media ?? existing.media,
    raw: payload.raw ?? existing.raw,
    thumbnail: payload.thumbnail ?? existing.thumbnail,
    ilanTarihi: payload.ilanTarihi ?? existing.ilanTarihi,
    ilanTarihiTs: payload.ilanTarihiTs ?? existing.ilanTarihiTs,
    price: payload.price ?? existing.price,
    updatedAt: now,
    lastSeenAt: now,
    // Seeing it live again clears any prior "removed" mark (re-listed).
    removed: false,
    removedAt: null,
  };
  if (hasNewPrice(existing, payload.price)) {
    merged.priceHistory = [
      ...(existing.priceHistory || []),
      pricePoint(payload.price, now),
    ];
  }
  list[idx] = merged;
  await write(list);
  return { record: merged, created: false };
}

// Passive "I looked at this listing again" ping from the content script. Only
// does anything if the listing is already saved — used purely to grow price
// history without the user re-saving. Returns { tracked, priceChanged }.
export async function recordSeen(payload) {
  const list = await read();
  const key = recordKey(normalize(payload));
  const idx = list.findIndex((x) => x.key === key);
  if (idx === -1) return { tracked: false, priceChanged: false };

  const existing = list[idx];
  const now = Date.now();
  let priceChanged = false;
  if (hasNewPrice(existing, payload.price)) {
    existing.priceHistory = [
      ...(existing.priceHistory || []),
      pricePoint(payload.price, now),
    ];
    existing.price = payload.price;
    priceChanged = true;
  }
  existing.lastSeenAt = now;
  // Seen live -> not removed (in case it was previously marked, now re-listed).
  existing.removed = false;
  existing.removedAt = null;
  list[idx] = existing;
  await write(list);
  return { tracked: true, priceChanged };
}

// Mark a saved listing as removed/expired (the page no longer shows it). Leaves
// the user's workflow status untouched — removal is a lifecycle fact, not a
// workflow state. No-op if the listing isn't saved or is already marked.
export async function markRemoved(key) {
  const list = await read();
  const idx = list.findIndex((x) => x.key === key);
  if (idx === -1) return { tracked: false, removed: false };
  if (!list[idx].removed) {
    list[idx] = { ...list[idx], removed: true, removedAt: Date.now() };
    await write(list);
  }
  return { tracked: true, removed: true };
}

export async function updateByKey(key, patch) {
  const list = await read();
  const idx = list.findIndex((x) => x.key === key);
  if (idx === -1) return null;
  list[idx] = { ...list[idx], ...patch, updatedAt: Date.now() };
  await write(list);
  return list[idx];
}

export async function removeByKey(key) {
  const list = await read();
  const next = list.filter((x) => x.key !== key);
  await write(next);
  return next.length !== list.length;
}

export async function clearAll() {
  await write([]);
}

// Merge imported records (from a JSON backup) into current data by key.
export async function importListings(incoming, { replace = false } = {}) {
  const current = replace ? [] : await read();
  const byKey = new Map(current.map((x) => [x.key, x]));
  let added = 0;
  for (const raw of incoming) {
    if (!raw || !raw.ilanNo) continue;
    const rec = normalize(raw);
    if (!byKey.has(rec.key)) added += 1;
    byKey.set(rec.key, { ...(byKey.get(rec.key) || {}), ...rec });
  }
  const list = [...byKey.values()];
  await write(list);
  return { total: list.length, added };
}
