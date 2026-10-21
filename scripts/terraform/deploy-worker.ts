#!/usr/bin/env node

// Uploads or deletes one Worker for the Terraform deployment (infra/terraform).
//
// Why this exists instead of the provider's cloudflare_workers_script: that resource has no
// `worker_loader` binding (the Gadget sandbox), no service-binding `props` (the sharing domain the
// backend hands the context gatekeeper), and forwards Durable Object migrations as written instead of
// computing the delta the API needs. This does what Wrangler's deploy does for those, and nothing
// else: Terraform renders the finished metadata, this uploads it.
//
// Usage (the spec contains secrets, so it travels in the environment, never an argument):
//   WORKER_SPEC='{...}' CLOUDFLARE_API_TOKEN=... node scripts/terraform/deploy-worker.ts deploy
//   TF_CONFIRM_DELETE_WORKERS=<name|all> ... node scripts/terraform/deploy-worker.ts delete

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createWorkersApi, type WorkersApi } from "./worker-api.ts";

/** A module of the worker, read from the release. */
export interface SpecModule {
  /** Part name and import path. */
  name: string;
  /** Manifest module type. */
  type: "esm" | "text" | "wasm" | "data";
  /** Where the bytes are. */
  path: string;
  /** Expected SHA-256, hex. */
  sha256: string;
}

/** One Durable Object migration as the release records it: its tag plus the step's classes. */
export interface MigrationEntry {
  tag: string;
  [step: string]: unknown;
}

/** The migrations object the upload API takes. */
export interface MigrationPayload {
  old_tag?: string;
  new_tag: string;
  steps: Record<string, unknown>[];
}

/** The finished description of one worker upload (see specs/002-terraform-cloudflare-deploy/contracts/worker-spec.md). */
export interface WorkerSpec {
  accountId: string;
  scriptName: string;
  mainModule: string;
  modules: SpecModule[];
  compatibilityDate?: string;
  compatibilityFlags?: string[];
  bindings: Record<string, unknown>[];
  migrations: MigrationEntry[];
  observability?: Record<string, unknown>;
}

const CONTENT_TYPES: Record<SpecModule["type"], string> = {
  esm: "application/javascript+module",
  text: "text/plain",
  wasm: "application/wasm",
  data: "application/octet-stream",
};

/**
 * The migrations to send for a script whose current tag is `currentTag`: Wrangler's rule. Nothing when
 * the history is empty or already applied; every step for a script with no tag; the steps after the
 * current tag otherwise.
 *
 * Differs from Wrangler in one case: a current tag that is not in the history means the deployed
 * Worker is ahead of (or unrelated to) this release, as after a rollback past a migration. Wrangler
 * re-sends every step, which the API rejects for classes that already exist; this refuses and says
 * why, so the operator learns that the release cannot be rolled back to.
 */
export function planMigrations(history: MigrationEntry[], currentTag: string | undefined)
    : MigrationPayload | undefined {
  if (history.length === 0) return undefined;
  const last = history[history.length - 1].tag;
  const steps = (entries: MigrationEntry[]) =>
      entries.map(({ tag: _tag, ...rest }) => rest);
  if (currentTag === undefined) return { new_tag: last, steps: steps(history) };
  const at = history.findIndex((entry) => entry.tag === currentTag);
  if (at === -1) {
    throw new Error(
        `The deployed Worker is at migration "${currentTag}", which this release does not contain ` +
        `(it ends at "${last}"). The Worker is newer than this release, so it cannot be rolled back ` +
        `to it without losing the migration.`);
  }
  if (at === history.length - 1) return undefined;
  return { old_tag: currentTag, new_tag: last, steps: steps(history.slice(at + 1)) };
}

/** The `metadata` part of the upload. */
export function buildMetadata(spec: WorkerSpec, migrations: MigrationPayload | undefined)
    : Record<string, unknown> {
  return {
    main_module: spec.mainModule,
    ...(spec.compatibilityDate ? { compatibility_date: spec.compatibilityDate } : {}),
    compatibility_flags: spec.compatibilityFlags ?? [],
    bindings: spec.bindings,
    ...(spec.observability ? { observability: spec.observability } : {}),
    ...(migrations ? { migrations } : {}),
  };
}

