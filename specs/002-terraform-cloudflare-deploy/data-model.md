# Data Model: Terraform Deployment to Cloudflare

## Instance (the module's input, one per state)

| Field | Rule |
|---|---|
| `instance_name` | 3-40 chars, `[a-z0-9-]`, starts with a letter, ends with a letter or digit. Every resource name derives from it. |
| `account_id` | 32 hex characters. |
| `release_dir` | Directory holding a complete release (`manifest.json`, `modules/`, `assets/`). |
| `frontend_variant` | A key of the router's `assetsConfig.variants`; default `standard`. |
| `public_access` | Exactly one of `custom_domain { hostname, zone_name }` or `workers_dev { public_base_url }`. |
| `clerk` | `issuer` (https origin), `publishable_key` (`pk_...`), optional `authorized_parties` (https origins; default = the public origin). |
| `clerk_webhook_secret` | Sensitive, `whsec_...`; null leaves the webhook disabled (the plan warns). |
| `operators` | Clerk user ids for `ADMINS`; at least one. |
| `tenant` | `mode` = `pool` or `single`; `id` (a Clerk organization id) required iff `single`. |
| `gatekeepers` | Map keyed by manifest `shortName`; presence enables it. Preinstalled ones are always on. |
| `gatekeeper_secrets` | Sensitive map `shortName -> { SECRET_NAME -> value }`. Must cover every secret input the manifest declares for an enabled gatekeeper. |
| `ai_gateway` | `enabled`, `name`, `providers`, `create`. |
| `observability` | `enabled`, `head_sampling_rate`, `invocation_logs`, `traces_enabled`, `traces_head_sampling_rate`. |
| `backend_extra_vars`, `backend_extra_bindings` | Escape hatches for backend settings and raw API bindings (for example an error-reporter service). |

## Derived names

| Thing | Name |
|---|---|
| Worker for package `p` | `<instance_name>-<p>` (for example `acme-workshop-backend`) |
| KV namespace for (`p`, `BINDING`) | `<instance_name>-<p>-<binding lowercased, _ -> ->` |
| R2 bucket for (`p`, `BINDING`) | `<instance_name>-<binding lowercased, _ -> ->` |
| Gatekeeper binding | `GATEKEEPER_<SHORTNAME>` |
| Public origin | `https://<custom_domain.hostname>` or `workers_dev.public_base_url` |
| Sharing domain | the public origin |

Constraints: Worker names <= 63 chars; bucket names 3-63 chars; all unique within the instance
(validated). Two instances collide only if their names are equal.

## Rendered worker (API-shaped)

`script_name`, `main_module`, `modules[] { name, type, path, sha256 }`, `compatibility_date`,
`compatibility_flags`, `bindings[]` (see [worker-spec](./contracts/worker-spec.md)), `migrations[]`
(ordered history `{ tag, ...steps }`), `observability`, `keep_assets` not used.

## State transitions

```text
absent --apply--> deployed(release A)
deployed(A) --release B, same migrations--> deployed(B)           (upload, no migration)
deployed(A) --release B, extra migrations--> deployed(B)          (uploader sends only the delta)
deployed --disable gatekeeper--> refused unless TF_CONFIRM_DELETE_WORKERS names it
deployed --change instance/account/public origin--> plan error from protection_lock
deployed --terraform destroy--> plan error from protection_lock until acknowledged
```

## Protection lock

`terraform_data.protection_lock`: `prevent_destroy = true`; `triggers_replace` =
`[instance_name, account_id, public_origin, sharing_domain]`. It is the single place where
"this change would hide or destroy data" becomes a plan error.
