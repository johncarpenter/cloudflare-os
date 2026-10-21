// The uploader's pure logic and its API calls, with a recording stand-in for the network.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  buildForm, buildMetadata, deleteWorker, deletionConfirmed, deployWorker, planMigrations,
  type MigrationEntry, type WorkerSpec,
} from "./deploy-worker.ts";
import { createWorkersApi, WorkersApiError, type WorkersApi } from "./worker-api.ts";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const HISTORY: MigrationEntry[] = [
  { tag: "v0", new_sqlite_classes: ["A"] },
  { tag: "v1", new_sqlite_classes: ["B"] },
  { tag: "v2", new_sqlite_classes: ["C"] },
];

function specWith(overrides: Partial<WorkerSpec> = {}): WorkerSpec {
  return {
    accountId: "a".repeat(32),
    scriptName: "acme-workshop-backend",
    mainModule: "index.js",
    modules: [
      { name: "index.js", type: "esm", path: "/r/modules/main", sha256: sha("code") },
      { name: "page.txt", type: "text", path: "/r/modules/page", sha256: sha("page") },
    ],
    compatibilityDate: "2026-09-04",
    compatibilityFlags: ["nodejs_compat"],
    bindings: [
      { type: "worker_loader", name: "LOADER" },
      { type: "secret_text", name: "CLERK_WEBHOOK_SECRET", text: "whsec_TOPSECRET" },
    ],
    migrations: HISTORY,
    ...overrides,
  };
}

const files: Record<string, string> = { "/r/modules/main": "code", "/r/modules/page": "page" };
const read = (path: string) => new TextEncoder().encode(files[path]);

test("a script with no tag gets every migration, with no old_tag", () => {
  assert.deepEqual(planMigrations(HISTORY, undefined), {
    new_tag: "v2",
    steps: [{ new_sqlite_classes: ["A"] }, { new_sqlite_classes: ["B"] }, { new_sqlite_classes: ["C"] }],
  });
});

test("a script at the last tag, or a release with no migrations, gets none", () => {
  assert.equal(planMigrations(HISTORY, "v2"), undefined);
  assert.equal(planMigrations([], "v2"), undefined);
  assert.equal(planMigrations([], undefined), undefined);
});

test("a script inside the history gets only the steps after its tag", () => {
  assert.deepEqual(planMigrations(HISTORY, "v0"), {
    old_tag: "v0", new_tag: "v2",
    steps: [{ new_sqlite_classes: ["B"] }, { new_sqlite_classes: ["C"] }],
  });
});

test("a tag the history does not contain is refused: the Worker is newer than the release", () => {
  assert.throws(() => planMigrations(HISTORY, "v9"), /migration "v9", which this release does not contain.*cannot be rolled back/s);
});

test("metadata carries the bindings, migrations and observability and omits unset parts", () => {
  const spec = specWith({ observability: { enabled: true } });
  const metadata = buildMetadata(spec, planMigrations(HISTORY, "v1"));
  assert.equal(metadata.main_module, "index.js");
  assert.deepEqual(metadata.compatibility_flags, ["nodejs_compat"]);
  assert.deepEqual(metadata.migrations, { old_tag: "v1", new_tag: "v2", steps: [{ new_sqlite_classes: ["C"] }] });
  assert.deepEqual(metadata.observability, { enabled: true });
  assert.equal("migrations" in buildMetadata(spec, undefined), false);
});

test("the form has the metadata part and each module with its content type", async () => {
  const form = buildForm(specWith(), undefined, read);
  const metadata = form.get("metadata") as File;
  assert.equal(metadata.type, "application/json");
  assert.deepEqual(JSON.parse(await metadata.text()).bindings[0], { type: "worker_loader", name: "LOADER" });
  assert.equal((form.get("index.js") as File).type, "application/javascript+module");
  assert.equal((form.get("page.txt") as File).type, "text/plain");
});

test("a module that differs from the release checksum is refused, naming it", () => {
  const tampered = (path: string) => new TextEncoder().encode(path === "/r/modules/main" ? "evil" : "page");
  assert.throws(() => buildForm(specWith(), undefined, tampered), /index\.js does not match the release checksum/);
});

test("a main module missing from the modules is refused", () => {
  assert.throws(() => buildForm(specWith({ mainModule: "missing.js" }), undefined, read), /main module/);
});

