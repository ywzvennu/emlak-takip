// Minimal in-memory stand-in for the slice of chrome.* that store.js uses:
// chrome.storage.local.get(key) and chrome.storage.local.set(obj).
export function installChromeMock() {
  const backing = {};
  const chrome = {
    storage: {
      local: {
        async get(key) {
          if (key == null) return { ...backing };
          if (typeof key === "string") return { [key]: backing[key] };
          // object/array form: return the requested keys
          const keys = Array.isArray(key) ? key : Object.keys(key);
          const out = {};
          for (const k of keys) out[k] = backing[k];
          return out;
        },
        async set(obj) {
          Object.assign(backing, obj);
        },
        async clear() {
          for (const k of Object.keys(backing)) delete backing[k];
        },
      },
    },
  };
  globalThis.chrome = chrome;
  return { chrome, backing };
}
