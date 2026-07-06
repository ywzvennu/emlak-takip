// Background service worker (ES module). Single place that persists data, so
// content scripts (which can't import the store) route writes through here.

import * as store from "../lib/store.js";

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg && msg.type) {
        case "SAVE_ILAN": {
          const res = await store.upsert(msg.payload);
          sendResponse({ ok: true, ...res });
          break;
        }
        case "SEEN_ILAN": {
          const res = await store.recordSeen(msg.payload);
          sendResponse({ ok: true, ...res });
          break;
        }
        case "CHECK_SAVED": {
          const record = await store.getByIlanNo(msg.ilanNo);
          sendResponse({ ok: true, saved: !!record, record });
          break;
        }
        default:
          sendResponse({ ok: false, error: "unknown message type" });
      }
    } catch (e) {
      sendResponse({ ok: false, error: String(e) });
    }
  })();
  return true; // keep the message channel open for the async response
});
