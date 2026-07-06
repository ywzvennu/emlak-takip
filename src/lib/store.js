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

// Canonical domain values. Human-readable labels live in src/lib/i18n.js so
// they can be localized; keep the value order here as the display order.
export const STATUS_VALUES = [
  "kaydedildi",
  "ilgileniliyor",
  "arandi",
  "elendi",
];
export const CATEGORY_VALUES = ["konut", "ticari", "arsa", "diger"];
export const TYPE_VALUES = ["satilik", "kiralik"];

const DEFAULT_PROVIDER = "sahibinden";

export function keyOf(provider, ilanNo) {
  return `${provider || DEFAULT_PROVIDER}:${ilanNo}`;
}

function recordKey(rec) {
  return rec.key || keyOf(rec.provider, rec.ilanNo);
}

// Backfill provider/key on legacy records so old data keeps working.
export function normalize(rec) {
  if (!rec) return rec;
  const provider = rec.provider || DEFAULT_PROVIDER;
  return { ...rec, provider, key: rec.key || keyOf(provider, rec.ilanNo) };
}

export function normalizeList(list) {
  return Array.isArray(list) ? list.map(normalize) : [];
}

async function read() {
  const data = await chrome.storage.local.get(KEY);
  return normalizeList(data[KEY]);
}

async function write(list) {
  await chrome.storage.local.set({ [KEY]: list });
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
    geo: payload.geo ?? existing.geo,
    attributes: payload.attributes ?? existing.attributes,
    contact: payload.contact ?? existing.contact,
    description: payload.description ?? existing.description,
    photos: payload.photos ?? existing.photos,
    thumbnail: payload.thumbnail ?? existing.thumbnail,
    ilanTarihi: payload.ilanTarihi ?? existing.ilanTarihi,
    price: payload.price ?? existing.price,
    updatedAt: now,
    lastSeenAt: now,
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
  list[idx] = existing;
  await write(list);
  return { tracked: true, priceChanged };
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
