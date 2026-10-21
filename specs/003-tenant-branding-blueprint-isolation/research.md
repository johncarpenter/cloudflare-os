# Research: Tenant Branding and Blueprint Isolation

No `NEEDS CLARIFICATION` items remained. Findings come from reading the code paths the spec touches.

## R1. Where are blueprints exposed today?

| Surface | Code | Authenticated? | Reads |
|---|---|---|---|
| Blueprint details | `PublicApi.getBlueprint` (`server.ts`) | No | KV record |
| Download (full source) | `PublicApi.downloadBlueprint` | No | KV + R2 content |
| Preview image | `GET /blueprint-screenshot/<id>` (`serveBlueprintScreenshot`), `Cache-Control: public, immutable` | No (an `<img>` request) | R2 |
| Create a gadget | `AuthenticatedApi.newGadgetFromBlueprint` | Yes, any tenant | KV + R2 |
| Update proposal / follow | `Overseer.applyBlueprint`, `initializeFromBlueprint` | Yes | KV + R2 |
| Agent reads | `Overseer.fetchBlueprint` ("ids are bearer capabilities") | Yes | KV + R2 |
| Library | `UserDurableObject.addBlueprintToLibrary` | Yes | KV |
| Import | `AuthenticatedApi.importBlueprint` | Yes | writes KV + R2 |
| Publish | `Overseer.propagateBlueprint` | Yes | writes KV + R2 |
| Feature in catalog | `AdminSettings.syncFeaturedBlueprint`, `promoteFormat` | Operator | KV |