function recordingApi(tag: string | undefined) {
  const calls: { op: string; form?: FormData }[] = [];
  const api: WorkersApi = {
    async getMigrationTag() { calls.push({ op: "tag" }); return tag; },
    async putScript(_a, _s, form) { calls.push({ op: "put", form }); },
    async deleteScript() { calls.push({ op: "delete" }); },
  };
  return { api, calls };
}

test("deploy reads the tag, then uploads the delta", async () => {
  const { api, calls } = recordingApi("v1");
  const lines: string[] = [];
  await deployWorker(specWith(), api, read, (line) => lines.push(line));
  assert.deepEqual(calls.map((call) => call.op), ["tag", "put"]);
  const metadata = JSON.parse(await (calls[1].form!.get("metadata") as File).text());
  assert.deepEqual(metadata.migrations.steps, [{ new_sqlite_classes: ["C"] }]);
  assert.match(lines[0], /migrations v1 -> v2/);
});

test("a failed checksum uploads nothing", async () => {
  const { api, calls } = recordingApi(undefined);
  await assert.rejects(deployWorker(specWith(), api, () => new Uint8Array([1]), () => {}));
  assert.deepEqual(calls.map((call) => call.op), ["tag"]);
});

test("deletion needs the worker named, or all, and says what to set", async () => {
  assert.equal(deletionConfirmed("w", undefined), false);
  assert.equal(deletionConfirmed("w", ""), false);
  assert.equal(deletionConfirmed("w", "other"), false);
  assert.equal(deletionConfirmed("w", "x, w"), true);
  assert.equal(deletionConfirmed("w", "all"), true);

  const { api, calls } = recordingApi(undefined);
  await assert.rejects(
      deleteWorker({ accountId: "a", scriptName: "w" }, api, undefined),
      /TF_CONFIRM_DELETE_WORKERS=w/);
  assert.equal(calls.length, 0);
  await deleteWorker({ accountId: "a", scriptName: "w" }, api, "w", () => {});
  assert.deepEqual(calls.map((call) => call.op), ["delete"]);
});

function fakeFetch(handler: (url: string, init: RequestInit) => Response) {
  const requests: { url: string; init: RequestInit }[] = [];
  const impl = (async (input: string | URL | Request, init: RequestInit = {}) => {
    requests.push({ url: String(input), init });
    return handler(String(input), init);
  }) as typeof fetch;
  return { impl, requests };
}

test("the API client reads the migration tag the way Wrangler does, and treats 404 as no script", async () => {
  const found = fakeFetch(() => Response.json(
      { success: true, result: { default_environment: { script: { migration_tag: "v1" } } } }));
  const api = createWorkersApi("token", found.impl);
  assert.equal(await api.getMigrationTag("acct", "w"), "v1");
  assert.equal(found.requests[0].url, "https://api.cloudflare.com/client/v4/accounts/acct/workers/services/w");
  assert.deepEqual(found.requests[0].init.headers, { Authorization: "Bearer token" });

  const missing = fakeFetch(() => Response.json({ success: false, errors: [{ code: 10090, message: "x" }] }, { status: 404 }));
  assert.equal(await createWorkersApi("token", missing.impl).getMigrationTag("acct", "w"), undefined);
});

test("the API client reports Cloudflare's errors without echoing the request", async () => {
  const failing = fakeFetch(() => Response.json(
      { success: false, errors: [{ code: 10074, message: "bad binding" }] }, { status: 400 }));
  const api = createWorkersApi("token", failing.impl);
  const form = new FormData();
  form.append("metadata", new Blob(["whsec_TOPSECRET"]));
  await assert.rejects(api.putScript("acct", "w", form), (error: unknown) => {
    assert.ok(error instanceof WorkersApiError);
    assert.equal(error.status, 400);
    assert.match(error.message, /upload w failed \(HTTP 400\): 10074 bad binding/);
    assert.doesNotMatch(error.message, /whsec_/);
    return true;
  });
});

test("deleting a script that is already gone succeeds", async () => {
  const gone = fakeFetch(() => Response.json({ success: false, errors: [] }, { status: 404 }));
  await createWorkersApi("token", gone.impl).deleteScript("acct", "w");
  assert.equal(gone.requests[0].init.method, "DELETE");
});
