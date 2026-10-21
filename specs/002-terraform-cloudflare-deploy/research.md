# Research: Terraform Deployment to Cloudflare

No `NEEDS CLARIFICATION` items remained. Findings below come from the starter project, this
repository's release tooling, the provider's published schema (v5.28.0, 2026-10-13) and Wrangler
4.147's own code, which is the reference client for the Workers API.

## R1. What does the starter do, and what carries over?

- The starter generates temporary `wrangler.prod.jsonc` files per worker from a `deployment.jsonc`,
  then deploys router, gatekeepers and Workshop in order. Its configuration model is the template:
  account, worker names, public route (custom domain or workers.dev), identity, admins, AI gateway,
  resources (KV/R2 provisioning), observability.
- **Carried over**: the single configuration, validation up front, the public-origin rules
  (custom domain derives it; workers.dev requires it explicitly and it must match), the ordering,
  `observability` knobs.
- **Not carried over**: Access mode (Clerk replaces it), the demo custom gatekeeper, the error
  reporter Worker (not in this repo's release).

## R2. Which provider resources cover what?

- **Native**: `cloudflare_workers_kv_namespace`, `cloudflare_r2_bucket`,
  `cloudflare_workers_custom_domain`, `cloudflare_workers_script_subdomain`, `cloudflare_zone`
  (data), `cloudflare_ai_gateway`, and `cloudflare_workers_script` for the router.
- **Gap 1: no `worker_loader` binding.** The binding enum of `cloudflare_workers_script` and
  `cloudflare_worker_version` has `ai, browser, durable_object_namespace, kv_namespace, r2_bucket,
  service, secret_text, plain_text, json, ...` but no `worker_loader`. The backend's `LOADER` binding
  (the Gadget sandbox) is not optional.
- **Gap 2: no service-binding `props`.** The manifest's `gatekeeperBindingExpansion.propsByPackage`
  has the backend pass `{ sharingDomain: $PUBLIC_BASE_URL }` to the context gatekeeper.
- **Gap 3: migrations.** The provider forwards `migrations` as configured. The API needs the delta
  against the script's current tag, which Wrangler computes by reading the deployed script
  (`GET /workers/services/<name>` -> `default_environment.script.migration_tag`). Every
  gatekeeper and the backend carry migrations.
- **Decision**: backend and all gatekeepers go through `scripts/terraform/deploy-worker.ts`, which
  mirrors Wrangler's behaviour exactly (migration delta, `steps`, `old_tag`/`new_tag`). The router
  stays native because static assets use a two-mode upload-session protocol the provider already
  implements and the router needs none of the gaps.
- **Alternatives**: (a) Native for everything: impossible for the backend (Gap 1). (b) Wrangler under
  the hood: violates the requirement. (c) The beta `cloudflare_worker_version`: same binding enum.
  (d) Declarative `exports` instead of migrations: newer and unverified here, so not relied on.
  When the provider adds `worker_loader`/`props`, scripts can move to native resources.

## R3. How are placeholders rendered?

The manifest's placeholder set is closed (`manifest-lib.ts`): `$ACCOUNT_ID`, `$KV_<BINDING>_ID`,
`$R2_<BINDING>_NAME`, `$WORKER_NAME(<pkg>)`, `$SECRET(<name>)`, `$PUBLIC_BASE_URL`. The module resolves
them structurally by binding type (KV id, bucket name, service name, secret) and by token replace in
vars. A precondition fails the plan if any `$` remains, matching the deploy renderer's "fail on an
unrecognized token" rule.

## R4. Gatekeeper bindings

- Binding name: `GATEKEEPER_<SHORTNAME>` (`shortName` from the manifest, upper-cased).
- Backend: `type: service`, `entrypoint: GatekeeperVendor`, plus the manifest's props.
- Router: plain service binding (default entrypoint); it routes `/gatekeeper/<shortName>/*`.
- Install set: `preinstall` workers always; others when the operator enables them. A worker whose
  manifest `inputs` declare secrets needs each supplied, else the plan fails.
- One install per package (as the manifest's `singleton` flags already assume for several); multiple
  OAuth apps per vendor are out of scope.

## R5. Ordering without ever deleting data

- Create: storage -> gatekeeper uploads -> backend upload -> router -> domain.
- Upload resources use `triggers_replace`; replacing one re-runs the upload and has **no destroy
  provisioner**. Deleting a script is a separate, stable `terraform_data` whose destroy provisioner
  calls the uploader's delete mode, so editing a worker never deletes it. The delete mode refuses
  unless `TF_CONFIRM_DELETE_WORKERS` names the worker (or `all`), covering "an integration that holds
  data is disabled".
- A removed gatekeeper is deleted only after the backend upload that stops binding it has completed
  (the backend upload depends on every gatekeeper's delete resource).

## R6. Protecting data and identity

- KV `title` and R2 `name` carry `ignore_changes`, so no configuration edit can replace a store.
- One resource, `terraform_data.protection_lock`, has `prevent_destroy = true` and
  `triggers_replace` on instance name, account id, public origin and sharing domain. Changing any of
  those, or running `terraform destroy`, produces a plan error before anything changes (SC-008).
  Acknowledging is `terraform state rm 'module.<name>.terraform_data.protection_lock'` (documented).
- The sharing domain equals the public origin: the manifest passes it as `sharingDomain`, and the
  context library scopes its data by it, which is why changing it hides data silently.

## R7. Releases need a Clerk-capable frontend

`build-release.ts` builds only `VITE_CF_ACCESS_MODE=true`, recorded as the `access` variant. That
flag makes the SPA use Access instead of Clerk. The release gains a second variant `standard`
(same build without the flag). Both builds write `workshop-frontend/dist`, so they run in sequence;
the router bundle only needs `dist` to exist. The module selects the variant by name
(`frontend_variant`, default `standard`) and fails with a clear message when it is absent.

## R8. Checksums and completeness

HCL checks every module blob with `filesha256()` against the manifest (a precondition per worker).
`verify-release.ts` does the same plus asset content keys (`cfAssetHash`), and confirms the chosen
variant exists, before `terraform init`; the quickstart runs it first. The router's native upload
also materializes assets from content-addressed blobs: `verify-release.ts --materialize` writes the
`<release>/asset-trees/<variant>/` directory the provider's `assets.directory` requires.

## R9. Secrets and state

Secrets are `sensitive` variables, become `secret_text` bindings and are passed to the uploader via
environment, never arguments. They also land in Terraform state (`terraform_data` inputs and the
provider's state for the router), so the runbook requires an encrypted remote state with locking and
documents rotation. Outputs never include secrets.

## R10. Testing without a Cloudflare account

`terraform test` with `mock_provider "cloudflare"` and `command = plan` exercises variable
validation, rendering, naming, ordering inputs and preconditions without running provisioners (plan
runs do not execute them). The uploader is tested with an injected `fetch` that asserts the exact
multipart metadata, migration delta, and delete refusal. A real apply was not possible; the
quickstart marks the steps that need a live account.

## R11. Multi-instance and tenancy

Every name derives from `instance_name`; examples show a pool and a dedicated silo (`tenant_mode =
"single"`, `tenant_id = org id`), each its own state. Account-limit and name-collision checks are
validations/preconditions; adopting pre-existing resources is documented as `terraform import`.