The record carries `ownerId` (the publisher's Durable Object id, a hex string) but **no tenant**, and
that hex id does not reveal the user's name, so a tenant cannot be derived from it at read time.

## R2. How do we decide who may read a blueprint?

- **Decision**: add `tenantId` to the KV record at publish and import (from the publisher's profile id,
  via `tenantOfProfileId`). `mayRead(record, caller)`:
  1. no `ownerId` (bundled) → anyone signed in (and, unauthenticated, only bundled);
  2. `tenantId` present → equal to the caller's tenant;
  3. no `tenantId` but an `ownerId` → only that owner, until the sweep attributes it.
  All of it applies only when Clerk is enabled (FR-025).
- **Rationale**: one comparison on data already read; no extra round trip. Case 3 fails closed, so
  turning the feature on cannot leave an old link open between deploy and backfill.
- **Alternatives**: (a) Resolve the tenant from the owner's user DO on every read: a cross-DO call on
  every blueprint read. (b) Put the tenant in the blueprint id: breaks bundled ids and existing links.
  (c) Per-tenant KV namespaces: new bindings per tenant, not possible at runtime.

## R3. One chokepoint, not nine checks

- **Decision**: `blueprint-access.ts` exports `readBlueprintFor(env, id, caller)`, returning the record
  or `undefined` (the same as a missing id), and every read site in R1 calls it instead of
  `readBlueprintKvRecord`. The caller is a `{ tenantId, userDoId }` taken from the verified session.
- **Rationale**: matches the repo's own convention ("`#assertResourceEnabled()` is the single core
  chokepoint"); a refusal and a missing blueprint become the same code path, so FR-015 holds by
  construction. Review is one module plus mechanical call-site changes.
- **Alternative**: per-site checks, rejected: nine copies drift.

## R4. Unauthenticated surfaces

- `PublicApi` has no session, so it cannot know a tenant. **Decision**: in a Clerk deployment
  `getBlueprint` / `downloadBlueprint` return null / "Blueprint not found" for any non-bundled record.
  Authenticated twins (`AuthenticatedApi.getBlueprint`, `downloadBlueprint`) apply `mayRead`.
- The landing page tries the authenticated call when signed in and the public one otherwise; a null
  result signed out shows "sign in to continue" for **every** id (existing or not), so nothing is
  disclosed (FR-016). After sign-in the authenticated result decides.

## R5. Preview images

- A plain `<img src>` request carries no credentials: the SPA authenticates over a WebSocket with a
  token in `localStorage`, and there is no cookie. So the HTTP route cannot tell a member from anyone.
  Public caching (`immutable`) would also let an edge cache hold a private image.
- **Decision**: the route serves only bundled blueprints' images (unchanged headers) in a Clerk
  deployment, and returns 404 for tenant ids. Tenant images are fetched with
  `AuthenticatedApi.getBlueprintScreenshot(id)` (bytes, same access rule) and shown through a blob URL.
  `BlueprintPublicInfo` and `BlueprintUserSummary` get `hasScreenshot`, and `screenshotUrl` is omitted
  for tenant blueprints.
- **Alternatives**: (a) signed expiring URLs: needs a new secret, and a URL passed to a non-member works
  until it expires, which fails FR-017's "refused outside the tenant". (b) A cookie: introduces a second
  auth mechanism. Rejected.

## R6. Existing blueprints

- **Decision**: when Clerk is enabled, `AdminSettings` runs a one-time sweep (marker in its storage,
  retried on the next request if it fails, like `ensureBundledBlueprintsInstalled`) listing blueprint
  keys, skipping reserved and bundled ones, resolving each owner's profile id through the user DO, and
  writing `tenantId` back. Until a record is attributed, case 3 of R2 applies.
- Gadgets already made from another tenant's blueprint (FR-023): the update path
  (`applyBlueprint`) treats the blueprint as unreadable, which already produces "unavailable"; the UI
  message says why.

## R7. Featuring and the shared catalog

- `promoteFormat` and `syncFeaturedBlueprint` read the record: **Decision**: refuse a record that has an
  owning tenant (FR-020), and the sweep drops any existing featured entry that is tenant-owned.
  Bundled blueprints have no `ownerId` and are unaffected.

## R8. Where does tenant branding live?

- **Decision**: a `branding` table in the per-tenant `UserDirectoryDurableObject` (the Durable Object
  named by the tenant id, which already exists and is erased with the tenant in spec 001's
  `eraseTenant`). One row: name, logo bytes, accent color, updatedAt, updatedBy.
- **Rationale**: reuses the only per-tenant object instead of adding a Durable Object class (which
  would need a migration, a manifest change and test wiring). Logos are PNG, at most 256 KiB
  (`MAX_SITE_LOGO_BYTES`), which SQLite holds comfortably, so no R2 key to clean up. Organization
  deletion clears it with the same call.
- **Alternatives**: a new `TenantSettings` class (cleaner naming, more kernel and release surface); the
  global `AdminConfig` keyed by tenant (grows the single hot KV key without bound and mixes tenants).
- The class comment is widened ("a tenant's registry: its users and its branding").

## R9. How does branding reach the screen?

- The deployment config arrives before sign-in (`PublicApi.getServerConfig`) and the sign-in pages must
  keep the deployment's branding (FR-004). **Decision**: after sign-in, `AuthenticatedApi.getBranding()`
  returns the effective tenant branding (or null) and the SPA provides a merged `ServerConfig` to the
  authenticated tree through the existing `ServerConfigContext`. `useSiteName`, `SiteLogo`,
  `applyAccentColor`, the favicon and the tab title already read that context, so none changes. The logo
  is delivered inline as a PNG data URL (bounded at 256 KiB), so no public image route exists.
- A workspace switch re-authenticates (spec 001), which re-fetches branding; the provider unmounts the
  previous tenant's value first (FR-005).
- **Not built**: per-organization sign-in addresses (assumption in the spec).

## R10. Who may edit, and when is the role checked?

- The verified token carries the organization role (`o.rol` in v2: `admin`; `org_role` in v1:
  `org:admin`). **Decision**: normalize both, and treat only the administrator role as able to edit.
- **Decision**: `AuthenticatedApi.getTenantAdminApi()` returns a capability (null for non-admins and in
  personal tenants), minted like `getAdminApi()`. Two additions because roles change mid-session:
  `renewSession` refreshes the session's role from each renewed token, and every capability method
  re-reads that role and refuses if it is no longer administrator. Staleness is bounded by the 30
  second renewal, which meets "refused after the role is removed" (US2 scenario 6).
- Operators (`ADMINS`) are not organization administrators by that fact; they use `AdminApi`.

## R11. Operator visibility and the off switch

- Tenants have no registry, so "list organizations with branding" needs an index. **Decision**: a small
  table in `AdminSettings` (tenant id, updatedAt) written by the branding save/clear path, readable
  through `AdminApi.listTenantBranding()`, with `clearTenantBranding(tenantId)` calling the tenant DO and
  removing the row. The off switch is `AdminConfig.tenantBrandingEnabled` (default true), read by
  `getBranding` and `getTenantAdminApi`; saved branding is kept when off (FR-012).

## R12. Validation

- Name: trimmed, 1-40 characters (MAX_SITE_NAME_LENGTH), no control characters, rendered as text by React (never as markup).
- Accent color: the same validator the deployment accent uses (`#rrggbb`).
- Logo: `validateSiteLogo` (PNG, at most 256 KiB, 512 px per side), the same limits as the deployment
  logo (FR-007). Parts are set and cleared independently (FR-008).

## R13. What is deliberately not changed

- `AdminConfig`'s other settings, the banner and announcement (FR-010), gatekeeper and model
  configuration, sign-in pages, and ownership of a departed member's blueprints.
