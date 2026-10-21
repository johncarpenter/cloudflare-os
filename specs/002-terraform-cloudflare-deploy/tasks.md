# Tasks: Terraform Deployment to Cloudflare

**Input**: `specs/002-terraform-cloudflare-deploy/` (plan, spec, research, data-model, contracts, quickstart)

**Tests**: Included. Constitution VI requires refusal tests; Terraform behaviour is tested with
`terraform test` + `mock_provider` (plan runs, so no provisioner executes), tooling with `node:test`.

**Honest limit**: no Cloudflare account is available while implementing, so nothing here is applied
against the live API. Live-only checks are listed in `quickstart.md` and called out in T034.

## Format: `- [ ] [TaskID] [P?] [Story?] Description with file path`

## Phase 1: Setup

- [x] T001 Create `infra/terraform/modules/instance/versions.tf` (terraform >= 1.9, provider `cloudflare/cloudflare ~> 5.28`) and `.gitignore` entries for Terraform state, `.terraform/`, `*.tfvars`, release trees in the repo `.gitignore`
- [x] T002 [P] `infra/terraform/README.md` and `examples/` directories

## Phase 2: Foundational (blocks all stories)

- [x] T003 Release change (FR-012): build the `standard` frontend variant in `scripts/release/build-release.ts` (sequential after the Access build, both collected, `assetVariants = { access, standard }`)
- [x] T004 [P] `scripts/terraform/worker-api.ts`: minimal Cloudflare REST client with injectable `fetch` (get migration tag, multipart PUT, delete), errors that never echo binding text
- [x] T005 `scripts/terraform/deploy-worker.ts`: `deploy` and `delete` modes per `contracts/worker-spec.md` (spec from `WORKER_SPEC`, checksum verification, migration delta, delete confirmation)
- [x] T006 [P] `scripts/terraform/deploy-worker.test.ts`: delta table (empty, none, at end, inside, unknown tag), multipart metadata shape, checksum mismatch refusal, delete refusal/confirmation/404, no secret in errors
- [x] T007 [P] `scripts/terraform/verify-release.ts`: manifest present, module and asset checksums, chosen variant present, `--materialize` asset tree
- [x] T008 [P] `scripts/terraform/verify-release.test.ts` using a temp release built in the test
- [x] T009 Module variables and validations in `infra/terraform/modules/instance/variables.tf` (all of `contracts/module-interface.md`)
- [x] T010 Module locals in `infra/terraform/modules/instance/locals.tf`: read manifest, naming, gatekeeper install set, closed-placeholder rendering of bindings and vars, rendered worker specs, preconditions inputs
- [x] T011 Storage in `infra/terraform/modules/instance/storage.tf`: KV namespaces and R2 buckets from the manifest bindings, `ignore_changes` on names

**Checkpoint**: tooling and rendering exist; nothing deployed yet.

## Phase 3: User Story 1 - Launch a complete instance (P1) 🎯 MVP

**Independent test**: `terraform test` plans a full instance from a fixture release and shows every component, connection and output; invalid inputs fail before changes.

- [x] T012 [US1] `infra/terraform/modules/instance/workers.tf`: uploader-driven `terraform_data` per backend/gatekeeper worker (`triggers_replace`, local-exec `deploy-worker.ts` with `WORKER_SPEC`), dependency order gatekeepers -> backend
- [x] T013 [US1] Same file: native `cloudflare_workers_script` router with `assets.directory` from the materialized tree, service bindings to the backend and gatekeepers, `depends_on` the uploads
- [x] T014 [US1] `infra/terraform/modules/instance/access.tf`: custom domain (zone lookup, hostname-in-zone check) or workers.dev subdomain
- [x] T015 [US1] `infra/terraform/modules/instance/outputs.tf`: public origin, Clerk webhook URL and authorized parties, worker names, stores, release id (no secrets)
- [x] T016 [US1] [P] Test fixture release (small manifest + blobs) under `infra/terraform/modules/instance/tests/fixtures/` and `tests/launch.tftest.hcl` (components, bindings incl. `worker_loader` and props, outputs, defaults install exactly context + scheduler)
- [x] T017 [US1] [P] `tests/validation.tftest.hcl`: bad account id, instance name, both/neither access modes, bad origin, no operators, single tenant without id, missing frontend variant, tampered module, leftover placeholder (`expect_failures`)

**Checkpoint**: US1 independently plannable and testable.

## Phase 4: User Story 2 - Change and re-apply safely (P1)

