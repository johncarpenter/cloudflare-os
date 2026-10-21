# Tasks: Tenant Branding and Blueprint Isolation

**Input**: `specs/003-tenant-branding-blueprint-isolation/` (plan, spec, research, data-model, contracts, quickstart)

**Tests**: Included (constitution VI: refusal tests for every security boundary).

**Commit grouping** (constitution I): (1) blueprint isolation, `workshop-backend` + `workshop-shared`; (2) tenant branding, `workshop-backend` + `workshop-shared`; (3) frontend for both.

## Format: `- [ ] [TaskID] [P?] [Story?] Description with file path`

Stories: US1 members see branding, US2 admin sets/clears, US3 blueprints stay in the org, US4 shared catalog stays shared, US5 existing data, US6 operator controls.

## Phase 1: Setup

- [x] T001 Confirm baseline is green before changes: `pnpm exec vitest run` in `packages/workshop-backend`, record counts in the commit message

## Phase 2: Foundational (blocks all stories)

- [x] T002 Normalized organization-admin check: `isOrganizationAdmin(orgRole)` (`admin` for token v2, `org:admin` for v1) in `packages/workshop-backend/src/tenant.ts`, with tests in `packages/workshop-backend/__tests__/tenant.test.ts`
- [x] T003 Refresh the session's role at every renewal: make `TenantContext.orgRole` updated in `AuthenticatedApiImpl.renewSession` and expose a getter for capabilities, in `packages/workshop-backend/src/server.ts`
- [x] T004 [P] Add `tenantId?` to `BlueprintKvRecord` with a doc comment in `packages/workshop-backend/src/storage-schema/blueprints-kv.ts`
- [x] T005 [P] Shared types with doc comments in `packages/workshop-shared/src/api.ts`: `TenantBranding`, `EffectiveBranding`, `TenantBrandingSummary`, `TenantAdminApi`, `hasScreenshot` on `BlueprintPublicInfo` and `BlueprintUserSummary`, `tenantBrandingEnabled` on `AdminConfig`/view, new `AuthenticatedApi` and `AdminApi` methods per `contracts/rpc-api.md`

## Phase 3: User Story 3 - Blueprints published by an organization stay inside it (P1) 🎯 MVP

**Independent test**: A publishes; A reads every way; B and a signed-out visitor get "not found" for each, identical to a random id.

- [x] T006 [US3] Create `packages/workshop-backend/src/blueprint-access.ts`: `blueprintClass`, `mayReadBlueprint`, `readBlueprintFor(env, id, caller)` (record or undefined), `isGlobalBlueprint`; inert when Clerk is disabled
- [x] T007 [US3] Record `tenantId` on publish in `Overseer.propagateBlueprint` (`packages/workshop-backend/src/overseer.ts`) and on import in `AuthenticatedApiImpl.importBlueprint` (`packages/workshop-backend/src/server.ts`)
- [x] T008 [US3] `PublicApi.getBlueprint` / `downloadBlueprint` serve bundled blueprints only in a Clerk deployment; add `AuthenticatedApi.getBlueprint` / `downloadBlueprint` / `getBlueprintScreenshot` in `packages/workshop-backend/src/server.ts`
- [x] T009 [US3] Route `newGadgetFromBlueprint` (`server.ts`), `Overseer.applyBlueprint`, `initializeFromBlueprint`, `fetchBlueprint` (`overseer.ts`) and `UserDurableObject.addBlueprintToLibrary` (`user.ts`) through `readBlueprintFor`
- [x] T010 [US3] `serveBlueprintScreenshot` serves bundled blueprints only in a Clerk deployment (404 otherwise); tenant blueprints' `screenshotUrl` omitted and `hasScreenshot` set in `publicBlueprintInfo` (`server.ts`) and the two producers in `overseer.ts`
- [x] T011 [US3] Audit log `blueprint.access.refused` (tenant and user ids only) from the authenticated refusal paths
- [x] T012 [US3] [P] Unit tests `packages/workshop-backend/__tests__/blueprint-access.test.ts`: classification table, fail-closed owner-only, global when Clerk is off
- [x] T013 [US3] [P] Integration test `packages/workshop-backend/__integration__/blueprint-isolation.test.ts`: every surface for owner tenant, other tenant, signed-out; refusals equal a random id's; publisher leaves → still available

## Phase 4: User Story 4 - The shared catalog stays shared (P2)

- [x] T014 [US4] Refuse tenant-owned blueprints in `AdminSettings.promoteFormat` and featuring (`packages/workshop-backend/src/admin-settings.ts`); bundled unaffected
- [x] T015 [US4] [P] Tests in `blueprint-isolation.test.ts`: bundled usable by both tenants; promote/feature of a tenant blueprint refused

## Phase 5: User Story 5 - Existing deployments and data (P2)

- [x] T016 [US5] Backfill sweep in `AdminSettings` (marker, idempotent, retried): attribute unattributed records through the owner's profile, drop tenant-owned featured entries, in `packages/workshop-backend/src/admin-settings.ts` and triggered from the `/api` request path in `server.ts`
- [x] T017 [US5] Existing gadget following another tenant's blueprint: update path reports "unavailable" with a reason (`Overseer.applyBlueprint` error text) in `overseer.ts`
- [x] T018 [US5] [P] Tests in `blueprint-isolation.test.ts`: pre-feature record owner-only then attributed by the sweep; sweep idempotent; non-Clerk deployment unchanged

