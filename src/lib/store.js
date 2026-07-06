// Storage / data layer.
//
// Today this is backed by chrome.storage.local (single browser). It is written
// so that swapping in chrome.storage.sync or a remote backend later only means
// changing `read`/`write` — nothing else in the extension touches storage
// directly. Imported by the background service worker, the popup and the
// dashboard (all extension pages with storage access). Content scripts do NOT
// import this; they message the background worker instead.

const KEY = "ilanlar";

// Canonical domain values. Human-readable labels live in src/lib/i18n.js so
// they can be localized; keep the value order here as the display order.
export const STATUS_VALUES = ["kaydedildi", "ilgileniliyor", "arandi", "elendi"];
export const CATEGORY_VALUES = ["konut", "ticari", "arsa", "diger"];
export const TYPE_VALUES = ["satilik", "kiralik"];

async function read() {
  const data = await chrome.storage.local.get(KEY);
  return Array.isArray(data[KEY]) ? data[KEY] : [];
}

async function write(list) {
  await chrome.storage.local.set({ [KEY]: list });
}

export async function getAll() {
  return read();
}

export async function getByIlanNo(ilanNo) {
  const list = await read();
  return list.find((x) => x.ilanNo === ilanNo) || null;
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
  return !last || last.amount !== price.amount || last.currency !== price.currency;
}

// Insert a freshly captured listing, or refresh an existing one while keeping
// user-authored fields (notes / tags / status) intact. Returns { record, created }.
export async function upsert(payload) {
  const list = await read();
  const now = Date.now();
  const idx = list.findIndex((x) => x.ilanNo === payload.ilanNo);

  if (idx === -1) {
    const record = {
      ...payload,
      notes: "",
      tags: [],
      status: "kaydedildi",
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
    listingType: payload.listingType ?? existing.listingType,
    location: payload.location ?? existing.location,
    attributes: payload.attributes ?? existing.attributes,
    thumbnail: payload.thumbnail ?? existing.thumbnail,
    ilanTarihi: payload.ilanTarihi ?? existing.ilanTarihi,
    price: payload.price ?? existing.price,
    updatedAt: now,
    lastSeenAt: now,
  };
  if (hasNewPrice(existing, payload.price)) {
    merged.priceHistory = [...(existing.priceHistory || []), pricePoint(payload.price, now)];
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
  const idx = list.findIndex((x) => x.ilanNo === payload.ilanNo);
  if (idx === -1) return { tracked: false, priceChanged: false };

  const existing = list[idx];
  const now = Date.now();
  let priceChanged = false;
  if (hasNewPrice(existing, payload.price)) {
    existing.priceHistory = [...(existing.priceHistory || []), pricePoint(payload.price, now)];
    existing.price = payload.price;
    priceChanged = true;
  }
  existing.lastSeenAt = now;
  list[idx] = existing;
  await write(list);
  return { tracked: true, priceChanged };
}

export async function updateRecord(ilanNo, patch) {
  const list = await read();
  const idx = list.findIndex((x) => x.ilanNo === ilanNo);
  if (idx === -1) return null;
  list[idx] = { ...list[idx], ...patch, updatedAt: Date.now() };
  await write(list);
  return list[idx];
}

export async function remove(ilanNo) {
  const list = await read();
  const next = list.filter((x) => x.ilanNo !== ilanNo);
  await write(next);
  return next.length !== list.length;
}

export async function clearAll() {
  await write([]);
}

// Merge imported records (from a JSON backup) into current data by ilanNo.
export async function importListings(incoming, { replace = false } = {}) {
  const current = replace ? [] : await read();
  const byId = new Map(current.map((x) => [x.ilanNo, x]));
  let added = 0;
  for (const rec of incoming) {
    if (!rec || !rec.ilanNo) continue;
    if (!byId.has(rec.ilanNo)) added += 1;
    byId.set(rec.ilanNo, { ...(byId.get(rec.ilanNo) || {}), ...rec });
  }
  const list = [...byId.values()];
  await write(list);
  return { total: list.length, added };
}