- [x] T018 [US2] Verify idempotence by construction: `triggers_replace` contains only inputs that change the uploaded artifact; secrets hashed separately; document in `workers.tf` header
- [x] T019 [US2] [P] `tests/change.tftest.hcl`: a changed operator list changes only the backend spec; a changed release changes only affected workers; observability override reaches every spec
- [x] T020 [US2] Secret rotation: `gatekeeper_secrets`/`clerk_webhook_secret` change re-uploads only the worker using it (test in `tests/change.tftest.hcl`)

## Phase 5: User Story 3 - Keep the public identity stable (P1)

- [x] T021 [US3] `infra/terraform/modules/instance/locks.tf`: `terraform_data.protection_lock` (`prevent_destroy`, `triggers_replace` of instance/account/public origin/sharing domain)
- [x] T022 [US3] Public-origin consistency validations (custom domain vs explicit origin, workers.dev shape and router-name match) in `variables.tf`/`locals.tf`
- [x] T023 [US3] [P] `tests/identity.tftest.hcl`: mismatched origin refused; lock inputs include all four values

## Phase 6: User Story 4 - Upgrade and roll back (P2)

- [x] T024 [US4] Ordering and delta: gatekeeper uploads precede the backend upload, which precedes the router; removed gatekeeper deleted only after the backend upload (`depends_on` wiring in `workers.tf`)
- [x] T025 [US4] [P] `tests/upgrade.tftest.hcl`: release B vs A plan differences; release lacking the variant or with a bad checksum refused

## Phase 7: User Story 5 - Choose integrations (P2)

- [x] T026 [US5] Gatekeeper install set, `GATEKEEPER_*` bindings (backend entrypoint + props, router default), required-secret validation from manifest `inputs`, unknown/uninstallable key rejection in `locals.tf`/`variables.tf`
- [x] T027 [US5] [P] `tests/integrations.tftest.hcl`: default two; enable one with secrets; missing secret refused; email (not installable) refused; router and backend bindings follow the set

## Phase 8: User Story 6 - Several instances (P2)

- [x] T028 [US6] Name derivation and length/collision validations (workers, KV, R2) in `locals.tf`
- [x] T029 [US6] [P] `infra/terraform/examples/pool` and `examples/silo` (single tenant) with `terraform.tfvars.example` and backend example; `tests/instances.tftest.hcl` covering distinct names for two instance names and the silo tenant vars

## Phase 9: User Story 7 - Teardown protection (P3)

- [x] T030 [US7] Delete mode confirmation wired through the stable per-worker delete resource (destroy provisioner) in `workers.tf`
- [x] T031 [US7] [P] Test in `tests/identity.tftest.hcl` that a destroy of the lock is blocked (`prevent_destroy` present via plan failure expectation) and document the acknowledgement

## Phase 10: Polish

- [x] T032 AI gateway (`ai.tf`: optional creation, backend `CF_AI_GATEWAY*` vars) and observability overrides applied to every worker
- [x] T033 `infra/terraform/README.md` runbook: prerequisites and token permissions, first launch, Clerk steps, upgrade/rollback, rotation, adopting resources (`terraform import`), teardown acknowledgement, remote encrypted state, provider gaps and the uploader, error reporting via `backend_extra_bindings`; link from `AGENTS.md` and `docs/clerk-signin.md`
- [x] T034 Run `terraform fmt/validate/test`, `node --test`, `pnpm run types:scripts`, `pnpm run lint:check`; record which quickstart steps are live-only and were not run

## Implementation notes (deviations and findings)

- Destroy and identity protection are two resources, not one: `terraform_data.identity_lock` (values recorded once, `ignore_changes`, enforced by a `preflight` precondition so it is testable) and `terraform_data.destroy_lock` (`prevent_destroy`, not assertable with `terraform test`, so it is verified by Terraform semantics and the runbook only).
- `uploader_command` was added so the uploader can be stubbed or containerised; `CLOUDFLARE_API_BASE_URL` lets the uploader target a proxy or the local API stand-in used by `scripts/terraform/module-smoke.test.ts`.
- Rollback past an applied migration is refused by the uploader (Wrangler would re-send every step, which the API rejects).
- Error reporting is a `backend_extra_bindings` pass-through, since the release has no reporter Worker.
- T018/T019/T020 idempotence and per-secret targeting hold by construction (`triggers_replace` is a hash of exactly what is uploaded) and are exercised in the smoke test only for a first apply; a second-apply no-change check needs a live account.
