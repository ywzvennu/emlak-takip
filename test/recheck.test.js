import { test } from "node:test";
import assert from "node:assert/strict";
import { lastSeen, staleListings, staleCount } from "../src/lib/recheck.js";

const DAY = 86400000;
const NOW = 1_700_000_000_000;

test("lastSeen prefers lastSeenAt, then updatedAt, then savedAt", () => {
  assert.equal(lastSeen({ lastSeenAt: 5, updatedAt: 3, savedAt: 1 }), 5);
  assert.equal(lastSeen({ updatedAt: 3, savedAt: 1 }), 3);
  assert.equal(lastSeen({ savedAt: 1 }), 1);
  assert.equal(lastSeen({}), 0);
});

test("staleListings returns records older than the cutoff", () => {
  const list = [
    { ilanNo: "a", lastSeenAt: NOW - 2 * DAY }, // fresh
    { ilanNo: "b", lastSeenAt: NOW - 10 * DAY }, // stale
    { ilanNo: "c", savedAt: NOW - 8 * DAY }, // stale (falls back to savedAt)
  ];
  const stale = staleListings(list, NOW, 7);
  assert.deepEqual(
    stale.map((r) => r.ilanNo),
    ["b", "c"]
  );
  assert.equal(staleCount(list, NOW, 7), 2);
});

test("staleCount handles empty / missing input", () => {
  assert.equal(staleCount([], NOW, 7), 0);
  assert.equal(staleCount(undefined, NOW, 7), 0);
});
