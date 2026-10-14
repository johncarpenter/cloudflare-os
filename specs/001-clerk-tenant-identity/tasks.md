# Tasks: Clerk Sign-In and Tenant Identity

**Input**: Design documents from `/specs/001-clerk-tenant-identity/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Included. The constitution (Principle VI) requires refusal tests for every security boundary.

**Commit grouping** (constitution I): backend + shared (`packages/workshop-backend`, `packages/workshop-shared`) in separate commits from the frontend (`packages/workshop-frontend`).

## Format: `- [ ] [TaskID] [P?] [Story?] Description with file path`

- **[P]**: parallelizable (different files, no dependency on an incomplete task)
- **[USn]**: user story from spec.md

## Phase 1: Setup

- [x] T001 Add optional Clerk/tenant env vars (`CLERK_ISSUER`, `CLERK_PUBLISHABLE_KEY`, `CLERK_AUTHORIZED_PARTIES`, `CLERK_WEBHOOK_SECRET`, `TENANT_MODE`, `TENANT_ID`) to the backend `Env` typing in `packages/workshop-backend/src/server.ts` (Env type) and `packages/workshop-backend/src/env.d.ts`
- [x] T002 [P] Add `@clerk/clerk-react` to `packages/workshop-frontend/package.json` and install (`pnpm install`)

## Phase 2: Foundational (blocks all stories)

- [x] T003 Add the shared API additions with doc comments in `packages/workshop-shared/src/api.ts`: `PublicApi.authenticateFromClerk`, `AuthenticatedApi.renewSession/getWorkspaceInfo/rememberWorkspace`, types `WorkspaceInfo`, `ClerkClientConfig`, `ServerConfig.clerk`, `AUTH_ERROR_CODES.sessionNotPermitted/sessionExpired` (+ messages)
- [x] T004 [P] Create the TenantContext seam `packages/workshop-backend/src/tenant.ts` (key format, `tenantOfProfileId`, `userIdOfProfileId`, `sameTenant`, `personalTenantId`, `resolveTenant` incl. single-tenant pin)
- [x] T005 [P] Create `packages/workshop-backend/src/auth/clerk.ts`: `verifyClerkSessionToken` (JWKS, iss, azp, exp, v1/v2 org claims) returning `ClerkClaims`
- [x] T006 Extend `packages/workshop-backend/src/auth/config.ts`: `isClerkEnabled`, `getClerkConfig`, and make password auth / gatekeeper sign-in unavailable when Clerk is enabled
- [x] T007 Add Clerk storage fields (`membershipEndedAt`, `lastWorkspace`, `knownTenants`) in `packages/workshop-backend/src/storage-schema/user-storage.ts`
- [x] T008 Add `UserDurableObject.authenticateFromClerk` (+ `checkClerkSession`) in `packages/workshop-backend/src/user.ts`: create on first use honouring `signupsEnabled`, refresh display name, honour `membershipEndedAt`
- [x] T009 [P] Tests for `tenant.ts` in `packages/workshop-backend/__tests__/tenant.test.ts` (key round-trip, legacy ids, single pin, NUL rejection)
- [x] T010 [P] Tests for token verification in `packages/workshop-backend/__tests__/clerk-verify.test.ts` (valid; bad signature, issuer, azp, expired, no azp config → refuse; v1 and v2 org claims)

**Checkpoint**: seam, verifier and user-DO primitives exist; nothing is wired to a connection yet.

## Phase 3: User Story 1 - Sign up and sign in with a personal workspace (P1) 🎯 MVP

**Goal**: A visitor signs up/in via Clerk and reaches a personal tenant workspace keyed by Clerk user id.

**Independent Test**: Authenticate with a valid token → `AuthenticatedApi.whoami()` returns a profile whose id is `u_<id> NUL <id>`; invalid/expired tokens are refused with no DO created; renewals required.

- [x] T011 [US1] Wire `PublicApiImpl.authenticateFromClerk` and Clerk-disabled/legacy-disabled guards in `packages/workshop-backend/src/server.ts` (`login`, `createAccount`, `authenticate`, `startGatekeeperLogin`, `authenticateFromCfAccess`)
- [x] T012 [US1] Session liveness in `AuthenticatedApiImpl` (`packages/workshop-backend/src/server.ts`): `renewSession`, deadline + timer abort, liveness assert in the `#user` getter, `beginDeviceSessionHandoff` refusal on Clerk deployments
- [x] T013 [US1] Expose `ServerConfig.clerk` and `passwordAuthEnabled=false` in `packages/workshop-backend/src/deployment-config.ts`
- [x] T014 [US1] [P] Backend tests in `packages/workshop-backend/__integration__/clerk-rpc.test.ts`: first sign-in creates personal tenant; email change keeps the same DO; missing/expired/forged token refused with no state; renewal for a different user refused; lapse past deadline refused; legacy login refused when Clerk enabled
- [x] T015 [US1] Frontend provider `packages/workshop-frontend/src/clerk/ClerkAppProvider.tsx` (ClerkProvider from `ServerConfig.clerk`, bridge context) and mount it in `packages/workshop-frontend/src/main.tsx`
- [x] T016 [US1] [P] `packages/workshop-frontend/src/clerk/ClerkSignInPage.tsx` (Clerk `SignIn`/`SignUp` in the login shell); route `LoginPage.tsx` and `SignupPage.tsx` to it when Clerk is enabled
- [x] T017 [US1] `packages/workshop-frontend/src/clerk/useClerkSession.ts` and integrate into `packages/workshop-frontend/src/useAuth.ts` (authenticate with token, re-authenticate when user/org changes, 30 s renewal, sign-out via Clerk, error reporting id)
- [x] T018 [US1] Make `routes/__root.tsx` and `ProtectedRoute.tsx` treat Clerk like Access (spinner while Clerk loads / authenticating; sign-in page when signed out)
- [x] T019 [US1] [P] Frontend tests `packages/workshop-frontend/src/clerk/useClerkSession.test.tsx`: renewal cadence, session torn down when user changes, no authenticate while signed out

