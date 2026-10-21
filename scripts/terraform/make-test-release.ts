#!/usr/bin/env node

// Writes the small release fixture the Terraform module tests plan against
// (infra/terraform/modules/instance/tests/fixtures/release), derived from the golden manifest so it
// keeps the real shape: the router, the backend, and a few gatekeepers, each with tiny placeholder
// modules whose checksums are real. Regenerate it after a manifest contract change:
//
//   node scripts/terraform/make-test-release.ts
//
// It also materializes the asset tree and writes release-tampered/, a copy with one backend module
// altered, for the checksum refusal test.

import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cfAssetHash, sha256Hex, stableStringify } from "../release/hash-lib.ts";
import { materializeAssets } from "./verify-release.ts";
import type { ReleaseManifest, WorkerEntry } from "../release/manifest-lib.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIXTURES = join(ROOT, "infra/terraform/modules/instance/tests/fixtures");
const OUT = join(FIXTURES, "release");
// A copy with one module blob altered, for the checksum refusal test.
const TAMPERED = join(FIXTURES, "release-tampered");
const KEEP = [
  "router", "workshop-backend", "gatekeeper-context", "gatekeeper-scheduler",
  "gatekeeper-github", "gatekeeper-email",
];

const golden = JSON.parse(readFileSync(
    join(ROOT, "scripts/release/testdata/golden-manifest.json"), "utf8")) as ReleaseManifest;

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, "modules"), { recursive: true });
mkdirSync(join(OUT, "assets"), { recursive: true });

const workers: Record<string, WorkerEntry> = {};
for (const pkg of KEEP) {
  const worker = structuredClone(golden.workers[pkg]);
  const bytes = Buffer.from(`// ${pkg} fixture bundle\nexport default {};\n`);
  const sha256 = sha256Hex(bytes);
  writeFileSync(join(OUT, "modules", sha256), bytes);
  worker.mainModule = "index.js";
  worker.modules = [{ name: "index.js", type: "esm", sha256, size: bytes.length, r2Key: `modules/${sha256}` }];
  workers[pkg] = worker;
}

const files: Record<string, string> = { "/index.html": "<!doctype html><title>fixture</title>", "/app.js": "console.log(1)" };
const variants: Record<string, { manifest: Record<string, { hash: string; size: number }> }> = {};
for (const variant of ["access", "standard"]) {
  const manifest: Record<string, { hash: string; size: number }> = {};
  for (const [path, text] of Object.entries(files)) {
    const bytes = Buffer.from(variant === "access" ? `${text}\n<!-- access -->` : text);
    const hash = cfAssetHash(bytes, path);
    writeFileSync(join(OUT, "assets", hash), bytes);
    manifest[path] = { hash, size: bytes.length };
  }
  variants[variant] = { manifest };
}
workers.router.assetsConfig!.variants = variants;

const manifest: ReleaseManifest = {
  ...golden, releaseId: "fixture-1", assets: {}, workers,
};
writeFileSync(join(OUT, "manifest.json"), stableStringify(manifest) + "\n");

materializeAssets(OUT, "standard");
rmSync(TAMPERED, { recursive: true, force: true });
cpSync(OUT, TAMPERED, { recursive: true });
writeFileSync(join(TAMPERED, "modules", workers["workshop-backend"].modules[0].sha256), "tampered");
console.log(`fixture releases written to ${FIXTURES}`);