## Phase 6: User Story 2 - An organization administrator sets and clears branding (P1)

**Independent test**: admin sets/clears parts; member and non-admin refused; invalid input refused; role removal refused at next renewal.

- [x] T019 [US2] `packages/workshop-backend/src/tenant-branding.ts`: validation (name, accent color via the existing accent validator, logo via `validateSiteLogo`) and `effectiveBranding`
- [x] T020 [US2] Branding table and `getBranding` / `setIdentity` / `setLogo` / `clearBranding` in `UserDirectoryDurableObject` (`packages/workshop-backend/src/user-directory.ts`); `eraseTenant` clears it
- [x] T021 [US2] `TenantAdminApiImpl` capability (re-checks the current role on every call) and `AuthenticatedApi.getTenantAdminApi` / `getBranding` in `packages/workshop-backend/src/server.ts`; `AdminConfig.tenantBrandingEnabled` in `packages/workshop-backend/src/admin-config.ts` and storage schema
- [x] T022 [US2] Branding index table and `branding.changed` audit in `AdminSettings` (`admin-settings.ts`), written by the save/clear path
- [x] T023 [US2] [P] Unit tests `packages/workshop-backend/__tests__/tenant-branding.test.ts`: validation table, partial set/clear, last clear removes the row
- [x] T024 [US2] [P] Integration test `packages/workshop-backend/__integration__/tenant-branding.test.ts`: admin writes; member / other tenant / personal refused; role removed at renewal refused; B never sees A's; feature off hides and keeps

## Phase 7: User Story 1 - Members see their organization's branding (P1)

- [x] T025 [US1] `getBranding` returns effective branding (name, inline PNG data URL, color) for the active organization, null otherwise (`server.ts`); covered in `tenant-branding.test` integration (T024)
- [x] T026 [US1] Frontend `packages/workshop-frontend/src/branding/useTenantBranding.ts` and `TenantBrandingProvider.tsx`: fetch after sign-in, merge over `ServerConfig`, clear on workspace switch; mount in `routes/__root.tsx`; apply accent and favicon from the merged config in `main.tsx` / provider
- [x] T027 [US1] [P] Frontend tests `packages/workshop-frontend/src/branding/TenantBrandingProvider.test.tsx`: merge, partial fallback, no leak across switches, sign-in pages unaffected

## Phase 8: Frontend for blueprints and branding management (US2, US3)

- [x] T028 [US2] `packages/workshop-frontend/src/branding/BrandingSettings.tsx`: admin-only page (name, PNG logo via `prepareSiteLogo`, accent color, preview, clear per part), route and menu entry shown only when `getTenantAdminApi` is non-null
- [x] T029 [US3] `packages/workshop-frontend/src/components/BlueprintPreviewImage.tsx` and users of `screenshotUrl` (`BlueprintsPage.tsx`, `GadgetList.tsx`, `BlueprintLandingPage.tsx`): load private images over RPC into a blob URL, revoked on cleanup
- [x] T030 [US3] `packages/workshop-frontend/src/BlueprintLandingPage.tsx`: signed-in uses `AuthenticatedApi.getBlueprint`; signed-out null shows one generic "sign in to continue" for every id
- [x] T031 [US2] [P] Tests: `BrandingSettings.test.tsx` (hidden for non-admins, validation messages), `BlueprintPreviewImage.test.tsx`, landing page signed-out copy

## Phase 9: User Story 6 - Operator controls (P3)

- [x] T032 [US6] `AdminApi.listTenantBranding` / `clearTenantBranding` and the off switch in `packages/workshop-backend/src/admin-settings.ts`; audit as `operator`
- [x] T033 [US6] Operator panel "Tenant branding" (list, clear, switch) in `packages/workshop-frontend/src/AdminPage.tsx`
- [x] T034 [US6] [P] Integration tests in `tenant-branding.test.ts`: operator lists/clears/toggles; non-operator refused

## Phase 10: Polish

- [x] T035 Docs: `docs/blueprints.md` (tenant privacy), `docs/clerk-signin.md` (branding roles), `AGENTS.md` pointer; spec 003 notes
- [x] T036 Run backend unit + integration suites, frontend suite, `pnpm run lint:check`, `pnpm run build`; fix fallout; list quickstart steps that need a live Clerk instance and were not run

## Dependencies

Foundational (T002-T005) → US3 (T006-T013) → US4 / US5 (T014-T018). US2 backend (T019-T024) depends only on T002-T005 and can proceed after Foundational, independent of US3. US1 (T025-T027) needs T020-T021. Frontend (T028-T031) needs the backend of its story. US6 (T032-T034) needs T022.

## Parallel examples

- After Foundational: US3 backend (T006-T011) and US2 backend (T019-T022) touch different files except `server.ts` and `admin-settings.ts`, so they are done in sequence by one developer but reviewed as separate commits.
- Tests T012, T013, T023, T024 are written beside their implementation.

## Implementation strategy

MVP = Foundational + US3 (the leak). Then US2 + US1 (branding backend and its display), then US4/US5/US6, then the frontend polish. Commit each of the three parts separately.
