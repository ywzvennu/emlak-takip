// HTTP layer for the price pool. Built on node:http (no framework). Takes an
// already-open db handle so tests can inject an in-memory database and listen
// on an ephemeral port.
//
// Endpoints:
//   GET  /v1/health        -> { ok: true }
//   POST /v1/observations  { contributorId, observations:[{key,amount,currency,at}] }
//                          -> { accepted, rejected }
//   POST /v1/history       { keys:[...] } -> { histories: { key:[{amount,currency,at,observers}] } }

import http from "node:http";
import {
  isValidContributorId,
  partitionObservations,
  sanitizeKeys,
} from "./validate.js";

const MAX_BODY_BYTES = 1_000_000; // 1 MB request cap

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
  });
  res.end(payload);
}

// Read and JSON-parse the request body, enforcing a size cap. Rejects on
// oversize or malformed JSON.
function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("payload too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(Object.assign(new Error("invalid JSON"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

// Fixed-window in-memory rate limiter, keyed by client IP. Per-process — fine
// for a single-instance first cut; a shared store would be needed if scaled.
function makeRateLimiter({ windowMs, max }) {
  const hits = new Map();
  return function allow(ip, now) {
    const cur = hits.get(ip);
    if (!cur || now - cur.start >= windowMs) {
      hits.set(ip, { start: now, count: 1 });
      return true;
    }
    if (cur.count >= max) return false;
    cur.count += 1;
    return true;
  };
}

// Build (but do not start) the server. `opts.now` is injectable for tests.
export function createServer(db, opts = {}) {
  const rateLimit = opts.rateLimit || { windowMs: 60_000, max: 60 };
  const now = opts.now || (() => Date.now());
  const allow = makeRateLimiter(rateLimit);

  return http.createServer(async (req, res) => {
    const ip = req.socket.remoteAddress || "unknown";
    if (!allow(ip, now())) {
      res.setHeader("retry-after", Math.ceil(rateLimit.windowMs / 1000));
      return send(res, 429, { error: "rate limited" });
    }

    const { pathname } = new URL(req.url, "http://localhost");

    try {
      if (req.method === "GET" && pathname === "/v1/health") {
        return send(res, 200, { ok: true });
      }

      if (req.method === "POST" && pathname === "/v1/observations") {
        const body = await readJson(req);
        if (!isValidContributorId(body.contributorId))
          return send(res, 400, { error: "invalid contributorId" });
        const { valid, rejected } = partitionObservations(
          body.observations,
          now()
        );
        const accepted = valid.length;
        db.insertObservations(body.contributorId, valid, now());
        return send(res, 200, { accepted, rejected });
      }

      if (req.method === "POST" && pathname === "/v1/history") {
        const body = await readJson(req);
        const keys = sanitizeKeys(body.keys);
        return send(res, 200, { histories: db.getHistories(keys) });
      }

      return send(res, 404, { error: "not found" });
    } catch (err) {
      return send(res, err.status || 500, {
        error: err.status ? err.message : "internal error",
      });
    }
  });
}
