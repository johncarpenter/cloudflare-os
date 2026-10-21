// Runs the Terraform module for real, with the provider mocked and the Cloudflare API replaced by a
// local server, so the whole chain Terraform -> local-exec -> deploy-worker.ts -> HTTP is exercised:
// what is uploaded, in what order, with which bindings and migration delta, and what teardown deletes.
// Skipped when `terraform` is not installed.

import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MODULE = join(ROOT, "infra/terraform/modules/instance");

function hasTerraform(): boolean {
  try {
    execFileSync("terraform", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

interface Recorded {
  method: string;
  script: string;
  metadata?: Record<string, any>;
  moduleNames?: string[];
}

const requests: Recorded[] = [];
let server: ReturnType<typeof createServer>;
let baseUrl = "";

// The backend already has migration tag v1 on the "account"; everything else is new.
const EXISTING_TAGS: Record<string, string> = { "acme-workshop-backend": "v1" };

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

before(async () => {
  server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "", "http://x");
    const script = url.pathname.split("/").at(-1) ?? "";
    const reply = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    assert.equal(req.headers.authorization, "Bearer smoke-token");

    if (req.method === "GET" && url.pathname.includes("/workers/services/")) {
      const tag = EXISTING_TAGS[script];
      if (!tag) return reply(404, { success: false, errors: [{ code: 10090, message: "not found" }] });
      return reply(200, { success: true, result: { default_environment: { script: { migration_tag: tag } } } });
    }
    if (req.method === "PUT") {
      const form = await new Response(await readBody(req), {
        headers: { "content-type": req.headers["content-type"] ?? "" },
      }).formData();
      const metadata = JSON.parse(await (form.get("metadata") as File).text());
      requests.push({
        method: "PUT", script, metadata,
        moduleNames: [...form.keys()].filter((key) => key !== "metadata"),
      });
      return reply(200, { success: true, result: {} });
    }
    if (req.method === "DELETE") {
      requests.push({ method: "DELETE", script });
      return reply(200, { success: true, result: {} });
    }
    return reply(400, { success: false, errors: [{ message: "unexpected" }] });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/client/v4`;
});

after(() => { server?.close(); });

test("terraform deploys each worker through the uploader in dependency order and deletes on teardown",
    { skip: !hasTerraform() && "terraform is not installed" }, async () => {
  const env = {
    ...process.env,
    CLOUDFLARE_API_TOKEN: "smoke-token",
    CLOUDFLARE_API_BASE_URL: baseUrl,
    TF_CONFIRM_DELETE_WORKERS: "all",
  };
  // Asynchronous on purpose: the stand-in API server runs in this process and must keep answering.
  await run("terraform", ["init", "-backend=false", "-input=false"], { cwd: MODULE, env });
  try {
    await run("terraform", ["test", "-test-directory=smoke", "-no-color"], { cwd: MODULE, env });
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string };
    assert.fail(`terraform test failed:\n${failed.stdout}\n${failed.stderr}`);
  }

  const puts = requests.filter((request) => request.method === "PUT");
  assert.deepEqual(puts.map((request) => request.script).toSorted(), [
    "acme-gatekeeper-context", "acme-gatekeeper-scheduler", "acme-workshop-backend",
  ]);
  // Gatekeepers are uploaded before the backend that binds them.
  assert.equal(puts.at(-1)?.script, "acme-workshop-backend");

  const backend = puts.find((request) => request.script === "acme-workshop-backend")!;
  const bindings = backend.metadata!.bindings as Record<string, any>[];
  assert.ok(bindings.some((binding) => binding.type === "worker_loader" && binding.name === "LOADER"));
  assert.deepEqual(
      bindings.find((binding) => binding.name === "GATEKEEPER_CONTEXT"),
      {
        type: "service", name: "GATEKEEPER_CONTEXT", service: "acme-gatekeeper-context",
        entrypoint: "GatekeeperVendor", props: { sharingDomain: "https://os.example.com" },
      });
  assert.equal(bindings.find((binding) => binding.name === "CLERK_WEBHOOK_SECRET")?.text, "whsec_dGVzdA==");
  assert.equal(bindings.find((binding) => binding.name === "PUBLIC_BASE_URL")?.text, "https://os.example.com");
  assert.deepEqual(backend.moduleNames, ["index.js"]);

  // The backend is already at v1, so only the later steps go; new workers get their whole history.
  assert.equal(backend.metadata!.migrations.old_tag, "v1");
  assert.equal(backend.metadata!.migrations.new_tag, "v3");
  assert.equal(backend.metadata!.migrations.steps.length, 2);
  const context = puts.find((request) => request.script === "acme-gatekeeper-context")!;
  assert.equal("old_tag" in context.metadata!.migrations, false);

  // Teardown deletes exactly the workers the uploader deployed.
  const deletes = requests.filter((request) => request.method === "DELETE").map((request) => request.script);
  assert.deepEqual(deletes.toSorted(), [
    "acme-gatekeeper-context", "acme-gatekeeper-scheduler", "acme-workshop-backend",
  ]);
});