**Checkpoint**: US1 independently works (personal workspace).

## Phase 4: User Story 2 - Work inside an organization (P2)

**Goal**: Active Clerk organization selects the organization tenant; membership removal ends access.

**Independent Test**: Token with org claim → tenant is the org; two members share it; a removed member's renewal and webhook-marked session are refused; organizations are isolated.

- [x] T020 [US2] Verify org-claim tenant resolution end to end in `packages/workshop-backend/src/server.ts` (record `knownTenants` on the personal DO on org sign-in) and cover in `packages/workshop-backend/__integration__/clerk-rpc.test.ts`
- [x] T021 [US2] Create `packages/workshop-backend/src/auth/clerk-webhook.ts` (Svix verification with WebCrypto, `organizationMembership.deleted` and `user.deleted` handlers) and route `/api/clerk-webhook` in `packages/workshop-backend/src/server.ts`
- [x] T022 [US2] `UserDurableObject.endMembership` (set `membershipEndedAt`, revoke connected accounts, keep content) in `packages/workshop-backend/src/user.ts`
- [x] T023 [US2] [P] Webhook tests `packages/workshop-backend/__tests__/clerk-webhook.test.ts`: bad/missing/old signature → 401; removal marks membership and refuses an earlier token, allows a later one; replay idempotent; content retained
- [x] T024 [US2] Frontend: Clerk organization creation/invitation/member management is provided by `WorkspaceSwitcher` (Phase 6, T034); add the "ended session" path in `useClerkSession.ts` (coded `sessionNotPermitted`/`sessionExpired` → fall back to personal via `setActive`) with test in `packages/workshop-frontend/src/clerk/useClerkSession.test.tsx`

## Phase 5: User Story 3 - Dedicated single-organization deployment (P3)

**Goal**: `TENANT_MODE=single` pins the tenant and refuses everyone else.

**Independent Test**: Pinned org A: member of A authenticates; member of B, personal (no org) and a misconfigured pin are all refused with nothing created.

- [x] T025 [US3] Enforce the pin in `resolveTenant` callers (`authenticateFromClerk` and `renewSession`) in `packages/workshop-backend/src/server.ts`; no personal tenant creation in single mode
- [x] T026 [US3] [P] Tests in `packages/workshop-backend/__integration__/clerk-rpc.test.ts`: pinned allow, other-org refuse, no-org refuse, missing `TENANT_ID` refuse, org switch on a live connection aborts it

