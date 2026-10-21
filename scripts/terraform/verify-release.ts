#!/usr/bin/env node

// Checks that a release directory is complete and uncorrupted before Terraform deploys it, and
// optionally lays out the static-asset tree the router's native upload needs.
//
//   node scripts/terraform/verify-release.ts <release-dir> [--variant standard] [--materialize]
//
// Verified: the manifest is present (it is written last, so its absence means an unfinished build),
// every worker module blob exists and matches its SHA-256, the chosen frontend variant exists, and
// every asset blob exists and matches its content key. --materialize then writes
// <release-dir>/asset-trees/<variant>/ with each asset at its served path.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { cfAssetHash, sha256Hex } from "../release/hash-lib.ts";
import type { ReleaseManifest } from "../release/manifest-lib.ts";

/** The result of checking a release. */
export interface ReleaseCheck {
  releaseId: string | undefined;
  /** Variants the router carries. */
  variants: string[];
  /** One message per problem; empty means the release is usable. */
  problems: string[];
}

/** Where `--materialize` writes the asset tree for `variant`. */
export function assetTreeDir(releaseDir: string, variant: string): string {
  return join(releaseDir, "asset-trees", variant);
}

function readManifest(releaseDir: string): ReleaseManifest | string {
  const path = join(releaseDir, "manifest.json");
  if (!existsSync(path)) {
    return `manifest.json is missing from ${releaseDir}: the release is incomplete or its build did not finish.`;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8")) as ReleaseManifest;
  } catch {
    return `manifest.json in ${releaseDir} is not valid JSON.`;
  }
}

/** Checks the release at `releaseDir` for the frontend `variant`. */
export function verifyRelease(releaseDir: string, variant: string): ReleaseCheck {
  const manifest = readManifest(releaseDir);
  if (typeof manifest === "string") return { releaseId: undefined, variants: [], problems: [manifest] };

  const problems: string[] = [];
  for (const [pkg, worker] of Object.entries(manifest.workers)) {
    for (const module of worker.modules) {
      const path = join(releaseDir, "modules", module.sha256);
      if (!existsSync(path)) {
        problems.push(`${pkg}: module ${module.name} is missing (modules/${module.sha256}).`);
      } else if (sha256Hex(readFileSync(path)) !== module.sha256) {
        problems.push(`${pkg}: module ${module.name} does not match its recorded checksum.`);
      }
    }
  }

  const routers = Object.entries(manifest.workers).filter(([, worker]) => worker.kind === "router");
  const variants = routers.flatMap(([, worker]) => Object.keys(worker.assetsConfig?.variants ?? {}));
  for (const [pkg, worker] of routers) {
    const entry = worker.assetsConfig?.variants[variant];
    if (!entry) {
      problems.push(
          `${pkg}: the release has no "${variant}" frontend variant (it has: ` +
          `${Object.keys(worker.assetsConfig?.variants ?? {}).join(", ") || "none"}). ` +
          `Rebuild it with the current scripts/release/build-release.ts.`);
      continue;
    }
    for (const [assetPath, asset] of Object.entries(entry.manifest)) {
      const path = join(releaseDir, "assets", asset.hash);
      if (!existsSync(path)) {
        problems.push(`${pkg}: asset ${assetPath} is missing (assets/${asset.hash}).`);
      } else if (cfAssetHash(readFileSync(path), assetPath) !== asset.hash) {
        problems.push(`${pkg}: asset ${assetPath} does not match its content key.`);
      }
    }
  }
  return { releaseId: manifest.releaseId, variants, problems };
}

/** Writes the asset tree for `variant`; the release must already have verified clean. */
export function materializeAssets(releaseDir: string, variant: string): string {
  const manifest = readManifest(releaseDir);
  if (typeof manifest === "string") throw new Error(manifest);
  const router = Object.values(manifest.workers).find((worker) => worker.kind === "router");
  const entry = router?.assetsConfig?.variants[variant];
  if (!entry) throw new Error(`The release has no "${variant}" frontend variant.`);

  const root = assetTreeDir(releaseDir, variant);
  rmSync(root, { recursive: true, force: true });
  for (const [assetPath, asset] of Object.entries(entry.manifest)) {
    const target = resolve(root, `.${assetPath}`);
    // A manifest path must stay inside the tree it describes.
    if (!target.startsWith(resolve(root) + sep)) {
      throw new Error(`Asset path ${assetPath} escapes the asset tree.`);
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, readFileSync(join(releaseDir, "assets", asset.hash)));
  }
  return root;
}

function main(): void {
  const args = process.argv.slice(2);
  const dir = args.find((arg) => !arg.startsWith("--") && args[args.indexOf(arg) - 1] !== "--variant");
  const variantAt = args.indexOf("--variant");
  const variant = variantAt === -1 ? "standard" : args[variantAt + 1];
  if (!dir || !variant) {
    throw new Error("Usage: verify-release.ts <release-dir> [--variant <name>] [--materialize]");
  }
  const check = verifyRelease(dir, variant);
  if (check.problems.length > 0) {
    console.error(`release ${check.releaseId ?? "(unknown)"} is not usable:`);
    for (const problem of check.problems) console.error(`  - ${problem}`);
    process.exitCode = 1;
    return;
  }
  console.log(`release ${check.releaseId} verified (variant ${variant}).`);
  if (args.includes("--materialize")) {
    console.log(`asset tree: ${materializeAssets(dir, variant)}`);
  }
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
