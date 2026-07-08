// Content script (classic, runs after capture.js). Owns the page UI and talks
// to the background worker:
//   - injects a floating "Kaydet" button on listing detail pages
//   - reflects saved state, auto-saves (if enabled), sends a passive SEEN ping
//   - responds to the popup's CAPTURE request
//
// Sahibinden is server-rendered: every detail page is a full navigation that
// re-injects this script, so we only run on load (plus one delayed retry for
// anything the page fills in late) — no SPA URL-polling needed.
(function () {
  const cap = self.EmlakTakipCapture;
  if (!cap || !cap.captureIlan) return;
  const { captureIlan, isIlanDetail } = cap;

  const t = (key, subs) => chrome.i18n.getMessage(key, subs) || key;

  function send(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (res) => {
          if (chrome.runtime.lastError)
            resolve({ ok: false, error: chrome.runtime.lastError.message });
          else resolve(res || { ok: false });
        });
      } catch (e) {
        resolve({ ok: false, error: String(e) });
      }
    });
  }

  function toast(msg) {
    let el = document.getElementById("emt-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "emt-toast";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add("emt-toast--show");
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove("emt-toast--show"), 2200);
  }

  let btn = null;

  function ensureButton() {
    if (btn && btn.isConnected) return btn;
    btn = document.createElement("button");
    btn.id = "emt-save-btn";
    btn.type = "button";
    btn.addEventListener("click", onSaveClick);
    setButton(false);
    document.body.appendChild(btn);
    return btn;
  }

  function removeButton() {
    if (btn) {
      btn.remove();
      btn = null;
    }
  }

  function setButton(saved) {
    if (!btn) return;
    btn.classList.toggle("emt-saved", saved);
    const star = saved ? "★" : "☆";
    const label = saved ? t("btnSaved") : t("btnSave");
    btn.innerHTML = `<span class="emt-star">${star}</span> ${label}`;
    btn.title = saved ? t("btnSavedTip") : t("btnSaveTip");
  }

  async function onSaveClick() {
    const payload = await captureIlan();
    if (!payload) {
      toast(t("toastReadFail"));
      return;
    }
    btn.disabled = true;
    const res = await send({ type: "SAVE_ILAN", payload });
    btn.disabled = false;
    if (res && res.ok) {
      setButton(true);
      toast(res.created ? t("toastSaved") : t("toastUpdated"));
    } else {
      toast(t("toastSaveFail", (res && res.error) || "?"));
    }
  }

  // Once per listing (keyed) we auto-save / send the passive SEEN ping.
  const handled = new Set();

  async function process() {
    if (!isIlanDetail()) {
      removeButton();
      return;
    }
    ensureButton();
    const payload = await captureIlan();
    if (!payload) return; // detail URL, page not rendered yet — a retry follows

    const check = await send({ type: "CHECK_SAVED", key: payload.key });
    if (check && check.ok) setButton(check.saved);

    if (handled.has(payload.key)) return;
    handled.add(payload.key);

    if (!check || !check.saved) {
      const auto = await send({ type: "MAYBE_AUTOSAVE", payload });
      if (auto && auto.ok && auto.saved) {
        setButton(true);
        if (auto.created) toast(t("toastAutoSaved"));
      }
    }
    send({ type: "SEEN_ILAN", payload });
  }

  // Run now and once more shortly after, to catch content the page fills in late.
  process();
  setTimeout(process, 1200);

  // Popup asks the active tab to capture what's on screen.
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === "CAPTURE") {
      captureIlan().then((payload) => sendResponse({ ok: true, payload }));
      return true; // async response
    }
    return false;
  });
})();
