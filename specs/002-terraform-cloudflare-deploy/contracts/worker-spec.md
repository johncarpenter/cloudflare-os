# Contract: worker spec handed to `scripts/terraform/deploy-worker.ts`

The module renders one JSON document per uploaded worker. The uploader performs no templating.

```jsonc
{
  "accountId": "0123...",
  "scriptName": "acme-workshop-backend",
  "mainModule": "index.js",
  "modules": [{ "name": "index.js", "type": "esm", "path": "/abs/release/modules/<sha>", "sha256": "<sha>" }],
  "compatibilityDate": "2026-09-04",
  "compatibilityFlags": ["nodejs_compat"],
  "bindings": [
    { "type": "kv_namespace", "name": "BLUEPRINTS", "namespace_id": "..." },
    { "type": "r2_bucket", "name": "BLUEPRINT_CONTENT", "bucket_name": "acme-blueprint-content" },
    { "type": "worker_loader", "name": "LOADER" },
    { "type": "service", "name": "GATEKEEPER_CONTEXT", "service": "acme-gatekeeper-context",
      "entrypoint": "GatekeeperVendor", "props": { "sharingDomain": "https://os.example.com" } },
    { "type": "plain_text", "name": "PUBLIC_BASE_URL", "text": "https://os.example.com" },
    { "type": "json", "name": "ADMINS", "json": "[\"user_2abc\"]" },
    { "type": "secret_text", "name": "CLERK_WEBHOOK_SECRET", "text": "whsec_..." }
  ],
  "migrations": [{ "tag": "v0", "new_sqlite_classes": ["UserDurableObject"] }],
  "observability": { "enabled": true, "head_sampling_rate": 1,
                     "logs": { "invocation_logs": false }, "traces": { "enabled": false } }
}
```

## Modes (`deploy-worker.ts`)

- `deploy`: reads the spec from the `WORKER_SPEC` environment variable (it contains secrets, so never
  an argument or file), verifies each module's SHA-256 against `sha256`, reads the deployed
  migration tag, builds the delta, and PUTs the multipart upload. Idempotent.
- `delete`: refuses unless `TF_CONFIRM_DELETE_WORKERS` is `all` or a comma list naming `scriptName`;
  then deletes the script (404 is success).

`CLOUDFLARE_API_TOKEN` is read from the environment. Exit code non-zero on any failure; messages
name the worker and the step and never include binding text.

## Upload request

`PUT /accounts/{accountId}/workers/scripts/{scriptName}`, multipart form:

- part `metadata` (`application/json`): `main_module`, `compatibility_date`, `compatibility_flags`,
  `bindings` (as above), `observability`, and `migrations` when there is a delta.
- one part per module, named by its `name`, with content type by `type`
  (`esm` -> `application/javascript+module`, `text` -> `text/plain`, `wasm` -> `application/wasm`,
  `data` -> `application/octet-stream`).

## Migration delta (mirrors Wrangler)

Let `tag` be the script's current `migration_tag` (absent when the script does not exist or has
none), found by `GET /accounts/{id}/workers/services/{name}`.

| Case | `migrations` sent |
|---|---|
| history empty | none |
| no current tag | `{ new_tag: last, steps: all }` |
| current tag at the end of history | none |
| current tag inside history | `{ old_tag: tag, new_tag: last, steps: after(tag) }` |
| current tag not in history | refused: the deployed Worker is newer than the release (Wrangler would re-send every step, which the API rejects) |

Each step is the history entry without `tag`.
