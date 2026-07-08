// Background service worker (ES module). Single place that persists data, so
// content scripts (which can't import the store) route writes through here.
// Also runs the periodic "re-check" nudge (see src/lib/recheck.js).

import * as store from "../lib/store.js";
import { staleCount } from "../lib/recheck.js";

const RECHECK_ALARM = "emt-recheck";
const RECHECK_PERIOD_MIN = 720; // 12h
const STALE_DAYS = 7;

// Show how many saved listings haven't been revisited in a while, nudging the
// user to reopen them (which refreshes the price via the passive SEEN flow).
async function refreshBadge() {
  try {
    const list = await store.getAll();
    const n = staleCount(list, Date.now(), STALE_DAYS);
    await chrome.action.setBadgeText({ text: n ? String(n) : "" });
    if (n) {
      await chrome.action.setBadgeBackgroundColor({ color: "#c62828" });
      await chrome.action.setTitle({
        title: `Emlak Takip — ${n} ilan bir haftadır görüntülenmedi`,
      });
    } else {
      await chrome.action.setTitle({ title: "" });
    }
  } catch {
    // action/badge APIs may be briefly unavailable during worker startup
  }
}

function ensureAlarm() {
  chrome.alarms.create(RECHECK_ALARM, { periodInMinutes: RECHECK_PERIOD_MIN });
}

chrome.runtime.onInstalled.addListener(() => {
  ensureAlarm();
  refreshBadge();
});
chrome.runtime.onStartup.addListener(() => {
  ensureAlarm();
  refreshBadge();
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RECHECK_ALARM) refreshBadge();
});
// Keep the badge current whenever stored data changes (local or sync).
chrome.storage.onChanged.addListener((changes) => {
  if (changes.ilanlar) refreshBadge();
});

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
        case "MARK_REMOVED": {
          const res = await store.markRemoved(msg.key);
          sendResponse({ ok: true, ...res });
          break;
        }
        case "MAYBE_AUTOSAVE": {
          // Save on load only when auto-save is enabled and it isn't saved yet.
          if (!(await store.getAutoSave())) {
            sendResponse({ ok: true, autoSave: false, saved: false });
            break;
          }
          const existing = await store.getByKey(msg.payload.key);
          if (existing) {
            sendResponse({
              ok: true,
              autoSave: true,
              saved: true,
              created: false,
            });
            break;
          }
          const res = await store.upsert(msg.payload);
          sendResponse({ ok: true, autoSave: true, saved: true, ...res });
          break;
        }
        case "CHECK_SAVED": {
          const record = await store.getByKey(msg.key);
          sendResponse({ ok: true, saved: !!record, record });
          break;
        }
        case "FETCH_JSON": {
          // Providers use this to read a site's own listing API. Runs in the
          // worker (host_permissions, no page CSP). Sahibinden only for now
          // (the sole active provider); widen when others are re-enabled.
          const allowed = /^https:\/\/(www\.)?sahibinden\.com\//.test(msg.url);
          if (!allowed) {
            sendResponse({ ok: false, error: "host not allowed" });
            break;
          }
          try {
            const res = await fetch(msg.url, { credentials: "include" });
            const data = await res.json();
            sendResponse({ ok: res.ok, status: res.status, data });
          } catch (e) {
            sendResponse({ ok: false, error: String(e) });
          }
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
