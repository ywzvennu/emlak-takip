// Pure validators for the price-pool wire format. No I/O, no sqlite — so these
// unit-test without the --experimental-sqlite flag and are reused by the HTTP
// layer to reject bad input before it reaches the DB.

export const CURRENCIES = ["TL", "USD", "EUR"];
export const MAX_OBSERVATIONS = 1000;
export const MAX_KEYS = 500;

// Plausible epoch-ms window for an observation timestamp: not before 2015, not
// more than a day into the future (clock skew tolerance).
const MIN_AT = Date.UTC(2015, 0, 1);
const KEY_RE = /^[a-z0-9]+:\d+$/;
const CONTRIBUTOR_RE = /^[A-Za-z0-9-]{8,64}$/;
const MAX_AMOUNT = 1e12;

export function isValidKey(key) {
  return typeof key === "string" && KEY_RE.test(key);
}

export function isValidContributorId(id) {
  return typeof id === "string" && CONTRIBUTOR_RE.test(id);
}

// A single price atom { key, amount, currency, at }. `now` is injectable so the
// future-bound check is deterministic in tests.
export function isValidObservation(o, now = Date.now()) {
  return !!(
    o &&
    typeof o === "object" &&
    isValidKey(o.key) &&
    Number.isInteger(o.amount) &&
    o.amount > 0 &&
    o.amount < MAX_AMOUNT &&
    CURRENCIES.includes(o.currency) &&
    Number.isInteger(o.at) &&
    o.at >= MIN_AT &&
    o.at <= now + 86400000
  );
}

// Partition a submission into valid atoms and a rejected count. Caps the batch
// size (excess is rejected, not silently dropped).
export function partitionObservations(observations, now = Date.now()) {
  if (!Array.isArray(observations)) return { valid: [], rejected: 0 };
  const capped = observations.slice(0, MAX_OBSERVATIONS);
  const overflow = observations.length - capped.length;
  const valid = [];
  let rejected = overflow;
  for (const o of capped) {
    if (isValidObservation(o, now)) valid.push(o);
    else rejected += 1;
  }
  return { valid, rejected };
}

// The keys accepted by a /v1/history request: valid, unique, capped.
export function sanitizeKeys(keys) {
  if (!Array.isArray(keys)) return [];
  const seen = new Set();
  for (const k of keys) {
    if (isValidKey(k)) seen.add(k);
    if (seen.size >= MAX_KEYS) break;
  }
  return [...seen];
}
