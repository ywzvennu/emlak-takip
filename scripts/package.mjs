#!/usr/bin/env node
// Build a store-loadable .zip of the extension into dist/.
//
// Ships only the runtime files (manifest, locales, icons, src) — never the dev
// tooling, tests, docs or the vendored-package source. Uses the system `zip`.
import { execFileSync } from "node:child_process";
import { readFileSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const version = manifest.version;

// Runtime file set. Everything the browser loads, and nothing else.
const INCLUDE = ["manifest.json", "_locales", "src"];
// Excluded even under the included dirs (dev-only leftovers).
const EXCLUDE = ["*.map", ".DS_Store"];

const distDir = join(root, "dist");
mkdirSync(distDir, { recursive: true });
const out = join(distDir, `emlak-takip-${version}.zip`);
rmSync(out, { force: true });

const args = ["-r", "-q", out, ...INCLUDE];
for (const pat of EXCLUDE) args.push("-x", pat);

execFileSync("zip", args, { cwd: root, stdio: "inherit" });
console.log(`Packaged v${version} -> dist/emlak-takip-${version}.zip`);