/** Reads a module and refuses it if its bytes are not the ones the release recorded. */
export function readVerifiedModule(
    spec: WorkerSpec, module: SpecModule, read: (path: string) => Uint8Array): Uint8Array {
  const bytes = read(module.path);
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== module.sha256) {
    throw new Error(
        `${spec.scriptName}: module ${module.name} does not match the release checksum ` +
        `(expected ${module.sha256}, found ${actual}).`);
  }
  return bytes;
}

/** Builds the multipart form for an upload. */
export function buildForm(
    spec: WorkerSpec, migrations: MigrationPayload | undefined,
    read: (path: string) => Uint8Array): FormData {
  if (!spec.modules.some((module) => module.name === spec.mainModule)) {
    throw new Error(`${spec.scriptName}: main module ${spec.mainModule} is not among the modules.`);
  }
  const form = new FormData();
  form.append("metadata", new Blob(
      [JSON.stringify(buildMetadata(spec, migrations))], { type: "application/json" }), "metadata");
  for (const module of spec.modules) {
    const bytes = readVerifiedModule(spec, module, read);
    form.append(module.name,
        new Blob([Buffer.from(bytes)], { type: CONTENT_TYPES[module.type] }), module.name);
  }
  return form;
}

/** Uploads the worker, applying only the Durable Object migrations it has not had. */
export async function deployWorker(
    spec: WorkerSpec, api: WorkersApi,
    read: (path: string) => Uint8Array = readFileSync, log: (line: string) => void = console.log)
    : Promise<void> {
  const currentTag = await api.getMigrationTag(spec.accountId, spec.scriptName);
  const migrations = planMigrations(spec.migrations, currentTag);
  const form = buildForm(spec, migrations, read);
  await api.putScript(spec.accountId, spec.scriptName, form);
  log(`${spec.scriptName}: uploaded` +
      (migrations ? ` (migrations ${migrations.old_tag ?? "none"} -> ${migrations.new_tag})` : ""));
}

/** Whether `TF_CONFIRM_DELETE_WORKERS` names this worker (or all of them). */
export function deletionConfirmed(scriptName: string, confirmation: string | undefined): boolean {
  if (!confirmation) return false;
  const names = confirmation.split(",").map((name) => name.trim()).filter(Boolean);
  return names.includes("all") || names.includes(scriptName);
}

/**
 * Deletes the worker, which also deletes the Durable Object data it holds, so it refuses unless the
 * operator has named it in `TF_CONFIRM_DELETE_WORKERS`.
 */
export async function deleteWorker(
    spec: Pick<WorkerSpec, "accountId" | "scriptName">, api: WorkersApi,
    confirmation: string | undefined, log: (line: string) => void = console.log): Promise<void> {
  if (!deletionConfirmed(spec.scriptName, confirmation)) {
    throw new Error(
        `Refusing to delete Worker ${spec.scriptName}: it holds Durable Object data that deletion ` +
        `destroys. Set TF_CONFIRM_DELETE_WORKERS=${spec.scriptName} (or all) to confirm.`);
  }
  await api.deleteScript(spec.accountId, spec.scriptName);
  log(`${spec.scriptName}: deleted`);
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set.`);
  return value;
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode !== "deploy" && mode !== "delete") {
    throw new Error("Usage: deploy-worker.ts deploy|delete");
  }
  // Not the SyntaxError itself: its message quotes the input, and the input holds secrets.
  let spec: WorkerSpec;
  try {
    spec = JSON.parse(requiredEnv("WORKER_SPEC")) as WorkerSpec;
  } catch {
    throw new Error("WORKER_SPEC is not valid JSON.");
  }
  // CLOUDFLARE_API_BASE_URL points the uploader at an API proxy (or, in tests, a local stand-in).
  const api = createWorkersApi(
      requiredEnv("CLOUDFLARE_API_TOKEN"), fetch, process.env.CLOUDFLARE_API_BASE_URL || undefined);
  if (mode === "deploy") {
    await deployWorker(spec, api);
  } else {
    await deleteWorker(spec, api, process.env.TF_CONFIRM_DELETE_WORKERS);
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
