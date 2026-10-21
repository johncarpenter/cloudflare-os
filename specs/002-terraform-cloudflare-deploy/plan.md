# Implementation Plan: Terraform Deployment to Cloudflare

**Branch**: `002-terraform-cloudflare-deploy` | **Date**: 2026-10-14 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-terraform-cloudflare-deploy/spec.md`

## Summary

A reusable Terraform module (`infra/terraform/modules/instance`) deploys one instance of the product
from an already built release (`scripts/release/build-release.ts` output: `manifest.json`,
content-addressed modules and assets). The module is the Terraform replacement for the starter's
Wrangler flow and plays the role of the deploy service that consumes the manifest: it provisions
storage, renders each worker's bindings from the manifest's templates, deploys the workers in
dependency order, attaches the public domain, and exposes the values the operator needs for Clerk.

Two capability gaps in the Cloudflare provider (v5.28) shape the design, both confirmed against its
schema: `cloudflare_workers_script` has **no `worker_loader` binding** (the Gadget sandbox cannot run
without it) and **no service-binding `props`** (the backend passes the context gatekeeper's
`sharingDomain` that way), and it does not compute Durable Object migration deltas. So the backend
and every gatekeeper are deployed by a small, tested uploader (`scripts/terraform/deploy-worker.ts`)
that implements the same Workers script-upload semantics as Wrangler, driven by `terraform_data`;
the router, which needs static assets and none of those features, uses the native
`cloudflare_workers_script`. Storage, custom domain, workers.dev and the optional AI gateway are
native provider resources.

A second, separate change makes releases Clerk-capable: `build-release.ts` additionally builds the
standard (non-Access) frontend as a `standard` asset variant (FR-012).

## Technical Context

**Language/Version**: Terraform ≥ 1.9 (HCL); Node ≥ 24.19 TypeScript scripts (the repo's existing
`scripts/` convention: run directly by `node`, erasable syntax only).

**Primary Dependencies**: `cloudflare/cloudflare` provider `~> 5.28`; Cloudflare REST API (Workers
script upload, script settings); no new npm dependencies (Node `fetch`, `FormData`, `crypto`).

**Storage**: Terraform state (operator-chosen backend); Cloudflare KV/R2/Durable Objects are the
product's own stores.

**Testing**: `terraform validate` and `terraform test` with `mock_provider` (plan-only runs, so no
provisioner executes); Node `node:test` for the uploader and release changes; the existing
`scripts` type-check.

**Target Platform**: Cloudflare account (Workers, KV, R2, optional AI Gateway); operator machine
with Terraform and Node.

**Project Type**: Infrastructure module plus tooling inside the existing monorepo.

**Performance Goals**: First launch of ~3 workers (router, backend, two gatekeepers) in minutes;
re-plan of an unchanged instance makes no API writes.

**Constraints**: Constitution VII (no hand-edited generated Wrangler files; none are produced) and
IV (no secrets in logs/outputs). No live Cloudflare account is available to the author, so API
behaviour is verified by unit tests against documented and Wrangler-observed contracts only.

**Scale/Scope**: One state per instance; the release manifest has 20 workers, of which 2 are
installed by default and up to 18 are optional.

## Constitution Check

| Principle | Status | Notes |
|---|---|---|
| I. Kernel bar | Pass | No change to `workshop-backend` or `workshop-shared`. |
| II. Capability security | Pass | `ADMINS`, Clerk and tenant settings stay environment variables on the backend, set by the operator in Terraform, never `AdminConfig`. Secrets are `secret_text` bindings; the uploader never logs them. Router is the only public worker. |
| III. RPC discipline | N/A | No RPC changes. |
| IV. Observability without leakage | Pass | Secrets are `sensitive`, kept out of outputs, logs and error messages; the uploader redacts. |
| V. Frontend conventions | N/A | Only a build-variant change to the release script. |
| VI. Verified, meaningful tests | Pass | Refusal tests: placeholders left, name collisions, missing credentials, public-origin lock, checksum mismatch, unknown `$` token. |
| VII. Config and release integrity | Pass | Consumes the manifest as the single contract; the release build change is covered by the manifest tests. |

No violations; Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/002-terraform-cloudflare-deploy/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── module-interface.md     # variables, outputs
│   ├── worker-spec.md          # JSON handed to the uploader
│   └── release-contract.md     # what the module reads from a release
└── tasks.md
```

### Source Code (repository root)

```text
infra/terraform/
├── README.md                          # operator runbook (FR-026)
├── modules/instance/
│   ├── versions.tf  variables.tf  locals.tf
│   ├── storage.tf        # KV namespaces, R2 buckets (native)
│   ├── render.tf         # placeholder resolution -> API-shaped bindings, gatekeeper expansion
│   ├── workers.tf        # uploader-driven workers + native router, ordering
│   ├── access.tf         # custom domain / workers.dev
│   ├── ai.tf             # optional AI gateway
│   ├── locks.tf          # identity + destroy protection
│   ├── outputs.tf
│   └── tests/*.tftest.hcl
└── examples/
    ├── pool/   (main.tf, variables.tf, terraform.tfvars.example)
    └── silo/   (main.tf, terraform.tfvars.example)

scripts/terraform/
├── deploy-worker.ts  + .test.ts       # multipart upload, migration delta, delete
├── worker-api.ts                      # Cloudflare REST client (injectable fetch)
└── verify-release.ts + .test.ts       # checksums, completeness, Clerk variant present

scripts/release/build-release.ts       # + `standard` frontend variant
```

**Structure Decision**: Infra lives in `infra/terraform` (not under `packages/`, which are pnpm
workspaces). Node helpers live in `scripts/terraform` so they inherit the existing script
type-check and `node --test` convention.

## Key Design Decisions (details in research.md)

1. **Consume a release** (approved): read `manifest.json` with `jsondecode(file())`; never rebuild.
2. **Uploader for backend and gatekeepers; native resource for the router** (provider gaps).
3. **Render in HCL, upload dumb**: the module resolves the manifest's closed placeholder set and
   hands the uploader finished API metadata; the uploader never templates.
4. **Uploads are `terraform_data` with `triggers_replace`, and deletion is a separate stable
   resource**, so changing a worker re-uploads without ever deleting its Durable Object data.
5. **Protection by `prevent_destroy` on one lock resource** whose replacement triggers cover the
   instance name, account and public origin; the documented acknowledgement is `terraform state rm`.
6. **Names ignored after creation** on KV and R2, so no config edit can replace a data store.
