# Implementation Plan: Clerk Sign-In and Tenant Identity

**Branch**: `001-clerk-tenant-identity` | **Date**: 2026-10-13 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-clerk-tenant-identity/spec.md`

## Summary

Add Clerk as an alternative sign-in path beside the existing Cloudflare Access path, mirroring it
structurally: the browser holds a Clerk session, passes the short-lived session JWT in-band to a new
`PublicApi.authenticateFromClerk()`, and receives an `AuthenticatedApi`. The verified JWT yields a
`TenantContext` (Clerk organization, or a personal tenant; pinned in single-tenant deployments). The
user Durable Object is addressed by `tenantId NUL clerkUserId` instead of email, which makes every
per-user store (gadgets, chats, connected-account stubs) tenant-scoped by construction. Three
tenant checks are added at the existing choke points: directory search, collaborator add, and
gadget open (covers share-link redemption). A Svix-signed Clerk webhook ends memberships and erases
deleted accounts. The Workshop SPA hosts Clerk's sign-in/sign-up and the organization switcher and
profile UI, and renews the server session every 30 s so membership removal takes effect promptly.

Everything is inert when `CLERK_ISSUER` is unset: existing deployments behave as today (FR-016).

## Technical Context

**Language/Version**: TypeScript 7 (tsgo), Cloudflare Workers runtime, React 19 SPA.

**Primary Dependencies**: `jose` (already a backend dependency) for JWT/JWKS verification; `capnweb`
/ `capnweb-validate` RPC; `@clerk/clerk-react` 5.x for the SPA (new, `workshop-frontend` only);
Kumo UI. No Clerk backend SDK: verification uses Clerk's public JWKS, webhook verification uses
WebCrypto, so no Clerk secret key is stored.

**Storage**: Durable Object SQLite (`UserDurableObject`, new keys only; `UserDirectoryDurableObject`
now one instance per tenant). No new Durable Object classes, so no migration tag.

**Testing**: vitest in workerd (`pnpm exec vp run -F @gadgets/workshop-backend ...`; see
`packages/workshop-backend/vitest.config.ts`), vitest+jsdom for the frontend.

**Target Platform**: Cloudflare Workers (backend/router), browser SPA.

**Project Type**: Web application (monorepo: `workshop-backend`, `workshop-shared`, `workshop-frontend`).

**Performance Goals**: Session verification adds one JWKS-cached signature check per connection and
per 30 s renewal. No extra network call on the hot path once the JWKS is cached.

**Constraints**: Kernel diffs small (constitution I); auth config env-driven, not `AdminConfig`
(II); no secrets in logs (IV); no behaviour change without `CLERK_ISSUER` (FR-016, SC-008).

**Scale/Scope**: Many tenants in one pool; each user key is an independent DO.

## Constitution Check

| Principle | Status | Notes |
|---|---|---|
| I. Kernel bar | Pass | One new backend module for the seam (`tenant.ts`), one for Clerk verification (`auth/clerk.ts`), one for the webhook (`auth/clerk-webhook.ts`). Existing choke points get 1–5 line checks. API additions are doc-commented. Frontend lands in a separate commit from backend/shared. |
| II. Capability security | Pass | Auth/tenant config is env-only (`auth/config.ts` style). Operators (`ADMINS`) are matched on the Clerk user id, not on a Clerk role. Tenant is derived from the verified token, never from a client field. Gatekeeper capabilities still mint through `#assertResourceEnabled()`; unchanged. |
| III. RPC discipline | Pass | New methods are on `@validateRpc()` classes; frontend disposes the stub and wraps it in an object. |
| IV. Observability | Pass | Audit events through `createWorkshopLogger`; only user/tenant ids logged, never tokens. |
| V. Frontend conventions | Pass | Kumo + Clerk prebuilt components; feature code under `src/clerk/`. |
| VI. Tests | Pass | Refusal tests for bad tokens, wrong audience/issuer, cross-tenant add/open/search, single-tenant pin, membership end, webhook signature. |
| VII. Config integrity | Pass | New env vars are optional and read from `env`; `worker-configuration.d.ts` gets typed vars; no wrangler hand edits. |

No violations; Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/001-clerk-tenant-identity/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── rpc-api.md          # shared API additions
│   ├── configuration.md    # env vars and Clerk dashboard setup
│   └── clerk-webhook.md    # webhook endpoint
└── tasks.md
```

### Source Code (repository root)

```text
packages/workshop-shared/src/
└── api.ts                          # PublicApi.authenticateFromClerk, AuthenticatedApi.renewSession /
                                    # getWorkspaceInfo / rememberWorkspace, ServerConfig.clerk,
                                    # AUTH_ERROR_CODES.{sessionNotPermitted,sessionExpired}

packages/workshop-backend/
├── src/
│   ├── tenant.ts                   # NEW  TenantContext seam: key format, tenantOfProfileId, resolveTenant
│   ├── auth/
│   │   ├── config.ts               # isClerkEnabled(), clerk env readers, legacy auth off when Clerk on
│   │   ├── clerk.ts                # NEW  verifyClerkSessionToken (JWKS, iss, azp, exp)
│   │   └── clerk-webhook.ts        # NEW  Svix verify + event handling
│   ├── server.ts                   # authenticateFromClerk, session liveness, #isAdmin, tenant-scoped directory,
│   │                               # /api/clerk-webhook route
│   ├── user.ts                     # authenticateFromClerk / endMembership / erase / lastWorkspace
│   ├── overseer.ts                 # same-tenant checks in addCollaborator and open()
│   ├── deployment-config.ts        # ServerConfig.clerk
│   ├── storage-schema/user-storage.ts
│   └── env.d.ts                    # optional Clerk/tenant env vars
└── __tests__/                      # tenant.test.ts, clerk-auth.test.ts, clerk-webhook.test.ts,
                                    # tenant-sharing.test.ts (+ user directory test update)

packages/workshop-frontend/src/clerk/
├── ClerkAppProvider.tsx            # ClerkProvider + bridge context (only when serverConfig.clerk)
├── ClerkSignInPage.tsx             # <SignIn/> / <SignUp/> in the app's login shell
├── useClerkSession.ts              # token source + 30 s renewal + workspace restore
├── WorkspaceSwitcher.tsx           # <OrganizationSwitcher/> in the header
└── *.test.tsx
(edits) useAuth.ts, routes/__root.tsx, ProtectedRoute.tsx, LoginPage.tsx, SignupPage.tsx,
        components/UserMenu.tsx, components/Header.tsx, main.tsx, package.json
```

**Structure Decision**: Web application inside the existing monorepo; kernel changes grouped in
`workshop-backend` + `workshop-shared`, frontend isolated in `workshop-frontend/src/clerk/`.

## Key Design Decisions (details in research.md)

1. **Mirror the Access path**: `authenticateFromClerk(token)` next to `authenticateFromCfAccess()`.
2. **User key** = `tenantId + "\0" + clerkUserId`; profile id == DO name (as today), so a profile id
   alone yields its tenant (`tenantOfProfileId`). Legacy ids have no NUL and map to tenant `""`.
3. **Tenant ids**: Clerk org id for organizations; `u_<clerkUserId>` for personal tenants.
4. **Liveness**: client renews every 30 s; server refuses calls and aborts the session after 75 s
   without a valid renewal, and on any renewal that changes user or tenant.
5. **Webhook** for immediate membership end / account erasure; JWT renewal is the backstop.
6. **Clerk replaces other sign-in** on a Clerk-enabled deployment (assumption in spec).
7. **Deferred** (approved): org-admin view/reassign of departed members' content (FR-013a tail).
