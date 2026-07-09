import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "./db.js";

const AT1 = Date.UTC(2026, 3, 1);
const AT2 = Date.UTC(2026, 5, 1);
let db;

beforeEach(() => {
  db = openDb(":memory:");
});

function obs(amount, at, currency = "TL") {
  return { key: "sahibinden:1", amount, currency, at };
}

test("dedups a contributor's repeat of the same price point", () => {
  const stored1 = db.insertObservations("alice", [obs(2750000, AT1)], 1);
  const stored2 = db.insertObservations("alice", [obs(2750000, AT2)], 2);
  assert.equal(stored1, 1);
  assert.equal(stored2, 0); // same (key,amount,currency,contributor) -> ignored

  const h = db.getHistories(["sahibinden:1"])["sahibinden:1"];
  assert.equal(h.length, 1);
  assert.equal(h[0].observers, 1);
  assert.equal(h[0].at, AT1); // earliest sighting wins
});

test("counts distinct observers per price point", () => {
  db.insertObservations("alice", [obs(2750000, AT1)]);
  db.insertObservations("bob", [obs(2750000, AT2)]); // same price, later
  db.insertObservations("alice", [obs(2600000, AT2)]); // a drop, alice only

  const h = db.getHistories(["sahibinden:1"])["sahibinden:1"];
  assert.equal(h.length, 2);
  // ordered by first-seen time; the 2.75M point came first
  assert.deepEqual(h[0], {
    amount: 2750000,
    currency: "TL",
    at: AT1,
    observers: 2,
  });
  assert.deepEqual(h[1], {
    amount: 2600000,
    currency: "TL",
    at: AT2,
    observers: 1,
  });
});

test("getHistories returns only keys that have data (reciprocity by request)", () => {
  db.insertObservations("alice", [obs(2750000, AT1)]);
  const res = db.getHistories(["sahibinden:1", "sahibinden:999"]);
  assert.deepEqual(Object.keys(res), ["sahibinden:1"]); // 999 omitted (no data)
});

test("same amount in different currencies are distinct points", () => {
  db.insertObservations("alice", [obs(100000, AT1, "TL")]);
  db.insertObservations("alice", [obs(100000, AT1, "USD")]);
  const h = db.getHistories(["sahibinden:1"])["sahibinden:1"];
  assert.equal(h.length, 2);
});
