// Storage for pooled price observations, backed by node:sqlite (synchronous).
// Requires Node's --experimental-sqlite flag. Kept behind a thin interface so a
// different engine could be swapped in later.
//
// Dedup model: one row per (key, amount, currency, contributor). A contributor
// therefore counts once toward a price point no matter how many times they
// re-view it, which keeps storage bounded and observer counts honest. The
// earliest `at` a contributor reported wins (INSERT OR IGNORE).

import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS observations (
  key TEXT NOT NULL,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL,
  contributor TEXT NOT NULL,
  at INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  PRIMARY KEY (key, amount, currency, contributor)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_obs_key ON observations(key);
`;

// Open (or create) a database at `path` (":memory:" for tests) and prepare the
// statements. Returns a small handle with the operations the server needs.
export function openDb(path) {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA);

  const insertStmt = db.prepare(
    `INSERT OR IGNORE INTO observations
       (key, amount, currency, contributor, at, received_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const historyStmt = db.prepare(
    `SELECT amount, currency, MIN(at) AS at,
            COUNT(DISTINCT contributor) AS observers
       FROM observations
      WHERE key = ?
      GROUP BY amount, currency
      ORDER BY at ASC`
  );

  return {
    // Insert validated atoms for one contributor. Returns how many rows were
    // newly stored (duplicates are ignored by the primary key).
    insertObservations(contributor, observations, receivedAt = Date.now()) {
      let stored = 0;
      for (const o of observations) {
        const res = insertStmt.run(
          o.key,
          o.amount,
          o.currency,
          contributor,
          o.at,
          receivedAt
        );
        stored += Number(res.changes) || 0;
      }
      return stored;
    },

    // Pooled history for each requested key: distinct price points with the
    // first-seen time and the count of distinct observers. Keys with no data
    // are omitted.
    getHistories(keys) {
      const out = {};
      for (const key of keys) {
        const rows = historyStmt.all(key).map((r) => ({
          amount: r.amount,
          currency: r.currency,
          at: r.at,
          observers: r.observers,
        }));
        if (rows.length) out[key] = rows;
      }
      return out;
    },

    close() {
      db.close();
    },
  };
}
