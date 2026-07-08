#!/usr/bin/env node
// Live verification harness (dev only, never shipped).
//
// For each provider × category/type search page: pick a real listing, run the
// ACTUAL provider code against it (the same field methods the extension uses),
// and print a PII-free presence report (booleans/counts only — no titles,
// locations, names or coordinates). Requires network; the three sites are
// reachable with a browser UA.
//
//   node scripts/verify-live.mjs
import { JSDOM } from "jsdom";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

// curl gets past the sites' bot protection where node's fetch (undici) is 403'd.
async function curl(url) {
  try {
    const { stdout } = await run(
      "curl",
      ["-s", "-L", "-m", "20", "-A", UA, url],
      { maxBuffer: 32 * 1024 * 1024 }
    );
    return stdout || "";
  } catch {
    return "";
  }
}

// Load providers onto the global (same as content-script order).
await import("../src/providers/registry.js");
await import("../src/providers/util.js");
await import("../src/providers/sahibinden.js");
await import("../src/providers/hepsiemlak.js");
await import("../src/providers/emlakjet.js");
const R = globalThis.EmlakTakip;
const U = globalThis.EmlakTakipUtil;

// In the extension, providers read a site's own API via the background worker.
// Here, wire fetchJson straight to node fetch.
U.fetchJson = async (url) => {
  const body = await curl(url);
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
};

async function getHtml(url) {
  const html = await curl(url);
  return { status: html ? 200 : 0, html };
}

// Each case: a search/category page + a regex to pull a listing-detail path.
const CASES = [
  // hepsiemlak
  {
    p: "hepsiemlak",
    label: "konut/satılık",
    search: "https://www.hepsiemlak.com/satilik",
    re: /\/[a-z0-9-]+\/(daire|villa|mustakil-ev|residence)\/[0-9]+-[0-9]+/,
  },
  {
    p: "hepsiemlak",
    label: "konut/kiralık",
    search: "https://www.hepsiemlak.com/kiralik",
    re: /\/[a-z0-9-]+\/(daire|villa|mustakil-ev|residence)\/[0-9]+-[0-9]+/,
  },
  {
    p: "hepsiemlak",
    label: "ticari/satılık",
    search: "https://www.hepsiemlak.com/isyeri-satilik",
    re: /\/[a-z0-9-]+\/(isyeri|dukkan|ofis|depo|magaza)\/[0-9]+-[0-9]+/,
  },
  {
    p: "hepsiemlak",
    label: "arsa/satılık",
    search: "https://www.hepsiemlak.com/arsa-satilik",
    re: /\/[a-z0-9-]+\/(arsa|tarla)\/[0-9]+-[0-9]+/,
  },
  // emlakjet
  {
    p: "emlakjet",
    label: "konut/satılık",
    search: "https://www.emlakjet.com/satilik-konut/",
    re: /\/ilan\/[a-z0-9-]+-[0-9]{5,}/,
  },
  {
    p: "emlakjet",
    label: "konut/kiralık",
    search: "https://www.emlakjet.com/kiralik-konut/",
    re: /\/ilan\/[a-z0-9-]+-[0-9]{5,}/,
  },
  {
    p: "emlakjet",
    label: "ticari/satılık",
    search: "https://www.emlakjet.com/satilik-isyeri/",
    re: /\/ilan\/[a-z0-9-]+-[0-9]{5,}/,
  },
  {
    p: "emlakjet",
    label: "arsa/satılık",
    search: "https://www.emlakjet.com/satilik-arsa/",
    re: /\/ilan\/[a-z0-9-]+-[0-9]{5,}/,
  },
  // sahibinden (often bot-gated; reported for completeness)
  {
    p: "sahibinden",
    label: "konut/satılık",
    search: "https://www.sahibinden.com/satilik-daire",
    re: /\/ilan\/[a-z0-9-]+-[0-9]+\/detay/,
  },
];

function origin(url) {
  return new URL(url).origin;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// PII-free presence summary of a captured record.
function summarize(rec) {
  if (!rec) return { ok: false };
  const loc = rec.location || {};
  return {
    provider: rec.provider,
    id: !!rec.ilanNo,
    category: rec.category,
    type: rec.listingType || "—",
    title: !!rec.title,
    price: !!(rec.price && rec.price.amount),
    loc: `${loc.il ? "il" : "-"}/${loc.ilce ? "ilce" : "-"}/${loc.mahalle ? "mah" : "-"}`,
    geo: !!rec.geo,
    attrs: Object.keys(rec.attributes || {}).length,
    features: Object.keys(rec.features || {}).length,
    photos: (rec.photos || []).length,
    contact: !!rec.contact,
    desc: !!rec.description,
  };
}

function verdict(s) {
  if (!s.ok && !s.provider) return "FAIL(no record)";
  const core = s.title && s.price && s.type !== "—" && s.loc !== "-/-/-";
  const rich = s.attrs >= 3 && s.photos >= 1;
  return core && rich ? "PASS" : core ? "PARTIAL" : "WEAK";
}

for (const c of CASES) {
  try {
    const { status, html } = await getHtml(c.search);
    if (!html) {
      console.log(
        `${c.p.padEnd(11)} ${c.label.padEnd(16)} search http=${status} — skip`
      );
      continue;
    }
    const m = html.match(c.re);
    if (!m) {
      console.log(
        `${c.p.padEnd(11)} ${c.label.padEnd(16)} no listing link found on search page`
      );
      continue;
    }
    const url = origin(c.search) + m[0];
    await sleep(1500); // avoid the sites' rate limiting between requests
    const doc = new JSDOM((await getHtml(url)).html, { url }).window.document;
    globalThis.document = doc;
    globalThis.location = { origin: origin(url), href: url };
    const provider = R.getProvider(url);
    if (!provider) {
      console.log(
        `${c.p.padEnd(11)} ${c.label.padEnd(16)} matches() = no provider`
      );
      continue;
    }
    const rec = await R.buildRecord(provider, doc, url);
    const s = summarize(rec);
    s.ok = !!rec;
    console.log(
      `${c.p.padEnd(11)} ${c.label.padEnd(16)} ${verdict(s).padEnd(15)} ` +
        JSON.stringify(s)
    );
  } catch (e) {
    console.log(
      `${c.p.padEnd(11)} ${c.label.padEnd(16)} ERROR ${String(e).slice(0, 80)}`
    );
  }
  await sleep(3000); // throttle between cases (bot protection)
}
