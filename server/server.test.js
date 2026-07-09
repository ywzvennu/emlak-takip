import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "./db.js";
import { createServer } from "./server.js";

const AT = Date.UTC(2026, 5, 1);
let server;
let base;

// Start the server on an ephemeral port with a fresh in-memory DB per test.
async function start(opts) {
  const db = openDb(":memory:");
  server = createServer(db, opts);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
}

beforeEach(() => start());
afterEach(() => new Promise((r) => server.close(r)));

const post = (path, body) =>
  fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

test("GET /v1/health", async () => {
  const res = await fetch(base + "/v1/health");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

test("observations round-trip: two contributors -> observers:2", async () => {
  const o = { key: "sahibinden:1", amount: 2750000, currency: "TL", at: AT };
  let r = await post("/v1/observations", {
    contributorId: "alice-000",
    observations: [o],
  });
  assert.deepEqual(await r.json(), { accepted: 1, rejected: 0 });

  r = await post("/v1/observations", {
    contributorId: "bob-00000",
    observations: [o, { ...o, amount: 2600000, at: AT + 1 }],
  });
  assert.deepEqual(await r.json(), { accepted: 2, rejected: 0 });

  r = await post("/v1/history", { keys: ["sahibinden:1"] });
  const { histories } = await r.json();
  const h = histories["sahibinden:1"];
  assert.equal(h.length, 2);
  assert.equal(h.find((p) => p.amount === 2750000).observers, 2);
  assert.equal(h.find((p) => p.amount === 2600000).observers, 1);
});

test("invalid contributorId -> 400", async () => {
  const r = await post("/v1/observations", {
    contributorId: "short",
    observations: [],
  });
  assert.equal(r.status, 400);
});

test("bad observations are rejected, not stored", async () => {
  const r = await post("/v1/observations", {
    contributorId: "carol-0001",
    observations: [
      { key: "sahibinden:2", amount: -5, currency: "TL", at: AT },
      { key: "sahibinden:2", amount: 500000, currency: "GBP", at: AT },
    ],
  });
  assert.deepEqual(await r.json(), { accepted: 0, rejected: 2 });

  const h = await (
    await post("/v1/history", { keys: ["sahibinden:2"] })
  ).json();
  assert.deepEqual(h.histories, {});
});

test("malformed JSON -> 400", async () => {
  const r = await fetch(base + "/v1/observations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{ not json",
  });
  assert.equal(r.status, 400);
});

test("unknown route -> 404", async () => {
  assert.equal((await fetch(base + "/nope")).status, 404);
});

test("rate limiting returns 429 over the window budget", async () => {
  await server.close();
  await start({ rateLimit: { windowMs: 60_000, max: 2 } });
  assert.equal((await fetch(base + "/v1/health")).status, 200);
  assert.equal((await fetch(base + "/v1/health")).status, 200);
  assert.equal((await fetch(base + "/v1/health")).status, 429);
});
