# Emlak Takip

A Brave/Chrome (Manifest V3) browser extension for saving Turkish real-estate
listings — **konut, ticari, arsa**, both **kiralık** and **satılık** — with
notes, tags, status tracking and price-change history.

It reads the listing page you're **already viewing** (DOM only — no scraping, no
background network requests), so it stays clear of anti-bot measures. Your data
stays local in your own browser.

## Features

- **Two ways to save**: a floating **Kaydet** button injected on listing detail
  pages, plus a toolbar popup that previews the parsed listing.
- **Captures the relevant fields**: title, price + currency, category & type,
  il/ilçe/mahalle, the full attribute list (m², oda sayısı, bina yaşı, imar
  durumu, …), thumbnail and listing id.
- **Your own fields**: free-text notes, custom tags, and a status.
- **Price history**: revisiting a saved listing records the new price, so you can
  see drops/increases on the dashboard.
- **Dashboard** (options page): filter by category / type / status / tag,
  full-text search, sort by date or price, edit inline, and **export/import** as
  JSON or CSV.
- **Map view**: see all (filtered) saved listings as pins on a map, using the
  captured coordinates. Uses a locally-bundled Leaflet and OpenStreetMap tiles —
  the map tiles are the only third-party network request, and only when you open
  the map.
- **Full capture**: seller/agent contact (name, agency, phone), map coordinates,
  the full description, gallery photos and every attribute row.
- **Local-first, sync-ready**: data lives in `chrome.storage.local`; all storage
  goes through `src/lib/store.js`, so moving to `chrome.storage.sync` or a
  backend later is a one-file change.

## Install (unpacked)

1. Open `brave://extensions` (or `chrome://extensions`).
2. Enable **Developer mode** (top-right).
3. **Load unpacked** → select this folder (the one with `manifest.json`).
4. Open a supported listing page and click **Kaydet** (bottom-right) or the
   toolbar icon.

Open the dashboard from the popup's **Panelim** button, or via the extension's
**Details → Extension options**.

## Project layout

```
manifest.json          # name/description via __MSG__ refs; default_locale = tr
_locales/
  tr/messages.json     # Turkish (default)
  en/messages.json     # English
src/
  providers/
    registry.js    # provider registry shared via the content-script global
    sahibinden.js  # Sahibinden adapter (URL slug + meta + DOM, robust fallbacks)
  content/
    capture.js     # generic dispatcher → picks the matching provider, parses
    inject.js      # floating save button, popup CAPTURE handler, price-seen ping
    inject.css
  background/
    service_worker.js  # message router → store (content scripts write via here)
  lib/
    store.js       # the only file that touches chrome.storage
    i18n.js        # t(), localizeDom(), category/type/status label helpers
    geo.js         # pure geo helpers (point/bounds/osmUrl) for the map view
  vendor/
    leaflet/       # bundled Leaflet (map view); no build step, no CDN
  popup/           # toolbar popup (preview + save)
  dashboard/       # options page (list, filter, edit, export/import)
  icons/           # generated PNGs
scripts/
  generate_icons.py
```

## Localization (i18n)

All user-facing strings live in `_locales/<lang>/messages.json` — never
hardcoded. Turkish is the default (`default_locale`), English is included; the
UI language follows the browser UI language automatically.

- **Manifest** strings use `__MSG_key__`.
- **Static HTML** uses `data-i18n="key"` (text) and
  `data-i18n-attr="placeholder:key;title:key"` (attributes), applied by
  `localizeDom()`.
- **Dynamic JS** strings use `t("key", subs)` (module pages) or
  `chrome.i18n.getMessage(...)` (content scripts).
- Domain value → label mapping (category/type/status) lives in
  `src/lib/i18n.js`, so `store.js` keeps only canonical values.

To add a language, drop in `_locales/<lang>/messages.json` with the same keys
(both existing catalogs are kept in parity).

## Notes on parsing

Each site lives behind a **provider adapter** in `src/providers/`. The
URL/`<meta>`-derived fields (listing id, category, type, title, image) are
stable. The DOM selectors for **price**, **location** and the **attribute list**
are the parts most likely to break if a site changes its markup — they're all
collected in the `SELECTORS` object inside the provider (e.g.
`src/providers/sahibinden.js`), each with a fallback, so adjusting them is a
one-place edit. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the
provider interface and the normalized record schema.

## Roadmap

- More provider adapters (Hepsiemlak, Emlakjet).
- `chrome.storage.sync` toggle for cross-device sync.
- Optional periodic price re-check via an alarm.
