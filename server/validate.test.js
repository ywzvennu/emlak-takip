import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isValidKey,
  isValidContributorId,
  isValidObservation,
  partitionObservations,
  sanitizeKeys,
  MAX_OBSERVATIONS,
  MAX_KEYS,
} from "./validate.js";

const NOW = Date.UTC(2026, 6, 9);
const ok = { key: "sahibinden:123", amount: 2750000, currency: "TL", at: NOW };

test("isValidKey accepts provider:ilanNo, rejects junk", () => {
  assert.equal(isValidKey("sahibinden:1327189715"), true);
  assert.equal(isValidKey("sahibinden:"), false);
  assert.equal(isValidKey(":123"), false);
  assert.equal(isValidKey("Sahibinden:123"), false); // provider must be lower
  assert.equal(isValidKey("sahibinden 123"), false);
  assert.equal(isValidKey(123), false);
});

test("isValidContributorId enforces an opaque token shape", () => {
  assert.equal(isValidContributorId("a1b2c3d4-e5f6"), true);
  assert.equal(isValidContributorId("short"), false); // < 8
  assert.equal(isValidContributorId("has space in it here"), false);
});

test("isValidObservation checks every field and the time window", () => {
  assert.equal(isValidObservation(ok, NOW), true);
  assert.equal(isValidObservation({ ...ok, amount: 0 }, NOW), false);
  assert.equal(isValidObservation({ ...ok, amount: -5 }, NOW), false);
  assert.equal(isValidObservation({ ...ok, amount: 1.5 }, NOW), false);
  assert.equal(isValidObservation({ ...ok, currency: "GBP" }, NOW), false);
  assert.equal(isValidObservation({ ...ok, at: 123 }, NOW), false); // ancient
  assert.equal(
    isValidObservation({ ...ok, at: NOW + 3 * 86400000 }, NOW),
    false // too far future
  );
  assert.equal(isValidObservation(null, NOW), false);
});

test("partitionObservations splits valid from rejected and caps the batch", () => {
  const res = partitionObservations(
    [ok, { ...ok, currency: "GBP" }, "nope"],
    NOW
  );
  assert.equal(res.valid.length, 1);
  assert.equal(res.rejected, 2);

  const many = Array.from({ length: MAX_OBSERVATIONS + 5 }, () => ok);
  const capped = partitionObservations(many, NOW);
  assert.equal(capped.valid.length, MAX_OBSERVATIONS);
  assert.equal(capped.rejected, 5); // overflow counted as rejected

  assert.deepEqual(partitionObservations("x", NOW), { valid: [], rejected: 0 });
});

test("sanitizeKeys keeps valid+unique keys and caps the count", () => {
  assert.deepEqual(
    sanitizeKeys(["sahibinden:1", "sahibinden:1", "bad key", "sahibinden:2"]),
    ["sahibinden:1", "sahibinden:2"]
  );
  const many = Array.from({ length: MAX_KEYS + 10 }, (_, i) => `x:${i}`);
  assert.equal(sanitizeKeys(many).length, MAX_KEYS);
  assert.deepEqual(sanitizeKeys("nope"), []);
});
