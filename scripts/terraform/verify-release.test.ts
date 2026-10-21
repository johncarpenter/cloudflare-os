// verify-release against small releases written to a temp directory.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { cfAssetHash, sha256Hex } from "../release/hash-lib.ts";
import { assetTreeDir, materializeAssets, verifyRelease } from "./verify-release.ts";

const roots: string[] = [];
after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

// A release with a router (two frontend variants) and one gatekeeper.
function makeRelease(options: { tamperModule?: boolean; dropStandard?: boolean; dropAsset?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "release-"));
  roots.push(dir);
  mkdirSync(join(dir, "modules"));
  mkdirSync(join(dir, "assets"));

  const code = Buffer.from("export default {}");
  const codeSha = sha256Hex(code);
  writeFileSync(join(dir, "modules", codeSha), options.tamperModule ? Buffer.from("evil") : code);

  const index = Buffer.from("<html>");
  const indexHash = cfAssetHash(index, "/index.html");
  if (!options.dropAsset) writeFileSync(join(dir, "assets", indexHash), index);
  const asset = { hash: indexHash, size: index.length };
  // The same bytes served at a .js path have a different content key (it includes the extension).
  const nestedHash = cfAssetHash(index, "/nested/app.js");
  writeFileSync(join(dir, "assets", nestedHash), index);
  const nested = { hash: nestedHash, size: index.length };

  const module = { name: "index.js", type: "esm", sha256: codeSha, size: code.length, r2Key: "x" };
  const manifest = {
    manifestVersion: 1, releaseId: "dev-test", commit: "c", createdAt: "t", wranglerVersion: "w",
    assets: {},
    workers: {
      router: {
        kind: "router", modules: [module],
        assetsConfig: { not_found_handling: "single-page-application", run_worker_first: ["/api/*"],
          variants: { access: { manifest: { "/index.html": asset } },
                      ...(options.dropStandard ? {} : { standard: { manifest: { "/index.html": asset, "/nested/app.js": nested } } }) } },
      },
      "gatekeeper-context": { kind: "gatekeeper", modules: [module] },
    },
  };
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
  return dir;
}

test("a complete release verifies and lists its variants", () => {
  const check = verifyRelease(makeRelease(), "standard");
  assert.deepEqual(check.problems, []);
  assert.equal(check.releaseId, "dev-test");
  assert.deepEqual(check.variants.toSorted(), ["access", "standard"]);
});

test("a missing manifest means an unfinished release", () => {
  const dir = mkdtempSync(join(tmpdir(), "release-"));
  roots.push(dir);
  assert.match(verifyRelease(dir, "standard").problems[0], /manifest\.json is missing .* did not finish/);
});

test("a tampered module is named by worker and file", () => {
  const problems = verifyRelease(makeRelease({ tamperModule: true }), "standard").problems;
  assert.ok(problems.some((p) => /router: module index\.js does not match/.test(p)));
  assert.ok(problems.some((p) => /gatekeeper-context: module index\.js does not match/.test(p)));
});

test("a release without the Clerk-capable variant says what it has", () => {
  const [problem] = verifyRelease(makeRelease({ dropStandard: true }), "standard").problems;
  assert.match(problem, /no "standard" frontend variant \(it has: access\)/);
});

test("a missing asset blob is reported by its served path", () => {
  const problems = verifyRelease(makeRelease({ dropAsset: true }), "standard").problems;
  assert.ok(problems.some((p) => /asset \/index\.html is missing/.test(p)));
});

test("materializing writes each asset at its served path", () => {
  const dir = makeRelease();
  const root = materializeAssets(dir, "standard");
  assert.equal(root, assetTreeDir(dir, "standard"));
  assert.equal(readFileSync(join(root, "index.html"), "utf8"), "<html>");
  assert.equal(readFileSync(join(root, "nested", "app.js"), "utf8"), "<html>");
});

test("materializing refuses a path that escapes the tree", () => {
  const dir = makeRelease();
  const manifestPath = join(dir, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const entry = manifest.workers.router.assetsConfig.variants.standard.manifest["/index.html"];
  manifest.workers.router.assetsConfig.variants.standard.manifest["/../escape.txt"] = entry;
  writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.throws(() => materializeAssets(dir, "standard"), /escapes the asset tree/);
});
