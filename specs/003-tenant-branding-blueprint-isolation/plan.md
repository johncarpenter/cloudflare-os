# Implementation Plan: Tenant Branding and Blueprint Isolation

**Branch**: `003-tenant-branding-blueprint-isolation` | **Date**: 2026-10-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-tenant-branding-blueprint-isolation/spec.md`

## Summary

Two independent changes on top of the tenant model of spec 001.

**Blueprint isolation.** Published blueprints get an owning tenant, recorded when they are published or
imported. Every place that reads a blueprint by id goes through one chokepoint,
`blueprint-access.ts`, which answers "no such blueprint" unless the blueprint is global (bundled), or
belongs to the caller's tenant. The unauthenticated surfaces (`PublicApi.getBlueprint`,
`downloadBlueprint`, the `/blueprint-screenshot/<id>` route) serve only global blueprints in a Clerk
deployment; tenant blueprints are reached through new authenticated equivalents, and their preview
images are delivered over RPC instead of a public URL. Records published before the feature are
attributed by a one-time sweep, and fail closed (owner only) until it runs.

**Tenant branding.** An organization's name, logo (PNG) and accent color live in the tenant's own
Durable Object (the per-tenant directory, which already exists), not in the deployment-wide
`AdminConfig`. After sign-in the SPA fetches the effective branding and merges it over the deployment
config it already has, so every existing consumer (`useSiteName`, the logo, the accent color, the tab
title and icon) follows with no per-screen change. Organization administrators edit it through a
capability minted from the verified session role (the same pattern as `getAdminApi`); operators can
list, clear and switch it off.

## Technical Context

**Language/Version**: TypeScript 7 (tsgo), Cloudflare Workers, React 19 SPA.

**Primary Dependencies**: Existing only: capnweb / capnweb-validate, Kumo, `jose` (token role). No new
packages.

**Storage**: Per-tenant Durable Object SQLite (branding table beside the directory's users table);
a `tenantId` field in the existing blueprint KV records; a small tenant-branding index table in the
existing `AdminSettings` Durable Object; one new `AdminConfig` field. **No new Durable Object class,
so no migration tag.**

**Testing**: vitest in workerd (`__tests__`, `__integration__`) for the backend; vitest + jsdom for the
SPA; the existing integration harness drives two tenants over a real RPC session.

**Target Platform**: Cloudflare Workers + browser.

**Project Type**: Web application (kernel: `workshop-backend` + `workshop-shared`; UI: `workshop-frontend`).

**Performance Goals**: Branding adds one small RPC after sign-in; blueprint checks add no round trip
on the hot path when the record carries `tenantId` (the common case).

**Constraints**: Kernel diffs small (constitution I); a refusal must be indistinguishable from "not
found" (FR-015); no behaviour change without Clerk (FR-025); branding never touches any other setting.

**Scale/Scope**: Branding is one row per organization. Blueprint checks touch ~9 read sites.

## Constitution Check

| Principle | Status | Notes |
|---|---|---|
| I. Kernel bar | Pass, with a split | The change is large for the kernel, so it ships as three reviewable parts: (1) blueprint isolation, (2) tenant branding, (3) frontend for both. Each exported `workshop-shared` member gets a doc comment. Reuses existing mechanisms: the per-tenant directory Durable Object, `getAdminApi`'s capability pattern, `validateSiteLogo`, the accent-color validator, `readBlueprintKvRecord`. |
| II. Capability security | Pass | The administrator role comes from the verified token, never from a client field, and the capability re-checks it on every call and on every renewal. Tenant is derived server-side. No ambient authority is added. Auth config is untouched. The operator switch lives in `AdminConfig` (a soft customization, not auth config). |
| III. RPC discipline | Pass | New methods on `@validateRpc()` classes; new stubs disposed; screenshots are bytes, not stubs. |
| IV. Observability | Pass | Audit events (`branding.changed`, `blueprint.access.refused`) carry tenant and user ids only, never image bytes. |
| V. Frontend conventions | Pass | Kumo components; feature code under `src/branding/`; the overlay reuses the existing `ServerConfigContext`. |
| VI. Tests | Pass | Refusal tests for every blueprint exposure and for non-admin branding writes (see quickstart). |
| VII. Config integrity | Pass | No worker config, binding or migration changes. |

No violations; Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/003-tenant-branding-blueprint-isolation/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── blueprint-access.md   # who may do what to which blueprint, per surface
│   ├── rpc-api.md            # shared API additions
│   └── branding.md           # branding payload, validation, roles
└── tasks.md
```

### Source Code (repository root)

```text
packages/workshop-shared/src/
└── api.ts                      # TenantBranding types, AuthenticatedApi.{getBranding,getTenantAdminApi,
                                # getBlueprint,downloadBlueprint,getBlueprintScreenshot}, TenantAdminApi,
                                # AdminApi.{listTenantBranding,clearTenantBranding}, BlueprintPublicInfo.hasScreenshot

packages/workshop-backend/src/
├── blueprint-access.ts         # NEW  the chokepoint: tenant of a record, mayRead, readBlueprintFor
├── tenant-branding.ts          # NEW  validation + merge (reuses validateSiteLogo / accent validator)
├── storage-schema/blueprints-kv.ts   # + tenantId on BlueprintKvRecord
├── user-directory.ts           # + branding table, get/set/clear (the per-tenant DO)
├── admin-settings.ts           # + tenant-branding index, + backfill sweep, refuse featuring/promoting tenant blueprints
├── admin-config.ts             # + tenantBrandingEnabled
├── server.ts                   # PublicApi limited to global blueprints; AuthenticatedApi additions; screenshot route
├── overseer.ts                 # publish records tenantId; apply/fetch/initialize go through the chokepoint
├── user.ts                     # addBlueprintToLibrary through the chokepoint; import records tenantId
└── auth/clerk.ts + tenant.ts   # normalized organization-admin check
packages/workshop-backend/__tests__/ and __integration__/   # blueprint-access, tenant-branding, cross-tenant

packages/workshop-frontend/src/
├── branding/                   # NEW  useTenantBranding, TenantBrandingProvider (merge over ServerConfig),
│                               #      BrandingSettings page (admin), logo/accent preview
├── components/BlueprintPreviewImage.tsx   # loads private images over RPC
├── BlueprintLandingPage.tsx    # signed-out / signed-in paths
└── AdminPage.tsx               # operator: tenant branding list/clear/switch
```

**Structure Decision**: Kernel changes confined to `workshop-backend` + `workshop-shared`, grouped by
concern into separate commits; UI in `workshop-frontend/src/branding/` plus three existing files.

## Key Design Decisions (details in research.md)

1. **One chokepoint for blueprint reads**: `readBlueprintFor(env, id, caller)` returns the record or
   undefined, exactly as for a missing id, so refusals cannot be told apart.
2. **Tenant stored on the record; fail closed until backfilled**: no `tenantId` and an owner means
   owner-only until the sweep attributes it.
3. **Unauthenticated surfaces serve global blueprints only** in a Clerk deployment; tenant blueprints
   need a session. Private preview images travel over RPC (no cookie exists to protect a plain image
   request, and a public cache header would leak them).
4. **Branding in the per-tenant Durable Object**, merged client-side over the deployment config.
5. **Admin role re-verified at every session renewal** and checked on every call.
6. **Operator index in `AdminSettings`**, because tenants have no registry to list.
