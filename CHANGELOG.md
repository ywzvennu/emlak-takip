# Changelog

All notable changes to this project. This file also serves as the record of work
that predates the current repository (the repo was rebuilt from scrubbed history
to remove accidentally-committed sample data; the original PR threads did not
carry over).

## [Unreleased]

### Added

- **Price-pool backend** (`server/`) — a zero-dependency Node service
  (`node:http` + `node:sqlite`) that ingests bare price observations
  (`{key, amount, currency, at}` — no PII) via `POST /v1/observations` and
  serves the merged, multi-contributor price history per listing via
  `POST /v1/history`, with a distinct-observer count per price point.
  Anonymous + client `contributorId`, payload validation, and per-IP rate
  limiting. Client wiring, auth and anti-poisoning are deferred. See
  `server/README.md`.
- **Provider architecture** — a pluggable registry where every provider
  implements the same named field methods (`ilanNo`, `title`, `price`,
  `location`, `geo`, `attributes`, `features`, `contact`, `description`,
  `photos`, `thumbnail`, `ilanTarihi`) plus an ordered `sources` chain. A
  generic assembler builds the record; adding a site is one file.
- **Providers**: Sahibinden (DOM), Hepsiemlak (reads the `realtyDetail` JSON
  embedded in the page — DOM, no network — with its same-origin API as a
  fallback), Emlakjet (og-meta + breadcrumb).
- **Capture everything** — full attribute table, the Özellikler feature groups,
  seller/agent contact, all gallery photos, description, and geo coordinates,
  plus a `raw` payload per record so no detail is lost while the normalized
  model is still settling.
- **Map view** of saved listings (vendored Leaflet + OpenStreetMap tiles).
- **Dark mode** (System / Light / Dark) for the popup and dashboard.
- **In-extension language switcher** (Auto / Türkçe / English), independent of
  the browser UI language.
- **Auto-save mode** — save supported listings on page load without clicking.
- **Periodic revisit reminder** via `chrome.alarms` (badge only; stays
  DOM-only, no background fetch).
- **`chrome.storage.sync` toggle** with graceful fallback on quota.
- **Release packaging** — `.zip` build + version-bump scripts + release workflow.
- **Dev tooling** — ESLint, Prettier, `node:test` suites, GitHub Actions CI,
  issue/PR templates, `CONTRIBUTING.md`, `docs/ARCHITECTURE.md`.

### Changed

- **Devren is a transaction type**, alongside satılık/kiralık — the listing type
  is `devren-satilik` / `devren-kiralik`, and `category` stays the property type
  (konut/ticari/arsa). The type filter offers all four; the type badge shows
  "Devren Satılık/Kiralık" (amber). Saved records migrate on read.
- **Typed attribute values** — alongside the raw `attributes` strings, records
  now carry `attributesTyped` (integers like Aidat/m², floats like Kaks,
  booleans for Var-Yok/Evet-Hayır fields) and `ilanTarihiTs` (the listing date
  parsed from "26 Haziran 2026" to a timestamp). Adds a "listing date" sort and
  ISO date columns to CSV.
- **Richer contact capture** — the individual agent's name is now captured
  separately from the agency, and phones are structured and labelled (İş/Cep).
  Individual-seller names (rendered via a CSS `::before` rule) are read too, and
  sahibinden's `0850` support line is no longer mistaken for a seller number.
  Popup + dashboard show the agent and all phones; CSV gains an `agentName`
  column.
- **Listing media capture** — video (HLS url + poster + upload date from the
  page's `VideoObject` JSON-LD) plus availability of İlan Klibi, HD Video, Sanal
  Tur and SahiDeko (from the media tab bar). Shown as icons on dashboard cards
  and exported to CSV.
- **Removed/expired listing detection** — revisiting a saved listing that
  sahibinden no longer publishes marks it (a dedicated `removed` flag, separate
  from the user's workflow status) and shows a red "Yayından kaldırıldı" badge +
  dimmed card + filter in the dashboard. Detection is conservative (only when
  the live-listing markers are gone), and the mark clears automatically if the
  listing is seen live again. Also added dashboard list ↔ map jump navigation.
- **Devren (business-transfer) listings** are now captured as a distinct
  `devren` flag (from the slug), shown as a badge in the popup + dashboard,
  filterable in the dashboard, and included in CSV export.
- **Category-aware spec line** — the popup/dashboard one-line summary now shows
  the attributes that matter per category (konut: oda/m²/aidat; arsa:
  imar/kaks/m² fiyatı; ticari: tür/yapı durumu). Shared `fmtPrice`/`fmtPhone`/
  `specLine` helpers were centralized into `src/lib/format.js` and unit-tested.
- **Focused on Sahibinden as the sole active provider.** The running extension
  now matches and requests only `sahibinden.com`; the Hepsiemlak/Emlakjet
  provider code and tests are kept in-tree to re-enable once verified. Dropped
  the SPA URL-polling from the content script (Sahibinden is server-rendered).

### Fixed

- Composite `provider:ilanNo` record key so ids can't collide across sites.
- Detection for hepsiemlak ids that follow a `/` and for emlakjet's og/breadcrumb
  data.
- Extension pages translate from fetched `_locales` (not `chrome.i18n`'s cached
  table), so new strings appear on reload.
- Capture re-runs on SPA client-side navigation (hepsiemlak/emlakjet).

### Notes

- Provider parsers are validated against **synthetic fixtures only** — no real
  listing data is committed.
- GitHub Actions has been billing-blocked on the account, so merges are gated on
  local `lint` + `format:check` + `test`.
