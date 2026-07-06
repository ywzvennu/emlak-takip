# Architecture

Emlak Takip is a Manifest V3 extension with **no build step** and **no runtime
dependencies**. Everything ships as plain files loaded straight by the browser.
The dev tooling (ESLint, Prettier, jsdom-backed tests) is dev-only and never
shipped.

## Data flow

```
listing page ──DOM──▶ provider.parse() ──▶ capture.js (stamps provider+key)
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

Site adapters live in `src/providers/`. A provider is a plain object:

```js
{
  id: "sahibinden",          // stable slug, also the key namespace
  name: "Sahibinden",        // display name
  matches(url): boolean,     // true for this site's listing DETAIL pages
  parse(document, url): record | null,  // DOM-only, no network
}
```

`registry.js` (loaded first) exposes `self.EmlakTakip` with `register()` and
`getProvider(url)`. Each provider file registers itself on load. `capture.js` is
a **generic dispatcher**: it asks the registry for the provider matching the
current URL, calls `parse()`, and stamps the result with `provider` and the
composite `key`. No site-specific selectors live outside a provider.

Provider files are classic scripts (no `import`/`export`) so they work both as
content scripts and as side-effect imports in Node tests, where they attach to
`globalThis` instead of the page's `self`.

### Adding a provider

1. Add `src/providers/<site>.js` implementing the interface above.
2. Register it in `manifest.json`:
   - add its file to `content_scripts[].js` (before `capture.js`),
   - add its listing URL glob to `content_scripts[].matches`,
   - add its origin to `host_permissions`.
3. Add a fixture under `test/fixtures/` and cover `parse()` in
   `test/providers.test.js`.

Nothing in storage, the popup, the dashboard or the background worker should
need to change to support a new site.

## Normalized record schema

`parse()` returns the **captured** fields; `store.upsert()` adds the
**user/bookkeeping** fields. Identity is the composite `key`.

| Field          | Source   | Notes                                                           |
| -------------- | -------- | --------------------------------------------------------------- |
| `provider`     | dispatch | provider id, e.g. `"sahibinden"`                                |
| `ilanNo`       | parse    | site listing id (string)                                        |
| `key`          | dispatch | `` `${provider}:${ilanNo}` `` — the unique key                  |
| `url`          | parse    | canonical listing URL                                           |
| `title`        | parse    |                                                                 |
| `category`     | parse    | `konut` / `ticari` / `arsa` / `diger`                           |
| `listingType`  | parse    | `satilik` / `kiralik`                                           |
| `price`        | parse    | `{ amount, currency, raw }`                                     |
| `location`     | parse    | `{ il, ilce, mahalle, raw }`                                    |
| `geo`          | parse    | `{ lat, lng, source }` or `null`                                |
| `attributes`   | parse    | full key→value map of the listing's spec rows                   |
| `contact`      | parse    | `{ name, agency, phone, phones[], type, profileUrl }` or `null` |
| `description`  | parse    | full listing free text or `null`                                |
| `photos`       | parse    | gallery image URLs (string[])                                   |
| `thumbnail`    | parse    | preview image URL                                               |
| `ilanTarihi`   | parse    | listing date (site-formatted string)                            |
| `capturedAt`   | parse    | epoch ms when parsed                                            |
| `notes`        | store    | user free text                                                  |
| `tags`         | store    | user tags (string[])                                            |
| `status`       | store    | `kaydedildi` / `ilgileniliyor` / `arandi` / `elendi`            |
| `savedAt`      | store    | first saved (epoch ms)                                          |
| `updatedAt`    | store    | last write (epoch ms)                                           |
| `lastSeenAt`   | store    | last passive view (epoch ms)                                    |
| `priceHistory` | store    | `[{ amount, currency, raw, at }]`, grows on change              |

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
