# Price-pool backend

A tiny service that pools **price observations** contributed by opted-in
extension users and serves back the merged price history for listings a user
tracks. Only the bare atom `{ key, amount, currency, at }` ever leaves a client
— no names, phones, notes, photos or descriptions. See the extension's
`src/lib/store.js` for where those atoms come from (`pricePoint`, keyed
`provider:ilanNo`).

Node 22, built-in `node:http` + `node:sqlite`, **zero npm dependencies**.

## Run

```sh
npm run server            # node --experimental-sqlite server/index.js
# PORT=8787  DB_PATH=server/data/observations.db  (defaults)
```

`node:sqlite` is experimental in Node 22, so the `--experimental-sqlite` flag is
required (it prints one `ExperimentalWarning` — harmless). The DB directory
(`server/data/`) is gitignored.

## API

### `GET /v1/health`

`→ { "ok": true }`

### `POST /v1/observations` — contribute

```json
{
  "contributorId": "<opaque-uuid>",
  "observations": [
    {
      "key": "sahibinden:123",
      "amount": 2750000,
      "currency": "TL",
      "at": 1717200000000
    }
  ]
}
```

`→ { "accepted": <n valid>, "rejected": <n dropped> }`

Invalid atoms are dropped (not fatal). Rules: `key` = `^[a-z0-9]+:\d+$`,
`amount` a positive integer `< 1e12`, `currency` ∈ `TL|USD|EUR`, `at` epoch-ms
in a plausible window. `contributorId` must match `^[A-Za-z0-9-]{8,64}$` or the
whole request is `400`. Caps: 1000 observations/request.

### `POST /v1/history` — read pooled history

```json
{ "keys": ["sahibinden:123"] }
```

```json
{
  "histories": {
    "sahibinden:123": [
      {
        "amount": 2750000,
        "currency": "TL",
        "at": 1717200000000,
        "observers": 2
      },
      {
        "amount": 2600000,
        "currency": "TL",
        "at": 1725000000000,
        "observers": 1
      }
    ]
  }
}
```

Each point is a distinct `(amount, currency)` for that listing, with `at` = the
earliest time anyone saw it and `observers` = the count of **distinct
contributors** who reported it. Keys with no data are omitted. Caps: 500
keys/request. "You only see history for listings you ask about" — and the client
only asks for listings it has saved (reciprocity by construction).

## Model notes

- **Dedup**: one row per `(key, amount, currency, contributor)` — a contributor
  counts once per price point regardless of re-views, keeping `observers` honest
  and storage bounded.
- **Rate limit**: in-memory fixed window per client IP (default 60/min → `429`).
  Per-process; behind a proxy you'd read `X-Forwarded-For` and use a shared
  store.

## Deferred (the "rest")

Not in this cut: wiring the extension to call it (manifest host permission,
POST-capable worker message, opt-in `sharePrices` setting, sync + UI); real
auth; anti-poisoning trust policy (the `observers` count is the hook — no
filtering yet); deployment/TLS; the legal/ToS review.
