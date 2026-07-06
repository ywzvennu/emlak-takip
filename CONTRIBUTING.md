# Contributing

Thanks for helping improve **Emlak Takip**. This is a Manifest V3 browser
extension written in plain JavaScript — no build step, no runtime dependencies.

## Getting set up

```bash
npm install        # dev tooling only (ESLint, Prettier); no runtime deps
```

### Load the extension

1. Open `brave://extensions` (or `chrome://extensions`).
2. Enable **Developer mode**.
3. **Load unpacked** → select the repo root (the folder with `manifest.json`).
4. After editing files, hit the reload icon on the extension card.

## Workflow

We work issue → branch → PR → merge.

1. **Open or pick an issue.** Every change should map to an issue.
2. **Branch off `main`** using a descriptive prefix:
   - `feat/<issue>-short-slug` — new capability
   - `fix/<issue>-short-slug` — bug fix
   - `chore/<issue>-short-slug` — tooling, docs, refactors
3. **Make the change**, keeping PRs focused on a single issue.
4. **Open a PR** into `main`. Fill in the template and reference the issue
   (`Closes #NN`).
5. **Merge** once checks and review look good. Squash-merge; delete the branch.

## Before you push

```bash
npm run lint          # ESLint (flat config, browser + webextension globals)
npm run format        # apply Prettier
npm run format:check  # verify formatting (what CI runs)
npm test              # node:test unit suites
```

All four must be clean. CI runs `lint`, `format:check` and `test` on every PR.

## Project layout

See [`README.md`](README.md#project-layout) for the file map. The key
boundaries:

- **`src/lib/store.js`** is the only file that touches `chrome.storage`.
- **Content scripts** (`src/content/`) never import modules; they message the
  background worker, which owns persistence.
- **No hardcoded user-facing strings** — everything lives in
  `_locales/<lang>/messages.json`. Add every new key to **both** `tr` and `en`
  (a test enforces parity).

## Releasing

```bash
npm run version:set 0.2.0   # bumps manifest.json + package.json together
npm run package             # writes dist/emlak-takip-0.2.0.zip (runtime files only)
```

Pushing a `v*` tag (e.g. `git tag v0.2.0 && git push origin v0.2.0`) triggers
`.github/workflows/release.yml`, which builds the zip and attaches it to a
GitHub Release.

## Adding a listing site

Site adapters are being moved behind a provider registry (see the open
provider-architecture issue). Until that lands, site-specific selectors live in
the `SELECTORS` object in `src/content/capture.js`.
