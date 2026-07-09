// Entrypoint: open the on-disk database and start listening.
//   PORT     (default 8787)
//   DB_PATH  (default server/data/observations.db)
// Run with:  node --experimental-sqlite server/index.js   (or: npm run server)

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "./db.js";
import { createServer } from "./server.js";

const PORT = Number(process.env.PORT) || 8787;
const DB_PATH =
  process.env.DB_PATH ||
  fileURLToPath(new URL("./data/observations.db", import.meta.url));

mkdirSync(dirname(DB_PATH), { recursive: true });

const db = openDb(DB_PATH);
const server = createServer(db);

server.listen(PORT, () => {
  console.log(`price-pool backend listening on :${PORT} (db: ${DB_PATH})`);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
