# Changelog

All notable changes to this project. This file also serves as the record of work
that predates the current repository (the repo was rebuilt from scrubbed history
to remove accidentally-committed sample data; the original PR threads did not
carry over).

## [Unreleased]

### Added

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
