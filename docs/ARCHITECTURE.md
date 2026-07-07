# Architecture

Emlak Takip is a Manifest V3 extension with **no build step** and **no runtime
dependencies**. Everything ships as plain files loaded straight by the browser.
The dev tooling (ESLint, Prettier, jsdom-backed tests) is dev-only and never
shipped.

## Data flow

```
listing page ─DOM─▶ provider field methods ─▶ capture.js buildRecord(+key)
                                                │
                    inject.js (button / SEEN) ──┤
                            popup.js (preview) ──┤ messages
                                                ▼
                                  background/service_worker.js
                                                │
                                                ▼
                                         lib/store.js  ──▶ chrome.storage.local
                                                ▲
                                dashboard.js ──┘ (reads/updates directly)
```

- **Content scripts** (`src/providers/*`, `src/content/*`) run in the page. They
  never import the store; they message the background worker, which owns writes.
- **Extension pages** (`popup`, `dashboard`) import `store.js` directly.
- **`store.js` is the only file that touches `chrome.storage`.** Swapping the
  backend (e.g. `chrome.storage.sync`) is a change to `read`/`write` alone.

## Providers

Site adapters live in `src/providers/`. A provider is a plain object with a
`matches(url)` and **one method per captured field** — the same method names for
every provider (the "field contract"):

```js
{
  id: "sahibinden",              // stable slug, also the key namespace
  name: "Sahibinden",            // display name
  matches(url): boolean,         // true for this site's listing DETAIL pages
  // field methods — each (doc, url) returns that field (or nothing -> default):
  ilanNo, title, category, listingType, price, location, geo,
  attributes, features, contact, description, photos, thumbnail, ilanTarihi,
}
```

`registry.js` (loaded first) exposes `self.EmlakTakip` with `register()`,
`getProvider(url)`, the canonical `FIELDS` list, and `buildRecord(provider, doc,
url)` — the generic assembler that calls each field method and stamps
`provider` + composite `key`. `capture.js` is a thin dispatcher: pick the
matching provider, call `buildRecord`. No site-specific logic lives outside a
provider, and adding a site never touches the assembler.

Provider files are classic scripts (no `import`/`export`) so they work both as
content scripts and as side-effect imports in Node tests, where they attach to
`globalThis` instead of the page's `self`. Low-level helpers (DOM, JSON-LD, og,
price/classify) live in `providers/util.js` (`EmlakTakipUtil`) so field methods
stay one-liners.

Two extraction strategies, both behind the same contract:

- **DOM selectors** (`sahibinden.js`) — server-rendered; selectors live in a
  `SELECTORS` object with fallbacks.
- **JSON-LD / og-meta** (`hepsiemlak.js`, `emlakjet.js`) — client-rendered SPAs.
  Field methods read schema.org JSON-LD when present, else fall back to og-meta
  and a BreadcrumbList (e.g. emlakjet exposes only breadcrumbs plus og). The
  listing id is the longest digit-run in the URL, so ids after `-` or `/` both
  work. Capture runs on a full page load of the detail URL (client-side
  navigation does not re-run the content script).

### Adding a provider

1. Add `src/providers/<site>.js` implementing `matches` + the field methods
   (reuse `EmlakTakipUtil` helpers). Return `{}`/`[]`/`null` for fields the site
   doesn't expose.
2. Register it in `manifest.json`:
   - add its file to `content_scripts[].js` (before `capture.js`),
   - add its listing URL glob to `content_scripts[].matches`,
   - add its origin to `host_permissions`.
3. Add a synthetic fixture under `test/fixtures/` (never a real listing) and
   cover it in `test/providers.test.js`.

Nothing in storage, the popup, the dashboard or the background worker should
need to change to support a new site.

## Normalized record schema

Field methods produce the **captured** fields; `store.upsert()` adds the
**user/bookkeeping** fields. Identity is the composite `key`.

| Field          | Source   | Notes                                                            |
| -------------- | -------- | ---------------------------------------------------------------- |
| `provider`     | dispatch | provider id, e.g. `"sahibinden"`                                 |
| `ilanNo`       | parse    | site listing id (string)                                         |
| `key`          | dispatch | `` `${provider}:${ilanNo}` `` — the unique key                   |
| `url`          | parse    | canonical listing URL                                            |
| `title`        | parse    |                                                                  |
| `category`     | parse    | `konut` / `ticari` / `arsa` / `diger`                            |
| `listingType`  | parse    | `satilik` / `kiralik`                                            |
| `price`        | parse    | `{ amount, currency, raw }`                                      |
| `location`     | parse    | `{ il, ilce, mahalle, raw }`                                     |
| `geo`          | parse    | `{ lat, lng, source }` or `null`                                 |
| `attributes`   | parse    | full key→value map of the listing's spec rows                    |
| `features`     | parse    | grouped selected features `{ group: [items] }` (e.g. Özellikler) |
| `contact`      | parse    | `{ name, agency, phone, phones[], type, profileUrl }` or `null`  |
| `description`  | parse    | full listing free text or `null`                                 |
| `photos`       | parse    | gallery image URLs (string[])                                    |
| `thumbnail`    | parse    | preview image URL                                                |
| `ilanTarihi`   | parse    | listing date (site-formatted string)                             |
| `capturedAt`   | parse    | epoch ms when parsed                                             |
| `notes`        | store    | user free text                                                   |
| `tags`         | store    | user tags (string[])                                             |
| `status`       | store    | `kaydedildi` / `ilgileniliyor` / `arandi` / `elendi`             |
| `savedAt`      | store    | first saved (epoch ms)                                           |
| `updatedAt`    | store    | last write (epoch ms)                                            |
| `lastSeenAt`   | store    | last passive view (epoch ms)                                     |
| `priceHistory` | store    | `[{ amount, currency, raw, at }]`, grows on change               |

`contact`, `geo`, `photos` and `description` are best-effort: a provider fills
them when the page exposes them, otherwise they are `null`/empty. Their
selectors are the most likely to drift and should be re-checked against a live
page periodically.

## Identity & migration

Records are keyed by `` `${provider}:${ilanNo}` `` so listings that share a
numeric id across different sites never overwrite each other. Legacy records
(saved before providers existed) are migrated on read by `store.normalize()`:
they get `provider: "sahibinden"` and a derived `key`. Migration is transparent
and persists on the next write.
