// Content script (classic, runs after capture.js). Owns everything that touches
// the page UI and talks to the background worker:
//   - injects a floating "Kaydet" button on ilan detail pages
//   - responds to the popup's CAPTURE request
//   - on load, sends a passive SEEN ping so price history can grow

(function () {
  const { captureIlan, isIlanDetail } = self.EmlakTakipCapture || {};
  if (!captureIlan || !isIlanDetail || !isIlanDetail()) return;

  const t = (key, subs) => chrome.i18n.getMessage(key, subs) || key;

  function send(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (res) => {
          if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
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

  const btn = document.createElement("button");
  btn.id = "emt-save-btn";
  btn.type = "button";
  setButton(false);
  document.body.appendChild(btn);

  function setButton(saved) {
    btn.classList.toggle("emt-saved", saved);
    const star = saved ? "★" : "☆";
    const label = saved ? t("btnSaved") : t("btnSave");
    btn.innerHTML = `<span class="emt-star">${star}</span> ${label}`;
    btn.title = saved ? t("btnSavedTip") : t("btnSaveTip");
  }

  btn.addEventListener("click", async () => {
    const payload = captureIlan();
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
  });

  // Reflect current saved state + record a passive view for price history.
  (async () => {
    const payload = captureIlan();
    if (!payload) return;
    const check = await send({ type: "CHECK_SAVED", ilanNo: payload.ilanNo });
    if (check && check.ok) setButton(check.saved);
    send({ type: "SEEN_ILAN", payload });
  })();

  // Popup asks the active tab to capture what's on screen.
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === "CAPTURE") {
      sendResponse({ ok: true, payload: captureIlan() });
    }
    return false;
  });
})();
