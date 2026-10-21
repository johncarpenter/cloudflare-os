# Deploying to Cloudflare with Terraform

This replaces the Wrangler-based flow of
[cloudflare-os-starter](https://github.com/cloudflare/cloudflare-os-starter): one Terraform
configuration launches, changes, upgrades and removes a complete instance. Requirements and design:
`specs/002-terraform-cloudflare-deploy/`.

```text
infra/terraform/
  modules/instance/   the module: one instance (router, backend, gatekeepers, stores, address)
  examples/pool/      shared multi-tenant pool
  examples/silo/      dedicated single-organization instance
scripts/terraform/    the worker uploader and release checks the module uses
```

## The short way: `make`

A root `Makefile` runs the whole local flow. Defaults deploy `infra/terraform/live-pool`; override with
`make TF_DIR=infra/terraform/live-silo ...`.

```sh
make deploy     # build a release, verify it, plan, show the plan, ask, apply exactly that plan
make plan       # reuse the current release: verify, init, plan, save the plan
make apply      # apply the saved plan
make url        # public URL and the Clerk webhook URL to register
make release    # rebuild the release on its own (named dev-<commit>[-dirty])
make check      # fmt, validate and test everything (no Cloudflare account needed)
make help       # the rest
```

- `make deploy` always rebuilds. `make plan` reuses `release-out/` and warns when the release is older
  than your working tree (`make release` refreshes it).
- The release it verifies is passed to Terraform as `release_dir`, so what you checked is what is
  deployed whatever the tfvars say. `apply` uses the saved plan, so it applies what you reviewed and
  fails if the state moved in between.
- Credentials: if `CLOUDFLARE_API_TOKEN` is unset, the Makefile reads `.envrc` (or `.env`) from the
  Terraform directory. It reads it with `cat` because 1Password serves that file as a named pipe,
  which `sh`'s `.` cannot read. `YES=1 make deploy` skips the confirmation prompt.
- A saved plan (`release.tfplan`) contains the values it will apply, secrets included. It is
  git-ignored and removed after a successful apply.

## What it deploys

The module reads a **built release** (`manifest.json` plus checksummed files) and creates, named from
`instance_name`:

| Component | How |
|---|---|
| Router Worker (serves the web app, routes `/api` and `/gatekeeper/<name>`) | provider resource `cloudflare_workers_script`, with the frontend assets |
| Workshop backend and every installed gatekeeper | `scripts/terraform/deploy-worker.ts`, driven by `terraform_data` |
| KV namespaces, R2 bucket | provider resources, one per binding the release declares |
| Public address | `cloudflare_workers_custom_domain`, or the router's workers.dev address for evaluation |
| AI Gateway (optional) | `cloudflare_ai_gateway` |

Only the router is public. Everything else is reachable through service bindings.

### Why a script uploads most Workers

The provider's `cloudflare_workers_script` (v5.28) has no `worker_loader` binding (the Gadget
sandbox cannot run without it), no service-binding `props` (the backend passes the context
gatekeeper's sharing domain that way), and forwards Durable Object migrations as written instead of
computing what a script still needs. The uploader does what Wrangler does for exactly those things
and nothing else: Terraform renders the finished bindings, the script uploads them. When the provider
catches up these Workers can move to native resources. Scripts are not drift-checked by Terraform;
the router, stores and domain are.

## Prerequisites

- Terraform >= 1.9 and Node >= 24.19 on the machine that runs `apply`.
- A Cloudflare account with Workers, KV, R2, Browser Rendering, Dynamic Workers (worker loaders) and
  Workers AI enabled, and a zone in it (or use the workers.dev evaluation address).
- A Clerk application set up as in `docs/clerk-signin.md`.
- `CLOUDFLARE_API_TOKEN` in the environment (the provider and the uploader both read it) with:
  Workers Scripts Write, Workers KV Storage Write, Workers R2 Storage Write, Account Settings Read,
  Zone Read, Workers Routes Write (zone), and AI Gateway Write if you create a gateway.
- A built release (below).

## First launch

1. **Build a release** with a Clerk-capable frontend and verify it:

   ```sh
   node scripts/release/build-release.ts --out release-out
   node scripts/terraform/verify-release.ts release-out --variant standard --materialize
   ```

   `verify-release` checks every file against the manifest and lays out the asset tree the router
   needs. A release built before the `standard` variant existed is refused with a message saying so.

2. **Configure.** `cp -r infra/terraform/examples/pool infra/terraform/live-pool` (or `silo`), change the
   `source` line in its `main.tf` from `../../modules/instance` to `../modules/instance` (the copy sits one
   level higher than the example), copy `terraform.tfvars.example` to `terraform.tfvars`, fill it in (a copy at `live-<name>` needs
   `release_dir = "../../../release-out"`, or use an absolute path), and set up an encrypted remote backend
   from `backend.tf.example`. Put secrets in the environment, not in files:

   ```sh
   export TF_VAR_clerk_webhook_secret='whsec_...'
   export TF_VAR_gatekeeper_secrets='{"github":{"CLIENT_ID":"...","CLIENT_SECRET":"..."}}'
   ```

3. **Plan and apply.** `terraform init && terraform plan`, read the creations, then `terraform apply`.

4. **Finish Clerk.** Take `clerk_webhook_url` (events `organizationMembership.deleted`,
   `user.deleted` and `organization.deleted`) and `clerk_authorized_parties` from the outputs into the Clerk dashboard.

5. **Check.** Open the public address, sign in, create a workspace, ask an agent to use the context
   library. `/admin` is available to the Clerk user ids in `operators`.

## Changing and upgrading

- **Re-apply** after editing the tfvars. A worker is re-uploaded only when what it would be uploaded
  with changes; an unchanged instance plans to no changes. Data is never touched.
- **Upgrade or roll back**: build (or pick) another release, run `verify-release` on it, point
  `release_dir` at it, plan, apply. Durable Object migrations are sent as a delta against the deployed
  tag. Rolling back to a release that is *older than a migration already applied* is refused
  by the uploader with an explanatory message (the Workers' Durable Object schema has moved on); roll
  back across releases with the same migration history freely.
- **Rotate a secret**: change the environment variable and apply; only the Worker that uses it is
  re-uploaded.
- **Enable an integration**: add its name to `gatekeepers` and its credentials to `gatekeeper_secrets`.
  The plan refuses missing credentials. The backend and router are re-bound to it.
- **Disable an integration**: remove it from `gatekeepers`. Deleting its Worker destroys the data it
  holds, so the apply refuses until you set `TF_CONFIRM_DELETE_WORKERS=<worker name>` (comma list, or
  `all`).

## Guard rails

| Guard | What happens |
|---|---|
| Bad or incomplete input | The plan fails before any change, naming the value. |
| Release file missing or altered | The plan fails naming the worker and file. |
| `instance_name`, `account_id` or the public origin changed | The plan fails (`terraform_data.preflight`): a changed origin hides existing context data. To do it on purpose: `terraform state rm 'module.instance.terraform_data.identity_lock'`, then plan again. |
| `terraform destroy` | The plan fails (`terraform_data.destroy_lock`, `prevent_destroy`). To tear down on purpose: `terraform state rm 'module.instance.terraform_data.destroy_lock'`, set `TF_CONFIRM_DELETE_WORKERS=all`, then destroy. R2 refuses to delete a non-empty bucket. |

## Several instances

Give each instance its own state and `instance_name` (3-30 characters; every name derives from it).
`examples/silo` pins an instance to one Clerk organization (`tenant = { mode = "single", id = "org_..." }`):
anyone else, including users with no organization, is refused.

## State and secrets

Secrets (the Clerk webhook secret, integration credentials) are `sensitive`, travel to the uploader
in an environment variable and never appear in outputs or logs. They are still in Terraform state,
so the state must be in an encrypted backend with locking and restricted access. One state per
instance. Never commit `*.tfvars`.

## Measuring AI usage per client

With `ai_gateway.enabled`, the backend sends every model request through the gateway tagged with
`cf-aig-metadata`: `client` (the user's tenant: a Clerk organization id, or `u_<user id>` for a personal
workspace), `user` (the Clerk user id), and for gadget calls `source`, `gadgetId`, `automated` and
`chatId`. Users that belong to no tenant (accounts that predate Clerk) get `ai_gateway.default_client`
(default `default`), so nothing arrives unattributed.

```hcl
ai_gateway = { enabled = true, name = "default", default_client = "unassigned" }
```

How to read it:

- **One gateway for the pool**: filter the gateway's *Logs* by `client`; export them (Logpush, or the
  logs API) to total tokens and cost per client. The dashboard and GraphQL analytics group by gateway,
  model and provider, not by metadata, so per-client totals in a shared gateway come from the logs.
- **A gateway per silo**: give each silo its own `ai_gateway.name` (with `create = true`) and its
  dashboard, GraphQL analytics, spend and rate limits are that customer's alone.
- AI Gateway saves only the first five metadata entries; `client` and `user` come first and `chatId`
  is the one dropped when a gadget call carries all six.
- Document-to-Markdown conversion for `webFetch` goes through the gateway tagged `tool: webFetch`
  without a client; it uses no model.

## Error reporting

The release has no error-reporter Worker. To use one, deploy it yourself and bind it to the backend:
`backend_extra_bindings = [{ type = "service", name = "FRONTEND_ERROR_REPORTER", service = "<worker>" },
{ type = "ratelimit", name = "FRONTEND_ERROR_RATE_LIMITER", namespace_id = "<id>", simple = { limit = 60, period = 60 } }]`.
Logging and tracing for every Worker are the `observability` variable.

## Adopting resources that already exist

Resources made by hand or by Wrangler are not adopted automatically. A plan that would create one
that exists fails at apply with the API's "already exists" error. For stores, import before applying:

```sh
terraform import 'module.instance.cloudflare_workers_kv_namespace.kv["workshop-backend:BLUEPRINTS"]' <account_id>/<namespace_id>
terraform import 'module.instance.cloudflare_r2_bucket.r2["workshop-backend:BLUEPRINT_CONTENT"]' <account_id>/<bucket_name>
```

Workers need no import: the uploader replaces a script of the same name. Use the existing names
(`<instance_name>-<package>`) so the Durable Object data stays attached.

## Testing

```sh
node --test scripts/terraform/*.test.ts        # uploader, release checks, Terraform -> uploader smoke test
cd infra/terraform/modules/instance
terraform init -backend=false && terraform validate && terraform test
```

`terraform test` plans against a fixture release with the provider mocked, so no provisioner runs.
The smoke test runs the module against a local stand-in for the Cloudflare API. Nothing here applies
to a live account; do that first with the workers.dev address in a scratch account.

Regenerate the fixture after a manifest contract change: `node scripts/terraform/make-test-release.ts`.
