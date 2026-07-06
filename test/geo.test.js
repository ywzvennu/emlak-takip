import { test } from "node:test";
import assert from "node:assert/strict";
import { point, hasGeo, boundsOf, osmUrl } from "../src/lib/geo.js";

test("point returns numeric [lat,lng] or null", () => {
  assert.deepEqual(point({ geo: { lat: 10.0, lng: 20.0 } }), [10.0, 20.0]);
  // string coordinates (e.g. from an old import) are coerced
  assert.deepEqual(point({ geo: { lat: "10.0", lng: "20.0" } }), [10.0, 20.0]);
  assert.equal(point({ geo: null }), null);
  assert.equal(point({}), null);
  assert.equal(point({ geo: { lat: 0, lng: 0 } }), null);
  assert.equal(point({ geo: { lat: "x", lng: 1 } }), null);
});

test("hasGeo reflects point()", () => {
  assert.equal(hasGeo({ geo: { lat: 41, lng: 29 } }), true);
  assert.equal(hasGeo({ geo: {} }), false);
});

test("boundsOf collects only geo-located records, or null", () => {
  const list = [
    { geo: { lat: 41, lng: 29 } },
    { geo: null },
    { geo: { lat: 39, lng: 35 } },
  ];
  assert.deepEqual(boundsOf(list), [
    [41, 29],
    [39, 35],
  ]);
  assert.equal(boundsOf([{ geo: null }]), null);
  assert.equal(boundsOf([]), null);
});

test("osmUrl builds a marker URL", () => {
  assert.equal(
    osmUrl(10.0, 20.0),
    "https://www.openstreetmap.org/?mlat=10.0&mlon=20.0#map=17/10.0/20.0"
  );
});
