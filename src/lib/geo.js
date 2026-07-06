// Small pure helpers for the map view and the "open in map" links. Kept
// separate from the DOM/Leaflet code so the data logic is unit-testable.

// Returns [lat, lng] as numbers, or null if the record has no usable geo.
export function point(rec) {
  if (!rec || !rec.geo) return null;
  const lat = Number(rec.geo.lat);
  const lng = Number(rec.geo.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat === 0 && lng === 0) return null;
  return [lat, lng];
}

export function hasGeo(rec) {
  return point(rec) !== null;
}

// Leaflet-style bounds (array of [lat,lng]) for a list, or null if none.
export function boundsOf(list) {
  const pts = (list || []).map(point).filter(Boolean);
  return pts.length ? pts : null;
}

export function osmUrl(lat, lng, zoom = 17) {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=${zoom}/${lat}/${lng}`;
}