## Phase 6: User Story 4 - Keep tenants apart when sharing (P2)

**Goal**: Tenants cannot see, add or open each other's work.

**Independent Test**: Cross-tenant add returns the "no such user" answer; cross-tenant open is denied even with a valid share link; directory search returns only same-tenant users; legacy single-tenant behaviour unchanged.

- [x] T027 [US4] Tenant-scope the directory: `UserDurableObject.#syncDirectory` (`packages/workshop-backend/src/user.ts`) and `AuthenticatedApiImpl.searchUsers` (`packages/workshop-backend/src/server.ts`) address `getByName(tenantOfProfileId(id))`
- [x] T028 [US4] Refuse cross-tenant `addCollaborator` (return null) in `packages/workshop-backend/src/overseer.ts`
- [x] T029 [US4] Refuse non-owner `open()` across tenants (denial indistinguishable from no access) in `packages/workshop-backend/src/overseer.ts`
- [x] T030 [US4] [P] Tests in `packages/workshop-backend/__integration__/clerk-rpc.test.ts` (directory isolation; add and open refused cross-tenant, allowed same-tenant; legacy ids unaffected) and update `user-directory.test.ts` if needed
- [x] T031 [US4] Confirm and document connected-account scoping (accounts are stubs in the tenant-keyed user DO; `createAccount()` mints per call) in `specs/001-clerk-tenant-identity/research.md` R4 covered by the integration test `keeps the same person's workspaces in two tenants apart` in `packages/workshop-backend/__integration__/clerk-rpc.test.ts` (separate user DOs per tenant); a per-gatekeeper account-record assertion was not written

## Phase 7: User Story 5 - Switch workspaces and manage my account (P3)

**Goal**: Header shows identity and workspace, switches workspaces, edits profile, signs out; last-used workspace is remembered.

**Independent Test**: Switching org in the switcher reconnects into that tenant; `getWorkspaceInfo/rememberWorkspace` round-trip; first sign-in on a new browser session restores the remembered org.

- [x] T032 [US5] `AuthenticatedApiImpl.getWorkspaceInfo/rememberWorkspace` + `UserDurableObject` last-workspace accessors on the personal DO in `packages/workshop-backend/src/server.ts` and `packages/workshop-backend/src/user.ts`
- [x] T033 [US5] [P] Tests in `packages/workshop-backend/__integration__/clerk-rpc.test.ts`: remembered workspace is the verified tenant, readable from another session, not settable by a client-chosen id
- [x] T034 [US5] `packages/workshop-frontend/src/clerk/WorkspaceSwitcher.tsx` (OrganizationSwitcher) in `components/Header.tsx`; `components/UserMenu.tsx` uses Clerk `openUserProfile` and `signOut` in Clerk mode
- [x] T035 [US5] Last-used restore in `packages/workshop-frontend/src/clerk/useClerkSession.ts` (once per browser session, silent fallback) with test
- [x] T036 [US5] [P] `AdminSettings`/`#isAdmin`: match `ADMINS` on `userIdOfProfileId(name)` in `packages/workshop-backend/src/server.ts`; test that an org admin without an `ADMINS` entry gets no admin API (`__tests__/clerk-auth.test.ts`)

## Phase 8: Polish

- [x] T037 Audit logging (`clerk.signin.refused`, `clerk.tenant.mismatch`, `clerk.membership.ended`, `clerk.account.erased`) via the workshop logger, ids only, in `server.ts`, `user.ts`, `clerk-webhook.ts`
- [x] T038 `user.deleted` erasure (`UserDurableObject.eraseAccount`: revoke accounts, end memberships in `knownTenants`, delete all storage) with test in `clerk-webhook.test.ts`
- [x] T039 [P] Docs: `docs/clerk-signin.md` (setup, env vars, tenancy model) and a pointer from `AGENTS.md` architecture notes
- [x] T040 Run lint, build, backend and frontend tests; fix fallout. Quickstart manual steps 2-8 need a live Clerk instance and were not walked; the same behaviours are covered by the integration tests (no browser run against Clerk was possible)
