// Pure helpers for the periodic "re-check" nudge.
//
// Design note: the extension is deliberately DOM-only — it never fetches
// listing pages in the background (that would defeat the privacy stance and
// run into anti-bot measures). So "re-check" does not re-download prices; it
// counts saved listings the user hasn't revisited in a while and surfaces that
// as a toolbar badge, nudging a revisit. Reopening a listing refreshes its
// price through the existing passive SEEN flow.

const DAY_MS = 86400000;

// Timestamp of the last time we (passively) saw a listing.
export function lastSeen(rec) {
  return rec.lastSeenAt || rec.updatedAt || rec.savedAt || 0;
}

// Records not seen for at least `days` days, given the current time `now`.
export function staleListings(list, now, days) {
  const cutoff = now - days * DAY_MS;
  return (list || []).filter((r) => lastSeen(r) < cutoff);
}

export function staleCount(list, now, days) {
  return staleListings(list, now, days).length;
}
