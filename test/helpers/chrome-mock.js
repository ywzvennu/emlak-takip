// Minimal in-memory stand-in for the slice of chrome.* the store uses:
// chrome.storage.local and chrome.storage.sync, each with get/set/remove/clear.
// The optional `syncItemLimit` simulates chrome.storage.sync's per-item byte
// quota so tests can exercise the graceful-fallback path.
function makeArea(backing, { itemLimit } = {}) {
  return {
    async get(key) {
      if (key == null) return { ...backing };
      if (typeof key === "string") return { [key]: backing[key] };
      const keys = Array.isArray(key) ? key : Object.keys(key);
      const out = {};
      for (const k of keys) out[k] = backing[k];
      return out;
    },
    async set(obj) {
      if (itemLimit) {
        for (const [k, v] of Object.entries(obj)) {
          const bytes = new TextEncoder().encode(JSON.stringify(v)).length;
          if (bytes > itemLimit) {
            throw new Error(`QUOTA_BYTES_PER_ITEM quota exceeded for "${k}"`);
          }
        }
      }
      Object.assign(backing, obj);
    },
    async remove(key) {
      for (const k of Array.isArray(key) ? key : [key]) delete backing[k];
    },
    async clear() {
      for (const k of Object.keys(backing)) delete backing[k];
    },
  };
}

export function installChromeMock({ syncItemLimit } = {}) {
  const localBacking = {};
  const syncBacking = {};
  const chrome = {
    storage: {
      local: makeArea(localBacking),
      sync: makeArea(syncBacking, { itemLimit: syncItemLimit }),
    },
  };
  globalThis.chrome = chrome;
  return { chrome, backing: localBacking, localBacking, syncBacking };
}
